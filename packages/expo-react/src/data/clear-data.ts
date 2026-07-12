// The sign-out teardown — the expo sibling of web-react's data/clear-data.ts:
// wipe EVERY device-local per-account store in one place (see there for the
// full rationale — decrypted data must not outlive the session, and the next
// account on this device must not inherit this one's state; deliberately not
// account-scoped since `items` carries no owner column). The one operation that
// reaches across all the stores, so it lives on its own; anything that must not
// outlive an account on this device belongs here. (delete-all-data.ts wipes a
// SUBSET while staying signed in — synced stores yes, identity/device stores
// no; keep the two aligned when adding a store here.)
//
// The expo split adds one member web doesn't have: the on-disk plaintext
// `files/` blobs (file-store.ts) — the file-system half of the `items` wipe.
// The tables clear in ONE transaction; the directory delete can't join it
// (different medium), but the ordering fails safe: tables first, so a crash
// in between leaves orphan files with no rows pointing at them, invisible to
// the app and removed by the next clearData or materialize-overwrite.

import { clearDecodeCache } from '@stxapps/shared';

import {
  getDb,
  itemFacetStatuses,
  items,
  itemTagIds,
  localSettings,
  locks,
  pendingOps,
  subscriptionStatus,
  syncMeta,
} from './db';
import { clearDataFiles } from './file-store';

export async function clearData(): Promise<void> {
  getDb().transaction((tx) => {
    tx.delete(items).run();
    tx.delete(itemTagIds).run();
    tx.delete(itemFacetStatuses).run();
    tx.delete(syncMeta).run();
    tx.delete(pendingOps).run();
    tx.delete(localSettings).run();
    // Locks are device-local passwords for this account's session; wiping them
    // here IS the "forgot a lock password → sign out" recovery path (db.ts).
    tx.delete(locks).run();
    // The device's last-known subscription copy — same "next account must not
    // inherit this one's state" reason as localSettings (subscription-store.ts).
    tx.delete(subscriptionStatus).run();
  });
  // Decrypted `files/` blobs on disk — mirrors the items wipe (file-store.ts).
  clearDataFiles();
  clearDecodeCache(); // drop decoded-link plaintext too (@stxapps/shared decode-cache)
}
