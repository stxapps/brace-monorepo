// Memoized decoded links, keyed by `items` path and versioned by the record's
// blob-write timestamp. Lives in its OWN module — not in queries.ts — so the
// sign-out wipe (sync-store's clearSyncData) can clear it without the write/sync
// layer having to import the read layer: this module depends on nothing but a
// type, so both queries.ts (the writer/reader of the cache) and sync-store.ts
// (the clearer) can point at it without inverting the layering.
//
// Why cache at all: decoding a link (parseBlob → JSON.parse + zod) is the costliest
// step of a read, and the live link views (useLiveQuery) re-read and re-decode the
// whole loaded prefix on every `items` write. Memoizing turns that O(loaded) zod
// work per tick into O(changed) — a record is re-decoded only when its bytes change.
//
// Version = the record's `updatedAt` (blob write / R2-LastModified time, db.ts),
// bumped on EVERY write. NOT `itemUpdatedAt` (the display sort key): a re-encrypt,
// conflict merge, or schema migration can rewrite the bytes while leaving that
// untouched, and two records can share it — either would serve a stale decode.
// Links only; the tiny lists/tags/pins namespaces read whole and skip the cache.

import type { LinkItem } from '@/data/queries';

// Bounded so the cache can't grow without limit, but MAX sits WELL ABOVE the
// largest plausible loaded working set (a fully-scrolled large library), so for
// normal libraries eviction never fires — the cache effectively holds the whole
// resident set, and only an outlier library past MAX distinct links ever evicts.
// Sizing it under the working set would be self-defeating: a fully-expanded 10k
// list re-reads all 10k each reactive tick (useLiveQuery), and a too-small cache
// would evict on-screen entries and re-decode them on the very next tick (thrash).
//
// Eviction is INSERTION (FIFO) order, not true LRU. Recency tracking would cost a
// Map delete+set on every cache HIT — and a hit happens for ~every resident link
// on every tick, i.e. tens of thousands of Map ops per refresh on a big list. The
// hot path here is all-hits, so that bookkeeping is pure overhead; and since MAX
// is above the working set, eviction almost never runs, so FIFO behaves the same
// as LRU in practice while costing nothing on reads.
const MAX = 50000;
const cache = new Map<string, { version: number; link: LinkItem }>();

// A live entry for `path` whose bytes haven't changed since it was cached, or
// `undefined` (miss / stale) — the caller then decodes and `setCachedLink`s. No
// recency bookkeeping (see the FIFO note above): a hit is a single Map lookup.
export function getCachedLink(path: string, version: number): LinkItem | undefined {
  const hit = cache.get(path);
  if (!hit || hit.version !== version) return undefined;
  return hit.link;
}

export function setCachedLink(path: string, version: number, link: LinkItem): void {
  cache.set(path, { version, link });
  if (cache.size > MAX) {
    cache.delete(cache.keys().next().value as string); // evict oldest-inserted (FIFO)
  }
}

// Drop one entry — used when a record's bytes go absent/unparseable, so a later
// re-appearance isn't masked by a stale decode.
export function dropCachedLink(path: string): void {
  cache.delete(path);
}

// Drop every cached decode — called from clearSyncData on sign-out (alongside the
// `items` wipe it mirrors), so a second user on the same device can't read the
// first's decoded bookmarks.
export function clearDecodeCache(): void {
  cache.clear();
}
