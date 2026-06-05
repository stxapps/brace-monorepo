-- SHARD database — full-create snapshot (applied to EVERY shard DB).
--
-- Each shard DB holds the per-user data for the users assigned to it (see the
-- shard registry in db/master/schema.sql). Every shard has the SAME schema;
-- this one file is applied to each. For changes to live shards, add a numbered
-- migration under db/migrations/shards/ and apply it to every shard binding.
-- See db/migrations/README.md.
--
-- Rows are scoped by user_id (there is no users table here — identity lives in
-- master). The server only ever stores METADATA; the encrypted bookmark blobs
-- live in R2. See docs/local-first-sync.md.

-- File manifest: one row per bookmark file. Drives the sync engine's pull
-- (path + version + size since a cursor). Last-writer-wins per (user, path).
CREATE TABLE IF NOT EXISTS file_manifest (
  user_id    TEXT NOT NULL,
  path       TEXT NOT NULL,
  version    INTEGER NOT NULL,
  size       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, path)
);

-- Incremental-pull lookups: "everything for this user changed since X".
CREATE INDEX IF NOT EXISTS idx_file_manifest_user_updated
  ON file_manifest(user_id, updated_at);
