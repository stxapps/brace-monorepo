'use client';

// Hand-rolled sync engine — layer 2 in docs/local-first-sync.md. Runs at the
// app/background level, NOT in React (no hooks): it drives the four-endpoint
// control plane through the shared contract client (`api.call`, which is
// `callEndpoint` bound to brace-api's baseUrl with the bearer token attached) and
// moves blob bytes to/from R2 over presigned URLs, doing the crypto boundary
// (encrypt before PUT / decrypt after GET) with @stxapps/web-crypto. Decrypted
// results land in the Dexie store (db.ts), which the UI observes reactively.
//
// R2 is the source of truth; the op log is a disposable accelerator (the doc's
// central invariant). So every flow can fall back to listing R2 and lose nothing
// but speed, and the cursor is R2's `LastModified` — the compound key
// `(updatedAt, path)` — never the op log's internal `seq`.

import {
  type CommitResult,
  DEFAULT_OPS_LIMIT,
  FILES_PREFIX,
  filesListEndpoint,
  filesSignEndpoint,
  MAX_COMMIT_OPS,
  MAX_LIST_LIMIT,
  MAX_SIGN_PATHS,
  type OpEntry,
  opsCommitEndpoint,
  opsListEndpoint,
  type OpsListResponse,
  type SignOp,
} from '@stxapps/shared';

import { db } from '../data/db';
import { clearPendingPaths, listPendingOps, type PendingOpRecord } from '../data/pending-store';
import { advanceCursor, getSyncMeta, markFirstSyncDone, resetCursor } from '../data/sync-store';
import { api } from '../lib/api';
import { decryptEntity, encryptEntity } from './crypto';
import { BlobRequestError, getBlob, putBlob } from './r2';

// Everything the engine needs to run a sync, passed in by the caller (SyncProvider)
// rather than read from session-store — so this module stays free of session/auth
// imports. Both fields duplicate values the session already holds; that's
// deliberate decoupling, not redundancy.
export interface SyncDeps {
  username: string;
  // Non-extractable AES key from the session store; used to decrypt/encrypt R2 blobs.
  encryptionKey: CryptoKey;
}

// Batch/page sizes — this client's policy is to use the contract caps in full
// (anything ≤ the cap is valid; fewer round trips wins). A client-only knob, not
// contract.
const SIGN_BATCH = MAX_SIGN_PATHS;
const COMMIT_BATCH = MAX_COMMIT_OPS;
const OPS_PAGE = DEFAULT_OPS_LIMIT;
const FILES_PAGE = MAX_LIST_LIMIT;

// Blob fan-out, split by direction because the two workloads bind on opposite
// resources (a bounded cap also keeps a first sync of thousands of files from
// opening thousands of sockets at once). Downloads are small index blobs (KB) over
// HTTP/2 and RTT-bound, so a wide fan-out cuts first-sync time and drains the
// presigned GET URLs sooner. Uploads can be MB-sized `files/` content, bound by
// uplink bandwidth + memory (peak ≈ concurrency × blob size), so they stay modest.
// Starting points — tune against a measured large first sync.
const DOWNLOAD_CONCURRENCY = 24;
const UPLOAD_CONCURRENCY = 8;

// One put-pipeline pass (pushPuts) signs, uploads, and commits a single chunk, so
// the chunk must fit BOTH the sign cap and the commit cap in one call each. Both are
// 1000 today; min() stays correct if they ever diverge. Bounding the chunk this way
// is what keeps each presigned PUT URL's mint-to-PUT latency inside its own upload
// window, well under the 5-min TTL, on a push of any size.
const PUT_BATCH = Math.min(SIGN_BATCH, COMMIT_BATCH);

// A path under `files/` is heavy content (archived page, screenshot). Per the doc,
// content is fetched LAZILY (on open/scroll), never eagerly on sync — so sync only
// tracks its `updatedAt` and downloads the always-resident index (meta/tags/lists/
// settings). loadEntityContent() pulls a content blob on demand.
function isContentPath(path: string): boolean {
  return path.startsWith(FILES_PREFIX);
}

