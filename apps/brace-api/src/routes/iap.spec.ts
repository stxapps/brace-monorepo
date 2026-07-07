import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { iapStatusEndpoint, iapVerifyEndpoint, type SubscriptionStatus } from '@stxapps/shared';

import { app } from '../app';
import { purchasesRepo } from '../db/repositories/purchases';
import { newId } from '../lib/ids';
import { issueSession } from '../services/session';
import { PADDLE_WEBHOOK_PATH } from './iap';

// The IAP surface through the real Hono app + real (miniflare) D1: the status
// fold, the store-verify stub, and the Paddle webhook — signature verification
// (against the test-pool's PADDLE_WEBHOOK_SECRET, see vitest.config.ts), the
// event → purchase-row application, and the out-of-order guard. The webhook
// events here are the SLICE brace-api consumes (lib/paddle.ts paddleEventSchema
// is deliberately loose), signed exactly as Paddle signs: HMAC-SHA256 over
// `${ts}:${rawBody}` in a `ts=…;h1=…` header.

const DAY_MS = 24 * 60 * 60 * 1000;

async function authFor(userId: string): Promise<{ userId: string; auth: Record<string, string> }> {
  const { token } = await issueSession(env, { id: userId, accountDbId: '1' });
  return { userId, auth: { authorization: `Bearer ${token}` } };
}

async function getStatus(auth: Record<string, string>): Promise<SubscriptionStatus> {
  const res = await app.request(iapStatusEndpoint.path, { headers: auth }, env);
  expect(res.status).toBe(200);
  return (await res.json()) as SubscriptionStatus;
}

