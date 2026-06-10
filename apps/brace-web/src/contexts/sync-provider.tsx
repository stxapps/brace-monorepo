'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getSession } from '../data/session-store';
import { isFirstSyncDone } from '../data/sync-store';
import { runIncrementalSync, runInitialSync, type SyncContext } from '../sync/engine';
import { useAuth } from './auth-provider';

// Sync state for the signed-in app — deliberately SEPARATE from auth state (see
// auth-provider). Auth answers "do you have a session?" and drives redirects;
// sync answers "is the local store ready?" and drives an in-route loading screen
// (InitialSyncGate), never a redirect. Folding this into AuthStatus/EndReason would
// muddy a type that's specifically about why you became unauthenticated.
//
// The branch is decided by the persisted first-sync flag (sync-store), not by
// remembering whether the user just created vs. signed in:
//   firstSyncDone  → 'ready' immediately, incremental sync runs in background
//   not done       → 'syncing-initial' (blocking full pull), then 'ready'
// Account creation seeds the flag at signup, so it lands in the first branch
// with no network round-trip.

type SyncStatus =
  | 'checking' // reading the flag from IndexedDB
  | 'syncing-initial' // first-ever pull on this device, UI is blocked
  | 'ready' // local store is usable; background sync may still be running
  | 'error'; // initial pull failed; offer retry

interface SyncContextValue {
  status: SyncStatus;
  // Re-attempt a failed initial sync.
  retry: () => void;
}

const SyncStateContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { username, status: authStatus } = useAuth();
  const [status, setStatus] = useState<SyncStatus>('checking');
  // Bumped by retry() to re-run the effect.
  const [attempt, setAttempt] = useState(0);

  // Guards against a stale async resolution writing state after the account
  // changed or the provider unmounted.
  const activeRef = useRef(true);

  const retry = useCallback(() => {
    setStatus('checking');
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    activeRef.current = true;

    // Only meaningful once auth has settled on a signed-in user; AuthGuard keeps
    // us out of the tree otherwise, but guard anyway.
    if (authStatus !== 'authenticated' || !username) return;

    const session = getSession();
    if (!session) return; // mirror not hydrated yet; the next render will retry
    const ctx: SyncContext = { username, encryptionKey: session.encryptionKey };

    // Returning visit → render local data now, refresh in the background. The
    // background pull's failure must not block the UI, so it's intentionally not
    // awaited into the gate state (a quiet indicator can hang off it later).
    const backgroundSync = () => {
      // Swallow background-pull failures: they must not gate the UI. A quiet
      // retry indicator can hang off this later.
      void runIncrementalSync(ctx).catch(() => undefined);
    };

    void (async () => {
      try {
        if (await isFirstSyncDone(username)) {
          if (!activeRef.current) return;
          setStatus('ready');
          backgroundSync();
          return;
        }
        // First sign-in on this device: block on the full pull.
        if (!activeRef.current) return;
        setStatus('syncing-initial');
        await runInitialSync(ctx);
        if (!activeRef.current) return;
        setStatus('ready');
        backgroundSync();
      } catch {
        if (activeRef.current) setStatus('error');
      }
    })();

    return () => {
      activeRef.current = false;
    };
  }, [username, authStatus, attempt]);

  const value = useMemo<SyncContextValue>(() => ({ status, retry }), [status, retry]);

  return <SyncStateContext.Provider value={value}>{children}</SyncStateContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncStateContext);
  if (!ctx) throw new Error('useSync must be used within <SyncProvider>');
  return ctx;
}
