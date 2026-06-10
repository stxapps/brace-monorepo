import { DurableObject } from 'cloudflare:workers';

import type { OpEntry, OpsListResponse } from '@stxapps/shared';

import type { Bindings } from '../lib/env';
import { fileSizesRepo, type FileUsage } from './repositories/file-sizes';
import { type OpKind, opLogsRepo } from './repositories/op-logs';

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
  // the keyset cursor index + the durable per-path size map. The op-list
  // pull is a keyset scan ordered by (updated_at, path) (op-logs.ts listSince), so
  // index that exact tuple. `file_sizes` is the quota's source of truth — set on
  // every committed put, read-and-subtracted on delete (file-sizes.ts) — kept
  // separate from the compactable op log so it never undercounts.
  [
    `CREATE TABLE IF NOT EXISTS op_logs (
       seq        INTEGER PRIMARY KEY AUTOINCREMENT,
       op         TEXT NOT NULL,
       path       TEXT NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_op_logs_path ON op_logs(path)`,
    `CREATE INDEX IF NOT EXISTS idx_op_logs_cursor ON op_logs(updated_at, path)`,
    `CREATE TABLE IF NOT EXISTS file_sizes (
       path TEXT PRIMARY KEY,
       size INTEGER NOT NULL
     )`,
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

  // RPC: incremental pull (GET /v1/ops/list). Keyset scan over the compound cursor
  // (updatedAt, path) plus the retained-range bounds the client routes on. Asks for
  // limit+1 to detect `hasMore` without a second COUNT, then trims to `limit`. The
  // wire shape drops the internal `seq` (op-logs.ts keeps it for ordering only).
  listOps(since: number | null, sincePath: string | null, limit = 500): OpsListResponse {
    const repo = opLogsRepo(this.sql);
    const rows = repo.listSince(since, sincePath, limit + 1);
    const hasMore = rows.length > limit;
    const ops: OpEntry[] = rows
      .slice(0, limit)
      .map((r) => ({ op: r.op, path: r.path, updatedAt: r.updatedAt }));
    const { oldestUpdatedAt, newestUpdatedAt } = repo.bounds();
    return { ops, oldestUpdatedAt, newestUpdatedAt, hasMore };
  }

  // RPC: record a committed file mutation (POST /v1/ops/commit). A pure write
  // against this DO's own SQLite — the R2 side (the put existence check + reading
  // R2's `LastModified`/size) is done by the caller in services/sync.ts, which
  // passes the results in. The log must never point at an object that isn't in R2
  // (op-without-object 404s every client that pulls it; an object with no op is
  // harmless and healed by the fallback R2 listing), so the service HEADs R2 and
  // refuses to call this for a put with no object. See docs/local-first-sync.md.
  //
  // `path` is the wire-relative path (the DO is the user's whole scope, so rows
  // carry no userId). `updatedAt` is the op log's cursor clock, sourced per kind:
  //  - put:    R2's authoritative `LastModified`, with `size` its reported size,
  //            recorded in the quota map.
  //  - delete: the worker's commit clock (no object survives to HEAD), and the
  //            path's recorded size is freed from the quota map (`size` ignored).
  // Mixing the two clocks is safe because paths are immutable random ids — a path
  // is only ever put…put…delete, so a put and a delete on it never have to be
  // ordered against each other.
  // Returns the recorded `updatedAt` the client stores and advances its cursor to.
  commitOp(op: OpKind, path: string, updatedAt: number, size: number): { updatedAt: number } {
    const sizes = fileSizesRepo(this.sql);
    if (op === 'put') sizes.set(path, size);
    else sizes.remove(path);
    opLogsRepo(this.sql).append(op, path, updatedAt);
    return { updatedAt };
  }

  // RPC: current storage usage for this user, read by the `files/sign` put-quota
  // check. Sourced from the durable size map, never the compactable op log.
  usage(): FileUsage {
    return fileSizesRepo(this.sql).usage();
  }
}

// Resolve the caller's per-user DO stub. Deterministic: the same userId always
// maps to the same instance, so there is NO shard-assignment table to maintain
// (the win over hand-sharded D1). The DO is created lazily on first access — no
// provisioning step at account creation.
export function userDataStub(env: Bindings, userId: string): DurableObjectStub<UserDataDO> {
  return env.USER_DATA.get(env.USER_DATA.idFromName(userId));
}
