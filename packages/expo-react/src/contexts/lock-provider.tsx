import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { createLockVerifier, verifyLockPassword } from '@stxapps/expo-crypto';
import { computeCoverage, type ListItem, type TreeNode } from '@stxapps/shared';

import { APP_LOCK_ID, deleteLock, type LockRecord, putLock, readLocks } from '../data/lock-store';
import { useLists } from '../hooks/use-lists';
import { useLiveRead } from '../hooks/use-live-read';
import { useSync } from './sync-provider';

// Device-local app/list locks — the expo sibling of web-react's
// contexts/lock-provider.tsx, verbatim in contract (see there for the threat
// model, the coverage walk, and the two enforcement edges: lockedListIds → the
// link query's exclusion, hiddenListIds → sidebar pruning). This provider owns
// the one piece of lock state the store can't: whether each lock is currently
// UNLOCKED — plain in-memory React state, never persisted, so every lock
// re-engages on relaunch by construction. Platform divergences only here:
// reactivity is useLiveRead over the `locks` table (expo-sqlite change
// listener) instead of Dexie's liveQuery, and the PBKDF2 verifier pair comes
// from expo-crypto (react-native-quick-crypto) instead of web-crypto.

// A list lock's row state, for settings/sidebar chrome (does this list have its
// own lock, is it currently engaged, does it hide) — distinct from COVERAGE,
// which is about whose links are gated (lockedListIds includes descendants).
export interface ListLockInfo {
  locked: boolean;
  hideList: boolean;
}

export interface Locks {
  // 'checking' while the first locks read is in flight — gates render null (the
  // same no-flash rule as web's InitialSyncGate) instead of flashing the app open.
  status: 'checking' | 'ready';
  appLock: { exists: boolean; unlocked: boolean };
  // Every list whose links are currently gated (covered by a locked lock,
  // descendants included). use-links merges these into the query exclusion.
  lockedListIds: ReadonlySet<string>;
  // The covered lists that should also disappear from the sidebar/pickers.
  hiddenListIds: ReadonlySet<string>;
  // Per-list lock ROW state (own lock only, no coverage) for settings/sidebar
  // chrome. Absent key = no lock on that list.
  listLocks: ReadonlyMap<string, ListLockInfo>;
  isListLocked: (listId: string) => boolean;
  // Verify against the app lock / the list's covering lock; true opens it.
  unlockApp: (password: string) => Promise<boolean>;
  unlockList: (listId: string, password: string) => Promise<boolean>;
}

export interface LockMutations {
  // Enable the app lock. Marks it unlocked for this session — enabling from
  // settings must not slam the gate shut on the spot; it engages on next load.
  setAppLock: (password: string) => Promise<void>;
  // Disable the app lock; false = wrong password.
  removeAppLock: (password: string) => Promise<boolean>;
  // Lock a list. Engages IMMEDIATELY (any stale unlock for the id is dropped) —
  // "Lock" means lock now, matching web.
  addListLock: (listId: string, password: string, opts: { hideList: boolean }) => Promise<void>;
  // Remove a list's own lock; false = wrong password.
  removeListLock: (listId: string, password: string) => Promise<boolean>;
}

const LockContext = createContext<(Locks & LockMutations) | null>(null);

