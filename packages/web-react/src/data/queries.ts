'use client';

// The typed read layer over the `items` store (db.ts): turns the sync engine's
// payload-agnostic blobs into typed entities for the UI, and runs the link
// library's queries. Shares `parseBlob` with the write-edge projector
// (projection.ts), so a record decodes by identical rules wherever it's read.
//
// Lives in `src/data/` (not the links route) because it's not links-specific —
// settings reads lists/tags here too. It depends on NOTHING in `app/`: a query
// is described by the plain `LinkQuery` below, and the links route maps its URL
// onto that (page-provider `parseLinkQuery`), so the dependency points
// route → data, never the reverse.

import Dexie from 'dexie';
import type { z } from 'zod';

import type { Extraction, Facet, Link, List, Pin, SettingsGeneral, Tag } from '@stxapps/shared';
import {
  backoff,
  compareRank,
  EXTRACTIONS_PREFIX,
  extractionSchema,
  FILES_PREFIX,
  idFromPath,
  LINKS_PREFIX,
  linkSchema,
  LISTS_PREFIX,
  listSchema,
  pathFromId,
  PINS_PREFIX,
  pinSchema,
  SETTINGS_GENERAL_PATH,
  settingsGeneralSchema,
  SYSTEM_LIST_DEFAULTS,
  SYSTEM_LIST_IDS,
  TAGS_PREFIX,
  tagSchema,
} from '@stxapps/shared';

import { db, type ItemRecord } from './db';
import {
  dropCachedExtraction,
  dropCachedLink,
  getCachedExtraction,
  getCachedLink,
  setCachedExtraction,
  setCachedLink,
} from './decode-cache';
import { parseBlob } from './projection';

// A parsed entity always carries its source `items` path — the stable id every
// other layer (op log, pending queue, R2) keys by, and what the UI needs to
// select/edit/delete a row without a second lookup.
export type WithPath<T> = T & { path: string };
export type LinkItem = WithPath<Link>;
export type ListItem = WithPath<List>;
export type TagItem = WithPath<Tag>;
export type PinItem = WithPath<Pin>;
export type ExtractionItem = WithPath<Extraction>;

// A link row resolved for DISPLAY: the user-authored link joined with its
// machine-derived `extractions/{id}.enc` (the writer-split — docs/link-extraction.md).
// The UI reads these resolved fields. `title`/`imageId` apply the override-wins rule
// (`customTitle ?? extraction.title`, `customImageId ?? extraction.imageId`); the heavy
// refs come straight from the extraction. A link with no extraction yet resolves
// `title`/`imageId` to `customTitle`/`customImageId` (or `undefined` → the view falls
// back to the URL host).
export type LinkView = LinkItem & {
  title?: string;
  imageId?: string;
  pageArchiveId?: string;
  screenshotId?: string;
};

// --- the query grammar -------------------------------------------------------

// One filter clause over a multi-valued or text field. Three relations, ANDed
// together, each ignored when empty:
//   any  — match if the field has/contains ANY of these (OR / include-any)
//   all  — match if it has/contains ALL of these (AND / include-all)
//   none — match if it has/contains NONE of these (NOT / exclude)
// For tags `any/all/none` apply to the link's tag-id set; for `url`/`title` they
// apply to lowercased substring word matches.
export interface Clause {
  any: string[];
  all: string[];
  none: string[];
}

// A link belongs to exactly ONE list, so `all` (in two lists at once) is always
// empty — lists support only `any` (in one of these) and `none` (in none).
export interface ListClause {
  any: string[];
  none: string[];
}

// How results are ordered, descending (newest first): `updatedAt` = date
// modified, `createdAt` = date added. Each is backed by its own compound index
// (db.ts), so either sort is index-served, not sorted in memory.
export type LinkSort = 'updatedAt' | 'createdAt';

// A fully-described link query. Clauses AND across fields (a link must satisfy
// every non-empty one). Cross-field OR is intentionally not expressible — that's
// a structured-AST concern, out of scope.
export interface LinkQuery {
  lists: ListClause;
  tags: Clause;
  url: Clause;
  title: Clause;
  sort: LinkSort;
}

// One page of results. `total` is the exact match count ONLY when it's a cheap
// index `.count()` (a plain browse view); it's `undefined` once any predicate
// runs in JS (text words — they can't be counted without decoding the whole
// match set), so the UI shows a non-exact count under search. `hasMore` is always
// known (the query fetches one past the page to detect it).
export interface LinksResult {
  // Pinned matching links FIRST (in pin-rank order), then the page of the rest.
  // Display-resolved (link joined with its extraction — see LinkView).
  links: LinkView[];
  // How many leading entries of `links` are pinned — the boundary the UI draws its
  // pinned section / "move up·down" affordances at. The pinned segment is always
  // returned whole (pins are few); `limit`/"show more" pages only the rest.
  pinnedCount: number;
  total?: number;
  hasMore: boolean;
  // The page identity this result was computed for — the exact `query`/`limit`
  // passed to `readLinks`, echoed back so a reader can tell whether a result
  // reflects the page it currently wants vs. a stale one from before a query/limit
  // change (useLiveQuery returns the previous result for one render after its deps
  // change). See use-links.ts.
  query: LinkQuery;
  limit: number;
}

