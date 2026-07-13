import { Stack } from 'expo-router';

import { AuthGuard } from '../../components/auth-guard';

// The signed-in app group — `/links`, `/settings`. Mirrors brace-web's
// `src/app/(app)`. A plain Stack for now; this is where a Tabs/Drawer navigator
// would go if the mobile app wants bottom tabs for links/settings.
//
// AuthGuard is now wired: it redirects to `/sign-in` (or `/` on a deliberate
// sign-out) when there's no session — client-side, since the local-first session
// lives on-device (secure-store), so there's no server to gate. It reads the
// AuthProvider mounted in the root `_layout`.
//
// TODO(auth): the rest of brace-web's `(app)/layout.tsx` gate stack still needs
// porting once @stxapps/expo-react ships it — inside AuthGuard: SyncProvider →
// LockProvider → AppLockGate → InitialSyncGate → PaywallProvider.
//
// TODO(auth): the share sheet's app-side half rides the same providers
// (docs/share-sheet.md): on launch/foreground and after each sync, call
// @stxapps/expo-react's drainShareOutbox() (land iOS extension drafts through
// the write edge) and refreshShareTaxonomy() (rewrite the iOS App Group
// snapshot when lists/tags/locks change); on Android, kick an inline
// runIncrementalSync after the share activity saves, once SyncDeps exist here.
export default function AppLayout() {
  return (
    <AuthGuard>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthGuard>
  );
}
