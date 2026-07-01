import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
//
// One config drives both targets: `wxt build` (Chrome) and `wxt build -b
// firefox`. WXT emits the right per-browser manifest — most notably the
// background key (`service_worker` for Chrome, `scripts` for Firefox) is
// derived from `entrypoints/background.ts`, and `icons`/`action.default_icon`
// are auto-filled from `public/icon/*.png`. We only branch on the fields that
// genuinely differ between stores.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // brace-web's `npm run dev` owns :3000 (apps/brace-web/package.json). WXT's
  // dev server defaults to :3000 too, so running both at once collides — pin
  // the extension's dev server to :3001.
  dev: {
    server: { port: 3001 },
  },
  // WXT defaults Firefox to MV2; pin MV3 on both to match the existing
  // extensions (Firefox MV3 keeps `background.scripts`, which WXT emits).
  manifestVersion: 3,
  manifest: ({ browser, mode }) => {
    const isFirefox = browser === 'firefox';
    // brace-api host the extension talks to, per build mode. Single source of
    // truth: the same WXT_PUBLIC_API_URL that utils/api-client.ts reads, loaded here at
    // config time from `.env.<mode>` (dev :8787, staging/prod custom domains).
    // `mode` is 'development' for `wxt`/`wxt dev`, 'production' for `wxt build`,
    // and 'staging' when built with `--mode staging`. In the manifest function
    // `import.meta.env` isn't the bundle env yet, so we read the file directly
    // via Vite's loadEnv; deriving the host from the URL the client uses keeps
    // the grant from ever drifting out of sync with api.ts.
    //
    // Auth is a bearer token (Authorization header) shared across web,
    // extension, and the future mobile app — NOT a cookie. In MV3, the
    // background/service-worker's fetches to a host_permissions origin are
    // EXEMPT from CORS, so the extension never appears in brace-api's
    // CORS_ORIGINS allow-list. The api host is per-tier (no localhost/staging in
    // the production store build). NOTE: content scripts get NO CORS exemption —
    // route their API calls through background.ts rather than fetching brace-api
    // directly.
    const apiUrl = loadEnv(mode, process.cwd(), 'WXT_PUBLIC_').WXT_PUBLIC_API_URL;
    if (!apiUrl) throw new Error('WXT_PUBLIC_API_URL is not set');
    // host_permissions needs a match pattern (origin + `/*`), not a bare origin.
    const apiHost = `${new URL(apiUrl).origin}/*`;
    return {
      name: 'Brace.to - Bookmark Manager',
      description:
        'Save links to visit later easily, anytime, on any device, with technology that empowers you to truly own your account and data.',
      // ONLY the api host — NO `<all_urls>`. A broad host grant is the one thing
      // that would unlock BACKGROUND bg-fetch extraction (the service worker
      // `fetch`ing arbitrary saved third-party URLs for their OpenGraph tags, which
      // MV3 only CORS-exempts for host_permissions origins), but it costs the
      // scariest install warning ("read and change all your data on all websites")
      // and a store-review nightmare — for the extension's WEAKEST tier. The
      // extension is deliberately ACTIVE-CONTEXT ONLY: it extracts from the focused
      // tab via `activeTab` (warning-free, highest quality), and the background
      // bg-fetch residual (cross-device pickups, bulk-import draining) is owned by
      // the deferred server path `brace-extractor` instead. See
      // docs/link-extraction.md "the extension is active-context only". The api host
      // stays listed so the bearer-auth calls to brace-api keep their CORS exemption.
      host_permissions: [apiHost],
      permissions: [
        'storage',
        // The background service worker is ephemeral in MV3 — it can't hold a
        // long-running loop — so the sync + extraction cycles are driven by a
        // periodic browser.alarms tick (see entrypoints/background.ts).
        'alarms',
        // activeTab grants temporary host access to the current tab on click,
        // covering url/title reads + captureVisibleTab on it
        'activeTab',
        // required to call scripting.executeScript (archive serializer
        // injection in background.ts); activeTab only grants host access
        'scripting',
      ],
      // action.default_title comes from the popup's <title> (entrypoints/popup).
      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: { id: 'addon@brace.to', strict_min_version: '109.0' },
            },
          }
        : {
            minimum_chrome_version: '93',
          }),
    };
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
