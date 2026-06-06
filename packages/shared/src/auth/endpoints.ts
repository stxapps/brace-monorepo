import { z } from 'zod';

import { API_V1, defineEndpoint } from '../api/endpoint';
import { usernameSchema } from './credentials';

// Auth endpoint contracts. Request schemas reuse the pure validators from
// ./credentials so the field rules (length, charset) are defined exactly once
// and enforced identically on the client form and the server.

export const checkUsernameRequestSchema = z.object({
  username: usernameSchema,
});
export type CheckUsernameRequest = z.infer<typeof checkUsernameRequestSchema>;

export const checkUsernameResponseSchema = z.object({
  available: z.boolean(),
});
export type CheckUsernameResponse = z.infer<typeof checkUsernameResponseSchema>;

// GET /v1/auth/username-available?username=… → { available }
// Cheap pre-submit check so the create-account form can flag a taken username
// before the (future) KDF + challenge-signing dance. Not authoritative — account
// creation still re-checks server-side to close the race.
export const checkUsernameEndpoint = defineEndpoint({
  method: 'GET',
  path: `${API_V1}/auth/username-available`,
  request: checkUsernameRequestSchema,
  response: checkUsernameResponseSchema,
});
