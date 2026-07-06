import { Hono } from 'hono';
import { cors } from 'hono/cors';

import type { AppEnv, Bindings } from './lib/env';
import { errorHandler } from './lib/errors';
import { rateLimit } from './middleware/rate-limit';
import { authRoutes } from './routes/auth';
import { localR2Routes } from './routes/local-r2';
import { syncRoutes } from './routes/sync';

// Comma-separated allow-list from the Workers binding. `env` is only undefined
// off-Workers (e.g. app.request() in a test that passes no env); a missing
// binding yields an empty list, which denies all cross-origin — fail secure.
function corsOrigins(env: Bindings | undefined): string[] {
  return env?.CORS_ORIGINS?.split(',') ?? [];
}

export const app = new Hono<AppEnv>();

// Centralized error handling: middleware/handlers `throw new HttpError(...)` and
// this turns every error into a uniform JSON body. See lib/errors.ts.
app.onError(errorHandler);

// Browser clients are cross-origin (brace-web dev on :3000, the extension from
// its own origin), so allow CORS. The allow-list is resolved per-request from
// the runtime env; credentials require echoing the specific origin (not '*').
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allow = corsOrigins(c.env as Bindings | undefined);
      return allow.includes(origin) ? origin : null;
    },
    credentials: true,
    // Let browser JS read the 429's Retry-After (middleware/rate-limit.ts) — a
    // non-safelisted response header is invisible to a CORS caller otherwise.
    exposeHeaders: ['Retry-After'],
  }),
);

// Baseline rate limit on EVERY endpoint (standard tier, ~60 req/60s per IP+path;
// configured in wrangler.jsonc). Sensitive routes stack the 'tight' tier on top
// at the route level, e.g. rateLimit('tight'). No-ops when the binding is absent
// (tests / unconfigured env). See middleware/rate-limit.ts.
app.use('*', rateLimit('standard'));

app.get('/', (c) => {
  return c.json({ message: 'Welcome to brace-api' });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

app.route('/', authRoutes);

// Local-first sync control plane (ops/list, ops/commit, files/list, files/sign).
// All four are protected and namespace every path under the authed user; see
// routes/sync.ts and docs/local-first-sync.md.
app.route('/', syncRoutes);

// DEV-ONLY blob proxy (routes/local-r2.ts). Always mounted but self-gates to 404
// off the local miniflare env, so it's inert in staging/prod (which presign R2
// directly). It stands in for direct browser↔R2 transfer under `wrangler dev`,
// where the emulated bucket has no presignable S3 endpoint.
app.route('/', localR2Routes);
