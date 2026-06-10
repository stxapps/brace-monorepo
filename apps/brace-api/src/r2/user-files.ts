import type { FileEntry, SignedUrl } from '@stxapps/shared';

import type { Bindings } from '../lib/env';
import { ApiError } from '../lib/errors';
import { stripUserPrefix, userFileKey, userPrefix } from './keys';
import { presignR2Url, type R2Credentials } from './presign';

// The access layer for the USER_FILES R2 bucket — the R2 analogue of db/'s
// repositories and the DO's repositories. Every read of the bucket and every
// presigned URL goes through here, so key-namespacing (keys.ts) and the S3
// presigner (presign.ts) are applied in ONE place, never re-inlined in a
// service, route, or the DO. See docs/local-first-sync.md.
//
// Unlike the D1/DO repos (which each take a single storage handle), this takes
// the whole `env`: R2's surface spans TWO bindings — the native bucket binding
// (USER_FILES, for list/head) AND the S3 credential vars (R2_*, for presigning;
// the binding can't mint browser-usable URLs). The factory holds both together.

// Assemble the R2 S3 credentials, failing loudly if a deploy is missing one — a
// misconfigured signer must not silently hand out unusable URLs.
function r2Credentials(env: Bindings): R2Credentials {
  const { R2_ACCOUNT_ID, R2_USER_FILES_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (!R2_ACCOUNT_ID || !R2_USER_FILES_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new ApiError(500, 'r2_unconfigured', 'R2 signing credentials are not configured');
  }
  return {
    accountId: R2_ACCOUNT_ID,
    bucket: R2_USER_FILES_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  };
}

export function userFilesRepo(env: Bindings) {
  const bucket = env.USER_FILES;
  return {
    // Page the whole per-user prefix (R2 list caps at 1000/call) into wire-relative
    // paths with R2's own LastModified — the fallback full sync (GET /v1/files/list)
    // the client reconciles against.
    async list(userId: string): Promise<FileEntry[]> {
      const prefix = userPrefix(userId);
      const files: FileEntry[] = [];
      let cursor: string | undefined;

      do {
        const page = await bucket.list({ prefix, cursor });
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
    },

    // HEAD a user's object: R2's LastModified (as `updatedAt`) + `size`, or null if
    // absent. The op-commit existence check and the quota size source (see the put
    // branch of UserDataDO.commitOp).
    async head(
      userId: string,
      path: string,
    ): Promise<{ updatedAt: number; size: number } | null> {
      const object = await bucket.head(userFileKey(userId, path));
      if (!object) return null;
      return { updatedAt: object.uploaded.getTime(), size: object.size };
    },

    // Mint presigned URLs for the given wire-relative paths, each namespaced under
    // the caller's prefix here — so cross-user signing is structurally impossible
    // (the key can only resolve under `users/{userId}/`). Credentials are assembled
    // once for the whole batch; `method`/`expiresIn` are the caller's sync policy.
    async presignUrls(
      userId: string,
      paths: string[],
      method: 'PUT' | 'GET',
      expiresIn: number,
    ): Promise<SignedUrl[]> {
      const creds = r2Credentials(env);
      return Promise.all(
        paths.map(async (path) => ({
          path,
          url: await presignR2Url(creds, { key: userFileKey(userId, path), method, expiresIn }),
        })),
      );
    },
  };
}
