// Read/write helpers over the `items` table and its junction tables — where web
// calls Dexie's `db.items` directly, expo funnels through this store so the
// db.ts invariant has one owner: the junction rows (`item_tag_ids`,
// `item_facet_statuses`) are written in the SAME transaction as their `items`
// row, from the SAME projected record (projection.ts), so the queryable
// projection can never drift from the bytes it was derived from. Deliberately
// tiny and side-effect-light — no network, no React — like its sibling stores
// (pending-store, sync-store).
//
// Reads return the raw nullable row (`ItemRow`); `ItemRecord` (projection.ts,
// undefined-based) is the write-side shape. The engine only ever reads the sync
// fields (`updatedAt`, `data`, `hasDataFile`), so reads don't join the junction
// tables back in — the read layer queries those directly.

import { eq, inArray } from 'drizzle-orm';

import { getDb, itemFacetStatuses, items, itemTagIds } from './db';
import type { ItemRecord } from './projection';

export type ItemRow = typeof items.$inferSelect;

// Keep `IN (...)` lists comfortably under SQLite's bound-variable ceiling; the
// engine's batches (≤1000 paths) split into a couple of chunks.
const IN_BATCH = 500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Full-replace row semantics, like Dexie's `put`: every column is set, so a
// field the record omits is cleared, not kept. `hasDataFile` in particular
// always resets to null here — the projector never sets it (projection.ts), and
// a re-stored content record SHOULD drop its materialization claim (the engine
// deletes the on-disk plaintext in the same breath); loadEntityContent re-marks
// it after it re-materializes.
function toRow(r: ItemRecord): ItemRow {
  return {
    path: r.path,
    updatedAt: r.updatedAt,
    data: r.data ?? null,
    hasDataFile: null,
    itemType: r.itemType ?? null,
    itemCreatedAt: r.itemCreatedAt ?? null,
    itemUpdatedAt: r.itemUpdatedAt ?? null,
    itemListId: r.itemListId ?? null,
    itemUrl: r.itemUrl ?? null,
    itemUrlKey: r.itemUrlKey ?? null,
  };
}

export async function getItem(path: string): Promise<ItemRow | undefined> {
  return getDb().select().from(items).where(eq(items.path, path)).get();
}

// Order-aligned with the input like Dexie's bulkGet: result[i] is paths[i]'s
// row, or undefined if unknown locally.
export async function bulkGetItems(paths: string[]): Promise<(ItemRow | undefined)[]> {
  const byPath = new Map<string, ItemRow>();
  for (const batch of chunk(paths, IN_BATCH)) {
    const rows = getDb().select().from(items).where(inArray(items.path, batch)).all();
    for (const row of rows) byPath.set(row.path, row);
  }
  return paths.map((p) => byPath.get(p));
}

// Upsert projected records — rows plus their junction rows, one transaction
// (the invariant this store exists for). Junctions are replace-then-insert so
// they always mirror the arrays projected from the current bytes; a record
// without arrays simply clears its junction rows.
export async function putItems(records: ItemRecord[]): Promise<void> {
  if (records.length === 0) return;
  getDb().transaction((tx) => {
    for (const record of records) {
      const row = toRow(record);
      tx.insert(items).values(row).onConflictDoUpdate({ target: items.path, set: row }).run();
    }
    for (const paths of chunk(
      records.map((r) => r.path),
      IN_BATCH,
    )) {
      tx.delete(itemTagIds).where(inArray(itemTagIds.path, paths)).run();
      tx.delete(itemFacetStatuses).where(inArray(itemFacetStatuses.path, paths)).run();
    }
    const tagRows = records.flatMap(
      (r) => r.itemTagIds?.map((tagId) => ({ path: r.path, tagId })) ?? [],
    );
    for (const batch of chunk(tagRows, IN_BATCH)) tx.insert(itemTagIds).values(batch).run();
    const facetRows = records.flatMap(
      (r) => r.itemFacetStatuses?.map((token) => ({ path: r.path, token })) ?? [],
    );
    for (const batch of chunk(facetRows, IN_BATCH)) {
      tx.insert(itemFacetStatuses).values(batch).run();
    }
  });
}

export async function putItem(record: ItemRecord): Promise<void> {
  await putItems([record]);
}

// Stamp R2's authoritative `updatedAt` onto a committed path (sync/engine.ts).
// A no-op if the row is gone (a committed delete has no record left to stamp) —
// the same forgiveness as Dexie's `update`.
export async function stampItemUpdatedAt(path: string, updatedAt: number): Promise<void> {
  getDb().update(items).set({ updatedAt }).where(eq(items.path, path)).run();
}

// Flip a `files/` content row's materialization flag (db.ts `has_data_file`) —
// the engine's lazy-load path is the only writer, after the plaintext lands on
// disk. Same row-gone forgiveness as above.
export async function markItemDataFile(path: string, hasDataFile: boolean): Promise<void> {
  getDb().update(items).set({ hasDataFile }).where(eq(items.path, path)).run();
}

// Delete rows and their junction rows, one transaction. The on-disk plaintext of
// `files/` paths is the caller's half (file-store.ts) — rows first, files after,
// so a crash in between leaves only invisible orphan files (clear-data.ts).
export async function deleteItems(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  getDb().transaction((tx) => {
    for (const batch of chunk(paths, IN_BATCH)) {
      tx.delete(items).where(inArray(items.path, batch)).run();
      tx.delete(itemTagIds).where(inArray(itemTagIds.path, batch)).run();
      tx.delete(itemFacetStatuses).where(inArray(itemFacetStatuses.path, batch)).run();
    }
  });
}

// One projection-only pass over the whole table: path → updatedAt with no `data`
// blob deserialized (only the two columns are selected, served by the covering
// `idx_items_updated_at` + rowid). Feeds both reconcile directions of the
// engine's fallback cycle — the expo analogue of web's IndexedDB key-cursor scan.
export async function listItemUpdatedAts(): Promise<Map<string, number>> {
  const rows = getDb().select({ path: items.path, updatedAt: items.updatedAt }).from(items).all();
  return new Map(rows.map((r) => [r.path, r.updatedAt]));
}
