'use client';

import { type ReactNode } from 'react';
import { redirect } from 'next/navigation';

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
export function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') return null;
  if (status === 'unauthenticated') redirect('/sign-in');

  return children;
}
