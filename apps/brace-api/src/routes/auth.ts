import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { checkUsernameEndpoint, type CheckUsernameResponse } from '@stxapps/shared';

// Stub user store until brace-api has a real users table. These names resolve as
// "taken" so the create-account flow can be exercised end-to-end today; swap the
// lookup below for the DB query when it lands.
const takenUsernames = new Set(['admin', 'root', 'brace', 'support', 'test']);

function isUsernameTaken(username: string): boolean {
  return takenUsernames.has(username.toLowerCase());
}

// All routes carry their own '/v1/auth/…' path (from the shared contract,
// version prefix and all), so this sub-app is mounted at the root in app.ts.
export const authRoutes = new Hono().get(
  checkUsernameEndpoint.path,
  // Validates the query against the SAME schema the client used — the contract
  // is enforced on both ends from one definition in @stxapps/shared.
  zValidator('query', checkUsernameEndpoint.request),
  (c) => {
    const { username } = c.req.valid('query');
    // Typing the payload against the contract makes the handler fail to compile
    // if the response shape ever drifts from checkUsernameResponseSchema.
    const body: CheckUsernameResponse = { available: !isUsernameTaken(username) };
    return c.json(body);
  },
);
