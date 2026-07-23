// The Subscription settings section — the store-IAP mirror of brace-web's
// `(app)/settings/[section]/_subscription/subscription-section.tsx` (the
// canonical doc). The moving parts, per docs/iap.md:
//  - plan/status come from useEntitlements (the `iap/status` query + the
//    device-local last-known copy);
//  - an upgrade is: fetch the store products (localized prices) → the store's
//    purchase sheet (lib/iap.ts) → POST /v1/iap/verify with the store's proof
//    of purchase — the server fetches authoritative state from the store's
//    API, records the purchase bound to this account, and returns the fresh
//    fold. No post-checkout polling (the web waits on a webhook; here the
//    verify RESPONSE is the flipped plan) — just a refetch to sync the cache;
//  - "Manage subscription" deep-links to the platform store's own manage
//    surface (payment method, cancel — never in the app); a Paddle (web)
//    purchase gets a note instead, the exact converse of the web's
//    store-purchase note;
//  - "Restore purchases" re-drives verify for purchases the store already
//    holds (App Review requires it; it's also reinstall/new-device recovery).

import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { ProductSubscription } from 'expo-iap';
import { Check, ExternalLink, RefreshCw } from 'lucide-react-native';

import { useEntitlements } from '@stxapps/expo-react';
import {
  AVAILABLE_PAID_PLANS,
  type AvailablePaidPlan,
  type PaidPlan,
  PLAN_LABELS,
  PLAN_USD_PER_YEAR,
} from '@stxapps/shared';

import { Button } from '../../components/ui/button';
import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';
import {
  fetchStorePlanProducts,
  openStoreCheckout,
  openStoreSubscriptionManagement,
  restoreStorePurchases,
  STORE_SOURCE,
} from '../../lib/iap';

// Upgrade-card copy — kept VERBATIM in step with the web section's
// PLAN_CARD_COPY (the customer-facing rendering of the entitlements table,
// iap/plans.ts); tune tiers in all three places together. Same two rules: only
// list what actually ships, and Pro's copy stays spec-in-waiting (only
// AVAILABLE_PAID_PLANS get a card).
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
    features: ['Everything in Plus', 'Full on-device AI — summaries & semantic search'],
  },
};

