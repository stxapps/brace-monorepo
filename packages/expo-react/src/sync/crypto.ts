// The sync engine's crypto boundary — the expo sibling of web-react's
// sync/crypto.ts (see there for the frame's full rationale): encrypt before a
// PUT, decrypt after a GET, so plaintext never crosses the network. Thin
// wrappers over @stxapps/expo-crypto's AES-256-GCM that pack/unpack the same
// frozen v1 blob frame.
//
// SMALL ENTITY BLOBS ONLY (links/tags/lists/pins/extractions/settings — KB-sized
// JSON that lives in the sqlite `data` column). Whole `files/` CONTENT never
// crosses this module: BraceFileCrypto reads/writes the identical frame natively
// path-to-path (expo-crypto file-crypto.ts), so file bytes never enter the JS
// heap — one wire format, produced on whichever side of the JSI boundary suits
// the payload size.

import { decrypt, encrypt, type EncryptedBlob } from '@stxapps/expo-crypto';
import { AES_GCM_IV_BYTES, BLOB_FORMAT_V1 } from '@stxapps/shared';

// On-the-wire R2 blob layout: `[version(1) || iv(12) || ciphertext+tag]` (the
// 128-bit GCM tag is already appended to the ciphertext by expo-crypto's aes).
// The constants are the cross-platform contract in @stxapps/shared — every
// platform must pack/unpack identically, forever. encrypt() mints a FRESH random
// IV per call, so it can't be derived — we store it beside the ciphertext and
// slice it back off on read. The version byte is format-change insurance: a
// future layout becomes a new constant and a new unpack branch, decoded side by
// side with v1, instead of a big-bang re-encrypt migration.
const HEADER_BYTES = 1 + AES_GCM_IV_BYTES;

export function packBlob({ iv, ciphertext }: EncryptedBlob): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(HEADER_BYTES + ciphertext.length);
  out[0] = BLOB_FORMAT_V1;
  out.set(iv, 1);
  out.set(ciphertext, HEADER_BYTES);
  return out;
}

export function unpackBlob(bytes: Uint8Array): EncryptedBlob {
  // Reject unknown versions loudly — a wrong slice would otherwise feed garbage
  // to GCM and surface as a misleading "tampered" error. Seeing this means a
  // newer client wrote a format this build doesn't know.
  if (bytes[0] !== BLOB_FORMAT_V1) {
    throw new Error(`Unknown blob format version: ${bytes[0]}`);
  }
  // Copy each slice into its own buffer so the IV/ciphertext don't alias the
  // source (same defensive copy as web — quick-crypto hands views straight to
  // native, so aliasing surprises are cheap to rule out here).
  return {
    iv: new Uint8Array(bytes.subarray(1, HEADER_BYTES)),
    ciphertext: new Uint8Array(bytes.subarray(HEADER_BYTES)),
  };
}

// Decrypted entity bytes → one packed R2 blob, under the account data key (raw
// 32-byte Uint8Array — native's stand-in for web's non-extractable CryptoKey).
export async function encryptEntity(
  key: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  return packBlob(await encrypt(key, new Uint8Array(data)));
}

// A packed R2 blob → decrypted entity bytes. Throws if the GCM tag fails (tamper
// or wrong key), which the caller treats as a failed download.
export async function decryptEntity(key: Uint8Array, blob: Uint8Array): Promise<Uint8Array> {
  return decrypt(key, unpackBlob(blob));
}
