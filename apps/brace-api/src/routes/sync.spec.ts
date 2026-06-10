import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
  filesListEndpoint,
  filesSignEndpoint,
  opsCommitEndpoint,
  opsListEndpoint,
} from '@stxapps/shared';

import { app } from '../app';
import { userFileKey } from '../lib/r2-keys';
import { issueSession } from '../services/session';

// End-to-end coverage of the four-endpoint sync control plane through the real
// Hono app + the real (miniflare) bindings: a per-user Durable Object op log, R2,
// and the SigV4 presigner reading R2_* vars from the development env. The app is
// driven exactly as a client would via app.request(path, init, env) with a real
// bearer token (issueSession), so requireAuth, the contract validation, and the
// per-user path namespacing are all exercised. See docs/local-first-sync.md.
describe('sync control plane', () => {
  // Mint a real session and return the userId + the Authorization header a client
  // would send. The session's userId IS the per-user DO / R2-prefix key.
  async function authFor(
    userId: string,
  ): Promise<{ userId: string; auth: Record<string, string> }> {
    const { token } = await issueSession(env, { id: userId, accountDbId: '1' });
    return { userId, auth: { authorization: `Bearer ${token}` } };
  }

  const json = (auth: Record<string, string>, body: unknown) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify(body),
  });

  describe('auth', () => {
    it('rejects every endpoint without a bearer token (401)', async () => {
      const get = (path: string) => app.request(path, {}, env);
      expect((await get(opsListEndpoint.path)).status).toBe(401);
      expect((await get(filesListEndpoint.path)).status).toBe(401);
      expect(
        (
          await app.request(
            opsCommitEndpoint.path,
            json({}, { op: 'put', path: 'meta/a.enc' }),
            env,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await app.request(
            filesSignEndpoint.path,
            json({}, { op: 'get', paths: ['meta/a.enc'] }),
            env,
          )
        ).status,
      ).toBe(401);
    });
  });

  describe(`POST ${opsCommitEndpoint.path} + GET ${opsListEndpoint.path}`, () => {
    it('commits a put and pulls it back over the op list', async () => {
      const { userId, auth } = await authFor('sync-commit-1');
      // The client PUTs the blob to R2 first (here directly), then commits.
      await env.USER_FILES.put(userFileKey(userId, 'meta/m1.enc'), 'ciphertext');

      const commit = await app.request(
        opsCommitEndpoint.path,
        json(auth, { op: 'put', path: 'meta/m1.enc' }),
        env,
      );
      expect(commit.status).toBe(200);
      const committed = (await commit.json()) as { updatedAt: number };
      expect(typeof committed.updatedAt).toBe('number');
      // Commit recorded R2's own LastModified.
      const head = await env.USER_FILES.head(userFileKey(userId, 'meta/m1.enc'));
      expect(committed.updatedAt).toBe(head?.uploaded.getTime());

      const list = await app.request(`${opsListEndpoint.path}`, { headers: auth }, env);
      expect(list.status).toBe(200);
      const pulled = (await list.json()) as {
        ops: { op: string; path: string; updatedAt: number }[];
        oldestUpdatedAt: number | null;
        newestUpdatedAt: number | null;
        hasMore: boolean;
      };
      expect(pulled.ops).toEqual([
        { op: 'put', path: 'meta/m1.enc', updatedAt: committed.updatedAt },
      ]);
      expect(pulled.newestUpdatedAt).toBe(committed.updatedAt);
      expect(pulled.hasMore).toBe(false);
    });

    it('advances past the cursor and reports null bounds for a fresh user', async () => {
      const { auth } = await authFor('sync-fresh-1');
      const res = await app.request(opsListEndpoint.path, { headers: auth }, env);
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        ops: [],
        oldestUpdatedAt: null,
        newestUpdatedAt: null,
        hasMore: false,
      });
    });

    it('rejects a malformed path at the contract boundary (400)', async () => {
      const { auth } = await authFor('sync-badpath-1');
      const res = await app.request(
        opsCommitEndpoint.path,
        json(auth, { op: 'put', path: '../../etc/passwd' }),
        env,
      );
      expect(res.status).toBe(400);
    });
  });

  describe(`GET ${filesListEndpoint.path}`, () => {
    it('lists only the calling user’s objects, with R2 timestamps', async () => {
      const { userId, auth } = await authFor('sync-list-1');
      await env.USER_FILES.put(userFileKey(userId, 'meta/x.enc'), 'x');
      await env.USER_FILES.put(userFileKey(userId, 'tags/t.enc'), 'tt');
      // Another user's object must NOT appear.
      await env.USER_FILES.put(userFileKey('sync-list-other', 'meta/y.enc'), 'y');

      const res = await app.request(filesListEndpoint.path, { headers: auth }, env);
      expect(res.status).toBe(200);
      const files = (await res.json()) as { path: string; updatedAt: number }[];
      expect(files.map((f) => f.path).sort()).toEqual(['meta/x.enc', 'tags/t.enc']);
      expect(files.every((f) => typeof f.updatedAt === 'number')).toBe(true);
    });
  });

  describe(`POST ${filesSignEndpoint.path}`, () => {
    it('mints presigned PUT URLs scoped to the user’s prefix', async () => {
      const { userId, auth } = await authFor('sync-sign-1');
      const res = await app.request(
        filesSignEndpoint.path,
        json(auth, { op: 'put', paths: ['meta/a.enc', 'files/b.enc'] }),
        env,
      );
      expect(res.status).toBe(200);
      const { urls } = (await res.json()) as { urls: { path: string; url: string }[] };
      expect(urls.map((u) => u.path)).toEqual(['meta/a.enc', 'files/b.enc']);
      for (const { path, url } of urls) {
        // SigV4 presigned URL against R2's S3 endpoint, keyed under users/{uid}/.
        expect(url).toContain('.r2.cloudflarestorage.com/');
        expect(url).toContain(userFileKey(userId, path));
        expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
        expect(url).toContain('X-Amz-Signature=');
      }
    });

    it('mints presigned GET URLs in batch', async () => {
      const { auth } = await authFor('sync-sign-2');
      const res = await app.request(
        filesSignEndpoint.path,
        json(auth, { op: 'get', paths: ['meta/a.enc'] }),
        env,
      );
      expect(res.status).toBe(200);
      const { urls } = (await res.json()) as { urls: { path: string; url: string }[] };
      expect(urls).toHaveLength(1);
      expect(urls[0].url).toContain('X-Amz-Signature=');
    });

    it('rejects a malformed path at the contract boundary (400)', async () => {
      const { auth } = await authFor('sync-sign-3');
      const res = await app.request(
        filesSignEndpoint.path,
        json(auth, { op: 'put', paths: ['meta/ok.enc', 'not-a-namespace/evil'] }),
        env,
      );
      expect(res.status).toBe(400);
    });
  });
});