// --- decode ------------------------------------------------------------------

// Decode one `items` record into a typed entity (with its path), or `undefined`
// if its bytes are absent/unparseable — dropped from the view rather than
// crashing it. See `parseBlob` for the two skip reasons.
function decode<T extends z.ZodTypeAny>(
  record: ItemRecord,
  schema: T,
): WithPath<z.infer<T>> | undefined {
  const parsed = parseBlob(record.data, schema);
  if (parsed === undefined) return undefined;
  // The entity schemas are all `looseObject`, so `parsed` is an object; TS only
  // sees the open `z.infer<T>`, hence the spread widening.
  return { ...(parsed as object), path: record.path } as WithPath<z.infer<T>>;
}

// Decode a link THROUGH the memoized cache (decode-cache.ts), so the live views'
// repeated re-reads of the loaded prefix don't re-run parseBlob+zod on every
// `items` write — only records whose bytes changed re-decode. The version is the
// pair (`updatedAt`, `itemUpdatedAt`): a server rewrite moves the former, a local
// edit (which freezes `updatedAt` at its sync base) moves the latter. See
// decode-cache.ts for the full version-key rationale and the sign-out clear.
// `itemUpdatedAt` is set by the projector whenever the link parses (projection.ts);
// `?? 0` is defensive for a record that won't decode anyway.
function decodeCachedLink(record: ItemRecord): LinkItem | undefined {
  const itemUpdatedAt = record.itemUpdatedAt ?? 0;
  const cached = getCachedLink(record.path, record.updatedAt, itemUpdatedAt);
  if (cached !== undefined) return cached;

  const link = decode(record, linkSchema);
  if (link === undefined) {
    dropCachedLink(record.path); // bytes now absent/unparseable — drop any stale entry
    return undefined;
  }
  setCachedLink(record.path, record.updatedAt, itemUpdatedAt, link);
  return link;
}

function decodeLinks(records: ItemRecord[]): LinkItem[] {
  return records
    .map((record) => decodeCachedLink(record))
    .filter((link): link is LinkItem => link !== undefined);
}

// The `extractions/` counterpart of decodeCachedLink — same memoized, version-keyed
// decode (decode-cache.ts), so the per-row link↔extraction join is O(changed) too.
function decodeCachedExtraction(record: ItemRecord): ExtractionItem | undefined {
  const itemUpdatedAt = record.itemUpdatedAt ?? 0;
  const cached = getCachedExtraction(record.path, record.updatedAt, itemUpdatedAt);
  if (cached !== undefined) return cached;

  const extraction = decode(record, extractionSchema);
  if (extraction === undefined) {
    dropCachedExtraction(record.path);
    return undefined;
  }
  setCachedExtraction(record.path, record.updatedAt, itemUpdatedAt, extraction);
  return extraction;
}

// The `extractions/{id}.enc` path shadowing a link's `links/{id}.enc` — same `{id}`,
// the writer-split's co-key (entities.ts). Both are id-keyed namespaces, so this is a
// prefix swap.
function extractionPathForLink(linkPath: string): string {
  return pathFromId(idFromPath(linkPath, LINKS_PREFIX), EXTRACTIONS_PREFIX);
}

// Resolve one link + its (optional) extraction into the display row the UI renders —
// the override-wins join (`customTitle ?? extraction.title`, etc.).
function toView(link: LinkItem, extraction: Extraction | undefined): LinkView {
  return {
    ...link,
    title: link.customTitle ?? extraction?.title,
    imageId: link.customImageId ?? extraction?.imageId,
    pageArchiveId: extraction?.pageArchiveId,
    screenshotId: extraction?.screenshotId,
  };
}

// Batch-join a page of links with their co-keyed extractions (one `bulkGet` by path,
// memoized decode) and resolve each to a display row. The page is small (one virtual
// window), so this is cheap; it's the deliberate cost of keeping `links/` user-only
// (see client-queries.md).
async function joinExtractions(links: LinkItem[]): Promise<LinkView[]> {
  if (links.length === 0) return [];
  const records = await db.items.bulkGet(links.map((link) => extractionPathForLink(link.path)));
  return links.map((link, i) => {
    const record = records[i];
    const extraction = record ? decodeCachedExtraction(record) : undefined;
    return toView(link, extraction);
  });
}

