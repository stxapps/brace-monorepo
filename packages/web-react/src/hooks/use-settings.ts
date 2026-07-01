'use client';

// Reactive read of the user's app settings — the links layout and the theme. Two
// sources feed each (see docs/local-first-sync.md "data model — settings" and the
// Misc settings section):
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

import {
  coerceThemeState,
  DEFAULT_THEME,
  type LinksLayout,
  type ThemeState,
} from '@stxapps/shared';

import { getLocalSettings } from '../data/local-settings-store';
import { readSettingsGeneral } from '../data/queries';

// The fallback layout before any choice is made (and while a liveQuery is still
// resolving on first render) — the dense default, matching the old localStorage
// seed.
const DEFAULT_LINKS_LAYOUT: LinksLayout = 'list';

export type LinksLayoutSource = 'sync' | 'local';
export type ThemeSource = 'sync' | 'local';

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
  // The synced server-extraction opt-in (Settings → the second, explicit opt-in).
  // OFF BY DEFAULT — `false` until the user turns it on; gates whether a web client
  // sends a saved URL to `brace-extractor` (see docs/link-extraction.md).
  serverExtraction: boolean;
  // The theme the app should apply right now — `localTheme` when the active source is
  // `local`, else the synced `syncTheme`. The ThemeProvider consumes this (the way
  // main.tsx consumes `linksLayout`) to resolve/apply light-vs-dark and to keep the
  // localStorage FOUC mirror warm.
  theme: ThemeState;
  // Which theme source is active on THIS device (device-local; never synced).
  themeSource: ThemeSource;
  // The synced theme (the theme "Sync" tab's value).
  syncTheme: ThemeState;
  // This device's own theme (the theme "Device" tab's value).
  localTheme: ThemeState;
}

export function useSettings(): Settings {
  // `undefined` on the very first render (and a stale value for one render after a
  // dep change) — defaulted below so consumers always get a concrete layout.
  const general = useLiveQuery(() => readSettingsGeneral(), []);
  const local = useLiveQuery(() => getLocalSettings(), []);

  const syncLinksLayout = general?.linksLayout ?? DEFAULT_LINKS_LAYOUT;
  const linksLayoutSource = local?.linksLayoutSource ?? 'sync';
  const localLinksLayout = local?.linksLayout ?? DEFAULT_LINKS_LAYOUT;
  const linksLayout = linksLayoutSource === 'local' ? localLinksLayout : syncLinksLayout;
  // Off by default: absent (older client / never toggled) reads as opted-out.
  const serverExtraction = general?.serverExtraction ?? false;

  // Coerce both sources through `coerceThemeState`: the synced value is permissively
  // typed (entities.ts) so an odd persisted value never drops the settings blob, and
  // the device value can predate this feature (older `localSettings` row) — both
  // normalize to a real `ThemeState`, falling back to `DEFAULT_THEME` when absent.
  const syncTheme = coerceThemeState(general?.theme ?? DEFAULT_THEME);
  const themeSource = local?.themeSource ?? 'sync';
  const localTheme = coerceThemeState(local?.theme ?? DEFAULT_THEME);
  const theme = themeSource === 'local' ? localTheme : syncTheme;

  return {
    linksLayout,
    linksLayoutSource,
    syncLinksLayout,
    localLinksLayout,
    serverExtraction,
    theme,
    themeSource,
    syncTheme,
    localTheme,
  };
}
