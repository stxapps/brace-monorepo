'use client';

// Edit operations for app settings — the write side of use-settings.ts. The three
// setters mirror the read hook's three values, and each routes to the right store:
//
//   - setLinksLayoutSource / setLocalLinksLayout → the DEVICE-LOCAL `localSettings`
//     store (no account, no sync — see local-store.ts);
//   - setSyncLinksLayout → the SYNCED `settings/general.enc` blob via writeSettingsGeneral,
//     then a sync kick, exactly like useListMutations writes a list and requests sync.
//
// Keeping the source choice + device layout off-sync is deliberate: "use this
// device's own layout" is a per-device decision that must not propagate (db.ts).

import { useCallback, useMemo } from 'react';

import type { LinksLayout } from '@stxapps/shared';

import type { LinksLayoutSource } from './use-settings';

import { useAuth } from '@/contexts/auth-provider';
import { useSync } from '@/contexts/sync-provider';
import { setLocalSettings } from '@/data/local-store';
import { writeSettingsGeneral } from '@/data/mutations';

export interface SettingMutations {
  // Switch which source the app renders (Sync vs Device) — device-local.
  setLinksLayoutSource: (source: LinksLayoutSource) => Promise<void>;
  // Set the SYNCED links layout (the Sync tab); writes settings/general.enc + syncs.
  setSyncLinksLayout: (layout: LinksLayout) => Promise<void>;
  // Set THIS device's links layout (the Device tab) — device-local, never synced.
  setLocalLinksLayout: (layout: LinksLayout) => Promise<void>;
}

export function useSettingMutations(): SettingMutations {
  const { username } = useAuth();
  const { requestSync } = useSync();

  const setLinksLayoutSource = useCallback(
    (source: LinksLayoutSource) => setLocalSettings({ linksLayoutSource: source }),
    [],
  );

  const setLocalLinksLayout = useCallback(
    (layout: LinksLayout) => setLocalSettings({ linksLayout: layout }),
    [],
  );

  const setSyncLinksLayout = useCallback(
    async (layout: LinksLayout) => {
      if (!username) throw new Error('useSettingMutations: no active account');
      await writeSettingsGeneral(username, { linksLayout: layout });
      requestSync();
    },
    [username, requestSync],
  );

  return useMemo<SettingMutations>(
    () => ({ setLinksLayoutSource, setSyncLinksLayout, setLocalLinksLayout }),
    [setLinksLayoutSource, setSyncLinksLayout, setLocalLinksLayout],
  );
}
