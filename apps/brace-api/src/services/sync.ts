import type { FileEntry, SignedUrl, SignOp } from '@stxapps/shared';

import { userDataStub } from '../do/user-data';
import type { Bindings } from '../lib/env';
import { ApiError } from '../lib/errors';
import { MAX_BYTES, MAX_FILES } from '../lib/quota';
import { userFilesRepo } from '../r2/user-files';

// Service layer for the file-plane sync endpoints (files/list, files/sign). The
// op-plane endpoints (ops/list, ops/commit) are thin DO passthroughs and stay in
// the route; this layer holds the file-plane POLICY — TTLs, the quota gate, the
// op→method mapping — and delegates all R2 access to r2/user-files (the bucket
// gateway). See docs/local-first-sync.md.

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
