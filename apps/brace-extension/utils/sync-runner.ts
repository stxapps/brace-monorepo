import { EXTRACTIONS_PREFIX, FILES_PREFIX, LINKS_PREFIX } from '@stxapps/shared';
import {
  getSession,
  isFirstSyncDone,
  loadSession,
  runIncrementalSync,
  runInitialSync,
  type SyncDeps,
} from '@stxapps/web-react';

import { apiClient } from './api-client';
import { INITIAL_SYNC_STATUS, type SyncStatus, writeSyncStatus } from './messages';

// The background's sync runner. Builds the engine's SyncDeps from the persisted
// session (hydrated from IndexedDB — available in the worker) and the mode-bound api
// client, runs one cycle, and mirrors the result into browser.storage.local so the
// popup / options page can render status without mounting the sync engine.
//
// SELECTIVE SYNC: the extension materializes only `links/` + `extractions/` (+ lazy
// `files/`) — it skips downloading `tags/`/`lists/`/`pins/`/`settings/` blobs. The
// cursor still advances across ALL ops (the engine filters downloads, not the op
// pull), so the next cycle resumes correctly.
const pathFilter = (path: string): boolean =>
  path.startsWith(LINKS_PREFIX) ||
  path.startsWith(EXTRACTIONS_PREFIX) ||
  path.startsWith(FILES_PREFIX);

async function buildDeps(): Promise<SyncDeps | null> {
  // loadSession hydrates the in-memory mirror the api client's authFetch reads.
  const session = (await loadSession()) ?? getSession();
  if (!session) return null;
  return {
    username: session.username,
    encryptionKey: session.encryptionKey,
    api: apiClient,
    pathFilter,
  };
}

// Single-flight at the worker level too: overlapping triggers (alarm + a KICK_SYNC
// from a save) share the in-flight run. The engine single-flights per account
// internally as well, but coalescing here keeps the status mirror tidy.
let inflight: Promise<void> | null = null;

let status: SyncStatus = INITIAL_SYNC_STATUS;
async function setStatus(patch: Partial<SyncStatus>): Promise<void> {
  status = { ...status, ...patch };
  await writeSyncStatus(status);
}

export function runSync(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const deps = await buildDeps();
      if (!deps) {
        // Signed out: nothing to sync; present a ready, idle store.
        await setStatus({ storeStatus: 'ready', bgSyncStatus: 'idle' });
        return;
      }
      await setStatus({ bgSyncStatus: 'syncing' });
      if (await isFirstSyncDone(deps.username)) {
        await runIncrementalSync(deps);
      } else {
        await setStatus({ storeStatus: 'syncing-initial' });
        await runInitialSync(deps);
      }
      await setStatus({
        storeStatus: 'ready',
        bgSyncStatus: 'idle',
        lastSyncAt: Date.now(),
        lastError: null,
      });
    } catch (err) {
      await setStatus({
        bgSyncStatus: 'error',
        lastSyncAt: Date.now(),
        lastError: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
