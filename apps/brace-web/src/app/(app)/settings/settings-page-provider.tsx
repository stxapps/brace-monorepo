'use client';

// Shared chrome state for the settings page: the active `section` (which the
// sidebar sets, the topbar/main read). The sidebar highlights it; the main pane
// renders the matching content.
//
// Unlike the links page, `section` lives in plain local state — NOT the URL.
// Settings is a transient, modal-style overlay you open from the links toolbar
// and close back to where you were; the active tab is private display state with
// nothing to deep-link or bookmark, so keeping it out of the URL also spares us
// the useSearchParams Suspense boundary the links provider needs. Promote it to
// the URL later if section deep-links ever become a requirement.

import { createContext, useContext, useMemo, useState } from 'react';

import { DEFAULT_SECTION_ID, type SettingsSectionId } from './sections';

interface SettingsPageContextValue {
  section: SettingsSectionId;
  setSection: (section: SettingsSectionId) => void;
}

const SettingsPageContext = createContext<SettingsPageContextValue | null>(null);

export function SettingsPageProvider({ children }: { children: React.ReactNode }) {
  const [section, setSection] = useState<SettingsSectionId>(DEFAULT_SECTION_ID);

  const value = useMemo(() => ({ section, setSection }), [section]);

  return <SettingsPageContext.Provider value={value}>{children}</SettingsPageContext.Provider>;
}

export function useSettingsPage(): SettingsPageContextValue {
  const value = useContext(SettingsPageContext);
  if (!value) {
    throw new Error('useSettingsPage must be used within a SettingsPageProvider');
  }
  return value;
}
