## local-first sync

How brace keeps data on the device as the source of truth and syncs encrypted
files to the server. See [architecture.md](./architecture.md) for the package
layering and [setup.md](./setup.md) for scaffold history.

### the shape of the problem

brace is **local-first** with **one bookmark per file** and **end-to-end
encryption**:

- a bookmark is encrypted on the client, then uploaded as an opaque blob to
  storage (Cloudflare R2) via a signed URL;
- on download, the blob is fetched, decrypted, and written to a local store
  (IndexedDB);
- the UI reads from the local store, never from the network.

The decisive constraint is that **the server only ever sees ciphertext.** The
Hono/Workers API and R2 cannot read, index, query, diff, or conflict-resolve on
content. That rules out the server-intelligent local-first frameworks
(ElectricSQL, PowerSync, TanStack DB) — their value is server-side knowledge of
your data, which E2E encryption forbids — and makes the key-value / document
sync engines (Replicache, RxDB replication) an awkward fit, since our transport
is "encrypted blob per file via signed URL," not row/document sync.

So the data path is split into **two layers**. The split matters: we hand-roll
one and use a library for the other. Don't conflate "don't use a sync
framework" with "build everything from scratch."

```
UI ──reads──▶ local store (IndexedDB) ◀──writes── sync engine ──▶ Hono API / R2
   ◀reactive──┘   [LIBRARY]                         [HAND-ROLLED]
                                          encrypt before PUT / decrypt after GET
```

### layer 1 — local store + reactivity (use a library)

This is the cache and the source of truth. The UI subscribes to it and
re-renders when sync writes land. **Don't rebuild IndexedDB plumbing by hand.**

Responsibilities:

- store **decrypted** bookmarks for fast local reads;
- expose **reactive queries** so components update when the store changes;
- own only on-device data — no network concerns leak in here.

Options:

- **Dexie** (IndexedDB) — `liveQuery` for reactive reads; simplest and most
  flexible. Pair it with `@stxapps/web-crypto` for the E2E layer. Preferred
  default.
- **RxDB** — if you want reactivity plus at-rest local encryption in one
  package. Use it purely as the **store** (its observability + encryption
  plugin); ignore its replication protocol, which syncs JSON documents, not R2
  blobs.

### layer 2 — sync engine (hand-roll)

The transport is custom no matter which tools we pick, because "encrypted blob
per bookmark via signed URL" is a file-sync protocol none of the off-the-shelf
frameworks model natively. This is essentially the Gaia/Blockstack per-file
encrypted-storage model — well-trodden ground.

Runs at the app/background level (not component-scoped). Responsibilities:

- **sync cursor** — persist `lastSyncedAt` / a version locally to drive the
  incremental pull;
- **manifest** — the list of file paths + versions returned by the server;
- **crypto boundary** — encrypt before PUT, decrypt after GET, using
  `@stxapps/web-crypto`; plaintext never crosses the network;
- **upload queue** — pending local changes → request signed URLs → PUT to R2 →
  mark synced, with retry/backoff and offline handling;
- **conflict policy** — file-level and therefore cheap (granularity is one
  bookmark): last-writer-wins per path, or a per-file version, is enough.

The three flows:

1. **First sync (after sign in)** — pull the full manifest, download each blob
   from R2, decrypt, write to the local store.
2. **Incremental sync (next visit)** — POST the cursor to the Hono API, get the
   files changed since last sync, download + decrypt + store, advance the
   cursor.
3. **Push (new/edited bookmark)** — write to the local store first, enqueue the
   change, request signed URLs, encrypt, upload to R2, mark synced.

Talk to the API through the shared **contract client**, not Hono RPC. Each
endpoint is described once in `@stxapps/shared` (`defineEndpoint` + zod schemas);
both the server and every client read that descriptor, so no client ever imports
`brace-api`. The sync engine runs outside React, so it calls `callEndpoint`
directly (no hooks):

```ts
import { callEndpoint, syncPullEndpoint } from '@stxapps/shared';
const { files } = await callEndpoint(
  { baseUrl: API_URL },
  syncPullEndpoint, // GET/POST descriptor, e.g. { since: lastSyncedAt }
  { since: lastSyncedAt },
);
```

> Why not Hono's `hc<AppType>`? It infers types from the brace-api app instance,
> forcing clients to `import type { AppType } from '@stxapps/brace-api'` — an
> `app → app` and `web → node` edge that the Nx boundaries in
> [architecture.md](./architecture.md) forbid. The hand-written contract keeps
> every dependency arrow pointing down at `shared`.

### where TanStack Query fits (and where it doesn't)

The dividing line is **React-component calls vs. the background sync engine**,
not Hono-vs-R2.

**Use it for component-facing API endpoints.** The handful of endpoints that
components call directly — auth (username check, sign-in, create-account,
session), account settings, a sync-status read — go through TanStack Query
(`useQuery`/`useMutation`) for uniform loading/error/retry/dedup state and
devtools. These hooks live in `@stxapps/react` and **wrap `callEndpoint`**, so
the shared contract stays the single source of truth and the hooks remain
reusable on brace-extension and (future) brace-expo. Contract-first and TanStack
are orthogonal layers: TanStack sits on top of `callEndpoint`, it doesn't
replace it.

**Don't use it for the local-first data path.** Two reasons:

- the **local store (Dexie `liveQuery`) is already the read cache** for
  bookmarks — adding TanStack Query here just creates a second, competing cache
  in front of the real one;
- the **sync engine runs at background/app level, not in React**, so hooks don't
  apply. Its Hono control-plane calls (manifest, cursor, signed URLs,
  mark-synced) and the R2 blob PUT/GET use plain `callEndpoint`/`fetch`. Their
  results land in Dexie, which the UI observes reactively — so there is nothing
  for a query cache to hold.

In short: **component server calls → TanStack Query; background sync engine + R2
→ plain `callEndpoint`.** Both sides call the same `@stxapps/shared` contracts.
