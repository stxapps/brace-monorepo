-- MASTER database — full-create snapshot.
--
-- This is the authoritative "fresh DB" schema: run it to stand up a brand-new
-- master database from scratch, and read it to see the current shape at a
-- glance. For changes to a LIVE master DB, add a numbered migration under
-- db/migrations/master/ instead of editing a deployed table by hand (this file
-- and migrations/master/0001_init.sql are kept in lockstep). See
-- db/migrations/README.md.
--
-- The master DB holds ONLY lookup / master data — users, sessions, and the
-- shard registry — so it never approaches D1's per-database size cap. All
-- per-user data lives in the shard DBs (see db/shards/schema.sql).

-- Users: identity + shard assignment. The user's data lives in the shard named
-- by shard_id -> shards.binding_name. username is stored lower-cased for a
-- case-insensitive UNIQUE.
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  shard_id   TEXT NOT NULL REFERENCES shards(id),
  created_at INTEGER NOT NULL
);

-- Sessions: bearer-token auth. We store the token HASH (sha-256), never the raw
-- token. user_id + shard_id are denormalized here so the auth guard resolves
-- "token -> user + shard" in a single read.
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

-- Shard registry: one row per shard DB. binding_name maps a logical shard id to
-- a wrangler binding (a property on c.env; see db/shard-router.ts). status gates
-- new-account assignment ('active' = accepting; 'draining'/'readonly' = not).
-- Placement is BYTE-based: a shard takes new accounts while size_bytes <
-- max_bytes, least-full-by-bytes first (see services/shard-assignment.ts).
-- size_bytes is refreshed from D1's meta.size_after by the refresh sweep;
-- size_updated_at is when. max_bytes sits below D1's ~10 GB cap to leave headroom
-- for existing users to keep growing. user_count/capacity are a secondary
-- backstop + tiebreaker, no longer the cutover.
CREATE TABLE IF NOT EXISTS shards (
  id              TEXT PRIMARY KEY,
  binding_name    TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'active', -- active | draining | readonly
  user_count      INTEGER NOT NULL DEFAULT 0,
  capacity        INTEGER NOT NULL,
  size_bytes      INTEGER NOT NULL DEFAULT 0,          -- last measured DB size
  max_bytes       INTEGER NOT NULL DEFAULT 8589934592, -- 8 GiB: cutover w/ headroom under D1's 10 GB cap
  size_updated_at INTEGER NOT NULL DEFAULT 0,          -- when size_bytes was last refreshed
  created_at      INTEGER NOT NULL
);

-- Seed the first shard so account creation works out of the box. Matches the
-- DB_SHARD_1 binding in wrangler.jsonc / lib/env.ts. Add a row (and a binding)
-- per shard you provision. size_bytes/max_bytes/size_updated_at use defaults.
INSERT OR IGNORE INTO shards (id, binding_name, status, user_count, capacity, created_at)
VALUES ('shard_1', 'DB_SHARD_1', 'active', 0, 100000, unixepoch() * 1000);
