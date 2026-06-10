import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { app } from './app';

// app.request(path, init, env) — the third arg is the bindings the handlers see.
// Under vitest-pool-workers `env` is the REAL local Workers env (D1/R2/DO/rate
// limits). Storage is isolated per test (see vitest.config.ts) and seeded with
// migrations only. Route-group coverage lives next to each router
// (routes/auth.spec.ts, routes/sync.spec.ts); this file covers only the
// app-level routes defined in app.ts.
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
});
