'use client';

// Edit operations for app settings — the write side of use-settings.ts. The three
// setters mirror the read hook's three values, and each routes to the right store:
//
//   - setLayoutSource / setDeviceLayout → the DEVICE-LOCAL `localSettings` store
//     (no account, no sync — see local-store.ts);
//   - setSyncLayout → the SYNCED `settings/general.enc` blob via writeSettingsGeneral,
//     then a sync kick, exactly like useListMutations writes a list and requests sync.
//
// Keeping the source choice + device layout off-sync is deliberate: "use this
// device's own layout" is a per-device decision that must not propagate (db.ts).

import { useCallback, useMemo } from 'react';

import type { LinkLayout } from '@stxapps/shared';

import type { LayoutSource } from './use-settings';

import { useAuth } from '@/contexts/auth-provider';
import { useSync } from '@/contexts/sync-provider';
import { setLocalSettings } from '@/data/local-store';
import { writeSettingsGeneral } from '@/data/mutations';

export interface SettingMutations {
  // Switch which source the app renders (Sync vs Device) — device-local.
  setLayoutSource: (source: LayoutSource) => Promise<void>;
  // Set the SYNCED link layout (the Sync tab); writes settings/general.enc + syncs.
  setSyncLayout: (layout: LinkLayout) => Promise<void>;
  // Set THIS device's link layout (the Device tab) — device-local, never synced.
  setDeviceLayout: (layout: LinkLayout) => Promise<void>;
}

export function useSettingMutations(): SettingMutations {
  const { username } = useAuth();
  const { requestSync } = useSync();

  const setLayoutSource = useCallback(
    (source: LayoutSource) => setLocalSettings({ layoutSource: source }),
    [],
  );

  const setDeviceLayout = useCallback(
    (layout: LinkLayout) => setLocalSettings({ linkLayout: layout }),
    [],
  );

  const setSyncLayout = useCallback(
    async (layout: LinkLayout) => {
      if (!username) throw new Error('useSettingMutations: no active account');
      await writeSettingsGeneral(username, { linkLayout: layout });
      requestSync();
    },
    [username, requestSync],
  );

  return useMemo<SettingMutations>(
    () => ({ setLayoutSource, setSyncLayout, setDeviceLayout }),
    [setLayoutSource, setSyncLayout, setDeviceLayout],
  );
}
