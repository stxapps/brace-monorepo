'use client';

// The LOCAL WRITE EDGE — the mirror of queries.ts's read edge. A UI edit lands
// here first: it writes the decrypted blob into `items` and enqueues a pending op,
// in ONE transaction, then the sync engine drains the queue (encrypt → PUT →
// commit) on the next cycle. This is the "the UI writes the local store, then
// enqueues a pending op" path the db.ts/engine.ts comments describe; nothing else
// in the app wrote `items` before — only the engine did, on the way down.
//
// Two stores in one transaction so a write is atomic: the local store and the
// durable queue can never disagree about whether an edit happened (a crash
// between them would either lose the edit or orphan a queue entry). The engine
// restamps `items.updatedAt` with R2's authoritative time on commit, so the
// local value here is provisional — we keep the pre-edit server stamp as the
// base, which is exactly what reconcile compares against.

import { type List, listSchema, type OpKind, type Pin, pinSchema } from '@stxapps/shared';

import { db } from '@/data/db';
import { enqueueDelete } from '@/data/pending-store';
import { toItemRecord } from '@/data/projection';
import type { WithPath } from '@/data/queries';

const encoder = new TextEncoder();

// Persist one entity locally and queue it for upload. `item` carries its `path`
// (the app-only store key); everything else is the blob to encrypt, so `path` is
// stripped before encoding — it's reconstructed from the namespace on read, never
// stored inside the ciphertext (see entities.ts on reference ids vs. paths).
//
// `baseUpdatedAt` is the path's current server stamp (0 if it has no record yet —
// a fresh create, including the first edit of an untouched system-list default):
// the base reconcile diffs the next pulled stamp against to tell our own echo
// from a real conflict. The local `items.updatedAt` is left at that base until
// the commit restamps it.
async function writeEntity<T extends WithPath<object>>(username: string, item: T): Promise<void> {
  const { path, ...entity } = item;
  const bytes = encoder.encode(JSON.stringify(entity));
  const op: OpKind = 'put';

  await db.transaction('rw', db.items, db.pendingOps, async () => {
    const existing = await db.items.get(path);
    const baseUpdatedAt = existing?.updatedAt ?? 0;
    await db.items.put(toItemRecord(path, baseUpdatedAt, bytes));
    await db.pendingOps.put({ username, path, op, baseUpdatedAt });
  });
}

// Delete one entity by path: drop the local record and queue the server delete in
// the SAME transaction, mirroring writeEntity's atomicity (the store and the
// durable queue can never disagree about whether the delete happened).
// `baseUpdatedAt` is the path's current server stamp — the base the next reconcile
// diffs our own echo against, exactly as on the put path. A path with no local
// record (a never-stored system-list default, an already-gone pin) makes the
// delete a no-op locally and a harmless tombstone upstream. Entity-agnostic so
// every namespace deletes by one definition; callers gate the higher-level rules.
export async function deleteEntity(username: string, path: string): Promise<void> {
  await db.transaction('rw', db.items, db.pendingOps, async () => {
    const existing = await db.items.get(path);
    const baseUpdatedAt = existing?.updatedAt ?? 0;
    await db.items.delete(path);
    await enqueueDelete(username, path, baseUpdatedAt);
  });
}

// Apply a patch to a list and write it. Stamps `updatedAt` now; if this is the
// FIRST edit of an untouched system-list default (`createdAt === 0`, never
// stored), stamps `createdAt` now too so the override blob looks like any other
// created entity. Validated against `listSchema` before the write so a bad patch
// can't poison the store (and TS-narrows the spread back to a List).
export async function writeList(
  username: string,
  list: WithPath<List>,
  patch: Partial<Pick<List, 'name' | 'parentId' | 'rank'>>,
): Promise<void> {
  const now = Date.now();
  const next: WithPath<List> = {
    ...list,
    ...patch,
    createdAt: list.createdAt === 0 ? now : list.createdAt,
    updatedAt: now,
  };
  // Defensive parity with the read edge: the same schema gates both directions.
  // `path` is the store key, not part of the blob — drop it before validating.
  const { path: _path, ...blob } = next;
  if (!listSchema.safeParse(blob).success) {
    throw new Error(`writeList: invalid list ${list.id}`);
  }
  await writeEntity(username, next);
}

// Delete one list. Callers gate the higher-level rules (system lists aren't
// deletable, a non-empty list keeps its links) before reaching here.
export function deleteList(username: string, list: WithPath<List>): Promise<void> {
  return deleteEntity(username, list.path);
}

// Apply a patch to a pin and write it — the put side of pin/reorder. Stamps
// `updatedAt` now and, on first write (`createdAt === 0`), `createdAt` too, so a
// freshly-pinned link's blob looks like any other created entity. Validated
// against `pinSchema` before the write (TS-narrows the spread back to a Pin), the
// same defensive parity writeList has. Only `rank` is ever patched today.
export async function writePin(
  username: string,
  pin: WithPath<Pin>,
  patch: Partial<Pick<Pin, 'rank'>>,
): Promise<void> {
  const now = Date.now();
  const next: WithPath<Pin> = {
    ...pin,
    ...patch,
    createdAt: pin.createdAt === 0 ? now : pin.createdAt,
    updatedAt: now,
  };
  const { path: _path, ...blob } = next;
  if (!pinSchema.safeParse(blob).success) {
    throw new Error(`writePin: invalid pin ${pin.id}`);
  }
  await writeEntity(username, next);
}

// Unpin: delete the pin file at `path`. Unpinning is just removing the marker; the
// link itself is untouched (separate file).
export function deletePin(username: string, path: string): Promise<void> {
  return deleteEntity(username, path);
}