// One path with the server `updatedAt` to store against it.
interface Entry {
  path: string;
  updatedAt: number;
}

// --- public flows -----------------------------------------------------------

// First sync after a fresh sign-in on this device (docs flow #1). List the full R2
// manifest, download + decrypt the index, build the local store — content is NOT
// pulled here. BLOCKING from the UI's point of view (InitialSyncGate shows the
// decrypting screen until this resolves).
export async function runInitialSync(deps: SyncDeps): Promise<void> {
  const files = await listAllFiles();
  await storeDownloads(deps, files);
  // Cursor is the newest compound `(updatedAt, path)` among ALL listed files
  // (content included, even though its blob is deferred) — the same
  // reconstruction the fallback cycle does from its full listing.
  const newest = newestCursor(files);
  await markFirstSyncDone(deps.username, newest.updatedAt, newest.path);
}

// Single-flight per account. Overlapping calls (the post-ready background pull, an
// edit-triggered requestSync, a retry) coalesce: a caller during a run shares the
// in-flight promise, and at most one trailing rerun picks up whatever changed
// after that run's snapshot. Serializing cycles keeps two drains from
// double-committing the same pending ops and keeps cursor writes ordered within
// this tab; across tabs, advanceCursor's forward-only guard covers the rest.
const inflightSyncs = new Map<string, Promise<void>>();
const rerunRequests = new Set<string>();

// A returning-visit sync (docs flow #2 + "a sync cycle"): reconcile, then push,
// then pull. Non-blocking — failures surface a quiet retry, they don't gate the
// UI. Routes itself to the download-authoritative fallback when the op log can't
// answer (wiped, compacted past the cursor, or behind it).
export function runIncrementalSync(deps: SyncDeps): Promise<void> {
  const key = deps.username;
  const inflight = inflightSyncs.get(key);
  if (inflight) {
    rerunRequests.add(key);
    return inflight;
  }
  const run = (async () => {
    try {
      await incrementalSyncOnce(deps);
      while (rerunRequests.delete(key)) await incrementalSyncOnce(deps);
    } finally {
      inflightSyncs.delete(key);
      rerunRequests.delete(key);
    }
  })();
  inflightSyncs.set(key, run);
  return run;
}

async function incrementalSyncOnce(deps: SyncDeps): Promise<void> {
  const meta = await getSyncMeta(deps.username);
  // The cursor is the compound key (updatedAt, path); both halves go over the wire
  // as opsListEndpoint's `since` + `sincePath`. `since` is always sent (even 0, for
  // a seeded-but-empty new account) so the server's bounds can route us; an empty
  // `sincePath` is omitted (server reads it as the low sentinel).
  const since = meta?.syncCursorUpdatedAt ?? 0;
  const sincePath = meta?.syncCursorPath ?? '';
  const pending = await listPendingOps(deps.username);

  // Peek the first page: its retained-range bounds decide incremental vs. fallback
  // before we commit to paging the op log.
  const first = await api.call(opsListEndpoint, {
    since,
    sincePath: sincePath || undefined,
    limit: OPS_PAGE,
  });

  if (needsFallback(since, first)) {
    await fallbackCycle(deps, pending);
  } else {
    await incrementalCycle(deps, since, sincePath, first, pending);
  }
}

// Lazy content fetch (docs "data model — metadata vs. content"): pull one
// `files/{id}.enc` blob on demand (open/scroll), decrypt, and cache it in Dexie so
// re-views are instant and offline. Returns the decrypted bytes, or undefined if
// the path isn't known locally — or no longer exists server-side (deleted on
// another device, the delete op not yet pulled; the next sync removes the record).
export async function loadEntityContent(
  deps: SyncDeps,
  path: string,
): Promise<Uint8Array | undefined> {
  const rec = await db.items.get(path);
  if (!rec) return undefined;
  if (rec.data) return rec.data;

  const url = (await signPaths('get', [path])).get(path);
  if (!url) return undefined;

  const blob = await getBlob(url).catch((err: unknown) => {
    if (err instanceof BlobRequestError && err.status === 404) return undefined;
    throw err;
  });
  if (!blob) return undefined;

  const data = await decryptEntity(deps.encryptionKey, blob);
  await db.items.update(path, { data });
  return data;
}

