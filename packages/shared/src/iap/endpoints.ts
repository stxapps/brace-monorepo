import { z } from 'zod';

import { API_V1, defineEndpoint } from '../api/endpoint';
import { AVAILABLE_PAID_PLANS, PLANS } from './plans';

// IAP endpoint contracts. Subscription state is a SERVER-DERIVED fact (its
// writer of record is a payment-provider webhook), so it is deliberately NOT a
// synced entity in sync/entities.ts: the server can't write into the user's
// encrypted keyspace, and a client-authored copy would be an unverifiable, stale
// echo racing itself under LWW. Every device instead asks brace-api — the one
// authority — via `iap/status` and caches the answer locally. See
// docs/business-model.md for the tiers and iap/plans.ts for what a plan unlocks.
//
// The Paddle WEBHOOK route (`/v1/iap/paddle/webhook`) has no contract here on
// purpose: its request shape is Paddle's, not ours, and no client of this
// package ever calls it — it lives only in brace-api.

// Where a subscription was purchased. 'manual' is a server-side grant (comps,
// lifetime deals) with no external provider to verify against.
export const SUBSCRIPTION_SOURCES = ['paddle', 'appstore', 'playstore', 'manual'] as const;
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];

// The account's folded subscription state — what `iap/status` returns and every
// client caches. `plan` is what the client feeds `entitlementsOf()`; the rest is
// display state for the subscription settings UI.
//
// `status`: 'none' = no live subscription (plan is then 'free'); 'active' = paid
// and in good standing; 'grace' = payment trouble (past_due) but still entitled
// while the provider retries — the UI should surface "update your payment
// method" without yanking features mid-dunning.
export const subscriptionStatusSchema = z.object({
  plan: z.enum(PLANS),
  status: z.enum(['none', 'active', 'grace']),
  source: z.enum(SUBSCRIPTION_SOURCES).nullable(),
  // Epoch ms the current paid period runs to; null when free or non-expiring
  // (a lifetime/manual grant).
  expiresAt: z.number().int().nullable(),
  // False once the user has canceled (still entitled until expiresAt, but the
  // subscription won't renew) — drives "expires on …" vs "renews on …" copy.
  willRenew: z.boolean(),
});
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

// GET /v1/iap/status → SubscriptionStatus (authenticated)
// The single truth every device reads. Cheap (one indexed D1 read), so clients
// refetch on app start and after a checkout completes (webhooks lag checkout by
// seconds — poll this with a short retry until the plan flips).
export const iapStatusEndpoint = defineEndpoint({
  method: 'GET',
  path: `${API_V1}/iap/status`,
  request: z.object({}),
  response: subscriptionStatusSchema,
});

// POST /v1/iap/checkout → { transactionId } (authenticated)
// Creates a Paddle transaction server-side and returns its id for the client to
// open in the overlay checkout (`Paddle.Checkout.open({ transactionId })`).
// Server-created for two reasons: the client never knows its own userId (the
// account model mints it server-side, so the webhook's `custom_data.userId`
// binding must be stamped by the server from the session), and it keeps the
// purchased price server-authoritative rather than a client-supplied price id.
// Only plans currently ON SALE are accepted (AVAILABLE_PAID_PLANS, not the full
// PAID_PLANS catalog): the wire contract itself rejects a checkout for a
// not-yet-sold plan, so Pro can stay fully specified without being purchasable.
export const iapCheckoutRequestSchema = z.object({
  plan: z.enum(AVAILABLE_PAID_PLANS),
});
export type IapCheckoutRequest = z.infer<typeof iapCheckoutRequestSchema>;

export const iapCheckoutResponseSchema = z.object({
  // Paddle transaction id (txn_…) to open the checkout with.
  transactionId: z.string(),
});
export type IapCheckoutResponse = z.infer<typeof iapCheckoutResponseSchema>;

export const iapCheckoutEndpoint = defineEndpoint({
  method: 'POST',
  path: `${API_V1}/iap/checkout`,
  request: iapCheckoutRequestSchema,
  response: iapCheckoutResponseSchema,
});

// POST /v1/iap/verify → SubscriptionStatus (authenticated)
// The store-receipt seam, reserved NOW for brace-expo: App Store / Play Store
// purchases are client-side events the server only learns about from a receipt
// the app submits (unlike Paddle, where checkout carries our userId straight to
// the webhook). brace-api verifies the token against the store's API and
// records the purchase. Until the Expo app exists the server answers 501.
export const iapVerifyRequestSchema = z.object({
  source: z.enum(['appstore', 'playstore']),
  // The store product identifier of the purchased subscription.
  productId: z.string().min(1),
  // The store's proof of purchase: a Play Billing purchase token, or the App
  // Store originalTransactionId to look up via the App Store Server API.
  token: z.string().min(1),
});
export type IapVerifyRequest = z.infer<typeof iapVerifyRequestSchema>;

export const iapVerifyEndpoint = defineEndpoint({
  method: 'POST',
  path: `${API_V1}/iap/verify`,
  request: iapVerifyRequestSchema,
  response: subscriptionStatusSchema,
});

// POST /v1/iap/portal → { url } (authenticated)
// Mints a short-lived Paddle customer-portal session URL — where a Paddle
// subscriber manages payment method, invoices, and cancellation. Server-minted
// because the portal API needs the secret Paddle API key and the stored Paddle
// customer id; the client just opens the returned URL. 404s when the account
// has no Paddle subscription (store subscriptions are managed in the store).
export const iapPortalResponseSchema = z.object({
  url: z.string(),
});
export type IapPortalResponse = z.infer<typeof iapPortalResponseSchema>;

export const iapPortalEndpoint = defineEndpoint({
  method: 'POST',
  path: `${API_V1}/iap/portal`,
  request: z.object({}),
  response: iapPortalResponseSchema,
});
