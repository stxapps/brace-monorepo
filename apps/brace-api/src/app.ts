import { Hono } from 'hono';
import { cors } from 'hono/cors';

import type { AppEnv, Bindings } from './lib/env';
import { errorHandler } from './lib/errors';
import { rateLimit } from './middleware/rate-limit';
import { authRoutes } from './routes/auth';

// Comma-separated allow-list from the Workers binding. `env` is only undefined
// off-Workers (e.g. app.request() in a test that passes no env); a missing
// binding yields an empty list, which denies all cross-origin — fail secure.
function corsOrigins(env: Bindings | undefined): string[] {
  return env?.CORS_ORIGINS?.split(',') ?? [];
}

export const app = new Hono<AppEnv>();

// Centralized error handling: middleware/handlers `throw new ApiError(...)` and
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
  }),
);

// Baseline rate limit on EVERY endpoint (standard tier, ~60 req/60s per IP+path;
// configured in wrangler.jsonc). Sensitive routes stack the 'tight' tier on top
// at the route level, e.g. rateLimit('tight'). No-ops when the binding is absent
// (tests / unconfigured env). See middleware/rate-limit.ts + config/rate-limits.ts.
app.use('*', rateLimit('standard'));

app.get('/', (c) => {
  return c.json({ message: 'Welcome to brace-api' });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

app.route('/', authRoutes);
