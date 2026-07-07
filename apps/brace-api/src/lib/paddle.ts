import { z } from 'zod';

import type { PurchaseStatus } from '../db/repositories/purchases';

// Paddle Billing webhook plumbing: signature verification and the typed slice of
// a subscription event the service consumes. This is the PROVIDER-VOCAB edge —
// everything Paddle-shaped is parsed/normalized here so services/iap.ts and the
// purchases repo only ever see our normalized statuses and epoch-ms times.
//
// NOTE this is Paddle BILLING (the current platform: `Paddle-Signature` HMAC
// header, `sub_…`/`ctm_…`/`pri_…` ids, subscription.* events) — NOT Paddle
// Classic (p_signature RSA verification, vendor/product ids), which the old
// stxapps iap-server used and which is closed to new accounts.

// How stale a webhook's `ts=` may be before we reject it (replay bound; Paddle's
// docs suggest rejecting anything older than ~5 seconds but allow for retries —
// we take 5 minutes, matching the auth-proof TIMESTAMP_WINDOW_MS posture).
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

// Verify a `Paddle-Signature: ts=<unix-seconds>;h1=<hex>` header: the signed
// payload is `${ts}:${rawBody}` (the EXACT raw body bytes — never a re-serialized
// parse), MACed with the per-notification-destination webhook secret. `h1` may
// appear more than once during secret rotation; any match passes.
export async function verifyPaddleSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!header) return false;

  let ts: string | null = null;
  const h1s: string[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'h1') h1s.push(value);
  }
  if (!ts || h1s.length === 0) return false;

  const tsMs = Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > SIGNATURE_MAX_AGE_MS) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}:${rawBody}`)),
  );
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');

  return h1s.some((h1) => timingSafeEqualHex(h1, expected));
}

// Constant-time string compare (both sides are lowercase hex of fixed HMAC
// length; a length mismatch short-circuits, which leaks only the length — public
// anyway for SHA-256).
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The slice of a Paddle event we consume, permissively typed (`looseObject`
// everywhere — Paddle adds fields freely and unknown ones must pass through;
// a shape we can't parse is logged and ACKed, never 500ed, or Paddle retries a
// permanently-unparseable event forever).
export const paddleEventSchema = z.looseObject({
  event_id: z.string(),
  event_type: z.string(),
  occurred_at: z.string(), // ISO 8601
  data: z.looseObject({
    id: z.string(), // sub_… for subscription.* events
    status: z.string(),
    customer_id: z.string().nullish(),
    // Set by OUR checkout (customData: { userId }) and persisted onto the
    // subscription by Paddle, so every later event carries it back.
    custom_data: z.looseObject({ userId: z.string().optional() }).nullish(),
    items: z
      .array(z.looseObject({ price: z.looseObject({ id: z.string() }).nullish() }))
      .optional(),
    current_billing_period: z.looseObject({ ends_at: z.string() }).nullish(),
    canceled_at: z.string().nullish(),
    // A pending change scheduled for period end — action 'cancel' means the user
    // canceled but stays entitled until effective_at (willRenew=false); the field
    // going back to null means they resumed.
    scheduled_change: z
      .looseObject({ action: z.string(), effective_at: z.string().nullish() })
      .nullish(),
  }),
});
export type PaddleEvent = z.infer<typeof paddleEventSchema>;

// Paddle Billing subscription statuses happen to be exactly our normalized
// vocabulary (PURCHASE_STATUSES). Mapped explicitly anyway so a value Paddle
// adds later comes back null (→ log + ignore) instead of flowing into the fold.
const PADDLE_STATUS_MAP: Record<string, PurchaseStatus> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'canceled',
};

export function normalizePaddleStatus(status: string): PurchaseStatus | null {
  return PADDLE_STATUS_MAP[status] ?? null;
}

// ISO 8601 → epoch ms, null for absent/unparseable (never NaN into the db).
export function paddleTimeToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
