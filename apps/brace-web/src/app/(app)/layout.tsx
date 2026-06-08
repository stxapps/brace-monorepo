import { AuthGuard } from '@/components/auth-guard';

// Guard for the signed-in app (/links, /settings, …). The gate is client-side
// (AuthGuard) because the session lives in IndexedDB, not a cookie — the server
// can't see it. This layout stays a server component and just wraps the subtree.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen">{children}</div>
    </AuthGuard>
  );
}
