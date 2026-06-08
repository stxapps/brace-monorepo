import { createApiClient } from '@stxapps/shared';

import { getSession, getToken, notifySessionInvalid } from '../data/session-store';

// App-level binding of the shared typed client to brace-api's base URL.
// Set NEXT_PUBLIC_API_URL per environment.
// Call sites use the shared endpoint contracts: `api.call(checkUsernameEndpoint, …)`.
const baseUrl = process.env.NEXT_PUBLIC_API_URL;
if (!baseUrl) throw new Error('NEXT_PUBLIC_API_URL is not set');

// Attach the bearer token (when there's a live session) so protected endpoints
// authenticate. Reads the in-memory session synchronously — the auth provider
// hydrates it from IndexedDB on load — so there's no per-request IndexedDB hit.
// Public endpoints (username check, create-account, sign-in) simply ignore it.
//
// Also closes the mid-session expiry/revocation loop: if the server rejects an
// attached token (401), or a request is made while we still hold a session whose
// token has expired (getToken withholds it, getSession still has the record), we
// fire notifySessionInvalid so the auth provider can drop to signed-out. We only
// treat a token we actually sent as invalidating — a 401 on an unauthenticated
// request (e.g. a wrong-password sign-in) is the endpoint's own business.
const authFetch: typeof fetch = async (input, init) => {
  const token = getToken();
  if (!token) {
    // No usable token but a session record lingers ⇒ it expired mid-session.
    if (getSession()) notifySessionInvalid();
    return fetch(input, init);
  }

  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) notifySessionInvalid();
  return res;
};

export const api = createApiClient({ baseUrl, fetch: authFetch });