// --- the cycle: incremental -------------------------------------------------

async function incrementalCycle(
  deps: SyncDeps,
  since: number,
  sincePath: string,
  first: OpsListResponse,
  pending: PendingOpRecord[],
): Promise<void> {
  // 1. Pull: page the op log via keyset, coalescing to the latest op per path.
  const serverOps = new Map<string, OpEntry>();
  let cursorUpdatedAt = since;
  let cursorPath = sincePath;
  let page = first;
  for (;;) {
    for (const op of page.ops) {
      serverOps.set(op.path, op);
      cursorUpdatedAt = op.updatedAt;
      cursorPath = op.path;
    }
    if (!page.hasMore) break;
    page = await api.call(opsListEndpoint, {
      since: cursorUpdatedAt,
      sincePath: cursorPath || undefined,
      limit: OPS_PAGE,
    });
  }

  // 2. Reconcile pulled ops against the pending queue. A path with a pending op is
  // a local edit; LWW resolves a true conflict (server moved past our base) the
  // same way as a clean fast-forward — local-wins (upload) — so EVERY pending op
  // goes to the push set and the download set is only the server-only paths. (Which
  // side wins a true conflict is an open product call; local-wins matches "the
  // later PUT wins" and is what the deferred conditional-write upgrade turns into a
  // detected 412 + re-pull.)
  const pendingPaths = new Set(pending.map((p) => p.path));
  const downloads: Entry[] = [];
  const localDeletes: string[] = [];
  for (const op of serverOps.values()) {
    if (pendingPaths.has(op.path)) continue; // local-wins: keep our pending op, skip the server copy
    if (op.op === 'put') downloads.push({ path: op.path, updatedAt: op.updatedAt });
    else localDeletes.push(op.path);
  }

  // 3. Push, 4. Pull — disjoint sets, so order is a sensible default, not a
  // requirement (local changes durable first).
  const committed = await pushPending(deps, pending);
  await storeDownloads(deps, downloads);
  await applyDeletes(localDeletes);

  // 5. Advance the cursor to the newest (updatedAt, path) seen across the whole
  // cycle — including our own just-committed uploads, so the next cycle doesn't
  // re-fetch them.
  for (const c of committed) {
    if (isNewer(c.updatedAt, c.path, cursorUpdatedAt, cursorPath)) {
      cursorUpdatedAt = c.updatedAt;
      cursorPath = c.path;
    }
  }
  await advanceCursor(deps.username, cursorUpdatedAt, cursorPath);
}

// --- the cycle: fallback (download-authoritative) ---------------------------

