## local-first sync

How brace keeps data on the device as the source of truth and syncs end-to-end
encrypted files to the server. See [architecture.md](./architecture.md) for the
package layering, [api-contracts.md](./api-contracts.md) for the contract-first
endpoint pattern this builds on, and [account.md](./account.md) for the
password-derived data key (`@stxapps/web-crypto`) that protects every blob
described here.

### the shape of the problem

brace is **local-first**, with **one entity per encrypted file** and
**end-to-end encryption**:

- an entity (a bookmark's metadata, its content/archive, a tag, a list, the
  settings) is encrypted on the client, then uploaded as an opaque blob to
  storage (Cloudflare R2) via a signed URL;
- on download, the blob is fetched, decrypted, and written to a local store
  (IndexedDB via Dexie);
- the UI reads from the local store, never from the network.

The decisive constraint is that **the server only ever sees ciphertext.** The
Hono/Workers API and R2 cannot read, index, query, diff, or conflict-resolve on
content. That rules out the server-intelligent local-first frameworks
(ElectricSQL, PowerSync, TanStack DB) — their value is server-side knowledge of
your data, which E2E encryption forbids — and makes the key-value / document
sync engines (Replicache, RxDB replication) an awkward fit, since our transport
is "encrypted blob per file via signed URL," not row/document sync. This is the
Gaia/Blockstack per-file encrypted-storage model — well-trodden ground.

So the data path splits into **two layers**: we use a library for the local
store and hand-roll the file-sync engine. Don't conflate "don't use a sync
framework" with "build everything from scratch."

```
UI ──reads──▶ local store (IndexedDB) ◀──writes── sync engine ──▶ Hono API / R2
   ◀reactive──┘   [LIBRARY: Dexie]                  [HAND-ROLLED]
                                          encrypt before PUT / decrypt after GET
```

### layer 1 — local store + reactivity (use a library)

This is the cache and the source of truth for reads. The UI subscribes to it and
re-renders when sync writes land. **Don't rebuild IndexedDB plumbing by hand.**

- **Dexie** (IndexedDB) — `liveQuery` for reactive reads; simplest and most
  flexible. The preferred default.
- stores **decrypted** entities for fast local reads;
- exposes **reactive queries** so components update when the store changes;
- owns only on-device data — no network concerns leak in here.

Dexie holds:

- decrypted bookmark metadata, tags, lists, settings (the always-resident index);
- decrypted content/archive blobs (fetched lazily, on demand);
- `syncCursor` — the newest R2 `LastModified` the client has reconciled (a
  timestamp, the high-water mark for the next incremental pull — see *the sync
  endpoint*);
- the **pending-ops queue** — local mutations not yet committed to the server
  (this is what makes offline writes durable and drives crash recovery); each
  entry carries the **base `updatedAt`** the edit started from (the path's stored
  server timestamp at edit time), which reconcile uses to tell a clean
  fast-forward from a true conflict (see *a sync cycle*);
- per-path **R2 `updatedAt`** — the server-assigned `LastModified` for each file,
  used by both incremental apply and the fallback comparison (see below).

### layer 2 — sync engine (hand-roll)

Runs at the app/background level, not component-scoped. It owns the sync cursor,
the crypto boundary (encrypt before PUT / decrypt after GET via
`@stxapps/web-crypto`; plaintext never crosses the network), the upload queue
(with retry/backoff and offline handling), and the conflict policy.

It talks to the API through the shared **contract client** (see
[api-contracts.md](./api-contracts.md)). Because it runs outside React, it calls
`callEndpoint` directly — no hooks:

```ts
import { callEndpoint, opsListEndpoint } from '@stxapps/shared';
const { ops, oldestUpdatedAt, newestUpdatedAt, hasMore } = await callEndpoint(
  { baseUrl: API_URL },
  opsListEndpoint,
  // the cursor is the compound (updatedAt, path), not a seq — see *the ops/list endpoint*
  { since: syncCursor, sincePath: syncCursorPath, limit: 500 },
);
```

The whole control plane is **four endpoints**, two per resource — `ops` (the
op-log entries) and `files` (the R2 objects):

