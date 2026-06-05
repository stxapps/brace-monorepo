-- Migration 0001 (master) — initial schema.
-- Mirrors db/master/schema.sql. Applied to live master DBs via:
--   wrangler d1 migrations apply DB_MASTER --env <development|staging|production>

CREATE TABLE IF NOT EXISTS shards (
  id           TEXT PRIMARY KEY,
  binding_name TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'active',
  user_count   INTEGER NOT NULL DEFAULT 0,
  capacity     INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  shard_id   TEXT NOT NULL REFERENCES shards(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  shard_id     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

INSERT OR IGNORE INTO shards (id, binding_name, status, user_count, capacity, created_at)
VALUES ('shard_1', 'DB_SHARD_1', 'active', 0, 100000, unixepoch() * 1000);
