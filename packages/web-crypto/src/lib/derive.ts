import * as ed25519 from '@noble/ed25519';

import { HKDF_INFO_AUTH_SEED, HKDF_INFO_ENCRYPTION_KEY } from '@stxapps/shared';

import { deriveMasterSecret } from './argon2';
import { toHex, utf8 } from './encoding';

export interface Account {
  // Ed25519 public key (hex) — the credential the server verifies us by, not an
  // identifier (the server mints its own stable userId). Safe to send.
  publicKey: string;
  // AES-256-GCM key, non-extractable: usable for encrypt/decrypt but its raw
  // bytes can't be read back out of JS, so XSS can use it but not exfiltrate it.
  encryptionKey: CryptoKey;
  // Signs a payload with the Ed25519 private key. The key is captured in this
  // closure and never leaves the module — callers get signatures, not the key.
  sign: (payload: string) => Promise<string>;
}

// HKDF needs a salt; the master secret is already uniformly random, so an empty
// salt is the standard choice (RFC 5869 treats it as a string of zeros).
const HKDF_SALT = new Uint8Array(0);

async function hkdf(
  master: CryptoKey,
  info: string,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: utf8(info) },
    master,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

// Step 2 of account creation: (username, password) → keys. Expensive (runs
// Argon2id in a worker); call it once, then reuse the returned material for the
// session. The username is the per-user salt (see deriveMasterSecret), so the
// same password under a different username yields entirely different keys.
//
//   password --Argon2id(salt=username)--> master secret
//                              |--HKDF(auth-seed)------> Ed25519 keypair (publicKey + sign)
//                              `--HKDF(encryption-key)-> AES-256-GCM key
export async function deriveAccount(password: string, username: string): Promise<Account> {
  const masterSecret = await deriveMasterSecret(password, username);

  // Copy into an ArrayBuffer-backed view so Web Crypto accepts it as key material.
  const master = await crypto.subtle.importKey('raw', new Uint8Array(masterSecret), 'HKDF', false, [
    'deriveBits',
  ]);

  const authSeed = await hkdf(master, HKDF_INFO_AUTH_SEED, 32);
  const encryptionKeyBytes = await hkdf(master, HKDF_INFO_ENCRYPTION_KEY, 32);

  const publicKeyBytes = await ed25519.getPublicKeyAsync(authSeed);

  const encryptionKey = await crypto.subtle.importKey(
    'raw',
    encryptionKeyBytes,
    { name: 'AES-GCM' },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );

  return {
    publicKey: toHex(publicKeyBytes),
    encryptionKey,
    sign: async (payload: string) => toHex(await ed25519.signAsync(utf8(payload), authSeed)),
  };
}
