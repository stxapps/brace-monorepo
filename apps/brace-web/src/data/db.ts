'use client';

// Client-only local store — the source of truth the UI reads from (see
// docs/local-first-sync.md "layer 1"). Dexie over IndexedDB, with `liveQuery`
// for reactive reads, is the doc's preferred default. Holds DECRYPTED data: the
// sync engine decrypts blobs with @stxapps/web-crypto before they land here, and
// the network layer never sees plaintext.
//
// Kept in a SEPARATE database ('brace-data') from the raw-IDB session store
// (DB 'brace' in session-store.ts). The session DB holds auth/key material and
// is hand-rolled; Dexie wants to own its own schema/versioning, so the two don't
// share a database. Mirrors the auth≠sync split: auth state lives in one place,
// synced user data in another.

import Dexie, { type EntityTable } from 'dexie';

// One bookmark, decrypted, as the UI consumes it. The full shape is still TBD —
// the sync engine that populates this (encrypt-before-PUT / decrypt-after-GET)
// isn't built yet — so this is the minimal index the cursor/LWW logic needs.
// `id` is the per-file path key (one bookmark per file, per docs); `updatedAt`
// drives last-writer-wins. Widen this as the bookmark model firms up.
export interface LinkRecord {
  id: string;
  updatedAt: number;
}

// Per-account sync bookkeeping. The presence of a row with `firstSyncDoneAt > 0`
// is the gate that lets the app render local data instead of blocking on a full
// pull, and it's the ONLY way to tell "synced, zero links" apart from "never
// synced" — without it, an empty local store is ambiguous. `lastSeq` is the
// op-log cursor (mirrors the server's monotonic `seq`; see
// apps/brace-api/.../op-logs.ts `listSince`).
export interface SyncMetaRecord {
  // Scope key — one row per signed-in account on this device.
  username: string;
  // Highest op-log `seq` applied to the local store. The incremental pull asks
  // the server for ops after this.
  lastSeq: number;
  // Epoch ms the first full sync COMPLETED, or 0 while it hasn't. The invariant:
  // > 0 means "the local store is a complete, consistent snapshot up to lastSeq."
  firstSyncDoneAt: number;
}

// TODO: rename to something more explicit?
//   the file name should be *-store.ts too?
class BraceDb extends Dexie {
  links!: EntityTable<LinkRecord, 'id'>;
  syncMeta!: EntityTable<SyncMetaRecord, 'username'>;

  constructor() {
    super('brace-data');
    this.version(1).stores({
      // `id` primary key + `updatedAt` index for ordered/recent reads.
      links: 'id, updatedAt',
      // `username` primary key — one bookkeeping row per account.
      syncMeta: 'username',
    });
  }
}

// Single app-lifetime instance. Dexie opens lazily on first operation, so merely
// importing this on the server (where there's no IndexedDB) is inert — only the
// awaited reads/writes below touch IDB, and those run in client effects.
export const db = new BraceDb();
