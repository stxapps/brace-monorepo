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
  `ios/BraceCrypto.podspec` + Swift, `android/build.gradle` + Kotlin. One pod
  (`BraceCrypto`, source-file glob — a new `.swift` needs no podspec edit)
  hosts two Apple modules: `BraceFileCrypto` and the iOS-only
  `BraceSharedKeychain`.
  Native code is picked up by Expo autolinking from the workspace symlink in
  `node_modules` during `npx expo prebuild` (dev client required — not Expo Go).
- `packages/expo-react` was also written by hand (no generator), mirroring
  `web-react`'s package conventions (source-exports `package.json`, `nx.tags`,
  solution-style tsconfigs) with brace-expo's test setup (`jest-expo` preset +
  `babel-preset-expo`; the babel file is `.babelrc.cjs`, not `.js`, because
  the package is `"type": "module"`). Native modules it builds on
  (`expo-sqlite`, `expo-file-system`, `expo-secure-store`, NetInfo) are
  peerDependencies — brace-expo owns them so Expo autolinking sees them. The
  version each slot declares (root pins, everyone else defers) is
  [architecture.md](./architecture.md) — _dependency versions_.
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
  root `src/app/_layout.tsx` hosts the `QueryClientProvider`,
  `useQueryManagers()`, `StatusBar`, the `global.css` import, and renders a
  `<Stack>`. Safe-area context comes from expo-router's NavigationContainer
  (react-navigation's `SafeAreaProviderCompat`), so screens use `SafeAreaView`
  with **no explicit `SafeAreaProvider`** in `_layout`.
- **route tree — mirrors brace-web's `src/app/`.** Same `(group)` syntax as the
  Next.js App Router (a folder in parens adds **no** URL segment), so the layout
  is a near 1:1 port:

  ```
  src/app/
    _layout.tsx                  root Stack + providers
    index.tsx                    "/"  public landing (brace-web's page.tsx)
    (auth)/_layout.tsx           GuestGuard chrome  → TODO once auth lands
    (auth)/sign-in/index.tsx     /sign-in
    (auth)/create-account/index.tsx   /create-account
    (app)/_layout.tsx            AuthGuard + sync/lock providers → TODO
    (app)/links/index.tsx        /links
    (app)/settings/index.tsx     /settings  (+ future settings/[section].tsx)
  ```

  `page.tsx`→`index.tsx` and `layout.tsx`→`_layout.tsx` are the only renames.
  The auth gating (brace-web's `AuthGuard`/`GuestGuard`/`AuthedHomeRedirect`) is
  left as `TODO(auth)` comments in the three layouts + the landing — there is
  nothing to bind to until `@stxapps/expo-react` ships the auth layer; the
  expo-router idiom will be `<Redirect>` / `<Stack.Protected guard>`.

- **no `_`-private folders — the one real divergence from brace-web.** Every
  file under the app root becomes a route: expo-router's `getFileMeta` treats
  only `_layout`, `(group)`, `+api`, `+not-found`, and platform suffixes
  (`.ios`/`.web`) as special — it has **no** `_`-prefixed private-folder
  convention, so brace-web's colocated `(app)/links/_components`, `_hooks`,
  `_panes`, … would each become a bogus route (e.g. `/links/_components/foo`).
  So route files under `src/app/` stay **thin** and their UI lives **outside**
  the app root — `src/components/` (e.g. the shared `Screen` placeholder) and,
  as screens grow, `src/features/<name>/`. This is the same reason specs live
  outside `src/app/` (below).
- **babel**: nothing to add — `babel-preset-expo` (already in `.babelrc.js`) has
  the router transform built in (it's what injects `EXPO_ROUTER_APP_ROOT` and
  auto-detects `src/app`). Metro also needs no change; the existing
  `@expo/metro-config` base + the Uniwind/Nx wrappers are enough.
- **specs colocate with their source — _outside_ `src/app/`.** Every file under
  the app root becomes a route (expo-router's ignore list drops only
  `+html`/`+api`/`+middleware`/`+native-intent` — **not `*.spec.*`**), so a
  `.spec.tsx` beside a route file would be scanned as a bogus route. That costs
  nothing here: the workspace convention is already colocated specs
  (`foo.spec.ts` next to `foo.ts`, never a central dir), and brace-expo's real UI
  lives outside `src/app/` anyway (thin routes — see "no `_`-private folders"
  above). So each spec sits next to its component/feature: the landing UI is
  `src/components/landing.tsx` with `src/components/landing.spec.tsx` beside it,
  while the route `src/app/index.tsx` is a thin wrapper that renders `<Landing/>`.
  Specs thus distribute across `src/components`/`src/features`; they don't pile up
  in a central folder.
- **test _infra_ lives in `src/testing/`** (mirroring
  `packages/expo-crypto/src/testing/`): the jest `setup.ts` (expo / NetInfo /
  safe-area / uniwind mocks) and `css-mock.js` (the `*.css` → empty-module map),
  wired from `jest.config.cts` and the tsconfigs. `testing/` is for test
  **helpers only — never specs** (those colocate, above).
- **jest ignores build output.** `jest.config.cts` sets
  `testPathIgnorePatterns: ['/node_modules/', '/out-tsc/']`. Without the
  `out-tsc/` entry, `typecheck` (`tsc --build`) emits `*.spec.d.ts` under
  `out-tsc/`, and jest's default testMatch runs that `.d.ts` as an empty suite,
  failing with "must contain at least one test".
  - **Could specs live _inside_ `src/app/`?** Only in a `__tests__/` subfolder,
    never as loose `.spec.tsx`. Metro's default `resolver.blockList` (from
    `metro-config`'s exclusionList) is `[/\/__tests__\/.*/]`, and expo-router
    scans routes over Metro's file map (`matchFilesWithContext` →
    `_fileSystem.matchFiles`), which excludes blocklisted paths — so a
    `__tests__/` dir is invisible to the router. We don't use that (colocating
    beside the out-of-`app` source is simpler and matches the convention). Note
    there is **no** `(test|spec)` blocklist anywhere in Expo/Metro — the only
    Expo-added blockList entry is `.expo/types`; and the route-tree `ignore`
    option (`getRoutesCore`, fed from `Constants.expoConfig.extra.router`) can't
    be used from app config because its entries must be `RegExp` and that config
    is read from a serialized JSON manifest that can't carry one. The only
    non-route markers are the fixed set (`_layout`, `+not-found`, `+html`,
    `+native-intent`, `+middleware`, `+api`, plus `(group)`/`[param]`).

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
  same copy-into-the-app model), landing in `src/components/ui/` (the mirror of
  `packages/web-ui/src/components/ui/` — in the app, not a package: there is
  deliberately no `expo-ui` lib while brace-expo is the only expo app). But
  **the CLI doesn't work here — copy from the registry by hand.**
  `npx @react-native-reusables/cli@latest add <component>` resolves its write
  paths through tsconfig `paths` aliases (`tsconfig-paths`), and brace-expo has
  none — apps in this workspace use relative imports (web-ui only satisfied the
  shadcn CLI via its `@stxapps/web-ui/*` self-alias + package `exports`, which
  an app has no reason to grow). Even `--yes` still blocks on an interactive
  components.json prompt. So instead fetch the Uniwind variant straight from
  the registry the CLI reads —
  `https://reactnativereusables.com/r/uniwind/<component>.json` (`files[].content`)
  — write it to `src/components/ui/<component>.tsx`, and rewrite the
  `@/registry/uniwind/*` imports to relative (`../../lib/utils` for `cn` —
  which lives at `src/lib/utils.ts`, byte-identical to web-ui's — and `./text`
  etc. for registry siblings). Declare any `dependencies` the registry entry
  lists per the root-pin + app-`*` convention (done so far:
  `@rn-primitives/slot`, `class-variance-authority`, `clsx`, `tailwind-merge`).
  Keep the copy otherwise verbatim so future upstream diffs stay legible; local
  changes are flagged in a header comment per file (`text.tsx` carries
  `font-sans` in its base variant — see the font section). One jest catch:
  `@rn-primitives/*` ships raw JSX in its dist (expects the consumer's
  Metro/babel to transform, like RN packages), so `@rn-primitives` is in
  `jest.config.cts`'s `transformIgnorePatterns` allowlist. Components that
  animate will pull in `react-native-reanimated` / `react-native-worklets`
  (already installed, SDK 54-pinned at root).
