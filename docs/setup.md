## nx monorepo setup

> How this workspace was scaffolded. Mostly run-once history; see
> [architecture.md](./architecture.md) for the living reference on libs &
> dependency rules.

#### existing

- npx create-nx-workspace@latest
- npx nx add @nx/next
- npx nx g @nx/next:app apps/brace-web
- cd apps
- npx wxt@latest init brace-extension
- cd .. && npm i
- claude manually create brace-api file by file
- ask claude to generate like:
  npx nx g @nx/js:lib --directory=packages/shared --importPath=@stxapps/shared --bundler=none --linter=eslint --unitTestRunner=jest --minimal
- ask claude to generate like:
  npx nx g @nx/react:lib --directory=packages/web-ui --importPath=@stxapps/web-ui --bundler=none --linter=eslint --unitTestRunner=jest --minimal
- ask claude to generate like:
  npx nx g @nx/react:lib --directory=packages/react --importPath=@stxapps/react --bundler=none --linter=eslint --unitTestRunner=jest --minimal --no-component
- npx nx g @nx/react:lib --directory=packages/web-crypto --importPath=@stxapps/web-crypto --bundler=none --linter=eslint --unitTestRunner=jest
  --minimal --no-component
- npx nx g @nx/react:lib --directory=packages/web-react --importPath=@stxapps/web-react --bundler=none --linter=eslint --unitTestRunner=jest
  --minimal --no-component

Flag notes:

- `--bundler=none` — libs are consumed directly as TS source through the
  workspace; no per-lib build step.
- `--importPath=@stxapps/*` — npm scope is `@stxapps`; product name is brace.
- `--no-component` on `react`, `web-crypto`, and `web-react` — those libs are
  hooks/logic/crypto, no UI components (unlike `web-ui`).

#### shadcn

- npx shadcn@latest add <component> -c packages/web-ui
- npx shadcn@latest add button -c packages/web-ui --overwrite
- npx shadcn@latest add input -c packages/web-ui
- npx shadcn@latest add card -c packages/web-ui
- npx shadcn@latest add accordion -c packages/web-ui
- npx shadcn@latest add checkbox -c packages/web-ui
- npx shadcn@latest add label -c packages/web-ui
- npx shadcn@latest add field -c packages/web-ui
- npx shadcn@latest add select -c packages/web-ui
- npx shadcn@latest add textarea -c packages/web-ui

#### expo

- npx nx add @nx/expo
- npx nx g @nx/expo:app brace-expo --directory=apps/brace-expo --importPath=@stxapps/brace-expo
- `packages/expo-crypto` was written by hand (no generator): the usual lib
  files following the other packages' conventions, PLUS the Expo native module
  pieces `create-expo-module` would scaffold — `expo-module.config.json`,
  `ios/BraceFileCrypto.podspec` + Swift, `android/build.gradle` + Kotlin.
  Native code is picked up by Expo autolinking from the workspace symlink in
  `node_modules` during `npx expo prebuild` (dev client required — not Expo Go).
- `packages/expo-react` was also written by hand (no generator), mirroring
  `web-react`'s package conventions (source-exports `package.json`, `nx.tags`,
  solution-style tsconfigs) with brace-expo's test setup (`jest-expo` preset +
  `babel-preset-expo`; the babel file is `.babelrc.cjs`, not `.js`, because
  the package is `"type": "module"`). Native modules it builds on
  (`expo-sqlite`, `expo-file-system`, NetInfo) are peerDependencies —
  brace-expo owns them so Expo autolinking sees them.
- Note: `jest-expo` ships a bin literally named `jest`, colliding with the real
  jest CLI in `node_modules/.bin` — whichever npm links last wins. The root
  `postinstall` (`tools/scripts/fix-jest-bin.mjs`) re-points the bin at the
  real jest 30 deterministically (every project, including brace-expo with the
  jest-expo _preset_, runs fine on it; only the _bin_ is the trap).

#### expo-router (brace-expo)

File-based routing, the RN analogue of brace-web's Next.js App Router — routes
live in `apps/brace-expo/src/app/`, so the two apps share the same
folder-is-the-route-tree mental model. Added like:

    npx expo install expo-router react-native-screens expo-linking expo-constants

(run inside `apps/brace-expo`; `expo install` picks SDK-54-compatible versions,
then move each to `*` in the app and pin the real version in the root
`package.json`, per the normal convention). `react-native-screens`,
`expo-linking`, and `expo-constants` are required peers; `react-native-safe-area-context`
was already present. `expo install` also appends the `expo-router` config
plugin to `app.json`. Wiring (already done):

