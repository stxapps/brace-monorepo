'use client';

import { type ReactNode } from 'react';

import { useSync } from '../contexts/sync-provider';

// Renders the app subtree only once the local store is usable; otherwise shows an
// in-route loading/error screen. This is a CONTENT SWAP, not a redirect: the
// "decrypting" state is a loading phase of /links (etc.), not a place of its own,
// so there's no /sync route and no history entry — the layout still owns the
// children, we just hold them back until 'ready'.
//
// - 'checking' / 'syncing-initial' → the decrypting screen (blocking first sync)
// - 'error'                        → message + retry
// - 'ready'                        → the app (background sync may still run)
//
// Named for what it gates: only the FIRST (initial) sync blocks here. By design,
// subsequent incremental/background syncs never gate the UI — they report on the
// separate bgSync dimension instead (see sync-provider).
export function InitialSyncGate({ children }: { children: ReactNode }) {
  const { storeStatus, retry } = useSync();

  if (storeStatus === 'ready') return children;

  // Only the blocking initial sync can land here: background syncs report on
  // bgSync and never set the gate's 'error'.
  if (storeStatus === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p>Couldn’t sync your links.</p>
        <button onClick={retry} className="underline">
          Try again
        </button>
      </div>
    );
  }

  // 'checking' and 'syncing-initial' — first pull on this device.
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <p>Decrypting your links…</p>
    </div>
  );
}
