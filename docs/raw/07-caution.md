## zero-knowledge without meta-data leakage

Server should not see

- bookmark content, tags, list

Unavoidable

- User X has N files
- File sizes and timestamps
- Which data files are downloaded in a session (network logs)

Storage file paths

- /users/{uid}/meta/{random-id}.enc ← bookmark metadata
- /users/{uid}/files/{random-id}.enc
- The metadata refers to other files for screenshot, archived page, more info.

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

Good parts

- Tag and list mutations — Adding 10 tags to a bookmark is 1 file update, 1 request, 1 storage write. Not 10. The tags live inside the encrypted metadata, not in the file path.
- File paths reveal nothing — Paths are just /meta/{uuid}.enc. Server and storage provider learn nothing about content, tags, or lists.
- No Tombstone and compaction — Deleting a bookmark means deleting its 2–3 files. No tombstones needed at all. The server just deletes the objects from storage. If you want soft-delete for undo, keep a deletedAt field inside the metadata and clean up after 30 days with a server cron.
- No manifest bottleneck — No single file that grows forever. No conflict resolution on a shared blob. Each bookmark is independent.
- File paths reveal nothing — Paths are just /meta/{uuid}.enc. Server and storage provider learn nothing about content, tags, or lists.

Limitations

- Download all metadata on first use. It's the simplest, most secure, and 2–3 MB initial download is acceptable for most users. After that, everything is fast and local.
- Download everything on first load, then work locally. Online mode becomes "light sync mode" — on first login, download all metadata files (not archives/screenshots), build the local index, then query locally. For 5,000 bookmarks at ~500 bytes each, that's ~2.5 MB. Manageable. Subsequent sessions only fetch changes.
- Online mode only supports "all bookmarks, sorted by recent." Filtering by list or tag requires building a local index first — which means a brief initial sync. This is honest and simple. Many zero-knowledge apps (like Standard Notes) work this way: you sync everything first, then query locally.
- On Cloudflare, use D1 sqlite for performFiles log, so sync is fast?
  - Sync mode — GET /sync/changes?since=T returns only changed file paths. Client downloads only the updated .enc files. Exactly the incremental behavior you want.
  - or can query D1 directly?

Advances

- Solve conflicts on key level for Settings, All list names, All tag names

Approaches

- Server stores op logs when create, update, delete files
- Client maintain op logs when create, update, delete files from last sync
- When sync, client get op logs from server with lastSyncTimestamp
- Client do merge, solve conflict, download and upload needed files
- If lastSyncTimestamp is too old, fall back to get all file paths for syncing
- On server, op logs in database helps sync faster and can be gone, all clients will fall back to sync with all file paths
- D1 size limit at 10 GB is not deal breaker, we can clean up op logs from time to time.

AI recommendations

- Sync with lastSyncSeq — Use sequence numbers, not timestamps. Timestamps can have clock skew, duplicates, and ordering issues. A monotonically increasing integer from D1 is reliable and simple. GET /sync?since=42 returns all ops with seq > 42.

Cloudflare Workers + D1 + R2

```
Cloudflare Workers    → API server (auth, signed URLs, op log queries)
Cloudflare D1         → op log storage (seq, userId, op, path, timestamp)
Cloudflare R2         → encrypted file storage (zero egress cost)
```

D1 schema:

```sql
CREATE TABLE op_log (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL,
  op        TEXT NOT NULL,  -- 'put' or 'delete'
  path      TEXT NOT NULL,  -- 'meta/m_abc.enc' or 'files/f_xyz.enc'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_oplog_user_seq ON op_log (user_id, seq);
```

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
  → Upload to R2
  → INSERT INTO op_log (user_id, op, path) VALUES (?, 'put', 'meta/m_abc.enc')
  → Return new seq number

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

For the fallback full sync, you need to know which version is newer — local or server.

File paths alone only tell you what exists, not which copy is more recent. If Client A has meta/m_abc.enc locally and the server also has it, the client can't tell whether to download or upload without knowing which is newer.

R2 already stores LastModified on every object. So the fallback sync endpoint returns paths with timestamps:

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

The client needs to store updatedAt locally for each file. A simple key-value store: path → updatedAt.

Use the server's timestamp as the source of truth, not the client's clock. When the client uploads a file, the server responds with the updatedAt it assigned. The client stores that server-assigned timestamp locally. This avoids clock skew between devices.

