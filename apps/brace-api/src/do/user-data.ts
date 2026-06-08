import { DurableObject } from 'cloudflare:workers';

import type { Bindings } from '../lib/env';
import { type OpKind, type OpLogEntity, opLogsRepo } from './repositories/op-logs';

// Per-user data store. One Durable Object instance per user (addressed by
// idFromName(userId) — see userDataStub below), giving each user an isolated,
// strictly-serialized SQLite database with no shared size ceiling. Because the DO
// is single-threaded it is the natural place to mint the op log's monotonic seq,
// and a per-user alarm() can drive op-log compaction later.
//
// MIGRATIONS ARE IN CODE. A DO's SQLite is NOT a D1 database — `wrangler d1
// migrations apply` does not touch it. We track the applied version in a tiny
// `schema_version` table (NOT `PRAGMA user_version`: workerd's DO SQLite
// authorizer rejects that PRAGMA with SQLITE_AUTH) and apply any pending
// statements on construction, before the instance serves a request
// (blockConcurrencyWhile). The schema snapshot in do/README.md mirrors this for
// at-a-glance reference only and is not applied by any tool. See do/README.md.

// Ordered schema versions: entry i upgrades schema_version i -> i+1. APPEND ONLY
// — never edit a shipped entry (DOs already past it won't re-run it). Each entry
// is a list of single statements (SqlStorage.exec runs one statement per call).
const MIGRATIONS: string[][] = [
  // 0 -> 1: initial append-only op log. AUTOINCREMENT (not bare rowid) so seq is
  // strictly increasing and never reused even after compaction deletes old rows.
  [
    `CREATE TABLE IF NOT EXISTS op_logs (
       seq        INTEGER PRIMARY KEY AUTOINCREMENT,
       op         TEXT NOT NULL,
       path       TEXT NOT NULL,
       size       INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_op_logs_path ON op_logs(path)`,
  ],
];

function migrate(sql: SqlStorage): void {
  // Schema version lives in a tiny dedicated table, NOT `PRAGMA user_version`:
  // workerd's Durable Object SQLite authorizer rejects `PRAGMA user_version`
  // (SQLITE_AUTH), so the PRAGMA approach silently bricks the DO on construction.
  // A one-row table is plain DML the authorizer allows and stays transactional
  // with the migration statements.
  sql.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);
  const row = sql.exec(`SELECT version FROM schema_version LIMIT 1`).toArray()[0] as
    | { version: number }
    | undefined;
  const current = row ? Number(row.version) : 0;

  for (let v = current; v < MIGRATIONS.length; v++) {
    for (const stmt of MIGRATIONS[v]) sql.exec(stmt);
  }
  if (current < MIGRATIONS.length) {
    sql.exec(`DELETE FROM schema_version`);
    sql.exec(`INSERT INTO schema_version (version) VALUES (?)`, MIGRATIONS.length);
  }
}

export class UserDataDO extends DurableObject<Bindings> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Finish migrating before the instance handles any RPC — blockConcurrencyWhile
    // holds incoming calls until this resolves.
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql);
    });
  }

  // RPC: incremental pull. Ops after `since`, oldest first, capped at `limit`.
  listOpsSince(since: number, limit = 500): OpLogEntity[] {
    return opLogsRepo(this.sql).listSince(since, limit);
  }

  // RPC: record a committed file mutation (call AFTER the R2 write succeeds).
  // Returns the new monotonic seq the client stores as its cursor.
  appendOp(op: OpKind, path: string, size = 0): number {
    return opLogsRepo(this.sql).append(op, path, size, Date.now());
  }
}

// Resolve the caller's per-user DO stub. Deterministic: the same userId always
// maps to the same instance, so there is NO shard-assignment table to maintain
// (the win over hand-sharded D1). The DO is created lazily on first access — no
// provisioning step at account creation.
export function userDataStub(env: Bindings, userId: string): DurableObjectStub<UserDataDO> {
  return env.USER_DATA.get(env.USER_DATA.idFromName(userId));
}