```
GET  /v1/ops/list      incremental pull: ops since the cursor      (→ the ops/list endpoint)
POST /v1/ops/commit    record a committed mutation (HEADs R2)      (→ the three flows: push)
GET  /v1/files/list    fallback full R2 listing (download-truth)   (→ fallback full sync)
POST /v1/files/sign    mint presigned R2 URL(s); op: 'put' | 'get' (→ authorization & quota)
```

The blob bytes themselves never touch the API — the client PUTs/GETs R2 directly
over a `files/sign` URL. So `files/sign` is the **only** endpoint on the hot path
of bulk data, and it's deliberately a thin envelope check (ownership + quota), not
a content gateway.

### storage layout

**Cloudflare R2** (private bucket; all access via signed URLs). One entity = one
encrypted file. Random ids — never content-derived — so filenames leak nothing:

```
/users/{uid}/meta/{id}.enc        ← encrypted bookmark metadata (small, < ~2 KB)
/users/{uid}/files/{id}.enc       ← encrypted content / archived page / screenshot
/users/{uid}/tags/{id}.enc        ← encrypted { id, name, updatedAt }
/users/{uid}/lists/{id}.enc       ← encrypted { id, name, updatedAt }
/users/{uid}/settings/general.enc ← encrypted general user settings
```

A bookmark's metadata references the other files by id; the reference graph lives
**inside** the ciphertext, so the server never sees it:

