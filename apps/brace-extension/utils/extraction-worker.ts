import { ENC_SUFFIX, type Facet, LINK_TITLE_MAX, LINKS_PREFIX } from '@stxapps/shared';
import { newId } from '@stxapps/web-crypto';
import {
  type ExtractionFacet,
  type ExtractionFields,
  readExtraction,
  readLinkById,
  readLinksPendingTitleImage,
  writeExtraction,
  writeFile,
} from '@stxapps/web-react';

import {
  captureArchive,
  captureReadMode,
  captureScreenshot,
  captureTitleImage,
  fetchTitleImage,
  HTTPError,
} from './capture';

// `extractedBy` is a `platform:env` string, NOT a device id (entities.ts): quality is
// DERIVED from it by `tierOf()`, so there's no stored `tier` field. Two contexts, two
// values: an ACTIVE-TAB capture (runExtraction) reads the focused live DOM = foreground,
// active-page tier; a BACKGROUND sweep (runBackgroundExtraction) fetches raw HTML with no
// open tab = bg-fetch tier, the lower of the two.
const EXTRACTED_BY = 'extension:fg';
const EXTRACTED_BY_BG = 'extension:bg';

// The extraction worker: capture one facet of one link from the ACTIVE TAB, then
// write back — the heavy bytes into `files/`, and BOTH the display refs and the
// facet's done/failed bookkeeping into `extractions/{id}.enc`. The extractor NEVER
// writes `links/{id}.enc` (the user's file): the writer-split keeps the machine half
// (title/imageId/screenshotId/pageArchiveId + facet state) in `extractions/`, so a
// background capture can't clobber a concurrent user edit (link-extraction.md). One
// read-merge-write per completion carries the field + its facet status together. This
// client's tier is `active-page`.
//
// Driven by the popup's EXTRACT message (cheap facets auto on save, heavy ones on a
// button) — i.e. only while the tab is focused, which is exactly when active-page
// capture is valid. The background's periodic alarm runs SYNC, not extraction: an
// active-page client can't capture a backgrounded tab, so there's no headless sweep.
export async function runExtraction(
  username: string,
  linkId: string,
  facet: ExtractionFacet,
): Promise<void> {
  // Guard: the link must exist locally (we only need to know it's real; the URL to
  // fetch isn't needed for active-tab capture, which reads the live DOM).
  if (!(await readLinkById(linkId))) {
    throw new Error(`runExtraction: link ${linkId} not found locally`);
  }

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null || tab.windowId == null) throw new Error('No active tab to extract from');
  const tabId = tab.id;

  try {
    switch (facet) {
      case 'titleImage': {
        const { title, image } = await captureTitleImage(tabId);
        const fields: ExtractionFields = {};
        if (title) fields.title = title.slice(0, LINK_TITLE_MAX);
        if (image) {
          const imageId = newId();
          await writeFile(username, imageId, image); // content before metadata
          fields.imageId = imageId;
        }
        await markDone(username, linkId, facet, { fields });
        break;
      }
      case 'readMode': {
        const html = await captureReadMode(tabId);
        const fileId = newId();
        await writeFile(username, fileId, html);
        // No display field references read-mode yet; the facet records its file id
        // (looseObject round-trips it) so a future reader can find it.
        await markDone(username, linkId, facet, { extra: { fileId } });
        break;
      }
      case 'screenshot': {
        const png = await captureScreenshot(tab.windowId);
        const screenshotId = newId();
        await writeFile(username, screenshotId, png);
        await markDone(username, linkId, facet, { fields: { screenshotId } });
        break;
      }
      case 'archive': {
        const dom = await captureArchive(tabId);
        const pageArchiveId = newId();
        await writeFile(username, pageArchiveId, dom);
        await markDone(username, linkId, facet, { fields: { pageArchiveId } });
        break;
      }
      default:
        throw new Error(`runExtraction: facet "${facet}" is not an active-page capture`);
    }
  } catch (err) {
    // Transient failure: record it so the UI can show "retry". A real retry/backoff
    // policy (attempt counting across cycles, the eligibility computed from
    // extractedAt + backoff(attempts)) is a later enhancement.
    const failed: Facet = {
      status: 'failed',
      extractedBy: EXTRACTED_BY,
      attempts: 1,
    };
    await writeExtraction(username, linkId, { facet, state: failed });
    throw err;
  }
}

