import {
  ExtractionProvider,
  FileContentProvider,
  LockProvider,
  SyncProvider,
} from '@stxapps/web-react';

import { AppLockGate } from '@/components/app-lock-gate';
import { AuthGuard } from '@/components/auth-guard';
import { InitialSyncGate } from '@/components/initial-sync-gate';
import { PaywallProvider } from '@/contexts/paywall-provider';

// Guard for the signed-in app (/links, /settings, …). Three gates, in order:
//   AuthGuard       — "do you have a session?" (client-side: the session lives
//                     in IndexedDB, not a cookie, so the server can't gate).
//                     Redirects.
//   AppLockGate     — the device-local app lock (Settings → Misc). Sits BELOW
//                     the sync providers so sync keeps running behind the lock
//                     screen, and ABOVE InitialSyncGate so the lock screen is
//                     the first thing shown (it covers even the decrypting
//                     screen). Never redirects.
//   InitialSyncGate — "is the local store ready?" Renders a decrypting screen on
//                     first sync, then the app. Never redirects (sync-provider).
// LockProvider (app + list locks state) needs SyncProvider (its orphan sweep
// waits for a ready store) and serves both AppLockGate here and the links
// page's list-lock surfaces. FileContentProvider (on-demand `files/` blobs for
// the link preview images) only needs the session + api client, so it sits with
// the other sync-layer providers, above the gates.
// This layout stays a server component and just composes the client wrappers.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SyncProvider>
        <ExtractionProvider>
          <FileContentProvider>
            <LockProvider>
              <AppLockGate>
                <InitialSyncGate>
                  <PaywallProvider>
                    <div className="min-h-screen">{children}</div>
                  </PaywallProvider>
                </InitialSyncGate>
              </AppLockGate>
            </LockProvider>
          </FileContentProvider>
        </ExtractionProvider>
      </SyncProvider>
    </AuthGuard>
  );
}
