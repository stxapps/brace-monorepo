import { type ShardRow,shardsRepo } from '../db/repositories/shards';
import { getShardDb } from '../db/shard-router';
import type { Bindings } from '../lib/env';
import { ApiError } from '../lib/errors';

// Decides which shard DB a NEW account's data goes in. Strategy: least-full-by-
// BYTES active shard below its byte cutover (the registry query orders by
// size_bytes). This keeps shards balanced and, crucially, away from D1's
// ~10 GB per-database size cap — the whole reason user data is split off master.
//
// The cutover is byte-based because D1's limit is bytes, not rows: user_count is
// a poor proxy (a few power users can blow a shard while the count is low). The
// gate is `size_bytes < max_bytes` (size_bytes fed by refreshShardSizes below),
// with `user_count < capacity` as a secondary backstop. Both are re-checked
// atomically at claim time (shards.claimAssignment), so two concurrent signups
// can't both win a shard that just crossed a limit; the loser retries the next.

export async function pickShard(masterDb: D1Database): Promise<ShardRow> {
  const candidates = await shardsRepo(masterDb).listAssignable();
  if (candidates.length === 0) {
    // Every shard is at its byte cutover or draining. Operational signal to
    // provision another shard DB (see db/migrations/README.md). Don't overfill.
    throw new ApiError(503, 'no_capacity', 'No shard available for new accounts');
  }
  return candidates[0];
}

// Atomically claim a slot on the chosen shard, walking to the next candidate if a
// concurrent signup (or a stale size read) means it just crossed a limit. Returns
// the shard the user was placed on. The caller writes the user row with its id.
export async function assignShard(masterDb: D1Database): Promise<ShardRow> {
  const repo = shardsRepo(masterDb);
  const candidates = await repo.listAssignable();
  for (const shard of candidates) {
    if (await repo.claimAssignment(shard.id)) return shard;
  }
  throw new ApiError(503, 'no_capacity', 'No shard available for new accounts');
}

// Reconciles each shard's recorded byte size in the registry from D1's
// `meta.size_after` (the live database size in bytes reported on ANY query). This
// is the ONLY thing that moves the byte cutover, so it must run on a schedule —
// wire it to a Worker `scheduled` (cron) handler. Because a new signup adds ~0
// bytes, size_bytes only changes as real usage accrues, and this sweep is what
// the assignment gate reads. Per-shard failures are isolated so one unreachable
// or misbound shard doesn't stall the rest; the next run retries it.
export async function refreshShardSizes(env: Bindings): Promise<void> {
  const repo = shardsRepo(env.DB_MASTER);
  const shards = await repo.listAll();
  const now = Date.now();
  for (const shard of shards) {
    try {
      const db = getShardDb(env, shard);
      // `meta.size_after` is the DB's byte size after the query — present on any
      // query, so a trivial read reports the current size without writing.
      const res = await db.prepare('SELECT 1').all();
      const sizeBytes = (res.meta as { size_after?: number }).size_after;
      if (typeof sizeBytes === 'number') {
        await repo.updateSize(shard.id, sizeBytes, now);
      }
    } catch {
      // Unreachable/misbound shard — skip; the next sweep retries it.
    }
  }
}
