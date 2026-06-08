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
