// The LOCAL WRITE EDGE — the expo sibling of web-react's data/mutations.ts
// (that file is the canonical doc for the semantics: a UI edit writes the
// decrypted blob into `items` AND enqueues a pending op in ONE transaction,
// then the sync engine drains the queue — encrypt → PUT → commit — on the next
// cycle). Platform divergences only here:
//
//  - The transaction is drizzle/expo-sqlite's (db.ts `DbTx`), composed from the
//    tx-taking store helpers: item-store's putItemsTx keeps the row+junction
//    invariant, pending-store's enqueuePutTx rides the same tx — so the store
//    and the durable queue can never disagree about whether an edit happened,
//    exactly like web's Dexie multi-table 'rw' transaction.
//  - expo-sqlite serializes writes on the single connection and the read-merge
//    (`produce(existing)`) runs inside the transaction, so the lost-update
//    window web closes with IndexedDB's rw-lock is closed the same way here.
//
// Ported so far: the shared primitives plus writeLink / writeList / writeTag /
// writeExtraction (what the share sheet needs — docs/share-sheet.md) and
// writePin + the deletes (deleteLink / deletePin / deleteExtraction /
// deleteFile — what bulk edit's pin/unpin, remove, and destroy need). One
// platform divergence on deleteFile: web's decrypted content bytes live in the
// Dexie record itself, so dropping the record IS the delete; here they live on
// disk (file-store.ts), so the row delete is followed by deleteDataFile — rows
// first, files after, the same crash-safe order clear-data uses. The remaining
// siblings (writeSettingsGeneral, deleteList, deleteTag, bulkWriteEntities)
// arrive verbatim with the features that need them.

import { eq } from 'drizzle-orm';

import {
  type Extraction,
  EXTRACTIONS_PREFIX,
  extractionSchema,
  type Facet,
  FILES_PREFIX,
  type Link,
  linkSchema,
  type List,
  listSchema,
  pathFromId,
  type Pin,
  PINS_PREFIX,
  pinSchema,
  type Tag,
  tagSchema,
  utf8,
  type WithPath,
} from '@stxapps/shared';

import { type DbTx, getDb, items } from './db';
import { deleteDataFile } from './file-store';
import { deleteItemsTx, type ItemRow, putItemsTx } from './item-store';
import { enqueueDeleteTx, enqueuePutTx } from './pending-store';
import { parseBlob, toItemRecord } from './projection';

// Persist one path's bytes locally and queue the upload, producing the bytes
// INSIDE the transaction from the path's current row — the base primitive every
// entity write shares (see web-react mutations.ts for the full rationale:
// `baseUpdatedAt` is the path's current server stamp, 0 for a fresh create; the
// engine restamps on commit).
function writeBytesWith(
  username: string,
  path: string,
  produce: (existing: ItemRow | undefined) => Uint8Array,
): void {
  getDb().transaction((tx: DbTx) => {
    const existing = tx.select().from(items).where(eq(items.path, path)).get();
    const baseUpdatedAt = existing?.updatedAt ?? 0;
    const bytes = produce(existing);
    putItemsTx(tx, [toItemRecord(path, baseUpdatedAt, bytes)]);
    enqueuePutTx(tx, username, path, baseUpdatedAt);
  });
}

// The merging JSON layer over writeBytesWith — produce the PATHLESS entity blob
// from the current row, encode, put (web's writeEntityWith). `path` is the
// store key, never inside the ciphertext (shared entities.ts).
function writeEntityWith<T extends object>(
  username: string,
  path: string,
  produce: (existing: ItemRow | undefined) => T,
): void {
  writeBytesWith(username, path, (existing) => utf8(JSON.stringify(produce(existing))));
}

// Persist one entity locally and queue it for upload — the non-merging JSON
// path (web's writeEntity): strip the app-only `path`, encode, write.
function writeEntity<T extends WithPath<object>>(username: string, item: T): void {
  const { path, ...entity } = item;
  writeEntityWith(username, path, () => entity);
}

// Delete one entity by path: drop the local row (with its junction rows —
// deleteItemsTx keeps the db.ts invariant) and queue the server delete in the
// SAME transaction, mirroring writeBytesWith's atomicity (web's deleteEntity;
// see there for the full semantics: `baseUpdatedAt` is the reconcile base, a
// path with no local row is a local no-op + harmless tombstone upstream).
// Entity-agnostic; the named per-namespace deletes below are the public
// surface, and callers gate the higher-level rules.
function deleteEntity(username: string, path: string): void {
  getDb().transaction((tx: DbTx) => {
    const existing = tx.select().from(items).where(eq(items.path, path)).get();
    const baseUpdatedAt = existing?.updatedAt ?? 0;
    deleteItemsTx(tx, [path]);
    enqueueDeleteTx(tx, username, path, baseUpdatedAt);
  });
}

