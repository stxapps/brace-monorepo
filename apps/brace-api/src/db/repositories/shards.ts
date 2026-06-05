// Shard registry repository — lives in the MASTER DB. One row per shard DB,
// mapping a logical shard_id -> the wrangler binding name that exposes it, plus
// the bookkeeping the assignment logic reads.
//
// CUTOVER is byte-based: D1's hard limit is ~10 GB *per database*, a BYTE limit,
// not a row limit. So a shard stops taking new accounts when its measured size
// (size_bytes, refreshed from D1's meta.size_after — see
// services/shard-assignment.ts#refreshShardSizes) reaches max_bytes, set below
// the 10 GB cap to leave headroom for the users ALREADY on the shard to keep
// growing. user_count/capacity remain a cheap secondary backstop (caps a runaway
// row count of tiny users) and an observability/tiebreaker signal — NOT the
// primary cutover.
//
// Adding a shard is a deploy-time action: `wrangler d1 create`, add the binding
// to wrangler.jsonc + lib/env.ts, then INSERT a row here with its binding_name.

export type ShardStatus = 'active' | 'draining' | 'readonly';

export type ShardRow = {
  id: string;
  bindingName: string;
  status: ShardStatus;
  userCount: number;
  capacity: number;
  sizeBytes: number;
  maxBytes: number;
};

type ShardRecord = {
  id: string;
  binding_name: string;
  status: ShardStatus;
  user_count: number;
  capacity: number;
  size_bytes: number;
  max_bytes: number;
};

// Shared projection so every read returns a full ShardRecord.
const COLS = `id, binding_name, status, user_count, capacity, size_bytes, max_bytes`;

function toRow(r: ShardRecord): ShardRow {
  return {
    id: r.id,
    bindingName: r.binding_name,
    status: r.status,
    userCount: r.user_count,
    capacity: r.capacity,
    sizeBytes: r.size_bytes,
    maxBytes: r.max_bytes,
  };
}

export function shardsRepo(db: D1Database) {
  return {
    async getById(id: string): Promise<ShardRow | null> {
      const r = await db
        .prepare(`SELECT ${COLS} FROM shards WHERE id = ?`)
        .bind(id)
        .first<ShardRecord>();
      return r ? toRow(r) : null;
    },

    // Every shard, for the size-refresh sweep and operational tooling.
    async listAll(): Promise<ShardRow[]> {
      const { results } = await db.prepare(`SELECT ${COLS} FROM shards`).all<ShardRecord>();
      return (results ?? []).map(toRow);
    },

    // Candidate shards for new-account assignment: accepting writes and below the
    // BYTE cutover (with the user_count backstop), least-full-by-bytes first.
    // services/shard-assignment.ts picks [0]. user_count is the tiebreaker so a
    // set of near-empty shards (size_bytes all ~0) still spreads evenly.
    async listAssignable(): Promise<ShardRow[]> {
      const { results } = await db
        .prepare(
          `SELECT ${COLS}
             FROM shards
            WHERE status = 'active' AND size_bytes < max_bytes AND user_count < capacity
            ORDER BY size_bytes ASC, user_count ASC`,
        )
        .all<ShardRecord>();
      return (results ?? []).map(toRow);
    },

    // Atomically claim a slot on a shard. The WHERE re-checks the SAME gates as
    // listAssignable, so a shard that crossed max_bytes or flipped to draining
    // between the SELECT and now won't be claimed (the caller walks to the next
    // candidate). user_count is bumped for the backstop + observability; bytes
    // are not touched here — they grow from real usage and are reconciled by the
    // refresh sweep, so size_bytes is allowed to lag, which is exactly why
    // max_bytes sits below the 10 GB cap.
    async claimAssignment(id: string): Promise<boolean> {
      const res = await db
        .prepare(
          `UPDATE shards SET user_count = user_count + 1
            WHERE id = ?
              AND status = 'active'
              AND size_bytes < max_bytes
              AND user_count < capacity`,
        )
        .bind(id)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },

    // Record a shard's measured byte size. Written by the refresh sweep from
    // D1's meta.size_after; this is the ONLY thing that moves the byte cutover.
    async updateSize(id: string, sizeBytes: number, at: number): Promise<void> {
      await db
        .prepare(`UPDATE shards SET size_bytes = ?, size_updated_at = ? WHERE id = ?`)
        .bind(sizeBytes, at, id)
        .run();
    },
  };
}
