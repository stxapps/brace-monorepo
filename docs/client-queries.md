## reading & paginating the link library

How the link views read from the local store fast, stay live, and paginate at a
few-thousand-link scale. See [architecture.md](./architecture.md) for the package
layering and [local-first-sync.md](./local-first-sync.md) for how those links got
into IndexedDB in the first place (encrypted blob per file → decrypted local
store). This doc is about the **read** edge: `apps/brace-web/src/data/queries.ts`
(the typed read layer), the indexes in `data/db.ts` that serve it, the
`data/decode-cache.ts` memo, and the virtualized layouts under
`app/(app)/links/_layouts/`.

The decisive constraint is **scale on one device**: a user can save several
thousand links, all resident in IndexedDB, and the UI reads from that store on
every render — never the network. So the read path has to avoid O(library) work
on each reactive tick, and pagination has to avoid materializing the whole
library into memory.

### IndexedDB indexes do the heavy lifting

A link's authoritative data is an **opaque encrypted blob** (`data` on the
`items` record). You can't index or query ciphertext, so the few fields a list
view sorts and filters on are **projected** out of the blob into plain indexed
columns by the single write-edge projector (`data/projection.ts` `toItemRecord`),
written in the same `put` as the blob so they can never drift from it. db.ts
declares:

```
path, updatedAt,
[itemType+itemUpdatedAt], [itemType+itemCreatedAt],
[itemListId+itemUpdatedAt], [itemListId+itemCreatedAt],
*itemTagIds
```

- The **compound indexes** turn "newest links in this list/everywhere" into an
  ordered index range walk that materializes only the page shown, instead of
  reading + `JSON.parse`-ing every blob to sort in memory. Each sort dimension
  (`updatedAt` = date modified, `createdAt` = date added) has its own pair.
- The **`*itemTagIds` multiEntry index** answers tag membership without a scan.
- `updatedAt` (the blob's write / R2-LastModified time) is **distinct** from
  `itemUpdatedAt` (the user-meaningful display sort key) — the former versions
  the bytes, the latter orders the view. This distinction matters again for the
  decode cache below.

`queries.ts` `readRest` picks the cheapest driver for the clauses present: a
single positive list (or no filter) walks one compound index with an exact
`.count()` total (`rangeFastPath`); a positive tag clause drives the
`*itemTagIds` index and finishes over that subset (`finishFromCandidates`);
anything else (multi-list, `none`, text words) walks the all-links ordered index
and filters/decodes lazily, stopping at the page. **Text predicates
(`url`/`title` words) live inside the blob, so they can never be index-served** —
they're always a JS post-filter on the decoded link, and the total is non-exact
under search.

### liveQuery + virtual scrolling

Two libraries carry the UI:

- **Dexie `useLiveQuery`** (`_hooks/use-links.ts`) subscribes the view to the
  query. It re-runs `readLinks(query, limit)` whenever `query`/`limit` change
  **and on every `items` write**, so the list stays consistent with local edits
  and incoming sync with no manual invalidation.
- **`@tanstack/react-virtual`** (the list/card/table layouts) mounts only the
  rows in view, so rendering a large result set stays cheap regardless of how
  many links matched.

These compose: `useLiveQuery` produces the current array, the virtualizer renders
a window of it. Both are reactive, so a write refreshes the data and the visible
rows together.

### pagination: growing `limit` + a decode cache

The current model is deliberately the **simplest thing that works for every
query kind**:

- `useLinks` holds one `limit` (starts at `PAGE_SIZE`); "show more" grows it by
  `PAGE_SIZE` and `useLiveQuery` re-runs `readLinks` for the larger page.
- `readLinks` always returns the **pinned overlay** whole (pins are few, never
  paginated) followed by the page of the rest, with pins excluded from the rest
  so nothing double-shows.

The one optimization on top is the **decode cache** (`data/decode-cache.ts`).
Because `useLiveQuery` re-reads the whole loaded prefix on every write, and
decoding a link (`parseBlob` → `JSON.parse` + zod) is the costliest step of a
read, re-decoding that prefix on every tick is O(loaded) zod work per keystroke
or sync. The cache memoizes decoded links keyed by `path` and **versioned by
`record.updatedAt`** (the blob-write timestamp — bumped on every write; *not*
`itemUpdatedAt`, which a re-encrypt/merge/migration can leave untouched while the
bytes change). That turns re-decode into O(changed): only records whose bytes
actually changed re-parse. It's bounded (FIFO-evicted, with the cap set well
above any plausible resident set so eviction effectively never fires), and it's
cleared on sign-out from
inside `clearSyncData` — co-located with the `items` wipe it mirrors, so a second
user on the device can't read the first's decoded plaintext.

