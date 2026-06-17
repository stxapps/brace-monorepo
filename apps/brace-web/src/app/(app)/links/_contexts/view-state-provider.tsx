'use client';

// Transient view state for the main pane that decides WHEN a background sync is
// allowed to repaint the list. The list is index-virtualized and sorted
// newest-first, so applying a sync mid-interaction shifts the rows under the user
// (the read edge, useLinks, holds results back instead — see its `hasPending` /
// refresh pill). "Mid-interaction" is two things, tracked here:
//
//   scrolled  — the active layout reports its scroll container left the top.
//               Applying at the top is harmless (it's a newest-first feed), so we
//               only guard once scrolled away. One layout is mounted at a time, so
//               a single flag suffices; layouts reset it on mount/unmount.
//   openMenus — a row's options menu is open; its trigger lives in a virtualized
//               row, so a repaint can move or unmount it out from under the user.
//               Counted (not a bool) so an open landing as another closes can't
//               leave it stuck.
//
// This is deliberately SEPARATE from page-provider (URL/layout state): it's
// ephemeral interaction state, never persisted, never in the URL.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface LinksViewStateValue {
  // True while a repaint would disrupt the user: scrolled past the top, or a row
  // menu is open. useLinks stages sync results while this holds.
  engaged: boolean;
  // The active layout's scroll position crossed (or returned to) the top.
  setScrolled: (scrolled: boolean) => void;
  // A row menu opened (true) or closed (false).
  setMenuOpen: (open: boolean) => void;
}

const LinksViewStateContext = createContext<LinksViewStateValue | null>(null);

export function LinksViewStateProvider({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [openMenus, setOpenMenus] = useState(0);

  const setMenuOpen = useCallback((open: boolean) => {
    setOpenMenus((n) => Math.max(0, n + (open ? 1 : -1)));
  }, []);

  const value = useMemo<LinksViewStateValue>(
    () => ({ engaged: scrolled || openMenus > 0, setScrolled, setMenuOpen }),
    [scrolled, openMenus, setMenuOpen],
  );

  return (
    <LinksViewStateContext.Provider value={value}>{children}</LinksViewStateContext.Provider>
  );
}

export function useLinksViewState(): LinksViewStateValue {
  const ctx = useContext(LinksViewStateContext);
  if (!ctx) {
    throw new Error('useLinksViewState must be used within a LinksViewStateProvider');
  }
  return ctx;
}