// --- namespace reads (small collections) -------------------------------------

// All records under one namespace prefix, decoded and parse-filtered. The
// `startsWith` runs against the `items` primary key, so it's an index range scan,
// not a full-table walk. Lists/tags are small by design, so reading the whole
// namespace and decoding it is cheap — no index needed.
async function readNamespace<T extends z.ZodTypeAny>(
  prefix: string,
  schema: T,
): Promise<WithPath<z.infer<T>>[]> {
  const records = await db.items.where('path').startsWith(prefix).toArray();
  return records
    .map((record) => decode(record, schema))
    .filter((entity): entity is WithPath<z.infer<T>> => entity !== undefined);
}

// Overlay the synced lists onto the system-list defaults: a system list shows its
// stored override blob if one exists (the user renamed/moved it), else the code
// default. Custom lists pass through. Defaults carry a SYNTHESIZED path so the UI
// can target a not-yet-overridden system list — `lists/{id}.enc` is exactly where
// the first edit will write, so there's nothing to special-case downstream. The
// merge is by id, so an override never duplicates its default; ordering is left
// to buildTree (it sorts every sibling group by rank), so this just unions the
// two sources.
function mergeSystemLists(stored: ListItem[]): ListItem[] {
  const storedById = new Map(stored.map((list) => [list.id, list]));
  const resolved: ListItem[] = SYSTEM_LIST_DEFAULTS.map(
    (def) => storedById.get(def.id) ?? { ...def, path: pathFromId(def.id, LISTS_PREFIX) },
  );
  for (const list of stored) {
    if (!SYSTEM_LIST_IDS.has(list.id)) resolved.push(list);
  }
  return resolved;
}

// The full logical list set: the user's synced lists merged with the system-list
// defaults (My List / Archive / Trash). Flat — the tree is assembled by the
// caller via `buildTree` (see use-lists), so non-sidebar readers (settings) can
// take the flat set. Tags have no system entries, so `readTags` is a plain read.
export async function readLists(): Promise<ListItem[]> {
  const stored = await readNamespace(LISTS_PREFIX, listSchema);
  return mergeSystemLists(stored);
}

export function readTags(): Promise<TagItem[]> {
  return readNamespace(TAGS_PREFIX, tagSchema);
}

// Every pin (one per pinned link). Small by design — a user pins a handful — so
// the whole namespace is read and decoded, no index, like lists/tags.
export function readPins(): Promise<PinItem[]> {
  return readNamespace(PINS_PREFIX, pinSchema);
}

// The synced general-settings blob (`settings/general.enc`), or undefined if this
// device hasn't synced/written one. A single well-known path (not a namespace), so
// it's a direct `get` + decode rather than a prefix scan. `parseBlob` returns
// undefined for an absent or forward-incompatible blob; callers default each field.
export async function readSettingsGeneral(): Promise<SettingsGeneral | undefined> {
  const record = await db.items.get(SETTINGS_GENERAL_PATH);
  return parseBlob(record?.data, settingsGeneralSchema);
}

// One link looked up by its exact stored URL, or undefined — the extension popup's
// "is this active tab already saved?" check. Served by the `itemUrl` index (db.ts):
// a single keyed lookup, not a `links/` scan that decodes every blob until a match
// — load-bearing because the callers are `useLiveQuery` (popup), re-running on every
// store write. The editor stores the normalized url, so callers normalize the tab url
// the same way before querying. Exact match: a deliberate, scaffold-simple identity
// check, not fuzzy. `itemUrl` is links-only (projection.ts), so the hit is a link.
export async function readLinkByUrl(url: string): Promise<LinkItem | undefined> {
  const record = await db.items.where('itemUrl').equals(url).first();
  return record ? decodeCachedLink(record) : undefined;
}

// One link by its id (the `{id}` of its `links/{id}.enc`), or undefined — the
// direct-path counterpart of readLinkByUrl, used by the extraction worker to confirm
// the link still exists locally before capturing (it holds a link id from the EXTRACT
// message; active-tab capture reads the live DOM, so it needs existence, not the blob).
export async function readLinkById(linkId: string): Promise<LinkItem | undefined> {
  const record = await db.items.get(pathFromId(linkId, LINKS_PREFIX));
  if (!record) return undefined;
  return decodeCachedLink(record);
}

// How many links currently belong to `listId`, counted straight off the
// `[itemListId+itemUpdatedAt]` index — an index range count, no blob decode (the
// same column the list views range over). The "is this list empty?" gate for
// deleting a list: a list with links can't be removed (see useListMutations),
// since deleting it would orphan them.
export function countLinksInList(listId: string): Promise<number> {
  return db.items
    .where('[itemListId+itemUpdatedAt]')
    .between([listId, Dexie.minKey], [listId, Dexie.maxKey], true, true)
    .count();
}

