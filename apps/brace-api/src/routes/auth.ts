import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import {
  bytesToHex,
  checkUsernameEndpoint,
  type CheckUsernameResponse,
  createAccountEndpoint,
  createAccountPayloadSchema,
  type CreateAccountResponse,
  hexToBytes,
  passwordDoorEndpoint,
  type PasswordDoorResponse,
  signInEndpoint,
  signInPayloadSchema,
  type SignInResponse,
  signOutEndpoint,
  type SignOutResponse,
} from '@stxapps/shared';

import { verifyAuthProof } from '../lib/auth-proof';
import type { AppEnv } from '../lib/env';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { createAccount, getPasswordDoor, isUsernameTaken, signIn } from '../services/account';
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
  .get(
    passwordDoorEndpoint.path,
    // Pre-auth and an offline-attack oracle (it hands the wrapped DEK to anyone who
    // names a username), so stack the tight tier to blunt mass-scraping. Rate-limiting
    // is the defense here; username existence stays observable by design (see the
    // AWARENESS note on getPasswordDoor and docs/account.md).
    rateLimit('tight'),
    zValidator('query', passwordDoorEndpoint.request),
    async (c) => {
      const { username } = c.req.valid('query');
      // A missing user/door throws a 404 inside the service; the client maps it to
      // the same "incorrect username or password" as a wrong password, so the UI
      // stays opaque — though the 404-vs-200 is still an existence signal on the
      // wire, which we accept (see getPasswordDoor's AWARENESS note).
      const door = await getPasswordDoor(c.env, username);
      const body: PasswordDoorResponse = {
        wrappedDek: bytesToHex(door.wrappedDek),
        iv: bytesToHex(door.iv),
      };
      return c.json(body);
    },
  )
  .post(
    signInEndpoint.path,
    // Credential verification is a prime abuse target, so stack the tight tier.
    rateLimit('tight'),
    // Validate the OUTER envelope ({ payload: string, signature }); the inner signed
    // payload is parsed + validated inside verifyAuthProof, after the signature is
    // checked over its exact bytes.
    zValidator('json', signInEndpoint.request),
    async (c) => {
      const { payload, signature } = c.req.valid('json');

      // Proof-of-possession: verify the signature over the exact signed bytes, that
      // the payload is fresh, and that action === 'sign-in' (so a create-account
      // proof can't be replayed here). signIn then runs THE load-bearing check:
      // the presented publicKey must equal the stored credential for the username.
      const proof = await verifyAuthProof(payload, signature, signInPayloadSchema);

      const result = await signIn(c.env, {
        username: proof.username,
        publicKey: proof.publicKey,
      });

      const body: SignInResponse = {
        token: result.session.token,
        expiresAt: result.session.expiresAt,
      };
      return c.json(body);
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