// When the op log can't reconstruct the delta, reconcile directly against a full
// R2 listing (docs "fallback full sync"). The server list is truth for every path
// WITHOUT a pending local op — so a server-side deletion is never resurrected and
// a stale leftover is dropped. A pending op is a genuine unsynced local intent,
// resolved exactly as the incremental cycle resolves it — local-wins — so a
// fallback (an infra event: log wiped/compacted/reset) never silently flips a
// conflict to server-wins: a pending edit is pushed over the server copy, and a
// pending delete is pushed rather than resurrected by the listing.
async function fallbackCycle(deps: SyncDeps, pending: PendingOpRecord[]): Promise<void> {
  const files = await listAllFiles();
  const serverPaths = new Set(files.map((f) => f.path));
  const pendingPaths = new Set(pending.map((p) => p.path));

  // One key-only cursor over the local table projects path -> updatedAt WITHOUT
  // deserializing any `data` blob: eachKey runs an IndexedDB key cursor on the
  // `updatedAt` index, so the heavy index-record bytes never load (the index key is
  // updatedAt, cursor.primaryKey is the path). It feeds BOTH reconcile directions
  // below — replacing a full-record bulkGet of every file plus a second primary-key
  // scan with this single pass.
  const localUpdatedAt = new Map<string, number>();
  await db.items.orderBy('updatedAt').eachKey((updatedAt, cursor) => {
    localUpdatedAt.set(cursor.primaryKey as string, updatedAt as number);
  });

  // Server side: download anything new or newer than the stored local `updatedAt`
  // — except paths with a pending op, which local-wins reserves for the push.
  const downloads = files.filter((f) => {
    if (pendingPaths.has(f.path)) return false;
    const local = localUpdatedAt.get(f.path);
    return local === undefined || f.updatedAt > local;
  });

  // Local side: a local-only path with no pending op was deleted on the server —
  // drop it. (A local-only path with a pending put is an unpushed create.)
  const localDeletes: string[] = [];
  for (const path of localUpdatedAt.keys()) {
    if (serverPaths.has(path) || pendingPaths.has(path)) continue;
    localDeletes.push(path);
  }

  // Push every pending op — including a delete whose object is already gone
  // server-side. The absence is ambiguous: usually another device committed the
  // delete (the re-commit costs one redundant op row), but it can also be OUR OWN
  // commit that crashed between the R2 delete and the DO write — and then this
  // retry is the only thing that ever logs the op (so incremental pullers learn of
  // the deletion) and frees the path's file_sizes quota entry. Commit is idempotent
  // on both stores, so pushing unconditionally is always safe; dropping the op
  // would leak the quota entry forever.
  const committed = await pushPending(deps, pending);
  await storeDownloads(deps, downloads);
  await applyDeletes(localDeletes);

  // Cursor = newest (updatedAt, path) across ALL pages plus our commits. This is
  // reconstructed straight from R2 with no op-log dependence — resetCursor, not
  // advanceCursor, because the cursor-ahead case intentionally LOWERS the cursor
  // back to reality.
  const newest = newestCursor(files, committed);
  await resetCursor(deps.username, newest.updatedAt, newest.path);
}

// --- push (the 3-round-trip commit protocol) --------------------------------

// Drain a set of pending ops: sign → PUT → commit (docs flow #3). Returns the
// committed results (R2's authoritative clock) so the caller can advance its cursor
// over its own writes. Removes each committed path from the queue; a `no_object`
// failure is left queued to re-PUT next drain.
//
// Runs in the global phase order [delete-metadata, delete-content, put-content,
// put-metadata] — the mirror pair of the multi-file-consistency rules (docs
// "multi-file consistency"): a create writes content before the metadata that
// references it; a delete removes that metadata before the content it referenced.
// So no crash or partial push ever leaves metadata pointing at a missing content
// file. Crucially each PHASE commits durably before the next, and each CHUNK within
// the put phases signs + uploads + commits as one unit (pushPuts) — so a presigned
// PUT URL never outlives its own chunk's upload window, and a push too large to
// finish inside one 5-min TTL still makes monotonic progress instead of livelocking
// on an all-up-front sign whose tail expires before it can be uploaded.
async function pushPending(deps: SyncDeps, ops: PendingOpRecord[]): Promise<CommitResult[]> {
  if (ops.length === 0) return [];

  const puts = ops.filter((o) => o.op === 'put');
  const deletes = ops.filter((o) => o.op === 'delete');
  const committed: CommitResult[] = [];

  // Phase 1+2: deletes carry no blob to upload — the commit itself drives the R2
  // delete (the client can't; files/sign mints only PUT/GET URLs). Metadata first,
  // then content. Unlike the puts below this is ONE call, not two: commitBatched
  // commits its input in array order across sequential chunks, so the concatenation
  // already IS the phase order — every entity's metadata-delete commits no later than
  // its content-delete. The one chunk that can straddle the meta/content boundary
  // commits both in a single atomic log write (the safe direction, never
  // content-before-metadata), so splitting it would only cost a redundant partial
  // commit when the metadata count isn't a multiple of COMMIT_BATCH.
  committed.push(
    ...(await commitBatched(deps, [
      ...deletes.filter((o) => !isContentPath(o.path)),
      ...deletes.filter((o) => isContentPath(o.path)),
    ])),
  );

  // Phase 3 then 4: drain ALL content puts (every chunk) before ANY metadata put, so
  // the content-before-metadata invariant holds across chunk boundaries too.
  committed.push(
    ...(await pushPuts(
      deps,
      puts.filter((o) => isContentPath(o.path)),
    )),
  );
  committed.push(
    ...(await pushPuts(
      deps,
      puts.filter((o) => !isContentPath(o.path)),
    )),
  );

  return committed;
}

