-- MASTER database — full-create snapshot.
--
-- This is the authoritative "fresh DB" schema: run it to stand up a brand-new
-- master database from scratch, and read it to see the current shape at a
-- glance. For changes to a LIVE master DB, add a numbered migration under
-- db/migrations/master/ instead of editing a deployed table by hand (this file
-- and migrations/master/0001_init.sql are kept in lockstep). See
-- db/migrations/README.md.
--
-- The master DB holds ONLY lookup / master data — users, sessions,
-- so it never approaches D1's per-database size cap. All
-- per-user data lives in the durable objects (see db/dos/schema.sql).

-- Users: identity. The user's data lives in the durable objects, keyed
-- by user_id + suffix. username is stored lower-cased for a
-- case-insensitive UNIQUE.
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- Sessions: bearer-token auth. We store the token HASH (sha-256), never the raw
-- token. user_id is denormalized here so the auth guard resolves
-- "token -> user" in a single read.
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
