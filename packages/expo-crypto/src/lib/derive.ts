import { hkdfSync, randomBytes } from 'react-native-quick-crypto';
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';

import {
  bytesToHex,
  dekWrapAad,
  deriveUserSalt,
  DOOR_PASSWORD,
  type DoorType,
  HKDF_INFO_AUTH_SEED,
  HKDF_INFO_ENCRYPTION_KEY,
  utf8,
} from '@stxapps/shared';

import { decrypt, encrypt } from './aes';
import { deriveArgon2Hash } from './argon2';

// The Expo sibling of web-crypto's derive.ts: the SAME derivation pipeline
// (docs/account.md), same @noble/ed25519 library, same frozen parameters from
// @stxapps/shared — only the platform primitives differ (quick-crypto HKDF /
// AES-GCM instead of Web Crypto). The contract-vector spec pins both platforms
// to identical bytes.
//
// @noble/ed25519 hashes with SHA-512 internally; on web it finds
// crypto.subtle, but React Native has no Web Crypto, so wire the pure-JS
// sha512 once at module load (the library's documented RN setup). This also
// unlocks the sync sign/getPublicKey paths used below.
// (The cast bridges @noble/hashes v1's `Uint8Array<ArrayBufferLike>` return to
// ed25519 v3's `Uint8Array<ArrayBuffer>` slot — sha512 always allocates a
// plain ArrayBuffer.)
ed25519.hashes.sha512 = (message: Uint8Array) => sha512(message) as Uint8Array<ArrayBuffer>;

export interface Account {
  // Ed25519 public key (hex) — the credential the server verifies us by, not an
  // identifier (the server mints its own stable userId). Safe to send.
  publicKey: string;
  // Raw AES-256-GCM key bytes. Unlike web (a non-extractable CryptoKey), native
  // has no unreadable key handle — at-rest protection is expo-secure-store's
  // job (Keychain / Android Keystore); in memory the bytes live here and feed
  // aes.ts and the BraceFileCrypto native module.
  encryptionKey: Uint8Array;
  // Signs a payload with the Ed25519 private key. The key is captured in this
  // closure and never leaves the module — callers get signatures, not the key.
  sign: (payload: string) => Promise<string>;
}

// One door's persisted record (an `account_keys` row) — see web-crypto's Door.
export interface Door {
  doorType: DoorType;
  wrappedDek: Uint8Array;
  iv: Uint8Array;
}

// create-account result: the live keys PLUS the wrapped password door to send to
// the server. (Sign-in returns a bare Account — the door already exists.)
export interface NewAccount extends Account {
  passwordDoor: Door;
}

// The credential miss from unlockAccount: the GCM tag failed, meaning a wrong
// password — or a tampered/swapped blob, deliberately indistinguishable. Same
// contract as web-crypto's WrongPasswordError.
export class WrongPasswordError extends Error {}

// HKDF needs a salt; the DEK is already uniformly random, so an empty salt is the
// standard choice (RFC 5869 treats it as a string of zeros).
const HKDF_SALT = new Uint8Array(0);

function hkdf(master: Uint8Array, info: string, bytes: number): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', master, HKDF_SALT, utf8(info), bytes));
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
function deriveFromDek(dek: Uint8Array): Account {
  const authSeed = hkdf(dek, HKDF_INFO_AUTH_SEED, 32);
  const encryptionKey = hkdf(dek, HKDF_INFO_ENCRYPTION_KEY, 32);

  const publicKeyBytes = ed25519.getPublicKey(authSeed);

  return {
    publicKey: bytesToHex(publicKeyBytes),
    encryptionKey,
    sign: async (payload: string) => bytesToHex(ed25519.sign(utf8(payload), authSeed)),
  };
}

// The password door's KEK: Argon2id(password, per-user salt) — see web-crypto's
// derivePasswordKek. The salt is computed by @stxapps/shared so every platform
// produces byte-identical KEKs; the ~1–3s Argon2id runs native (argon2.ts).
async function derivePasswordKek(username: string, password: string): Promise<Uint8Array> {
  const salt = deriveUserSalt(username);
  return deriveArgon2Hash(password, salt);
}

// create-account — the same flow as web-crypto's createAccount:
//
//   DEK          = randomBytes(32)                        (the real root)
//   password-KEK = Argon2id(password, salt)               (native, off the JS thread)
//   passwordDoor = AES-256-GCM(password-KEK, DEK, aad = doorType)
//   DEK --HKDF--> Ed25519 keypair (publicKey + sign) + AES-256-GCM key
export async function createAccount(username: string, password: string): Promise<NewAccount> {
  const dek = new Uint8Array(randomBytes(32));

  const kek = await derivePasswordKek(username, password);
  const { iv, ciphertext } = await encrypt(kek, dek, dekWrapAad(DOOR_PASSWORD));

  const account = deriveFromDek(dek);

  return { ...account, passwordDoor: { doorType: DOOR_PASSWORD, wrappedDek: ciphertext, iv } };
}

// sign-in — the same flow as web-crypto's unlockAccount: re-derive the
// password-KEK and AEAD-unwrap the fetched password-door blob to recover the
// DEK. A wrong password yields a wrong KEK and the GCM tag fails — that IS the
// password check; nothing is compared server-side.
export async function unlockAccount(
  username: string,
  password: string,
  door: { wrappedDek: Uint8Array; iv: Uint8Array },
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
    // distinguish the cases to the caller. Only THIS throw is the credential
    // miss; a derivePasswordKek failure above propagates raw.
    throw new WrongPasswordError('Incorrect username or password');
  }

  return deriveFromDek(dek);
}