```json
{
  "title": "Some Article",
  "url": "https://...",
  "tags": ["tag_id_1", "tag_id_2"],
  "list": "list_id_1",
  "pageArchive": "{id}.enc",
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Per-user op log** lives in a **Cloudflare Durable Object** (one DO per user,
addressed by `idFromName(userId)`), backed by the DO's SQLite. See
`apps/brace-api/src/do/user-data.ts` and `do/repositories/op-logs.ts`. Each row is
`{ seq, op: 'put' | 'delete', path, size, updated_at }`, where **`updated_at` is
R2's `LastModified`** for that path (read via a `HEAD` at commit — see *push*),
and the **client's sync cursor is that timestamp**, never `seq`.

`seq` (`INTEGER PRIMARY KEY AUTOINCREMENT`) stays **internal**: it orders rows
that share a millisecond and drives compaction, but it never goes over the wire.
Keeping the cursor on R2's clock rather than on `seq` is deliberate — a sequence
number is only meaningful inside one DO's lifetime and **cannot be reconstructed
from an R2 listing**, so a DO rebuild or a fallback would have no valid seq to
resume from. An R2 timestamp always can: the newest `LastModified` in a listing
*is* the cursor. A DO rebuild or seq reset therefore can't invalidate a client
cursor, and a wiped log is rebuildable from R2.

### source of truth: R2 is truth, the op log is an accelerator

**R2 is the source of truth. The op log is a derived accelerator that may be
empty.** This one sentence resolves most of the edge cases below: if the op log
is wiped or compacted, clients fall back to listing R2 and lose nothing but
speed.

The op log exists only to make incremental sync fast (pull "what changed since
timestamp T" instead of listing every file). It is safe to compact aggressively —
**keep the last 30 days or the last 10 000 ops per user, whichever is more** —
and safe to lose entirely.

The critical invariant, and the reason the commit protocol is ordered the way it
is:

> **The op log may lag R2, but must never point ahead of it.**

- `object-without-op` (an R2 object with no op-log entry — e.g. a commit died
  after the R2 PUT) is **tolerable**: it is invisible to incremental pull but
  reconciled by the fallback list.
- `op-without-object` (an op-log entry whose R2 object doesn't exist) is **much
  worse**: every client that pulls that op tries to download a 404.

That asymmetry is exactly why `appendOp` runs **after** the R2 write succeeds
(see the `appendOp` comment in `user-data.ts`).

### data model: everything is one entity per file

Bookmarks, content blobs, **tags, lists, and settings are all just files**, and
all sync through the identical code path: last-writer-wins per file, `put` /
`delete` ops, the same upload queue. There is no special "merge by key" logic for
tag/list names.

- **Tags and lists** are stored one per file (`tags/{id}.enc`,
  `lists/{id}.enc`), each holding `{ id, name, updatedAt }`. Bookmark metadata
  stores only the **ids**, so renaming a tag/list rewrites one small file and
  touches no bookmarks. Rename = `put`; delete = `delete`. This is what lets two
  devices rename two *different* tags concurrently without clobbering each other
  — a single shared `tags.enc` file under LWW could not.
- **Settings use a fixed `settings/` namespace** (`settings/general.enc` today).
  Unlike every other file — a random id (see *storage layout*) — these are
  **well-known paths** baked into client code, the one non-random-id family.
  Splitting by concern under `settings/` rather than one monolithic `settings.enc`
  is the same LWW-isolation move as tags/lists: a separately-written concern can
  later get its own `settings/<concern>.enc` so an unrelated settings edit on
  another device can't clobber it. Because the paths are fixed, **adding** a new
  `settings/<concern>.enc` needs no migration; renaming an existing one would.
- **Dangling ids are normal and must be tolerated.** Deleting `tags/{id}.enc`
  leaves bookmark metadata that still lists that id; a content file referenced by
  metadata may not be downloaded yet. In both cases the UI must **skip the
  unknown/absent reference and render the rest**, never error. No referential
  cleanup is required — LWW plus tolerant rendering covers it.
- **Metadata vs. content.** Metadata is small (`< ~2 KB`) and always synced into
  the local index; content/archives download **lazily, never on first sync**. The
  list-view fields (title, URL, tags, list, a truncated preview) live in metadata,
  so the **whole library is browsable and searchable offline** after first sync —
  only heavy media is deferred. Keep large fields (long descriptions, notes,
  thumbnails) **out of metadata** — store them as separate `files/{id}.enc`; never
  inline a thumbnail, or you blow the `< 2 KB` budget. Two lazy triggers:
  **viewport/scroll** fetches per-row media (thumbnail/screenshot) as rows come
  into view (prefetch slightly ahead); **open** fetches the full archived page.
  Each fetched blob is decrypted once and **cached in Dexie**, so re-views are
  instant and offline. The one tradeoff: a never-opened archive isn't available
  offline (see *deferred* — offline pinning).

### the three flows

**1. First sync (after sign-in).** Pull the full set of metadata/tag/list paths,
download + decrypt each, build the local index. Content/archives are *not*
downloaded here — they come on demand. For 5 000 bookmarks at ~500 bytes of
metadata each that's ~2.5 MB — manageable. Set `syncCursor` to the **newest
`updatedAt` among the files listed**.

**2. Incremental sync (next visit).** Call `GET /v1/ops/list` with `syncCursor`,
get the ops whose `updatedAt` is newer than the cursor, apply them (download +
decrypt + store for `put`, remove for `delete`), and advance `syncCursor` to the
**newest `updatedAt` in the response** (not the server's current newest — anything
that lands mid-sync simply carries a later `updatedAt` and is caught next time;
this is why the race in older drafts is a non-issue).

**3. Push (new / edited / deleted entity).** Write to the local store first and
enqueue the mutation in the pending-ops queue, then drain the queue:

```
create / edit a bookmark:  upload content files first, metadata file LAST
delete a bookmark:         delete metadata first, then content files
```

The per-file commit protocol (3 round-trips):

1. `POST /v1/files/sign` with `{ op: 'put', paths: [...] }` to mint signed upload
   URL(s) (the Worker verifies each path is under `/users/{authedUid}/` and checks
   quota — see *authorization & quota*);
2. encrypt and PUT the blob directly to R2 via the signed URL;
3. `POST /v1/ops/commit` with the uploaded path; the Worker **`HEAD`s the object**
   — which both confirms it exists in R2 and reads R2's authoritative
   `LastModified` — records the op with that timestamp (`appendOp`), and returns
   `{ updatedAt }`. The `HEAD` does double duty: existence check *and* the single
   clock that incremental and fallback both compare against.

The pending-ops entry stays in the queue until step 3 returns. **Crash recovery
falls out of this for free:** if the client dies between the R2 PUT and the
commit, the entry is still queued; on retry it re-PUTs (harmless — a fresh IV,
but R2 PUTs are atomic so it just overwrites with equivalent ciphertext) and
commits. **Commit is idempotent in effect:** re-committing a path appends another
op row (the log isn't deduped on write), but applying any op just means
"re-download the latest version of that path," so a duplicate costs one redundant
download and nothing else — server-side op coalescing (see *deferred*) trims the
extra rows later. Never fail a commit on a duplicate path.

The store records the **R2 `LastModified` returned by commit** as the file's
`updatedAt` and advances `syncCursor` to it — never the local clock. Every `put`
is therefore stamped on R2's clock — the same value the client stores locally and
the fallback listing reads back — so there is no cross-device skew to reconcile
for any write that has a surviving object. (A `delete` op has no surviving object
to `HEAD`, so its `updated_at` is the **deletion commit time** — a `deletedAt` —
on the Worker's clock rather than R2's; the `updated_at` column thus mixes the two
clocks. That mismatch is harmless because paths are **immutable random ids**: a
path's life is only ever `put`…`put`…`delete`, never `delete`→`put`, so the two
clocks never have to order a put against a delete on the same path, and nothing
can be resurrected by skew.)

### the ops/list endpoint

The cursor is a **timestamp — R2's `LastModified`** — not a sequence number (see
*storage layout* for why `seq` stays internal). Strictly it is the **compound key
`(updatedAt, path)`**, so the wire cursor is the pair `since` + `sincePath` (see
*Cursor precision & pagination* below). The pull endpoint returns the ops newer
than the cursor plus the retained-range bounds, so the client can tell incremental
from fallback:

```
GET /v1/ops/list?since=2026-04-13T10:00:00.000Z&sincePath=meta/m_abc.enc&limit=500
→ {
    ops: [{ op, path, updatedAt }, ...],   // ordered by (updatedAt, path)
    oldestUpdatedAt,   // min updated_at still retained — null on an empty log
    newestUpdatedAt,   // max updated_at ever recorded — null on an empty log
    hasMore,
  }