// Drive a homogeneous put set (all content OR all metadata — the caller splits and
// orders them) through the sign → PUT → commit pipeline one chunk at a time, so each
// chunk's PUT URLs are minted immediately before that chunk's upload and the chunk
// commits before the next is signed. PUT_BATCH fits one sign and one commit call, so
// each stays a single round trip.
async function pushPuts(deps: SyncDeps, puts: PendingOpRecord[]): Promise<CommitResult[]> {
  const committed: CommitResult[] = [];
  for (const batch of chunk(puts, PUT_BATCH)) {
    const urls = await signPaths(
      'put',
      batch.map((o) => o.path),
    );
    await uploadBlobs(deps, batch, urls);
    committed.push(...(await commitBatched(deps, batch)));
  }
  return committed;
}

// Commit a sequence of ops in input order, chunked under the commit cap — batches go
// out sequentially, so the caller's phase ordering is preserved across chunks. For
// each committed put, stamp R2's authoritative `updatedAt` onto the local record (a
// delete has no record left to stamp — update is a no-op), then clear the path from
// the queue. `failed` (only `no_object` today) is intentionally ignored: leaving the
// path queued is exactly the retry.
async function commitBatched(deps: SyncDeps, ops: PendingOpRecord[]): Promise<CommitResult[]> {
  const committed: CommitResult[] = [];
  for (const batch of chunk(ops, COMMIT_BATCH)) {
    const { results } = await api.call(opsCommitEndpoint, {
      ops: batch.map((o) => ({ op: o.op, path: o.path })),
    });
    for (const r of results) {
      committed.push(r);
      await db.items.update(r.path, { updatedAt: r.updatedAt });
    }
    await clearPendingPaths(
      deps.username,
      results.map((r) => r.path),
    );
  }
  return committed;
}

// Encrypt and PUT each op's local blob to its signed URL. A put with no local
// `data` (shouldn't happen, but be safe) is skipped — the commit will then report
// `no_object` and the op stays queued.
async function uploadBlobs(
  deps: SyncDeps,
  ops: PendingOpRecord[],
  urls: Map<string, string>,
): Promise<void> {
  await mapLimit(ops, UPLOAD_CONCURRENCY, async (op) => {
    const url = urls.get(op.path);
    if (!url) return;

    const rec = await db.items.get(op.path);
    if (!rec?.data) return;

    await putBlob(url, await encryptEntity(deps.encryptionKey, rec.data));
  });
}

// --- download / store / delete ----------------------------------------------

// Fetch, decrypt, and store a set of entries. Content (`files/`) records keep only
// their `updatedAt` — the blob stays lazy (and a CHANGED record drops any
// previously-cached `data` so a stale copy isn't served after an update). The index
// is pulled in chunks — each chunk signs its own GET URLs, then GETs + decrypts +
// stores at bounded concurrency — so the URL set never outgrows one batch.
async function storeDownloads(deps: SyncDeps, entries: Entry[]): Promise<void> {
  if (entries.length === 0) return;

  // Skip paths whose local record is already current (same-or-newer server stamp,
  // with the decrypted bytes present for an index path). That makes a re-run of an
  // interrupted first sync RESUME instead of re-downloading everything, makes a
  // re-pulled echo of our own commit free, and keeps a current content record's
  // lazily-cached blob.
  const locals = await db.items.bulkGet(entries.map((e) => e.path));
  const stale = entries.filter((e, i) => {
    const local = locals[i];
    if (!local || local.updatedAt < e.updatedAt) return true;
    return !isContentPath(e.path) && !local.data;
  });

  const content = stale.filter((e) => isContentPath(e.path));
  const index = stale.filter((e) => !isContentPath(e.path));

  await db.items.bulkPut(content.map((e) => ({ id: e.path, updatedAt: e.updatedAt })));
  // Index: sign → GET → decrypt → store one chunk at a time, so the presigned-URL
  // map never grows past a single batch (a large first sync holds ~1k URLs, not all
  // of them) and each URL's mint-to-GET latency stays well inside its 1-hour TTL.
  // Each record is stored the moment it's decrypted, so an interrupted run resumes
  // via the staleness skip above (fresh URLs for the shrinking remainder) rather
  // than restarting.
  for (const batch of chunk(index, SIGN_BATCH)) {
    const urls = await signPaths(
      'get',
      batch.map((e) => e.path),
    );
    await mapLimit(batch, DOWNLOAD_CONCURRENCY, async (e) => {
      const url = urls.get(e.path);
      if (!url) return;

      const blob = await getBlob(url).catch((err: unknown) => {
        // Deleted between the op pull / listing and this GET: the delete op sits
        // past our window and reconciles next sync — skip it, don't fail the cycle.
        if (err instanceof BlobRequestError && err.status === 404) return;
        throw err;
      });
      if (!blob) return;

      const data = await decryptEntity(deps.encryptionKey, blob);
      await db.items.put({ id: e.path, updatedAt: e.updatedAt, data });
    });
  }
}

