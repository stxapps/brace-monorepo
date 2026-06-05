import { type ShardRow,shardsRepo } from '../db/repositories/shards';
import { ApiError } from '../lib/errors';

// Decides which shard DB a NEW account's data goes in. Strategy: least-loaded
// active shard under capacity (the registry query already orders by user_count).
// This keeps shards balanced and, crucially, away from D1's per-database size
// cap — the whole reason user data is split off the master DB.
//
// Capacity is enforced atomically at increment time (shards.incrementUserCount
// guards `user_count < capacity`), so two concurrent signups can't both win the
// last slot; the loser retries the next candidate.
export async function pickShard(masterDb: D1Database): Promise<ShardRow> {
  const candidates = await shardsRepo(masterDb).listAssignable();
  if (candidates.length === 0) {
    // Every shard is full or draining. Operational signal to provision another
    // shard DB (see db/migrations/README.md). Don't silently overfill.
    throw new ApiError(503, 'no_capacity', 'No shard available for new accounts');
  }
  return candidates[0];
}

// Atomically claim a slot on the chosen shard, walking to the next candidate if
// a concurrent signup took the last slot. Returns the shard the user was placed
// on. The caller writes the user row with this shard's id.
export async function assignShard(masterDb: D1Database): Promise<ShardRow> {
  const repo = shardsRepo(masterDb);
  const candidates = await repo.listAssignable();
  for (const shard of candidates) {
    if (await repo.incrementUserCount(shard.id)) return shard;
  }
  throw new ApiError(503, 'no_capacity', 'No shard available for new accounts');
}
