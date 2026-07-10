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
// before the KDF + challenge-signing dance. Not authoritative — account creation
// still re-checks server-side to close the race.
export const checkUsernameEndpoint = defineEndpoint({
  method: 'GET',
  path: `${API_V1}/auth/username-available`,
  request: checkUsernameRequestSchema,
  response: checkUsernameResponseSchema,
});

// --- create account ---------------------------------------------------------

// Fixed-length lowercase-hex of `bytes` bytes — the wire form for binary material
// (see crypto/encoding.ts). Pins exact lengths so a malformed key/blob is a clean
// 400 at the contract boundary, not a crash deeper in.
const hexBytes = (bytes: number) =>
  z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`), `expected ${bytes}-byte lowercase hex`);

// The wrapped password door as it crosses the wire: the AES-256-GCM ciphertext+tag
// (a 32-byte DEK wraps to 48 bytes) and its 12-byte IV, hex-encoded. `doorType` is
// implied ('password') — it's the only door minted at create-account.
export const wirePasswordDoorSchema = z.object({
  wrappedDek: hexBytes(48),
  iv: hexBytes(12),
});

// The exact object the client signs to prove it holds the private key for the
// `publicKey` it's registering (see "the load-bearing sign-in check" in
// docs/account.md). `action` binds the signature to this operation so it can't be
// replayed as a sign-in; `timestamp` bounds replay; `passwordDoor` is the wrapped
// DEK the server persists, so the signature also covers what gets stored. The
// signature is verified over the EXACT JSON string of this object — hence it
// travels as a raw string (createAccountRequestSchema) and is parsed back with
// this schema server-side, never re-serialized.
export const createAccountPayloadSchema = z.object({
  action: z.literal('create-account'),
  username: usernameSchema,
  publicKey: hexBytes(32),
  passwordDoor: wirePasswordDoorSchema,
  timestamp: z.number().int(),
});
export type CreateAccountPayload = z.infer<typeof createAccountPayloadSchema>;

// POST body: the signed payload as a raw JSON STRING plus its Ed25519 signature.
// `payload` is a string (not a nested object) on purpose — the server must verify
// the signature over the same bytes the client signed, and re-serializing a parsed
// object could reorder keys and break verification.
export const createAccountRequestSchema = z.object({
  payload: z.string(),
  signature: hexBytes(64),
});
export type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;

// Only the raw bearer `token` (the capability the client authenticates with) and
// its `expiresAt` cross the wire. The session row's PK (`sessionId`) is
// server-internal — the auth guard resolves a session by hashing the token, and an
// authenticated logout revokes it without the client ever holding its id.
export const createAccountResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.number(),
});
export type CreateAccountResponse = z.infer<typeof createAccountResponseSchema>;

// POST /v1/auth/create-account → { token, expiresAt }
// Registers an account: verifies proof-of-possession, claims the username, stores
// the publicKey + wrapped DEK (password door), and returns a fresh session. The
// directory claim re-checks uniqueness server-side to close the type→submit race.
export const createAccountEndpoint = defineEndpoint({
  method: 'POST',
  path: `${API_V1}/auth/create-account`,
  request: createAccountRequestSchema,
  response: createAccountResponseSchema,
});

// --- sign in -----------------------------------------------------------------

// Step 1 of sign-in is a PRE-AUTH door fetch: the client names a username and
// gets back that account's password-door wrapped DEK, which it unwraps with
// Argon2id(password, salt) to recover the DEK and derive its keys. A wrong
// password fails on the GCM tag client-side — that IS the password check; nothing
// is compared here. Served before authentication because the client can't derive
// anything without the blob (it's the offline-attack oracle the entropy gate
// defends — see docs/account.md "why the wrapped DEK is served pre-auth").
export const passwordDoorRequestSchema = z.object({
  username: usernameSchema,
});
export type PasswordDoorRequest = z.infer<typeof passwordDoorRequestSchema>;

// The response is exactly the wrapped password door — same { wrappedDek, iv } wire
// shape the client sends UP at create-account, reused here for the round trip.
export type PasswordDoorResponse = z.infer<typeof wirePasswordDoorSchema>;

// GET /v1/auth/password-door?username=… → { wrappedDek, iv }
export const passwordDoorEndpoint = defineEndpoint({
  method: 'GET',
  path: `${API_V1}/auth/password-door`,
  request: passwordDoorRequestSchema,
  response: wirePasswordDoorSchema,
});

// Step 3: the signed proof the client POSTs to exchange for a session. Mirrors the
// create-account payload, but with `action: 'sign-in'` (so a create-account proof
// can't be replayed here, and vice versa) and NO passwordDoor — the door already
// exists server-side; this flow only proves possession of the DEK-derived key. The
// server verifies the signature over the EXACT JSON string, then checks
// `publicKey` against the STORED credential for the username (the load-bearing
// check — see docs/account.md "the two identifiers").
export const signInPayloadSchema = z.object({
  action: z.literal('sign-in'),
  username: usernameSchema,
  publicKey: hexBytes(32),
  timestamp: z.number().int(),
});
export type SignInPayload = z.infer<typeof signInPayloadSchema>;

// POST body: the signed payload as a raw JSON STRING plus its Ed25519 signature —
// a string (not a nested object) for the same reason as create-account: the server
// must verify the signature over the same bytes the client signed.
export const signInRequestSchema = z.object({
  payload: z.string(),
  signature: hexBytes(64),
});
export type SignInRequest = z.infer<typeof signInRequestSchema>;

export const signInResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.number(),
});
export type SignInResponse = z.infer<typeof signInResponseSchema>;

// POST /v1/auth/sign-in → { token, expiresAt }
// Verifies proof-of-possession, confirms the presented publicKey matches the
// stored credential for the username, and returns a fresh session.
export const signInEndpoint = defineEndpoint({
  method: 'POST',
  path: `${API_V1}/auth/sign-in`,
  request: signInRequestSchema,
  response: signInResponseSchema,
});

// --- sign out ---------------------------------------------------------------

// No request fields: the session to revoke is identified by the bearer token
// (the auth guard resolves it), so the body is empty. An object schema (rather
// than nothing) keeps the contract uniform — the client still sends `{}` as JSON.
export const signOutRequestSchema = z.object({});
export type SignOutRequest = z.infer<typeof signOutRequestSchema>;

export const signOutResponseSchema = z.object({
  ok: z.literal(true),
});
export type SignOutResponse = z.infer<typeof signOutResponseSchema>;

// POST /v1/auth/sign-out → { ok: true }
// Revokes the current session server-side (deletes its row, so the bearer token
// stops authenticating). Protected: requires the session's bearer token. The
// client also drops its local session regardless, so a network failure here
// still signs the user out locally — the row then ages out via TTL.
export const signOutEndpoint = defineEndpoint({
  method: 'POST',
  path: `${API_V1}/auth/sign-out`,
  request: signOutRequestSchema,
  response: signOutResponseSchema,
});

// --- delete account -----------------------------------------------------------

// The full account teardown: every synced object, every session, the doors
// (wrapped DEKs — the cryptographic kill), and the account row; the username is
// tombstoned (stays occupied), and the subscription must not be live (409). See
// docs/data-lifecycle.md.
//
// Guarded by a FRESH signed proof, not just the bearer token: this is the one
// action where "stolen session token = total, irreversible loss" is
// unacceptable, so the client must re-enter the password, unwrap the DEK, and
// sign — the same proof-of-possession machinery as sign-in, bound to its own
// `action` literal so neither a sign-in nor a create-account proof can be
// replayed here (and vice versa). The route ALSO requires the bearer token, and
// the server checks the proof resolves to the SAME account the session names —
// a signed proof for account A can never tear down account B.
export const deleteAccountPayloadSchema = z.object({
  action: z.literal('delete-account'),
  username: usernameSchema,
  publicKey: hexBytes(32),
  timestamp: z.number().int(),
});
export type DeleteAccountPayload = z.infer<typeof deleteAccountPayloadSchema>;

// POST body: the signed payload as a raw JSON STRING plus its Ed25519 signature —
// a string (not a nested object) for the same reason as create-account/sign-in:
// the server must verify the signature over the same bytes the client signed.
export const deleteAccountRequestSchema = z.object({
  payload: z.string(),
  signature: hexBytes(64),
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

export const deleteAccountResponseSchema = z.object({
  ok: z.literal(true),
});
export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;

// POST /v1/auth/delete-account → { ok: true }
// Refuses with 409 `subscription_active` while a subscription would keep
// billing (renewing, or in dunning) — the user cancels via the Paddle portal
// first. A canceled-but-still-entitled subscription does NOT block: the user
// already ended billing, and holding their deletion hostage until the period
// runs out would be hostile (the remaining paid time is forfeited — the client
// says so in its copy).
export const deleteAccountEndpoint = defineEndpoint({
  method: 'POST',
  path: `${API_V1}/auth/delete-account`,
  request: deleteAccountRequestSchema,
  response: deleteAccountResponseSchema,
});
