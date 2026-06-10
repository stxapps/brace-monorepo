'use client';

// The sync engine's crypto boundary (docs/local-first-sync.md "layer 2"): encrypt
// before a PUT, decrypt after a GET, so plaintext never crosses the network. Thin
// wrappers over @stxapps/web-crypto's AES-256-GCM that frame the blob for R2.

import { decrypt, encrypt, type EncryptedBlob } from '@stxapps/web-crypto';

// On-the-wire R2 blob layout: a 12-byte IV prefix followed by the ciphertext (the
// 128-bit GCM tag is already appended to the ciphertext by web-crypto). encrypt()
// mints a FRESH random IV per call, so it can't be derived — we store it beside
// the ciphertext and slice it back off on read.
const IV_BYTES = 12;

export function packBlob({ iv, ciphertext }: EncryptedBlob): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(IV_BYTES + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, IV_BYTES);
  return out;
}

export function unpackBlob(bytes: Uint8Array): EncryptedBlob {
  // Copy each slice into its own ArrayBuffer-backed view so the types line up with
  // web-crypto's `Uint8Array<ArrayBuffer>` and the IV/ciphertext don't alias the
  // source buffer.
  return {
    iv: new Uint8Array(bytes.subarray(0, IV_BYTES)),
    ciphertext: new Uint8Array(bytes.subarray(IV_BYTES)),
  };
}

// Decrypted entity bytes → one packed R2 blob, under the account data key.
export async function encryptEntity(
  key: CryptoKey,
  data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  return packBlob(await encrypt(key, new Uint8Array(data)));
}

// A packed R2 blob → decrypted entity bytes. Throws if the GCM tag fails (tamper
// or wrong key), which the caller treats as a failed download.
export async function decryptEntity(key: CryptoKey, blob: Uint8Array): Promise<Uint8Array> {
  return decrypt(key, unpackBlob(blob));
}