// The LOCAL bytes of a `files/{id}.enc` content record, or undefined if absent /
// not yet materialized. Reads straight from the store with NO network and NO crypto:
// `data` holds the already-decrypted blob (an image/screenshot/archive the extractor
// just wrote, or one a prior sync decrypted). Used by the popup's complete page to
// preview a captured image without round-tripping R2 — the lazy network fetch
// (loadEntityContent) is the sync engine's job, not the UI's.
export async function readFileBytes(fileId: string): Promise<Uint8Array | undefined> {
  const record = await db.items.get(pathFromId(fileId, FILES_PREFIX));
  return record?.data;
}

// --- extraction queries ------------------------------------------------------

// The extraction bookkeeping entity for one link id (the `{id}` of its
// `links/{id}.enc`), or undefined if none has synced/been written yet. A direct
// exact-path read + decode — the path is derived from the id, no scan.
export async function readExtraction(linkId: string): Promise<ExtractionItem | undefined> {
  const record = await db.items.get(pathFromId(linkId, EXTRACTIONS_PREFIX));
  if (!record) return undefined;
  return decodeCachedExtraction(record);
}

// The options/status page's enrichment tally, headlined on the `titleImage` facet (the
// primary "fill in title + image" job). `done`/`failed` are exact index range-counts off
// the `*itemFacetStatuses` multiEntry index (projection.ts) — one token per facet, so a
// status:facet equals-count is the exact per-link count, no decode. `pending` can't be a
// token: the writer-split makes pending = ABSENCE (a link with no `done`/`failed`/
// `permanent` titleImage facet — often no extractions file at all — see
// docs/link-extraction.md), so it's the link total minus the recorded outcomes. `failed`
// folds in `permanent` (both are "not enriched, won't auto-retry without help").
export interface ExtractionFacetCounts {
  done: number;
  pending: number;
  failed: number;
}

export async function readExtractionFacetCounts(): Promise<ExtractionFacetCounts> {
  const [totalLinks, done, failedTransient, permanent] = await Promise.all([
    db.items
      .where('[itemType+itemUpdatedAt]')
      .between(['link', Dexie.minKey], ['link', Dexie.maxKey], true, true)
      .count(),
    db.items.where('itemFacetStatuses').equals('done:titleImage').count(),
    db.items.where('itemFacetStatuses').equals('failed:titleImage').count(),
    db.items.where('itemFacetStatuses').equals('permanent:titleImage').count(),
  ]);
  const failed = failedTransient + permanent;
  return { done, failed, pending: Math.max(0, totalLinks - done - failed) };
}

// Is one link's `titleImage` facet eligible for (re)extraction right now? Pending when
// the facet is ABSENT (absence = pending — the writer-split, see entities.ts), or a
// `failed` facet has cooled past its backoff (`now >= extractedAt + backoff(attempts)`).
// `done` and `permanent` (404/410, robots) are settled — never eligible, so one device's
// synced outcome stops every device. A direct test on one already-decoded facet — both the
// pending-titleImage reads below test each candidate's own facet inline with this, instead
// of materializing a settled-id set, so cost tracks the links actually examined.
function isTitleImageEligible(facet: Facet | undefined, now: number): boolean {
  if (!facet) return true;
  if (facet.status === 'done' || facet.status === 'permanent') return false;
  return now >= (facet.extractedAt ?? 0) + backoff(facet.attempts);
}

// A position in the newest-first `links/` walk, used to PAGINATE the whole-library
// enrich-all drain (extraction-provider) without re-scanning from the top each batch. It
// names the last link the walk EXAMINED — `(createdAt, path)` — so the next page resumes
// strictly past it. `path` is the tiebreak, not decoration: the `[itemType+itemCreatedAt]`
// index orders equal-createdAt rows by primary key (path), and a bulk import can stamp many
// links the same millisecond (writeLink uses `Date.now()`), so createdAt alone can't pin a
// resume point — a page boundary mid-collision would skip or repeat links.
export interface LinkScanCursor {
  createdAt: number;
  path: string;
}

// One page of the enrich-all walk: up to `limit` pending+eligible links (newest-first), plus
// the `cursor` to resume from. `cursor === null` means the library is exhausted (the drain
// stops); a non-null cursor always pairs with a FULL `links` page (the scan only stops early
// when it hits `limit`), so the caller keeps paging while it's non-null.
export interface PendingTitleImagePage {
  links: LinkItem[];
  cursor: LinkScanCursor | null;
}

// How many `links/` records one inner scan step pulls while hunting for the page's `limit`
// eligible links. Bounds memory per step; a settled-heavy stretch just costs more steps —
// but each link is still examined at most ONCE across the whole drain, because the cursor
// only moves forward (the property that makes enrich-all O(library), not O(library²)).
const SCAN_CHUNK = 200;