```

`updatedAt` is R2's `LastModified` for a `put` (recorded via the commit `HEAD`)
and the deletion commit time for a `delete` (no surviving object — see *push*).
Both bounds are plain aggregates over the retained rows — `MIN(updated_at)` and
`MAX(updated_at)` — with **no high-water-mark table needed** (unlike a seq):
compaction trims oldest-first and never removes the newest row, so
`MAX(updated_at)` is always the true newest-ever. A never-written log reports
`oldestUpdatedAt = newestUpdatedAt = null`.

Routing:

| condition                                   | meaning                                 | action            |
| ------------------------------------------- | --------------------------------------- | ----------------- |
| `since` unset (never synced)                | new device / new account                | **first sync** (list R2; empty ⇒ nothing to do) |
| `since` set but bounds `null`               | cursor exists, log empty — wiped/reset beneath a returning client | **fallback** sync |
| `since > newestUpdatedAt`                   | cursor ahead of the log — log was reset | **fallback** sync |
| `since < oldestUpdatedAt`                   | ops before the cursor were compacted    | **fallback** sync |
| `oldestUpdatedAt ≤ since ≤ newestUpdatedAt` | normal — run the keyset query           | apply `ops` (empty result ⇒ already up to date) |

What these rows encode — all because **an empty op log never means "no data";
only R2 can answer that** (the log is a disposable accelerator, rebuildable from
an R2 listing):

- **No cursor ⇒ first/full sync** (flow #1 — list R2), never the incremental
  path. So "nothing to do" is only reached after actually listing R2 and finding
  it empty — a wiped log can't be mistaken for a new account.
- **A cursor against `null` bounds ⇒ fallback.** A client with a cursor proves it
  synced before, so an empty log (both bounds `null`) means the log was wiped or
  reset under it — re-list R2 rather than reporting "up to date." This is the
  same wiped-log case as the row below, reached when compaction (or a rebuild)
  emptied the log entirely rather than just trimming past the cursor.
- **`oldestUpdatedAt ≤ since ≤ newestUpdatedAt` is inclusive at the top on
  purpose.** `since == newestUpdatedAt` is *not* a separate "up to date" branch:
  because the cursor is the compound `(updatedAt, path)`, the newest millisecond
  can still hold ops with a higher `path` tiebreak the client hasn't seen. So the
  keyset query always runs at the boundary; an empty result is what means "already
  up to date," not the timestamp comparison.
- **`since > newestUpdatedAt` ⇒ fallback**, not "up to date." A healthy server's
  newest timestamp is always ≥ any cursor it issued (the client only stores
  cursors the server minted, and compaction never trims the newest), so a cursor
  ahead of it can't arise in steady state. It means the op log was reset, rebuilt,
  or restored from an older backup beneath a returning client — an infra event the
  disposable-log design *expects*, not necessarily a client bug. Either way,
  re-list R2.

**Cursor precision & pagination.** Because several files can share a millisecond,
the cursor is the compound key `(updatedAt, path)` and the pull is a **keyset**
scan: `WHERE (updated_at, path) > (since, sincePath)` ordered by
`(updated_at, path)`. Both halves go over the wire — the `since` *and* `sincePath`
query params above — because without the `path` tiebreak a single millisecond
holding more than `limit` ops could never be paged past, and the
`since == newestUpdatedAt` boundary couldn't distinguish "consumed every op at
that ms" from "more remain with a higher path." A long-offline client pages
forward by advancing **both** params to the last op's `(updatedAt, path)` while
`hasMore` is true. (`sincePath` is omitted only right after first sync, whose
cursor is a bare newest-`updatedAt` with no tiebreak yet; the server treats a
missing `sincePath` as the low sentinel, so the scan includes every op at that
millisecond.) None of `oldestUpdatedAt` / `newestUpdatedAt` / this keyset query
exists in `op-logs.ts` yet — they're the methods to add (the current
`listSince`/`append` key off `seq`).

> Verify R2's `LastModified` precision before building — `.head()` returns
> `uploaded` as a `Date`; confirm it's millisecond, not second. The
> `(updatedAt, path)` keyset stays correct either way, but coarser granularity
> means more ties to page through.

### a sync cycle: reconcile, then push, then pull

Flows 2 and 3 are building blocks; a live online session with local changes runs
both, and the order matters. **Reconcile first** — you can't safely push before
you know what the server changed, or you'd blind-overwrite a remote edit you never
saw.

1. **Pull the op list** (flow 2's request — metadata only: `{ op, path, updatedAt }`
   per changed path, *not* the blobs).
2. **Reconcile** the pulled ops against the pending-ops queue, partitioning every
   touched path by who changed it. Each pending op carries the **base `updatedAt`**
   it was edited from (the path's stored server timestamp at edit time):
   - **server-only** (no pending op for the path) → **download**;
   - **local-only** (no server op for the path) → **upload**;
   - **both, server `updatedAt` == base** → the server didn't really change it
     (often your own earlier commit echoing back) → **upload** (clean
     fast-forward);
   - **both, server `updatedAt` > base** → a **true conflict**: both sides changed
     the file since your base. Resolve by the LWW policy (see *conflict policy*);
     the accepted outcome today is that one side's edit is dropped silently, and
     the deferred conditional-write upgrade turns this into a detected `412` +
     re-pull. *Which* side wins — local (upload) vs server (download) — is an open
     product call (see *deferred*).
   The output is two **disjoint** sets: paths to upload, paths to download.
3. **Push** the upload set (flow 3 — meta-last; commit returns each new server
   `updatedAt`).
4. **Pull** the download set's blobs (decrypt, store; content stays lazy).
5. Advance `syncCursor` to the newest `updatedAt` seen across the whole cycle —
   **including your own just-committed uploads**, so the next cycle doesn't
   re-fetch them.

Because step 2 resolves each conflicting path to exactly one side, the upload and
download sets never overlap — so steps 3 and 4 are order-independent and may run
concurrently; "push before pull" is just a sensible default (local changes durable
and visible first). A change another device commits *between* the list pull and
your push is a TOCTOU window that degrades to the same accepted LWW overwrite until
conditional writes close it.

### fallback full sync (download-authoritative)

When routing lands on fallback (`since` older than `oldestUpdatedAt`, or ahead of
`newestUpdatedAt`), the op log can't reconstruct what changed, so the client
reconciles directly against R2. The fallback endpoint lists paths with their
`updatedAt` — which is **R2's own `LastModified`** (the timestamp R2 stamps on
every PUT, and the same value the client stores locally on each sync):

```
GET /v1/files/list
→ [ { path: "meta/m_abc.enc", updatedAt: "2026-04-13T10:00:00Z" }, ... ]
```

Using R2's own clock — not a separately-minted timestamp — is what lets fallback
recover a *commit-died edit* (`object-without-op`, case B): the new bytes carry a
fresh `LastModified` in R2 even though no op was ever recorded, so the comparison
below still sees the server copy as newer and re-downloads it.

The fallback is **download-authoritative**: the server list is treated as truth,
so a server-side deletion is never resurrected. The **pending-ops queue** is what
distinguishes a genuine local-origin change from a stale leftover:

| local vs. server                                   | action               |
| -------------------------------------------------- | -------------------- |
| on server, newer `updatedAt` than local (or new)   | **download**         |
| local only, **in** pending-ops queue               | **push** (real edit) |
| local only, **not** in pending-ops queue           | **delete locally** — it was deleted server-side |
| equal `updatedAt`                                   | skip                 |

That third row is what kills the deleted-bookmark-resurrection bug, and it needs
no user prompt. The comparison uses the **stored server `updatedAt`**, never
Dexie's local write time.

After reconciling, set `syncCursor` to the **newest `updatedAt` among the listed
files** — reconstructed straight from R2, with no dependence on the op log — so
the next visit resumes normal incremental sync. In the `since > newestUpdatedAt`
case this lowers the cursor *below* the stale value it had: R2 is the source of
truth, the old cursor pointed past what exists, so it's reset down to reality.
This is the resume a `seq` cursor couldn't give you: there is no sequence number
to recover from an R2 listing, but the newest `LastModified` always is one. (A delete that happened *after* that
newest surviving timestamp leaves no object to carry it, but it was already
reconciled by the download-authoritative pass above, so the cursor needn't
account for it.)

### multi-file consistency & orphans

A bookmark spans 2–3 files (metadata + content + archive). Consistency comes from
two cheap rules, not transactions:

- **upload metadata LAST, delete metadata FIRST.** The metadata file is what
  makes a bookmark "exist," so a half-finished create leaves only orphaned
  content (harmless) and a half-finished delete leaves only orphaned content
  (harmless) — never metadata pointing at a missing file in a way the UI can't
  absorb (and it absorbs dangling ids anyway).
- **R2 object PUTs are atomic**, so even an in-place content *update* never
  yields a torn read: a reader gets the whole old object or the whole new one.
  This is why immutable/versioned content files are **not** needed — meta-last /
  meta-first plus atomic PUT fully cover multi-file consistency.

**Orphans can't be garbage-collected server-side** — the server can't read the
ciphertext to know what's referenced. The only place GC is possible is the
**client**, which holds the key, can decrypt all metadata to compute the
referenced set, and delete the rest. We don't do this yet; the per-user quota
bounds the growth, and orphans are produced only by rare mid-flight failures.

### conflict policy

File-level **last-writer-wins**, which is cheap because granularity is one entity
per file. Accepted tradeoff, written down so it isn't a surprise:

> Two devices editing the **same** file concurrently → the later PUT wins and the
> earlier edit is lost silently.

For a single-user, multi-device manager this is acceptable. The cheap future
upgrade is **R2 conditional writes** (`If-Match` on the etag, or `If-None-Match:
*` for create) baked into the presigned URL, so a stale write `412`s and the
client re-pulls before retrying. Deferred, not designed away.

### crypto boundary & what the server still learns

Every blob is AES-256-GCM under the single data key derived from the account DEK
(see [account.md](./account.md)); `@stxapps/web-crypto`'s `encrypt` uses a
**fresh random 96-bit IV per call**, so one key for all files is safe. Door
changes / password changes re-wrap only the 32-byte DEK and **never re-encrypt
data**, so the sync layer is entirely oblivious to them.

Even with E2E, the server still learns the **number of files, each file's size,
its timestamps, and access patterns** (which blobs are fetched when). It does
**not** learn titles, URLs, tag/list names, or the metadata→content reference
graph (all inside the ciphertext). Keeping metadata uniformly small (`< ~2 KB`)
blunts size correlation. Acceptable for a bookmark manager — named here so it's a
decision, not an accident. (`size` is stored in plaintext in the op log; that's
the same size the server already observes, so no additional leak.)

### authorization & quota

Because the server can't inspect contents, it must enforce policy on the
**envelope**:

- on **every** `POST /v1/files/sign` (both `op: 'put'` and `op: 'get'`), the
  Worker **must verify each requested path is under `/users/{authedUid}/`** —
  otherwise one user could mint a URL for another's path;
- on `op: 'put'`, additionally enforce a **per-user file-count and byte quota** at
  issuance — the only place abuse can be bounded when content is opaque. `op: 'get'`
  needs no quota (reading your own data), so download URLs can be **minted in
  batch** for a fast first sync without per-blob round-trips.

### where TanStack Query fits

The dividing line is **React-component calls vs. the background sync engine**,
not Hono-vs-R2.

**Use it for component-facing API endpoints.** Auth (username check, sign-in,
create-account, session), account settings, a sync-status read — these go through
TanStack Query (`useQuery`/`useMutation`) for uniform loading/error/retry/dedup
state and devtools. Those hooks live in `@stxapps/react` and **wrap
`callEndpoint`**, so the shared contract stays the single source of truth and the
hooks stay reusable on brace-extension and (future) brace-expo.

**Don't use it for the local-first data path.** The Dexie `liveQuery` store is
already the read cache for bookmarks — adding TanStack Query there just creates a
second, competing cache — and the sync engine runs at background/app level, not
in React, so hooks don't apply. Its control-plane calls (sync pull, commit,
signed URLs) and the R2 blob PUT/GET use plain `callEndpoint`/`fetch`; results
land in Dexie, which the UI observes reactively.

In short: **component server calls → TanStack Query; background sync engine + R2
→ plain `callEndpoint`.** Both call the same `@stxapps/shared` contracts.

### deferred

- **R2 conditional writes** for same-file concurrent-edit detection (see
  *conflict policy*) — accepted as LWW for now.
- **True-conflict winner: local-wins vs server-wins** (see *a sync cycle*) — when
  reconcile finds both sides changed a path since the base, local-wins (upload)
  clobbers the other device's committed edit; server-wins (download) discards the
  user's unsynced edit. Open product call; conditional writes make it a prompt
  rather than a silent choice.
- **Client-side orphan GC** (see *multi-file consistency*) — quota bounds growth
  until then.
- **Offline content pinning / prefetch** (see *data model — metadata vs.
  content*) — let users mark bookmarks "available offline," or prefetch archives
  on idle, so a never-opened archive isn't missing offline.
- **Local content-cache eviction** — lazily fetched content/archive blobs
  accumulate in Dexie against the IndexedDB budget; an LRU eviction of *content*
  (metadata is never evicted) keeps it bounded. Distinct from server-side orphan
  GC above.
- **Op-log compaction alarm** — the DO's `alarm()` is the natural driver; see the
  class comment in `user-data.ts`.
- **Manual "repair sync" control** — a user-facing button that forces the
  download-authoritative fallback (see *fallback full sync*) on demand, for the
  rare case where incremental sync is missing data — e.g. an `object-without-op`
  left by a device that never returned to commit. The mechanism already exists;
  this just exposes a trigger, and doubles as a first-line support tool.
- **Server-side op coalescing** — when a path has several ops since the client's
  cursor, return only the latest (a `put` collapses earlier `put`s; a `delete`
  collapses everything prior for that path). Efficiency only, not correctness: the
  client already collapses by path when it partitions in *a sync cycle*, so it
  never double-downloads — this just trims op-list payload and pagination
  round-trips, and mainly for the *medium gap* (far enough behind to have
  duplicate paths, not far enough to hit fallback). Trades the cheap
  `updated_at > ? LIMIT` scan for a heavier `GROUP BY path` query that interacts
  with the `(updatedAt, path)` keyset, so measure before adding. Distinct from the
  retention-trimming op-log compaction above.
