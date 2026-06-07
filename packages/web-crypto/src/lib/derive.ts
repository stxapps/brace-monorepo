import * as ed25519 from '@noble/ed25519';

import {
  dekWrapAad,
  deriveUserSalt,
  DOOR_PASSWORD,
  type DoorType,
  HKDF_INFO_AUTH_SEED,
  HKDF_INFO_ENCRYPTION_KEY,
} from '@stxapps/shared';

import { decrypt, encrypt } from './aes';
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

// A wrapped copy of the DEK for one door, ready to persist server-side (an
// `account_keys` row). `wrappedDek` is the AES-256-GCM ciphertext+tag, `iv` its
// nonce; `doorType` selects which KEK unwraps it. The wrapped DEK is ciphertext,
// so it is safe to send and store (zero-knowledge — the server holds a locked box).
export interface WrappedDoor {
  doorType: DoorType;
  wrappedDek: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
}

// create-account result: the live keys PLUS the wrapped password door to send to
// the server. (Sign-in returns a bare Account — the door already exists.)
export interface NewAccount extends Account {
  passwordDoor: WrappedDoor;
}

// HKDF needs a salt; the DEK is already uniformly random, so an empty salt is the
// standard choice (RFC 5869 treats it as a string of zeros).
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

// The DEK is the real root of the account — 32 random bytes, never derived from
// anything. Both create-account (fresh DEK) and sign-in (DEK unwrapped from a
// door) funnel through here, so the derived keys are identical regardless of
// which door opened the DEK.
//
//   DEK --HKDF(auth-seed)------> Ed25519 keypair (publicKey + sign)
//       `--HKDF(encryption-key)-> AES-256-GCM key
//
// The DEK never leaves this module; only the public key / signatures cross the
// boundary.
async function deriveFromDek(dek: Uint8Array<ArrayBuffer>): Promise<Account> {
  const master = await crypto.subtle.importKey('raw', dek, 'HKDF', false, ['deriveBits']);

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

// The password door's KEK: Argon2id(password, per-user salt). It wraps/unwraps
// the DEK and is bound to (username, password) because the salt folds the
// username in (deriveUserSalt). Memory-hard because the password is low-entropy.
// Expensive (~1–3s) — runs Argon2id in a worker; the salt is computed by
// @stxapps/shared so every platform produces byte-identical KEKs.
async function derivePasswordKek(username: string, password: string): Promise<CryptoKey> {
  const salt = deriveUserSalt(username);
  const kekBytes = await deriveMasterSecret(password, salt);
  // Copy into an ArrayBuffer-backed view so Web Crypto accepts it as key material.
  return crypto.subtle.importKey('raw', new Uint8Array(kekBytes), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

// create-account. The root of the account is a fresh RANDOM DEK, wrapped under
// the password door; the DEK then derives the keypair and encryption key:
//
//   DEK          = crypto.getRandomValues(32)            (the real root)
//   password-KEK = Argon2id(password, salt)              (off-thread, in a worker)
//   passwordDoor = AES-256-GCM(password-KEK, DEK, aad = doorType)
//   DEK --HKDF--> Ed25519 keypair (publicKey + sign) + AES-256-GCM key
//
// Returns the live keys plus the wrapped password door to persist server-side
// (the `account_keys` row). The DEK and KEK never leave this module — only the
// public key / signatures and the (ciphertext) wrapped DEK cross the boundary.
// Later doors (recovery, passkey) wrap another copy of the SAME DEK; they're
// additive and never change what's derived here.
export async function createAccount(username: string, password: string): Promise<NewAccount> {
  const dek = crypto.getRandomValues(new Uint8Array(32));

  const kek = await derivePasswordKek(username, password);
  const { iv, ciphertext } = await encrypt(kek, dek, dekWrapAad(DOOR_PASSWORD));

  const account = await deriveFromDek(dek);

  return { ...account, passwordDoor: { doorType: DOOR_PASSWORD, wrappedDek: ciphertext, iv } };
}

// sign-in. Re-derive the password-KEK and AEAD-unwrap the fetched password-door
// blob to recover the DEK, then derive the same keys as create-account. A wrong
// password yields a wrong KEK and the GCM tag fails (decrypt throws) — that IS
// the password check; nothing is compared server-side. `door` is the
// `account_keys` row the server hands back (pre-auth) for this username.
export async function unlockAccount(
  username: string,
  password: string,
  door: { wrappedDek: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer> },
): Promise<Account> {
  const kek = await derivePasswordKek(username, password);

  let dek: Uint8Array;
  try {
    dek = await decrypt(
      kek,
      { iv: door.iv, ciphertext: door.wrappedDek },
      dekWrapAad(DOOR_PASSWORD),
    );
  } catch {
    // Wrong password (or a tampered/swapped blob) — the GCM tag failed. Don't
    // distinguish the cases to the caller.
    throw new Error('Incorrect username or password');
  }

  return deriveFromDek(new Uint8Array(dek));
}
