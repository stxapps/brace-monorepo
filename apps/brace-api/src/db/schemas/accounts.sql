-- ACCOUNTS database — full-create snapshot (authoritative "fresh DB" shape).
--
-- Run this to stand up a brand-new accounts database; read it to see the shape
-- at a glance. For changes to a LIVE db, add a numbered migration under
-- db/migrations/accounts/ — keep this snapshot and the migration set in lockstep
-- (0001_init.sql mirrors this file). See db/migrations/README.md.
--
-- This is the global account registry + the username directory. It holds ONLY
-- small, bounded-per-user rows (no bulk data — bookmarks live in the USER_DATA
-- durable objects), so it scales to millions of accounts. `account_db_id` is the
-- pre-cut sharding seam: when this db nears D1's 10 GB cap, `users` +
-- `account_keys` move to additional `accounts_db_N` databases while `usernames`
-- stays here as the global directory. See docs/account.md and db/db-routes.ts.

-- The username DIRECTORY: the global uniqueness namespace and username→account
-- map. PRIMARY KEY(username) IS the case-insensitive UNIQUE constraint, and a
-- single constrained INSERT is the race-free "claim" (no read-then-write).
-- Usernames are stored canonical (trim→NFKC→lowercase, canonicalizeUsername in
-- @stxapps/shared) so the handle matches the per-user salt input exactly.
-- account_db_id routes to the db holding this user's `users`/`account_keys`
-- rows; NULL ⇒ the primary ACCOUNTS_DB (this db). No FK to users(id): the
-- directory is global and stays here even after users/keys shard out.
CREATE TABLE IF NOT EXISTS usernames (
  username      TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  account_db_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_usernames_user_id ON usernames(user_id);

-- Account identity + credential. Keyed by the random server-minted user_id (the
-- DO address). public_key is the Ed25519 credential the server verifies sign-in
-- signatures against (hex) — NOT an identifier. Under the DEK model it is derived
-- from the random DEK, so it is STABLE across password changes (a password change
-- only re-wraps the DEK; see account_keys) and changes only on a rare DEK
-- rotation. The username is NOT stored here — it lives in the `usernames`
-- directory above, so the account row carries no shardable global key.
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The "doors": one wrapped-DEK blob per access method. Each door derives a KEK
-- and AEAD-wraps its own copy of the 32-byte DEK; any one unwraps it. This is
-- the Tier-0 key material — it lives in the SAME db as `users` (and always will,
-- even after sharding) so the credential and its wrapped DEK commit in one
-- transaction. wrapped_dek = AES-256-GCM(KEK, DEK, aad = user_id‖door_type).
CREATE TABLE IF NOT EXISTS account_keys (
  user_id     TEXT NOT NULL REFERENCES users(id),
  door_type   TEXT NOT NULL,            -- 'password' | 'recovery' | 'passkey'
  wrapped_dek BLOB NOT NULL,
  iv          BLOB NOT NULL,            -- GCM nonce for this wrap
  version     INTEGER NOT NULL,         -- bumped on each re-wrap (audit/debug)
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, door_type)
);
