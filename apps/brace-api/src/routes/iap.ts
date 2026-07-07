import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import {
  API_V1,
  iapCheckoutEndpoint,
  type IapCheckoutResponse,
  iapPortalEndpoint,
  type IapPortalResponse,
  iapStatusEndpoint,
  iapVerifyEndpoint,
  type SubscriptionStatus,
} from '@stxapps/shared';

import type { AppEnv } from '../lib/env';
import { HttpError } from '../lib/errors';
import { paddleEventSchema, verifyPaddleSignature } from '../lib/paddle';
import { requireAuth } from '../middleware/auth';
import { rateLimit, userRateLimitKey } from '../middleware/rate-limit';
import {
  applyPaddleEvent,
  createPaddlePortalSession,
  createPaddleTransaction,
  getSubscriptionStatus,
} from '../services/iap';

// IAP routes: the client-facing subscription surface (status/verify/portal, all
// contract-typed in @stxapps/shared) plus the Paddle webhook. Every route
// carries its own '/v1/…' path, so this sub-app mounts at the root in app.ts.

// The webhook path is NOT a shared contract (its request shape is Paddle's and
// no client calls it), so its path lives here. Registered in the Paddle
// dashboard as a notification destination per env.
export const PADDLE_WEBHOOK_PATH = `${API_V1}/iap/paddle/webhook`;

export const iapRoutes = new Hono<AppEnv>()
  // --- status — the fold every device reads + caches ------------------------
  .get(iapStatusEndpoint.path, requireAuth, async (c) => {
    const body: SubscriptionStatus = await getSubscriptionStatus(c.env, c.get('session').userId);
    return c.json(body);
  })
  // --- checkout — create the Paddle transaction the client opens ------------
  .post(
    iapCheckoutEndpoint.path,
    requireAuth,
    // Tight + per-user: every call is an outbound Paddle API request.
    rateLimit('tight', userRateLimitKey),
    zValidator('json', iapCheckoutEndpoint.request),
    async (c) => {
      const { plan } = c.req.valid('json');
      const transactionId = await createPaddleTransaction(c.env, c.get('session').userId, plan);
      const body: IapCheckoutResponse = { transactionId };
      return c.json(body);
    },
  )
  // --- verify — the store-receipt seam, reserved for brace-expo -------------
  .post(
    iapVerifyEndpoint.path,
    requireAuth,
    // Tight + per-user: once implemented, every call verifies a receipt against
    // the App Store / Play API (an outbound request). Pre-wired now so the cap
    // is already in place when the Expo verifier lands.
    rateLimit('tight', userRateLimitKey),
    zValidator('json', iapVerifyEndpoint.request),
    () => {
      // The contract is live so store clients have a stable shape to build
      // against; the App Store / Play verifiers land with the Expo app.
      throw new HttpError(
        501,
        'not_implemented',
        'Store receipt verification is not available yet',
      );
    },
  )
  // --- portal — mint a Paddle customer-portal session URL -------------------
  .post(
    iapPortalEndpoint.path,
    requireAuth,
    // Tight + per-user: every call is an outbound Paddle API request.
    rateLimit('tight', userRateLimitKey),
    async (c) => {
      const url = await createPaddlePortalSession(c.env, c.get('session').userId);
      const body: IapPortalResponse = { url };
      return c.json(body);
    },
  )
  // --- Paddle webhook — server-to-server, HMAC-authenticated ----------------
  // Exempt from the 'standard' baseline (see app.ts); carries the wide 'webhook'
  // tier instead — per-IP, wide enough that real Paddle bursts never 429, tight
  // enough to bound an attacker who finds the URL to cheap signature checks.
  .post(PADDLE_WEBHOOK_PATH, rateLimit('webhook'), async (c) => {
    // No bearer auth: the caller is Paddle, and the Paddle-Signature HMAC over
    // the RAW body (verified below, against the per-destination secret) is the
    // authentication. Read the raw text FIRST — the signature covers those exact
    // bytes, never a re-serialized parse.
    const secret = c.env?.PADDLE_WEBHOOK_SECRET;
    if (!secret) {
      throw new HttpError(500, 'not_configured', 'Paddle webhook secret is not configured');
    }

    const rawBody = await c.req.text();
    const valid = await verifyPaddleSignature(rawBody, c.req.header('Paddle-Signature'), secret);
    if (!valid) {
      throw new HttpError(401, 'invalid_signature', 'Paddle signature verification failed');
    }

    // Past the signature everything is log-and-ACK: a signed event we can't
    // parse or apply is OUR bug or an event type we don't consume — returning
    // non-2xx would just make Paddle redeliver it forever.
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      console.error('paddle webhook: signed body is not JSON');
      return c.json({ ok: true });
    }
    const parsed = paddleEventSchema.safeParse(json);
    if (!parsed.success) {
      console.error('paddle webhook: unexpected event shape', parsed.error.message);
      return c.json({ ok: true });
    }

    await applyPaddleEvent(c.env, parsed.data);
    return c.json({ ok: true });
  });
