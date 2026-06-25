import { type Facet, LINK_TITLE_MAX } from '@stxapps/shared';
import { newId } from '@stxapps/web-crypto';
import {
  type ExtractionFacet,
  type ExtractionFields,
  readLinkById,
  writeExtraction,
  writeFile,
} from '@stxapps/web-react';

import {
  captureArchive,
  captureReadMode,
  captureScreenshot,
  captureTitleImage,
} from './capture';

// `extractedBy` is a `platform:env` string, NOT a device id (entities.ts): quality is
// DERIVED from it by `tierOf()`, so there's no stored `tier` field. The extension only
// ever captures from the focused live DOM = foreground, active-page tier. (There is no
// `extension:bg` value: the extension is active-context only — no `<all_urls>` grant, no
// background bg-fetch sweep; that residual is owned by the deferred `brace-extractor`.
// See docs/link-extraction.md "the extension is active-context only".)
const EXTRACTED_BY = 'extension:fg';

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
