import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { SettingsIcon } from 'lucide-react';

import { normalizeUrl } from '@stxapps/shared';
import { type LinkItem, readLinkByUrlKey, useAuth, useSync } from '@stxapps/web-react';

import { Complete } from './Complete';
import { Editor } from './Editor';
import { SignIn } from './SignIn';
import { SyncDetail, SyncPill } from './Sync';

// The active tab the popup is acting on. `null` once we know there's no usable tab
// (e.g. a chrome:// page the extension can't save); `undefined` while still loading.
export interface ActiveTab {
  url: string;
  title: string;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-30 w-85 flex-col items-center justify-center gap-3 p-4">
      {children}
    </div>
  );
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

// Two parts, one tiny in-popup router: the save flow, with a glanceable sync pill
// docked under it. Clicking the pill swaps the whole popup to the sync detail view
// (and back) — sync detail lives in the popup, not Settings, so this is a local
// `view` toggle rather than opening the options page.
function AuthedApp() {
  const { requestSync } = useSync();
  const [view, setView] = useState<'flow' | 'sync'>('flow');

  // Kick a background cycle the moment the popup is authenticated. This subtree
  // mounts on BOTH entry paths — "opened while already signed in" (loading →
  // authenticated) and "just signed in" (unauthenticated → authenticated, App
  // swaps SignIn for this) — so one mount effect covers both. Without it a fresh
  // sign-in runs no cycle until the hourly alarm, leaving status at "last sync
  // never" over an empty store. `requestSync` messages the background (KICK_SYNC);
  // the worker's single-flight coalesces this with any alarm/startup cycle, so an
  // extra kick per popup open is cheap. This is the "KICK_SYNC from the popup"
  // freshness trigger background.ts anticipates, now wired beyond post-write.
  useEffect(() => {
    requestSync();
  }, [requestSync]);

  if (view === 'sync') return <SyncDetail onBack={() => setView('flow')} />;
  return (
    <>
      <SaveFlow />
      <button
        type="button"
        className="absolute top-2 right-2 p-1 text-muted-foreground"
        title="Settings"
        onClick={() => browser.runtime.openOptionsPage()}
      >
        <SettingsIcon className="size-4" />
      </button>
      <SyncPill onClick={() => setView('sync')} />
    </>
  );
}

function SaveFlow() {
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
      .catch(() => {
        setTab(null);
      });
  }, []);

  const normalizedUrl = tab ? (normalizeUrl(tab.url) ?? '') : '';
  // Live: re-renders if a background sync pulls in a matching saved link. Matched
  // by canonical identity (readLinkByUrlKey), not exact string, so a tab that
  // differs from the saved link only by scheme/www/trailing slash/query order
  // still counts as already saved.
  // The `?? null` is load-bearing: the query returns `undefined` for "not saved",
  // but useLiveQuery also returns `undefined` while it's still resolving. Coercing the
  // settled not-found case to `null` keeps `undefined` meaning ONLY "still loading" —
  // without it the guard below would treat every unsaved tab as perpetually loading.
  const existing = useLiveQuery(
    () =>
      (normalizedUrl ? readLinkByUrlKey(normalizedUrl) : Promise.resolve(undefined)).then(
        (link) => link ?? null,
      ),
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
