import {
  ApiError,
  base64ToBytes,
  cleanTitle,
  type ExtractClient,
  type ExtractError,
  type ExtractResult,
  type Facet,
  idFromPath,
  LINKS_PREFIX,
} from '@stxapps/shared';
import { newId } from '@stxapps/web-crypto';

import {
  type ExtractionFields,
  type ExtractionPatch,
  writeExtraction,
  writeFile,
} from '../data/mutations';
import { type LinkItem } from '../data/queries';
import { resizeImage } from './resize-image';

// The SERVER-tier extraction worker: enrich a PAGE of links' `titleImage` facet via
// `brace-extractor`, then write back — each (resized) image into `files/`, the
// title/imageId display fields + the facet's done/failed bookkeeping into
// `extractions/{id}.enc`. The shared counterpart of the extension's `runExtraction`
// (apps/brace-extension), but driven by an HTTP extract instead of an active-tab
// capture, so its `extractedBy` is `server` (the lowest tier — `tierOf` → 1) and a
// later active-page sighting can UPGRADE it.
//
// BATCHED for latency (docs/link-extraction.md "server extraction"): one `extractMany`
// returns every link's title + imageUrl in ~one round trip — the server resolves the
// URLs CONCURRENTLY — instead of N sequential single-URL calls. We then write TITLES
// FIRST (the page fills with real titles immediately) and fill IMAGES after, through the
// streaming proxy at a small concurrency. A single link short-circuits to the inline
// single-URL path (one round trip, no proxy) — the human-waiting save.
//
// Like the extension worker it writes ONLY `extractions/` + `files/`, NEVER
// `links/{id}.enc` (the writer-split — docs/link-extraction.md), so a backfill can't
// clobber a concurrent user edit. It only ever does `titleImage`: the server tier can't
// screenshot/archive (no renderer) and read-mode parity isn't promised, so those facets
// stay active-context only.
//
// NEVER throws: every outcome (success, transient failure, permanent failure) is RECORDED
// as a facet write, so the caller's drain loop always makes progress — a processed link
// becomes settled (`done`, or `failed`/`permanent` which the pending query then skips via
// backoff) and is never re-picked on the next scan.
const EXTRACTED_BY = 'server';

// How many image-proxy fetches run at once during a batch's image pass. The extract call
// is ONE request (the server fans out), but each discovered image is its own streaming
// GET /v1/image against the same IP-rate-limited origin — so we pool them at a small
// width rather than firing one per link: fast enough to fill a page quickly, gentle
// enough not to trip the limiter into 429s.
const IMAGE_CONCURRENCY = 3;

// Enrich a batch of links' `titleImage` facet in one shot — the path behind the
// displayed-scoped / enrich-all drains (extraction-provider). Returns the number of links
// processed (for the caller's auto-budget). Never throws.
export async function runServerTitleImageBatch(
  username: string,
  links: LinkItem[],
  client: ExtractClient,
): Promise<number> {
  if (links.length === 0) return 0;

  // De-dupe URLs (the same article saved twice shares one fetch) and map each URL back to
  // every link that carries it, so one result enriches them all.
  const linksByUrl = new Map<string, LinkItem[]>();
  for (const link of links) {
    const group = linksByUrl.get(link.url);
    if (group) group.push(link);
    else linksByUrl.set(link.url, [link]);
  }
  const urls = [...linksByUrl.keys()];

  let results: ExtractResult[];
  try {
    // N === 1 keeps inline (the human-waiting single save); N > 1 batches metadata.
    results = urls.length === 1 ? [await client.extract(urls[0])] : await client.extractMany(urls);
  } catch {
    // The whole extract call failed (network/abort/non-2xx). Record a transient failure
    // for every link so backoff paces the retry; the drain continues.
    await writeAll(username, links, { facet: 'titleImage', state: failedState('failed') });
    return links.length;
  }

  const byUrl = new Map(results.map((result) => [result.url, result]));

  // PASS 1 — titles, written immediately so the page fills with real titles before any
  // image is fetched. An ok result writes its title FIELDS-ONLY (facet left pending) so
  // the image pass can still set the terminal state; a failed result is terminal here
  // (the pending query then skips it via backoff). Carry the ok results into pass 2.
  const pending: { result: ExtractResult; targets: LinkItem[] }[] = [];
  await Promise.all(
    urls.map(async (url) => {
      const targets = linksByUrl.get(url) ?? [];
      const result = byUrl.get(url);
      if (!result) return; // server omitted this URL — leave pending for a later scan.
      if (!result.ok) {
        const status = isPermanent(result.error) ? 'permanent' : 'failed';
        await writeAll(username, targets, { facet: 'titleImage', state: failedState(status) });
        return;
      }
      // cleanTitle caps to LINK_TITLE_MAX (the same normalizer the extension + the server
      // run), so the value satisfies `extractionSchema.title`.
      const title = cleanTitle(result.title);
      if (title) await writeAll(username, targets, { fields: { title } });
      pending.push({ result, targets });
    }),
  );

  // PASS 2 — images, pooled. Each ok link gets its preview (inline bytes or the proxy),
  // then the TERMINAL facet write: done (image stored, or none to fetch), or failed
  // when the image fetch was a retryable throttle/5xx — the title is already visible
  // either way. Per-item failures are swallowed into a transient facet write so the
  // pool (and the whole function) never throws.
  await mapPool(pending, IMAGE_CONCURRENCY, async ({ result, targets }) => {
    try {
      const image = await loadImage(result, client);
      const fields: ExtractionFields = {};
      if (image.kind === 'bytes') {
        // Cap dimensions + re-encode before storing, to bound the quota (the deferred
        // client thumbnailing step — the extractor never resizes). Content before
        // metadata: write the `files/` blob, then reference it from `extractions/`.
        const resized = await resizeImage(image.bytes, result.imageContentType);
        const imageId = newId();
        await writeFile(username, imageId, resized);
        fields.imageId = imageId;
      }
      // A transient image failure leaves the facet `failed` so backoff retries it (the
      // image isn't lost to a passing throttle); otherwise the facet settles `done`.
      const state = image.kind === 'transient' ? failedState('failed') : doneState();
      await writeAll(username, targets, { fields, facet: 'titleImage', state });
    } catch {
      // resize/write threw — record a transient failure so the link is retried, the
      // title from pass 1 intact.
      await writeAll(username, targets, { facet: 'titleImage', state: failedState('failed') });
    }
  });

  return links.length;
}

