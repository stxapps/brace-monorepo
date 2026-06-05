import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { authRoutes } from './routes/auth';

// Runtime bindings, provided per-env by wrangler.jsonc (`vars`, plus D1/R2 once
// wired). brace-api runs only on Cloudflare Workers — there is no Node entry —
// so these always arrive on `c.env`; every wrangler env sets CORS_ORIGINS.
export type Bindings = {
  CORS_ORIGINS: string;
  // Declared per-env in wrangler.jsonc; uncomment when wired (needs
  // @cloudflare/workers-types):
  // DB: D1Database;
  // FILES: R2Bucket;
};

// Comma-separated allow-list from the Workers binding. `env` is only undefined
// off-Workers (e.g. app.request() in a test that passes no env); a missing
// binding yields an empty list, which denies all cross-origin — fail secure.
function corsOrigins(env: Bindings | undefined): string[] {
  return env?.CORS_ORIGINS?.split(',') ?? [];
}

export const app = new Hono<{ Bindings: Bindings }>();

// Browser clients are cross-origin (brace-web dev on :4000, the extension from
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

app.get('/', (c) => {
  return c.json({ message: 'Welcome to brace-api' });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

app.route('/', authRoutes);