const PLAN_CARDS: { plan: AvailablePaidPlan; blurb: string; features: string[] }[] =
  AVAILABLE_PAID_PLANS.map((plan) => ({ plan, ...PLAN_CARD_COPY[plan] }));

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function SubscriptionSection() {
  const { subscription, isLoading, refetch } = useEntitlements();

  // One busy flag drives every control: 'checkout:<plan>' while the store
  // sheet/verify is in flight, 'restore' during restore, 'manage' while the
  // store's manage surface opens, 'refresh' for the status re-read.
  // Serializing them keeps double-taps and overlapping flows out (the web
  // section's exact pattern).
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The store's localized products for the upgrade cards (displayPrice is the
  // authoritative price — the store sheet's own number); null until loaded.
  const [products, setProducts] = useState<Partial<
    Record<AvailablePaidPlan, ProductSubscription>
  > | null>(null);
  // Store callbacks outlive a navigation away mid-purchase; never set state
  // after unmount.
  const unmounted = useRef(false);
  useEffect(() => {
    return () => {
      unmounted.current = true;
    };
  }, []);

  // Load the store catalog only when the upgrade cards will render (free plan)
  // — this is also what lazily opens the store connection (lib/iap.ts).
  const plan = subscription.plan;
  useEffect(() => {
    if (isLoading || plan !== 'free' || products !== null) return;
    let canceled = false;
    fetchStorePlanProducts()
      .then((byPlan) => {
        if (!canceled) setProducts(byPlan);
      })
      .catch(() => {
        // No store on this device/simulator (or the catalog is missing) — the
        // cards render with the planning price and a disabled button.
        if (!canceled) setProducts({});
      });
    return () => {
      canceled = true;
    };
  }, [isLoading, plan, products]);

  const startCheckout = async (cardPlan: AvailablePaidPlan) => {
    const product = products?.[cardPlan];
    if (!product) return;
    setError(null);
    setNotice(null);
    setBusy(`checkout:${cardPlan}`);
    try {
      await openStoreCheckout({
        plan: cardPlan,
        product,
        onCompleted: (status) => {
          if (unmounted.current) return;
          // The verify response already IS the new fold; refetch just syncs
          // the shared query cache + the device's last-known copy.
          void refetch().catch(() => undefined);
          setBusy(null);
          setNotice(`You're on ${PLAN_LABELS[status.plan]} now — thank you!`);
        },
        onFailed: (message) => {
          if (unmounted.current) return;
          setBusy(null);
          setError(message);
        },
        onClosed: () => {
          if (unmounted.current) return;
          setBusy((b) => (b === `checkout:${cardPlan}` ? null : b));
        },
      });
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const restore = async () => {
    setError(null);
    setNotice(null);
    setBusy('restore');
    try {
      const status = await restoreStorePurchases();
      if (unmounted.current) return;
      if (status && status.plan !== 'free') {
        void refetch().catch(() => undefined);
        setNotice(`Restored — you're on ${PLAN_LABELS[status.plan]}.`);
      } else {
        setNotice('No purchases to restore on this store account.');
      }
    } catch (e) {
      if (!unmounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!unmounted.current) setBusy(null);
    }
  };

  const openManage = async () => {
    if (subscription.plan === 'free') return;
    setError(null);
    setBusy('manage');
    try {
      await openStoreSubscriptionManagement(subscription.plan);
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
      <View className="px-6 py-8">
        <Text role="heading" className="text-xl font-semibold">
          Subscription
        </Text>
        <Text className="text-muted-foreground mt-2 text-sm">Loading your subscription…</Text>
      </View>
    );
  }

  const { status, source, expiresAt, willRenew } = subscription;
  // Upgrade cards only from FREE — a paid user buying again would double-
  // subscribe; a Plus→Pro switch is a store subscription UPDATE (its own flow,
  // not yet built). The server enforces the same guard by binding one store
  // subscription per account (and the web's checkout 409s).
  const upgradeCards = plan === 'free' ? PLAN_CARDS : [];

  return (
    <View className="px-6 py-8">
      <Text role="heading" className="text-xl font-semibold">
        Subscription
      </Text>
      <Text className="text-muted-foreground mt-1 mb-6 text-sm">
        Your plan applies to your whole account, on every device. Payments are handled by the{' '}
        {STORE_SOURCE === 'appstore' ? 'App Store' : 'Play Store'}; Brace never sees your card
        details.
      </Text>

      {/* Current plan */}
      <View className="border-border rounded-lg border p-4">
        <View className="flex-row items-start justify-between gap-4">
          <View className="min-w-0 flex-1 gap-0.5">
            <View className="flex-row items-baseline gap-2">
              <Text className="font-medium">{PLAN_LABELS[plan]}</Text>
              {plan !== 'free' && status === 'grace' && (
                <Text className="text-destructive text-sm">payment issue</Text>
              )}
            </View>
            <Text className="text-muted-foreground text-sm">
              {plan === 'free'
                ? 'Encrypted saving, sync, lists and tags — up to 200 links, without previews.'
                : expiresAt === null
                  ? 'Never expires.'
                  : willRenew
                    ? `Renews on ${formatDate(expiresAt)}.`
                    : `Ends on ${formatDate(expiresAt)} — it won't renew.`}
            </Text>
          </View>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onPress={() => void refreshStatus()}
          >
            <Icon as={RefreshCw} className="size-4" />
            <Text>Refresh</Text>
          </Button>
        </View>

        {status === 'grace' && (
          <View className="bg-destructive/10 mt-3 rounded-md px-3 py-2">
            <Text className="text-destructive text-sm">
              Your last payment didn&apos;t go through. Update your payment method to keep your plan
              — we&apos;ll retry for a while before it lapses.
            </Text>
          </View>
        )}

        {/* Manage: a subscription bought in THIS platform's store is managed in
            that store's own surface; a Paddle (web) purchase from the web app;
            the other platform's store purchase in that store. */}
        {plan !== 'free' && source === STORE_SOURCE && (
          <View className="mt-3 items-start">
            <Button variant="outline" disabled={busy !== null} onPress={() => void openManage()}>
              <Icon as={ExternalLink} className="size-4" />
              <Text>{busy === 'manage' ? 'Opening…' : 'Manage subscription'}</Text>
            </Button>
            <Text className="text-muted-foreground mt-2 text-xs">
              Payment method, cancellation, and renewals — in the{' '}
              {STORE_SOURCE === 'appstore' ? 'App Store' : 'Play Store'}&apos;s subscription
              settings.
            </Text>
          </View>
        )}
        {plan !== 'free' && source === 'paddle' && (
          <Text className="text-muted-foreground mt-3 text-sm">
            This subscription was purchased on the web — manage billing or cancel it in the web
            app&apos;s Subscription settings.
          </Text>
        )}
        {(source === 'appstore' || source === 'playstore') && source !== STORE_SOURCE && (
          <Text className="text-muted-foreground mt-3 text-sm">
            This subscription was purchased in the{' '}
            {source === 'appstore' ? 'App Store' : 'Play Store'} — manage or cancel it there.
          </Text>
        )}
      </View>

      {notice && (
        <View className="bg-muted/50 mt-4 rounded-md px-3 py-2">
          <Text className="text-muted-foreground text-sm">{notice}</Text>
        </View>
      )}
      {error && (
        <View className="bg-destructive/10 mt-4 rounded-md px-3 py-2">
          <Text className="text-destructive text-sm">{error}</Text>
        </View>
      )}

      {/* Upgrades */}
      {upgradeCards.length > 0 && (
        <View className="mt-6 gap-4">
          {upgradeCards.map(({ plan: cardPlan, blurb, features }) => {
            const product = products?.[cardPlan];
            return (
              <View key={cardPlan} className="border-border rounded-lg border p-4">
                <View className="flex-row items-baseline justify-between">
                  <Text className="font-medium">{PLAN_LABELS[cardPlan]}</Text>
                  <Text className="text-muted-foreground text-sm">
                    {/* The store's localized price once loaded; the USD
                        planning price as a placeholder meanwhile. */}
                    {product
                      ? `${product.displayPrice}/year`
                      : `$${PLAN_USD_PER_YEAR[cardPlan]}/year`}
                  </Text>
                </View>
                <Text className="text-muted-foreground mt-1 text-sm">{blurb}</Text>
                <View className="mt-3 gap-1.5">
                  {features.map((feature) => (
                    <View key={feature} className="flex-row items-start gap-2">
                      <Icon as={Check} className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                      <Text className="flex-1 text-sm">{feature}</Text>
                    </View>
                  ))}
                </View>
                <Button
                  className="mt-4"
                  disabled={busy !== null || !product}
                  onPress={() => void startCheckout(cardPlan)}
                >
                  <Text>
                    {busy === `checkout:${cardPlan}`
                      ? 'Finishing your upgrade…'
                      : `Upgrade to ${PLAN_LABELS[cardPlan]}`}
                  </Text>
                </Button>
              </View>
            );
          })}
        </View>
      )}

      {plan === 'free' && (
        <View className="mt-4 items-start">
          <Button variant="ghost" size="sm" disabled={busy !== null} onPress={() => void restore()}>
            <Text>{busy === 'restore' ? 'Restoring…' : 'Restore purchases'}</Text>
          </Button>
        </View>
      )}
    </View>
  );
}
