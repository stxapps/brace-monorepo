import { z } from 'zod';

import { API_V1, defineEndpoint } from '../api/endpoint';

// Local-first sync endpoint contracts — the four-endpoint control plane the
// background sync engine drives (see docs/local-first-sync.md). Two endpoints per
// resource: `ops` (the per-user op log, the incremental-pull accelerator) and
// `files` (the R2 objects, the source of truth). The blob bytes never touch the
// API — clients PUT/GET R2 directly over a `files/sign` URL — so these endpoints
// only ever move metadata: paths, timestamps, and signed URLs.
//
// Defined once here in `shared` (the lowest layer), exactly like the auth
// contracts, so brace-api validates against the same schema every client builds
// its typed fetch from. See docs/api-contracts.md.

// A `put` (the object exists/changed) or `delete` (it's gone) op. Same kinds the
// op log records and the client applies (download for put, remove for delete).
export const opKindSchema = z.enum(['put', 'delete']);
export type OpKind = z.infer<typeof opKindSchema>;

// A path RELATIVE to the user's storage root — `meta/{id}.enc`, `files/{id}.enc`,
// `tags/{id}.enc`, `lists/{id}.enc`, or the fixed-name `settings/<concern>.enc`.
// The `/users/{uid}/` prefix that namespaces the R2 object is NEVER on the wire:
// the server derives it from the authenticated session and prepends it, so one
// user can't name another's path (the authorization check in docs/local-first-
// sync.md "authorization & quota" reduces to "validate the shape, then prefix").
// The id segment is the random-id family (meta/files/tags/lists) or a fixed
// lowercase concern name (settings) — both end in `.enc`. Anchored + a closed
// charset, so there is no path-separator or traversal sequence to smuggle a key
// outside the namespace.
export const syncPathSchema = z
  .string()
  .regex(
    /^(?:(?:meta|files|tags|lists)\/[A-Za-z0-9_-]+|settings\/[a-z0-9-]+)\.enc$/,
    'expected a sync path like meta/<id>.enc',
  );

// --- GET /v1/ops/list — incremental pull ------------------------------------