```
Client uploads meta/m_abc.enc
Server stores it, returns { seq: 47, updatedAt: "2026-04-13T10:05:00Z" }
Client saves updatedAt = "2026-04-13T10:05:00Z" for that path locally
```

This way, all comparisons during fallback sync are server-clock vs server-clock. No drift issues.

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

4. Batch upload size limits
   Cloudflare Workers has a request body size limit (100 MB on paid plan). Your batch sync endpoint should handle file uploads separately from the op batch. Upload files individually to R2 via signed URLs, then send the batch op request to confirm them.
   Better flow:

```
1. Client requests signed upload URLs for N files
2. Client uploads directly to R2 using signed URLs
3. Client calls POST /sync/commit with list of uploaded paths
4. Server verifies files exist in R2, writes op log entries, returns new seqs
```

This also avoids proxying large file bodies through Workers.

5. Metadata file size discipline
   You said under 2 KB per metadata file. Make sure you enforce this by keeping large fields out of metadata. Specifically, bookmark descriptions or notes could grow large — if you add that feature later, store them as separate encrypted files, not inside metadata.

6. What happens when the user changes their passphrase
   With per-file encryption keys stored inside metadata, a passphrase change means re-encrypting all metadata files (to re-wrap the file keys with the new master key). Data files stay untouched. This is correct, but it's a potentially large operation — 5,000 metadata files means 5,000 re-encrypts and uploads. Handle this as a background job with progress indication and resume capability if interrupted.

7. Account recovery
   Zero-knowledge means if the user loses their passphrase, everything is gone. This is a feature, not a bug, but make it very clear in UX. Consider supporting a recovery key (a random high-entropy key generated at signup, shown once, stored by the user) that can derive the master key independently of the passphrase.

8. Key derivation salt
   Store the Argon2id salt server-side in plaintext (it's not secret). The client fetches it before key derivation. This way the salt is consistent across devices. A common pattern:

```
GET /auth/salt?email=user@example.com
→ { salt: "random-bytes-hex" }
```

9. You mentioned settings data conflicts
   Settings (like default list, theme, preferences) should be a single encrypted file /users/{uid}/settings.enc with the same field-level timestamp merge as metadata. Treat it like any other file — mutations go through the same upload/op-log/sync pipeline.

10. R2 listing for fallback sync can be slow
    R2's ListObjects is paginated at 1,000 objects per request. A user with 10,000 files needs 10 sequential list calls. This is fine for a fallback path, but be aware it's not instant. Consider caching the full file list in D1 as well (path + updatedAt), so the fallback queries D1 instead of R2. D1 queries are faster than R2 listings.

Final Architecture Summary

```
Cloudflare R2          → encrypted file storage
Cloudflare D1          → op log + file index (path, updatedAt)
Cloudflare Workers     → API (auth, signed URLs, sync, op log)

File layout per user:
  /users/{uid}/meta/{id}.enc       ← encrypted bookmark metadata (<2KB)
  /users/{uid}/files/{id}.enc      ← encrypted content/archives
  /users/{uid}/settings.enc        ← encrypted user settings

D1 tables:
  op_log (seq, user_id, op, path, created_at)
  file_index (user_id, path, updated_at)  ← for fast fallback sync

Sync protocol:
  Normal:   GET /sync?since={seq}&limit=500
  Fallback: GET /files/list (from D1 file_index, not R2)
  Upload:   Signed URLs → R2 direct, then POST /sync/commit

Client local storage:
  - Decrypted metadata cache (IndexedDB/SQLite)
  - lastSyncSeq (single integer)
  - Pending ops queue (for offline mutations)
  - File updatedAt index (for fallback sync comparison)
```

ref: claude.ai/chat/5368240c-e76a-4de6-920b-e21950f4c628

4. Is it hard to do marketing?

You wrote: "Is it hard to do marketing as no one marketing channel for target customers?"

This is a misconception. The privacy community is actually one of the easiest niches to market to because they congregate in highly specific, high-trust hubs. You don't need Facebook ads or SEO. You need to be listed and reviewed in:

    PrivacyGuides.org (The holy grail for this niche)

    OpenAlternative.co / Alternative.to

    Techlore (YouTube reviews of privacy tools)

    Subreddits: r/privacy, r/selfhosted (since you allow data export/ownership), r/ProtonMail.

    Hacker News ("Show HN: A zero-knowledge bookmark manager with native mobile share-sheets")

When privacy users find a tool that genuinely respects their data (verifiable client-side encryption, no email required, exportable data), they evangelize it fiercely.
