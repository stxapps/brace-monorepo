// On-demand favicons for the UI — the expo port of web-react's
// contexts/favicon-provider (that header is canonical: keyed BY HOST and why
// that's the whole point, fire-and-forget + mounting as the display signal,
// the fan-out bound, why every failure records `none`). One call:
//
//   requestFavicon(host) — "a mounted row is showing this host and has no icon".
//
// Platform divergences:
//
//  - THE FETCH IS DIRECT — `https://{host}/favicon.ico` by native fetch, no
//    extractor proxy. Web needs the proxy because a browser can't read
//    cross-origin image bytes; native HTTP has no CORS, and the design is
//    clients-do-the-work (docs/link-extraction.md — _favicons_, the brace-expo
//    row: direct native fetch; the `<link rel="icon">` upgrade rides page
//    extraction when that lands here).
//  - Validity is a byte sniff, not the proxy's content-type allowlist: only
//    bytes native Image can render get cached as `ok` (favicon-store's
//    sniffImageMime), so an HTML error page or an SVG records `none`.
//  - An `ok` icon lands as a plaintext file on disk, not bytes in the row
//    (favicon-store's split-storage header) — the UI renders its derived
//    `file://` uri, so this fetch is the ONE time the bytes cross the JS heap.
//  - STILL GATED ON THE ACCOUNT'S EXTRACTION OPT-IN (`serverExtraction`), and
//    the gate is load-bearing, not ceremony (the doc's expo note): for a link
//    saved on another device, a favicon fetch is a NEW disclosure of this
//    device's IP to that site, so it must not happen before the user opts into
//    network enrichment at all. `serverExtraction` is today's one modeled
//    extraction opt-in (the synced, off-by-default account preference); if a
//    distinct client-extraction opt-in ever lands for expo, the gate moves to
//    it — never to a favicon-specific setting.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import {
  isFaviconStale,
  putFavicon,
  putFaviconNone,
  readFavicon,
  sniffImageMime,
} from '../data/favicon-store';
import { useSettings } from '../hooks/use-settings';
import { useAuth } from './auth-provider';

// Favicons have no batch endpoint (one fetch per host), so the queue exists
// only to BOUND FAN-OUT — web's rationale, verbatim (there the cap protects
// the extractor's per-IP rate limit; here it keeps a scroll through distinct
// hosts from grabbing the radio with a burst of sockets).
const MAX_IN_FLIGHT = 4;

// A favicon is decoration: it must never compete with the link's own preview
// image (or a sync round trip) for the connection pool.
const STAGGER_MS = 60;

// One site not answering must not pin a queue slot — decoration again, so a
// short leash and the failure records `none` like every other miss.
const FETCH_TIMEOUT_MS = 10_000;

// A favicon is ~1–2 KB; anything past this is not an icon (a misconfigured
// server streaming a page/media at the guessed path). Checked after the body
// lands — RN fetch can't cheaply stream-abort — so this only bounds what gets
// CACHED, which is the part that persists.
const MAX_FAVICON_BYTES = 512 * 1024;

interface FaviconContextValue {
  // Ask for `host`'s favicon to be fetched and cached. Fire-and-forget: observe
  // the bytes reactively (useFaviconUri). Duplicate, in-flight, and
  // already-resolved hosts are no-ops.
  requestFavicon: (host: string) => void;
}

const FaviconContext = createContext<FaviconContextValue | null>(null);

// The direct fetch: bytes if the host serves a renderable icon at the guessed
// path, undefined otherwise. Throws only on transport errors — the caller
// records `none` for those too, so the split is cosmetic.
async function fetchFaviconBytes(host: string): Promise<Uint8Array | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${host}/favicon.ico`, { signal: controller.signal });
    if (!res.ok) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A zero-byte 200 is a "sure, whatever" response, not an icon (web's rule);
    // the sniff also rejects non-image bytes and the cap rejects non-icons.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FAVICON_BYTES) return undefined;
    if (sniffImageMime(bytes) === undefined) return undefined;
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

export function FaviconProvider({ children }: { children: ReactNode }) {
  const { username } = useAuth();
  const { serverExtraction } = useSettings();

  // No request leaves the device until the opt-in is on — see the header.
  const enabled = Boolean(username) && serverExtraction;

  // Latest identity for the async drain, so a fetch started before a render
  // never runs after the opt-in was switched off.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const queueRef = useRef<string[]>([]);
  // Queued or in flight — the single-flight guard. A host stays here after it
  // resolves: the row (`ok` or `none`) is the durable answer, so re-asking is
  // pointless, and the hook won't anyway once its live read sees the row.
  const handledRef = useRef(new Set<string>());
  const inFlightRef = useRef(0);

  // A different account's hosts mean nothing here — drop the session memory.
  // (The ROWS are dropped separately, by clearData on sign-out.)
  useEffect(() => {
    queueRef.current = [];
    handledRef.current.clear();
  }, [username]);

  const pump = useCallback(() => {
    while (inFlightRef.current < MAX_IN_FLIGHT && queueRef.current.length > 0) {
      const host = queueRef.current.shift();
      if (host === undefined) return;
      inFlightRef.current += 1;
      void (async () => {
        try {
          if (!enabledRef.current) {
            // Switched off mid-queue: forget the host so turning the opt-in
            // back on can re-ask, and write no row (a `none` here would be a
            // lie about the SITE rather than about our permission to look).
            handledRef.current.delete(host);
            return;
          }
          // Re-check under the single-flight guard: an earlier request may have
          // resolved this host since it was queued.
          const existing = await readFavicon(host);
          if (!isFaviconStale(existing)) return;

          const bytes = await fetchFaviconBytes(host);
          if (bytes === undefined) await putFaviconNone(host);
          else await putFavicon(host, bytes);
        } catch {
          // Every failure mode lands here alike — DNS, timeout, TLS, transport.
          // All record `none`: the icon is decoration, so there's no case where
          // retrying it on the next render is worth a request, and the row ages
          // out via FAVICON_RETRY_MS (web's rationale, verbatim).
          try {
            await putFaviconNone(host);
          } catch {
            // The write itself failed. Nothing to do — the row stays absent,
            // the row stays a monogram, and a later mount re-asks.
          }
        } finally {
          inFlightRef.current -= 1;
          if (queueRef.current.length > 0) setTimeout(pump, STAGGER_MS);
        }
      })();
    }
  }, []);

  // `enabled` is a dep (not just read off the ref) so flipping the opt-in
  // changes this callback's IDENTITY, which re-runs the mounted rows' request
  // effects and fills their icons in place — web's rationale, verbatim.
  const requestFavicon = useCallback(
    (host: string) => {
      if (!enabled || host === '') return;
      if (handledRef.current.has(host)) return;
      handledRef.current.add(host);
      queueRef.current.push(host);
      pump();
    },
    [enabled, pump],
  );

  const value = useMemo<FaviconContextValue>(() => ({ requestFavicon }), [requestFavicon]);

  return <FaviconContext.Provider value={value}>{children}</FaviconContext.Provider>;
}

export function useFavicon(): FaviconContextValue {
  const ctx = useContext(FaviconContext);
  if (!ctx) throw new Error('useFavicon must be used within <FaviconProvider>');
  return ctx;
}
