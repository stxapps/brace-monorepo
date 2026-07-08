'use client';

// The Subscription settings section: current plan + upgrade cards + billing
// management. The moving parts, per docs/business-model.md and the IAP design:
//  - plan/status come from useEntitlements (the `iap/status` query + the
//    device-local last-known copy);
//  - an upgrade is: POST /v1/iap/checkout (server creates the Paddle
//    transaction, stamping the account binding) → overlay checkout
//    (lib/paddle.ts) → on completion, POLL `iap/status` until the webhook lands
//    and the plan flips (payment truth reaches brace-api via webhook, never
//    through this client);
//  - "Manage billing" opens a server-minted Paddle customer-portal session
//    (payment method, invoices, cancel);
//  - store-bought subscriptions (future brace-expo) are managed in the store,
//    so they get a note instead of the portal button.

import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, RefreshCw } from 'lucide-react';

import { useApiClient } from '@stxapps/react';
import {
  AVAILABLE_PAID_PLANS,
  type AvailablePaidPlan,
  iapCheckoutEndpoint,
  iapPortalEndpoint,
  type PaidPlan,
  type Plan,
  PLAN_LABELS,
  PLAN_USD_PER_YEAR,
} from '@stxapps/shared';
import { useEntitlements } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';

import { openPaddleCheckout } from '@/lib/paddle';

// Upgrade-card copy — the customer-facing rendering of the entitlements table
// (iap/plans.ts); keep the two in step when tuning tiers. Two rules:
//   - Only list what actually SHIPS. Reader view, screenshots, archive, and AI
//     are gated in plans.ts but not yet built, so they are NOT promised here —
//     re-add each line as it lands. At launch Plus is unlimited links + preview
//     images + app lock/hidden lists + the storage bump.
//   - Pro's copy is kept as spec-in-waiting even though Pro isn't sold: only
//     AVAILABLE_PAID_PLANS get a card (see below), so putting Pro on sale stays a
//     one-line change in iap/plans.ts.
const PLAN_CARD_COPY: Record<PaidPlan, { blurb: string; features: string[] }> = {
  plus: {
    blurb: 'The full visual library',
    features: [
      'Unlimited saved links',
      'Preview images',
      'App lock & hidden lists',
      'Advanced search',
    ],
  },
  pro: {
    blurb: 'The permanent offline library',
    features: [
      'Everything in Plus',
      'Full on-device AI — summaries & semantic search',
    ],
  },
};

// Only the plans currently on sale get a card — Pro's copy above stays dormant
// until it joins AVAILABLE_PAID_PLANS.
const PLAN_CARDS: { plan: AvailablePaidPlan; blurb: string; features: string[] }[] =
  AVAILABLE_PAID_PLANS.map((plan) => ({ plan, ...PLAN_CARD_COPY[plan] }));

