'use client';

import { type ReactNode, Suspense } from 'react';
import { redirect, usePathname, useSearchParams } from 'next/navigation';

import { useAuth } from '../contexts/auth-provider';

// Client-side gate for the signed-in app. Auth is client-only — the bearer token
// and non-extractable encryptionKey live in IndexedDB (see session-store), never
// in a cookie — so the server (server components, middleware) can't see the
// session and can't gate. The gate therefore runs here, off `useAuth`.
//
// 'loading' (AuthProvider still hydrating) renders nothing, so an authed reload
// doesn't flash the signed-out UI before the session is read back. 'unauthenticated'
// redirects during render via next/navigation `redirect()` — which throws to unmount
// the subtree before it commits (outside Server Actions it defaults to replace, the
// history semantics we want). Redirecting in render rather than an effect means
// protected content never paints for a signed-out user, with no intermediate null
// frame or effect round-trip.
//
// Where we send a non-authenticated user depends on WHY they're here (auth `reason`):
// a deliberate 'signed-out' goes home to '/', since offering to return them to the
// page they just left would be silly. Everything else — an 'expired' session or a
// direct visit (reason null) — bounces to /sign-in with the full intended path
// (including any query string) stashed in `?next=`, so sign-in can return them there
// instead of dumping everyone on /links (GuestGuard reads the param).
//
// useSearchParams() opts this subtree out of static prerendering, so Next requires
// it under a Suspense boundary; the inner component holds the hook and AuthGuard
// supplies the boundary. The null fallback matches the 'loading' render below, so
// the gate shows nothing (never a signed-out flash) until the params resolve.
function InnerAuthGuard({ children }: { children: ReactNode }) {
  const { status, reason } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (status === 'loading') return null;
  if (status === 'unauthenticated') {
    if (reason === 'signed-out') redirect('/');
    const query = searchParams.toString();
    const next = query ? `${pathname}?${query}` : pathname;
    redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  }

  return children;
}

export function AuthGuard({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <InnerAuthGuard>{children}</InnerAuthGuard>
    </Suspense>
  );
}
