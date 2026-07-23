// The typed read layer over the `items` table — the expo sibling of
// web-react's data/queries.ts (that file is the canonical doc for what each
// read MEANS: the query grammar's evaluation order, the pinned overlay, the
// driver choices, why `total` goes undefined under text search). This one
// documents where the SQLite port diverges:
//
//  - Queries are drizzle over the db.ts indexes instead of Dexie index walks.
//    The compound-index fast paths become `WHERE … ORDER BY <sort column>,
//    path` (the explicit `path` tiebreak reproduces Dexie's primary-key order
//    for equal timestamps); the sparse-index "rows without the column never
//    appear" property becomes an explicit `IS NOT NULL` on the sort column.
//  - The multiEntry tag index is the `item_tag_ids` junction (db.ts): the tag
//    driver selects candidate paths from it, and the tag predicates read a
//    junction-built path → tagIds map instead of a `record.itemTagIds` array.
//  - Dexie's lazy filtered cursor walk becomes a keyset-paginated chunk loop
//    (resume strictly after `(sortValue, path)`), so a page read still touches
//    a bounded slice instead of materializing the library.
//  - No zone-echo constraint: reactivity here comes from expo-sqlite's change
//    listener (hooks/use-live-read.ts), not from tracking which ranges a
//    querier touched — helpers can await freely.
//
// Ported so far: the namespace reads (lists/tags/pins/settings), the link
// library query (`readLinks`), the by-id lookups (`readLinkById`,
// `readExtraction` — the write edge's re-read-before-merge and destroy's
// satellite sweep), and the by-url lookups + quota count behind the add editor
// (`readLinkByUrl`/`readLinkByUrlKey`, `countLinks`). The remaining siblings
// (the extraction tallies and drain pages) arrive verbatim with the features
// that need them.

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  notInArray,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { z } from 'zod';

import type {
  Clause,
  Extraction,
  ExtractionItem,
  LinkItem,
  LinkQuery,
  LinkSortOn,
  ListItem,
  PinItem,
  SettingsGeneral,
  TagItem,
  WithPath,
} from '@stxapps/shared';
import {
  canonicalUrlKey,
  compareRank,
  dropCachedExtraction,
  dropCachedLink,
  EXTRACTIONS_PREFIX,
  extractionSchema,
  getCachedExtraction,
  getCachedLink,
  LINKS_PREFIX,
  linkSchema,
  LISTS_PREFIX,
  listSchema,
  pathFromId,
  PINS_PREFIX,
  pinSchema,
  rekey,
  setCachedExtraction,
  setCachedLink,
  SETTINGS_GENERAL_PATH,
  settingsGeneralSchema,
  SYSTEM_LIST_DEFAULTS,
  SYSTEM_LIST_IDS,
  TAGS_PREFIX,
  tagSchema,
} from '@stxapps/shared';
import { chunk } from '@stxapps/shared';

import { getDb, items, itemTagIds } from './db';
import { bulkGetItems, getItem, type ItemRow } from './item-store';
import { parseBlob } from './projection';

// The read-layer facade re-exports (web queries.ts does the same): the typed
// item bundles and the query grammar live in `@stxapps/shared`; app consumers
// read them through this layer.
export type {
  Clause,
  ExtractionItem,
  LinkItem,
  LinkQuery,
  ListClause,
  ListItem,
  PinItem,
  TagItem,
  WithPath,
} from '@stxapps/shared';
export { emptyQuery, excludeLists, linkIdOf } from '@stxapps/shared';

// A link row resolved for DISPLAY — the override-wins link↔extraction join.
// Field semantics: web-react queries.ts `LinkView`.
export type LinkView = LinkItem & {
  title?: string;
  imageId?: string;
  pageCopyId?: string;
  screenshotId?: string;
};

// One page of results — web-react queries.ts `LinksResult`, verbatim: `total`
// exact only for plain browse views, `query`/`limit` echo the page identity for
// the reader's stale-result check (use-links).
export interface LinksResult {
  links: LinkView[];
  pinnedCount: number;
  total?: number;
  hasMore: boolean;
  query: LinkQuery;
  limit: number;
}

