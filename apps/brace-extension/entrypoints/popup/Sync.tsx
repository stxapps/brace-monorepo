import { type BgSyncStatus, type StoreStatus, useAuth, useSync } from '@stxapps/web-react';

// The two sync surfaces of the popup: a glanceable pill that sits under the save flow
// (SyncPill), and the detail view it opens (SyncDetail). Sync lives here — the popup's
// operational surface — rather than in the Settings page, which is now durable
// configuration only (theme + account). Both read the same useSync() seam brace-web
// uses; in the extension the popup provider tree feeds it from the background's
// storage mirror, so there's no separate storage subscription here.

// The at-a-glance label. Error wins, then in-flight, then the settled "ok" state — a
// single word the pill can show without the caller knowing the two-field split.
function syncLabel(store: StoreStatus, bg: BgSyncStatus, lastError: string | null): string {
  if (lastError || store === 'error' || bg === 'error') return 'Error';
  if (store === 'syncing-initial' || bg === 'syncing') return 'Syncing…';
  if (store === 'checking') return 'Checking…';
  return 'Synced ✓';
}

export function SyncPill({ onClick }: { onClick: () => void }) {
  const { storeStatus, bgSyncStatus, lastError } = useSync();
  return (
    <button
      type="button"
      className="box-border flex w-[340px] cursor-pointer items-center justify-between border-0 border-t border-border bg-transparent px-4 py-2.5 text-[13px] [font-family:inherit]"
      onClick={onClick}
    >
      <span>Sync</span>
      <span className="text-muted-foreground">
        {syncLabel(storeStatus, bgSyncStatus, lastError)} ›
      </span>
    </button>
  );
}

export function SyncDetail({ onBack }: { onBack: () => void }) {
  const { username } = useAuth();
  // All four fields, same as the old Settings status section that lived here before.
  const { storeStatus, bgSyncStatus, lastSyncAt, lastError } = useSync();
  const lastSync = lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'never';

  return (
    <div className="flex w-[340px] flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h1 className="m-0 text-base font-semibold">Sync</h1>
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-primary [font:inherit]"
          onClick={onBack}
        >
          ‹ Back
        </button>
      </div>

      <section>
        <div className="flex justify-between py-0.5 text-sm">
          <span>Account</span>
          <span>{username ?? '—'}</span>
        </div>
        <div className="flex justify-between py-0.5 text-sm">
          <span>Store</span>
          <span>{storeStatus}</span>
        </div>
        <div className="flex justify-between py-0.5 text-sm">
          <span>Last cycle</span>
          <span>{bgSyncStatus}</span>
        </div>
        <div className="flex justify-between py-0.5 text-sm">
          <span>Last sync</span>
          <span>{lastSync}</span>
        </div>
        {lastError && (
          <div className="flex justify-between py-0.5 text-sm">
            <span>Last error</span>
            <span>{lastError}</span>
          </div>
        )}
      </section>
    </div>
  );
}
