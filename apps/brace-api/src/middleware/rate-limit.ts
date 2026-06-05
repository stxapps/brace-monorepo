import { createMiddleware } from 'hono/factory';

import {
  defaultRateLimitKey,
  RATE_LIMIT_TIERS,
  type RateLimitTier,
} from '../config/rate-limits';
import type { AppEnv, RateLimit } from '../lib/env';
import { ApiError } from '../lib/errors';

// Rate-limit middleware backed by Cloudflare's native Workers Rate Limiting
// binding. `app.ts` applies the `standard` tier globally (`app.use('*', …)`);
// individual routes can stack a stricter tier on top, e.g.:
//
//   authRoutes.post('/auth/account', rateLimit('tight'), handler)
//
// Each tier maps to a separate binding (volume is configured in wrangler.jsonc;
// see config/rate-limits.ts). The counter `key` defaults to IP+path; pass a
// custom key fn (e.g. userRateLimitKey) for per-user limits on authed routes.
export function rateLimit(
  tier: RateLimitTier = 'standard',
  key: (c: import('hono').Context<AppEnv>) => string = defaultRateLimitKey,
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
