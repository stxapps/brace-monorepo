import { useEffect } from 'react';
import { AppState } from 'react-native';

import { drainShareOutbox, refreshShareTaxonomy } from '../data/share-store';
import { useSync } from './sync-provider';

// The MAIN APP's half of the share sheet (docs/share-sheet.md), as a renderless
// component mounted inside <SyncProvider> (it reads useSync): keeps the two App
// Group artifacts flowing in both directions.
//
//  - INBOUND (outbox → store): drain the iOS extension's queued drafts through
//    the write edge on mount and on every return to foreground — the moments
//    the user comes back after sharing. A drain that landed drafts calls
//    requestSync(), so the pending ops push now and the read edge shows the
//    user their own share immediately (localWriteNonce semantics).
//  - OUTBOUND (store → snapshot): rewrite the taxonomy snapshot after every
//    drain (a draft can mint new tags), after every completed sync cycle
//    (lastSyncAt — a pull may have changed lists/tags/locks), and on every
//    local edit (localWriteNonce — a rename/new list must reach the sheet
//    before the cycle that pushes it finishes). Lock edits don't bump either
//    signal; they're picked up by the next foreground/mount pass, which is
//    fresh enough for a picker filter.
//
// Every call is a platform no-op on Android (the share activity reads live) and
// failure-tolerant: this bridge must never take the app tree down over a share
// artifact — a missed pass self-heals on the next signal.
export function ShareBridge() {
  const { lastSyncAt, localWriteNonce, requestSync } = useSync();

  useEffect(() => {
    const pass = () => {
      void (async () => {
        const applied = await drainShareOutbox();
        await refreshShareTaxonomy();
        if (applied > 0) requestSync();
      })().catch(() => undefined);
    };
    pass();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') pass();
    });
    return () => sub.remove();
    // requestSync is identity-stable (sync-provider) — this effect runs once
    // per mount, not per render.
  }, [requestSync]);

  useEffect(() => {
    // Skip the initial render (nothing synced/edited yet — the mount pass above
    // already refreshed); react to real signals only.
    if (lastSyncAt === null && localWriteNonce === 0) return;
    void refreshShareTaxonomy().catch(() => undefined);
  }, [lastSyncAt, localWriteNonce]);

  return null;
}
