import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
  filesListEndpoint,
  filesSignEndpoint,
  opsCommitEndpoint,
  opsListEndpoint,
} from '@stxapps/shared';

import { app } from '../app';
import { userFileKey } from '../r2/keys';
import { issueSession } from '../services/session';

// End-to-end coverage of the four-endpoint sync control plane through the real
// Hono app + the real (miniflare) bindings: a per-user Durable Object op log and
// R2. The app is driven exactly as a client would via app.request(path, init,
// env) with a real bearer token (issueSession), so requireAuth, the contract
// validation, and the per-user path namespacing are all exercised. Because the
// test env IS the local `development` env (placeholder R2_ACCOUNT_ID), files/sign
// returns dev blob-proxy URLs, not SigV4 presigns — the proxy round-trip is
// covered below; the SigV4 presigner has its own unit test (r2/presign.spec.ts).
// See docs/local-first-sync.md, r2/local.ts, and routes/local-r2.ts.
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
            json({}, { ops: [{ op: 'put', path: 'meta/a.enc' }] }),
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
        json(auth, { ops: [{ op: 'put', path: 'meta/m1.enc' }] }),
        env,
      );
      expect(commit.status).toBe(200);
      const { results, failed } = (await commit.json()) as {
        results: { path: string; updatedAt: number }[];
        failed: { path: string; reason: string }[];
      };
      expect(failed).toEqual([]);
      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('meta/m1.enc');
      expect(typeof results[0].updatedAt).toBe('number');
      // Commit recorded R2's own LastModified.
      const head = await env.USER_FILES.head(userFileKey(userId, 'meta/m1.enc'));
      expect(results[0].updatedAt).toBe(head?.uploaded.getTime());

      const list = await app.request(`${opsListEndpoint.path}`, { headers: auth }, env);
      expect(list.status).toBe(200);
      const pulled = (await list.json()) as {
        ops: { op: string; path: string; updatedAt: number }[];
        oldestUpdatedAt: number | null;
        newestUpdatedAt: number | null;
        hasMore: boolean;
      };
      expect(pulled.ops).toEqual([
        { op: 'put', path: 'meta/m1.enc', updatedAt: results[0].updatedAt },
      ]);
      expect(pulled.newestUpdatedAt).toBe(results[0].updatedAt);
      expect(pulled.hasMore).toBe(false);
    });

    it('commits a batch and reports puts whose R2 object is missing in failed', async () => {
      const { userId, auth } = await authFor('sync-commit-batch-1');
      // Two of the three puts have objects in R2; the third never landed.
      await env.USER_FILES.put(userFileKey(userId, 'meta/a.enc'), 'aa');
      await env.USER_FILES.put(userFileKey(userId, 'files/b.enc'), 'bb');

      const commit = await app.request(
        opsCommitEndpoint.path,
        json(auth, {
          ops: [
            { op: 'put', path: 'meta/a.enc' },
            { op: 'put', path: 'meta/missing.enc' },
            { op: 'put', path: 'files/b.enc' },
          ],
        }),
        env,
      );
      expect(commit.status).toBe(200);
      const { results, failed } = (await commit.json()) as {
        results: { path: string; updatedAt: number }[];
        failed: { path: string; reason: string }[];
      };
      // The two real objects commit; the missing path is reported in failed.
      expect(results.map((r) => r.path).sort()).toEqual(['files/b.enc', 'meta/a.enc']);
      expect(failed).toEqual([{ path: 'meta/missing.enc', reason: 'no_object' }]);

      const list = await app.request(opsListEndpoint.path, { headers: auth }, env);
      const pulled = (await list.json()) as { ops: { path: string }[] };
      expect(pulled.ops.map((o) => o.path).sort()).toEqual(['files/b.enc', 'meta/a.enc']);
    });

    it('commits a delete: removes the R2 object, logs the op, frees the listing', async () => {
      const { userId, auth } = await authFor('sync-delete-1');
      // Put-then-commit so the object, its op, and its quota entry all exist.
      await env.USER_FILES.put(userFileKey(userId, 'meta/d1.enc'), 'ciphertext');
      await app.request(
        opsCommitEndpoint.path,
        json(auth, { ops: [{ op: 'put', path: 'meta/d1.enc' }] }),
        env,
      );

      const commit = await app.request(
        opsCommitEndpoint.path,
        json(auth, { ops: [{ op: 'delete', path: 'meta/d1.enc' }] }),
        env,
      );
      expect(commit.status).toBe(200);
      const { results, failed } = (await commit.json()) as {
        results: { path: string; updatedAt: number }[];
        failed: unknown[];
      };
      expect(failed).toEqual([]);
      expect(results.map((r) => r.path)).toEqual(['meta/d1.enc']);

      // The object is GONE from R2 — the server deletes it at commit (the client
      // can't: files/sign mints only PUT/GET URLs). R2 is truth, so without this
      // the download-authoritative fallback would resurrect every deleted file.
      await expect(env.USER_FILES.head(userFileKey(userId, 'meta/d1.enc'))).resolves.toBeNull();
      const listing = await app.request(filesListEndpoint.path, { headers: auth }, env);
      expect(((await listing.json()) as { files: unknown[] }).files).toEqual([]);

      // Both ops are in the log; the delete is stamped on the commit clock.
      const list = await app.request(opsListEndpoint.path, { headers: auth }, env);
      const pulled = (await list.json()) as { ops: { op: string; path: string }[] };
      expect(pulled.ops.map((o) => o.op)).toEqual(['put', 'delete']);

      // Re-committing the delete is idempotent — the absent key is a no-op.
      const again = await app.request(
        opsCommitEndpoint.path,
        json(auth, { ops: [{ op: 'delete', path: 'meta/d1.enc' }] }),
        env,
      );
      expect(again.status).toBe(200);
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
        json(auth, { ops: [{ op: 'put', path: '../../etc/passwd' }] }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it('reports a put with no R2 object in failed without erroring (op-without-object invariant)', async () => {
      // The service HEADs R2 before logging: a put for a path that isn't in R2 is
      // refused — the request still 200s with empty results, the path in failed,
      // and the log untouched, so no client ever pulls an op that 404s. (No
      // env.USER_FILES.put here — the object is absent.)
      const { auth } = await authFor('sync-noobject-1');
      const res = await app.request(
        opsCommitEndpoint.path,
        json(auth, { ops: [{ op: 'put', path: 'meta/missing.enc' }] }),
        env,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        results: [],
        failed: [{ path: 'meta/missing.enc', reason: 'no_object' }],
      });

      const list = await app.request(opsListEndpoint.path, { headers: auth }, env);
      expect(((await list.json()) as { ops: unknown[] }).ops).toHaveLength(0);
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
      const { files, nextPageToken } = (await res.json()) as {
        files: { path: string; updatedAt: number }[];
        nextPageToken: string | null;
      };
      expect(files.map((f) => f.path).sort()).toEqual(['meta/x.enc', 'tags/t.enc']);
      expect(files.every((f) => typeof f.updatedAt === 'number')).toBe(true);
      // Two objects, well under the page limit, so the listing is complete.
      expect(nextPageToken).toBeNull();
    });

    it('pages the listing when more objects remain than the limit', async () => {
      const { userId, auth } = await authFor('sync-list-page-1');
      for (const id of ['a', 'b', 'c']) {
        await env.USER_FILES.put(userFileKey(userId, `meta/${id}.enc`), id);
      }

      // limit=2 over 3 objects ⇒ first page is full and carries a nextPageToken.
      const first = await app.request(`${filesListEndpoint.path}?limit=2`, { headers: auth }, env);
      const page1 = (await first.json()) as {
        files: { path: string }[];
        nextPageToken: string | null;
      };
      expect(page1.files).toHaveLength(2);
      expect(typeof page1.nextPageToken).toBe('string');

      // Resume from the token ⇒ the remaining object, no more.
      const token = encodeURIComponent(page1.nextPageToken as string);
      const second = await app.request(
        `${filesListEndpoint.path}?limit=2&pageToken=${token}`,
        { headers: auth },
        env,
      );
      const page2 = (await second.json()) as {
        files: { path: string }[];
        nextPageToken: string | null;
      };
      expect(page2.files).toHaveLength(1);
      expect(page2.nextPageToken).toBeNull();

      // The two pages together cover every object exactly once.
      const all = [...page1.files, ...page2.files].map((f) => f.path).sort();
      expect(all).toEqual(['meta/a.enc', 'meta/b.enc', 'meta/c.enc']);
    });
  });

  describe(`POST ${filesSignEndpoint.path}`, () => {
    it('mints PUT URLs scoped to the user’s prefix', async () => {
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
        // Dev env: the blob-proxy URL, keyed under users/{uid}/ (see routes/local-r2.ts).
        expect(url).toContain('/v1/files/blob/');
        expect(url).toContain(userFileKey(userId, path));
      }
    });

    it('mints GET URLs in batch', async () => {
      const { userId, auth } = await authFor('sync-sign-2');
      const res = await app.request(
        filesSignEndpoint.path,
        json(auth, { op: 'get', paths: ['meta/a.enc'] }),
        env,
      );
      expect(res.status).toBe(200);
      const { urls } = (await res.json()) as { urls: { path: string; url: string }[] };
      expect(urls).toHaveLength(1);
      expect(urls[0].url).toContain(`/v1/files/blob/${userFileKey(userId, 'meta/a.enc')}`);
    });

    it('round-trips a blob through the dev proxy (PUT then GET)', async () => {
      const { userId, auth } = await authFor('sync-sign-rt');
      // Sign a PUT, upload bytes to that URL, then sign+GET them back — exactly
      // the local stand-in for direct browser↔R2 transfer (routes/local-r2.ts).
      const signPut = await app.request(
        filesSignEndpoint.path,
        json(auth, { op: 'put', paths: ['meta/rt.enc'] }),
        env,
      );
      const putUrl = ((await signPut.json()) as { urls: { url: string }[] }).urls[0].url;
      const put = await app.request(
        new URL(putUrl).pathname,
        { method: 'PUT', body: 'ciphertext' },
        env,
      );
      expect(put.status).toBe(200);
      // The proxy wrote through the binding to the user-namespaced key.
      expect(await env.USER_FILES.head(userFileKey(userId, 'meta/rt.enc'))).not.toBeNull();

      const signGet = await app.request(
        filesSignEndpoint.path,
        json(auth, { op: 'get', paths: ['meta/rt.enc'] }),
        env,
      );
      const getUrl = ((await signGet.json()) as { urls: { url: string }[] }).urls[0].url;
      const get = await app.request(new URL(getUrl).pathname, {}, env);
      expect(get.status).toBe(200);
      expect(await get.text()).toBe('ciphertext');
    });

    it('returns 404 for a missing blob through the dev proxy', async () => {
      const { userId } = await authFor('sync-sign-404');
      const get = await app.request(`/v1/files/blob/${userFileKey(userId, 'meta/nope.enc')}`, {}, env);
      expect(get.status).toBe(404);
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
