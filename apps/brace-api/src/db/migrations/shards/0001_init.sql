-- Migration 0001 (shard) — initial schema. Apply to EVERY shard DB.
-- Mirrors db/shards/schema.sql. Applied via:
--   wrangler d1 migrations apply DB_SHARD_1 --env <development|staging|production>
-- (repeat for each DB_SHARD_N binding).

CREATE TABLE IF NOT EXISTS file_manifest (
  user_id    TEXT NOT NULL,
  path       TEXT NOT NULL,
  version    INTEGER NOT NULL,
  size       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, path)
);

CREATE INDEX IF NOT EXISTS idx_file_manifest_user_updated
  ON file_manifest(user_id, updated_at);
