import { Stack } from 'expo-router';

import { ShareBridge, SyncProvider } from '@stxapps/expo-react';

import { AuthGuard } from '../../components/auth-guard';

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
//                  redirects; the InitialSyncGate below will read its status.
//
// TODO(auth): the rest of brace-web's gate stack still needs porting once
// @stxapps/expo-react ships it — inside SyncProvider: LockProvider → AppLockGate
// → InitialSyncGate → PaywallProvider. Until InitialSyncGate lands, screens see
// the store while its status is still 'checking'/'syncing-initial'.
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
        <Stack screenOptions={{ headerShown: false }} />
      </SyncProvider>
    </AuthGuard>
  );
}
