import { z } from 'zod';

import { canonicalizeUsername } from '../crypto/params';

// Credential validation shared by every consumer: the web/extension forms
// (client-side UX) and brace-api (server-side gate). Keep this schema PURE and
// synchronous — no network, no DB. Async concerns like username uniqueness live
// in the submit handler, not here, so this stays reusable on the server.

// Handles nobody may register — system/role words and brand names, so no account
// can impersonate the product or a privileged function. Because `usernameSchema`
// backs every auth endpoint's payload (endpoints.ts), the block is enforced on the
// SERVER too, not just the form. Match is against the CANONICAL username
// (canonicalizeUsername → trim + NFKC + lowercase — the exact form the server
// stores as the unique handle), so casing/Unicode variants ("Admin", "ADMIN") all
// collapse to one lowercase entry and can't slip through. Exact-match only (not
// substring), so "admin123" stays allowed. Every entry is charset-valid
// ([a-z0-9_], ≥3 chars) — the regex already rejects anything the set couldn't hit.
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  // system / infrastructure
  'admin', 'administrator', 'root', 'sysadmin', 'superuser', 'system',
  'api', 'app', 'www', 'mail', 'email', 'ftp', 'smtp', 'dns',
  'postmaster', 'webmaster', 'hostmaster', 'noreply', 'no_reply',
  // roles / org contacts
  'support', 'help', 'helpdesk', 'contact', 'info', 'sales', 'billing',
  'abuse', 'security', 'privacy', 'legal', 'staff', 'team', 'official',
  'mod', 'moderator',
  // brand
  'brace', 'braceapp', 'braceto', 'stxapps',
  // placeholders / ambiguous
  'null', 'undefined', 'none', 'anonymous', 'anon', 'guest', 'you', 'everyone',
]);

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Use only letters, numbers, and underscores')
  .refine((u) => !RESERVED_USERNAMES.has(canonicalizeUsername(u)), {
    message: 'This username is reserved',
  });

// SIGN-IN password schema — deliberately PERMISSIVE. Length here is NOT a security
// control (the real check is the door's GCM tag failing to unwrap); this only
// pre-filters obviously-empty input before an expensive Argon2id. It must never be
// raised above the shortest creatable password, or it locks valid accounts out of
// an account that has NO reset. Tighten `newPasswordSchema` below, never this.
//
// `.trim()` first so the length gate measures the TRIMMED password — the same
// thing the derivation actually consumes (canonicalizePassword trims too). Without
// it, "       " (8 spaces) would pass min(8) yet derive from the empty string.
// Full canonicalization (NFC) stays at the derivation boundary; here we only need
// the trimmed length. Passwords are case/space-sensitive otherwise — no lowercase.
export const passwordSchema = z
  .string()
  .trim()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

// The policy floor for CREATING or CHANGING a password (the typed-your-own path).
// A hard length floor is defense-in-depth BEHIND the zxcvbn strength gate — zxcvbn
// is a heuristic that can be fooled, but length it can't be tricked past — and this
// system's threat model is harsh (the wrapped door is served pre-auth = an offline
// brute-force surface, and there is no reset). The UX cost is ~nil: the default is
// the generated ~77-bit passphrase, so this only bites users who insist on typing
// their own. Kept SEPARATE from passwordSchema so sign-in never inherits this floor
// (see above). The strength meter clamps to sub-passing below this same length, so
// the meter and this gate stay one consistent signal (usePasswordStrength).
export const NEW_PASSWORD_MIN_LENGTH = 12;

export const newPasswordSchema = z
  .string()
  .trim()
  .min(NEW_PASSWORD_MIN_LENGTH, `Password must be at least ${NEW_PASSWORD_MIN_LENGTH} characters`)
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
  password: newPasswordSchema,
});

export type SignInValues = z.infer<typeof signInSchema>;
export type CreateAccountValues = z.infer<typeof createAccountSchema>;
