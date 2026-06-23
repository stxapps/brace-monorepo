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
// Version = the PAIR (`updatedAt`, `itemUpdatedAt`). Neither alone tracks every
// byte change, but the two axes cover each other's blind spot:
//   - `updatedAt` (server R2-LastModified, db.ts) is restamped by sync — download,
//     commit, conflict merge, migration — but the local write edge FREEZES it at
//     the pre-edit base (mutations.ts keeps it for reconcile), so a local edit
//     before sync leaves it unchanged. `updatedAt` alone would serve a stale
//     decode across that whole window.
//   - `itemUpdatedAt` (the in-blob "date modified", projection.ts) is bumped by
//     every local edit, catching exactly that window. It can't drift from the
//     bytes — the projector recomputes it in the SAME `put` that writes `data` —
//     and the read path ALREADY depends on it being current: it backs the
//     `[itemType+itemUpdatedAt]` / `[itemListId+itemUpdatedAt]` sort indexes
//     (db.ts), so a stale value would mis-order the views, not just the cache.
//     But a server-side rewrite can change the bytes while leaving it untouched
//     (a merge/migration that keeps the modified time), so it's insufficient solo.
// Together they're airtight: a local edit moves `itemUpdatedAt`; any server rewrite
// moves `updatedAt`. (A content hash would also work but costs an O(bytes) pass per
// resident link per reactive tick — pure overhead on the all-hits hot path.)
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
const cache = new Map<string, { updatedAt: number; itemUpdatedAt: number; link: LinkItem }>();

// A live entry for `path` whose bytes haven't changed since it was cached, or
// `undefined` (miss / stale) — the caller then decodes and `setCachedLink`s. Stale
// iff EITHER version axis moved (see the header). No recency bookkeeping (see the
// FIFO note above): a hit is a single Map lookup and two integer compares.
export function getCachedLink(
  path: string,
  updatedAt: number,
  itemUpdatedAt: number,
): LinkItem | undefined {
  const hit = cache.get(path);
  if (!hit || hit.updatedAt !== updatedAt || hit.itemUpdatedAt !== itemUpdatedAt) return undefined;
  return hit.link;
}

export function setCachedLink(
  path: string,
  updatedAt: number,
  itemUpdatedAt: number,
  link: LinkItem,
): void {
  cache.set(path, { updatedAt, itemUpdatedAt, link });
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
// first's decoded links.
export function clearDecodeCache(): void {
  cache.clear();
}
