-- Migration 0001 (directory) — initial schema. Mirrors db/schemas/directory.sql.
-- Applied to the live directory DB via:
--   wrangler d1 migrations apply DIRECTORY_DB --env <development|staging|production>

CREATE TABLE IF NOT EXISTS usernames (
  username      TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  account_db_id TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usernames_user_id ON usernames(user_id);

-- Subscription purchases — one row per provider subscription. GLOBAL (here, not
-- an account shard) because webhook events after the first are keyed by the
-- provider's id (UNIQUE(source, external_id)) with no username/session to route
-- a shard by. See docs/iap.md and services/iap.ts for the fold to an entitled plan.
CREATE TABLE IF NOT EXISTS purchases (
  id                   TEXT PRIMARY KEY,
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
