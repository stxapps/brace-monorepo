import { checkUsernameEndpoint } from '@stxapps/shared';

import { app } from './app';

// Build request URLs from the shared contract path so these stay correct across
// version-prefix changes (e.g. /v1 → /v2) without editing every literal here.
const usernamePath = checkUsernameEndpoint.path;

describe('brace-api', () => {
  it('returns a welcome message on the root route', async () => {
    const res = await app.request('/');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'Welcome to brace-api',
    });
  });

  it('reports a healthy status', async () => {
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  describe(`GET ${checkUsernameEndpoint.path}`, () => {
    // The available/taken paths query the `usernames` directory in DIRECTORY_DB.
    // app.request() passes NO env, so `c.env.DIRECTORY_DB` is undefined and the
    // handler can't run — these are skipped until we test against real bindings
    // via @cloudflare/vitest-pool-workers. (They were silently 500-ing before;
    // skipping is the honest state, not a green that proves nothing.)
    it.skip('reports an available username (needs real D1 bindings)', async () => {
      const res = await app.request(`${usernamePath}?username=freshname`);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ available: true });
    });

    it.skip('reports a taken username, case-insensitive (needs real D1 bindings)', async () => {
      const res = await app.request(`${usernamePath}?username=Admin`);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ available: false });
    });

    // This one needs no DB: it fails at the zValidator (shared schema) before the
    // handler ever touches a binding, so it runs with no env.
    it('rejects a username that fails the shared validation rules', async () => {
      const res = await app.request(`${usernamePath}?username=no`);

      expect(res.status).toBe(400);
    });
  });
});
