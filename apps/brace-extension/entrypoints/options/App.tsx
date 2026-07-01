import { useLiveQuery } from 'dexie-react-hooks';

import { readExtractionFacetCounts, useAuth, useSignOut, useSync } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';

import { ThemeSection } from './ThemeSection';

// The status / options page (mostly read-only, no library list — per the active-tab-only
// decision): sync state (mirrored from the background) + extraction facet counts
// (from the local extractions/ store), a theme picker (the one synced setting that
// applies here — see ThemeSection), plus sign-out.
function App() {
  const { status, username } = useAuth();

  if (status === 'loading') {
    return <div className="status-page">Loading…</div>;
  }
  if (status !== 'authenticated') {
    return (
      <div className="status-page">
        <p>Sign in from the toolbar popup to see sync status.</p>
      </div>
    );
  }
  return <Status username={username} />;
}

function Status({ username }: { username: string | null }) {
  // Status comes through the same useSync() seam as brace-web — the popup provider
  // tree (Providers) feeds ExternalSyncProvider from the background's storage mirror,
  // so this page reads all four fields (store/bg/lastSyncAt/lastError) without its own
  // storage subscription.
  const { storeStatus, bgSyncStatus, lastSyncAt, lastError } = useSync();
  const signOut = useSignOut();

  const counts = useLiveQuery(() => readExtractionFacetCounts(), []) ?? {
    done: 0,
    pending: 0,
    failed: 0,
  };

  const lastSync = lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'never';

  return (
    <div className="status-page">
      <h1 className="popup-title">Brace — Status</h1>

      <section>
        <h2 className="status-section-title">Sync</h2>
        <div className="status-row">
          <span>Account</span>
          <span>{username ?? '—'}</span>
        </div>
        <div className="status-row">
          <span>Store</span>
          <span>{storeStatus}</span>
        </div>
        <div className="status-row">
          <span>Last cycle</span>
          <span>{bgSyncStatus}</span>
        </div>
        <div className="status-row">
          <span>Last sync</span>
          <span>{lastSync}</span>
        </div>
        {lastError && (
          <div className="status-row">
            <span>Last error</span>
            <span>{lastError}</span>
          </div>
        )}
      </section>

      <section>
        <h2 className="status-section-title">Extractions</h2>
        <div className="status-row">
          <span>Done</span>
          <span>{counts.done}</span>
        </div>
        <div className="status-row">
          <span>Pending</span>
          <span>{counts.pending}</span>
        </div>
        <div className="status-row">
          <span>Failed</span>
          <span>{counts.failed}</span>
        </div>
      </section>

      <ThemeSection />

      <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
        {signOut.isPending ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  );
}

export default App;
