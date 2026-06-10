import type { FileEntry, SignedUrl, SignOp } from '@stxapps/shared';

import { userDataStub } from '../do/user-data';
import type { Bindings } from '../lib/env';
import { ApiError } from '../lib/errors';
import { MAX_BYTES, MAX_FILES } from '../lib/quota';
import { stripUserPrefix, userFileKey, userPrefix } from '../lib/r2-keys';
import { presignR2Url, type R2Credentials } from '../lib/r2-presign';

// Service layer for the file-plane sync endpoints (files/list, files/sign). The
// op-plane endpoints (ops/list, ops/commit) are thin DO passthroughs and stay in
// the route; the logic that needs more than one binding — paging R2, the quota
// gate, presigning — lives here. See docs/local-first-sync.md.

// Presigned-URL lifetimes. PUT URLs are short-lived (a commit follows immediately,
// so a few minutes covers retry/backoff); GET URLs live longer because first sync
// mints them in BATCH and the client streams downloads lazily over a session.
const PUT_URL_TTL_SECONDS = 5 * 60; // 5 minutes
const GET_URL_TTL_SECONDS = 60 * 60; // 1 hour

// Assemble the R2 S3 credentials from env, failing loudly if a deploy is missing
// one — a misconfigured signer must not silently hand out unusable URLs.
function r2Credentials(env: Bindings): R2Credentials {
  const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new ApiError(500, 'r2_unconfigured', 'R2 signing credentials are not configured');
  }
  return {
    accountId: R2_ACCOUNT_ID,
    bucket: R2_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  };
}

// Fallback full sync (GET /v1/files/list): every object under the user's prefix
// with R2's own `LastModified`. Pages through R2 internally (list caps at 1000 per
// call) so the client gets the whole namespace in one response — the
// download-authoritative truth it reconciles against. See "fallback full sync".
export async function listUserFiles(env: Bindings, userId: string): Promise<FileEntry[]> {
  const prefix = userPrefix(userId);
  const files: FileEntry[] = [];
  let cursor: string | undefined;

  do {
    const page = await env.USER_FILES.list({ prefix, cursor });
    for (const object of page.objects) {
      const path = stripUserPrefix(userId, object.key);
      // Defensive: list({ prefix }) only returns keys under the prefix, so a
      // non-match shouldn't occur — skip rather than serve a malformed path.
      if (path === null) continue;
      files.push({ path, updatedAt: object.uploaded.getTime() });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return files;
}

// Mint presigned R2 URLs (POST /v1/files/sign). Paths arrive already shape-
// validated by the contract (syncPathSchema) and are namespaced under the caller's
// prefix here, so cross-user access is structurally impossible — the path can only
// ever resolve under `users/{userId}/`. `put` additionally clears the per-user
// quota at issuance (the only place abuse is boundable when content is opaque);
// `get` needs no quota (reading your own data), so download URLs batch freely.
export async function signUserUrls(
  env: Bindings,
  userId: string,
  op: SignOp,
  paths: string[],
): Promise<SignedUrl[]> {
  const creds = r2Credentials(env);

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

  return Promise.all(
    paths.map(async (path) => ({
      path,
      url: await presignR2Url(creds, { key: userFileKey(userId, path), method, expiresIn }),
    })),
  );
}
