// Op-log repository — lives in a per-user Durable Object's SQLite
// (`ctx.storage.sql`), NOT in D1. The DO is the user's whole scope, so rows carry
// no user_id. This is the append-only log the sync engine pulls (a monotonic
// `seq` cursor); the encrypted blob itself lives in R2, which is the source of
// truth — this log is a disposable accelerator, rebuildable from an R2 listing.
// See docs/local-first-sync.md and ../user-data.ts (the DO that owns this table
// and its in-code migrator).

export type OpKind = 'put' | 'delete';

// Public domain entity (camelCase) — one entry in the op log.
export type OpLogEntity = {
  seq: number;
  op: OpKind;
  path: string;
  updatedAt: number;
};

// Raw row as it sits in SQLite (snake_case columns). Internal to this repo.
type OpLogRow = {
  seq: number;
  op: OpKind;
  path: string;
  updated_at: number;
};

function toEntity(r: OpLogRow): OpLogEntity {
  return { seq: r.seq, op: r.op, path: r.path, updatedAt: r.updated_at };
}

// Bound to a SqlStorage handle (the DO's `ctx.storage.sql`). SqlStorage is
// SYNCHRONOUS — no awaits here, unlike the D1-backed master repos (users/sessions).
export function opLogsRepo(sql: SqlStorage) {
  return {
    // Incremental pull: ops after the client's cursor, oldest first, capped at
    // `limit`. The client advances its cursor to the max seq returned and calls
    // again while a full page comes back. See docs/local-first-sync.md.
    listSince(since: number, limit: number): OpLogEntity[] {
      const rows = sql
        .exec<OpLogRow>(
          `SELECT seq, op, path, updated_at
             FROM op_logs
            WHERE seq > ?
            ORDER BY seq ASC
            LIMIT ?`,
          since,
          limit,
        )
        .toArray();
      return rows.map(toEntity);
    },

    // Push: record a committed mutation AFTER its blob is in R2 (R2-first, log-
    // last — a crash in between leaves an R2 object with no op, which the
    // R2-listing fallback heals; never trust the log for "does this file exist").
    // Returns the new monotonic seq the client stores as its cursor.
    append(op: OpKind, path: string, updatedAt: number): number {
      const row = sql
        .exec<{ seq: number }>(
          `INSERT INTO op_logs (op, path, updated_at)
           VALUES (?, ?, ?)
           RETURNING seq`,
          op,
          path,
          updatedAt,
        )
        .one();
      return row.seq;
    },
  };
}
