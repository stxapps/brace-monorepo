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
});
