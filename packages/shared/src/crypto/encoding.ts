// Byte encodings shared across every platform and the wire. Pure and
// platform-agnostic, so they live in `shared` (the lowest layer): the web crypto
// module, the future native client, and the server all need the same conversions
// and must agree on the exact form.
//
// - hex ⇄ bytes: how binary material (a wrapped DEK, a public key, a signature)
//   crosses a JSON request — lowercase, zero-padded, two chars per byte.
// - utf8: text → bytes for crypto inputs (signing payloads, HKDF/AEAD labels).

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const len = hex.length / 2;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// Returns an ArrayBuffer-backed view (not SharedArrayBuffer) so the result is
// accepted directly as a Web Crypto `BufferSource`.
export const utf8 = (s: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(new TextEncoder().encode(s));
