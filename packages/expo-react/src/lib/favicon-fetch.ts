// The favicon GUESS — `https://{host}/favicon.ico` by direct native fetch — plus
// the "are these bytes an icon?" verdict BOTH favicon fillers take.
//
// Transport only: no queue, no gate, no store write. The policy around this
// fetch (the fan-out bound, the stagger, the `deviceExtractionMode` gate, and
// the rule that every failure records `none`) stays in
// contexts/favicon-provider.tsx, which is the module that owns it.
//
//  - DIRECT, no extractor proxy. Web needs the proxy because a browser can't
//    read cross-origin image bytes; native HTTP has no CORS, and the design is
//    clients-do-the-work (docs/link-extraction.md — _favicons_, the brace-expo
//    row).
//  - Validity is a BYTE SNIFF, not the proxy's content-type allowlist: only
//    bytes native Image can render count, so an HTML error page or an SVG served
//    at the guessed path is a miss.
//
// Deliberately NOT in lib/device-extraction.ts, whose header draws the line this
// module sits on the other side of: that worker captures a `<link rel=icon>` as a
// byproduct of a page fetch it already paid for — "no disclosure the page fetch
// didn't already pay" — and it says plainly that this happens ONLY there, never
// as a standalone fetch. THIS is the standalone fetch: nothing on this device has
// contacted the host, which is why its caller keeps it behind the opt-in. Two
// different licences, two different modules; what they legitimately share is the
// verdict below and the User-Agent, both of which live lower down.

import { sniffImageMime } from './image';
import { USER_AGENT } from './user-agent';

// A favicon is ~1–2 KB; anything past this is not an icon (a misconfigured server
// streaming a page or media at the guessed path, or a `<link rel=icon>` pointing
// at a hero image). Checked AFTER the body lands — RN's fetch has no streaming
// reader, so this can't abort mid-transfer — so it only bounds what gets CACHED,
// which is the part that persists.
export const MAX_FAVICON_BYTES = 512 * 1024;

// One site not answering must not pin a queue slot — decoration, so a short leash;
// the caller records `none` like every other miss.
const FETCH_TIMEOUT_MS = 10_000;

// Are these bytes something we can actually put on a row? Shared by both fillers —
// the guess below and device-extraction's declared-icon capture — because it's the
// one part of the two paths that genuinely is the same question. Their fetches
// aren't (different URL, timeout, and failure policy), which is why only this
// moved.
export function isRenderableIconBytes(bytes: Uint8Array): boolean {
  // A zero-byte 200 is a "sure, whatever" response, not an icon (web's rule); the
  // cap rejects non-icons and the sniff rejects non-images.
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FAVICON_BYTES) return false;
  return sniffImageMime(bytes) !== undefined;
}

// Bytes if the host serves a renderable icon at the guessed path, undefined
// otherwise. Throws only on transport errors — the caller records `none` for
// those too, so the split is cosmetic.
export async function fetchFaviconBytes(host: string): Promise<Uint8Array | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${host}/favicon.ico`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return isRenderableIconBytes(bytes) ? bytes : undefined;
  } finally {
    clearTimeout(timer);
  }
}
