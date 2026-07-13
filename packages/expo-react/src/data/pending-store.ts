// Read/write helpers over the pending-ops queue — the expo sibling of
// web-react's data/pending-store.ts, same API (see there for the queue's full
// semantics: the UI enqueues right after writing the local store, the sync
// engine drains, removal only on a commit's `results`). Kept tiny and
// side-effect-light — no network, no React — so the queue has one owner,
// mirroring sync-store's ownership of the bookkeeping row.

import { and, eq, inArray } from 'drizzle-orm';

import { type DbTx, getDb, pendingOps } from './db';

// Same shape as web-react's PendingOpRecord (every column NOT NULL, so the
// drizzle-inferred row already matches it exactly).
export type PendingOpRecord = typeof pendingOps.$inferSelect;

// The upsert: the composite (username, path) key makes a re-edit before the
// drain collapse to one op (local last-writer-wins), and a pending put can flip
// to delete in place. Takes the transaction handle so it rides the caller's
// transaction — unlike web-react's ambient (zone-scoped) Dexie transactions,
// expo-sqlite/drizzle has no ambient tx, so a write only participates in the
// caller's transaction if it goes through that tx handle. This is why there is
// NO non-tx enqueue: every enqueue is paired with a local-store put in ONE
// transaction (mutations.ts), so a bare getDb() insert would silently write the
// queue outside that atomicity.
function enqueue(tx: DbTx, record: PendingOpRecord): void {
  tx.insert(pendingOps)
    .values(record)
    .onConflictDoUpdate({ target: [pendingOps.username, pendingOps.path], set: record })
    .run();
}

// Queue a create/edit for `path`, in the caller's transaction — for the write
// edge (mutations.ts), which must enqueue in the SAME transaction as the
// local-store put so the store and the durable queue can never disagree about
// whether an edit happened. `baseUpdatedAt` is the path's stored server
// timestamp at edit time (0 for a brand-new file) — the base reconcile compares
// against.
export function enqueuePutTx(
  tx: DbTx,
  username: string,
  path: string,
  baseUpdatedAt: number,
): void {
  enqueue(tx, { username, path, op: 'put', baseUpdatedAt });
}

// Queue a delete for `path`, in the caller's transaction — the delete-edge
// sibling of enqueuePutTx (mutations.ts's future deleteEntity port). The UI
// drops the local record in the SAME transaction; this only records the intent
// to delete the server object on the next drain. `baseUpdatedAt` is the path's
// stored server timestamp, the reconcile base exactly as on the put path.
export function enqueueDeleteTx(
  tx: DbTx,
  username: string,
  path: string,
  baseUpdatedAt: number,
): void {
  enqueue(tx, { username, path, op: 'delete', baseUpdatedAt });
}

// The full queue for an account, in no particular order — the engine imposes its
// own meta-last ordering at push time, so insertion order doesn't matter here.
export async function listPendingOps(username: string): Promise<PendingOpRecord[]> {
  return getDb().select().from(pendingOps).where(eq(pendingOps.username, username)).all();
}

// Drop the given paths from an account's queue — called after a commit returns
// them in `results` (a path left out, e.g. a `no_object` failure, stays queued
// for the next drain).
export async function clearPendingPaths(username: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  getDb()
    .delete(pendingOps)
    .where(and(eq(pendingOps.username, username), inArray(pendingOps.path, paths)))
    .run();
}

// Drop an account's WHOLE queue — the delete-all-data flow, which abandons
// every unsynced local change on purpose (the user is deleting everything, so
// pushing them first would be wasted work the wipe immediately undoes).
export async function clearPendingOps(username: string): Promise<void> {
  getDb().delete(pendingOps).where(eq(pendingOps.username, username)).run();
}
