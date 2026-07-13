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
// Ported so far: the shared primitives plus writeLink / writeTag /
// writeExtraction — what the share sheet needs (docs/share-sheet.md). The
// remaining siblings (writeList, writePin, writeSettingsGeneral, the deletes,
// bulkWriteEntities) arrive verbatim with the features that need them.

import { eq } from 'drizzle-orm';

import {
  type Extraction,
  EXTRACTIONS_PREFIX,
  extractionSchema,
  type Facet,
  type Link,
  linkSchema,
  pathFromId,
  type Tag,
  tagSchema,
  utf8,
} from '@stxapps/shared';

import { type DbTx, getDb, items } from './db';
import { type ItemRow, putItemsTx } from './item-store';
import { enqueuePutTx } from './pending-store';
import { parseBlob, toItemRecord } from './projection';

// A decoded entity + its `items` path — web-react defines this in queries.ts
// (the read edge); until expo grows its read edge, the write edge owns it.
export type WithPath<T extends object> = T & { path: string };

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

// One extraction facet name / the machine-written display fields / one
// write-back's payload — web-react mutations.ts's types, verbatim.
export type ExtractionFacet = keyof Extraction['facets'];
export type ExtractionFields = Partial<
  Pick<Extraction, 'title' | 'imageId' | 'pageArchiveId' | 'screenshotId'>
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