export function LockProvider({ children }: { children: ReactNode }) {
  const { storeStatus } = useSync();
  const lists = useLists();

  // undefined on the very first render → status 'checking'.
  const locks = useLiveRead(() => readLocks(), [], ['locks']);

  // Lock row ids opened this session (APP_LOCK_ID and/or list ids). In-memory
  // only — the whole point; see the header.
  const [unlockedIds, setUnlockedIds] = useState<ReadonlySet<string>>(new Set());

  const listLockRows = useMemo(() => {
    const rows = new Map<string, LockRecord>();
    for (const lock of locks ?? []) if (lock.kind === 'list') rows.set(lock.id, lock);
    return rows;
  }, [locks]);

  // Orphan sweep: list deletion SYNCS from other devices while locks are
  // device-local, so a lock can outlive its list. Guarded to a ready store with
  // a resolved, non-empty tree — readLists always includes the system lists
  // once resolved, so an empty tree means "still loading", and sweeping then
  // would wrongly drop every list lock.
  useEffect(() => {
    if (storeStatus !== 'ready' || locks === undefined || lists.length === 0) return;
    const listIds = new Set<string>();
    const collect = (nodes: TreeNode<ListItem>[]) => {
      for (const node of nodes) {
        listIds.add(node.item.id);
        collect(node.children);
      }
    };
    collect(lists);
    const orphans = (locks ?? []).filter((l) => l.kind === 'list' && !listIds.has(l.id));
    if (orphans.length === 0) return;
    void Promise.all(orphans.map((l) => deleteLock(l.id))).catch(() => {
      // Best-effort; the rows are invisible in the UI either way and the next
      // lists change retries.
    });
  }, [storeStatus, locks, lists]);

  const coverage = useMemo(
    () => computeCoverage(lists, listLockRows, unlockedIds),
    [lists, listLockRows, unlockedIds],
  );

  const listLocks = useMemo(() => {
    const infos = new Map<string, ListLockInfo>();
    for (const [id, row] of listLockRows) {
      infos.set(id, { locked: !unlockedIds.has(id), hideList: row.hideList ?? false });
    }
    return infos;
  }, [listLockRows, unlockedIds]);

  const appLockRow = locks?.find((l) => l.kind === 'app');
  const appLockExists = appLockRow !== undefined;
  const appLockUnlocked = appLockRow === undefined || unlockedIds.has(appLockRow.id);

  const markUnlocked = useCallback((id: string) => {
    setUnlockedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const markLocked = useCallback((id: string) => {
    setUnlockedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Verify a password against one lock row and open it on a match. Reads the row
  // fresh from the store (not the live snapshot) so a just-written lock is
  // always verifiable.
  const unlock = useCallback(
    async (lockId: string, password: string): Promise<boolean> => {
      const row = (await readLocks()).find((l) => l.id === lockId);
      if (row === undefined) return false;
      const ok = await verifyLockPassword(password, row);
      if (ok) markUnlocked(lockId);
      return ok;
    },
    [markUnlocked],
  );

  const unlockApp = useCallback((password: string) => unlock(APP_LOCK_ID, password), [unlock]);

  const unlockList = useCallback(
    async (listId: string, password: string) => {
      // Two locks can gate one list — its OWN row and a locked ancestor's (the
      // covering lock). Try the own row first, then the covering one, so the
      // password opens whichever it belongs to (web's rationale, verbatim).
      const candidates = [listId];
      const covering = coverage.coveringLockIds.get(listId);
      if (covering !== undefined && covering !== listId) candidates.push(covering);
      for (const lockId of candidates) {
        if (await unlock(lockId, password)) return true;
      }
      return false;
    },
    [coverage, unlock],
  );

  const isListLocked = useCallback(
    (listId: string) => coverage.lockedListIds.has(listId),
    [coverage],
  );

  const setAppLock = useCallback(
    async (password: string) => {
      const verifier = await createLockVerifier(password);
      await putLock({ id: APP_LOCK_ID, kind: 'app', ...verifier });
      markUnlocked(APP_LOCK_ID);
    },
    [markUnlocked],
  );

  const removeAppLock = useCallback(
    async (password: string): Promise<boolean> => {
      const row = (await readLocks()).find((l) => l.id === APP_LOCK_ID);
      if (row === undefined) return true; // already gone
      if (!(await verifyLockPassword(password, row))) return false;
      await deleteLock(APP_LOCK_ID);
      markLocked(APP_LOCK_ID);
      return true;
    },
    [markLocked],
  );

  const addListLock = useCallback(
    async (listId: string, password: string, opts: { hideList: boolean }) => {
      const verifier = await createLockVerifier(password);
      await putLock({ id: listId, kind: 'list', ...verifier, hideList: opts.hideList });
      // Drop any stale unlock from an earlier lock on the same list this
      // session — a fresh lock engages immediately.
      markLocked(listId);
    },
    [markLocked],
  );

  const removeListLock = useCallback(
    async (listId: string, password: string): Promise<boolean> => {
      const row = (await readLocks()).find((l) => l.id === listId && l.kind === 'list');
      if (row === undefined) return true; // already gone
      if (!(await verifyLockPassword(password, row))) return false;
      await deleteLock(listId);
      markLocked(listId);
      return true;
    },
    [markLocked],
  );

  const value = useMemo<Locks & LockMutations>(
    () => ({
      status: locks === undefined ? 'checking' : 'ready',
      appLock: { exists: appLockExists, unlocked: appLockUnlocked },
      lockedListIds: coverage.lockedListIds,
      hiddenListIds: coverage.hiddenListIds,
      listLocks,
      isListLocked,
      unlockApp,
      unlockList,
      setAppLock,
      removeAppLock,
      addListLock,
      removeListLock,
    }),
    [
      locks,
      appLockExists,
      appLockUnlocked,
      coverage,
      listLocks,
      isListLocked,
      unlockApp,
      unlockList,
      setAppLock,
      removeAppLock,
      addListLock,
      removeListLock,
    ],
  );

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>;
}

function useLockContext(): Locks & LockMutations {
  const value = useContext(LockContext);
  if (!value) throw new Error('useLocks must be used within a LockProvider');
  return value;
}

export function useLocks(): Locks {
  return useLockContext();
}

export function useLockMutations(): LockMutations {
  return useLockContext();
}