// Keep `IN (...)` lists under SQLite's bound-variable ceiling (item-store's
// convention); exclude sets (pins) and page chunks stay well below it.
const IN_BATCH = 500;

// How many rows one keyset chunk of the filtered walk pulls while hunting for
// a page — the Dexie-cursor analogue's step size (web reads lazily; here each
// step is one bounded SELECT).
const SCAN_CHUNK = 200;

// --- decode ------------------------------------------------------------------

// Decode one `items` row into a typed entity (with its path), or `undefined`
// if its bytes are absent/unparseable — dropped from the view rather than
// crashing it. See `parseBlob` for the two skip reasons.
function decode<T extends z.ZodTypeAny>(row: ItemRow, schema: T): WithPath<z.infer<T>> | undefined {
  const parsed = parseBlob(row.data ?? undefined, schema);
  if (parsed === undefined) return undefined;
  // The entity schemas are all `looseObject`, so `parsed` is an object; TS only
  // sees the open `z.infer<T>`, hence the spread widening.
  return { ...(parsed as object), path: row.path } as WithPath<z.infer<T>>;
}

// Decode a link THROUGH the memoized cache (shared decode-cache.ts) so the live
// views' repeated re-reads don't re-run parseBlob+zod on every store write —
// same version key as web (`updatedAt`, `itemUpdatedAt`).
function decodeCachedLink(row: ItemRow): LinkItem | undefined {
  const itemUpdatedAt = row.itemUpdatedAt ?? 0;
  const cached = getCachedLink(row.path, row.updatedAt, itemUpdatedAt);
  if (cached !== undefined) return cached;

  const link = decode(row, linkSchema);
  if (link === undefined) {
    dropCachedLink(row.path); // bytes now absent/unparseable — drop any stale entry
    return undefined;
  }
  setCachedLink(row.path, row.updatedAt, itemUpdatedAt, link);
  return link;
}

function decodeLinks(rows: ItemRow[]): LinkItem[] {
  return rows
    .map((row) => decodeCachedLink(row))
    .filter((link): link is LinkItem => link !== undefined);
}

// The `extractions/` counterpart — same memoized, version-keyed decode.
function decodeCachedExtraction(row: ItemRow): ExtractionItem | undefined {
  const itemUpdatedAt = row.itemUpdatedAt ?? 0;
  const cached = getCachedExtraction(row.path, row.updatedAt, itemUpdatedAt);
  if (cached !== undefined) return cached;

  const extraction = decode(row, extractionSchema);
  if (extraction === undefined) {
    dropCachedExtraction(row.path);
    return undefined;
  }
  setCachedExtraction(row.path, row.updatedAt, itemUpdatedAt, extraction);
  return extraction;
}

// The `extractions/{id}.enc` path shadowing a link's `links/{id}.enc` — the
// writer-split's co-key (shared entities.ts); a prefix swap.
function extractionPathForLink(linkPath: string): string {
  return rekey(linkPath, LINKS_PREFIX, EXTRACTIONS_PREFIX);
}

// Resolve one link + its (optional) extraction into the display row — the
// override-wins join.
function toView(link: LinkItem, extraction: Extraction | undefined): LinkView {
  return {
    ...link,
    title: link.customTitle ?? extraction?.title,
    imageId: link.customImageId ?? extraction?.imageId,
    pageCopyId: extraction?.pageCopyId,
    screenshotId: extraction?.screenshotId,
  };
}

// Batch-join a page of links with their co-keyed extractions and resolve each
// to a display row. The page is small (one screen's window), so this is cheap.
async function joinExtractions(links: LinkItem[]): Promise<LinkView[]> {
  if (links.length === 0) return [];
  const rows = await bulkGetItems(links.map((link) => extractionPathForLink(link.path)));
  return links.map((link, i) => {
    const row = rows[i];
    const extraction = row ? decodeCachedExtraction(row) : undefined;
    return toView(link, extraction);
  });
}

// --- namespace reads (small collections) -------------------------------------

