-- DIRECTORY database — full-create snapshot (authoritative "fresh DB" shape).
--
-- For changes to a LIVE db, add a numbered migration under
-- db/migrations/directory/ — keep this snapshot and the migration set in lockstep
-- (0001_init.sql mirrors this file). See db/migrations/README.md.
--
-- The GLOBAL, never-sharded registry: the username uniqueness namespace and the
-- username→account routing map. It is tiny (~70 B/row → ~140M usernames in one
-- 10 GB D1), so it outscales the account shards (~6.6M each) ~20× and effectively
-- never needs sharding itself. When `ACCOUNTS_DB_N` shards fill, this directory
-- stays put and just gains rows with new `account_db_id`s. It's also the natural
-- home for any future small global lookup tables.
--
-- Because the directory and the account rows now live in SEPARATE databases,
-- create-account is cross-DB: it CLAIMS the username here first, then writes the
-- account in the shard, then compensates (releases the claim) if that write
-- fails. See services/account.ts and docs/account.md.

-- The username directory: PRIMARY KEY(username) IS the case-insensitive UNIQUE
-- constraint, and the claim is a single `INSERT ... ON CONFLICT DO NOTHING`
-- (race-free; no read-then-write). Usernames are stored canonical
-- (trim→NFKC→lowercase, canonicalizeUsername in @stxapps/shared) so the handle
-- matches the per-user salt input exactly. account_db_id is the EXPLICIT shard
-- this user's rows live in (e.g. '1' ⇒ ACCOUNTS_DB_1), assigned at create-account
-- by assignAccountDbId() and resolved by db/db-routes.ts. NOT NULL — every row
-- self-describes its shard, so adding a shard never rewrites existing rows.
CREATE TABLE IF NOT EXISTS usernames (
  username      TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  account_db_id TEXT NOT NULL,
  created_at    INTEGER NOT NULL          -- when the name was claimed (audit only; never updated — claim/release only, no in-place mutation)
);
CREATE INDEX IF NOT EXISTS idx_usernames_user_id ON usernames(user_id);

-- Subscription purchases — one row per provider subscription (see
-- docs/business-model.md for the tiers and services/iap.ts for the fold to an
-- entitled plan). GLOBAL (here, not an account shard) because webhook events
-- after the first are keyed by the PROVIDER's id — `UNIQUE(source, external_id)`
-- — with no username/session in hand to route a shard by; a per-shard table
-- would force the forbidden try-every-shard scan. Rows are tiny and bounded per
-- user (a handful, ever), and money-adjacent state belongs in the Tier-0 backup
-- set anyway. `user_id` has NO FK (users live in the shards) and is written once
-- at first sight of the subscription, never overwritten by later events.
--
-- source:      'paddle' | 'appstore' | 'playstore' | 'manual' (a server-side
--              grant — comps / lifetime deals — with no provider to verify).
-- external_id: the provider's subscription identity — Paddle subscription id,
--              App Store originalTransactionId, Play purchase token; a minted
--              id for 'manual'. The webhook upsert key.
-- plan/status: normalized (shared PLANS; 'active'|'trialing'|'past_due'|
--              'paused'|'canceled'), mapped from provider vocab at the webhook
--              edge so the fold never sees provider-specific states.
-- provider_customer_id: Paddle customer id (ctm_…), needed to mint customer-
--              portal sessions. NULL for other sources.
-- expires_at:  epoch ms the paid period runs to; NULL = non-expiring
--              (manual/lifetime). canceled_at: when cancellation was scheduled
--              (period end) — entitled until expires_at, but willRenew=false.
-- event_occurred_at: provider event time last applied — the out-of-order
--              webhook guard (an upsert loses to a newer stored event).
CREATE TABLE IF NOT EXISTS purchases (
  id                   TEXT PRIMARY KEY,  -- server-minted (newId())
  user_id              TEXT NOT NULL,
  source               TEXT NOT NULL,
  external_id          TEXT NOT NULL,
  plan                 TEXT NOT NULL,
  status               TEXT NOT NULL,
  provider_customer_id TEXT,
  expires_at           INTEGER,
  canceled_at          INTEGER,
  event_occurred_at    INTEGER NOT NULL,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_purchases_user_id ON purchases(user_id);
