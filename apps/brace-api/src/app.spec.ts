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