// All rows under one namespace prefix, decoded and parse-filtered. The bounds
// pair on the primary key is an index range scan (the explicit form of Dexie's
// `startsWith`; a LIKE prefix only uses the index under extra pragmas).
async function readNamespace<T extends z.ZodTypeAny>(
  prefix: string,
  schema: T,
): Promise<WithPath<z.infer<T>>[]> {
  // '￿' sorts after every character a path can contain, closing the range.
  const rows = getDb()
    .select()
    .from(items)
    .where(and(gte(items.path, prefix), lt(items.path, `${prefix}￿`)))
    .all();
  return rows
    .map((row) => decode(row, schema))
    .filter((entity): entity is WithPath<z.infer<T>> => entity !== undefined);
}

// Overlay the synced lists onto the system-list defaults — web queries.ts
// `mergeSystemLists`, verbatim (defaults carry a SYNTHESIZED path so the UI can
// target a not-yet-overridden system list).
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

// The full logical list set: synced lists merged with the system defaults
// (My List / Archive / Trash). Flat — the caller assembles the tree via
// `buildTree` (see use-lists), so non-sidebar readers can take the flat set.
export async function readLists(): Promise<ListItem[]> {
  const stored = await readNamespace(LISTS_PREFIX, listSchema);
  return mergeSystemLists(stored);
}

export function readTags(): Promise<TagItem[]> {
  return readNamespace(TAGS_PREFIX, tagSchema);
}

// Every pin (one per pinned link). Small by design, like lists/tags.
export function readPins(): Promise<PinItem[]> {
  return readNamespace(PINS_PREFIX, pinSchema);
}

// The synced general-settings blob, or undefined if this device hasn't
// synced/written one. Callers default each field (see use-settings).
export async function readSettingsGeneral(): Promise<SettingsGeneral | undefined> {
  const row = getDb().select().from(items).where(eq(items.path, SETTINGS_GENERAL_PATH)).get();
  return parseBlob(row?.data ?? undefined, settingsGeneralSchema);
}

// How many links currently belong to `listId`, counted straight off the
// `item_list_id` column — no blob decode (web's countLinksInList, over the
// same projected column its list views range on). The "is this list empty?"
// gate for deleting a list: a list with links can't be removed (see
// use-list-mutations), since deleting it would orphan them.
export async function countLinksInList(listId: string): Promise<number> {
  const row = getDb().select({ n: count() }).from(items).where(eq(items.itemListId, listId)).get();
  return row?.n ?? 0;
}

// Every link in the local store, counted the server's way: every `links/`
// record, INCLUDING trashed ones (Trash is a listId, not a deletion — the blob
// still exists, so the server counts it). The quota gate's count (see
// use-link-quota, whose header carries the wedged-queue rationale); same rule
// as readExistingLinks in import-all-data.ts. A primary-key range COUNT — no
// blob decode (readNamespace's bounds pair, aggregated).
export async function countLinks(): Promise<number> {
  const row = getDb()
    .select({ n: count() })
    .from(items)
    .where(and(gte(items.path, LINKS_PREFIX), lt(items.path, `${LINKS_PREFIX}￿`)))
    .get();
  return row?.n ?? 0;
}

// One link looked up by its exact stored URL, or undefined — web
// readLinkByUrl's port (that header is canonical: exact match by design; for
// "is this URL already saved?" use readLinkByUrlKey). Served by the partial
// `idx_items_url` index (db.ts); `itemUrl` is links-only (projection.ts), so
// the hit is a link.
export async function readLinkByUrl(url: string): Promise<LinkItem | undefined> {
  const row = getDb().select().from(items).where(eq(items.itemUrl, url)).limit(1).get();
  return row ? decodeCachedLink(row) : undefined;
}

// One link that's the SAME RESOURCE as `url` under the canonical dedup
// identity (canonicalUrlKey), or undefined — web readLinkByUrlKey's port (that
// header is canonical: why the URL is keyed here, the raw-text fallback). The
// add editor's duplicate/trashed check; served by the partial
// `idx_items_url_key` index over the column projection.ts stamps at write.
export async function readLinkByUrlKey(url: string): Promise<LinkItem | undefined> {
  const key = canonicalUrlKey(url);
  if (key === null) return readLinkByUrl(url);

  const row = getDb().select().from(items).where(eq(items.itemUrlKey, key)).limit(1).get();
  return row ? decodeCachedLink(row) : undefined;
}

