import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { checkUsernameEndpoint, type CheckUsernameResponse } from '@stxapps/shared';

import type { AppEnv } from '../lib/env';
import { isUsernameTaken } from '../services/account';

// All routes carry their own '/v1/auth/…' path (from the shared contract,
// version prefix and all), so this sub-app is mounted at the root in app.ts.
export const authRoutes = new Hono<AppEnv>().get(
  checkUsernameEndpoint.path,
  // Validates the query against the SAME schema the client used — the contract
  // is enforced on both ends from one definition in @stxapps/shared.
  zValidator('query', checkUsernameEndpoint.request),
  async (c) => {
    const { username } = c.req.valid('query');
    // Typing the payload against the contract makes the handler fail to compile
    // if the response shape ever drifts from checkUsernameResponseSchema.
    const body: CheckUsernameResponse = {
      available: !(await isUsernameTaken(c.env, username)),
    };
    return c.json(body);
  },
);
