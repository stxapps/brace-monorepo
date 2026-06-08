import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { checkUsernameEndpoint, signOutEndpoint } from '@stxapps/shared';

import { sessionsRepo } from './db/repositories/sessions';
import { usernamesRepo } from './db/repositories/usernames';
import { hashToken } from './lib/ids';
import { issueSession } from './services/session';
import { app } from './app';

// Build request URLs from the shared contract path so these stay correct across
// version-prefix changes (e.g. /v1 → /v2) without editing every literal here.
const usernamePath = checkUsernameEndpoint.path;

// app.request(path, init, env) — the third arg is the bindings the handlers see.
// Under vitest-pool-workers `env` is the REAL local Workers env (D1/R2/DO/rate
// limits), so the username routes that query DIRECTORY_DB actually run. Storage
// is isolated per test (see vitest.config.ts) and seeded with migrations only.
describe('brace-api', () => {
  it('returns a welcome message on the root route', async () => {
    const res = await app.request('/', {}, env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'Welcome to brace-api',
    });
  });

  it('reports a healthy status', async () => {
    const res = await app.request('/health', {}, env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  describe(`GET ${checkUsernameEndpoint.path}`, () => {
    it('reports an available username', async () => {
      const res = await app.request(`${usernamePath}?username=freshname`, {}, env);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ available: true });
    });

    it('reports a taken username, case-insensitively', async () => {
      // Seed the directory with the canonical (lowercase) form, then query a
      // different-cased spelling: the lookup canonicalizes, so 'Admin' must
      // resolve to the stored 'admin' and report unavailable.
      await usernamesRepo(env.DIRECTORY_DB).claim({
        username: 'admin',
        userId: 'u_seed',
        accountDbId: '1',
      });

      const res = await app.request(`${usernamePath}?username=Admin`, {}, env);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ available: false });
    });

    // This one needs no DB: it fails at the zValidator (shared schema) before the
    // handler ever touches a binding.
    it('rejects a username that fails the shared validation rules', async () => {
      const res = await app.request(`${usernamePath}?username=no`, {}, env);

      expect(res.status).toBe(400);
    });
  });

  describe(`POST ${signOutEndpoint.path}`, () => {
    // The real client sends an empty JSON body — the session to revoke is named by
    // the bearer token, not the body — so mirror that here.
    const post = (headers: Record<string, string>) =>
      app.request(
        signOutEndpoint.path,
        { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' },
        env,
      );

    it('revokes the session for a valid bearer token', async () => {
      // Mint a real session, then confirm it resolves BEFORE sign-out so the
      // post-condition (it's gone) is meaningful rather than vacuously true.
      const { token } = await issueSession(env, { id: 'u_signout', accountDbId: '1' });
      const tokenHash = await hashToken(token);
      expect(await sessionsRepo(env.SESSIONS_DB).findByTokenHash(tokenHash)).not.toBeNull();

      const res = await post({ authorization: `Bearer ${token}` });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });
      // The row is deleted, so the same token no longer authenticates — exactly
      // what the auth guard checks on the next request.
      expect(await sessionsRepo(env.SESSIONS_DB).findByTokenHash(tokenHash)).toBeNull();
    });

    it('rejects a request with no bearer token', async () => {
      const res = await post({});

      expect(res.status).toBe(401);
    });

    it('rejects an unknown bearer token', async () => {
      const res = await post({ authorization: 'Bearer not-a-real-token' });

      expect(res.status).toBe(401);
    });
  });
});
