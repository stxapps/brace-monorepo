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
// Also home to `searchOpen` — whether the search bar row is mounted below the
// topbar. On web the search box is persistent topbar chrome; on this narrow
// screen it's summoned by the topbar's search toggle, which makes it the same
// kind of transient chrome state as web's `bulkEditing` (whose toolbar row
// this bar shares its slot with — the two will be mutually exclusive when bulk
// edit lands). An OPEN bar is not an engagement signal: the list only changes
// when a search commits (a navigation), so a background repaint under the bar
// disturbs nothing.

import { createContext, useContext, useMemo, useState } from 'react';

interface LinksViewStateValue {
  // True while a repaint would disrupt the user (today: scrolled past the top).
  // useLinks stages sync results while this holds.
  engaged: boolean;
  // The list's scroll position crossed (or returned to) the top.
  setScrolled: (scrolled: boolean) => void;
  // The search bar row below the topbar is shown (topbar's search toggle).
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

const LinksViewStateContext = createContext<LinksViewStateValue | null>(null);

export function LinksViewStateProvider({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const value = useMemo<LinksViewStateValue>(
    () => ({ engaged: scrolled, setScrolled, searchOpen, setSearchOpen }),
    [scrolled, searchOpen],
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
