// The favicon cache's read/write helpers — the expo sibling of web-react's
// data/favicon-store.ts (that header is canonical: the per-HOST store, the
// `none` retry TTL rationale, why `ok` rows never expire). Single-responsibility
// like the other stores; the fetch that FILLS it lives in favicon-provider.tsx,
// and the read half the UI observes is use-favicon-uri.ts.
//
// SPLIT STORAGE, unlike web's bytes-in-the-row: the sqlite row keeps only the
// VERDICT (`ok`/`none` + fetchedAt — the `none` half can't be a file, and
// staleness lives with it), while an `ok` icon's bytes live as a plaintext
// file on disk, `file-store.ts`-style. That's for the render path: rows are
// FlashList-recycled, so a scroll through thousands of links (re)mounts icons
// constantly, and a derived `file://` uri costs nothing per mount — where row
// bytes would cost a BLOB read + a base64 data uri re-encoded and shipped to
// native (and cached under that multi-KB string as its key) every time. The
// fetch still passes bytes through JS once per host — the sniff below needs
// them before anything is cached — which is the cheap side of that trade.
//
// Crash consistency, the loadEntityContent ordering transposed: putFavicon
// writes the FILE first, the row last, and readFavicon treats an `ok` row
// whose file is missing as unresolved — so a half-written pair reads as "never
// fetched" (→ re-fetch), never as a broken icon. Locations are DERIVED from
// the host, never persisted (file-store.ts: iOS moves the app container).

import { eq } from 'drizzle-orm';
import { Directory, File, Paths } from 'expo-file-system';

import { favicons, getDb } from './db';

export type FaviconRecord = typeof favicons.$inferSelect;

// How long a `none` row (no reachable favicon) stands before another attempt is
// allowed — web favicon-store's value and rationale, verbatim.
export const FAVICON_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

// Icons live beside (not inside) the `files/` content dir — different
// lifecycle owners: brace-files is the sync engine's materialization,
// this is the favicon cache's. Same document-storage choice (survives
// relaunches; the cache dir's OS purge would silently break the rows'
// "already fetched" bookkeeping).
const FAVICON_FILES_DIR = 'brace-favicons';

function faviconFilesDir(): Directory {
  return new Directory(Paths.document, FAVICON_FILES_DIR);
}

// The on-disk location for a host's icon. Hosts are near-filename-safe
// already; encodeURIComponent keeps the mapping bijective for the rest (a
// port's `:`, any odd unicode) — the file-store separator-encoding move.
export function faviconFileFor(host: string): File {
  return new File(faviconFilesDir(), encodeURIComponent(host));
}

// One host's cached row, or undefined if this host was never resolved (an
// exact primary-key get — no scan). An `ok` row whose file is gone (crash
// between the file write and the row write can't cause this — the row lands
// last — but an OS-level loss can) reads as unresolved, so the provider
// re-fetches instead of the UI trusting a verdict with no bytes behind it.
export async function readFavicon(host: string): Promise<FaviconRecord | undefined> {
  const row = getDb().select().from(favicons).where(eq(favicons.host, host)).get();
  if (row?.status === 'ok' && !faviconFileFor(host).exists) return undefined;
  return row;
}

// Is there nothing usable for this host right now? True when the host is
// unknown, or when its `none` verdict has aged past FAVICON_RETRY_MS. The
// provider's fetch gate and the hook's request trigger share this so they can't
// disagree about what counts as a miss.
export function isFaviconStale(record: FaviconRecord | undefined, now = Date.now()): boolean {
  if (!record) return true;
  if (record.status === 'ok') return false;
  return now - record.fetchedAt >= FAVICON_RETRY_MS;
}

// File first, row last — see the header's crash-consistency note.
export async function putFavicon(host: string, bytes: Uint8Array): Promise<void> {
  const dir = faviconFilesDir();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  faviconFileFor(host).write(bytes);
  const row = { host, status: 'ok' as const, fetchedAt: Date.now() };
  getDb().insert(favicons).values(row).onConflictDoUpdate({ target: favicons.host, set: row }).run();
}

// Record "this host has no reachable favicon" so a relaunch doesn't re-buy the
// fetch. Drops any previous icon file so the pair can't disagree.
export async function putFaviconNone(host: string): Promise<void> {
  const file = faviconFileFor(host);
  if (file.exists) file.delete();
  const row = { host, status: 'none' as const, fetchedAt: Date.now() };
  getDb().insert(favicons).values(row).onConflictDoUpdate({ target: favicons.host, set: row }).run();
}

// Remove every cached icon file — the file-system half of the `favicons` table
// wipe (clear-data, delete-all-data), mirroring clearDataFiles: tables first,
// so a crash in between leaves orphan files no row points at, invisible to the
// app and removed by the next wipe or overwrite.
export function clearFaviconFiles(): void {
  const dir = faviconFilesDir();
  if (dir.exists) dir.delete();
}

// The formats RN's native decoders render (iOS ImageIO / Android Fresco both
// cover ICO), identified by magic bytes — the provider's "is this a renderable
// icon?" verdict before anything is cached, so an HTML error page or an SVG
// (text, no magic, and native Image can't render it) records `none` instead of
// an unrenderable file. The RENDER path never needs the mime: native sniffs
// the file bytes itself; returning it (vs. a boolean) just keeps the check
// self-documenting.
export function sniffImageMime(b: Uint8Array): string | undefined {
  if (b.length < 12) return undefined;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return undefined;
}
