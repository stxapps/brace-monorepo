// Transient view state for the links screen that decides WHEN a background
// sync is allowed to repaint the list — the expo port of brace-web's
// `(app)/links/_contexts/view-state-provider.tsx` (canonical doc: the list is
// virtualized and newest-first, so applying a sync mid-interaction shifts rows
// under the user; the read edge holds results back while `engaged`).
//
// Ported so far: `scrolled` — the FlashList reports its scroll position left
// the top; applying at the top is harmless (newest-first feed), so we only
// guard once scrolled away. Web's other engagement signals (openMenus /
// editing / destroying / retagging / bulkEditing) arrive with the features
// that own them: the row menu, the hoisted dialogs, and bulk edit are not on
// this screen yet.
//
// Also home to the search bar's chrome state. On web the search box is
// persistent topbar chrome; on this narrow screen it's summoned by the
// topbar's search toggle, which makes it the same kind of transient chrome
// state as web's `bulkEditing` (whose toolbar row this bar shares its slot
// with — the two will be mutually exclusive when bulk edit lands). An OPEN bar
// is not an engagement signal: the list only changes when a search commits (a
// navigation), so a background repaint under the bar disturbs nothing.

import { createContext, useContext, useMemo, useState } from 'react';

import type { Selection } from './page-provider';

// What `preSearch` may hold: a selection the drawer/topbar can render WITHOUT
// the search bar — everything but the 'none' projection. Narrowing the type
// (not just the writers) is what guarantees restoring a snapshot can never
// itself resolve `selection` to 'none' and force the bar back open.
export type SimpleSelection = Exclude<Selection, { kind: 'none' }>;

interface LinksViewStateValue {
  // True while a repaint would disrupt the user (today: scrolled past the top).
  // useLinks stages sync results while this holds.
  engaged: boolean;
  // The list's scroll position crossed (or returned to) the top.
  setScrolled: (scrolled: boolean) => void;
  // The user summoned the search bar row below the topbar (topbar's search
  // toggle). Explicit chrome INTENT, not the rendered visibility — the bar
  // renders when `searchOpen || selection.kind === 'none'`, computed at its
  // consumers (topbar + search-bar; this provider sits outside the page
  // context), so a committed search always has a visible surface even when the
  // back gesture returns to its URL after a dismiss.
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  // Where the user was when the search bar was summoned — dismissing a
  // committed search returns here instead of home (topbar's toggle). Null when
  // the bar has never been opened, or was opened over a compound deep-link
  // view ('none' selection), which has no clean single-axis restore target.
  preSearch: SimpleSelection | null;
  setPreSearch: (selection: SimpleSelection | null) => void;
}

const LinksViewStateContext = createContext<LinksViewStateValue | null>(null);

export function LinksViewStateProvider({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [preSearch, setPreSearch] = useState<SimpleSelection | null>(null);

  const value = useMemo<LinksViewStateValue>(
    () => ({ engaged: scrolled, setScrolled, searchOpen, setSearchOpen, preSearch, setPreSearch }),
    [scrolled, searchOpen, preSearch],
  );

  return <LinksViewStateContext.Provider value={value}>{children}</LinksViewStateContext.Provider>;
}

export function useLinksViewState(): LinksViewStateValue {
  const ctx = useContext(LinksViewStateContext);
  if (!ctx) {
    throw new Error('useLinksViewState must be used within a LinksViewStateProvider');
  }
  return ctx;
}
