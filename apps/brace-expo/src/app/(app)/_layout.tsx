import { Stack } from 'expo-router';

// The signed-in app group — `/links`, `/settings`. Mirrors brace-web's
// `src/app/(app)`. A plain Stack for now; this is where a Tabs/Drawer navigator
// would go if the mobile app wants bottom tabs for links/settings.
//
// TODO(auth): port brace-web's `(app)/layout.tsx` gate stack once
// @stxapps/expo-react ships it — AuthGuard (redirect to `/sign-in` when there's
// no session; the local-first session lives on-device, so this is client-side),
// then SyncProvider → LockProvider → AppLockGate → InitialSyncGate →
// PaywallProvider. The redirect idiom here is `<Redirect href="/sign-in" />` or
// `<Stack.Protected guard={isAuthed}>`.
//
// TODO(auth): the share sheet's app-side half rides the same providers
// (docs/share-sheet.md): on launch/foreground and after each sync, call
// @stxapps/expo-react's drainShareOutbox() (land iOS extension drafts through
// the write edge) and refreshShareTaxonomy() (rewrite the iOS App Group
// snapshot when lists/tags/locks change); on Android, kick an inline
// runIncrementalSync after the share activity saves, once SyncDeps exist here.
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
