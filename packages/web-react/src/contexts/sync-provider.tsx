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

import { useApiClient } from '@stxapps/react';

import { getSession } from '../data/session-store';
import { isFirstSyncDone } from '../data/sync-store';
import { runIncrementalSync, runInitialSync, type SyncDeps } from '../sync/engine';
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
//
// Sync state itself is TWO dimensions, kept as two fields rather than one enum:
//   storeStatus — the gate: can the app render local data at all? Durable; once
//                 'ready' it stays 'ready' while cycles come and go.
//   bgSync      — the indicator: health of the current/last background cycle. A
//                 failed background cycle coexists with a usable store (that's
//                 the point of local-first), so it must not leave 'ready'.

// The gate's phases — named for the LOCAL STORE, not the sync runs: on a
// returning visit no initial sync runs at all, yet the store is 'ready'.
export type StoreStatus =
  | 'checking' // reading the flag from IndexedDB
  | 'syncing-initial' // first-ever pull on this device, UI is blocked
  | 'ready' // local store is usable; background sync may still be running
  | 'error'; // initial pull failed; offer retry

// The indicator's phases. Only post-'ready' cycles report here — while the gate
// blocks, the decrypting screen IS the progress UI.
export type BgSyncState =
  | 'idle' // no cycle in flight; the last one (if any) succeeded
  | 'syncing' // a background cycle is in flight
  | 'error'; // the last cycle failed; requestSync retries (flips back to 'syncing')

interface SyncContextValue {
  storeStatus: StoreStatus;
  bgSync: BgSyncState;
  // Bumped each time requestSync() runs — i.e. on every local edit on THIS
  // device (pin/unpin/move today; any mutation kicks a cycle the same way). The
  // read edge (useLinks) keys on it to apply the user's own change immediately
  // instead of staging it behind the refresh pill: an edit you just made must
  // never hide behind "new updates".
  localWriteNonce: number;
  // Re-attempt a failed initial sync (the gate's retry).
  retryInitialSync: () => void;
  // Kick a background incremental cycle now — e.g. right after a local edit
  // enqueues a pending op. Doubles as the retry when a background cycle fails
  // (bgSync 'error'): retrying a failed cycle and running a fresh one are the
  // same operation, so there's no separate retryBgSync. Safe to call eagerly:
  // the engine single-flights per account (overlapping calls coalesce into one
  // trailing rerun). No-op until a session is usable.
  requestSync: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { username, status: authStatus } = useAuth();
  const api = useApiClient();
  const [storeStatus, setStoreStatus] = useState<StoreStatus>('checking');
  const [bgSync, setBgSync] = useState<BgSyncState>('idle');
  // Bumped by retryInitialSync() to re-run the effect.
  const [attempt, setAttempt] = useState(0);
  // Bumped by requestSync() — the local-edit signal the read edge keys on.
  const [localWriteNonce, setLocalWriteNonce] = useState(0);

  // Guards against a stale async resolution writing state after the account
  // changed or the provider unmounted.
  const activeRef = useRef(true);

  // Latest background-sync runner; requestSync goes through this ref so its
  // identity stays stable while the account/session underneath changes. Reset to
  // a no-op on cleanup so a late caller can't sync a signed-out account.
  const backgroundSyncRef = useRef<() => void>(() => undefined);
  const requestSync = useCallback(() => {
    // Mark a local edit before kicking the cycle, so the read edge applies this
    // device's own change without waiting on (or staging behind) the sync.
    setLocalWriteNonce((n) => n + 1);
    backgroundSyncRef.current();
  }, []);

  const retryInitialSync = useCallback(() => {
    setStoreStatus('checking');
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    activeRef.current = true;

    // Only meaningful once auth has settled on a signed-in user; AuthGuard keeps
    // us out of the tree otherwise, but guard anyway.
    if (authStatus !== 'authenticated' || !username) return;

    const session = getSession();
    if (!session) return; // mirror not hydrated yet; the next render will retry

    const deps: SyncDeps = { username, encryptionKey: session.encryptionKey, api };
    // Fresh slate for the indicator — a stale 'error' from a previous account
    // (or a pre-retry run) must not bleed into this one.
    setBgSync('idle');

    // Returning visit → render local data now, refresh in the background. The
    // outcome lands on the INDICATOR (bgSync), never the gate: a failed
    // background cycle coexists with a usable store, so storeStatus stays put.
    const backgroundSync = () => {
      setBgSync('syncing');
      void runIncrementalSync(deps).then(
        () => {
          if (activeRef.current) setBgSync('idle');
        },
        () => {
          if (activeRef.current) setBgSync('error');
        },
      );
    };
    backgroundSyncRef.current = backgroundSync;

    void (async () => {
      try {
        if (await isFirstSyncDone(username)) {
          if (!activeRef.current) return;
          setStoreStatus('ready');
          backgroundSync();
          return;
        }
        if (!activeRef.current) return;

        // First sign-in on this device: block on the full pull.
        setStoreStatus('syncing-initial');
        await runInitialSync(deps);
        if (!activeRef.current) return;

        setStoreStatus('ready');
        // Not a second download: a cycle right after the initial pull is usually
        // one empty opsList call (storeDownloads skips current records). It closes
        // the freshness window of the non-snapshot R2 listing and drains any
        // pending ops — the initial sync never pushes — and nothing else would
        // sync until the next local edit. Invariant: reaching 'ready' always
        // kicks a cycle, on both branches.
        backgroundSync();
      } catch {
        if (activeRef.current) setStoreStatus('error');
      }
    })();

    return () => {
      activeRef.current = false;
      backgroundSyncRef.current = () => undefined;
    };
  }, [username, authStatus, attempt, api]);

  const value = useMemo<SyncContextValue>(
    () => ({ storeStatus, bgSync, localWriteNonce, retryInitialSync, requestSync }),
    [storeStatus, bgSync, localWriteNonce, retryInitialSync, requestSync],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

// A SyncContext provider for clients where the sync ENGINE runs ELSEWHERE — the
// brace-extension popup, whose sync + selective pull live in the background service
// worker (a separate JS context), not the popup page. It satisfies the same
// `useSync` contract the editor hooks depend on (useLinkMutations / useTagMutations
// / … all call `requestSync` after a write), but instead of driving
// runIncrementalSync itself it DELEGATES `requestSync` to the caller — which
// messages the background to run a cycle. Store/bg status are passed in (the popup
// reads them from `browser.storage`), defaulting to a ready, idle store so the
// editor is usable as soon as the popup mounts. `localWriteNonce` still bumps on
// each requestSync so any read edge keyed on it (none in the popup today) stays
// correct.
export function ExternalSyncProvider({
  children,
  requestSync,
  storeStatus = 'ready',
  bgSync = 'idle',
}: {
  children: ReactNode;
  requestSync: () => void;
  storeStatus?: StoreStatus;
  bgSync?: BgSyncState;
}) {
  const [localWriteNonce, setLocalWriteNonce] = useState(0);
  const requestSyncWithNonce = useCallback(() => {
    setLocalWriteNonce((n) => n + 1);
    requestSync();
  }, [requestSync]);

  const value = useMemo<SyncContextValue>(
    () => ({
      storeStatus,
      bgSync,
      localWriteNonce,
      retryInitialSync: () => undefined,
      requestSync: requestSyncWithNonce,
    }),
    [storeStatus, bgSync, localWriteNonce, requestSyncWithNonce],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within <SyncProvider>');
  return ctx;
}
