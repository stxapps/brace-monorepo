import { z } from 'zod';

import type { PurchaseStatus } from '../db/repositories/purchases';
import { pemToPkcs8, type StoreSubscriptionSnapshot } from './appstore';
import type { Bindings } from './env';

// Play Store provider-vocab edge — the `lib/paddle.ts` sibling for Google.
// Everything Play-shaped (the service-account OAuth token, the subscriptionsv2
// fetch, RTDN decoding, state normalization) lives here so services/iap.ts only
// ever sees normalized statuses and epoch-ms times.
//
// Same call-back trust model as lib/appstore.ts: the purchase token — whether
// it arrives from the app's `iap/verify` or a Pub/Sub push — is only a LOOKUP
// KEY; the facts come from a fresh server-to-server fetch of
// `purchases.subscriptionsv2.get` on the Play Developer API. A forged token
// fetches nothing (404 → invalid_receipt); a forged Pub/Sub push can only make
// us re-read the truth.

const PLAY_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PLAY_API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncodeJson(value: unknown): string {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

// Service-account access token via the OAuth2 JWT-bearer flow: an RS256 JWT
// signed with the service account's key (the PLAY_SA_PRIVATE_KEY secret —
// PKCS#8 PEM, the `private_key` field of the downloaded JSON), exchanged at
// Google's token endpoint. Fetched per call, like the App Store JWT — the
// verify/notify paths are tightly rate-limited, so a token cache would buy
// little and add a staleness surface.
export async function playAccessToken(env: Bindings, now: number = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const claims = {
    iss: env.PLAY_SA_EMAIL,
    scope: PLAY_SCOPE,
    aud: PLAY_TOKEN_URL,
    iat,
    exp: iat + 5 * 60,
  };
  const signingInput = `${b64urlEncodeJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlEncodeJson(claims)}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(env.PLAY_SA_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)),
  );
  const assertion = `${signingInput}.${b64urlEncode(sig)}`;

  const res = await fetch(PLAY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    console.error(`playAccessToken: token endpoint ${res.status}`);
    throw new Error(`Play token endpoint ${res.status}`);
  }
  const body = z.looseObject({ access_token: z.string() }).safeParse(await res.json());
  if (!body.success) {
    console.error('playAccessToken: no access_token in response');
    throw new Error('Play token endpoint: malformed response');
  }
  return body.data.access_token;
}

// The slice of a SubscriptionPurchaseV2 we consume (permissive — Google adds
// fields freely).
const subscriptionV2Schema = z.looseObject({
  subscriptionState: z.string(),
  lineItems: z.array(
    z.looseObject({
      productId: z.string(),
      expiryTime: z.string().optional(), // RFC 3339
      autoRenewingPlan: z.looseObject({ autoRenewEnabled: z.boolean().optional() }).nullish(),
    }),
  ),
});

// Play's subscriptionState → our vocabulary. Explicit map like
// PADDLE_STATUS_MAP: an unknown/new state comes back null (→ log + drop).
//  - IN_GRACE_PERIOD is Google's still-entitled dunning window → past_due.
//  - ON_HOLD is dunning where Google says the entitlement is REVOKED, so it
//    must not ride the fold's past_due grace → paused (never entitled).
//  - CANCELED means auto-renew off, entitled until expiry — exactly our
//    canceled semantics; EXPIRED is the same row with the expiry in the past.
//  - PENDING purchases haven't been paid → null (drop until a real state).
const PLAY_STATE_MAP: Record<string, PurchaseStatus | null> = {
  SUBSCRIPTION_STATE_ACTIVE: 'active',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'past_due',
  SUBSCRIPTION_STATE_ON_HOLD: 'paused',
  SUBSCRIPTION_STATE_PAUSED: 'paused',
  SUBSCRIPTION_STATE_CANCELED: 'canceled',
  SUBSCRIPTION_STATE_EXPIRED: 'canceled',
  SUBSCRIPTION_STATE_PENDING: null,
};

// Fetch + normalize the subscription a purchase token identifies. Null when the
// token resolves to nothing or to a state/shape we don't consume — callers
// decide 422 (verify) vs log-and-ACK (notification).
export async function fetchPlaystoreSubscription(
  env: Bindings,
  purchaseToken: string,
): Promise<StoreSubscriptionSnapshot | null> {
  // The token is interpolated into the URL path; Play tokens are URL-safe
  // base64-ish, so anything outside that alphabet is garbage.
  if (!/^[A-Za-z0-9._-]+$/.test(purchaseToken)) return null;

  const accessToken = await playAccessToken(env);
  const res = await fetch(
    `${PLAY_API_BASE}/applications/${env.PLAY_PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${purchaseToken}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  // Garbage/forged tokens come back 400 ("Invalid Value") or 404 from Google.
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) {
    console.error(`fetchPlaystoreSubscription: Play Developer API ${res.status}`);
    throw new Error(`Play Developer API ${res.status}`);
  }

  const parsed = subscriptionV2Schema.safeParse(await res.json());
  if (!parsed.success) {
    console.error('fetchPlaystoreSubscription: unexpected response shape', parsed.error.message);
    return null;
  }

  const status = PLAY_STATE_MAP[parsed.data.subscriptionState] ?? null;
  if (status === null) {
    console.error(
      `fetchPlaystoreSubscription: unmapped state "${parsed.data.subscriptionState}"`,
    );
    return null;
  }

  const line = parsed.data.lineItems[0];
  if (!line) {
    console.error('fetchPlaystoreSubscription: no line items');
    return null;
  }

  const expiresAt = playTimeToMs(line.expiryTime);
  const willRenew =
    (status === 'active' || status === 'past_due') &&
    line.autoRenewingPlan?.autoRenewEnabled === true;

  return {
    // The purchase token is the stable identity of one subscription instance
    // (a resubscribe mints a new token → a new row; the old one expires) — the
    // Play analogue of Paddle's sub_… id.
    externalId: purchaseToken,
    productId: line.productId,
    status,
    expiresAt,
    canceledAt: willRenew ? null : expiresAt,
  };
}

// RFC 3339 → epoch ms, null for absent/unparseable (paddleTimeToMs's sibling).
export function playTimeToMs(rfc3339: string | null | undefined): number | null {
  if (!rfc3339) return null;
  const ms = Date.parse(rfc3339);
  return Number.isFinite(ms) ? ms : null;
}

// Decode a Real-time Developer Notification out of its Pub/Sub push envelope:
// the POST body carries `message.data` = base64(JSON DeveloperNotification).
// Only subscription notifications carry a purchaseToken to look up; test
// notifications and one-time-product events return null (→ log-and-ACK).
export function playNotificationPurchaseToken(pushBody: unknown): string | null {
  const envelope = z
    .looseObject({ message: z.looseObject({ data: z.string() }) })
    .safeParse(pushBody);
  if (!envelope.success) return null;

  let notification: unknown;
  try {
    notification = JSON.parse(atob(envelope.data.message.data));
  } catch {
    return null;
  }
  const parsed = z
    .looseObject({
      subscriptionNotification: z
        .looseObject({ purchaseToken: z.string() })
        .optional(),
    })
    .safeParse(notification);
  if (!parsed.success) return null;
  return parsed.data.subscriptionNotification?.purchaseToken ?? null;
}
