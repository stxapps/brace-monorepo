import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import {
  checkUsernameEndpoint,
  type CheckUsernameResponse,
  createAccountEndpoint,
  createAccountPayloadSchema,
  type CreateAccountResponse,
  hexToBytes,
  signOutEndpoint,
  type SignOutResponse,
} from '@stxapps/shared';

import { verifyAuthProof } from '../lib/auth-proof';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { createAccount, isUsernameTaken } from '../services/account';
import { revokeSession } from '../services/session';

// All routes carry their own '/v1/auth/…' path (from the shared contract,
// version prefix and all), so this sub-app is mounted at the root in app.ts.
export const authRoutes = new Hono<AppEnv>()
  .get(
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
  )
  .post(
    createAccountEndpoint.path,
    // Account creation is expensive (a shard write + a session mint) and a prime
    // abuse target, so stack the tight tier on top of the global standard limit.
    rateLimit('tight'),
    // Validate only the OUTER envelope here ({ payload: string, signature }); the
    // inner signed payload is parsed + validated inside verifyAuthProof, after the
    // signature is checked over its exact bytes.
    zValidator('json', createAccountEndpoint.request),
    async (c) => {
      const { payload, signature } = c.req.valid('json');

      // Proof-of-possession: verify the signature over the exact signed bytes, and
      // that the payload is fresh and for this action, BEFORE provisioning anything.
      const proof = await verifyAuthProof(payload, signature, createAccountPayloadSchema);

      const result = await createAccount(c.env, {
        username: proof.username,
        publicKey: proof.publicKey,
        // Phase 0: a single password door. The wrapped DEK + IV arrive hex-encoded.
        doors: [
          {
            doorType: 'password',
            wrappedDek: hexToBytes(proof.passwordDoor.wrappedDek),
            iv: hexToBytes(proof.passwordDoor.iv),
          },
        ],
      });

      const body: CreateAccountResponse = {
        token: result.session.token,
        expiresAt: result.session.expiresAt,
      };
      return c.json(body, 201);
    },
  )
  .post(
    signOutEndpoint.path,
    // Protected: the bearer token names the session to revoke. requireAuth
    // resolves it onto the context (404/expired tokens 401 out before here).
    requireAuth,
    async (c) => {
      // Idempotent delete — a token that already passed requireAuth has a live
      // row; deleting it makes the token stop authenticating immediately.
      await revokeSession(c.env, c.get('session').id);
      const body: SignOutResponse = { ok: true };
      return c.json(body);
    },
  );
