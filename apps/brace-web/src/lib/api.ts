import { createApiClient } from '@stxapps/shared';

import { getToken } from '../data/session-store';

// App-level binding of the shared typed client to brace-api's base URL.
// Set NEXT_PUBLIC_API_URL per environment.
// Call sites use the shared endpoint contracts: `api.call(checkUsernameEndpoint, …)`.
const baseUrl = process.env.NEXT_PUBLIC_API_URL;
if (!baseUrl) throw new Error('NEXT_PUBLIC_API_URL is not set');

// Attach the bearer token (when there's a live session) so protected endpoints
// authenticate. Reads the in-memory session synchronously — the auth provider
// hydrates it from IndexedDB on load — so there's no per-request IndexedDB hit.
// Public endpoints (username check, create-account, sign-in) simply ignore it.
const authFetch: typeof fetch = (input, init) => {
  const token = getToken();
  if (!token) return fetch(input, init);

  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

export const api = createApiClient({ baseUrl, fetch: authFetch });
