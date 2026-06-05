-- Migration 0002 (master) — byte-based shard cutover.
-- Folds into db/master/schema.sql (kept in lockstep). Applied via:
--   wrangler d1 migrations apply DB_MASTER --env <development|staging|production>
--
-- The shard cutover moves from row-count (user_count < capacity) to BYTES
-- (size_bytes < max_bytes): D1's hard limit is ~10 GB *per database*, a byte
-- limit, so user_count was a poor proxy. size_bytes is refreshed from D1's
-- meta.size_after by the refresh sweep (services/shard-assignment.ts); max_bytes
-- defaults below the 10 GB cap to leave headroom for existing users to grow.
-- ADD COLUMN defaults backfill the existing shard row(s).

ALTER TABLE shards ADD COLUMN size_bytes      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shards ADD COLUMN max_bytes       INTEGER NOT NULL DEFAULT 8589934592; -- 8 GiB
ALTER TABLE shards ADD COLUMN size_updated_at INTEGER NOT NULL DEFAULT 0;
