/**
 * Background service worker.
 *
 * Owns the privileged capture work for the bookmark manager so the popup can
 * stay a pure UI surface:
 *   - reads the active tab's url/title
 *   - screenshots the visible viewport (`tabs.captureVisibleTab` — only callable
 *     from an extension page, never a content script)
 *   - archives the page by injecting a serializer into it on demand
 *     (`scripting.executeScript`), so we never need a persistent content script
 *
 * The popup talks to it via a single `SAVE_PAGE` message.
 */

export type SavePageMessage = { type: 'SAVE_PAGE' };

export interface SavedPage {
  url: string;
  title: string;
  /** PNG data URL of the visible viewport. */
  screenshot: string;
  /** Serialized DOM at capture time. */
  html: string;
  savedAt: number;
}

export type SavePageResponse = { ok: true; page: SavedPage } | { ok: false; error: string };

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: SavePageMessage, _sender, sendResponse) => {
    if (message?.type !== 'SAVE_PAGE') return;

    savePage()
      .then((page) => sendResponse({ ok: true, page } satisfies SavePageResponse))
      .catch((err) =>
        sendResponse({ ok: false, error: errorMessage(err) } satisfies SavePageResponse),
      );

    // Returning true keeps the message channel open for the async response.
    return true;
  });
});

async function savePage(): Promise<SavedPage> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) throw new Error('No active tab to save.');

  const { id: tabId, windowId, url = '', title = '' } = tab;

  // Refuse pages we can't inject into (chrome://, the web store, etc.).
  if (!/^https?:/.test(url)) {
    throw new Error('This page cannot be archived (only http/https pages are supported).');
  }

  // Screenshot the visible viewport. Run before injection so the capture
  // reflects what the user currently sees.
  const screenshot = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });

  // Archive: inject a serializer into the page on demand and read the DOM back.
  const [injection] = await browser.scripting.executeScript({
    target: { tabId },
    func: () => new XMLSerializer().serializeToString(document),
  });
  const html = (injection?.result as string | undefined) ?? '';

  return { url, title, screenshot, html, savedAt: Date.now() };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
