// Cross-platform key-derivation parameters. EVERY platform — web, extension,
// and the future Expo/native client — MUST derive with these exact values:
// they are the contract that makes one passphrase produce the same keys
// everywhere. Changing any of them re-derives every user's keys and locks them
// out of existing data, so they are frozen at launch.
//
// These live in `shared` (platform-agnostic) on purpose — the implementation
// is per-platform (web uses @stxapps/web-crypto), but the numbers must be one
// source of truth shared by all of them.

// PRE-LAUNCH: replace with a real high-entropy constant before the first real
// user. There is no server-side per-user salt (no-accounts model), so this
// hardcoded app salt is what stands between a weak passphrase and an offline
// dictionary attack. It can never change once users exist.
export const APP_SALT = 'brace_v2_global_salt_2026_x8f9a';

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