- **entry point**: `package.json` `"main": "expo-router/entry"` — this
  **replaces the old `index.js` + `registerRootComponent(App)`**, which were
  deleted. expo-router's entry sets up the route context itself; there is no
  hand-written root component anymore.
- **routes dir**: expo-router auto-detects `src/app` as the app root (it looks
  for `app/`, then `src/app/`), so **no `EXPO_ROUTER_APP_ROOT`** is needed. The
  old single `src/app/App.tsx` split into the two conventional route files:
  `src/app/_layout.tsx` (the root layout — hosts the `QueryClientProvider`,
  `useQueryManagers()`, `StatusBar`, the `global.css` import, and renders a
  `<Stack>`) and `src/app/index.tsx` (the Home screen). Safe-area context comes
  from expo-router's NavigationContainer (react-navigation's
  `SafeAreaProviderCompat`), so screens use `SafeAreaView` with **no explicit
  `SafeAreaProvider`** in `_layout`.
- **babel**: nothing to add — `babel-preset-expo` (already in `.babelrc.js`) has
  the router transform built in (it's what injects `EXPO_ROUTER_APP_ROOT` and
  auto-detects `src/app`). Metro also needs no change; the existing
  `@expo/metro-config` base + the Uniwind/Nx wrappers are enough.
- **tests must live outside `src/app/`**: every file under the app root is a
  route, and expo-router's default ignore list only drops
  `+html`/`+api`/`+middleware`/`+native-intent` — **not `*.spec.*`**, so a spec
  placed in `src/app/` would be scanned as a bogus route. So the Home-screen
  test is `src/home-screen.spec.tsx` (a plain colocated `.spec.tsx` a level up),
  importing the screen from `./app/index`. Keep it a **plain `.spec.tsx`, not a
  `__tests__/` dir**: jest's broad `**/__tests__/**/*.[jt]s?(x)` glob would also
  match the `.d.ts` that `typecheck` emits into `out-tsc/`, failing the run with
  "must contain at least one test"; the `**/?(*.)+(spec|test).[jt]s?(x)` glob a
  plain `.spec.tsx` uses does not match `.spec.d.ts`.
  - **Why not just customize the ignore list?** It isn't practically reachable.
    There are two filters and neither is a usable app-level knob: (1) the
    bundler filter — the `require.context` regex in expo-router's own
    `_ctx.*.js` — is hardcoded inside the package (babel only injects
    `EXPO_ROUTER_APP_ROOT`), and (2) the route-tree `ignore` option in
    `getRoutesCore` _does_ exist and is fed at runtime from
    `Constants.expoConfig.extra.router`, but its entries must be `RegExp`
    objects and that config is read from a **serialized JSON manifest** — a
    `RegExp` can't survive JSON, so `expo.extra.router.ignore` can't carry one.
    (That option is really for tooling that calls `getRoutes(context, { ignore })`
    directly — static export, the `renderRouter` test helper.) There's also no
    `_private`-file convention; the only non-route markers are the fixed set
    (`_layout`, `+not-found`, `+html`, `+native-intent`, `+middleware`, `+api`,
    plus `(group)`/`[param]`). Keeping non-route files out of `src/app/` is the
    intended pattern. A Metro `resolver.blockList` of `/.*\.spec\.[jt]sx?$/`
    would also work but is a bundle-wide instrument for what the file layout
    already solves — don't add it.

#### uniwind + react-native-reusables (brace-expo)