async function applyDeletes(paths: string[]): Promise<void> {
  if (paths.length > 0) await db.items.bulkDelete(paths);
}

// --- control-plane helpers --------------------------------------------------

// Page the full R2 listing (fallback + first sync). `pageToken` is R2's opaque
// cursor relayed straight back; loop until it comes back null. The listing is not a
// snapshot — safe here because every consumer compares `updatedAt`.
async function listAllFiles(): Promise<Entry[]> {
  const out: Entry[] = [];
  let pageToken: string | undefined;
  do {
    const res = await api.call(filesListEndpoint, { pageToken, limit: FILES_PAGE });
    out.push(...res.files);
    pageToken = res.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

// Mint presigned URLs for a set of paths, batched under the contract cap, returned
// as a path→url map. `get` needs no quota so it batches freely; `put` is
// quota-checked server-side at issuance.
async function signPaths(op: SignOp, paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (const batch of chunk(paths, SIGN_BATCH)) {
    const res = await api.call(filesSignEndpoint, { op, paths: batch });
    for (const u of res.urls) urls.set(u.path, u.url);
  }
  return urls;
}

// Route incremental vs. fallback from the op log's retained-range bounds (docs "the
// ops/list endpoint" routing table). A returning client always has a cursor here
// (incremental only runs post-first-sync), so an empty or out-of-range log means
// the log was wiped/compacted/reset beneath us — re-list R2.
function needsFallback(since: number, page: OpsListResponse): boolean {
  const { oldestUpdatedAt: oldest, newestUpdatedAt: newest } = page;
  if (newest === null) return true; // empty/wiped log under a returning client
  if (since > newest) return true; // cursor ahead — log was reset/restored
  if (oldest !== null && since < oldest) return true; // ops before the cursor were compacted
  return false; // oldest ≤ since ≤ newest — run the keyset query
}

// Keyset ordering on the compound cursor (updatedAt, path).
function isNewer(ts: number, path: string, curTs: number, curPath: string): boolean {
  return ts > curTs || (ts === curTs && path > curPath);
}

// Newest compound (updatedAt, path) across full-listing results — the cursor a
// download-authoritative flow (first sync, fallback) reconstructs. Taken over ALL
// entries, never just the last page: R2 lists in key order, not time order, so
// the newest can sit on any page. `(0, '')` for an empty account.
function newestCursor(...lists: Entry[][]): Entry {
  let updatedAt = 0;
  let path = '';
  for (const list of lists) {
    for (const e of list) {
      if (isNewer(e.updatedAt, e.path, updatedAt, path)) {
        updatedAt = e.updatedAt;
        path = e.path;
      }
    }
  }
  return { path, updatedAt };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Run `fn` over `items` with at most `limit` in flight — bounds the socket count on
// a large first sync without serializing everything.
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await fn(item);
    }
  });
  await Promise.all(workers);
}
