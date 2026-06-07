// Cross-platform key-derivation parameters. EVERY platform — web, extension,
// and the future Expo/native client — MUST derive with these exact values:
// they are the contract that makes one password produce the same keys
// everywhere. Changing any of them re-derives every user's keys and locks them
// out of existing data, so they are frozen at launch.
//
// These live in `shared` (platform-agnostic) on purpose — the implementation
// is per-platform (web uses @stxapps/web-crypto), but the numbers must be one
// source of truth shared by all of them.

// App-wide domain separator folded into every per-user salt. The actual Argon2
// salt is per-user — SHA-256(APP_SALT || canonical username) — so two users who
// pick the same password still derive different keys (the unique username is the
// per-user salt). This constant defends against precomputed tables shared across
// apps/users, while the no-accounts model keeps everything recomputable on any
// client from (username, password) alone, with nothing salt-related stored
// server-side.
//
// NOT a secret — it ships in every client bundle; its only job is to be a
// stable, unique, high-entropy namespace, so it must NEVER CHANGE once real
// users exist (changing it re-derives every key and locks everyone out). The
// `brace.app-salt.v1.` prefix is a human-readable version namespace; the
// 256-bit base64url tail is the actual entropy (crypto.randomBytes(32)). To
// rotate in a hypothetical migration, mint a `.v2.` constant — never edit this.
export const APP_SALT = 'brace.app-salt.v1.AS0_1XNd72q_HoSAgW1Vs1e6-W389XTsi_Iy3udOoCw';

export const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 3,
  memorySize: 65536, // KiB = 64 MiB
  hashLength: 32, // 256-bit master secret
} as const;

// HKDF context labels — distinct `info` strings fork the single master secret
// into independent sub-keys (auth vs. encryption). Never reuse a label for two
// purposes, or the two keys collapse into one.
export const HKDF_INFO_AUTH_SEED = 'brace-auth-seed';
export const HKDF_INFO_ENCRYPTION_KEY = 'brace-encryption-key';

// Canonical form of a username, used BOTH as the per-user Argon2 salt input
// (see APP_SALT above) and for the server's case-insensitive UNIQUE handle.
// This is part of the frozen derivation contract: every platform must
// canonicalize identically and forever, or a user's keys won't reproduce and
// they're locked out of their data. NFKC collapses visually-identical Unicode
// forms; trim + lowercase mirror how the server stores the handle.
export const canonicalizeUsername = (username: string): string =>
  username.trim().normalize('NFKC').toLowerCase();