// The residual extraction queue for the WHOLE-LIBRARY "enrich all" job (extraction-provider
// `enrichAll`), as a QUERY (there's no queue object — see docs/link-extraction.md "the queue
// is a query"), PAGINATED. Returns up to `limit` links whose `titleImage` is pending+eligible,
// newest-first, plus a `cursor` the caller threads back to resume. The automatic drain uses
// the displayed-scoped read below instead.
//
// Cost: O(examined), and across a full drain O(library) total — NOT the O(settled)-per-batch
// of a blocked-set rebuild, and NOT the O(library²) of re-scanning from the top every batch.
// The forward `cursor` is what buys that: each batch resumes where the last left off, so a
// just-enriched link is behind the cursor and never re-walked. Eligibility is tested INLINE
// off each link's own co-keyed extraction facet (`isTitleImageEligible`, like the
// displayed-scoped read) rather than against a precomputed blocked set — so the test stays
// FRESH: a link a concurrent sync settled mid-drain drops out here instead of costing a
// redundant (paid) extract. Missing / settled / still-cooling links are skipped; only their
// position advances the cursor.
export async function readLinksPendingTitleImagePage(
  now: number,
  limit: number,
  cursor?: LinkScanCursor,
): Promise<PendingTitleImagePage> {
  if (limit <= 0) return { links: [], cursor: cursor ?? null };

  const pending: ItemRecord[] = [];
  // The boundary already consumed: rows at `boundary.createdAt` with `path >= boundary.path`
  // were examined on a prior page/step, so skip them. Undefined = start at the newest link.
  let boundary = cursor;
  let next: LinkScanCursor | null = cursor ?? null;

  for (;;) {
    const upper = boundary ? boundary.createdAt : Dexie.maxKey;
    const chunk = await db.items
      .where('[itemType+itemCreatedAt]')
      .between(['link', Dexie.minKey], ['link', upper], true, true)
      .reverse()
      .limit(SCAN_CHUNK)
      .toArray();
    if (chunk.length === 0) return { links: decodeLinks(pending), cursor: null };

    // Co-keyed extractions for the chunk, fetched once — the join the inline eligibility
    // test reads (the writer-split's `extractions/{id}` shadow of each `links/{id}`).
    const exRecords = await db.items.bulkGet(chunk.map((r) => extractionPathForLink(r.path)));

    let examined = 0;
    for (let i = 0; i < chunk.length; i++) {
      const record = chunk[i];
      const createdAt = record.itemCreatedAt ?? 0;
      // Skip the prior boundary's already-examined rows (same createdAt, path at/after it).
      if (boundary && createdAt === boundary.createdAt && record.path >= boundary.path) continue;
      examined++;
      next = { createdAt, path: record.path };

      const exRecord = exRecords[i];
      const facet = exRecord ? decodeCachedExtraction(exRecord)?.facets.titleImage : undefined;
      if (isTitleImageEligible(facet, now)) {
        pending.push(record);
        if (pending.length >= limit) return { links: decodeLinks(pending), cursor: next };
      }
    }

    // A short chunk means we reached the oldest link — library exhausted.
    if (chunk.length < SCAN_CHUNK) return { links: decodeLinks(pending), cursor: null };

    // Advance into the next chunk. Normally `next` (the last examined row) is the chunk's
    // last row, so the boundary moves forward. If `examined === 0` the whole full chunk was
    // the skipped boundary run (a collision run longer than SCAN_CHUNK sharing one
    // createdAt) — `next` didn't move, so step the boundary to the chunk's last row to force
    // progress through the run.
    boundary = examined === 0 ? toCursor(chunk[chunk.length - 1]) : (next ?? undefined);
  }
}

function toCursor(record: ItemRecord): LinkScanCursor {
  return { createdAt: record.itemCreatedAt ?? 0, path: record.path };
}

