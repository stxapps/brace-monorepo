import { Stack } from 'expo-router';

import { LockProvider, ShareBridge, SyncProvider } from '@stxapps/expo-react';

import { AppLockGate } from '../../components/app-lock-gate';
import { AuthGuard } from '../../components/auth-guard';
import { InitialSyncGate } from '../../components/initial-sync-gate';
import { PaywallProvider } from '../../contexts/paywall-provider';

// The signed-in app group — `/links`, `/settings`. Mirrors brace-web's
// `src/app/(app)`. A plain Stack for now; this is where a Tabs/Drawer navigator
// would go if the mobile app wants bottom tabs for links/settings.
//
// Gate stack, mirroring brace-web's `(app)/layout.tsx`, in order:
//   AuthGuard    — "do you have a session?" It redirects to `/sign-in` (or `/`
//                  on a deliberate sign-out) when there's no session —
//                  client-side, since the local-first session lives on-device
//                  (secure-store), so there's no server to gate. Reads the
//                  AuthProvider mounted in the root `_layout`.
//   SyncProvider — "is the local store ready?" It runs initial/incremental sync
//                  and exposes storeStatus/requestSync to the app. Never
//                  redirects.
//   LockProvider — the device-local app/list locks state. Needs SyncProvider
//                  (its orphan sweep waits for a ready store) and serves both
//                  AppLockGate here and the links/settings lock surfaces.
//   AppLockGate  — the device-local app lock (Settings → Misc). A content
//                  swap, never a redirect; sync keeps running behind the lock
//                  screen since the sync providers sit above it. Sits ABOVE
//                  InitialSyncGate so the lock screen is the first thing shown
//                  (it covers even the decrypting screen).
//   InitialSyncGate — "is the local store ready?" Renders a decrypting screen
//                  on first sync, then the app. Never redirects (sync-provider).
//   PaywallProvider — the hoisted upgrade dialog behind the entitlement gates
//                  (locks, nested lists).
//
// ShareBridge is the share sheet's app-side half (docs/share-sheet.md): it
// drains the iOS extension's outbox through the write edge on launch/foreground
// and keeps the App Group taxonomy snapshot fresh after syncs and local edits.
// It reads useSync, so it sits inside SyncProvider. (The Android share
// activity's inline sync kick lives in saveSharedDraft itself, not here.)
export default function AppLayout() {
  return (
    <AuthGuard>
      <SyncProvider>
        <ShareBridge />
        <LockProvider>
          <AppLockGate>
            <InitialSyncGate>
              <PaywallProvider>
                <Stack screenOptions={{ headerShown: false }}>
                  {/* The quick-add editor presents modally (iOS pageSheet;
                      Android slides up) — a router screen, not an RN Modal, so
                      keyboard-controller and portals work inside it (see
                      features/links/link-add-screen.tsx). */}
                  <Stack.Screen
                    name="add-link"
                    options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                  />
                </Stack>
              </PaywallProvider>
            </InitialSyncGate>
          </AppLockGate>
        </LockProvider>
      </SyncProvider>
    </AuthGuard>
  );
}
