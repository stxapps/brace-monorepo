import {
  ExtractionProvider,
  FaviconProvider,
  FileContentProvider,
  LockProvider,
  SyncProvider,
} from '@stxapps/web-react';

import { AppLockGate } from '@/components/app-lock-gate';
import { AuthGuard } from '@/components/auth-guard';
import { DanglingExtractionSweep } from '@/components/dangling-extraction-sweep';
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
// the other sync-layer providers, above the gates. FaviconProvider (the per-host
// icon cache) sits beside it for the same reason — it needs only the extract
// client + the serverExtraction opt-in, and its rows are device-local.
// DanglingExtractionSweep is a render-null trigger, not a gate: it fires the
// once-per-session dangling-extraction janitor after the first completed sync
// cycle. Mounted HERE (brace-web only, inside SyncProvider) on purpose — see its
// header for why a selective-sync client must never inherit it.
// This layout stays a server component and just composes the client wrappers.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SyncProvider>
        <DanglingExtractionSweep />
        <ExtractionProvider>
          <FileContentProvider>
            <FaviconProvider>
              <LockProvider>
                <AppLockGate>
                  <InitialSyncGate>
                    <PaywallProvider>
                      <div className="min-h-screen">{children}</div>
                    </PaywallProvider>
                  </InitialSyncGate>
                </AppLockGate>
              </LockProvider>
            </FaviconProvider>
          </FileContentProvider>
        </ExtractionProvider>
      </SyncProvider>
    </AuthGuard>
  );
}