function markDone(
  username: string,
  linkId: string,
  facet: ExtractionFacet,
  opts: { fields?: ExtractionFields; extra?: Record<string, unknown> } = {},
): Promise<void> {
  const state: Facet = {
    status: 'done',
    extractedBy: EXTRACTED_BY,
    extractedAt: Date.now(),
    attempts: 0,
    ...opts.extra,
  };
  return writeExtraction(username, linkId, { fields: opts.fields, facet, state });
}

// How many pending links one background sweep drains. Bounded because the MV3 worker is
// ephemeral (killed between events) and we pace politely — a backlog drains across alarm
// ticks, not in one burst (docs/link-extraction.md "cadence is backlog-driven").
const BG_SWEEP_BATCH = 10;

// The BACKGROUND extraction loop — the residual queue drain (docs "the queue is a
// query"), as opposed to runExtraction's active-tab, on-demand single capture. Runs
// headless on the alarm: query the links whose `titleImage` is pending (no active tab,
// so title + image ONLY — no screenshot/archive), fetch each via raw HTML at bg-fetch
// tier, and write the result + facet bookkeeping into `extractions/`. It NEVER touches
// `links/` (the writer-split keeps the machine half out of the user's file), so it can't
// clobber a concurrent user edit. Returns how many links it wrote back, so the caller
// (background.ts) only re-syncs when there's something new to push.
export async function runBackgroundExtraction(username: string): Promise<number> {
  const links = await readLinksPendingTitleImage(Date.now(), BG_SWEEP_BATCH);
  let written = 0;
  for (const link of links) {
    // The link's id isn't a blob field — it's the `{id}` of its `links/{id}.enc` path
    // (the co-key the `extractions/{id}.enc` write reuses), same strip as elsewhere.
    const linkId = link.path.slice(LINKS_PREFIX.length, -ENC_SUFFIX.length);
    try {
      const { title, image } = await fetchTitleImage(link.url);
      const fields: ExtractionFields = {};
      if (title) fields.title = title.slice(0, LINK_TITLE_MAX);
      if (image) {
        const imageId = newId();
        await writeFile(username, imageId, image); // content before metadata
        fields.imageId = imageId;
      }
      await writeExtraction(username, linkId, {
        fields,
        facet: 'titleImage',
        state: {
          status: 'done',
          extractedBy: EXTRACTED_BY_BG,
          extractedAt: Date.now(),
          attempts: 0,
        },
      });
      written++;
    } catch (err) {
      // One bad link must not abort the batch: record the failure and move on. The
      // synced `failed`/`permanent` state stops every device retrying (or retries after
      // backoff) — readLinksPendingTitleImage honors both.
      await markBackgroundFailed(username, linkId, err);
    }
  }
  return written;
}

// Record a background `titleImage` failure, carrying the attempt counter forward so the
// shared backoff()/readLinksPendingTitleImage pacing applies. A 404/410 is a hard,
// don't-retry failure (`permanent`); everything else is transient (`failed`, retried once
// past backoff). Reads the prior facet only to bump `attempts` — the write still goes to
// `extractions/` alone.
async function markBackgroundFailed(
  username: string,
  linkId: string,
  err: unknown,
): Promise<void> {
  const existing = await readExtraction(linkId);
  const attempts = (existing?.facets.titleImage?.attempts ?? 0) + 1;
  const permanent = err instanceof HTTPError && (err.status === 404 || err.status === 410);
  const state: Facet = {
    status: permanent ? 'permanent' : 'failed',
    extractedBy: EXTRACTED_BY_BG,
    extractedAt: Date.now(),
    attempts,
  };
  await writeExtraction(username, linkId, { facet: 'titleImage', state });
}
