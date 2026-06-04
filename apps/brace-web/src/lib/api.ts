import { createApiClient } from '@stxapps/shared';

// App-level binding of the shared typed client to brace-api's base URL. Set
// NEXT_PUBLIC_API_URL per environment; defaults to the local brace-api dev port.
// Call sites use the shared endpoint contracts: `api.call(checkUsernameEndpoint, …)`.
export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
});
