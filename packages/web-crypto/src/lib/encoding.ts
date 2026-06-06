// Returns an ArrayBuffer-backed view (not SharedArrayBuffer) so the result is
// accepted directly as a Web Crypto `BufferSource`.
export const utf8 = (s: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(new TextEncoder().encode(s));

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
