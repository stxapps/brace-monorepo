import { SyncProvider } from '@stxapps/web-react';

import { AuthGuard } from '@/components/auth-guard';
import { InitialSyncGate } from '@/components/initial-sync-gate';

// Guard for the signed-in app (/links, /settings, …). Two gates, in order:
//   AuthGuard       — "do you have a session?" (client-side: the session lives
//                     in IndexedDB, not a cookie, so the server can't gate).
//                     Redirects.
//   InitialSyncGate — "is the local store ready?" Renders a decrypting screen on
//                     first sync, then the app. Never redirects (sync-provider).
// This layout stays a server component and just composes the client wrappers.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SyncProvider>
        <InitialSyncGate>
          <div className="min-h-screen">{children}</div>
        </InitialSyncGate>
      </SyncProvider>
    </AuthGuard>
  );
}
