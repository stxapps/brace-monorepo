import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { AppEnv, Bindings, RateLimit } from '../lib/env';
import { ApiError } from '../lib/errors';

// Rate limiting — tiers, key strategies, and the middleware that uses them, all
// in one place (the middleware is the only consumer). The actual volumes
// (requests / window) are set on the bindings in wrangler.jsonc — the native
// binding only allows a 10s or 60s window, so a "1 req/sec" feel is the TIGHT
// tier (10 req / 10s). Here we just name the tiers and pick a key strategy;
// routes choose a tier.
//
// To add a new volume tier: add a `[[ratelimits]]` binding in wrangler.jsonc,
// declare it on `Bindings` (lib/env.ts), and add it to RATE_LIMIT_TIERS.

// The rate-limit binding names, one per volume tier. Keep in sync with the
// `ratelimits[].name` entries in wrangler.jsonc.
export const RATE_LIMIT_TIERS = {
  // Baseline applied to every endpoint (configured ~60 req / 60s).
  standard: 'API_RATE_LIMIT',
  // Stricter tier for sensitive/expensive endpoints (~10 req / 10s ≈ 1/s).
  tight: 'API_RATE_LIMIT_TIGHT',
} as const satisfies Record<string, keyof Bindings>;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

// The counter key. Per-IP + per-path by default: each (caller, endpoint) pair
// gets its own bucket, so a flood of one endpoint doesn't throttle the others.
// `cf-connecting-ip` is the real client IP set by Cloudflare's edge.
export function defaultRateLimitKey(c: Context<AppEnv>): string {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  return `${ip}:${c.req.path}`;
}

// Key an authenticated endpoint by user instead of IP, so a single account
// can't multiply its quota across IPs (and shared IPs don't collide). Falls
// back to IP when there's no session yet. Use as the `key` arg to rateLimit().
export function userRateLimitKey(c: Context<AppEnv>): string {
  const userId = c.get('session')?.userId;
  if (userId) return `user:${userId}:${c.req.path}`;
  return defaultRateLimitKey(c);
}

// Rate-limit middleware backed by Cloudflare's native Workers Rate Limiting
// binding. `app.ts` applies the `standard` tier globally (`app.use('*', …)`);
// individual routes can stack a stricter tier on top, e.g.:
//
//   authRoutes.post('/auth/account', rateLimit('tight'), handler)
//
// Each tier maps to a separate binding (volume is configured in wrangler.jsonc).
// The counter `key` defaults to IP+path; pass a custom key fn (e.g.
// userRateLimitKey) for per-user limits on authed routes.
export function rateLimit(
  tier: RateLimitTier = 'standard',
  key: (c: Context<AppEnv>) => string = defaultRateLimitKey,
) {
  const bindingName = RATE_LIMIT_TIERS[tier];

  return createMiddleware<AppEnv>(async (c, next) => {
    // `c.env` is undefined under `app.request()` in tests, and the binding may
    // be absent in a misconfigured env. Fail OPEN there: an unconfigured
    // limiter shouldn't take the API down. Real envs always bind it.
    const limiter = c.env?.[bindingName] as RateLimit | undefined;
    if (!limiter) return next();

    const { success } = await limiter.limit({ key: key(c) });
    if (!success) {
      throw new ApiError(429, 'rate_limited', 'Too many requests');
    }
    return next();
  });
}
