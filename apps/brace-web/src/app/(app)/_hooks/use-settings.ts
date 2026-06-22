'use client';

// Reactive read of the user's app settings — today, the links layout. Two sources
// feed it (see docs/local-first-sync.md "data model — settings" and the Misc
// settings section):
//
//   - the SYNCED value in `settings/general.enc` (`readSettingsGeneral`), shared
//     across the user's devices; and
//   - the DEVICE-LOCAL value in the `localSettings` store (`getLocalSettings`),
//     which never syncs and is wiped on sign-out.
//
// `layoutSource` (device-local) decides which one the app actually renders, so a
// device can opt out of the synced layout and keep its own. `layoutMode` is that
// resolved value — the single field topbar/main consumed before, now sourced here
// instead of localStorage. Both reads are `useLiveQuery`, so a change on either
// source (a local edit, or a sync landing a new `settings/general.enc`) re-renders
// every consumer.

import { useLiveQuery } from 'dexie-react-hooks';

import type { LinkLayout } from '@stxapps/shared';

import { getLocalSettings } from '@/data/local-store';
import { readSettingsGeneral } from '@/data/queries';

// The fallback layout before any choice is made (and while a liveQuery is still
// resolving on first render) — the dense default, matching the old localStorage
// seed.
const DEFAULT_LAYOUT: LinkLayout = 'list';

export type LayoutSource = 'sync' | 'device';

export interface Settings {
  // The layout the app should render right now — `deviceLayout` when the active
  // source is `device`, else the synced `syncLayout`.
  layoutMode: LinkLayout;
  // Which source is active on THIS device (device-local; never synced).
  layoutSource: LayoutSource;
  // The synced layout (the Sync tab's radio value).
  syncLayout: LinkLayout;
  // This device's own layout (the Device tab's radio value).
  deviceLayout: LinkLayout;
}

export function useSettings(): Settings {
  // `undefined` on the very first render (and a stale value for one render after a
  // dep change) — defaulted below so consumers always get a concrete layout.
  const general = useLiveQuery(() => readSettingsGeneral(), []);
  const local = useLiveQuery(() => getLocalSettings(), []);

  const syncLayout = general?.linkLayout ?? DEFAULT_LAYOUT;
  const layoutSource = local?.layoutSource ?? 'sync';
  const deviceLayout = local?.linkLayout ?? DEFAULT_LAYOUT;
  const layoutMode = layoutSource === 'device' ? deviceLayout : syncLayout;

  return { layoutMode, layoutSource, syncLayout, deviceLayout };
}