// One link by its id (the `{id}` of its `links/{id}.enc`), or undefined — the
// direct-path lookup behind the write edge's re-read-before-merge
// (use-link-mutations.update/destroy). An exact-path read + cached decode.
export async function readLinkById(linkId: string): Promise<LinkItem | undefined> {
  const row = await getItem(pathFromId(linkId, LINKS_PREFIX));
  if (!row) return undefined;
  return decodeCachedLink(row);
}

// The extraction bookkeeping entity for one link id, or undefined if none has
// synced/been written yet — web's readExtraction, verbatim: a direct
// exact-path read + cached decode (the path is derived from the id, no scan).
export async function readExtraction(linkId: string): Promise<ExtractionItem | undefined> {
  const row = await getItem(pathFromId(linkId, EXTRACTIONS_PREFIX));
  if (!row) return undefined;
  return decodeCachedExtraction(row);
}

// --- link query --------------------------------------------------------------

function clauseEmpty(c: Clause): boolean {
  return c.any.length === 0 && c.all.length === 0 && c.none.length === 0;
}

function hasTextClause(q: LinkQuery): boolean {
  return !clauseEmpty(q.url) || !clauseEmpty(q.title) || !clauseEmpty(q.text);
}

// The tag-id sets for a set of link paths, from the junction table — the
// column predicates' stand-in for web's `record.itemTagIds` array. Only built
// when a tag clause needs it; paths without tags simply miss the map.
function loadTagIdsByPath(paths: string[]): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  for (const batch of chunk(paths, IN_BATCH)) {
    const rows = getDb().select().from(itemTagIds).where(inArray(itemTagIds.path, batch)).all();
    for (const row of rows) {
      const tags = byPath.get(row.path);
      if (tags) tags.push(row.tagId);
      else byPath.set(row.path, [row.tagId]);
    }
  }
  return byPath;
}

// Predicates the projected COLUMNS can answer without decoding the blob — web
// queries.ts `columnMatches`, with the tag set passed in (junction map) instead
// of read off the record. The driver pre-narrows for one positive clause; this
// re-checks every clause so it's correct no matter which (or no) driver ran.
function columnMatches(row: ItemRow, tagIds: readonly string[], q: LinkQuery): boolean {
  const listId = row.itemListId;
  if (q.lists.any.length > 0 && (listId === null || !q.lists.any.includes(listId))) {
    return false;
  }
  if (q.lists.none.length > 0 && listId !== null && q.lists.none.includes(listId)) {
    return false;
  }
  if (q.tags.any.length > 0 && !q.tags.any.some((t) => tagIds.includes(t))) return false;
  if (q.tags.all.length > 0 && !q.tags.all.every((t) => tagIds.includes(t))) return false;
  if (q.tags.none.length > 0 && q.tags.none.some((t) => tagIds.includes(t))) return false;
  return true;
}

