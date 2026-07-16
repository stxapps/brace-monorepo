// The iOS share sheet (docs/share-sheet.md): the best-effort
// encrypt + PUT the extension fires AFTER the outbox write. The outbox stays
// the record of truth — this path may fail at any step (offline, no mirrored
// session, quota-denied sign) and nothing is lost: the main app drains the same
// draft through the real write edge on next open and re-uploads under the same
// ids (idempotent by construction — LWW converges, no duplicate). What the
// upload buys is cross-device/web freshness: another client sees the link
// without waiting for the phone app to be reopened.
//
// Deliberately DB-free: the extension process must never open the app's sqlite
// (share-store's header), so the entities are built from the draft alone and
// pushed straight through the sync contract — encryptEntity (the v1 blob
// frame) → files/sign → PUT → ops/commit, the same three round trips as one
// engine put-chunk, minus the store bookkeeping.
//
// What is NOT uploaded: the draft's NEW TAGS. A tag entity needs a `rank`, and
// rank is computed at apply time against the store's current tag set — exactly
// why it's excluded from the draft (share-store's header); the extension has no
// store to rank against, and a snapshot-derived rank is the collision the
// design rejects. So new tags are created only by the drain; until the phone
// app next opens, other devices see the link without its brand-new tag chips
// (existing tags referenced by id render fine). The link's `tagIds` already
// include the new ids, so nothing needs rewriting when the tags land.

import { encryptEntity } from '@stxapps/expo-crypto';
import {
  type ApiClient,
  cleanTitle,
  type Extraction,
  EXTRACTIONS_PREFIX,
  extractionSchema,
  filesSignEndpoint,
  type Link,
  LINKS_PREFIX,
  linkSchema,
  opsCommitEndpoint,
  pathFromId,
  utf8,
} from '@stxapps/shared';

import { putBlob } from '../sync/r2';
import type { ShareDraft } from './share-store';

// What the upload needs — a slice of the engine's SyncDeps (no username: the
// store-side bookkeeping that needs it doesn't run here; the api's bearer token
// scopes the account server-side).
export interface ShareUploadDeps {
  encryptionKey: Uint8Array;
  api: ApiClient;
}

// One entity ready to encrypt: its R2 path + the pathless plaintext blob.
export interface DraftEntity {
  path: string;
  entity: Link | Extraction;
}

// Build the uploadable entities from a draft — the extension-side twin of
// share-store's applyShareDraft, minus everything that needs the store (new-tag
// ranks, the deleted-list fallback: an uploaded `listId` that no longer exists
// converges when the drain re-writes the link). Pure, so it's spec-able; `now`
// is injected for the same reason. The share-payload title seeds the
// provisional extraction title, never `customTitle` — same rule as the drain.
export function buildDraftEntities(draft: ShareDraft, now: number): DraftEntity[] {
  const link: Link = {
    url: draft.url,
    listId: draft.listId,
    tagIds: draft.tagIds,
    createdAt: now,
    updatedAt: now,
  };
  if (!linkSchema.safeParse(link).success) {
    throw new Error(`buildDraftEntities: invalid link ${draft.id}`);
  }
  const entities: DraftEntity[] = [{ path: pathFromId(draft.id, LINKS_PREFIX), entity: link }];

  const title = cleanTitle(draft.title);
  if (title !== undefined) {
    const extraction: Extraction = {
      id: draft.id,
      title,
      facets: {},
      createdAt: now,
      updatedAt: now,
    };
    if (!extractionSchema.safeParse(extraction).success) {
      throw new Error(`buildDraftEntities: invalid extraction ${draft.id}`);
    }
    entities.push({ path: pathFromId(draft.id, EXTRACTIONS_PREFIX), entity: extraction });
  }

  return entities;
}

// Encrypt and push one draft's entities: sign → PUT → commit, all-or-throw (a
// missing signed URL — e.g. quota-denied — fails the whole upload rather than
// committing a partial entity set; the drain retries through the real edge,
// where quota surfaces properly). No retry wrapper: the extension process
// lives ~a second past the ✓, so a backed-off retry would mostly outlive it —
// the durable fallback IS the retry.
export async function uploadShareDraft(deps: ShareUploadDeps, draft: ShareDraft): Promise<void> {
  const entities = buildDraftEntities(draft, Date.now());
  const blobs = await Promise.all(
    entities.map(async ({ path, entity }) => ({
      path,
      blob: await encryptEntity(deps.encryptionKey, utf8(JSON.stringify(entity))),
    })),
  );

  const paths = blobs.map((b) => b.path);
  const { urls } = await deps.api.call(filesSignEndpoint, { op: 'put', paths });
  const urlByPath = new Map(urls.map((u) => [u.path, u.url]));
  for (const { path, blob } of blobs) {
    const url = urlByPath.get(path);
    if (!url) throw new Error(`uploadShareDraft: no signed URL for ${path}`);
    await putBlob(url, blob);
  }

  await deps.api.call(opsCommitEndpoint, {
    ops: paths.map((path) => ({ op: 'put' as const, path })),
  });
}
