'use client';

// Client-only local store — the source of truth the UI reads from (see
// docs/local-first-sync.md "layer 1"). Dexie over IndexedDB, with `liveQuery`
// for reactive reads, is the doc's preferred default. Holds DECRYPTED data: the
// sync engine decrypts blobs with @stxapps/web-crypto before they land here, and
// the network layer never sees plaintext.
//
// Kept in a SEPARATE database ('brace-data') from the raw-IDB session store
// ('brace-session' in session-store.ts). The session DB holds auth/key material and
// is hand-rolled; Dexie wants to own its own schema/versioning, so the two don't
// share a database. Mirrors the auth≠sync split: auth state lives in one place,
// synced user data in another.
//
// Within THIS database, `syncMeta` and `items` share one Dexie instance on
// purpose: the gate invariant ties the cursor (syncMeta) to the items snapshot,
// so they must stay consistent — one database keeps a cross-store atomic
// transaction possible (IndexedDB transactions can't span databases).

import Dexie, { type EntityTable, type Table } from 'dexie';

import type { OpKind } from '@stxapps/shared';

// Per-account sync bookkeeping. The presence of a row with `firstSyncDoneAt > 0`
// is the gate that lets the app render local data instead of blocking on a full
// pull, and it's the ONLY way to tell "synced, zero items" apart from "never
// synced" — without it, an empty local store is ambiguous.
//
// The cursor is a TIMESTAMP, not a seq. Per docs/local-first-sync.md the wire
// cursor is the compound key `(updatedAt, path)` — R2's `LastModified` (epoch ms)
// plus a path tiebreak — never the op log's `seq`. `seq` stays internal to the DO:
// it can't be reconstructed from an R2 listing, so a DO rebuild or fallback would
// have no seq to resume from, whereas the newest `LastModified` in a listing
// always IS the cursor. The two halves map directly to the `ops/list` query
// params `since` + `sincePath` (see @stxapps/shared sync/endpoints.ts).
export interface SyncMetaRecord {
  // Scope key — one row per signed-in account on this device.
  username: string;
  // High-water mark: the newest R2 `LastModified` (epoch ms) reconciled into the
  // local store. The incremental pull asks the server for ops AFTER this; 0 until
  // the first sync completes.
  syncCursor: number;
  // Path tiebreak for the compound `(updatedAt, path)` cursor — the path of the
  // last op consumed at `syncCursor`. Several files can share a millisecond, so
  // without it a single ms holding more ops than one page could never be paged
  // past. Empty right after first sync: that cursor is a bare newest-`updatedAt`
  // with no tiebreak yet, and the server treats a missing `sincePath` as the low
  // sentinel (so the next pull includes every op at that ms).
  syncCursorPath: string;
  // Epoch ms the first full sync COMPLETED, or 0 while it hasn't. The invariant:
  // > 0 means "the local store is a complete, consistent snapshot up to the
  // cursor."
  firstSyncDoneAt: number;
}

// One decrypted entity, keyed by its per-file path — the generic local store the
// sync engine writes into (one entity per file, per docs/local-first-sync.md
// "data model"). Every namespace flows through here identically: `meta/{id}.enc`
// (the always-resident bookmark index), `tags/{id}.enc`, `lists/{id}.enc`,
// `settings/<concern>.enc`, and lazily-fetched `files/{id}.enc` content.
//
// "Item" (not "entity" — that reads like a server-side D1 row — and not "file"
// — that's the `files/` namespace specifically) is the established name for this
// one-table-of-every-type store in E2E sync systems (Standard Notes, Joplin).
//
// - `id` is the FULL relative path (`meta/m_abc.enc`), the same key the op log,
//   pending queue, and R2 use — so reconcile can compare a server op to a local
//   record without any id↔path mapping.
// - `updatedAt` is the per-path R2 `LastModified` (epoch ms) the server stamped;
//   it drives last-writer-wins and is the value compared in both incremental
//   apply and the fallback listing — never Dexie's local write time.
// - `data` is the decrypted blob bytes (the sync engine decrypts with
//   @stxapps/web-crypto before it lands here; plaintext never crosses the
//   network). Absent for a `files/` content record that's been seen but not yet
//   lazily downloaded — only its `updatedAt` is known. Parsing these bytes into a
//   typed bookmark/tag/list is layered on top later; the sync path stays
//   payload-agnostic.
export interface ItemRecord {
  id: string;
  updatedAt: number;
  data?: Uint8Array;
}

// One local mutation not yet committed to the server — the durable pending-ops
// queue (docs "layer 1" + "the three flows: push"). Enqueued by the UI right
// after it writes the local store, drained by the sync engine, and removed only
// once the path comes back in a commit's `results` — which is what makes offline
// writes durable and gives crash recovery for free (a process that dies between
// the R2 PUT and the commit finds the entry still here on restart).
//
// One row per (account, path): re-editing a path before the queue drains
// overwrites the prior entry (local last-writer-wins), so the queue never holds
// two ops for the same file. `username` scopes it for multi-account devices.
export interface PendingOp {
  // Whose queue — one device can hold several accounts' data.
  username: string;
  // The targeted entity's full relative path (matches an ItemRecord `id`).
  path: string;
  // `put` (created/edited) or `delete`. A re-edit can flip put→delete in place.
  op: OpKind;
  // The path's stored server `updatedAt` at edit time — the BASE the edit started
  // from. Reconcile compares the pulled server `updatedAt` to this to tell a clean
  // fast-forward (server == base, often our own echo) from a true conflict
  // (server > base: both sides moved since the base). 0 for a fresh create.
  baseUpdatedAt: number;
}

class BraceDb extends Dexie {
  syncMeta!: EntityTable<SyncMetaRecord, 'username'>;
  items!: EntityTable<ItemRecord, 'id'>;
  pendingOps!: Table<PendingOp, [string, string]>;

  constructor() {
    super('brace-data');
    this.version(1).stores({
      // `username` primary key — one bookkeeping row per account.
      syncMeta: 'username',
      // `id` primary key + `updatedAt` index for ordered/recent reads.
      items: 'id, updatedAt',
    });
    // v2 adds the pending-ops queue. Compound `[username+path]` primary key gives
    // the one-row-per-(account,path) upsert above; the `username` index scopes a
    // drain to the active account. Unlisted stores (syncMeta, items) carry forward.
    this.version(2).stores({
      pendingOps: '[username+path], username',
    });
  }
}

// Single app-lifetime instance. Dexie opens lazily on first operation, so merely
// importing this on the server (where there's no IndexedDB) is inert — only the
// awaited reads/writes below touch IDB, and those run in client effects.
export const db = new BraceDb();