// Whether the query carries any tag clause at all — the gate for building the
// junction map the predicates above would read.
function hasTagClause(q: LinkQuery): boolean {
  return !clauseEmpty(q.tags);
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

// A query needs the link↔extraction JOIN when it filters on the resolved title
// (`title`, or `text` whose haystack includes it) — web queries.ts, verbatim.
function needsExtractionJoin(q: LinkQuery): boolean {
  return !clauseEmpty(q.title) || !clauseEmpty(q.text);
}

function urlMatches(link: LinkItem, q: LinkQuery): boolean {
  return wordsMatch(link.url, q.url);
}

function titleMatches(link: LinkItem, extraction: Extraction | undefined, q: LinkQuery): boolean {
  return wordsMatch(link.customTitle ?? extraction?.title ?? '', q.title);
}

function textMatches(link: LinkItem, extraction: Extraction | undefined, q: LinkQuery): boolean {
  const title = link.customTitle ?? extraction?.title ?? '';
  return wordsMatch(`${link.url} ${title}`, q.text);
}

// The sort column backing each sort dimension (db.ts's compound indexes cover
// (item_type|item_list_id, <column>)). `IS NOT NULL` on it in every ordered
// scan reproduces web's sparse compound index, which simply omits records
// without the column.
function sortColumnOf(sortOn: LinkSortOn) {
  return sortOn === 'createdAt' ? items.itemCreatedAt : items.itemUpdatedAt;
}

// A browse view with a single positive list/all clause and nothing else: one
// ordered indexed SELECT for the page and one index COUNT for the exact total
// (web's `rangeFastPath`). `exclude` (the pinned overlay) is folded in as a
// NOT IN on the page read and subtracted from the count — every excluded path
// falls in this range (it matched the same query), exactly as on web.
async function rangeFastPath(
  where: SQL,
  q: LinkQuery,
  limit: number,
  exclude: Set<string>,
): Promise<RestResult> {
  const sortCol = sortColumnOf(q.sortOn);
  const order = q.sortOrder === 'desc' ? desc : asc;
  const filters = and(
    where,
    isNotNull(sortCol),
    exclude.size > 0 ? notInArray(items.path, [...exclude]) : undefined,
  );
  const rows = getDb()
    .select()
    .from(items)
    .where(filters)
    .orderBy(order(sortCol), order(items.path))
    .limit(limit)
    .all();
  const totalRow = getDb()
    .select({ n: count() })
    .from(items)
    .where(and(where, isNotNull(sortCol)))
    .get();
  const restTotal = (totalRow?.n ?? 0) - exclude.size;
  return { links: decodeLinks(rows), total: restTotal, hasMore: restTotal > limit };
}

// Finish a query from an already-loaded candidate subset (the tag-driven
// path) — web's `finishFromCandidates`: drop non-matches on the columns (no
// decode), sort by the chosen sort column, decode only as far as the page
// needs. Exact total when there's no text clause.
async function finishFromCandidates(
  candidates: ItemRow[],
  tagIdsByPath: Map<string, string[]>,
  q: LinkQuery,
  limit: number,
  exclude: Set<string>,
): Promise<RestResult> {
  const column = q.sortOn === 'createdAt' ? 'itemCreatedAt' : 'itemUpdatedAt';
  const descOrder = q.sortOrder === 'desc';
  const survivors = candidates.filter(
    (r) => !exclude.has(r.path) && columnMatches(r, tagIdsByPath.get(r.path) ?? [], q),
  );
  survivors.sort((a, b) => {
    const av = a[column] ?? 0;
    const bv = b[column] ?? 0;
    if (av !== bv) return descOrder ? bv - av : av - bv;
    // Path tiebreak, matching the ordered-index scans' explicit `path` order.
    return descOrder ? (a.path < b.path ? 1 : -1) : a.path < b.path ? -1 : 1;
  });

  if (!hasTextClause(q)) {
    return {
      links: decodeLinks(survivors.slice(0, limit)),
      total: survivors.length,
      hasMore: survivors.length > limit,
    };
  }

  if (needsExtractionJoin(q)) return finishWithExtractionSearch(survivors, q, limit);

  // url-only text: filter on the decoded link, no extraction join needed.
  const links: LinkItem[] = [];
  for (const row of survivors) {
    const link = decodeCachedLink(row);
    if (link && urlMatches(link, q)) {
      links.push(link);
      if (links.length > limit) break; // one past the page → hasMore
    }
  }
  return { links: links.slice(0, limit), total: undefined, hasMore: links.length > limit };
}

// Finish an EXTRACTION-dependent search page (`title`/`text` clause) — web's
// `finishWithExtractionSearch`: url-filter the decoded survivors, bulk-join
// their extractions, apply the title + text clauses, page.
async function finishWithExtractionSearch(
  survivors: ItemRow[],
  q: LinkQuery,
  limit: number,
): Promise<RestResult> {
  const urlPassed: LinkItem[] = [];
  for (const row of survivors) {
    const link = decodeCachedLink(row);
    if (link && urlMatches(link, q)) urlPassed.push(link);
  }
  const exRows = await bulkGetItems(urlPassed.map((l) => extractionPathForLink(l.path)));
  const links: LinkItem[] = [];
  for (let i = 0; i < urlPassed.length; i++) {
    const exRow = exRows[i];
    const extraction = exRow ? decodeCachedExtraction(exRow) : undefined;
    if (titleMatches(urlPassed[i], extraction, q) && textMatches(urlPassed[i], extraction, q)) {
      links.push(urlPassed[i]);
      if (links.length > limit) break; // one past the page → hasMore
    }
  }
  return { links: links.slice(0, limit), total: undefined, hasMore: links.length > limit };
}

// The page of NON-pinned links before the pinned overlay is prepended and the
// page identity is stamped — web's `RestResult`, verbatim.
interface RestResult {
  links: LinkItem[];
  total?: number;
  hasMore: boolean;
}

// One keyset-ordered chunk of the all-links scan: rows strictly AFTER
// `(afterValue, afterPath)` in the sort order, `IS NOT NULL` on the sort
// column (the sparse-index analogue). The explicit `(column, path)` compare is
// what lets the next chunk resume without overlap — the SQLite form of
// advancing a Dexie cursor.
function scanChunk(q: LinkQuery, after: { value: number; path: string } | undefined): ItemRow[] {
  const sortCol = sortColumnOf(q.sortOn);
  const descOrder = q.sortOrder === 'desc';
  const order = descOrder ? desc : asc;
  let cursorCond: SQL | undefined;
  if (after) {
    cursorCond = descOrder
      ? sql`(${sortCol} < ${after.value} OR (${sortCol} = ${after.value} AND ${items.path} < ${after.path}))`
      : sql`(${sortCol} > ${after.value} OR (${sortCol} = ${after.value} AND ${items.path} > ${after.path}))`;
  }
  return getDb()
    .select()
    .from(items)
    .where(and(eq(items.itemType, 'link'), isNotNull(sortCol), cursorCond))
    .orderBy(order(sortCol), order(items.path))
    .limit(SCAN_CHUNK)
    .all();
}

// One page of the link library for `query` MINUS `exclude` — web's `readRest`:
// same driver choices, same totals policy.
//   - single list / no filters → indexed fast path (exact count).
//   - positive tag clause → drive the junction, finish over that subset.
//   - anything else → keyset-chunked ordered walk applying every clause,
//     stopping at the page; total is non-exact.
async function readRest(
  query: LinkQuery,
  limit: number,
  exclude: Set<string>,
): Promise<RestResult> {
  const onlyLists =
    clauseEmpty(query.tags) &&
    clauseEmpty(query.url) &&
    clauseEmpty(query.title) &&
    clauseEmpty(query.text);

  if (onlyLists && query.lists.none.length === 0) {
    if (query.lists.any.length === 1) {
      return rangeFastPath(eq(items.itemListId, query.lists.any[0]), query, limit, exclude);
    }
    if (query.lists.any.length === 0) {
      return rangeFastPath(eq(items.itemType, 'link'), query, limit, exclude);
    }
  }

  // Most selective positive clause is a tag: drive the junction. `any` is an OR
  // membership; for an `all`-only query we drive on the first tag and let
  // `columnMatches` enforce the rest — web's tagDriver, verbatim.
  const tagDriver = query.tags.any.length > 0 ? query.tags.any : query.tags.all.slice(0, 1);
  if (tagDriver.length > 0) {
    const pathRows = getDb()
      .selectDistinct({ path: itemTagIds.path })
      .from(itemTagIds)
      .where(inArray(itemTagIds.tagId, tagDriver))
      .all();
    const candidates = (await bulkGetItems(pathRows.map((r) => r.path))).filter(
      (row): row is ItemRow => row !== undefined,
    );
    const tagIdsByPath = loadTagIdsByPath(candidates.map((r) => r.path));
    return finishFromCandidates(candidates, tagIdsByPath, query, limit, exclude);
  }

  // A title/text clause can't be filtered without the join: gather every
  // column-filtered survivor in sort order (chunked walk), then join + filter +
  // page — the same materialization web pays for this search.
  if (needsExtractionJoin(query)) {
    const survivors: ItemRow[] = [];
    let after: { value: number; path: string } | undefined;
    for (;;) {
      const rows = scanChunk(query, after);
      if (rows.length === 0) break;
      const tagIdsByPath = hasTagClause(query)
        ? loadTagIdsByPath(rows.map((r) => r.path))
        : undefined;
      for (const row of rows) {
        if (exclude.has(row.path)) continue;
        if (columnMatches(row, tagIdsByPath?.get(row.path) ?? [], query)) survivors.push(row);
      }
      if (rows.length < SCAN_CHUNK) break;
      const last = rows[rows.length - 1];
      after = { value: sortValueOf(last, query.sortOn), path: last.path };
    }
    return finishWithExtractionSearch(survivors, query, limit);
  }

  // No positive tag clause and no title/text clause: walk all links in sort
  // order, filtering as we go on columns + url (decoded link), stopping once
  // `limit + 1` pass — a bounded slice, not the library.
  const passed: ItemRow[] = [];
  let after: { value: number; path: string } | undefined;
  outer: for (;;) {
    const rows = scanChunk(query, after);
    if (rows.length === 0) break;
    const tagIdsByPath = hasTagClause(query)
      ? loadTagIdsByPath(rows.map((r) => r.path))
      : undefined;
    for (const row of rows) {
      if (exclude.has(row.path)) continue;
      if (!columnMatches(row, tagIdsByPath?.get(row.path) ?? [], query)) continue;
      const link = decodeCachedLink(row);
      if (link === undefined || !urlMatches(link, query)) continue;
      passed.push(row);
      if (passed.length > limit) break outer; // one past the page → hasMore
    }
    if (rows.length < SCAN_CHUNK) break;
    const last = rows[rows.length - 1];
    after = { value: sortValueOf(last, query.sortOn), path: last.path };
  }

  return {
    links: decodeLinks(passed).slice(0, limit),
    total: undefined,
    hasMore: passed.length > limit,
  };
}

function sortValueOf(row: ItemRow, sortOn: LinkSortOn): number {
  return (sortOn === 'createdAt' ? row.itemCreatedAt : row.itemUpdatedAt) ?? 0;
}

// The pinned links that MATCH `query`, in pin-rank order — web's
// `readPinnedOverlay`: read the small `pins/` namespace, look up each pin's
// link row (bulkGetItems preserves rank order), keep those that pass the same
// column + text predicates the rest of the query uses.
async function readPinnedOverlay(
  query: LinkQuery,
): Promise<{ links: LinkItem[]; paths: Set<string> }> {
  const pins = (await readPins()).sort(compareRank);
  if (pins.length === 0) return { links: [], paths: new Set() };

  const rows = await bulkGetItems(pins.map((pin) => pathFromId(pin.id, LINKS_PREFIX)));
  const present = rows.filter((row): row is ItemRow => row !== undefined);
  const tagIdsByPath = hasTagClause(query)
    ? loadTagIdsByPath(present.map((r) => r.path))
    : undefined;
  const hasUrl = !clauseEmpty(query.url);
  const passed: LinkItem[] = [];
  for (const row of rows) {
    if (!row || !columnMatches(row, tagIdsByPath?.get(row.path) ?? [], query)) continue;
    const link = decodeCachedLink(row);
    if (!link || (hasUrl && !urlMatches(link, query))) continue;
    passed.push(link);
  }

  if (!needsExtractionJoin(query)) {
    return { links: passed, paths: new Set(passed.map((l) => l.path)) };
  }

  // Title/text clause: join each pinned link's extraction (pins are few).
  const exRows = await bulkGetItems(passed.map((l) => extractionPathForLink(l.path)));
  const links: LinkItem[] = [];
  passed.forEach((link, i) => {
    const exRow = exRows[i];
    const extraction = exRow ? decodeCachedExtraction(exRow) : undefined;
    if (titleMatches(link, extraction, query) && textMatches(link, extraction, query)) {
      links.push(link);
    }
  });
  return { links, paths: new Set(links.map((l) => l.path)) };
}

// One page for `query`: the pinned matching links first (rank order, always
// whole), then the page of the rest — web's `readLinks`, minus the zone-echo
// wraps (no Dexie zone here; see the header).
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
