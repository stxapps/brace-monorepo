'use client';

// Read/write helpers over the pending-ops queue (see db.ts `PendingOpRecord`). The UI
// enqueues here right after writing the local store; the sync engine drains here.
// Kept tiny and side-effect-light — no network, no React — so the queue has one
// owner, mirroring sync-store's ownership of the bookkeeping row.

import { db, type PendingOpRecord } from './db';

export type { PendingOpRecord } from './db';

// Queue a create/edit for `path`. `baseUpdatedAt` is the path's stored server
// timestamp at edit time (0 for a brand-new file) — the base reconcile compares
// against. `put` replaces any existing entry for the same (account, path), so a
// re-edit before the drain collapses to one op (local last-writer-wins).
export function enqueuePut(
  username: string,
  path: string,
  baseUpdatedAt: number,
): Promise<[string, string]> {
  return db.pendingOps.put({ username, path, op: 'put', baseUpdatedAt });
}

// Queue a delete for `path`. The UI removes the local record itself; this only
// records the intent to delete the server object on the next drain. Overwrites a
// pending put for the same path (flip put→delete in place).
export function enqueueDelete(
  username: string,
  path: string,
  baseUpdatedAt: number,
): Promise<[string, string]> {
  return db.pendingOps.put({ username, path, op: 'delete', baseUpdatedAt });
}

// The full queue for an account, in no particular order — the engine imposes its
// own meta-last ordering at push time, so insertion order doesn't matter here.
export function listPendingOps(username: string): Promise<PendingOpRecord[]> {
  return db.pendingOps.where('username').equals(username).toArray();
}

// Drop the given paths from an account's queue — called after a commit returns
// them in `results` (a path left out, e.g. a `no_object` failure, stays queued
// for the next drain).
export async function clearPendingPaths(username: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await db.pendingOps.bulkDelete(paths.map((path) => [username, path] as [string, string]));
}
