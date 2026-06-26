import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { AppEnv, Bindings, RateLimit } from '../lib/env';
import { ApiError } from '../lib/errors';

// Rate limiting — the same shape as brace-api's, minus the per-user key (the
// extractor is anonymous, so there's no session to key on; everything is per-IP).
// The actual volumes (requests / window) are set on the bindings in wrangler.jsonc.
//
// For brace-extractor the rate limit is LOAD-BEARING, not a nicety: an anonymous
// endpoint that fetches any URL and streams bytes is an open proxy / DDoS reflector
// / bandwidth amplifier by default (docs "Abuse caps are load-bearing"). IP rate-
// limiting alone is weak (botnets, shared NAT) — the per-response byte ceiling +
// timeout in the fetch path are its necessary complement, and the documented
// upgrade is blind capability tokens (Privacy Pass), not a session.

// The rate-limit binding names, one per volume tier. Keep in sync with the
// `ratelimits[].name` entries in wrangler.jsonc.
export const RATE_LIMIT_TIERS = {
  // Baseline (configured ~60 req / 60s).
  standard: 'API_RATE_LIMIT',
  // Stricter tier for the arbitrary-URL fetch endpoints (~10 req / 10s ≈ 1/s).
  tight: 'API_RATE_LIMIT_TIGHT',
} as const satisfies Record<string, keyof Bindings>;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

// The counter key. Per-IP + per-path: each (caller, endpoint) pair gets its own
// bucket, so a flood of one endpoint doesn't throttle the others.
// `cf-connecting-ip` is the real client IP set by Cloudflare's edge.
export function ipRateLimitKey(c: Context<AppEnv>): string {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  return `${ip}:${c.req.path}`;
}

// Rate-limit middleware backed by Cloudflare's native Workers Rate Limiting
// binding. `app.ts` applies the `standard` tier globally; the fetch endpoints stack
// the `tight` tier on top at the route level (rateLimit('tight')).
export function rateLimit(tier: RateLimitTier = 'standard') {
  const bindingName = RATE_LIMIT_TIERS[tier];

  return createMiddleware<AppEnv>(async (c, next) => {
    // `c.env` is undefined under `app.request()` in tests, and the binding may be
    // absent in a misconfigured env. Fail OPEN there: an unconfigured limiter
    // shouldn't take the API down. Real envs always bind it.
    const limiter = c.env?.[bindingName] as RateLimit | undefined;
    if (!limiter) return next();

    const { success } = await limiter.limit({ key: ipRateLimitKey(c) });
    if (!success) {
      throw new ApiError(429, 'rate_limited', 'Too many requests');
    }
    return next();
  });
}
