import { AuthGuard } from '@/components/auth-guard';
import { SyncGate } from '@/components/sync-gate';
import { SyncProvider } from '@/contexts/sync-provider';

// Guard for the signed-in app (/links, /settings, …). Two gates, in order:
//   AuthGuard  — "do you have a session?" (client-side: the session lives in
//                IndexedDB, not a cookie, so the server can't gate). Redirects.
//   SyncGate   — "is the local store ready?" Renders a decrypting screen on the
//                first sync, then the app. Never redirects (see sync-provider).
// This layout stays a server component and just composes the client wrappers.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SyncProvider>
        <SyncGate>
          <div className="min-h-screen">{children}</div>
        </SyncGate>
      </SyncProvider>
    </AuthGuard>
  );
}
