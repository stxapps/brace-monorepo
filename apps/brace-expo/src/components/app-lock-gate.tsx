import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { useLocks } from '@stxapps/expo-react';

import { LockPane } from './lock-pane';

const StyledSafeAreaView = withUniwind(SafeAreaView);

// Holds the whole signed-in app behind the device-local app lock (Settings →
// Misc) — the expo port of brace-web's components/app-lock-gate.tsx (the
// canonical doc): a CONTENT SWAP, not a redirect, mounted inside SyncProvider
// so the first sync proceeds behind the lock screen.
//
// 'checking' — the first locks read — renders nothing, the same no-flash
// guarantee as web: a device with no app lock must never flash a lock screen,
// and a locked one must never flash the app. Whether the lock is UNLOCKED is
// in-memory only (lock-provider), so a relaunch always re-engages it.
export function AppLockGate({ children }: { children: ReactNode }) {
  const { status, appLock, unlockApp } = useLocks();

  if (status === 'checking') return null;

  if (appLock.exists && !appLock.unlocked) {
    return (
      <StyledSafeAreaView className="bg-background flex-1">
        <LockPane
          className="flex-1"
          title="Brace is locked"
          description="Enter your app lock password to continue."
          onUnlock={unlockApp}
        />
      </StyledSafeAreaView>
    );
  }

  return children;
}
