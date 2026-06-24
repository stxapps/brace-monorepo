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
