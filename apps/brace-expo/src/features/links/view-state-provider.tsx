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

import { createContext, useContext, useMemo, useState } from 'react';

interface LinksViewStateValue {
  // True while a repaint would disrupt the user (today: scrolled past the top).
  // useLinks stages sync results while this holds.
  engaged: boolean;
  // The list's scroll position crossed (or returned to) the top.
  setScrolled: (scrolled: boolean) => void;
}

const LinksViewStateContext = createContext<LinksViewStateValue | null>(null);

export function LinksViewStateProvider({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  const value = useMemo<LinksViewStateValue>(
    () => ({ engaged: scrolled, setScrolled }),
    [scrolled],
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
