## local-first sync

How brace keeps data on the device as the source of truth and syncs encrypted
files to the server. See [architecture.md](./architecture.md) for the package
layering, [setup.md](./setup.md) for scaffold history, and
[api-contracts.md](./api-contracts.md) for the contract-first endpoint pattern
this builds on.

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
- **Dexie** (IndexedDB) — `liveQuery` for reactive reads; simplest and most
  flexible. Pair it with `@stxapps/web-crypto` for the E2E layer. Preferred
  default.

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

Talk to the API through the shared **contract client** — see
[api-contracts.md](./api-contracts.md) for the full pattern. Each endpoint is
described once in `@stxapps/shared` (`defineEndpoint` + zod schemas); both the
server and every client read that descriptor, so no client ever imports
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

### Draft

Cloudflare durable objects (sqlite) per user: op_logs
  - see apps/brace-api/src/do/user-data.ts

Cloudflare R2 storage: 1 link/bookmark = 1 encrypted file
  - private bucket, must use signed urls to upload and download
  - 3 requests: 1. get signed url 2. action to R2 3. commit task to server (return new seq number)
  - schema
    + /users/{uid}/meta/{random-id}.enc    ← encrypted bookmark metadata
    + /users/{uid}/files/{random-id}.enc   ← encrypted content/archives
    + /users/{uid}/settings.enc            ← encrypted user settings
    + The metadata refers to other files for screenshot, archived page, more info.

    ```json
    {
      "title": "Some Article",
      "url": "https://...",
      "tags": ["tech", "reading"],
      "list": "Work",
      "page-archive": "{random-id}.enc",
      "createdAt": "...",
      "updatedAt": "..."
    }
    ```
  - data types
    + links/bookmarks
    + settings
    + list names, tag names
      - Solve conflicts on key level for Settings, All list names, All tag names
      - sync per row, how to delete? per row in op_logs?
    + purchase

Sync
  - Sync with lastOpLogSeq — Use sequence numbers, not timestamps. Timestamps can have clock skew, duplicates, and ordering issues. A monotonically increasing integer from DO is reliable and simple. GET /sync?since=42 returns all ops with seq > 42.
  - If no op_logs, fall back to R2 storage list files
  - If lastOpLogSeq is too old, fall back to get all file paths for syncing
  - How to distinguish between no data yet and op_logs were cleaned up already
  - op logs in database helps sync faster and can be gone, all clients will fall back to sync with all file paths
  - DO size limit at 10 GB is not deal breaker, we can clean up op logs from time to time.
  - Op log cleanup: Keep last 30 days, or last 10000 ops per user, whichever is more
  - For the fallback full sync, you need to know which version is newer — local or server.
    + R2 already stores LastModified on every object. So the fallback sync endpoint returns paths with timestamps:
    + client must store R2 updatedAt for each file
  - Download everything on first load, then work locally. Online mode becomes "light sync mode" — on first login, download all metadata files (not archives/screenshots), build the local index, then query locally. For 5,000 bookmarks at ~500 bytes each, that's ~2.5 MB. Manageable. Subsequent sessions only fetch changes.
  - meta data v.s. content data
    + meta must sync first
    + content data downloads on the fly
  - bookmark and settings (Last-write-wins) V.S. list names and tag names (merge by keys)
  - approaches
    + Server stores op logs when create, update, delete files
    + Client maintain op logs when create, update, delete files from last sync
    + When sync, client get op logs from server with lastSyncTimestamp
    + Client do merge, solve conflict, download and upload needed files
    + If lastSyncTimestamp is too old, fall back to get all file paths for syncing