// How long to poll `iap/status` after a completed checkout before telling the
// user it's still processing (the webhook usually lands within seconds).
const ACTIVATION_TRIES = 15;
const ACTIVATION_INTERVAL_MS = 2000;

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function SubscriptionSection() {
  const api = useApiClient();
  const { subscription, isLoading, refetch } = useEntitlements();

  // One busy flag drives every control: 'checkout:<plan>' while a checkout is
  // being created/open, 'activating' while polling for the webhook, 'portal'
  // while minting a portal session. Serializing them keeps double-clicks and
  // overlapping flows out.
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The poll survives the overlay's own lifecycle, but must stop if the section
  // unmounts mid-loop.
  const unmounted = useRef(false);
  useEffect(() => {
    return () => {
      unmounted.current = true;
    };
  }, []);

  // After a completed payment, poll until the webhook flips the plan. The plan
  // upgrade case (plus → pro) polls for any CHANGE from the starting plan.
  const pollActivation = async (fromPlan: Plan) => {
    setBusy('activating');
    setNotice(null);
    for (let i = 0; i < ACTIVATION_TRIES; i++) {
      const { data } = await refetch().catch(() => ({ data: undefined }));
      if (unmounted.current) return;
      if (data && data.plan !== fromPlan) {
        setBusy(null);
        setNotice(`You're on ${PLAN_LABELS[data.plan]} now — thank you!`);
        return;
      }
      await new Promise((r) => setTimeout(r, ACTIVATION_INTERVAL_MS));
      if (unmounted.current) return;
    }
    setBusy(null);
    setNotice(
      'Payment received — your upgrade is still processing. It activates automatically; check back in a minute.',
    );
  };

  const startCheckout = async (plan: AvailablePaidPlan) => {
    setError(null);
    setNotice(null);
    setBusy(`checkout:${plan}`);
    const fromPlan = subscription.plan;
    try {
      const { transactionId } = await api.call(iapCheckoutEndpoint, { plan });
      await openPaddleCheckout({
        transactionId,
        onCompleted: () => void pollActivation(fromPlan),
        // Fires after completion too — only clear the checkout busy state, never
        // an in-flight activation poll.
        onClosed: () => setBusy((b) => (b === `checkout:${plan}` ? null : b)),
      });
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openPortal = async () => {
    setError(null);
    setBusy('portal');
    try {
      const { url } = await api.call(iapPortalEndpoint, {});
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const refreshStatus = async () => {
    setError(null);
    setBusy('refresh');
    await refetch().catch(() => undefined);
    setBusy(null);
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h2 className="text-xl font-semibold">Subscription</h2>
        <p className="mt-2 text-sm text-muted-foreground">Loading your subscription…</p>
      </div>
    );
  }

  const { plan, status, source, expiresAt, willRenew } = subscription;
  // Upgrade cards only from FREE: a paid user opening a second checkout would
  // create a second live Paddle subscription (double-billing) — a Plus→Pro
  // switch is a subscription UPDATE (proration) and ships as its own flow. The
  // server enforces the same guard at /v1/iap/checkout.
  const upgradeCards = plan === 'free' ? PLAN_CARDS : [];

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h2 className="text-xl font-semibold">Subscription</h2>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Your plan applies to your whole account, on every device. Payments are handled by Paddle;
        Brace never sees your card details.
      </p>

      {/* Current plan */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">
              {PLAN_LABELS[plan]}
              {plan !== 'free' && status === 'grace' && (
                <span className="ml-2 text-sm font-normal text-destructive">payment issue</span>
              )}
            </span>
            <span className="text-sm text-muted-foreground">
              {plan === 'free'
                ? 'Encrypted saving, sync, lists and tags — up to 200 links, without previews.'
                : expiresAt === null
                  ? 'Never expires.'
                  : willRenew
                    ? `Renews on ${formatDate(expiresAt)}.`
                    : `Ends on ${formatDate(expiresAt)} — it won't renew.`}
            </span>
          </div>
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={refreshStatus}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>

        {status === 'grace' && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Your last payment didn't go through. Update your payment method to keep your plan —
            we'll retry for a while before it lapses.
          </p>
        )}

        {plan !== 'free' && source === 'paddle' && (
          <div className="mt-3">
            <Button variant="outline" disabled={busy !== null} onClick={openPortal}>
              <ExternalLink className="size-4" />
              {busy === 'portal' ? 'Opening…' : 'Manage billing'}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Payment method, invoices, and cancellation — in Paddle's secure portal.
            </p>
          </div>
        )}
        {(source === 'appstore' || source === 'playstore') && (
          <p className="mt-3 text-sm text-muted-foreground">
            This subscription was purchased in the{' '}
            {source === 'appstore' ? 'App Store' : 'Play Store'} — manage or cancel it there.
          </p>
        )}
      </div>

      {busy === 'activating' && (
        <p className="mt-4 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Finishing your upgrade…
        </p>
      )}
      {notice && (
        <p className="mt-4 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Upgrades */}
      {upgradeCards.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {upgradeCards.map(({ plan: cardPlan, blurb, features }) => (
            <div key={cardPlan} className="flex flex-col rounded-lg border border-border p-4">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{PLAN_LABELS[cardPlan]}</span>
                <span className="text-sm text-muted-foreground">
                  ${PLAN_USD_PER_YEAR[cardPlan]}/year
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
              <ul className="mt-3 flex flex-1 flex-col gap-1.5">
                {features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-4"
                disabled={busy !== null}
                onClick={() => void startCheckout(cardPlan)}
              >
                {busy === `checkout:${cardPlan}`
                  ? 'Opening checkout…'
                  : `Upgrade to ${PLAN_LABELS[cardPlan]}`}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
