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
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';
    return {
      name: 'Brace.to - Bookmark Manager',
      description:
        'Save links to visit later easily, anytime, on any device, with technology that empowers you to truly own your account and data.',
      permissions: [
        'storage',
        // activeTab grants temporary host access to the current tab on click,
        // covering url/title reads + captureVisibleTab on it
        'activeTab',
        // required to call scripting.executeScript (archive serializer
        // injection in background.ts); activeTab only grants host access
        'scripting',
        'management',
        // Firefox reads auth cookies directly; Chrome queries display info
        ...(isFirefox ? ['cookies'] : ['system.display']),
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
