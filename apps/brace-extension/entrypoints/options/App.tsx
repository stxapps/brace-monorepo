import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { readExtractionFacetCounts, useAuth, useSignOut } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';

import {
  INITIAL_SYNC_STATUS,
  readSyncStatus,
  SYNC_STATUS_KEY,
  type SyncStatus,
} from '@/utils/messages';

// The status / options page (read-only, no library list — per the active-tab-only
// decision): sync state (mirrored from the background) + extraction facet counts
// (from the local extractions/ store), plus sign-out.
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

// Live sync status mirrored by the background into browser.storage.local.
function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(INITIAL_SYNC_STATUS);
  useEffect(() => {
    let active = true;
    void readSyncStatus().then((s) => {
      if (active) setStatus(s);
    });
    const handler: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area !== 'local') return;
      const next = changes[SYNC_STATUS_KEY]?.newValue as SyncStatus | undefined;
      if (next) setStatus(next);
    };
    browser.storage.onChanged.addListener(handler);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(handler);
    };
  }, []);
  return status;
}

function Status({ username }: { username: string | null }) {
  const sync = useSyncStatus();
  const signOut = useSignOut();

  const counts = useLiveQuery(() => readExtractionFacetCounts(), []) ?? {
    done: 0,
    pending: 0,
    failed: 0,
  };

  const lastSync = sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'never';

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
          <span>{sync.storeStatus}</span>
        </div>
        <div className="status-row">
          <span>Last cycle</span>
          <span>{sync.bgSync}</span>
        </div>
        <div className="status-row">
          <span>Last sync</span>
          <span>{lastSync}</span>
        </div>
        {sync.lastError && (
          <div className="status-row">
            <span>Last error</span>
            <span>{sync.lastError}</span>
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

      <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
        {signOut.isPending ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  );
}

export default App;
