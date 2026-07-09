'use client';

// The sign-out teardown: wipe EVERY device-local per-account store in one place.
// This is the one operation that deliberately reaches across all the stores —
// Dexie tables plus the non-Dexie caches — so it lives on its own rather than in
// any single store (each of those stays single-responsibility). The local store
// holds DECRYPTED bookmarks, so a second user on the same device must not read the
// first's plaintext; `localSettings`, `locks`, and the cached subscription copy are
// wiped for the same "next account here must not inherit this one's state" reason.
// Deliberately not account-scoped: `items` carries no owner column (see
// PendingOpRecord in db.ts), so a scoped clear would leave the previous account's
// plaintext behind.
//
// Called from auth-provider's endSession (and so the onSessionInvalid path)
// alongside clearSession — so this is the ONE teardown choke point every sign-out
// path (deliberate, expired-token, and the signed-out resolution guard) funnels
// through; anything that must not outlive an account on this device belongs here.

import { db } from './db';
import { clearDecodeCache } from './decode-cache';
import { clearCachedSubscriptionStatus } from './subscription-store';

export async function clearData(): Promise<void> {
  await Promise.all([
    db.items.clear(),
    db.syncMeta.clear(),
    db.pendingOps.clear(),
    db.localSettings.clear(),
    // Locks are device-local passwords for this account's session; wiping them
    // here IS the "forgot a lock password → sign out" recovery path (db.ts).
    db.locks.clear(),
  ]);
  clearDecodeCache(); // drop decoded-link plaintext too — mirrors this items wipe (decode-cache.ts)
  // Drop the device's last-known subscription copy for the same "next account
  // must not inherit this one's state" reason as localSettings (subscription-store.ts).
  clearCachedSubscriptionStatus();
}