// The pending-titleImage subset of a SPECIFIC set of link paths, in the given order — the
// read behind brace-web's displayed-driven AUTOMATIC extraction (extraction-provider). Where
// `readLinksPendingTitleImagePage` walks the whole library for the conscious "enrich all" job,
// this scopes the automatic drain to what the user is actually looking at: the page of links
// the main pane has rendered. So a 30k-link bulk import left in an abandoned tab never
// enriches past what was scrolled into view — work tracks attention, not an arbitrary cap.
//
// Cost: O(displayed), NOT O(library) — load-bearing because this read backs the always-on
// probe liveQuery (extraction-provider), which re-runs on every `db.items` write. Two
// `bulkGet`s of the given paths (the links + their co-keyed extractions), then an inline
// per-path eligibility test (`isTitleImageEligible`) — the same direct facet test the
// enrich-all page read uses, just over a bounded path set. Order follows `linkPaths` (the
// display order — newest first), so on-screen links enrich top-down. Missing / non-link /
// settled / still-cooling paths drop out.
export async function readLinksPendingTitleImageForLinkPaths(
  linkPaths: string[],
  now: number,
): Promise<LinkItem[]> {
  if (linkPaths.length === 0) return [];

  const [records, exRecords] = await Promise.all([
    db.items.bulkGet(linkPaths),
    db.items.bulkGet(linkPaths.map(extractionPathForLink)),
  ]);

  const pending: ItemRecord[] = [];
  for (let i = 0; i < linkPaths.length; i++) {
    const record = records[i];
    if (!record || record.itemType !== 'link') continue;

    const exRecord = exRecords[i];
    const facet = exRecord ? decodeCachedExtraction(exRecord)?.facets.titleImage : undefined;
    if (isTitleImageEligible(facet, now)) pending.push(record);
  }
  return decodeLinks(pending);
}

// --- link query --------------------------------------------------------------

function clauseEmpty(c: Clause): boolean {
  return c.any.length === 0 && c.all.length === 0 && c.none.length === 0;
}

function hasTextClause(q: LinkQuery): boolean {
  return !clauseEmpty(q.url) || !clauseEmpty(q.title);
}

// Predicates the indexed COLUMNS can answer without decoding the blob — list id
// and tag ids (db.ts). The driver index pre-narrows for one positive clause;
// this re-checks every clause so it's correct no matter which (or no) driver ran.
function columnMatches(record: ItemRecord, q: LinkQuery): boolean {
  const listId = record.itemListId;
  if (q.lists.any.length > 0 && (listId === undefined || !q.lists.any.includes(listId))) {
    return false;
  }
  if (q.lists.none.length > 0 && listId !== undefined && q.lists.none.includes(listId)) {
    return false;
  }
  const tagIds = record.itemTagIds ?? [];
  if (q.tags.any.length > 0 && !q.tags.any.some((t) => tagIds.includes(t))) return false;
  if (q.tags.all.length > 0 && !q.tags.all.every((t) => tagIds.includes(t))) return false;
  if (q.tags.none.length > 0 && q.tags.none.some((t) => tagIds.includes(t))) return false;
  return true;
}

// Substring word match over one field. Words are pre-lowercased by the parser;
// the haystack is lowercased here.
function wordsMatch(haystack: string, c: Clause): boolean {
  const h = haystack.toLowerCase();
  if (c.all.length > 0 && !c.all.every((w) => h.includes(w))) return false;
  if (c.any.length > 0 && !c.any.some((w) => h.includes(w))) return false;
  if (c.none.length > 0 && c.none.some((w) => h.includes(w))) return false;
  return true;
}

function hasTitleClause(q: LinkQuery): boolean {
  return !clauseEmpty(q.title);
}

// The URL text predicate — on the decoded LINK (url lives in `links/`), so it can run
// inside the sync filter walk. Never index-served (text is in the blob): a JS post-filter
// (the "scan for now" choice; the scalable upgrade is a write-time `*itemSearchWords`
// token index).
function urlMatches(link: LinkItem, q: LinkQuery): boolean {
  return wordsMatch(link.url, q.url);
}

// The title text predicate — on the RESOLVED display title (`customTitle ?? extraction.title`).
// `customTitle` is on the link, but `extraction.title` lives in the co-keyed
// `extractions/{id}.enc`, so a title clause forces the link↔extraction JOIN; it can't run
// in the sync walk. An empty haystack is fine: an `any` term fails (nothing to match), a
// `none`-only term passes (nothing excluded).
function titleMatches(link: LinkItem, extraction: Extraction | undefined, q: LinkQuery): boolean {
  return wordsMatch(link.customTitle ?? extraction?.title ?? '', q.title);
}

// The compound index + record column backing each sort dimension. Both
// timestamps are projected on every type (projection.ts), so each sort reuses the
// same two link indexes; only the ordering component differs.
const SORT_INDEXES: Record<
  LinkSort,
  { type: string; list: string; column: 'itemUpdatedAt' | 'itemCreatedAt' }
> = {
  updatedAt: {
    type: '[itemType+itemUpdatedAt]',
    list: '[itemListId+itemUpdatedAt]',
    column: 'itemUpdatedAt',
  },
  createdAt: {
    type: '[itemType+itemCreatedAt]',
    list: '[itemListId+itemCreatedAt]',
    column: 'itemCreatedAt',
  },
};

