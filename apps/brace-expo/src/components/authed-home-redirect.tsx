import { Redirect } from 'expo-router';

import { useAuth } from '@stxapps/expo-react';

// Authed visitors to the public landing ('/') belong in the app, so bounce them
// to /links — the same rule GuestGuard applies to /sign-in and /create-account.
// The expo sibling of brace-web's components/authed-home-redirect.tsx.
//
// Renders null in loading / unauthenticated, so the landing hero shows for guests
// with no flash; it only acts once AuthProvider has hydrated to 'authenticated'.
// No ?next= here: the root is never a return target, so /links is the only
// destination. Uses expo-router's declarative <Redirect> (navigate-on-mount) in
// place of web's render-phase redirect() throw — so an authed visitor sees the
// landing for a frame before the redirect lands (vs. web unmounting before
// commit), acceptable for the rare already-signed-in-hits-root case.
export function AuthedHomeRedirect() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Redirect href="/links" />;
  return null;
}
