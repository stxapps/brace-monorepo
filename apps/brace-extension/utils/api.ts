import { createApiClient } from '@stxapps/shared';
import { getSession, getToken, notifySessionInvalid } from '@stxapps/web-react';

// The extension's binding of the shared typed client to brace-api's base URL — the
// counterpart of brace-web's `lib/api.ts`, but the base URL comes from the BUILD
// MODE (`import.meta.env.MODE`, set by wxt) instead of `NEXT_PUBLIC_API_URL`. This
// mirrors wxt.config.ts's `apiHost` host-permission so the origin the client talks
// to is always one the manifest granted (and thus CORS-exempt for the background
// worker's fetches).
//
// One client serves both contexts — the popup React tree (via ApiClientProvider)
// AND the background service worker (which builds the sync `SyncDeps.api` from it).
// Both read the same in-memory session mirror: the popup's AuthProvider hydrates it
// on mount, the worker hydrates it with loadSession() before each cycle.
const API_URL =
  import.meta.env.MODE === 'production'
    ? 'https://api.brace.to'
    : import.meta.env.MODE === 'staging'
      ? 'https://api.staging.brace.to'
      : 'http://localhost:8787';

// Attach the bearer token (when there's a live session) so protected endpoints
// authenticate — identical contract to brace-web's authFetch: a token we actually
// sent that earns a 401 (or a request made while a session record lingers past its
// token's expiry) fires notifySessionInvalid, so the auth provider can drop to
// signed-out. Public endpoints (sign-in, create-account) simply ignore a missing one.
const authFetch: typeof fetch = async (input, init) => {
  const token = getToken();
  if (!token) {
    if (getSession()) notifySessionInvalid();
    return fetch(input, init);
  }

  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) notifySessionInvalid();
  return res;
};

export const api = createApiClient({ baseUrl: API_URL, fetch: authFetch });
