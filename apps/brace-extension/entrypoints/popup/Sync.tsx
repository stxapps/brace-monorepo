import { formatSyncedAt, getSyncPhase, SYNC_PHASE_LABELS, type SyncPhase } from '@stxapps/shared';
import { usePendingChangesCount, useSync } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';

// The two sync surfaces of the popup: a glanceable pill that sits under the save flow
// (SyncPill), and the detail view it opens (SyncDetail). Sync lives here — the popup's
// operational surface — rather than in the Settings page, which is now durable
// configuration only (theme + account). Both read the same useSync() seam brace-web
// uses; in the extension the popup provider tree feeds it from the background's
// storage mirror, so there's no separate storage subscription here. The two-field
// status collapses through @stxapps/shared's getSyncPhase, same as brace-web's
// Settings→Data card — only the wording differs per surface.

// The pill's at-a-glance word per phase — shorter than the shared labels since it
// shares a row with the "Sync" caption.
const PILL_LABELS: Record<SyncPhase, string> = {
  checking: 'Checking…',
  'initial-syncing': 'Syncing…',
  'initial-error': 'Error',
  syncing: 'Syncing…',
  'cycle-error': 'Error',
  idle: 'Synced ✓',
};

export function SyncPill({ onClick }: { onClick: () => void }) {
  const { storeStatus, bgSyncStatus } = useSync();
  return (
    <button
      type="button"
      className="flex w-85 items-center justify-between border-t px-4 py-2.5 text-sm"
      onClick={onClick}
    >
      <span>Sync</span>
      <span className="text-muted-foreground">
        {PILL_LABELS[getSyncPhase(storeStatus, bgSyncStatus)]} ›
      </span>
    </button>
  );
}

export function SyncDetail({ onBack }: { onBack: () => void }) {
  const { storeStatus, bgSyncStatus, lastSyncAt, lastError, requestSync } = useSync();
  // Queued local edits the next cycle will push — live from the shared Dexie
  // store, not the background's mirror.
  const pendingCount = usePendingChangesCount();
  const phase = getSyncPhase(storeStatus, bgSyncStatus);
  const lastSync = lastSyncAt ? formatSyncedAt(lastSyncAt) : 'never';

  // The one action of this screen. `requestSync` (KICK_SYNC → background runSync)
  // covers every actionable phase: it re-runs the initial pull when it hasn't
  // finished and an incremental cycle otherwise, so a single button recovers both
  // error phases as well as a manual idle sync — no separate retryInitialSync (a
  // no-op under the popup's ExternalSyncProvider anyway). Hidden while a cycle is
  // in flight (checking/initial-syncing/syncing) — nothing to trigger.
  const actionLabel =
    phase === 'idle'
      ? 'Sync now'
      : phase === 'initial-error' || phase === 'cycle-error'
        ? 'Retry'
        : null;

  return (
    <div className="flex w-85 flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold">Sync</h1>
        <button type="button" className="text-primary" onClick={onBack}>
          ‹ Back
        </button>
      </div>

      <section>
        <div className="flex justify-between py-0.5 text-sm">
          <span>Status</span>
          <span>{SYNC_PHASE_LABELS[phase]}</span>
        </div>
        <div className="flex justify-between py-0.5 text-sm">
          <span>Pending changes</span>
          <span>{pendingCount}</span>
        </div>
        <div className="flex justify-between py-0.5 text-sm">
          <span>Last sync</span>
          <span>{lastSync}</span>
        </div>
        {lastError && (
          <div className="flex justify-between py-0.5 text-sm">
            <span>Last error</span>
            <span className="text-destructive">{lastError}</span>
          </div>
        )}
      </section>

      {actionLabel && (
        <Button variant="outline" size="sm" onClick={() => requestSync()}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
