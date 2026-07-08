import { base64ToBytes, bytesToBase64, utf8 } from '@stxapps/shared';

// Password VERIFIER for the device-local app/list locks: store salt+hash, check by
// re-deriving — the password itself is never persisted (the old client stored a
// reversibly-encrypted copy; a one-way hash is strictly better and the recovery
// path is identical: sign out, which wipes all locks).
//
// Deliberately PBKDF2, not the account's Argon2id: a lock gates ALREADY-DECRYPTED
// data sitting in IndexedDB one table over, so it's a shoulder-surfing deterrent,
// not encryption — a memory-hard KDF buys no real protection there, and unlocking
// a list should feel instant, not cost the sign-in's ~1–3s. PBKDF2-SHA256 is
// native Web Crypto (no worker), ~100–300ms at this iteration count.

export interface LockVerifier {
  // base64; random per verifier, so equal passwords produce unequal hashes.
  salt: string;
  // base64 PBKDF2-SHA256 output.
  hash: string;
}

// OWASP's current PBKDF2-SHA256 recommendation.
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

async function pbkdf2(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function createLockVerifier(password: string): Promise<LockVerifier> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt);
  return { salt: bytesToBase64(salt), hash: bytesToBase64(hash) };
}

export async function verifyLockPassword(
  password: string,
  verifier: LockVerifier,
): Promise<boolean> {
  const hash = await pbkdf2(password, base64ToBytes(verifier.salt));
  const expected = base64ToBytes(verifier.hash);
  if (hash.length !== expected.length) return false;
  // Constant-time compare — cheap to do properly even though a local-only
  // verifier has no realistic timing adversary.
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ expected[i];
  return diff === 0;
}
