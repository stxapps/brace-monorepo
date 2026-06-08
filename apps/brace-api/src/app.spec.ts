import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { checkUsernameEndpoint } from '@stxapps/shared';

import { usernamesRepo } from './db/repositories/usernames';
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
});
