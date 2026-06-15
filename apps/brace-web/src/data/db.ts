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
  syncCursorUpdatedAt: number;
  // Path tiebreak for the compound `(updatedAt, path)` cursor — the path of the
  // last op consumed at `syncCursorUpdatedAt`. Several files can share a
  // millisecond, so without it a single ms holding more ops than one page could
  // never be paged past. Empty only for a seeded new account (nothing pulled
  // yet); the server treats a missing `sincePath` as the low sentinel (so the
  // next pull includes every op at that ms).
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
// - `path` is the FULL relative path (`meta/m_abc.enc`) AND the primary key — the
//   same key the op log, pending queue, and R2 use, so reconcile can compare a
//   server op to a local record directly (there is no separate id; the path IS
//   the id). Named `path`, not `id`, to match every other layer and to avoid
//   colliding with the entities' own logical `id` field (lists/tags carry one
//   inside the blob — see entities.ts).
// - `updatedAt` is the per-path R2 `LastModified` (epoch ms) the server stamped;
//   it drives last-writer-wins and is the value compared in both incremental
//   apply and the fallback listing — never Dexie's local write time.
// - `data` is the decrypted blob bytes (the sync engine decrypts with
//   @stxapps/web-crypto before it lands here; plaintext never crosses the
//   network). Absent for a `files/` content record that's been seen but not yet
//   lazily downloaded — only its `updatedAt` is known.
//
// The `item*` columns are the QUERY PROJECTION: the few list-view fields lifted
// out of the decrypted `data` blob so IndexedDB can index them. Without them a
// view like "newest 30 links in this list" would have to read+JSON.parse every
// `meta/` blob into memory and sort there — O(library) on every reactive tick. A
// compound index over these columns turns it into a keyset walk that materializes
// only the page shown. They're DERIVED, not authoritative: `data` is the source
// of truth, and every column here is computed FROM it by the single projector
// (data/projection.ts `toItemRecord`) that every write site must funnel through —
// so the index can never drift from the bytes it indexes (no second table, no
// cross-table transaction; the column is written in the same `put` as `data`).
// All are sparse: a record gets a key only where the field applies (a `files/`
// content record has none; only `meta/` links carry `itemListId`/`itemTagIds`),
// and IndexedDB simply omits keyless records from that index — exactly the
// per-type filtering we want.
export type ItemType = 'meta' | 'list' | 'tag' | 'settings' | 'files';

export interface ItemRecord {
  path: string;
  updatedAt: number;
  data?: Uint8Array;
  // Namespace of `id`'s prefix — the discriminator a single-type ordered query
  // ranges on (`[itemType+itemUpdatedAt]`); a path prefix can't feed a compound
  // index, so it's stored as its own column.
  itemType?: ItemType;
  // The USER-MEANINGFUL timestamps from inside the blob (entities.ts) — distinct
  // from the R2-`LastModified` `updatedAt` above that drives sync. These are the
  // display sort keys.
  itemCreatedAt?: number;
  itemUpdatedAt?: number;
  // Links only: the ids the link references — `link.listId` and `link.tagIds` (the
  // `{id}` of `lists/{id}.enc` / `tags/{id}.enc`, or a system-list constant).
  // Indexed so a list view filters+orders in one index range, and a tag view
  // finds membership via the multiEntry index. Ids, never names: a list/tag can
  // be renamed, but its id is stable, and that's what a link stores.
  itemListId?: string;
  itemTagIds?: string[];
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
// two ops for the same file.
export interface PendingOpRecord {
  // Whose queue. NOT live multi-account support: sign-out wipes ALL tables
  // (sync-store's clearSyncData — decrypted data doesn't outlive the session), and
  // `items` isn't account-scoped at all, so only one account's data is ever
  // resident. The scoping is (a) schema future-proofing — adding a key column
  // later means a copy-everything IDB migration on users' devices — and (b)
  // race-safety: a stale sync run for a prior account can't drain its queue into
  // the next account's session.
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
  items!: EntityTable<ItemRecord, 'path'>;
  pendingOps!: Table<PendingOpRecord, [string, string]>;

  constructor() {
    super('brace-data');
    this.version(1).stores({
      // `username` primary key — one bookkeeping row per account.
      syncMeta: 'username',
      // `path` primary key + `updatedAt` index (the engine's R2-clock reconcile
      // scan). The rest serve the read layer's link views, all sparse (only
      // records with the keyed field appear). The two ordering fields
      // (itemUpdatedAt = date modified, itemCreatedAt = date added) each pair with
      // the same two compound indexes, so a view can sort either way:
      //   [itemType+item{Updated,Created}At]   — one type, ordered (the "all links"
      //                                          view): range the type, reverse.
      //   [itemListId+item{Updated,Created}At] — one list, ordered: range the list id.
      //   *itemTagIds (multiEntry)             — links carrying a given tag id
      //                                          (membership; multiEntry can't
      //                                          compound, so the tag view sorts its
      //                                          matched subset in JS).
      items:
        'path, updatedAt, [itemType+itemUpdatedAt], [itemType+itemCreatedAt], ' +
        '[itemListId+itemUpdatedAt], [itemListId+itemCreatedAt], *itemTagIds',
      // pending-ops queue. Compound `[username+path]` primary key gives
      // the one-row-per-(account,path) upsert above; the `username` index scopes a
      // drain to the active account. Unlisted stores (syncMeta, items) carry forward.
      pendingOps: '[username+path], username',
    });
  }
}

// Single app-lifetime instance. Dexie opens lazily on first operation, so merely
// importing this on the server (where there's no IndexedDB) is inert — only the
// awaited reads/writes below touch IDB, and those run in client effects.
export const db = new BraceDb();
