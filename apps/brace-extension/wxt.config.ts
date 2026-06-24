import tailwindcss from '@tailwindcss/vite';
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
  // WXT defaults Firefox to MV2; pin MV3 on both to match the existing
  // extensions (Firefox MV3 keeps `background.scripts`, which WXT emits).
  manifestVersion: 3,
  manifest: ({ browser, mode }) => {
    const isFirefox = browser === 'firefox';
    // brace-api host the extension talks to, per build mode — mirrors
    // brace-web's NEXT_PUBLIC_API_URL (dev :8787, staging/prod custom domains).
    // `mode` is 'development' for `wxt`/`wxt dev`, 'production' for `wxt build`,
    // and 'staging' when built with `--mode staging`.
    //
    // Auth is a bearer token (Authorization header) shared across web,
    // extension, and the future mobile app — NOT a cookie. In MV3, the
    // background/service-worker's fetches to a host_permissions origin are
    // EXEMPT from CORS, so the extension never appears in brace-api's
    // CORS_ORIGINS allow-list. Keep this minimal: each build ships only its own
    // tier's host (no localhost/staging in the production store build).
    // NOTE: content scripts get NO CORS exemption — route their API calls
    // through background.ts rather than fetching brace-api directly.
    const apiHost =
      mode === 'production'
        ? 'https://api.brace.to/*'
        : mode === 'staging'
          ? 'https://api.staging.brace.to/*'
          : 'http://localhost:8787/*';
    return {
      name: 'Brace.to - Bookmark Manager',
      description:
        'Save links to visit later easily, anytime, on any device, with technology that empowers you to truly own your account and data.',
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