// The cursor is the compound key (updatedAt, path) — R2's `LastModified`, not a
// seq (see docs/local-first-sync.md "the ops/list endpoint"). Both halves go over
// the wire as query params: a single millisecond can hold more ops than `limit`,
// so the `path` tiebreak is what lets the client page past it. `since` is absent
// only on the very first incremental call after first sync (its cursor is a bare
// newest-`updatedAt` with no tiebreak yet); the server treats a missing
// `sincePath` as the low sentinel. `z.coerce` because query params arrive as
// strings on the server.
export const opsListRequestSchema = z.object({
  since: z.coerce.number().int().optional(),
  sincePath: syncPathSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type OpsListRequest = z.infer<typeof opsListRequestSchema>;

// One op as it crosses the wire — never the internal `seq` (that orders ties and
// drives compaction inside the DO, but is meaningless to clients; see storage
// layout). `updatedAt` is R2's `LastModified` for a put, the deletion commit time
// for a delete.
export const opEntrySchema = z.object({
  op: opKindSchema,
  path: z.string(),
  updatedAt: z.number(),
});
export type OpEntry = z.infer<typeof opEntrySchema>;

// `oldestUpdatedAt` / `newestUpdatedAt` are the retained-range bounds the client
// routes on (incremental vs. fallback — see the routing table in the doc); both
// are `null` on a never-written/wiped log. `hasMore` drives keyset pagination:
// the client advances (since, sincePath) to the last op and pulls again while it's
// true.
export const opsListResponseSchema = z.object({
  ops: z.array(opEntrySchema),
  oldestUpdatedAt: z.number().nullable(),
  newestUpdatedAt: z.number().nullable(),
  hasMore: z.boolean(),
});
export type OpsListResponse = z.infer<typeof opsListResponseSchema>;

// GET /v1/ops/list?since=…&sincePath=…&limit=… → { ops, oldestUpdatedAt, newestUpdatedAt, hasMore }
export const opsListEndpoint = defineEndpoint({
  method: 'GET',
  path: `${API_V1}/ops/list`,
  request: opsListRequestSchema,
  response: opsListResponseSchema,
});

// --- POST /v1/ops/commit — record a committed mutation ----------------------

// Sent AFTER the client's R2 PUT (for `put`) succeeds. The server HEADs the
// object — confirming it exists and reading R2's authoritative `LastModified` —
// records the op with that timestamp, and returns it. A `delete` has no surviving
// object to HEAD, so it's stamped on the commit clock server-side. Commit is
// idempotent in effect: re-committing a path just appends another op row, which
// costs one redundant download and nothing else (see "the three flows: push").
export const opsCommitRequestSchema = z.object({
  op: opKindSchema,
  path: syncPathSchema,
});
export type OpsCommitRequest = z.infer<typeof opsCommitRequestSchema>;

// The R2 `LastModified` (put) or deletion commit time (delete) the server
// recorded. The client stores this as the path's `updatedAt` and advances its
// `syncCursor` to it — never the local clock.
export const opsCommitResponseSchema = z.object({
  updatedAt: z.number(),
});
export type OpsCommitResponse = z.infer<typeof opsCommitResponseSchema>;

// POST /v1/ops/commit → { updatedAt }
export const opsCommitEndpoint = defineEndpoint({
  method: 'POST',
  path: `${API_V1}/ops/commit`,
  request: opsCommitRequestSchema,
  response: opsCommitResponseSchema,
});

// --- GET /v1/files/list — fallback full R2 listing --------------------------

// No request fields: the user is identified by the bearer token, and the listing
// is the whole namespace. The empty object keeps the contract uniform with the
// rest (the client still sends no params for a GET).
export const filesListRequestSchema = z.object({});
export type FilesListRequest = z.infer<typeof filesListRequestSchema>;

// One R2 object as the fallback sees it: its relative `path` and R2's own
// `LastModified`. Using R2's clock (not a separately-minted timestamp) is what
// lets fallback recover a commit-died edit — the new bytes carry a fresh
// `LastModified` even though no op was recorded. See "fallback full sync".
export const fileEntrySchema = z.object({
  path: z.string(),
  updatedAt: z.number(),
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

// The full listing as a bare array (download-authoritative truth). The server
// pages through R2 internally, so the client gets every object in one response.
export const filesListResponseSchema = z.array(fileEntrySchema);
export type FilesListResponse = z.infer<typeof filesListResponseSchema>;

// GET /v1/files/list → [{ path, updatedAt }, …]
export const filesListEndpoint = defineEndpoint({
  method: 'GET',
  path: `${API_V1}/files/list`,
  request: filesListRequestSchema,
  response: filesListResponseSchema,
});

// --- POST /v1/files/sign — mint presigned R2 URL(s) -------------------------

// `put` mints upload URLs (quota-checked at issuance — the only place abuse can be
// bounded when content is opaque); `get` mints download URLs (no quota — reading
// your own data — so they can be minted in batch for a fast first sync). Either
// way the server verifies every path is the caller's before signing.
export const signOpSchema = z.enum(['put', 'get']);
export type SignOp = z.infer<typeof signOpSchema>;

export const filesSignRequestSchema = z.object({
  op: signOpSchema,
  paths: z.array(syncPathSchema).min(1).max(1000),
});
export type FilesSignRequest = z.infer<typeof filesSignRequestSchema>;

// Each requested path paired with its presigned URL, returned in request order.
// The client PUTs/GETs the blob bytes directly to `url` (R2), never through the
// API — `files/sign` is a thin envelope check, not a content gateway.
export const signedUrlSchema = z.object({
  path: z.string(),
  url: z.string(),
});
export type SignedUrl = z.infer<typeof signedUrlSchema>;

export const filesSignResponseSchema = z.object({
  urls: z.array(signedUrlSchema),
});
export type FilesSignResponse = z.infer<typeof filesSignResponseSchema>;

// POST /v1/files/sign → { urls: [{ path, url }, …] }
export const filesSignEndpoint = defineEndpoint({
  method: 'POST',
  path: `${API_V1}/files/sign`,
  request: filesSignRequestSchema,
  response: filesSignResponseSchema,
});
