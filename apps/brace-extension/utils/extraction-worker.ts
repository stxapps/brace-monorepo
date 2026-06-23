import { type Facet, LINK_TITLE_MAX } from '@stxapps/shared';
import {
  type ExtractionFacet,
  newId,
  readLinkById,
  writeExtraction,
  writeFile,
  writeLink,
} from '@stxapps/web-react';

import { captureArchive, captureReadMode, captureScreenshot, captureTitleImage } from './capture';
import { getClientId } from './client-id';

// The extraction worker: capture one facet of one link from the ACTIVE TAB, then
// write back (the heavy bytes into `files/`, the display refs onto the link, and the
// facet's done/failed bookkeeping into `extractions/`). The DISPLAY result lives in
// `links/` (title/imageId/screenshotId/pageArchiveId); `extractions/` records only
// who/when/quality (link-extraction.md). This client's tier is `active-page`.
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
  const link = await readLinkById(linkId);
  if (!link) throw new Error(`runExtraction: link ${linkId} not found locally`);

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null || tab.windowId == null) throw new Error('No active tab to extract from');
  const tabId = tab.id;
  const clientId = await getClientId();

  try {
    switch (facet) {
      case 'titleImage': {
        const { title, image } = await captureTitleImage(tabId);
        // One writeLink with the combined patch — two calls would each spread the
        // stale `link` and clobber the other's field.
        const patch: Parameters<typeof writeLink>[2] = {};
        if (title) patch.title = title.slice(0, LINK_TITLE_MAX);
        if (image) {
          const imageId = newId();
          await writeFile(username, imageId, image); // content before metadata
          patch.imageId = imageId;
        }
        if (Object.keys(patch).length > 0) await writeLink(username, link, patch);
        await markDone(username, linkId, facet, clientId);
        break;
      }
      case 'readMode': {
        const html = await captureReadMode(tabId);
        const fileId = newId();
        await writeFile(username, fileId, html);
        // No link field references read-mode yet; the facet records its file id
        // (looseObject round-trips it) so a future reader can find it.
        await markDone(username, linkId, facet, clientId, { fileId });
        break;
      }
      case 'screenshot': {
        const png = await captureScreenshot(tab.windowId);
        const screenshotId = newId();
        await writeFile(username, screenshotId, png);
        await writeLink(username, link, { screenshotId });
        await markDone(username, linkId, facet, clientId);
        break;
      }
      case 'archive': {
        const dom = await captureArchive(tabId);
        const pageArchiveId = newId();
        await writeFile(username, pageArchiveId, dom);
        await writeLink(username, link, { pageArchiveId });
        await markDone(username, linkId, facet, clientId);
        break;
      }
      default:
        throw new Error(`runExtraction: facet "${facet}" is not an active-page capture`);
    }
  } catch (err) {
    // Transient failure: record it so the UI can show "retry". A real retry/backoff
    // policy (nextEligibleAt, attempt counting across cycles) is a later enhancement.
    const failed: Facet = {
      status: 'failed',
      tier: 'active-page',
      extractedBy: clientId,
      attempts: 1,
    };
    await writeExtraction(username, linkId, facet, failed);
    throw err;
  }
}

function markDone(
  username: string,
  linkId: string,
  facet: ExtractionFacet,
  clientId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const state: Facet = {
    status: 'done',
    tier: 'active-page',
    extractedBy: clientId,
    extractedAt: Date.now(),
    attempts: 0,
    ...extra,
  };
  return writeExtraction(username, linkId, facet, state);
}
