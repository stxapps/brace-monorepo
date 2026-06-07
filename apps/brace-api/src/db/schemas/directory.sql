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
  account_db_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usernames_user_id ON usernames(user_id);
