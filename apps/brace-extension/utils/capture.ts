// The active-tab capture functions (`tier: 'active-page'`). Each runs against the
// CURRENTLY FOCUSED tab — valid because every capture is triggered by a popup the
// user opened on that tab (auto on save for the cheap facets, a button click for the
// heavy ones). All the privileged work lives here in the background: content scripts
// get no CORS exemption, so the page-reading is done via `scripting.executeScript`
// (injected on demand — no persistent content script) and the screenshot via
// `tabs.captureVisibleTab` (only callable from an extension context).
//
// READMODE NOTE: a compact inline reader for now (clone → strip non-content → take
// the article/main/body HTML). The planned upgrade is @mozilla/readability (already
// a dependency) injected as a bundled content-script file and run over the live DOM;
// kept inline here so the scaffold needs no extra entrypoint.

const encoder = new TextEncoder();

// A `data:`/blob URL → raw bytes. The service worker can fetch `data:` URLs, so this
// is the simplest decode for the base64 the in-page funcs hand back.
async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
}

// --- titleImage --------------------------------------------------------------

// Read og:title / og:image (+ <title>) from the live DOM, and fetch the og:image
// bytes IN-PAGE (the page's own context, where the image is most likely fetchable)
// as a data URL. Returns the discovered title and, when available, the image bytes.
export async function captureTitleImage(
  tabId: number,
): Promise<{ title: string; image?: Uint8Array }> {
  const [injection] = await browser.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const meta = (key: string): string =>
        document.querySelector(`meta[property="${key}"]`)?.getAttribute('content') ??
        document.querySelector(`meta[name="${key}"]`)?.getAttribute('content') ??
        '';
      const title = meta('og:title') || document.title || '';
      const ogImage = meta('og:image');
      let image = '';
      if (ogImage) {
        try {
          const res = await fetch(ogImage);
          if (res.ok) {
            const blob = await res.blob();
            image = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
              reader.onerror = () => resolve('');
              reader.readAsDataURL(blob);
            });
          }
        } catch {
          // og:image on a CORS-hostile origin — skip the image, keep the title.
        }
      }
      return { title, image };
    },
  });

  const data = injection?.result as { title: string; image: string } | undefined;
  if (!data) return { title: '' };
  const image = data.image ? await dataUrlToBytes(data.image) : undefined;
  return { title: data.title, image };
}

// --- titleImage (background, bg-fetch tier) ----------------------------------

// The BACKGROUND counterpart of captureTitleImage: there's no open tab for a queued
// link, so we can't read a live DOM — instead the service worker `fetch`es the raw HTML
// (CORS-exempt because the manifest grants `<all_urls>` host_permissions) and parses
// og:title / og:image out of it. This is the `extension:bg` tier — title + image only,
// never screenshot/archive (those need an active page). Read-mode quality on
// JS-rendered SPAs is poor from raw HTML (the active-tab path is the good one), so the
// background sweep does titleImage only (docs/link-extraction.md capability tiers).
//
// A service worker has NO DOMParser, so the parse is deliberately a small set of
// regexes over the `<head>` markup — enough for the OpenGraph tags, not a full HTML
// parse. `HTTPError` carries the status so the caller can mark 404/410 `permanent`.
export class HTTPError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
    this.name = 'HTTPError';
  }
}

// Cap the HTML we parse: og: tags live in <head>, so a few hundred KB is plenty and a
// pathological multi-MB page can't blow up worker memory.
const MAX_HTML_BYTES = 512 * 1024;

export async function fetchTitleImage(
  url: string,
): Promise<{ title: string; image?: Uint8Array }> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new HTTPError(res.status);
  const html = (await res.text()).slice(0, MAX_HTML_BYTES);

  const title = metaContent(html, 'og:title') || htmlTitle(html) || '';
  const ogImage = metaContent(html, 'og:image');

  let image: Uint8Array | undefined;
  if (ogImage) {
    try {
      // og:image may be relative — resolve against the FINAL url (after redirects).
      const imageUrl = new URL(ogImage, res.url || url).href;
      const imgRes = await fetch(imageUrl);
      if (imgRes.ok) image = new Uint8Array(await imgRes.arrayBuffer());
    } catch {
      // og:image fetch failed (CORS-hostile even for the extension, 404, bad url) —
      // keep the title, drop the image. Same degradation as the active-tab path.
    }
  }
  return { title: decodeEntities(title.trim()), image };
}

// The `content` of the first `<meta property|name="key" …>` tag, attribute order
// agnostic: match the whole tag by its key, then pull `content` from within it.
function metaContent(html: string, key: string): string | undefined {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = html.match(
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${esc}["'][^>]*>`, 'i'),
  )?.[0];
  return tag?.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
}

function htmlTitle(html: string): string | undefined {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
}

// Minimal HTML-entity decode for the handful that show up in titles. Not a full
// decoder — just the common named refs plus numeric ones.
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// --- readMode ----------------------------------------------------------------

// Inject a compact reader over the live DOM and return the cleaned article HTML as
// bytes (a `files/{id}.enc` blob).
export async function captureReadMode(tabId: number): Promise<Uint8Array> {
  const [injection] = await browser.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clone = document.cloneNode(true) as Document;
      clone
        .querySelectorAll('script, style, noscript, iframe, svg, link, meta')
        .forEach((el) => el.remove());
      const article = clone.querySelector('article') ?? clone.querySelector('main') ?? clone.body;
      return article ? article.innerHTML : '';
    },
  });
  const html = (injection?.result as string | undefined) ?? '';
  return encoder.encode(html);
}

// --- screenshot --------------------------------------------------------------

// Capture the visible viewport of the focused window as PNG bytes (a `files/{id}.enc`
// blob). The active tab is already focused at icon-click, so the capture reflects
// what the user sees.
export async function captureScreenshot(windowId: number): Promise<Uint8Array> {
  const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
  return dataUrlToBytes(dataUrl);
}

// --- archive -----------------------------------------------------------------

// Serialize the live DOM and return it as bytes (a `files/{id}.enc` blob). Starts
// with the inline XMLSerializer; SingleFile-grade inlining (CSS/images/fonts) is a
// later enhancement, per the plan.
export async function captureArchive(tabId: number): Promise<Uint8Array> {
  const [injection] = await browser.scripting.executeScript({
    target: { tabId },
    func: () => new XMLSerializer().serializeToString(document),
  });
  const html = (injection?.result as string | undefined) ?? '';
  return encoder.encode(html);
}
