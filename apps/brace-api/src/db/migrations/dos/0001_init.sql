-- Migration 0001 (durable object) — initial schema. Apply to EVERY DO.
-- Mirrors db/dos/schema.sql. Applied via:
--   

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
