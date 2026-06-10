import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import {
  filesListEndpoint,
  type FilesListResponse,
  filesSignEndpoint,
  type FilesSignResponse,
  opsCommitEndpoint,
  type OpsCommitResponse,
  opsListEndpoint,
  type OpsListResponse,
} from '@stxapps/shared';

import { userDataStub } from '../do/user-data';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../middleware/auth';
import { rateLimit, userRateLimitKey } from '../middleware/rate-limit';
import { commitOp, listUserFiles, signUserUrls } from '../services/sync';

// Local-first sync control plane — the four endpoints the background sync engine
// drives (docs/local-first-sync.md). Every route carries its own '/v1/…' path from
// the shared contract, so this sub-app mounts at the root in app.ts (like authRoutes).
//
// ALL FOUR ARE PROTECTED: requireAuth resolves the session onto the context, and
// every path is namespaced under the authenticated user's prefix server-side — a
// client never names another user's object (the authorization rule in the doc).
// The per-user op log + size map live in that user's Durable Object (userDataStub).
//
// requireAuth also keys the global standard rate-limit per-IP; the authed routes
// re-key it per-USER (userRateLimitKey) so one account can't multiply its quota
// across IPs. ops/commit and files/sign are the write/hot paths, so they stack the
// 'tight' tier on top.
export const syncRoutes = new Hono<AppEnv>()
  .use(opsListEndpoint.path, requireAuth)
  .use(opsCommitEndpoint.path, requireAuth)
  .use(filesListEndpoint.path, requireAuth)
  .use(filesSignEndpoint.path, requireAuth)
  // --- ops/list — incremental pull -----------------------------------------
  .get(opsListEndpoint.path, zValidator('query', opsListEndpoint.request), async (c) => {
    const { since, sincePath, limit } = c.req.valid('query');
    const { userId } = c.get('session');
    // The DO owns the keyset query + retained-range bounds; the client routes
    // incremental-vs-fallback on the bounds it returns.
    const body: OpsListResponse = await userDataStub(c.env, userId).listOps(
      since ?? null,
      sincePath ?? null,
      limit,
    );
    return c.json(body);
  })
  // --- ops/commit — record a committed mutation ----------------------------
  .post(
    opsCommitEndpoint.path,
    rateLimit('tight', userRateLimitKey),
    zValidator('json', opsCommitEndpoint.request),
    async (c) => {
      const { op, path } = c.req.valid('json');
      const { userId } = c.get('session');
      // For a put the service HEADs the object (existence check + R2's LastModified +
      // its size for the quota map); for a delete it stamps the commit clock and
      // frees the size. A put with no R2 object throws — never log an op the log
      // can't back (op-without-object 404s every puller). See docs/local-first-sync.md.
      const body: OpsCommitResponse = await commitOp(c.env, userId, op, path);
      return c.json(body);
    },
  )
  // --- files/list — fallback full R2 listing -------------------------------
  .get(filesListEndpoint.path, zValidator('query', filesListEndpoint.request), async (c) => {
    const { userId } = c.get('session');
    const body: FilesListResponse = await listUserFiles(c.env, userId);
    return c.json(body);
  })
  // --- files/sign — mint presigned R2 URL(s) -------------------------------
  .post(
    filesSignEndpoint.path,
    rateLimit('tight', userRateLimitKey),
    zValidator('json', filesSignEndpoint.request),
    async (c) => {
      const { op, paths } = c.req.valid('json');
      const { userId } = c.get('session');
      // put: quota-checked at issuance, then short-lived PUT URLs. get: no quota,
      // longer-lived GET URLs minted in batch. signUserUrls namespaces every path
      // under the caller's prefix, so cross-user signing is structurally impossible.
      const urls = await signUserUrls(c.env, userId, op, paths);
      const body: FilesSignResponse = { urls };
      return c.json(body);
    },
  );
