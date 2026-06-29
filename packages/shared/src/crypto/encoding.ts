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

// base64 ⇄ bytes: how binary that isn't crypto material (a preview image) crosses
// JSON — the extractor inlines image bytes as base64, clients decode them back.
// `atob`/`btoa` are referenced only inside the function bodies (like the hex pair),
// so merely importing `shared` never assumes those globals exist.
//
// Runtime requirement — native `atob`/`btoa` exist on Workers, browsers, and the
// extension, but Hermes (React Native/Expo) does NOT provide them. These two
// functions throw `ReferenceError` there unless the app installs a base64 polyfill
// at startup (e.g. `base-64` wired through `polyfillGlobal`). We keep the native
// calls deliberately: they're C++-fast (these carry multi-hundred-KB images) and
// battle-tested on base64's fiddly padding/tail cases, so the one-line app-level
// polyfill on the single deficient runtime beats hand-rolling base64 in JS for all
// four. The polyfill is an app-bootstrap concern, not a `shared` one — this layer
// stays pure and global-free by design.
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Chunked through String.fromCharCode so a multi-hundred-KB image doesn't blow the
// argument-spread stack limit.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// One encoder reused across calls: TextEncoder is stateless and `.encode()` is
// synchronous, so a singleton is safe and avoids per-call alloc. Created lazily
// on first use (not at module load) so merely importing `shared` never assumes a
// `TextEncoder` global — some test environments only define it once running.
let encoder: InstanceType<typeof TextEncoder> | undefined;

// Returns an ArrayBuffer-backed view (not SharedArrayBuffer) so the result is
// accepted directly as a Web Crypto `BufferSource`.
export const utf8 = (s: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array((encoder ??= new TextEncoder()).encode(s));
