// The browser-extension listing URLs, and the one-of-them a given visitor should be
// sent to. Two surfaces link here — the public landing page's store-badge row (which
// shows every badge, so it uses the constants directly) and the links page's previews
// prompt (which has room for one button, so it uses `extensionStoreUrl()`) — hence a
// shared module rather than a second copy of the URLs.
//
// "Browser extension" throughout, never bare "extension" (docs/architecture.md —
// _naming_): bracemark-expo has an iOS share extension that is a different thing.
//
// Hard-coded, not env-configured, because a store listing is a fixed public address —
// unlike the app's own origins, these are the same in every environment.
//
// TODO: both are PLACEHOLDERS. The values they replaced addressed the legacy Brace.to
// listings (the Chrome one by its v1 extension id, which is what the Web Store actually
// resolves — the slug is decorative), and Bracemark gets brand-new listings on every
// store because the identifiers change (docs/brand.md). Fill these in at submission
// time; until then the badge row links nowhere rather than to the wrong product.

export const CHROME_WEB_STORE_URL =
  'https://chromewebstore.google.com/detail/bracemark/TODO_EXTENSION_ID';
export const FIREFOX_ADDONS_URL = 'https://addons.mozilla.org/en-US/firefox/addon/bracemark/';

// The listing to offer THIS browser. Only the two stores exist, so this is a Firefox
// test with Chrome as the fallback — which is also right for the Chromium family
// (Edge/Brave/Opera/Arc all install from the Chrome Web Store; there is no Edge Add-ons
// listing to send them to). A UA sniff is the honest tool here: what's being chosen is
// which STORE can install into this browser, which is a browser-identity question, not
// a feature-detection one.
//
// Guards `navigator` because callers are client components that Next still renders once
// on the server; the guessed value there is never shown (see previews-prompt.tsx, which
// renders null until a Dexie read resolves).
export function extensionStoreUrl(): string {
  if (typeof navigator === 'undefined') return CHROME_WEB_STORE_URL;
  return /firefox/i.test(navigator.userAgent) ? FIREFOX_ADDONS_URL : CHROME_WEB_STORE_URL;
}
