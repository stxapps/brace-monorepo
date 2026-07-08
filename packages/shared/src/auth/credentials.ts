import { z } from 'zod';

// Credential validation shared by every consumer: the web/extension forms
// (client-side UX) and brace-api (server-side gate). Keep this schema PURE and
// synchronous — no network, no DB. Async concerns like username uniqueness live
// in the submit handler, not here, so this stays reusable on the server.

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Use only letters, numbers, and underscores');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

// Lock passwords (the device-local app/list locks) are a convenience gate over
// already-decrypted local data, not the account credential — so no minimum-length
// policy, just non-empty and the same ceiling as the account password. Kept here
// with the other credential rules so every client validates identically.
export const lockPasswordSchema = z
  .string()
  .min(1, 'Please enter a password')
  .max(128, 'Password must be at most 128 characters');

export const signInSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const createAccountSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export type SignInValues = z.infer<typeof signInSchema>;
export type CreateAccountValues = z.infer<typeof createAccountSchema>;
