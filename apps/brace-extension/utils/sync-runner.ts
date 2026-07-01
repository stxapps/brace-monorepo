import { EXTRACTIONS_PREFIX, FILES_PREFIX, LINKS_PREFIX, SETTINGS_PREFIX } from '@stxapps/shared';
import {
  getSession,
  isFirstSyncDone,
  loadSession,
  runIncrementalSync,
  runInitialSync,
  type SyncDeps,
} from '@stxapps/web-react';

import { apiClient } from './api-client';
import {
  INITIAL_MIRRORED_SYNC_STATE,
  type MirroredSyncState,
  writeMirroredSyncState,
} from './mirrored-sync-state';

// The background's sync runner. Builds the engine's SyncDeps from the persisted
// session (hydrated from IndexedDB — available in the worker) and the mode-bound api
// client, runs one cycle, and mirrors the result into browser.storage.local so the
// popup / options page can render status without mounting the sync engine.
//
// SELECTIVE SYNC: the extension materializes `links/` + `extractions/` (+ lazy
// `files/`) for the library, plus `settings/` — it still skips downloading
// `tags/`/`lists/`/`pins/` blobs. `settings/` is pulled because the popup/options
// ThemeProvider resolves the synced theme (and links layout / serverExtraction)
// through `useSettings()` → `readSettingsGeneral()`, which reads `settings/general.enc`
// out of the local store; without it materialized here that read is always undefined
// and the synced theme silently falls back to the default (the same file the pre-paint
// FOUC script's localStorage mirror is warmed from). It's a single small blob, so the
// cost is negligible. The cursor still advances across ALL ops (the engine filters
// downloads, not the op pull), so the next cycle resumes correctly.
const pathFilter = (path: string): boolean =>
  path.startsWith(LINKS_PREFIX) ||
  path.startsWith(EXTRACTIONS_PREFIX) ||
  path.startsWith(FILES_PREFIX) ||
  path.startsWith(SETTINGS_PREFIX);

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
// internally as well, but coalescing here keeps the state mirror tidy.
let inflight: Promise<void> | null = null;

let state: MirroredSyncState = INITIAL_MIRRORED_SYNC_STATE;
async function setState(patch: Partial<MirroredSyncState>): Promise<void> {
  state = { ...state, ...patch };
  await writeMirroredSyncState(state);
}

export function runSync(): Promise<void> {
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const deps = await buildDeps();
      if (!deps) {
        // Signed out: nothing to sync; present a ready, idle store.
        await setState({ storeStatus: 'ready', bgSyncStatus: 'idle' });
        return;
      }

      await setState({ bgSyncStatus: 'syncing' });
      if (await isFirstSyncDone(deps.username)) {
        await runIncrementalSync(deps);
      } else {
        await setState({ storeStatus: 'syncing-initial' });
        await runInitialSync(deps);
      }
      await setState({
        storeStatus: 'ready',
        bgSyncStatus: 'idle',
        lastSyncAt: Date.now(),
        lastError: null,
      });
    } catch (err) {
      await setState({
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
