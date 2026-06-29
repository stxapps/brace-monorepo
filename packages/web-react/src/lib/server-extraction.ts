import {
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

import { type ExtractionFields, writeExtraction, writeFile } from '../data/mutations';
import { type LinkItem } from '../data/queries';
import { resizeImage } from './resize-image';

// The SERVER-tier extraction worker: enrich ONE link's `titleImage` facet via
// `brace-extractor`, then write back — the (resized) image bytes into `files/`, the
// title/imageId display fields + the facet's done/failed bookkeeping into
// `extractions/{id}.enc`. The shared counterpart of the extension's `runExtraction`
// (apps/brace-extension), but driven by an HTTP extract instead of an active-tab
// capture, so its `extractedBy` is `server` (the lowest tier — `tierOf` → 1) and a
// later active-page sighting can UPGRADE it.
//
// Like the extension worker it writes ONLY `extractions/` + `files/`, NEVER
// `links/{id}.enc` (the writer-split — docs/link-extraction.md), so a backfill can't
// clobber a concurrent user edit. It only ever does `titleImage`: the server tier
// can't screenshot/archive (no renderer) and read-mode parity isn't promised, so
// those facets stay active-context only.
//
// NEVER throws: every outcome (success, transient failure, permanent failure) is
// RECORDED as a facet write, so the caller's drain loop always makes progress — a
// processed link becomes settled (`done`, or `failed`/`permanent` which the pending
// query then skips via backoff) and is never re-picked on the next scan.
const EXTRACTED_BY = 'server';

export async function runServerTitleImage(
  username: string,
  link: LinkItem,
  client: ExtractClient,
): Promise<void> {
  // Identity comes from the PATH (the one authority a round-tripped blob can't drift
  // from), same as the pending query — not from any `id` copy inside the blob.
  const linkId = idFromPath(link.path, LINKS_PREFIX);

  try {
    const result = await client.extract(link.url);

    if (!result.ok) {
      const status = isPermanent(result.error) ? 'permanent' : 'failed';
      await writeExtraction(username, linkId, { facet: 'titleImage', state: failedState(status) });
      return;
    }

    const fields: ExtractionFields = {};
    // cleanTitle caps to LINK_TITLE_MAX (the same normalizer the extension + the
    // server run), so the value satisfies `extractionSchema.title`.
    const title = cleanTitle(result.title);
    if (title) fields.title = title;

    const image = await fetchImageBytes(result, client);
    if (image) {
      // Cap dimensions + re-encode before storing, to bound the quota (the deferred
      // client thumbnailing step — the extractor never resizes). Content before
      // metadata: write the `files/` blob, then reference it from `extractions/`.
      const resized = await resizeImage(image, result.imageContentType);
      const imageId = newId();
      await writeFile(username, imageId, resized);
      fields.imageId = imageId;
    }

    await writeExtraction(username, linkId, { fields, facet: 'titleImage', state: doneState() });
  } catch {
    // The extract/proxy fetch threw (network, abort, a non-2xx ApiError, a decode
    // error). Record a transient failure so the synced backoff stops every device
    // hammering it; the drain loop continues to the next link.
    await writeExtraction(username, linkId, { facet: 'titleImage', state: failedState('failed') });
  }
}

// The preview image bytes, by the client-signaled tradeoff: inline base64 when the
// single-URL `inlineImage` fetch succeeded (one round trip), else the proxy on the
// discovered `imageUrl` (a second round trip). Undefined when neither is available
// or the proxy fetch fails — in which case the link keeps its title, image absent
// (the `web-only gap` behavior: no preview rather than a leaky remote <img src>).
async function fetchImageBytes(
  result: ExtractResult,
  client: ExtractClient,
): Promise<Uint8Array | undefined> {
  if (result.imageBytes) return base64ToBytes(result.imageBytes);
  if (!result.imageUrl) return undefined;
  try {
    return await client.fetchImage(result.imageUrl);
  } catch {
    return undefined;
  }
}

// Which extract errors are PERMANENT (never retry — record `status: 'permanent'`)
// vs. transient (`failed`, retried after backoff). `blocked` (SSRF reject) and the
// content caps (`unsupported_type`, `too_large`) won't change on a retry; a bad
// status / timeout / fetch failure might, so those stay transient. (The contract's
// `bad_status` doesn't carry the code, so a 404 is paced by backoff rather than
// marked permanent up front — the cap bounds the retries either way.)
function isPermanent(error: ExtractError | undefined): boolean {
  return error === 'blocked' || error === 'unsupported_type' || error === 'too_large';
}

function doneState(): Facet {
  return { status: 'done', extractedBy: EXTRACTED_BY, extractedAt: Date.now(), attempts: 0 };
}

// attempts: 1 mirrors the extension worker's scaffold — a real cross-cycle attempt
// counter (read prior `attempts`, increment) is the same deferred enhancement noted
// there; backoff(1) still cools the first retry, and the per-cycle cap bounds it.
function failedState(status: 'failed' | 'permanent'): Facet {
  return { status, extractedBy: EXTRACTED_BY, extractedAt: Date.now(), attempts: 1 };
}
