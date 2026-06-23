import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { ENC_SUFFIX, LINKS_PREFIX, normalizeUrl } from '@stxapps/shared';
import { type LinkItem, readLinkByUrl, useAuth } from '@stxapps/web-react';

import { Complete } from './Complete';
import { Editor } from './Editor';
import { SignIn } from './SignIn';

// The active tab the popup is acting on. `null` once we know there's no usable tab
// (e.g. a chrome:// page the extension can't save); `undefined` while still loading.
export interface ActiveTab {
  url: string;
  title: string;
}

// The link id (the `{id}` of `links/{id}.enc`) for a saved link — what the EXTRACT
// messages and the extraction reads key on.
export function linkIdOf(link: LinkItem): string {
  return link.path.slice(LINKS_PREFIX.length, -ENC_SUFFIX.length);
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="popup popup-centered">{children}</div>;
}

// The popup is a tiny in-memory state machine — no router needed. The branch is
// driven by auth status and an "is this tab already saved?" live query:
//   loading → (signed out) signin → (signed in) editor → complete.
// If the active URL is already in the local store, we skip the editor and open the
// complete page straight away (covers reopening a saved tab, and the bonus path of
// opening a web-app-saved link then clicking the icon).
function App() {
  const { status } = useAuth();

  if (status === 'loading') return <Centered>Loading…</Centered>;
  if (status !== 'authenticated') return <SignIn />;
  return <AuthedApp />;
}

function AuthedApp() {
  // `undefined` = still querying the active tab; `null` = no usable (http/https) tab.
  const [tab, setTab] = useState<ActiveTab | null | undefined>(undefined);
  // Set the moment a save completes, so we flip to the complete page without waiting
  // on the live "already saved?" query to catch up.
  const [justSaved, setJustSaved] = useState<LinkItem | null>(null);

  useEffect(() => {
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([active]) => {
        const url = active?.url ?? '';
        // Only http/https pages can be saved/extracted (no chrome://, web store, …).
        setTab(/^https?:/.test(url) ? { url, title: active?.title ?? '' } : null);
      })
      .catch(() => setTab(null));
  }, []);

  const normalizedUrl = tab ? (normalizeUrl(tab.url) ?? '') : '';
  // Live: re-renders if a background sync pulls in a matching saved link.
  const existing = useLiveQuery(
    () => (normalizedUrl ? readLinkByUrl(normalizedUrl) : Promise.resolve(undefined)),
    [normalizedUrl],
  );

  if (tab === undefined || existing === undefined) return <Centered>Loading…</Centered>;
  if (tab === null) {
    return <Centered>This page can’t be saved.</Centered>;
  }

  const link = justSaved ?? existing;
  if (link) return <Complete link={link} />;
  return <Editor tab={tab} url={normalizedUrl || tab.url} onSaved={setJustSaved} />;
}

export default App;
