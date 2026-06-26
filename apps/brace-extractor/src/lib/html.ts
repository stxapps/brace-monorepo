import { cleanTitle, LINK_TITLE_MAX } from '@stxapps/shared';

// Title + preview-image extraction from a page's HTML, using the Workers-native
// `HTMLRewriter` (a streaming SAX-style parser — no DOM, no JS execution, cheap).
// The extractor runs NO JavaScript, so this is raw-HTML / server-rendered tags only
// (docs "server tier is raw-HTML only"); a JS-shell SPA with no server-side og tags
// degrades to the host fallback at the route, not here.
//
// Preference order matches what real pages mean:
//   title → og:title, else <title>
//   image → og:image(:url|:secure_url), else twitter:image, else <link rel=image_src>
// The image is resolved to an absolute http(s) URL against the FINAL (post-redirect)
// page URL and dropped if it isn't http(s), so the contract's `httpUrlSchema` on the
// response can't reject the whole batch over one bad og:image.

interface Collected {
  ogTitle?: string;
  docTitle: string;
  ogImage?: string;
  ogImageUrl?: string;
  ogImageSecure?: string;
  twitterImage?: string;
  imageSrc?: string;
}

export interface TitleImage {
  title?: string;
  imageUrl?: string;
}

// Resolve a (possibly relative) image URL against the page URL and keep it only if
// it's http(s). Returns undefined for unparseable / non-web URLs (e.g. a `data:` URI
// — we don't proxy those).
function resolveImage(raw: string | undefined, base: URL): string | undefined {
  if (!raw) return undefined;

  let abs: URL;
  try {
    abs = new URL(raw, base);
  } catch {
    return undefined;
  }

  if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return undefined;
  return abs.toString();
}

export async function extractTitleImage(
  html: Uint8Array<ArrayBuffer>,
  finalUrl: URL,
): Promise<TitleImage> {
  const collected: Collected = { docTitle: '' };

  // Accumulate <title> text across its (possibly chunked) text nodes.
  let titleBuffer = '';

  // Pull a meta tag's content into the right slot, keyed by its og/twitter name.
  // `property` (OpenGraph) and `name` (Twitter/legacy) are both checked — sites use
  // either. The FIRST non-empty value for each key wins (head order ≈ page intent).
  const setMeta = (key: string | null, content: string | null): void => {
    if (!key || !content) return;

    const value = content.trim();
    if (value === '') return;

    switch (key.toLowerCase()) {
      case 'og:title':
        collected.ogTitle ??= value;
        break;
      case 'og:image':
        collected.ogImage ??= value;
        break;
      case 'og:image:url':
        collected.ogImageUrl ??= value;
        break;
      case 'og:image:secure_url':
        collected.ogImageSecure ??= value;
        break;
      case 'twitter:image':
      case 'twitter:image:src':
        collected.twitterImage ??= value;
        break;
      default:
        break;
    }
  };

  const rewriter = new HTMLRewriter()
    .on('title', {
      text(chunk) {
        // Bound the buffer so a pathological <title> can't grow unboundedly; the
        // final cap is applied in cleanTitle.
        if (titleBuffer.length < LINK_TITLE_MAX * 2) titleBuffer += chunk.text;
      },
    })
    .on('meta', {
      element(el) {
        setMeta(el.getAttribute('property'), el.getAttribute('content'));
        setMeta(el.getAttribute('name'), el.getAttribute('content'));
      },
    })
    .on('link[rel~="image_src"]', {
      element(el) {
        const href = el.getAttribute('href');
        if (href && href.trim() !== '') collected.imageSrc ??= href.trim();
      },
    });

  // Drive the rewriter by consuming the transformed body. The input is already
  // size-capped (readCappedBytes), so buffering it here is bounded.
  const transformed = rewriter.transform(new Response(html));
  await transformed.arrayBuffer();
  collected.docTitle = titleBuffer;

  const title = cleanTitle(collected.ogTitle) ?? cleanTitle(collected.docTitle);
  const rawImage =
    collected.ogImage ??
    collected.ogImageUrl ??
    collected.ogImageSecure ??
    collected.twitterImage ??
    collected.imageSrc;

  return { title, imageUrl: resolveImage(rawImage, finalUrl) };
}
