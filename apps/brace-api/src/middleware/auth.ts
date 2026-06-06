import { createMiddleware } from 'hono/factory';

import { sessionsRepo } from '../db/repositories/sessions';
import type { AppEnv } from '../lib/env';
import { ApiError } from '../lib/errors';
import { hashToken } from '../lib/ids';

// Auth guard. Apply to protected route groups (NOT globally) once endpoints
// land, e.g.:  app.use('/sync/*', requireAuth)
//
// Flow: read `Authorization: Bearer <token>` -> hash it -> look up the session
// in the MASTER DB by token hash -> reject if missing/expired -> attach the
// session (id, userId) to the context for handlers via c.get('session').
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
  if (!token) {
    throw new ApiError(401, 'unauthorized', 'Missing bearer token');
  }

  const session = await sessionsRepo(c.env.MASTER_DB).findByTokenHash(await hashToken(token));
  if (!session || session.expiresAt < Date.now()) {
    throw new ApiError(401, 'unauthorized', 'Invalid or expired session');
  }

  c.set('session', {
    id: session.id,
    userId: session.userId,
  });
  await next();
});
