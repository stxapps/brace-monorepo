'use client';

import { useEffect, useState } from 'react';

import { FREE_SUBSCRIPTION_STATUS, useSubscriptionStatus } from '@stxapps/react';
import {
  type Entitlements,
  entitlementsOf,
  type SubscriptionStatus,
  subscriptionStatusSchema,
} from '@stxapps/shared';

// The web apps' entitlement read: wraps @stxapps/react's useSubscriptionStatus
// (the query on `GET /v1/iap/status`) with a device-local LAST-KNOWN copy, so an
// offline or cold start keeps the account's plan instead of flashing free and
// re-locking features until the network answers. localStorage (not Dexie): the
// value is a tiny JSON blob wanted SYNCHRONOUSLY at first render for
// placeholderData, and it's per-device cache — not user data, not synced.
//
// Trust model: this cache only gates CLIENT-side feature UX; everything that
// costs money is re-checked server-side at `files/sign` regardless (see
// brace-api lib/quota.ts). A stale cached plan therefore fails soft in both
// directions — an expired subscription keeps client features offline for a
// while (they cost ~nothing), and a fresh upgrade unlocks as soon as the status
// query lands.

const STORAGE_KEY = 'brace.subscriptionStatus';

function readCachedStatus(): SubscriptionStatus | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    // Parsed through the wire schema so a stale/corrupt shape degrades to null,
    // never a crash or a malformed plan string reaching entitlementsOf.
    const parsed = subscriptionStatusSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Drop the cached copy — called from the sign-out path so the next account on
// this device doesn't inherit the previous account's plan.
export function clearCachedSubscriptionStatus(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing cached to clear.
  }
}

export type UseEntitlementsResult = {
  // The folded subscription state (plan + display fields for the settings UI).
  subscription: SubscriptionStatus;
  // What the plan unlocks — the shared entitlementsOf table, so gates here
  // match the server's enforcement and the paywall's copy exactly.
  entitlements: Entitlements;
  // True only on a cold start with nothing cached — callers can skip paywall
  // flashes while the very first answer is in flight.
  isLoading: boolean;
  // Force a re-read (e.g. the post-checkout poll, a "Refresh status" button).
  // Resolves with the fresh status (undefined on failure) so a poll loop can
  // inspect the answer directly instead of racing a re-render.
  refetch: () => Promise<{ data?: SubscriptionStatus }>;
};

export function useEntitlements(): UseEntitlementsResult {
  // Read once per mount (lazy useState, not per render) so the placeholder is
  // identity-stable — see the unstable-value rules for hook returns.
  const [cached] = useState(readCachedStatus);
  const query = useSubscriptionStatus({ placeholderData: cached ?? undefined });

  // Persist each fresh answer as the device's last-known copy.
  useEffect(() => {
    if (query.data === undefined || !query.isSuccess) return;
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(query.data));
    } catch {
      // Storage unavailable (private mode, quota) — skip persistence, the
      // in-memory query cache still serves this session.
    }
  }, [query.data, query.isSuccess]);

  const subscription = query.data ?? cached ?? FREE_SUBSCRIPTION_STATUS;
  return {
    subscription,
    entitlements: entitlementsOf(subscription.plan),
    isLoading: query.isPending && cached === null,
    refetch: query.refetch,
  };
}