The RN equivalent of the web tailwind + shadcn stack (see architecture.md —
_brace-expo_). Styling is **Uniwind** (Tailwind **v4**, CSS-first, a Metro
plugin — from the Unistyles authors). We migrated off NativeWind once
react-native-reusables shipped first-class Uniwind support
([PR #492](https://github.com/founded-labs/react-native-reusables/pull/492));
the payoff is that the whole workspace is on **Tailwind v4** and the old v3/v4
version split is gone. Wiring (already done):

- deps: `uniwind` (version in the root `package.json`, app declares `*`, per the
  normal convention) + `tailwindcss@^4.x` pinned in
  `apps/brace-expo/package.json` — Uniwind peers on `tailwindcss@>=4`. Every
  Tailwind consumer now pins `^4.x` itself (`brace-web`, `brace-extension`,
  `web-ui`, and brace-expo); there is **no root-hoisted `tailwindcss` and no
  `overrides` entry** (both existed only to keep NativeWind's edge on v3). If
  styling breaks after dependency surgery, check
  `require.resolve('tailwindcss', { paths: ['apps/brace-expo'] })` resolves v4.
- config: **no `tailwind.config.js`** (Tailwind v4 is CSS-first) and **no
  babel preset** (Uniwind is Metro-only). `global.css` holds
  `@import 'tailwindcss'; @import 'uniwind';` plus an `@source` line for any
  workspace package the app renders classNames from (the v4 replacement for the
  old `content` glob), and is imported **once at the top of the root
  `src/app/_layout.tsx`** (Uniwind wants it in the app tree, not the entry).
  `metro.config.js` wraps with
  `withUniwindConfig(..., { cssEntryFile: './global.css', dtsFile:
'./uniwind-env.d.ts' })` as the **outermost** wrapper (around `withNxMetro`).
  `uniwind-env.d.ts` is **generated by Uniwind** on the first metro run (holds
  the `className` types + theme list) and is referenced from the solution
  `tsconfig.json` `include`; `tsconfig.app.json` needs **no** `jsxImportSource`.
  Composite components that aren't core RN hosts (e.g. `SafeAreaView` from
  `react-native-safe-area-context`) need `withUniwind(Component)` to accept
  `className`; `View`/`Text` and reanimated components accept it directly.
- components come from **react-native-reusables** (the shadcn analogue —
  same copy-into-the-app model), added like shadcn on web:
  npx @react-native-reusables/cli@latest add <component>
  (run inside `apps/brace-expo`; the CLI auto-detects Uniwind and adds the
  Uniwind component variant — if it prompts for a `tailwind.config.js` path,
  press enter to skip, since Uniwind is config-less. Components land in the app,
  not a package — there is deliberately no `expo-ui` lib while brace-expo is the
  only expo app). Components that animate will pull in `react-native-reanimated`
  / `react-native-worklets` (already installed, SDK 54-pinned at root).
- jest: `uniwind` is mocked (its className→style bridge needs the Metro
  transform / native runtime — the HOC becomes identity in tests) and `*.css`
  imports map to an empty module (`src/test-css-mock.js`), alongside the
  official NetInfo and safe-area-context mocks, all in `src/test-setup.ts` /
  `jest.config.cts`.

#### font — Inter (brace-expo)

The web apps load Inter via CSS (`next/font` in brace-web, `@font-face` in
brace-extension) — neither works on React Native (no DOM cascade, no woff2). The
native equivalent is **expo-font, embedded at build time via its config plugin**
(not the runtime `useFonts` hook): the font is registered natively from process
start, so `fontFamily: 'Inter'` is available at first paint with no async load,
no splash gate, and no flash. Wiring (already done):

- **asset**: `assets/fonts/InterVariable.ttf` — the same single variable file the
  web/extension use (as woff2), so one source of truth; the `wght` axis backs the
  Tailwind font-weight utilities (`font-medium`/`font-semibold`/…). Downloaded as
  TTF from the [Inter release](https://github.com/rsms/inter/releases) (native
  can't consume the vendored woff2). Italic isn't embedded yet — add its TTF and a
  second path to the plugin `fonts` array when a surface needs it.
- **rename**: upstream `InterVariable.ttf` names its family **"Inter Variable"**,
  and the expo-font plugin embeds under the font's _internal_ name on iOS with no
  override — so `tools/scripts/rename-inter.py` rewrites the name table to plain
  **"Inter"** (run once per downloaded release; needs `brew install fonttools` or
  `pip install fonttools`). This is why the committed TTF isn't byte-identical to
  upstream. Without it, iOS would need `fontFamily: 'Inter Variable'`.
- **plugin**: `["expo-font", { "fonts": ["./assets/fonts/InterVariable.ttf"] }]`
  in `app.json` — picked up on `npx expo prebuild` (the dev client is already
  required for the expo-crypto native module). Keep `expo-font` in
  `package.json` dependencies even though nothing imports it in JS: the config
  plugin resolves from the package.
- **Uniwind binding**: `global.css` sets `--font-sans: 'Inter'`, so the
  `font-sans` utility emits `fontFamily: 'Inter'`. RN has no CSS cascade, so
  `font-sans` is applied where text renders; once the react-native-reusables
  `Text` component is added, put it in that component's base variant to make
  Inter the app-wide default.
- **verify a real build**: the embed only takes effect after a native build
  (`npx expo prebuild` + run on device/simulator) — it can't be exercised by
  jest or Metro alone.

#### docs (future)

- npx nx g @nx/next:app apps/brace-docs

#### dependencies

- npm install serwist -w @stxapps/brace-web
- npm install @serwist/next -w @stxapps/brace-web
- npm install @serwist/cli --save-dev -w @stxapps/brace-web

#### wrangler

- rm -rf apps/brace-api/.wrangler/state/v3/d1 or rm -rf apps/brace-api/.wrangler/state
- npx nx run brace-api:migrate
