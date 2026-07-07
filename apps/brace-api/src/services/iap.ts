import {
  type Entitlements,
  entitlementsOf,
  type PaidPlan,
  type Plan,
  type SubscriptionStatus,
} from '@stxapps/shared';

import { type PurchaseEntity, purchasesRepo } from '../db/repositories/purchases';
import type { Bindings } from '../lib/env';
import { HttpError } from '../lib/errors';
import { newId } from '../lib/ids';
import { normalizePaddleStatus, type PaddleEvent, paddleTimeToMs } from '../lib/paddle';

// Subscription/entitlement service. Purchases land in DIRECTORY_DB (written by
// the provider webhooks / future store verifiers); this service owns the FOLD
// from those rows to the account's single SubscriptionStatus — what `iap/status`
// returns, and what the `files/sign` quota gate derives its limits from
// (lib/quota.ts). Clients never see purchase rows, only the fold.

// How long a `past_due` subscription stays entitled past its period end while
// the provider retries payment (Paddle dunning runs up to ~2 weeks). Yanking
// features mid-dunning punishes an expired card harder than a deliberate cancel.
const PAST_DUE_GRACE_MS = 16 * 24 * 60 * 60 * 1000;

// Slack past `expires_at` for a subscription in good standing: the renewal
// webhook lags the period boundary (retries, clock skew), and the row's
// `expires_at` only advances when it lands. Without slack every subscriber
// would flicker to free for the lag window at each renewal.
const EXPIRY_SLACK_MS = 24 * 60 * 60 * 1000;

const PLAN_RANK: Record<Plan, number> = { free: 0, plus: 1, pro: 2 };

// Whether a purchase row still entitles its plan at `now`.
function isEntitled(p: PurchaseEntity, now: number): boolean {
  // A null expiry means "never expires" ONLY for a manual/lifetime grant (comps,
  // lifetime deals — no provider billing period to end). For a PROVIDER row
  // (paddle/appstore/playstore) a null expiry is a MISSING period, not a lifetime
  // grant, so it must not entitle — otherwise a trialing/active event that arrived
  // without a current_billing_period would read as entitled forever.
  const lifetime = p.source === 'manual' && p.expiresAt === null;
  switch (p.status) {
    case 'active':
    case 'trialing':
      return lifetime || (p.expiresAt !== null && now < p.expiresAt + EXPIRY_SLACK_MS);
    case 'past_due':
      return lifetime || (p.expiresAt !== null && now < p.expiresAt + PAST_DUE_GRACE_MS);
    case 'canceled':
      // Entitled through the already-paid period; no slack — the provider
      // stamped the definitive end.
      return p.expiresAt !== null && now < p.expiresAt;
    case 'paused':
      return false;
  }
}

// Fold every purchase row to the account's one SubscriptionStatus. Pure — the
// unit-testable core. Best entitled row wins: highest plan, then latest expiry
// (null = never expires = latest).
export function foldSubscriptionStatus(
  purchases: PurchaseEntity[],
  now: number = Date.now(),
): SubscriptionStatus {
  let best: PurchaseEntity | null = null;
  for (const p of purchases) {
    if (!isEntitled(p, now)) continue;
    if (
      best === null ||
      PLAN_RANK[p.plan] > PLAN_RANK[best.plan] ||
      (PLAN_RANK[p.plan] === PLAN_RANK[best.plan] &&
        (p.expiresAt ?? Infinity) > (best.expiresAt ?? Infinity))
    ) {
      best = p;
    }
  }

  if (!best) {
    return { plan: 'free', status: 'none', source: null, expiresAt: null, willRenew: false };
  }
  return {
    plan: best.plan,
    status: best.status === 'past_due' ? 'grace' : 'active',
    source: best.source,
    expiresAt: best.expiresAt,
    // Renews only in good standing, not canceled (scheduled or effective), and
    // with something to renew (a non-expiring grant doesn't).
    willRenew:
      (best.status === 'active' || best.status === 'trialing') &&
      best.canceledAt === null &&
      best.expiresAt !== null,
  };
}

// The authenticated `iap/status` read: one indexed D1 query + the pure fold.
export async function getSubscriptionStatus(
  env: Bindings,
  userId: string,
): Promise<SubscriptionStatus> {
  const purchases = await purchasesRepo(env.DIRECTORY_DB).listByUserId(userId);
  return foldSubscriptionStatus(purchases);
}

// What the quota gate reads on the `files/sign` put path (services/sync.ts):
// plan → limits via the shared entitlementsOf, so the server enforces exactly
// the numbers the client paywall displays.
export async function getEntitlements(env: Bindings, userId: string): Promise<Entitlements> {
  return entitlementsOf((await getSubscriptionStatus(env, userId)).plan);
}