- jest: `uniwind` is mocked (its className→style bridge needs the Metro
  transform / native runtime — the HOC becomes identity in tests) and `*.css`
  imports map to an empty module (`src/testing/css-mock.js`), alongside the
  official NetInfo and safe-area-context mocks, all in `src/testing/setup.ts` /
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
  `font-sans` must be applied where text renders — it lives in the
  react-native-reusables `Text` base variant (`src/components/ui/text.tsx`, a
  deliberate local addition to the registry copy), making Inter the app-wide
  default wherever that `Text` is used; only text rendered outside it needs an
  explicit `font-sans`.
- **verify a real build**: the embed only takes effect after a native build
  (`npx expo prebuild` + run on device/simulator) — it can't be exercised by
  jest or Metro alone.

#### runtime polyfills (brace-expo)

`@stxapps/shared`'s byte encodings (`crypto/encoding.ts`) call the standard
`atob`/`btoa`/`TextEncoder`/`TextDecoder` globals. On Hermes/Expo most are
already present — `TextEncoder` is built into Hermes and Expo's winter runtime
installs `TextDecoder` (`node_modules/expo/src/winter/runtime.native.ts`) — but
that runtime installs **neither `atob` nor `btoa`**, and Hermes ships neither
itself, so `base64ToBytes`/`bytesToBase64` would throw `ReferenceError` on
native. The app installs them once at startup in **`src/polyfills.ts`**,
imported for its side effects as the **first line of the native entries**
(`index.js` and the iOS extension's `index.share.js`), ahead of
`expo-router/entry` and the share root — so the side effect lands before any app
code (the router tree, including `_layout.tsx`) evaluates. (This used to be the
first import of `src/app/_layout.tsx`; it moved to the entries when the
`index.js` shim was added for the share extension — see
[share-sheet.md](./share-sheet.md) — which is the true process start and covers
both bundles, so `_layout.tsx` no longer imports it.) They're backed by
the **native** Buffer (`@craftzdog/react-native-buffer`, C++-fast) rather than
the pure-JS `base-64` lib, since the images that flow through base64 are
multi-hundred-KB — see the rationale in `packages/shared/src/crypto/encoding.ts`.
`@craftzdog/react-native-buffer` is declared in `apps/brace-expo/package.json`
so the app doesn't lean on hoist order — as `*`, with the version pinned once at
the workspace root (`^6.1.2`), the same root-pin + app-`*` convention the other
RN native deps use (`react-native-quick-base64`, `react-native-quick-crypto`).
This can only be exercised on a native build, not jest/Metro.

#### docs (future)

- npx nx g @nx/next:app apps/brace-docs

#### serwist

- npm install serwist -w @stxapps/brace-web
- npm install @serwist/next -w @stxapps/brace-web
- npm install @serwist/cli --save-dev -w @stxapps/brace-web

#### wrangler

- rm -rf apps/brace-api/.wrangler/state/v3/d1 or rm -rf apps/brace-api/.wrangler/state
- npx nx run brace-api:migrate
