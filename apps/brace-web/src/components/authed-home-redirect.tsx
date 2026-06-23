'use client';

import { redirect } from 'next/navigation';

import { useAuth } from '@stxapps/web-react';

// Authed visitors to the public landing ('/') belong in the app, so bounce them
// to /links — the same rule GuestGuard applies to /sign-in and /create-account.
//
// Unlike GuestGuard this renders nothing in EVERY state (loading / unauthenticated
// / authenticated), so the statically prerendered landing hero paints immediately
// for guests with no null-flash and no loss of static prerender. It only acts once
// AuthProvider has hydrated and status is 'authenticated'. No ?next= here: the root
// is never a return target, so /links is the only destination.
export function AuthedHomeRedirect() {
  const { status } = useAuth();
  if (status === 'authenticated') redirect('/links');
  return null;
}
