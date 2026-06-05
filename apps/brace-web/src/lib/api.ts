import { createApiClient } from '@stxapps/shared';

// App-level binding of the shared typed client to brace-api's base URL.
// Set NEXT_PUBLIC_API_URL per environment.
// Call sites use the shared endpoint contracts: `api.call(checkUsernameEndpoint, …)`.
const baseUrl = process.env.NEXT_PUBLIC_API_URL;
if (!baseUrl) throw new Error('NEXT_PUBLIC_API_URL is not set');

export const api = createApiClient({ baseUrl });