**Why this is good enough.** It's a handful of lines, one mental model, and it
works **identically for every query** — single-list browse, tag filters, text
word search, multi-clause combinations — because pagination is just "read the top
N of whatever the driver produced." Nothing about it special-cases the hard
queries. At a few thousand links the residual cost (re-*reading* — not
re-decoding — the prefix bytes from IndexedDB each tick) is comfortably fast.

### the pinned overlay (pin-to-top)

Pinned links float to the top of **every view they appear in**. They live in
their own small `pins/` namespace (one pin per link, LWW-isolated — see the
[pin-to-top design](./local-first-sync.md) note), not as a flag on the link, so
`readLinks` composes them as an **overlay** on top of whatever the driver
produced rather than threading a pin column through every index path:

```ts
const overlay = await readPinnedOverlay(query);          // pinned matches, rank order
const rest    = await readRest(query, limit, overlay.paths); // page, pins excluded
return {
  links: [...overlay.links, ...rest.links],
  pinnedCount: overlay.links.length,
  total: rest.total === undefined ? undefined : overlay.links.length + rest.total,
  hasMore: rest.hasMore,
};
```

Four properties hold, and they're worth stating because they're what keep the
overlay from quietly corrupting counts or duplicating rows:

- **No limit, no pagination on pins.** `readPinnedOverlay` returns the *whole*
  set of matching pins every time; `limit`/"show more" grows only the rest. This
  is safe precisely because pins are few by design (a user pins a handful), so
  there's no page to bound — reading them all is cheap and they always render
  even before the first "show more". The overlay still applies the *same* column
  + text predicates as the active query (`columnMatches` / `textMatches`), so a
  pinned link that doesn't match the current list/tag/search filter is skipped,
  not force-shown.
- **Excluded from the rest.** The overlay hands `readRest` the set of pinned
  `paths`, and every driver drops them (`exclude`), so a pinned link that would
  *also* fall in the normal page never shows twice — it appears once, at the top.
