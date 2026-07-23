import { z } from 'zod';

import type { PurchaseStatus } from '../db/repositories/purchases';
import type { Bindings } from './env';

// App Store provider-vocab edge — the `lib/paddle.ts` sibling for Apple.
// Everything App-Store-shaped (the Server API JWT, the subscription-status
// fetch, JWS payload decoding, status normalization) lives here so
// services/iap.ts only ever sees normalized statuses and epoch-ms times.
//
// TRUST MODEL — the call-back pattern. Nothing a client or a notification
// carries is ever applied directly: the token is only a LOOKUP KEY, and the
// facts (productId, status, expiry) come from a fresh server-to-server fetch of
// `GET /inApps/v1/subscriptions/{transactionId}` on Apple's App Store Server
// API over TLS. That is why the JWS blobs in the response are decoded WITHOUT
// x5c chain verification — we just fetched them from Apple directly, so TLS to
// the pinned hostname is the authentication (chain verification exists for
// payloads that arrive via an untrusted hop, and our notification route
// deliberately re-fetches instead of trusting its payload — see
// applyAppstoreNotification in services/iap.ts). A forged token can only make
// us fetch a subscription that doesn't exist (404 → invalid_receipt) or one
// bound to another account (the repo's first-write-wins binding holds).

// The Server API hosts. Which one an env uses is config (APPSTORE_API_BASE:
// sandbox for development/staging, production for production) — but production
// ALSO falls back to sandbox on a not-found: App Review purchases with sandbox
// accounts against the production build, and Apple's guidance is exactly this
// production-first-then-sandbox retry.
export const APPSTORE_PRODUCTION_API_BASE = 'https://api.storekit.itunes.apple.com';
export const APPSTORE_SANDBOX_API_BASE = 'https://api.storekit-sandbox.itunes.apple.com';

// --- base64url + PEM helpers (Workers-runtime, no Node Buffer) --------------

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncodeJson(value: unknown): string {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function b64urlDecodeToString(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// PEM (PKCS#8) → raw DER bytes for crypto.subtle.importKey. Tolerates the
// header/footer and line breaks `wrangler secret put` preserves. (Built over a
// plain ArrayBuffer explicitly — importKey's BufferSource rejects the
// ArrayBufferLike-typed view Uint8Array.from would produce.)
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END)[A-Z ]*KEY-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Decode a JWS compact serialization's PAYLOAD without verifying its signature.
// Safe ONLY for payloads we fetched from Apple over TLS ourselves (see the
// trust-model note above) — never for anything that arrived from outside.
// Returns null instead of throwing on a malformed blob (log-and-drop callers).
export function decodeJwsPayload(jws: string): unknown | null {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(b64urlDecodeToString(parts[1]));
  } catch {
    return null;
  }
}

// --- the Server API JWT (ES256) ---------------------------------------------

// Mint the short-lived App Store Server API token: an ES256 JWT signed with the
// In-App Purchase key (App Store Connect → Users and Access → Integrations),
// whose PKCS#8 PEM is the APPSTORE_PRIVATE_KEY secret. Minted per call — the
// Workers isolate is ephemeral and signing is sub-millisecond, so caching would
// only add a staleness bug surface.
export async function appstoreApiJwt(env: Bindings, now: number = Date.now()): Promise<string> {
  const header = { alg: 'ES256', kid: env.APPSTORE_KEY_ID, typ: 'JWT' };
  const iat = Math.floor(now / 1000);
  const payload = {
    iss: env.APPSTORE_ISSUER_ID,
    iat,
    exp: iat + 5 * 60, // Apple allows up to 60 min; 5 keeps the blast radius small
    aud: 'appstoreconnect-v1',
    bid: env.APPSTORE_BUNDLE_ID,
  };

  const signingInput = `${b64urlEncodeJson(header)}.${b64urlEncodeJson(payload)}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(env.APPSTORE_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto ECDSA emits the raw r||s form JWS wants (no DER re-packing needed).
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${b64urlEncode(sig)}`;
}

// --- the subscription-status fetch + normalization --------------------------

// The slices of the two JWS payloads we consume (permissive like
// paddleEventSchema — Apple adds fields freely).
const transactionInfoSchema = z.looseObject({
  productId: z.string(),
  originalTransactionId: z.string(),
  expiresDate: z.number().optional(), // epoch ms
  offerDiscountType: z.string().nullish(), // 'FREE_TRIAL' | 'PAY_AS_YOU_GO' | …
});

const renewalInfoSchema = z.looseObject({
  autoRenewStatus: z.number().optional(), // 1 = will renew, 0 = user turned it off
});

const statusResponseSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      lastTransactions: z.array(
        z.looseObject({
          originalTransactionId: z.string(),
          status: z.number(),
          signedTransactionInfo: z.string(),
          signedRenewalInfo: z.string().optional(),
        }),
      ),
    }),
  ),
});

// What the service consumes: one normalized snapshot of the subscription the
// looked-up transaction belongs to. `plan` mapping stays in the service (the
// shared planOfStoreProduct table).
export type StoreSubscriptionSnapshot = {
  externalId: string; // the provider's stable subscription identity
  productId: string;
  status: PurchaseStatus;
  expiresAt: number | null;
  canceledAt: number | null;
};

