// The Subscription settings section — the STATUS half of brace-web's
// `(app)/settings/[section]/_subscription/subscription-section.tsx` (the
// canonical doc: plan/status come from useEntitlements — the `iap/status`
// query + the device-local last-known copy; payment truth reaches brace-api
// via webhook, never through a client). Deliberately status-only on this
// platform: Paddle's overlay checkout is web-only, store IAP isn't built yet
// (docs/iap.md), and Apple's rules constrain linking out to external payment —
// so there are no upgrade cards or portal button here, just the current plan,
// a Refresh, the grace warning, and where-to-manage notes. The checkout/portal
// flows arrive with store IAP.

import { useState } from 'react';
import { View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';

import { useEntitlements } from '@stxapps/expo-react';
import { PLAN_LABELS } from '@stxapps/shared';

import { Button } from '../../components/ui/button';
import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function SubscriptionSection() {
  const { subscription, isLoading, refetch } = useEntitlements();
  const [refreshing, setRefreshing] = useState(false);

  const refreshStatus = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await refetch().catch(() => undefined);
    setRefreshing(false);
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

  const { plan, status, source, expiresAt, willRenew } = subscription;

  return (
    <View className="px-6 py-8">
      <Text role="heading" className="text-xl font-semibold">
        Subscription
      </Text>
      <Text className="text-muted-foreground mt-1 mb-6 text-sm">
        Your plan applies to your whole account, on every device.
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
            disabled={refreshing}
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

        {/* Where to manage: a Paddle (web) purchase is managed from the web
            app's Subscription settings; a store purchase in its store. */}
        {plan !== 'free' && source === 'paddle' && (
          <Text className="text-muted-foreground mt-3 text-sm">
            This subscription was purchased on the web — manage billing or cancel it in the web
            app&apos;s Subscription settings.
          </Text>
        )}
        {(source === 'appstore' || source === 'playstore') && (
          <Text className="text-muted-foreground mt-3 text-sm">
            This subscription was purchased in the{' '}
            {source === 'appstore' ? 'App Store' : 'Play Store'} — manage or cancel it there.
          </Text>
        )}
      </View>

      {plan === 'free' && (
        <Text className="text-muted-foreground mt-6 text-sm">
          Paid plans — unlimited links, preview images, locks, and advanced search — can be
          purchased from the web app for now.
        </Text>
      )}
    </View>
  );
}