- **Total stays the same.** Because the pinned links are *moved*, not added,
  `total` must be unchanged by pinning. The rest's total already excludes them,
  so the overlay folds its own count back in: `overlay.links.length +
  rest.total`. (When the rest's total is `undefined` — text search can't count
  without decoding the whole match set — the combined total stays `undefined`;
  pinning doesn't rescue an inexact total.)
- **`pinnedCount` is the boundary, not a separate list.** Rather than return two
  arrays, `readLinks` concatenates pinned-then-rest into one `links` array and
  reports how many leading entries are pinned. That single number is what the UI
  draws its pinned section divider and its menu-based "move up · move down"
  reorder affordances at (there's no drag-and-drop — see the design note). One
  array keeps the virtualizer and the decode cache working uniformly across the
  whole result; `pinnedCount` is just where the view splits it.

The overlay reuses the existing read primitives — `decodeCachedLink` for the
same memoized decode, `columnMatches`/`textMatches` for the same filters — so it
adds no new query path and no special-casing in the drivers. It's the same "read
the top of whatever matched" model as the rest, with the pinned matches simply
read in full and stitched on first.

### why the re-read cost rarely materializes

The one cost the decode cache doesn't address is the **re-read**: every `items`
write re-runs `readLinks(query, limit)`, which re-reads the top `limit` records'
blobs from IndexedDB regardless of how few changed (cost is O(loaded), not
O(changed)). At a fully-expanded large list that's tens of ms per tick. In
practice three things keep you off that path:

- **`InitialSyncGate` absorbs the one bulk event.** The first device pull writes
  the whole library, but the gate holds the app subtree back (the
  "Decrypting your links…" screen) until the store is `ready` — so the link
  view's `useLiveQuery` isn't even mounted during those thousands of writes,
  and nothing re-reads on each one. IndexedDB persists, so this full pull happens
  **once per device**; every later session syncs small deltas against the
  resident store.
- **The list starts at `PAGE_SIZE`.** `useLinks` mounts at one page and only
  reaches a large `limit` through deliberate "show more" clicks, so the live view
  usually holds a few hundred rows — re-runs are cheap. The expensive
  large-`limit` state is uncommon by construction.
- **Background syncs are small.** A delta commit writes a handful of records and
  fires few re-runs.

The residual cost therefore only surfaces in a specific corner: the user has
**manually expanded near the full library** *and* a **burst of writes** arrives
(a chatty background sync, or heavy local editing at that depth) — each re-run
then re-reads the whole expanded prefix. That combination is rare enough that
windowing (below) isn't worth its complexity yet; if profiling on real libraries
shows it biting, that's the trigger to revisit.

### alternatives deliberately not built (yet)

Three more sophisticated approaches were considered and **rejected for now** —
each buys something real but adds complexity or forks the read path, and none
pays off at the current scale. Documented here so the trade-offs don't have to be
re-derived.

**Key-bound (value-anchored) reads** — page by growing the index key bound
instead of the count. *Pro:* the loaded window is anchored to a stable key, so an
insert/delete above the scroll position doesn't make the bottom boundary
flicker/drift the way a position-anchored `limit` window can. *Con:* under
`useLiveQuery` it re-reads and re-decodes the same prefix as growing-`limit` — so
it's **no cheaper**, only marginally more stable, and adds cursor-tracking and
tie-break handling (the compound indexes have no `path` tiebreaker). Not worth the
complexity for a stability nicety.

**Windowed `liveQuery`** — size the virtualizer to the exact total and fetch only
the visible slice (`offset(start).limit(window)`), re-querying as the user
scrolls. *Pro:* flat memory and flat decode at any depth, plus a true full-range
scrollbar (random access / jump to middle). *Con:* `.offset(n)` is O(n) in Dexie
(deep jumps walk and discard n entries); the window re-subscribes on nearly every
scroll tick, causing "Loading…" flicker on fast scroll; and it **only works on
the index-served browse path** — tag/text queries must materialize their match
set anyway, and text has no exact total to size the scrollbar with. It would fork
`readLinks` into two paths. Best reserved for tens-of-thousands or a hard
random-access-scrollbar requirement.

**Pagination on the URL path** (numbered `?page=N` pages, e.g. for the table
layout) — chunk-by-chunk `offset+limit` queries with a numbered pager. *Pro:*
structurally bounded memory/decode (one chunk, never accumulating) and shareable
page URLs. *Con:* a numbered pager needs an **exact total**, which only the
index-served fast path provides — under text search the total is `undefined`, so
the pager degrades to next/prev; pins would need page-1-only handling; offset
drifts under concurrent writes; and it forks the read path + UI for the table
while the other layouts stay infinite-scroll. Only worth it behind a specific
product need (shareable page URLs, jump-to-page, or a flat-memory requirement).

The common thread: the current approach is the only one that's both **simple**
and **uniform across all query kinds**. The alternatives optimize the browse
fast path at the cost of complexity, scroll-time UX, or a second code path for
search/tag/pinned queries — so they wait until profiling or a product requirement
forces the issue.
