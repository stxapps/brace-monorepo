// Shard registry repository — lives in the MASTER DB. One row per shard DB,
// mapping a logical shard_id -> the wrangler binding name that exposes it, plus
// the bookkeeping (status, user_count, capacity) the assignment logic reads.
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
};

type ShardRecord = {
  id: string;
  binding_name: string;
  status: ShardStatus;
  user_count: number;
  capacity: number;
};

function toRow(r: ShardRecord): ShardRow {
  return {
    id: r.id,
    bindingName: r.binding_name,
    status: r.status,
    userCount: r.user_count,
    capacity: r.capacity,
  };
}

export function shardsRepo(db: D1Database) {
  return {
    async getById(id: string): Promise<ShardRow | null> {
      const r = await db
        .prepare(
          `SELECT id, binding_name, status, user_count, capacity FROM shards WHERE id = ?`,
        )
        .bind(id)
        .first<ShardRecord>();
      return r ? toRow(r) : null;
    },

    // Candidate shards for new-account assignment: accepting writes and not yet
    // at capacity, least-loaded first. services/shard-assignment.ts picks [0].
    async listAssignable(): Promise<ShardRow[]> {
      const { results } = await db
        .prepare(
          `SELECT id, binding_name, status, user_count, capacity
             FROM shards
            WHERE status = 'active' AND user_count < capacity
            ORDER BY user_count ASC`,
        )
        .all<ShardRecord>();
      return (results ?? []).map(toRow);
    },

    // Bump the count when a user is assigned. Guarded by the capacity check so a
    // concurrent burst can't overfill a shard past `capacity`.
    async incrementUserCount(id: string): Promise<boolean> {
      const res = await db
        .prepare(
          `UPDATE shards SET user_count = user_count + 1
            WHERE id = ? AND user_count < capacity`,
        )
        .bind(id)
        .run();
      return (res.meta.changes ?? 0) > 0;
    },
  };
}