// A browse view with a single positive list/all clause and nothing else: walk one
// compound index in order, materialize only the page, and count via the index —
// no decode of the whole library, exact total. `exclude` drops the pinned links
// already surfaced by the overlay; every one of them falls in THIS range (it
// matched the same query), so the rest-count is exactly `total - exclude.size`.
async function rangeFastPath(
  index: string,
  key: string,
  limit: number,
  exclude: Set<string>,
): Promise<RestResult> {
  const range = db.items.where(index).between([key, Dexie.minKey], [key, Dexie.maxKey], true, true);
  const [records, total] = await Promise.all([
    range
      .clone()
      .reverse()
      .filter((record) => !exclude.has(record.path))
      .limit(limit)
      .toArray(),
    range.count(),
  ]);
  const restTotal = total - exclude.size;
  return { links: decodeLinks(records), total: restTotal, hasMore: restTotal > limit };
}

// Finish a query from an already-loaded candidate subset (the tag-driven path):
// drop non-matches on the columns (no decode), sort by the chosen sort column
// (still no decode — it's an indexed column), then decode only as far as the page
// needs. Exact total when there's no text clause (the column survivors ARE the
// match set); undefined once text filtering applies.
async function finishFromCandidates(
  candidates: ItemRecord[],
  q: LinkQuery,
  limit: number,
  exclude: Set<string>,
): Promise<RestResult> {
  const { column } = SORT_INDEXES[q.sort];
  const survivors = candidates.filter((r) => !exclude.has(r.path) && columnMatches(r, q));
  survivors.sort((a, b) => (b[column] ?? 0) - (a[column] ?? 0));

  if (!hasTextClause(q)) {
    return {
      links: decodeLinks(survivors.slice(0, limit)),
      total: survivors.length,
      hasMore: survivors.length > limit,
    };
  }

  if (hasTitleClause(q)) return finishWithTitleSearch(survivors, q, limit);

  // url-only text: filter on the decoded link, no extraction join needed.
  const links: LinkItem[] = [];
  for (const record of survivors) {
    const link = decodeCachedLink(record);
    if (link && urlMatches(link, q)) {
      links.push(link);
      if (links.length > limit) break; // one past the page → hasMore
    }
  }
  return { links: links.slice(0, limit), total: undefined, hasMore: links.length > limit };
}

// Finish a TITLE-search page. Title lives in `extractions/`, so it can't be filtered in
// the sync walk: take the column-filtered survivor records (already in sort order), apply
// the url clause on the decoded link, bulk-join their extractions, then apply the title
// clause and page. Materializes the survivor set — title search is already non-exact / a
// scan — so the cost is bounded by the column+url survivors (the whole library only for a
// bare title search, which is exactly the old behavior's cost plus the extraction reads).
async function finishWithTitleSearch(
  survivors: ItemRecord[],
  q: LinkQuery,
  limit: number,
): Promise<RestResult> {
  const urlPassed: LinkItem[] = [];
  for (const record of survivors) {
    const link = decodeCachedLink(record);
    if (link && urlMatches(link, q)) urlPassed.push(link);
  }
  const exRecords = await db.items.bulkGet(urlPassed.map((l) => extractionPathForLink(l.path)));
  const links: LinkItem[] = [];
  for (let i = 0; i < urlPassed.length; i++) {
    const exRecord = exRecords[i];
    const extraction = exRecord ? decodeCachedExtraction(exRecord) : undefined;
    if (titleMatches(urlPassed[i], extraction, q)) {
      links.push(urlPassed[i]);
      if (links.length > limit) break; // one past the page → hasMore
    }
  }
  return { links: links.slice(0, limit), total: undefined, hasMore: links.length > limit };
}

// The page of NON-pinned links — the driver result before the pinned overlay is
// prepended (so no `pinnedCount` yet) and before `readLinks` stamps the page
// identity (`query`/`limit`). Pinned links are excluded via `exclude`. Carries plain
// `LinkItem`s (not display-resolved `LinkView`s) — the extraction join is deferred to
// readLinks, which joins the whole page (overlay + rest) in one pass.
interface RestResult {
  links: LinkItem[];
  total?: number;
  hasMore: boolean;
}

