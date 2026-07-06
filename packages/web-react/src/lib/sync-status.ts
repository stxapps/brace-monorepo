// Shared derivation of the user-facing sync status. Sync state is two fields
// (sync-provider's storeStatus gate + bgSyncStatus indicator); every status
// surface — brace-web's Settings→Data card, the extension popup's pill and
// detail view — collapses them into ONE phase the same way. This module owns
// that collapse so the surfaces can't drift; each surface still picks its own
// presentation (icons, actions, short pill labels) on top of the phase.

import type { BgSyncStatus, StoreStatus } from '../contexts/sync-provider';

// The collapsed one-dimensional phase, in priority order: the gate (store)
// outranks the indicator (bg) — while the store is still checking/pulling/failed
// there's no background cycle to report (cycles only run post-'ready').
export type SyncPhase =
  | 'checking' // reading the first-sync flag from IndexedDB
  | 'initial-syncing' // first-ever pull on this device
  | 'initial-error' // initial pull failed → retryInitialSync
  | 'syncing' // a background cycle is in flight
  | 'cycle-error' // the last background cycle failed → requestSync retries
  | 'idle'; // settled; the last cycle (if any) succeeded

export function getSyncPhase(store: StoreStatus, bg: BgSyncStatus): SyncPhase {
  if (store === 'checking') return 'checking';
  if (store === 'syncing-initial') return 'initial-syncing';
  if (store === 'error') return 'initial-error';
  if (bg === 'syncing') return 'syncing';
  if (bg === 'error') return 'cycle-error';
  return 'idle';
}

// The default user-facing label per phase. Surfaces may override where they
// have better information (e.g. "Last synced 5 min ago" instead of idle's
// "Up to date" when lastSyncAt is known).
export const SYNC_PHASE_LABELS: Record<SyncPhase, string> = {
  checking: 'Checking your data…',
  'initial-syncing': 'Setting up this device…',
  'initial-error': 'Initial sync failed',
  syncing: 'Syncing…',
  'cycle-error': 'Sync failed',
  idle: 'Up to date',
};

// A coarse "N min ago" for last-synced lines — good enough for a status blurb,
// no date lib needed.
export function formatSyncedAt(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return new Date(ts).toLocaleDateString();
}
