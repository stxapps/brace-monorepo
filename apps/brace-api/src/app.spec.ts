import { app } from './app';

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

  // NOTE: these run with no env (app.request() passes none), so "taken" is
  // resolved against the in-memory stub Set in routes/auth.ts, NOT a DB query.
  // They verify the contract/validation layer only — green here does not mean
  // the real username lookup works. Update them when the users table lands
  // (and ideally re-run against real bindings via @cloudflare/vitest-pool-workers).
  describe('GET /auth/username-available', () => {
    it('reports an available username', async () => {
      const res = await app.request('/auth/username-available?username=freshname');

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ available: true });
    });

    it('reports a taken username (case-insensitive)', async () => {
      const res = await app.request('/auth/username-available?username=Admin');

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ available: false });
    });

    it('rejects a username that fails the shared validation rules', async () => {
      const res = await app.request('/auth/username-available?username=no');

      expect(res.status).toBe(400);
    });
  });
});
