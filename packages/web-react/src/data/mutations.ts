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

import {
  ENC_SUFFIX,
  type Extraction,
  EXTRACTIONS_PREFIX,
  extractionSchema,
  type Facet,
  FILES_PREFIX,
  type Link,
  linkSchema,
  type List,
  listSchema,
  type OpKind,
  type Pin,
  pinSchema,
  SETTINGS_GENERAL_PATH,
  type SettingsGeneral,
  settingsGeneralSchema,
  type Tag,
  tagSchema,
} from '@stxapps/shared';

import { db } from './db';
import { enqueueDelete } from './pending-store';
import { parseBlob, toItemRecord } from './projection';
import type { WithPath } from './queries';

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

// Apply a patch to a link and write it — create (new `links/{id}.enc`) or edit.
// Stamps `updatedAt` now so the in-blob "date modified" advances on EVERY edit;
// that's what keeps the `[itemType+itemUpdatedAt]` sort indexes (db.ts) and the
// decode cache's version (decode-cache.ts) correct — both ride on `itemUpdatedAt`,
// which the projector derives from this field. On first write (`createdAt === 0`)
// stamps `createdAt` too, so a fresh link looks like any other created entity.
// Validated against `linkSchema` before the write (TS-narrows the spread back to a
// Link), the same defensive parity writeList/writePin have.
export async function writeLink(
  username: string,
  link: WithPath<Link>,
  patch: Partial<
    Pick<
      Link,
      'title' | 'url' | 'tagIds' | 'listId' | 'note' | 'pageArchiveId' | 'imageId' | 'screenshotId'
    >
  >,
): Promise<void> {
  const now = Date.now();
  const next: WithPath<Link> = {
    ...link,
    ...patch,
    createdAt: link.createdAt === 0 ? now : link.createdAt,
    updatedAt: now,
  };
  const { path: _path, ...blob } = next;
  if (!linkSchema.safeParse(blob).success) {
    throw new Error(`writeLink: invalid link ${link.path}`);
  }
  await writeEntity(username, next);
}

