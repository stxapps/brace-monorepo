import type { FileEntry, OpsCommitResponse, SignedUrl, SignOp } from '@stxapps/shared';

import type { OpKind } from '../do/repositories/op-logs';
import { userDataStub } from '../do/user-data';
import type { Bindings } from '../lib/env';
import { ApiError } from '../lib/errors';
import { MAX_BYTES, MAX_FILES } from '../lib/quota';
import { userFilesRepo } from '../r2/user-files';

// Service layer for the sync endpoints. It holds the POLICY and the cross-store
// orchestration — TTLs, the quota gate, the op→method mapping, and the R2-then-DO
// commit handshake — delegating all R2 access to r2/user-files (the bucket
// gateway) and all op-log/size access to the per-user DO. ops/list is the one
// genuinely single-store endpoint (a pure DO keyset query), so it stays a direct
// DO passthrough in the route. See docs/local-first-sync.md.

// Presigned-URL lifetimes. PUT URLs are short-lived (a commit follows immediately,
// so a few minutes covers retry/backoff); GET URLs live longer because first sync
// mints them in BATCH and the client streams downloads lazily over a session.
const PUT_URL_TTL_SECONDS = 5 * 60; // 5 minutes
const GET_URL_TTL_SECONDS = 60 * 60; // 1 hour

// Fallback full sync (GET /v1/files/list): every object under the user's prefix
// with R2's own `LastModified` — the download-authoritative truth the client
// reconciles against. The R2 paging lives in the bucket gateway.
export async function listUserFiles(env: Bindings, userId: string): Promise<FileEntry[]> {
  return userFilesRepo(env).list(userId);
}

// Record a committed mutation (POST /v1/ops/commit) — the R2-first, log-last
// handshake. For a `put` we HEAD R2: that doubles as the existence check
// upholding the op-without-object invariant (a missing object throws here, so NO
// op is logged) and reads R2's authoritative `LastModified` + size, which the DO
// stores as the op's cursor clock and quota entry. A `delete` has no surviving
// object to HEAD, so the deletion is stamped on the worker's commit clock and the
// path's recorded size is freed. The DO append itself is a pure SQLite write.
export async function commitOp(
  env: Bindings,
  userId: string,
  op: OpKind,
  path: string,
): Promise<OpsCommitResponse> {
  const stub = userDataStub(env, userId);
  if (op === 'delete') return stub.commitOp('delete', path, Date.now(), 0);

  const object = await userFilesRepo(env).head(userId, path);
  if (!object) {
    throw new ApiError(
      409,
      'no_object',
      `no R2 object at "${path}" — refusing to log a put without an object`,
    );
  }
  return stub.commitOp('put', path, object.updatedAt, object.size);
}

// Mint presigned R2 URLs (POST /v1/files/sign). Paths arrive already shape-
// validated by the contract (syncPathSchema); the gateway namespaces each under
// the caller's prefix, so cross-user access is structurally impossible. `put`
// additionally clears the per-user quota at issuance (the only place abuse is
// boundable when content is opaque); `get` needs no quota (reading your own
// data), so download URLs batch freely.
export async function signUserUrls(
  env: Bindings,
  userId: string,
  op: SignOp,
  paths: string[],
): Promise<SignedUrl[]> {
  if (op === 'put') {
    const { fileCount, totalBytes } = await userDataStub(env, userId).usage();
    // Conservative gate: we can't know each new object's size until it's uploaded,
    // so bound on current usage plus the requested file count. A re-PUT of an
    // existing path is counted as new here (harmless over-count near the ceiling).
    if (fileCount + paths.length > MAX_FILES) {
      throw new ApiError(403, 'quota_exceeded', 'File-count quota exceeded');
    }
    if (totalBytes >= MAX_BYTES) {
      throw new ApiError(403, 'quota_exceeded', 'Storage quota exceeded');
    }
  }

  const method = op === 'put' ? 'PUT' : 'GET';
  const expiresIn = op === 'put' ? PUT_URL_TTL_SECONDS : GET_URL_TTL_SECONDS;

  return userFilesRepo(env).presignUrls(userId, paths, method, expiresIn);
}