// Sign a raw body the way Paddle does. `tsSeconds` overridable to test the
// stale-timestamp rejection.
async function paddleSignature(
  rawBody: string,
  secret: string,
  tsSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${tsSeconds}:${rawBody}`)),
  );
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  return `ts=${tsSeconds};h1=${hex}`;
}

async function postWebhook(
  body: unknown,
  options: { tsSeconds?: number; signature?: string } = {},
) {
  const rawBody = JSON.stringify(body);
  const signature =
    options.signature ??
    (await paddleSignature(rawBody, env.PADDLE_WEBHOOK_SECRET, options.tsSeconds));
  return app.request(
    PADDLE_WEBHOOK_PATH,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Paddle-Signature': signature },
      body: rawBody,
    },
    env,
  );
}

// A subscription.* event carrying the fields applyPaddleEvent consumes. The
// plan's price id comes from the same env var the server maps with, so the test
// tracks the config instead of duplicating a literal.
function subscriptionEvent(overrides: {
  eventType?: string;
  occurredAt?: number;
  subscriptionId: string;
  status?: string;
  userId?: string;
  priceId?: string;
  endsAt?: number | null;
  canceledAt?: number | null;
  scheduledChange?: { action: string; effective_at?: string } | null;
}) {
  const occurredAt = overrides.occurredAt ?? Date.now();
  const endsAt = overrides.endsAt === undefined ? Date.now() + 30 * DAY_MS : overrides.endsAt;
  return {
    event_id: `evt_${newId()}`,
    event_type: overrides.eventType ?? 'subscription.activated',
    occurred_at: new Date(occurredAt).toISOString(),
    data: {
      id: overrides.subscriptionId,
      status: overrides.status ?? 'active',
      customer_id: 'ctm_test',
      custom_data: overrides.userId === undefined ? null : { userId: overrides.userId },
      items: [{ price: { id: overrides.priceId ?? env.PADDLE_PRICE_ID_PLUS } }],
      current_billing_period: endsAt === null ? null : { ends_at: new Date(endsAt).toISOString() },
      canceled_at:
        overrides.canceledAt == null ? null : new Date(overrides.canceledAt).toISOString(),
      scheduled_change: overrides.scheduledChange ?? null,
    },
  };
}

describe('iap', () => {
  describe(`GET ${iapStatusEndpoint.path}`, () => {
    it('requires auth', async () => {
      const res = await app.request(iapStatusEndpoint.path, {}, env);
      expect(res.status).toBe(401);
    });

    it('folds an account with no purchases to free/none', async () => {
      const { auth } = await authFor('iap-free-1');
      expect(await getStatus(auth)).toEqual({
        plan: 'free',
        status: 'none',
        source: null,
        expiresAt: null,
        willRenew: false,
      });
    });

    it('folds a non-expiring manual grant to its plan, never renewing', async () => {
      const { userId, auth } = await authFor('iap-manual-1');
      await purchasesRepo(env.DIRECTORY_DB).upsertFromProvider({
        id: newId(),
        userId,
        source: 'manual',
        externalId: `grant-${userId}`,
        plan: 'pro',
        status: 'active',
        providerCustomerId: null,
        expiresAt: null,
        canceledAt: null,
        eventOccurredAt: Date.now(),
      });
      expect(await getStatus(auth)).toEqual({
        plan: 'pro',
        status: 'active',
        source: 'manual',
        expiresAt: null,
        willRenew: false,
      });
    });
  });

  describe(`POST ${iapVerifyEndpoint.path}`, () => {
    it('is a stable 501 stub until the store verifiers ship', async () => {
      const { auth } = await authFor('iap-verify-1');
      const res = await app.request(
        iapVerifyEndpoint.path,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...auth },
          body: JSON.stringify({ source: 'appstore', productId: 'p', token: 't' }),
        },
        env,
      );
      expect(res.status).toBe(501);
      expect(((await res.json()) as { error: string }).error).toBe('not_implemented');
    });
  });

  describe(`POST ${PADDLE_WEBHOOK_PATH}`, () => {
    it('rejects a bad signature and a stale timestamp', async () => {
      const event = subscriptionEvent({ subscriptionId: 'sub_bad', userId: 'iap-x' });

      const badSig = await postWebhook(event, { signature: 'ts=1;h1=deadbeef' });
      expect(badSig.status).toBe(401);

      // Correctly signed but 10 minutes old — outside the replay window.
      const stale = await postWebhook(event, {
        tsSeconds: Math.floor((Date.now() - 10 * 60 * 1000) / 1000),
      });
      expect(stale.status).toBe(401);
    });

    it('applies a signed activation: the account flips to the plan of the priced item', async () => {
      const { userId, auth } = await authFor('iap-hook-1');
      const endsAt = Date.now() + 30 * DAY_MS;

      const res = await postWebhook(
        subscriptionEvent({ subscriptionId: 'sub_hook_1', userId, endsAt }),
      );
      expect(res.status).toBe(200);

      const status = await getStatus(auth);
      expect(status.plan).toBe('plus');
      expect(status.status).toBe('active');
      expect(status.source).toBe('paddle');
      expect(status.willRenew).toBe(true);
      // toISOString keeps milliseconds, so the period end round-trips exactly.
      expect(status.expiresAt).toBe(endsAt);
    });

    it('folds a trialing subscription (real trial-end expiry) to active + renewing', async () => {
      const { userId, auth } = await authFor('iap-hook-trial-1');
      const endsAt = Date.now() + 14 * DAY_MS; // trial end

      await postWebhook(
        subscriptionEvent({ subscriptionId: 'sub_hook_t1', userId, status: 'trialing', endsAt }),
      );

      const status = await getStatus(auth);
      expect(status.plan).toBe('plus');
      expect(status.status).toBe('active'); // trialing folds to the client-facing 'active'
      expect(status.willRenew).toBe(true);
      expect(status.expiresAt).toBe(endsAt);
    });

    it('does NOT entitle a provider row with a null expiry (missing period ≠ lifetime)', async () => {
      const { userId, auth } = await authFor('iap-hook-nullexp-1');

      // A trialing event that arrived without a current_billing_period: null expiry
      // is a MISSING period for a provider sub, not a lifetime grant — it must fold
      // to free, never entitle forever (only source:'manual' grants may be lifetime).
      await postWebhook(
        subscriptionEvent({
          subscriptionId: 'sub_hook_ne1',
          userId,
          status: 'trialing',
          endsAt: null,
        }),
      );

      expect(await getStatus(auth)).toEqual({
        plan: 'free',
        status: 'none',
        source: null,
        expiresAt: null,
        willRenew: false,
      });
    });

    it('a scheduled cancellation keeps the plan but stops renewal', async () => {
      const { userId, auth } = await authFor('iap-hook-cancel-1');
      const endsAt = Date.now() + 20 * DAY_MS;

      await postWebhook(subscriptionEvent({ subscriptionId: 'sub_hook_c1', userId, endsAt }));
      await postWebhook(
        subscriptionEvent({
          eventType: 'subscription.updated',
          occurredAt: Date.now() + 1000,
          subscriptionId: 'sub_hook_c1',
          userId,
          endsAt,
          scheduledChange: { action: 'cancel', effective_at: new Date(endsAt).toISOString() },
        }),
      );

      const status = await getStatus(auth);
      expect(status.plan).toBe('plus'); // entitled through the paid period
      expect(status.willRenew).toBe(false);
    });

    it('drops an out-of-order older event instead of regressing state', async () => {
      const { userId, auth } = await authFor('iap-hook-order-1');
      const now = Date.now();

      // Newest state first: an active subscription…
      await postWebhook(
        subscriptionEvent({ subscriptionId: 'sub_hook_o1', userId, occurredAt: now }),
      );
      // …then a STALE, earlier-occurred paused event arrives late (a redelivery).
      await postWebhook(
        subscriptionEvent({
          eventType: 'subscription.paused',
          occurredAt: now - 60_000,
          subscriptionId: 'sub_hook_o1',
          userId,
          status: 'paused',
        }),
      );

      expect((await getStatus(auth)).plan).toBe('plus'); // the newer 'active' held
    });

    it('binds a subscription to its first-seen account for life', async () => {
      const { userId, auth } = await authFor('iap-hook-bind-1');
      await postWebhook(subscriptionEvent({ subscriptionId: 'sub_hook_b1', userId }));

      // A later event carrying a DIFFERENT custom_data.userId must not re-point
      // the subscription (the stored binding wins).
      const other = await authFor('iap-hook-bind-2');
      await postWebhook(
        subscriptionEvent({
          eventType: 'subscription.updated',
          occurredAt: Date.now() + 1000,
          subscriptionId: 'sub_hook_b1',
          userId: other.userId,
        }),
      );

      expect((await getStatus(auth)).plan).toBe('plus');
      expect((await getStatus(other.auth)).plan).toBe('free');
    });

    it('ACKs (200) an event it cannot apply, so Paddle never redelivers forever', async () => {
      // Unknown price id → logged and dropped, still 200.
      const res = await postWebhook(
        subscriptionEvent({
          subscriptionId: 'sub_hook_unknown',
          userId: 'iap-hook-u1',
          priceId: 'pri_unknown',
        }),
      );
      expect(res.status).toBe(200);
    });
  });
});