// Delete one link: drop its `links/{id}.enc`. Thin like deleteList/deletePin —
// higher-level cleanup (its pin, its `files/` content) is the caller's concern.
export function deleteLink(username: string, link: WithPath<Link>): Promise<void> {
  return deleteEntity(username, link.path);
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

// Apply a patch to a tag and write it — create (new `tags/{id}.enc`) or edit.
// Identical shape to writeList (tags are the same one-file-per-entity tree, just
// without the system-list defaults): stamps `updatedAt` now, stamps `createdAt`
// on first write (`createdAt === 0`), and validates against `tagSchema` before
// the write so a bad patch can't poison the store (TS-narrows the spread back to
// a Tag). `path` is the store key, dropped before validating the blob.
export async function writeTag(
  username: string,
  tag: WithPath<Tag>,
  patch: Partial<Pick<Tag, 'name' | 'parentId' | 'rank'>>,
): Promise<void> {
  const now = Date.now();
  const next: WithPath<Tag> = {
    ...tag,
    ...patch,
    createdAt: tag.createdAt === 0 ? now : tag.createdAt,
    updatedAt: now,
  };
  const { path: _path, ...blob } = next;
  if (!tagSchema.safeParse(blob).success) {
    throw new Error(`writeTag: invalid tag ${tag.id}`);
  }
  await writeEntity(username, next);
}

// Delete one tag: drop its `tags/{id}.enc`. Thin like deleteList — a dangling
// `tagIds` reference left on a link is NORMAL and skipped at read time
// (entities.ts), so there's no link rewrite to do here.
export function deleteTag(username: string, tag: WithPath<Tag>): Promise<void> {
  return deleteEntity(username, tag.path);
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

// Patch the synced general-settings blob (`settings/general.enc`) and write it —
// the SYNCED side of a setting (the "Sync" tab), so it rides the same
// writeEntity → pending-op → R2 path as every other entity. Unlike the others
// this is a single well-known path, not a per-id create, so it READS the current
// blob first and merges: the schema is `looseObject`, so an unknown field a newer
// client wrote (or another general setting) is round-tripped, not stripped (see
// entities.ts). An absent blob starts from `createdAt: 0`, exactly like the first
// edit of an untouched system-list default. Stamps `updatedAt` now (and
// `createdAt` on first write), validates, then writes.
export async function writeSettingsGeneral(
  username: string,
  patch: Partial<Pick<SettingsGeneral, 'linksLayout'>>,
): Promise<void> {
  const now = Date.now();
  const record = await db.items.get(SETTINGS_GENERAL_PATH);
  const current: SettingsGeneral = parseBlob(record?.data, settingsGeneralSchema) ?? {
    createdAt: 0,
    updatedAt: 0,
  };
  const next: WithPath<SettingsGeneral> = {
    ...current,
    ...patch,
    createdAt: current.createdAt === 0 ? now : current.createdAt,
    updatedAt: now,
    path: SETTINGS_GENERAL_PATH,
  };
  const { path: _path, ...blob } = next;
  if (!settingsGeneralSchema.safeParse(blob).success) {
    throw new Error('writeSettingsGeneral: invalid settings');
  }
  await writeEntity(username, next);
}

// One extraction facet name (`titleImage` | `screenshot` | …) — the keys of an
// extraction's `facets` map (entities.ts). The background extraction worker writes
// one of these per capture.
export type ExtractionFacet = keyof Extraction['facets'];

// Read-merge-write a single facet of a link's `extractions/{id}.enc` entity — the
// churny, automated bookkeeping the extraction worker owns (who/when/quality/retry/
// lease per facet, entities.ts). Read-merge-`put` (like writeSettingsGeneral) so a
// facet update keeps the other facets, and `looseObject` round-trips any facet a
// newer client wrote. The DISPLAY result (title/imageId/screenshotId/pageArchiveId)
// is NEVER stored here — that lands on the link via writeLink; this answers only
// "who/when/quality/retry?". `linkId` is the link's id (the `{id}` of its
// `links/{id}.enc`), which is also this entity's id and path id.
export async function writeExtraction(
  username: string,
  linkId: string,
  facet: ExtractionFacet,
  state: Facet,
): Promise<void> {
  const now = Date.now();
  const path = `${EXTRACTIONS_PREFIX}${linkId}${ENC_SUFFIX}`;
  const record = await db.items.get(path);
  const current: Extraction = parseBlob(record?.data, extractionSchema) ?? {
    id: linkId,
    facets: {},
    createdAt: 0,
    updatedAt: 0,
  };
  const next: WithPath<Extraction> = {
    ...current,
    facets: { ...current.facets, [facet]: state },
    createdAt: current.createdAt === 0 ? now : current.createdAt,
    updatedAt: now,
    path,
  };
  const { path: _path, ...blob } = next;
  if (!extractionSchema.safeParse(blob).success) {
    throw new Error(`writeExtraction: invalid extraction ${linkId}`);
  }
  await writeEntity(username, next);
}

// Persist one entity's RAW bytes locally and queue the upload — the bytes path that
// mirrors writeEntity, but WITHOUT the JSON-encode step. `files/{id}.enc` content
// (screenshots, archives, read-mode) is opaque media, not a JSON entity, so it
// stores its bytes verbatim; the sync engine encrypts + PUTs them like any other op.
async function writeBytes(username: string, path: string, bytes: Uint8Array): Promise<void> {
  await db.transaction('rw', db.items, db.pendingOps, async () => {
    const existing = await db.items.get(path);
    const baseUpdatedAt = existing?.updatedAt ?? 0;
    await db.items.put(toItemRecord(path, baseUpdatedAt, bytes));
    await db.pendingOps.put({ username, path, op: 'put', baseUpdatedAt });
  });
}

// Write a `files/{id}.enc` content blob (a captured screenshot/archive/read-mode
// file). Only the lazy content record is created here; the link's reference to it
// (`imageId` / `screenshotId` / `pageArchiveId`) is written separately via writeLink,
// content-before-metadata — the same ordering the sync engine's push phases preserve.
export function writeFile(username: string, fileId: string, data: Uint8Array): Promise<void> {
  return writeBytes(username, `${FILES_PREFIX}${fileId}${ENC_SUFFIX}`, data);
}
