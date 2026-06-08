'use client';

import { type ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { useAuth } from '../contexts/auth-provider';

// Mirror of AuthGuard for the guest-only auth routes (/sign-in, /create-account):
// an authenticated visitor has no business here, so bounce them to the app. This
// is what redirects after account creation / sign-in — onSuccess just calls
// setSession, status flips to 'authenticated', this re-renders and redirects — so
// the navigation lives in the routing layer, not the mutation. It also covers an
// already-signed-in user landing on an auth URL directly.
//
// 'loading' (AuthProvider still hydrating) renders nothing, so we don't flash the
// sign-in form at someone who's about to be bounced. Render-phase redirect()
// throws to unmount before commit (defaults to replace outside Server Actions).
export function GuestGuard({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') return null;
  if (status === 'authenticated') redirect('/links');

  return children;
}