// The user-authored fields a link edit may touch — see web-react mutations.ts
// (the extracted display fields live in `extractions/{id}.enc`, never here).
export type LinkPatch = Partial<
  Pick<Link, 'url' | 'tagIds' | 'listId' | 'note' | 'customTitle' | 'customImageId'>
>;

// Apply a patch to a link and write it — create (new `links/{id}.enc`) or edit.
// Same body as web's writeLink: stamps `updatedAt` now (and `createdAt` on
// first write), validates against `linkSchema` before the write.
export async function writeLink(
  username: string,
  link: WithPath<Link>,
  patch: LinkPatch,
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
  writeEntity(username, next);
}

// Delete one link: drop its `links/{id}.enc`. Thin like web's — higher-level
// cleanup (its pin, its extraction, its `files/` content) is the caller's
// concern (use-link-mutations.destroy).
export async function deleteLink(username: string, link: WithPath<Link>): Promise<void> {
  deleteEntity(username, link.path);
}

// Apply a patch to a list and write it — create (new `lists/{id}.enc`) or edit.
// Same body as web's writeList, including the first-edit-of-a-system-default
// stamp (`createdAt === 0` → now).
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
  const { path: _path, ...blob } = next;
  if (!listSchema.safeParse(blob).success) {
    throw new Error(`writeList: invalid list ${list.id}`);
  }
  writeEntity(username, next);
}

// Apply a patch to a tag and write it — create (new `tags/{id}.enc`) or edit.
// Same body as web's writeTag.
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
  writeEntity(username, next);
}

// Apply a patch to a pin and write it — the put side of pin/reorder. Same body
// as web's writePin (only `rank` is ever patched today).
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
  writeEntity(username, next);
}

// Unpin: delete the link's `pins/{id}.enc` marker. Keyed by the link's id (a
// pin shadows its link — shared entities.ts), like web's deletePin, so callers
// never build the path themselves. The link itself is untouched.
export async function deletePin(username: string, linkId: string): Promise<void> {
  deleteEntity(username, pathFromId(linkId, PINS_PREFIX));
}

// One extraction facet name / the machine-written display fields / one
// write-back's payload — web-react mutations.ts's types, verbatim.
export type ExtractionFacet = keyof Extraction['facets'];
export type ExtractionFields = Partial<
  Pick<Extraction, 'title' | 'imageId' | 'pageCopyId' | 'screenshotId'>
>;
export interface ExtractionPatch {
  fields?: ExtractionFields;
  facet?: ExtractionFacet;
  state?: Facet;
}

// Read-merge-write one link's `extractions/{id}.enc` — the MACHINE half of a
// link. Same body as web's writeExtraction, including the writer-owned
// `attempts` derivation on a `failed` write (see there for the full rationale);
// the read-merge shares the put's transaction, so the count is exact.
export async function writeExtraction(
  username: string,
  linkId: string,
  patch: ExtractionPatch,
): Promise<void> {
  const now = Date.now();
  const path = pathFromId(linkId, EXTRACTIONS_PREFIX);
  writeEntityWith(username, path, (existing) => {
    const current: Extraction = parseBlob(existing?.data ?? undefined, extractionSchema) ?? {
      id: linkId,
      facets: {},
      createdAt: 0,
      updatedAt: 0,
    };
    const facets =
      patch.facet && patch.state
        ? {
            ...current.facets,
            [patch.facet]:
              patch.state.status === 'failed'
                ? { ...patch.state, attempts: (current.facets[patch.facet]?.attempts ?? 0) + 1 }
                : patch.state,
          }
        : current.facets;
    const next: Extraction = {
      ...current,
      ...patch.fields,
      facets,
      createdAt: current.createdAt === 0 ? now : current.createdAt,
      updatedAt: now,
    };
    if (!extractionSchema.safeParse(next).success) {
      throw new Error(`writeExtraction: invalid extraction ${linkId}`);
    }
    return next;
  });
}

// Delete one link's `extractions/{id}.enc` — the machine half's counterpart of
// deleteLink, keyed by the link's id like writeExtraction. The `files/` blobs
// the extraction references are the caller's concern (same split as
// deleteLink's header).
export async function deleteExtraction(username: string, linkId: string): Promise<void> {
  deleteEntity(username, pathFromId(linkId, EXTRACTIONS_PREFIX));
}

// Delete a `files/{id}.enc` content blob — web's deleteFile, plus the expo
// half: the decrypted bytes live ON DISK here (file-store.ts), not in the row,
// so the row delete is followed by the plaintext file's — rows first, files
// after, so a crash in between leaves only an invisible orphan file
// (clear-data's order). Metadata-before-content on the way down: callers drop
// the reference (via writeLink/writeExtraction) before or with this; a
// briefly-dangling ref reads as "no bytes" (readFileBytes → undefined).
export async function deleteFile(username: string, fileId: string): Promise<void> {
  const path = pathFromId(fileId, FILES_PREFIX);
  deleteEntity(username, path);
  deleteDataFile(path);
}
