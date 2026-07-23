import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  iapStatusEndpoint,
  iapVerifyEndpoint,
  STORE_PRODUCT_IDS,
  type SubscriptionStatus,
} from '@stxapps/shared';

import { app } from '../app';
import { purchasesRepo } from '../db/repositories/purchases';
import { newId } from '../lib/ids';
import { issueSession } from '../services/session';
import { APPSTORE_NOTIFY_PATH, PADDLE_WEBHOOK_PATH, PLAYSTORE_NOTIFY_PATH } from './iap';

// The IAP surface through the real Hono app + real (miniflare) D1: the status
// fold, the store verifiers, and the provider webhooks — Paddle signature
// verification (against the test-pool's PADDLE_WEBHOOK_SECRET, see
// vitest.config.ts), the event → purchase-row application, and the out-of-order
// guard. The Paddle events here are the SLICE brace-api consumes (lib/paddle.ts
// paddleEventSchema is deliberately loose), signed exactly as Paddle signs:
// HMAC-SHA256 over `${ts}:${rawBody}` in a `ts=…;h1=…` header.
//
// The STORE flows (verify + notify) run against a `globalThis.fetch` stub
// standing in for the App Store Server API / Play Developer API — the JWT
// minting and outbound calls are real (the test pool provides real throwaway
// signing keys, see vitest.config.ts); only the store's answer is scripted.
// (A stub, not vitest-pool-workers' old fetchMock — that export is gone from
// current versions.) The JWS blobs in Apple's responses carry an unverifiable
// signature on purpose: the code decodes payloads it fetched from Apple over
// TLS without chain verification (the call-back trust model —
// lib/appstore.ts), and these tests pin that.

const DAY_MS = 24 * 60 * 60 * 1000;

// One-shot outbound stubs, matched by URL substring in order. Anything
// unmatched fails loudly (tests must never hit the real network), and each
// test asserts its stubs were consumed (assertNoPendingStubs).
let fetchStubs: { match: string; status: number; body: unknown }[] = [];
const realFetch = globalThis.fetch;

function stubOutboundFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    // app.request() dispatches the app's own routes through fetch too — only
    // intercept absolute external URLs our stubs know.
    const i = fetchStubs.findIndex((s) => url.includes(s.match));
    if (i >= 0) {
      const [stub] = fetchStubs.splice(i, 1);
      return new Response(JSON.stringify(stub.body), {
        status: stub.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
}

function assertNoPendingStubs() {
  const pending = fetchStubs.map((s) => s.match);
  fetchStubs = [];
  expect(pending).toEqual([]);
}

// A compact-JWS-shaped blob whose payload decodes to `payload` (signature is
// garbage — see the trust-model note above).
function fakeJws(payload: unknown): string {
  const b64url = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'ES256' })}.${b64url(payload)}.sig`;
}

// Script the App Store Server API's subscription-statuses answer for one GET.
function mockAppstoreStatuses(options: {
  originalTransactionId: string;
  status?: number;
  productId?: string;
  expiresDate?: number;
  autoRenewStatus?: number;
  offerDiscountType?: string;
}) {
  const body = {
    data: [
      {
        lastTransactions: [
          {
            originalTransactionId: options.originalTransactionId,
            status: options.status ?? 1,
            signedTransactionInfo: fakeJws({
              productId: options.productId ?? STORE_PRODUCT_IDS.plus,
              originalTransactionId: options.originalTransactionId,
              expiresDate: options.expiresDate ?? Date.now() + 30 * DAY_MS,
              offerDiscountType: options.offerDiscountType ?? null,
            }),
            signedRenewalInfo: fakeJws({ autoRenewStatus: options.autoRenewStatus ?? 1 }),
          },
        ],
      },
    ],
  };
  fetchStubs.push({ match: '/inApps/v1/subscriptions/', status: 200, body });
}

// Script the Play token exchange + subscriptionsv2 answer for one lookup.
function mockPlaySubscription(options: {
  state?: string;
  productId?: string;
  expiryTime?: number;
  autoRenewEnabled?: boolean;
}) {
  fetchStubs.push({
    match: 'oauth2.googleapis.com/token',
    status: 200,
    body: { access_token: 'test-access-token', expires_in: 3600 },
  });
  fetchStubs.push({
    match: '/purchases/subscriptionsv2/tokens/',
    status: 200,
    body: {
      subscriptionState: options.state ?? 'SUBSCRIPTION_STATE_ACTIVE',
      lineItems: [
        {
          productId: options.productId ?? STORE_PRODUCT_IDS.plus,
          expiryTime: new Date(options.expiryTime ?? Date.now() + 30 * DAY_MS).toISOString(),
          autoRenewingPlan: { autoRenewEnabled: options.autoRenewEnabled ?? true },
        },
      ],
    },
  });
}

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
    beforeAll(stubOutboundFetch);
    afterEach(assertNoPendingStubs);

    async function postVerify(
      auth: Record<string, string>,
      body: { source: 'appstore' | 'playstore'; productId?: string; token: string },
    ) {
      return app.request(
        iapVerifyEndpoint.path,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...auth },
          body: JSON.stringify({ productId: STORE_PRODUCT_IDS.plus, ...body }),
        },
        env,
      );
    }

    it('requires auth', async () => {
      const res = await app.request(
        iapVerifyEndpoint.path,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: 'appstore', productId: 'p', token: 't' }),
        },
        env,
      );
      expect(res.status).toBe(401);
    });

    it('verifies an App Store purchase: fetches Apple, records the row, returns the fold', async () => {
      const { auth } = await authFor('iap-verify-as-1');
      const expiresDate = Date.now() + 30 * DAY_MS;
      mockAppstoreStatuses({ originalTransactionId: 'otid-as-1', expiresDate });

      const res = await postVerify(auth, { source: 'appstore', token: '2000000000000001' });
      expect(res.status).toBe(200);
      const status = (await res.json()) as SubscriptionStatus;
      expect(status.plan).toBe('plus');
      expect(status.status).toBe('active');
      expect(status.source).toBe('appstore');
      expect(status.willRenew).toBe(true);
      expect(status.expiresAt).toBe(expiresDate);

      // The fold every device reads agrees.
      expect((await getStatus(auth)).plan).toBe('plus');
    });

    it('verifies a Play purchase through the token exchange + subscriptionsv2', async () => {
      const { auth } = await authFor('iap-verify-ps-1');
      mockPlaySubscription({});

      const res = await postVerify(auth, { source: 'playstore', token: 'play-token-ps-1' });
      expect(res.status).toBe(200);
      const status = (await res.json()) as SubscriptionStatus;
      expect(status.plan).toBe('plus');
      expect(status.source).toBe('playstore');
      expect(status.willRenew).toBe(true);
    });

    it('maps auto-renew OFF to a scheduled cancel (entitled, not renewing)', async () => {
      const { auth } = await authFor('iap-verify-as-2');
      mockAppstoreStatuses({ originalTransactionId: 'otid-as-2', autoRenewStatus: 0 });

      const res = await postVerify(auth, { source: 'appstore', token: '2000000000000002' });
      const status = (await res.json()) as SubscriptionStatus;
      expect(status.plan).toBe('plus');
      expect(status.willRenew).toBe(false);
    });

    it('422s a token the store does not recognize', async () => {
      const { auth } = await authFor('iap-verify-as-3');
      fetchStubs.push({
        match: '/inApps/v1/subscriptions/',
        status: 404,
        body: { errorCode: 4040010 },
      });

      const res = await postVerify(auth, { source: 'appstore', token: '2000000000000003' });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_receipt');
    });

    it('422s a verified purchase for a product we never sold', async () => {
      const { auth } = await authFor('iap-verify-as-4');
      mockAppstoreStatuses({ originalTransactionId: 'otid-as-4', productId: 'brace.unknown' });

      const res = await postVerify(auth, { source: 'appstore', token: '2000000000000004' });
      expect(res.status).toBe(422);
    });

    it('409s a subscription already bound to another account (first sight is for life)', async () => {
      const first = await authFor('iap-verify-bind-1');
      mockAppstoreStatuses({ originalTransactionId: 'otid-bind-1' });
      expect((await postVerify(first.auth, { source: 'appstore', token: '3000000000000001' })).status).toBe(200);

      // A second account replays the same token — Apple answers the same
      // subscription; the stored binding must win.
      const second = await authFor('iap-verify-bind-2');
      mockAppstoreStatuses({ originalTransactionId: 'otid-bind-1' });
      const res = await postVerify(second.auth, { source: 'appstore', token: '3000000000000001' });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toBe('purchase_bound');
      expect((await getStatus(second.auth)).plan).toBe('free');
    });
  });

  describe(`store notifications`, () => {
    beforeAll(stubOutboundFetch);
    afterEach(assertNoPendingStubs);

    it('playstore: rejects a bad push token before any outbound work', async () => {
      const res = await app.request(
        `${PLAYSTORE_NOTIFY_PATH}?token=wrong`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        env,
      );
      expect(res.status).toBe(401);
    });

    it('playstore: re-fetches Google and applies the newer state to the bound row', async () => {
      // Bind the subscription first via verify (notifications carry no account).
      const { auth } = await authFor('iap-notify-ps-1');
      mockPlaySubscription({});
      const verifyRes = await app.request(
        iapVerifyEndpoint.path,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...auth },
          body: JSON.stringify({
            source: 'playstore',
            productId: STORE_PRODUCT_IDS.plus,
            token: 'play-token-notify-1',
          }),
        },
        env,
      );
      expect(verifyRes.status).toBe(200);
      expect((await getStatus(auth)).willRenew).toBe(true);

      // The user cancels in the Play app → an RTDN arrives; the route must
      // re-read Google's (now canceled) state, never the pushed payload.
      mockPlaySubscription({ state: 'SUBSCRIPTION_STATE_CANCELED', autoRenewEnabled: false });
      const push = {
        message: {
          data: btoa(
            JSON.stringify({
              version: '1.0',
              packageName: 'to.brace.app',
              subscriptionNotification: {
                notificationType: 3, // SUBSCRIPTION_CANCELED — advisory only
                purchaseToken: 'play-token-notify-1',
                subscriptionId: STORE_PRODUCT_IDS.plus,
              },
            }),
          ),
        },
      };
      const res = await app.request(
        `${PLAYSTORE_NOTIFY_PATH}?token=${env.PLAY_NOTIFY_TOKEN}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(push),
        },
        env,
      );
      expect(res.status).toBe(200);

      const status = await getStatus(auth);
      expect(status.plan).toBe('plus'); // entitled through the paid period
      expect(status.willRenew).toBe(false);
    });

    it('appstore: extracts the transaction id, re-fetches Apple, applies to the bound row', async () => {
      const { auth } = await authFor('iap-notify-as-1');
      mockAppstoreStatuses({ originalTransactionId: 'otid-notify-1' });
      const verifyRes = await app.request(
        iapVerifyEndpoint.path,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...auth },
          body: JSON.stringify({
            source: 'appstore',
            productId: STORE_PRODUCT_IDS.plus,
            token: '4000000000000001',
          }),
        },
        env,
      );
      expect(verifyRes.status).toBe(200);

      // Auto-renew turned off → DID_CHANGE_RENEWAL_STATUS notification; facts
      // come from the re-fetch (autoRenewStatus 0), not the notification body.
      mockAppstoreStatuses({ originalTransactionId: 'otid-notify-1', autoRenewStatus: 0 });
      const res = await app.request(
        APPSTORE_NOTIFY_PATH,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            signedPayload: fakeJws({
              notificationType: 'DID_CHANGE_RENEWAL_STATUS',
              data: {
                signedTransactionInfo: fakeJws({ originalTransactionId: 'otid-notify-1' }),
              },
            }),
          }),
        },
        env,
      );
      expect(res.status).toBe(200);

      const status = await getStatus(auth);
      expect(status.plan).toBe('plus');
      expect(status.willRenew).toBe(false);
    });

    it('appstore: ACKs a notification for a never-verified subscription (no binding yet)', async () => {
      mockAppstoreStatuses({ originalTransactionId: 'otid-notify-unbound' });
      const res = await app.request(
        APPSTORE_NOTIFY_PATH,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            signedPayload: fakeJws({
              data: {
                signedTransactionInfo: fakeJws({ originalTransactionId: 'otid-notify-unbound' }),
              },
            }),
          }),
        },
        env,
      );
      expect(res.status).toBe(200);
    });

    it('appstore: ACKs the TEST ping (no transaction to look up)', async () => {
      const res = await app.request(
        APPSTORE_NOTIFY_PATH,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ signedPayload: fakeJws({ notificationType: 'TEST' }) }),
        },
        env,
      );
      expect(res.status).toBe(200);
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
