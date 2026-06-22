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
// `linksLayoutSource` (device-local) decides which one the app actually renders, so
// a device can opt out of the synced layout and keep its own. `linksLayout` is that
// resolved value — the single field topbar/main consumed before, now sourced here
// instead of localStorage. ("local" is the internal name for the off-sync source;
// the Misc UI labels its tab "Device".) Both reads are `useLiveQuery`, so a change
// on either source (a local edit, or a sync landing a new `settings/general.enc`)
// re-renders every consumer.

import { useLiveQuery } from 'dexie-react-hooks';

import type { LinksLayout } from '@stxapps/shared';

import { getLocalSettings } from '@/data/local-store';
import { readSettingsGeneral } from '@/data/queries';

// The fallback layout before any choice is made (and while a liveQuery is still
// resolving on first render) — the dense default, matching the old localStorage
// seed.
const DEFAULT_LINKS_LAYOUT: LinksLayout = 'list';

export type LinksLayoutSource = 'sync' | 'local';

export interface Settings {
  // The links layout the app should render right now — `localLinksLayout` when the
  // active source is `local`, else the synced `syncLinksLayout`.
  linksLayout: LinksLayout;
  // Which source is active on THIS device (device-local; never synced).
  linksLayoutSource: LinksLayoutSource;
  // The synced links layout (the Sync tab's radio value).
  syncLinksLayout: LinksLayout;
  // This device's own links layout (the Device tab's radio value).
  localLinksLayout: LinksLayout;
}

export function useSettings(): Settings {
  // `undefined` on the very first render (and a stale value for one render after a
  // dep change) — defaulted below so consumers always get a concrete layout.
  const general = useLiveQuery(() => readSettingsGeneral(), []);
  const local = useLiveQuery(() => getLocalSettings(), []);

  const syncLinksLayout = general?.linksLayout ?? DEFAULT_LINKS_LAYOUT;
  const linksLayoutSource = local?.linksLayoutSource ?? 'sync';
  const localLinksLayout = local?.linksLayout ?? DEFAULT_LINKS_LAYOUT;
  const linksLayout =
    linksLayoutSource === 'local' ? localLinksLayout : syncLinksLayout;

  return { linksLayout, linksLayoutSource, syncLinksLayout, localLinksLayout };
}