// Apply one extraction patch to every link in a group (links sharing a URL). Identity
// comes from the PATH (the one authority a round-tripped blob can't drift from), same as
// the pending query — not from any `id` copy inside the blob.
function writeAll(username: string, links: LinkItem[], patch: ExtractionPatch): Promise<unknown> {
  return Promise.all(
    links.map((link) => writeExtraction(username, idFromPath(link.path, LINKS_PREFIX), patch)),
  );
}

type ImageOutcome =
  | { kind: 'bytes'; bytes: Uint8Array }
  // No image available, or a permanent image error — settle `done`, title-only.
  | { kind: 'none' }
  // Retryable image fetch failure (429 / 5xx / network) — leave the facet for a retry.
  | { kind: 'transient' };

// The preview image for one ok result, by the client-signaled tradeoff: inline base64 when
// the single-URL `inlineImage` fetch succeeded (one round trip), else the streaming proxy
// on the discovered `imageUrl` (a second round trip). A proxy 429/5xx/network error is
// TRANSIENT (the facet is retried so the image isn't lost to a passing throttle); a non-429
// 4xx is permanent (settle `done` with the title, no image — the `web-only gap` behavior:
// no preview rather than a leaky remote <img src>). No `imageUrl` at all → nothing to fetch.
async function loadImage(result: ExtractResult, client: ExtractClient): Promise<ImageOutcome> {
  if (result.imageBytes) return { kind: 'bytes', bytes: base64ToBytes(result.imageBytes) };
  if (!result.imageUrl) return { kind: 'none' };
  try {
    return { kind: 'bytes', bytes: await client.fetchImage(result.imageUrl) };
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
      return { kind: 'none' };
    }
    return { kind: 'transient' };
  }
}

// Run `fn` over `items` at most `width` at a time — a minimal concurrency pool (no dep).
// `fn` swallows its own per-item failures, so the workers just drain the shared cursor.
async function mapPool<T>(
  items: T[],
  width: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      await fn(items[cursor++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
}

// Which extract errors are PERMANENT (never retry — record `status: 'permanent'`) vs.
// transient (`failed`, retried after backoff). `blocked` (SSRF reject) and the content
// caps (`unsupported_type`, `too_large`) won't change on a retry; a bad status / timeout /
// fetch failure might, so those stay transient. (The contract's `bad_status` doesn't carry
// the code, so a 404 is paced by backoff rather than marked permanent up front — the cap
// bounds the retries either way.)
function isPermanent(error: ExtractError | undefined): boolean {
  return error === 'blocked' || error === 'unsupported_type' || error === 'too_large';
}

function doneState(): Facet {
  return { status: 'done', extractedBy: EXTRACTED_BY, extractedAt: Date.now(), attempts: 0 };
}

// attempts: 1 mirrors the extension worker's scaffold — a real cross-cycle attempt counter
// (read prior `attempts`, increment) is the same deferred enhancement noted there;
// backoff(1) still cools the first retry, and the per-cycle cap bounds it.
function failedState(status: 'failed' | 'permanent'): Facet {
  return { status, extractedBy: EXTRACTED_BY, extractedAt: Date.now(), attempts: 1 };
}