// Apple's subscription status codes → our vocabulary. Explicit map like
// PADDLE_STATUS_MAP: an unknown code comes back null (→ log + drop), never
// flows into the fold.
//  1 active, 2 expired, 3 expired-in-billing-retry, 4 billing grace period,
//  5 revoked (family-sharing revocation / refund).
// 3 maps to past_due: the fold's PAST_DUE_GRACE_MS (16 days past expiry) is the
// product decision on how long dunning stays entitled — tighter than Apple's
// 60-day retry window, same posture as Paddle dunning. 2 and 5 map to canceled:
// the fold entitles canceled only until expires_at, which for both is in the
// past — the row records WHY it ended, the fold decides entitlement from time.
const APPSTORE_STATUS_MAP: Record<number, PurchaseStatus> = {
  1: 'active',
  2: 'canceled',
  3: 'past_due',
  4: 'past_due',
  5: 'canceled',
};

// Fetch + normalize the subscription a transaction id belongs to. Null when the
// id resolves to nothing (a forged/garbage token) or the response carries no
// transaction for a product we recognize the shape of — callers decide whether
// that's a 422 (verify) or a log-and-drop (notification).
export async function fetchAppstoreSubscription(
  env: Bindings,
  transactionId: string,
): Promise<StoreSubscriptionSnapshot | null> {
  // The id is interpolated into the URL path — reject anything that could
  // change the path shape before it reaches fetch (ids are digits, but Apple
  // only promises a string; being strict here costs nothing).
  if (!/^[A-Za-z0-9._-]+$/.test(transactionId)) return null;

  const jwt = await appstoreApiJwt(env);
  const lookup = (base: string) =>
    fetch(`${base}/inApps/v1/subscriptions/${transactionId}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });

  let res = await lookup(env.APPSTORE_API_BASE);
  // Production-first-then-sandbox: App Review runs sandbox purchases against
  // the production build, whose config points at the production host.
  if (res.status === 404 && env.APPSTORE_API_BASE === APPSTORE_PRODUCTION_API_BASE) {
    res = await lookup(APPSTORE_SANDBOX_API_BASE);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`fetchAppstoreSubscription: App Store Server API ${res.status}`);
    throw new Error(`App Store Server API ${res.status}`);
  }

  const parsed = statusResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    console.error('fetchAppstoreSubscription: unexpected response shape', parsed.error.message);
    return null;
  }

  // One subscription group in practice (all our plans share one group so
  // upgrades are proper StoreKit crossgrades); take the transaction that
  // matches the looked-up subscription, else the first.
  for (const group of parsed.data.data) {
    for (const last of group.lastTransactions) {
      const status = APPSTORE_STATUS_MAP[last.status] ?? null;
      if (status === null) {
        console.error(`fetchAppstoreSubscription: unknown status code ${last.status}`);
        continue;
      }

      const info = transactionInfoSchema.safeParse(decodeJwsPayload(last.signedTransactionInfo));
      if (!info.success) {
        console.error('fetchAppstoreSubscription: bad signedTransactionInfo payload');
        continue;
      }
      const renewal = last.signedRenewalInfo
        ? renewalInfoSchema.safeParse(decodeJwsPayload(last.signedRenewalInfo))
        : null;

      const expiresAt = info.data.expiresDate ?? null;
      // Auto-renew off while still entitled is Apple's "scheduled cancel" —
      // record it like Paddle's scheduled_change (canceledAt = period end) so
      // willRenew folds false; null CLEARS it when the user resumes.
      const willRenew =
        status === 'active' || status === 'past_due'
          ? (renewal?.success ? renewal.data.autoRenewStatus : undefined) === 1
          : false;
      // 'trialing' is a display distinction only (the fold treats it as
      // active); Apple flags it on the transaction's offer type.
      const effectiveStatus: PurchaseStatus =
        status === 'active' && info.data.offerDiscountType === 'FREE_TRIAL'
          ? 'trialing'
          : status;

      return {
        externalId: info.data.originalTransactionId,
        productId: info.data.productId,
        status: effectiveStatus,
        expiresAt,
        canceledAt: willRenew ? null : expiresAt,
      };
    }
  }
  return null;
}

// The slice of an App Store Server Notification V2 we consume: just enough to
// find WHICH subscription changed. The payload is deliberately NOT trusted for
// facts — the service re-fetches authoritative state from Apple (call-back
// pattern), so this needs no x5c chain verification. Returns the transaction id
// to look up, or null (→ log-and-ACK).
export function appstoreNotificationTransactionId(signedPayload: string): string | null {
  const payload = z
    .looseObject({
      data: z
        .looseObject({
          signedTransactionInfo: z.string().optional(),
        })
        .optional(),
    })
    .safeParse(decodeJwsPayload(signedPayload));
  if (!payload.success || !payload.data.data?.signedTransactionInfo) return null;

  const info = transactionInfoSchema
    .pick({ originalTransactionId: true })
    .safeParse(decodeJwsPayload(payload.data.data.signedTransactionInfo));
  return info.success ? info.data.originalTransactionId : null;
}