// One page of the link library for `query` MINUS `exclude`, ordered by
// `query.sort` (descending — newest first). Picks the cheapest driver for the
// clauses present:
//   - single list / no filters → index-ordered fast path (exact count).
//   - positive tag clause → drive the selective `*itemTagIds` index, finish over
//     that subset (a tag's links, never the whole library), sorted in JS.
//   - anything else (multi-list, `none`, text) → walk the all-links ordered index
//     applying every clause and decoding lazily, stopping at the page; total is
//     non-exact.
async function readRest(
  query: LinkQuery,
  limit: number,
  exclude: Set<string>,
): Promise<RestResult> {
  const index = SORT_INDEXES[query.sort];
  const onlyLists = clauseEmpty(query.tags) && clauseEmpty(query.url) && clauseEmpty(query.title);

  if (onlyLists && query.lists.none.length === 0) {
    if (query.lists.any.length === 1) {
      return rangeFastPath(index.list, query.lists.any[0], limit, exclude);
    }
    if (query.lists.any.length === 0) {
      return rangeFastPath(index.type, 'link', limit, exclude);
    }
  }

  // Most selective positive clause is a tag: drive the tag index. `any` is an OR
  // membership (`anyOf`, deduped); for an `all`-only query we drive on the first
  // tag and let `columnMatches` enforce the rest.
  const tagDriver = query.tags.any.length > 0 ? query.tags.any : query.tags.all.slice(0, 1);
  if (tagDriver.length > 0) {
    const candidates = await db.items.where('itemTagIds').anyOf(tagDriver).distinct().toArray();
    return finishFromCandidates(candidates, query, limit, exclude);
  }

  // A title clause can't be filtered in the sync walk (title lives in `extractions/`):
  // gather every column-filtered survivor in sort order, then join + filter + page.
  if (hasTitleClause(query)) {
    const survivors = await db.items
      .where(index.type)
      .between(['link', Dexie.minKey], ['link', Dexie.maxKey], true, true)
      .reverse()
      .filter((record) => !exclude.has(record.path) && columnMatches(record, query))
      .toArray();
    return finishWithTitleSearch(survivors, query, limit);
  }

  // No positive tag clause and no title clause: walk all links newest-first, filtering
  // as we go on columns + url (decoded link). The `filter` stops once `limit + 1` pass
  // (one past the page detects `hasMore`), so it touches a bounded slice, not the library.
  const records = await db.items
    .where(index.type)
    .between(['link', Dexie.minKey], ['link', Dexie.maxKey], true, true)
    .reverse()
    .filter((record) => {
      if (exclude.has(record.path) || !columnMatches(record, query)) return false;
      const link = decodeCachedLink(record);
      return link !== undefined && urlMatches(link, query);
    })
    .limit(limit + 1)
    .toArray();

  return {
    links: decodeLinks(records).slice(0, limit),
    total: undefined,
    hasMore: records.length > limit,
  };
}

// The pinned links that MATCH `query`, in pin-rank order — the overlay floated to
// the top of every view a pinned link appears in. Reads the small `pins/`
// namespace, looks up each pin's `links/{id}.enc` record (bulkGet preserves the
// rank order of the keys), and keeps only those that exist and pass the same
// column + text predicates the rest of the query uses. A pin whose link is gone
// or doesn't match the active view is simply skipped. Returns the decoded links
// and the set of their paths, so `readRest` can exclude them and not double-show.
async function readPinnedOverlay(
  query: LinkQuery,
): Promise<{ links: LinkItem[]; paths: Set<string> }> {
  const pins = (await readPins()).sort(compareRank);
  if (pins.length === 0) return { links: [], paths: new Set() };

  const records = await db.items.bulkGet(pins.map((pin) => pathFromId(pin.id, LINKS_PREFIX)));
  const hasUrl = !clauseEmpty(query.url);
  const passed: LinkItem[] = [];
  for (const record of records) {
    if (!record || !columnMatches(record, query)) continue;
    const link = decodeCachedLink(record);
    if (!link || (hasUrl && !urlMatches(link, query))) continue;
    passed.push(link);
  }

  if (!hasTitleClause(query)) {
    return { links: passed, paths: new Set(passed.map((l) => l.path)) };
  }

  // Title clause: join each pinned link's extraction (pins are few) and apply the filter.
  const exRecords = await db.items.bulkGet(passed.map((l) => extractionPathForLink(l.path)));
  const links: LinkItem[] = [];
  passed.forEach((link, i) => {
    const exRecord = exRecords[i];
    const extraction = exRecord ? decodeCachedExtraction(exRecord) : undefined;
    if (titleMatches(link, extraction, query)) links.push(link);
  });
  return { links, paths: new Set(links.map((l) => l.path)) };
}

// One page for `query`: the pinned matching links first (rank order, always whole),
// then the page of the rest. `limit`/"show more" pages only the rest — pins are
// few and never paginated. The pinned set is excluded from the rest so a link
// never appears twice, and folded into `total` when the rest's total is exact.
export async function readLinks(query: LinkQuery, limit: number): Promise<LinksResult> {
  const overlay = await readPinnedOverlay(query);
  const rest = await readRest(query, limit, overlay.paths);
  // Join the whole page (overlay + rest) with extractions in one pass → display rows.
  const links = await joinExtractions([...overlay.links, ...rest.links]);
  return {
    links,
    pinnedCount: overlay.links.length,
    total: rest.total === undefined ? undefined : overlay.links.length + rest.total,
    hasMore: rest.hasMore,
    query,
    limit,
  };
}
