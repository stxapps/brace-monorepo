export interface EncryptedBlob {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>; // includes the appended 128-bit GCM auth tag
}

// AES-256-GCM. A fresh random 96-bit IV per call — never reuse an IV with the
// same key. Web Crypto appends the auth tag to the ciphertext on encrypt and
// verifies it on decrypt (decrypt throws if the data was tampered with).
export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  );
  return { iv, ciphertext };
}

export async function decrypt(
  key: CryptoKey,
  { iv, ciphertext }: EncryptedBlob,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext),
  );
}