// Apply one verified Paddle subscription.* event (signature already checked in
// the route). Anything that can't be applied — unknown status, unrecognized
// price, no account to bind to — is LOGGED AND DROPPED, never thrown: the
// route must 200 regardless, or Paddle redelivers a permanently-unappliable
// event forever. Idempotency and out-of-order safety live in the repo upsert.
export async function applyPaddleEvent(env: Bindings, event: PaddleEvent): Promise<void> {
  if (!event.event_type.startsWith('subscription.')) return; // only ever subscribed to these

  const { data } = event;

  const status = normalizePaddleStatus(data.status);
  if (!status) {
    console.error(`applyPaddleEvent: unknown status "${data.status}" (${event.event_id})`);
    return;
  }

  // Plan from the subscription's price id — the AUTHORITATIVE mapping (never
  // custom_data, which any client could set). Configured per env since sandbox
  // and live Paddle mint different pri_… ids.
  const priceIds = (data.items ?? []).map((i) => i.price?.id).filter((id) => id != null);
  const plan = priceIds.includes(env.PADDLE_PRICE_ID_PRO)
    ? 'pro'
    : priceIds.includes(env.PADDLE_PRICE_ID_PLUS)
      ? 'plus'
      : null;
  if (!plan) {
    console.error(`applyPaddleEvent: no known price in [${priceIds}] (${event.event_id})`);
    return;
  }

  // Bind the subscription to an account: the STORED binding wins (first sight is
  // for life — see the repo's upsert note); a first-seen subscription binds to
  // the userId our checkout stamped into custom_data.
  const repo = purchasesRepo(env.DIRECTORY_DB);
  const existing = await repo.findBySourceExternalId('paddle', data.id);
  const userId = existing?.userId ?? data.custom_data?.userId;
  if (!userId) {
    console.error(`applyPaddleEvent: no userId for subscription ${data.id} (${event.event_id})`);
    return;
  }

  const occurredAt = paddleTimeToMs(event.occurred_at);
  if (occurredAt === null) {
    console.error(`applyPaddleEvent: bad occurred_at "${event.occurred_at}" (${event.event_id})`);
    return;
  }

  await repo.upsertFromProvider({
    id: newId(),
    userId,
    source: 'paddle',
    externalId: data.id,
    plan,
    status,
    providerCustomerId: data.customer_id ?? null,
    expiresAt: paddleTimeToMs(data.current_billing_period?.ends_at),
    // Cancellation is either effective (canceled_at) or scheduled for period end
    // (scheduled_change.action === 'cancel'); computed to null when neither, and
    // the upsert OVERWRITES with null so a resumed subscription clears it.
    canceledAt:
      paddleTimeToMs(data.canceled_at) ??
      (data.scheduled_change?.action === 'cancel'
        ? paddleTimeToMs(data.scheduled_change.effective_at)
        : null),
    eventOccurredAt: occurredAt,
  });
}

// Create a Paddle transaction for the authed user to open in the overlay
// checkout. Server-created so the webhook's account binding
// (`custom_data.userId`) is stamped from the SESSION — the client never knows
// its own userId (it's server-minted) — and so the purchased price is the
// server's configured pri_… id, never a client-supplied one.
export async function createPaddleTransaction(
  env: Bindings,
  userId: string,
  plan: PaidPlan,
): Promise<string> {
  // Guard the double-subscription hole: a second checkout from an already-
  // entitled account would mint a SECOND live Paddle subscription (double
  // billing) — a plan change is a subscription UPDATE (proration), a separate
  // flow. Best-effort (two concurrent checkouts can still race past it), but it
  // closes the ordinary path; the UI hides upgrade cards on paid plans too.
  const current = await getSubscriptionStatus(env, userId);
  if (current.plan !== 'free') {
    throw new HttpError(409, 'already_subscribed', 'This account already has a subscription');
  }

  const priceId = plan === 'pro' ? env.PADDLE_PRICE_ID_PRO : env.PADDLE_PRICE_ID_PLUS;

  const res = await fetch(`${env.PADDLE_API_BASE}/transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PADDLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      custom_data: { userId },
    }),
  });
  if (!res.ok) {
    console.error(`createPaddleTransaction: Paddle API ${res.status}`);
    throw new HttpError(502, 'paddle_unavailable', 'Could not reach Paddle, please retry');
  }

  const body = (await res.json()) as { data?: { id?: string } };
  if (!body.data?.id) {
    console.error('createPaddleTransaction: no transaction id in Paddle response');
    throw new HttpError(502, 'paddle_unavailable', 'Could not reach Paddle, please retry');
  }
  return body.data.id;
}

// Mint a Paddle customer-portal session (payment method, invoices, cancel) for
// the authed user's Paddle subscription. Server-side because it needs the
// secret API key + the stored ctm_… id; the client just opens the URL.
export async function createPaddlePortalSession(env: Bindings, userId: string): Promise<string> {
  const purchases = await purchasesRepo(env.DIRECTORY_DB).listByUserId(userId);
  const paddle = purchases.find((p) => p.source === 'paddle' && p.providerCustomerId !== null);
  if (!paddle) {
    throw new HttpError(404, 'no_paddle_subscription', 'No Paddle subscription on this account');
  }

  const res = await fetch(`${env.PADDLE_API_BASE}/customer-portal-sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PADDLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ customer_id: paddle.providerCustomerId }),
  });
  if (!res.ok) {
    console.error(`createPaddlePortalSession: Paddle API ${res.status}`);
    throw new HttpError(502, 'paddle_unavailable', 'Could not reach Paddle, please retry');
  }

  const body = (await res.json()) as { data?: { urls?: { general?: { overview?: string } } } };
  const url = body.data?.urls?.general?.overview;
  if (!url) {
    console.error('createPaddlePortalSession: no overview url in Paddle response');
    throw new HttpError(502, 'paddle_unavailable', 'Could not reach Paddle, please retry');
  }
  return url;
}
