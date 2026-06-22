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

import type { Link, List, Pin, Tag } from '@stxapps/shared';
import {
  compareRank,
  ENC_SUFFIX,
  linkSchema,
  LISTS_PREFIX,
  listSchema,
  META_PREFIX,
  PINS_PREFIX,
  pinSchema,
  SYSTEM_LIST_DEFAULTS,
  SYSTEM_LIST_IDS,
  TAGS_PREFIX,
  tagSchema,
} from '@stxapps/shared';

import { db, type ItemRecord } from '@/data/db';
import { dropCachedLink, getCachedLink, setCachedLink } from '@/data/decode-cache';
import { parseBlob } from '@/data/projection';

// A parsed entity always carries its source `items` path — the stable id every
// other layer (op log, pending queue, R2) keys by, and what the UI needs to
// select/edit/delete a row without a second lookup.
export type WithPath<T> = T & { path: string };
export type LinkItem = WithPath<Link>;
export type ListItem = WithPath<List>;
export type TagItem = WithPath<Tag>;
export type PinItem = WithPath<Pin>;

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
  links: LinkItem[];
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
    (def) => storedById.get(def.id) ?? { ...def, path: `${LISTS_PREFIX}${def.id}${ENC_SUFFIX}` },
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

// The text predicates need the decoded link (url/title live inside the blob), so
// these can never be index-served — always a JS post-filter (the "scan for now"
// choice; the scalable upgrade is a write-time `*itemSearchWords` token index).
function textMatches(link: LinkItem, q: LinkQuery): boolean {
  return wordsMatch(link.url, q.url) && wordsMatch(link.title, q.title);
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
function finishFromCandidates(
  candidates: ItemRecord[],
  q: LinkQuery,
  limit: number,
  exclude: Set<string>,
): RestResult {
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

  const links: LinkItem[] = [];
  for (const record of survivors) {
    const link = decodeCachedLink(record);
    if (link && textMatches(link, q)) {
      links.push(link);
      if (links.length > limit) break; // one past the page → hasMore
    }
  }
  return { links: links.slice(0, limit), total: undefined, hasMore: links.length > limit };
}

// The page of NON-pinned links — the driver result before the pinned overlay is
// prepended (so no `pinnedCount` yet) and before `readLinks` stamps the page
// identity (`query`/`limit`). Pinned links are excluded via `exclude`.
type RestResult = Omit<LinksResult, 'pinnedCount' | 'query' | 'limit'>;

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
      return rangeFastPath(index.type, 'meta', limit, exclude);
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

  // No positive tag clause: walk all links newest-first, filtering as we go. The
  // `filter` decodes to test text words and stops once `limit + 1` pass (one past
  // the page detects `hasMore`), so it touches a bounded slice, not the library.
  const records = await db.items
    .where(index.type)
    .between(['meta', Dexie.minKey], ['meta', Dexie.maxKey], true, true)
    .reverse()
    .filter((record) => {
      if (exclude.has(record.path) || !columnMatches(record, query)) return false;
      const link = decodeCachedLink(record);
      return link !== undefined && textMatches(link, query);
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
// namespace, looks up each pin's `meta/{id}.enc` record (bulkGet preserves the
// rank order of the keys), and keeps only those that exist and pass the same
// column + text predicates the rest of the query uses. A pin whose link is gone
// or doesn't match the active view is simply skipped. Returns the decoded links
// and the set of their paths, so `readRest` can exclude them and not double-show.
async function readPinnedOverlay(
  query: LinkQuery,
): Promise<{ links: LinkItem[]; paths: Set<string> }> {
  const pins = (await readPins()).sort(compareRank);
  if (pins.length === 0) return { links: [], paths: new Set() };

  const records = await db.items.bulkGet(pins.map((pin) => `${META_PREFIX}${pin.id}${ENC_SUFFIX}`));
  const links: LinkItem[] = [];
  const paths = new Set<string>();
  const hasText = hasTextClause(query);
  for (const record of records) {
    if (!record || !columnMatches(record, query)) continue;
    const link = decodeCachedLink(record);
    if (!link || (hasText && !textMatches(link, query))) continue;
    links.push(link);
    paths.add(record.path);
  }
  return { links, paths };
}

// One page for `query`: the pinned matching links first (rank order, always whole),
// then the page of the rest. `limit`/"show more" pages only the rest — pins are
// few and never paginated. The pinned set is excluded from the rest so a link
// never appears twice, and folded into `total` when the rest's total is exact.
export async function readLinks(query: LinkQuery, limit: number): Promise<LinksResult> {
  const overlay = await readPinnedOverlay(query);
  const rest = await readRest(query, limit, overlay.paths);
  return {
    links: [...overlay.links, ...rest.links],
    pinnedCount: overlay.links.length,
    total: rest.total === undefined ? undefined : overlay.links.length + rest.total,
    hasMore: rest.hasMore,
    query,
    limit,
  };
}