Endpoints

  Sync endpoint:
  
  ```
  GET /sync?since=42
  
  → SELECT seq, op, path FROM op_log
    WHERE user_id = ? AND seq > 42
    ORDER BY seq ASC
    LIMIT 1000
  ```
  
  File mutation endpoints automatically write to op log:
  
  ```
  PUT /files/meta/m_abc.enc
    → Client requests signed upload URLs for N files
    → Upload to R2 using signed URLs
    → Client calls POST /sync/commit with list of uploaded paths
    → Server verifies files exist in R2, writes op log entries, returns new seqs
      - INSERT INTO op_log (user_id, op, path) VALUES (?, 'put', 'meta/m_abc.enc')
      - Return new seq number
  
  DELETE /files/meta/m_abc.enc
    → Delete from R2
    → INSERT INTO op_log (user_id, op, path) VALUES (?, 'delete', 'meta/m_abc.enc')
    → Return new seq number
  ```
  
  Op log cleanup:
  
  ```
  -- Keep last 30 days, or last 10000 ops per user, whichever is more
  DELETE FROM op_log
  WHERE user_id = ?
  AND seq < (
    SELECT MIN(seq) FROM (
      SELECT seq FROM op_log WHERE user_id = ?
      ORDER BY seq DESC LIMIT 10000
    )
  )
  AND created_at < datetime('now', '-30 days');
  ```

  fallback list files:

  ```
  GET /files/list
  
  → [
      { "path": "meta/m_abc.enc", "updatedAt": "2026-04-13T10:00:00Z" },
      { "path": "meta/m_def.enc", "updatedAt": "2026-04-12T08:00:00Z" },
      { "path": "files/f_xyz.enc", "updatedAt": "2026-04-11T05:00:00Z" }
    ]
  ```

  The client compares each entry against its local file's updatedAt:
    - Server has file, client doesn't → download
    - Client has file, server doesn't → upload
    - Both have it, server is newer → download
    - Both have it, client is newer → upload
    - Same timestamp → skip

  The client needs to store updatedAt locally for each file.

  Use the server's timestamp as the source of truth, not the client's clock. When the client uploads a file, the server responds with the updatedAt it assigned. The client stores that server-assigned timestamp locally. This avoids clock skew between devices.

  ```
  Client uploads meta/m_abc.enc
  Server stores it, returns { seq: 47, updatedAt: "2026-04-13T10:05:00Z" }
  Client saves updatedAt = "2026-04-13T10:05:00Z" for that path locally
  ```

Issues to Address

1. Atomic multi-file operations
   Creating a bookmark requires uploading 2–3 files (meta + data + archive). If the client or network fails mid-way, you get partial state on the server — for example a meta file referencing a data file that doesn't exist yet, or data files with no meta pointing to them.
   Upload data files first, meta file last. The meta file is what makes a bookmark "exist." If data uploads fail, no meta file is written, no harm done. Orphaned data files can be cleaned up by the client periodically.
   For deletion, reverse the order: delete meta first, then data files. The bookmark disappears immediately. If data file deletion fails, they become orphans — harmless, cleaned up later.

2. Sync race condition
   Client A starts syncing, gets ops, starts downloading. Meanwhile Client B uploads changes. Client A finishes sync and sets lastSyncSeq = 50. But some of Client B's changes landed between when A fetched the op list and when A finished processing. Those changes have seq > 50 so they'll be caught next sync — this is actually fine. No issue here as long as you set lastSyncSeq to the max seq from the response, not the server's current seq at the time you finish.

3. Pagination on the sync endpoint
   If a client has been offline for weeks, GET /sync?since=42 might return thousands of ops. Add a limit and cursor:

```
GET /sync?since=42&limit=500
→ { ops: [...], hasMore: true, nextCursor: 542 }

GET /sync?since=542&limit=500
→ { ops: [...], hasMore: false }
```

4. Metadata file size discipline
   You said under 2 KB per metadata file. Make sure you enforce this by keeping large fields out of metadata. Specifically, bookmark descriptions or notes could grow large — if you add that feature later, store them as separate encrypted files, not inside metadata.

   Truncate link description in meta and keep full description in files


IndexedDB
  - Use Dexie
  - Decrypted metadata and files
  - lastSyncSeq (single integer)
  - Pending ops queue (for offline mutations)
  - File updatedAt index (for fallback sync comparison)
  
