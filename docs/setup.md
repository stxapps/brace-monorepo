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

#### app config — `app.config.ts`, not `app.json` (brace-expo)

The generator scaffolds a static `app.json`; this app uses the **dynamic TS
config** instead (`apps/brace-expo/app.config.ts`, a plain
`const config: ExpoConfig = {…}; export default config`, the same shape the old
app used). Expo reads either, and `app.config.ts` wins when both exist — so the
rename is the whole migration; nothing in the workspace reads the file
statically (`@nx/expo`'s executors shell out to the Expo CLI).

**One reason, and it's a correctness one:** `ios.appleTeamId` has to come from
the environment, and JSON has no interpolation — the JSON version carried the
literal string `"process.env.APPLE_TEAM_ID"`, which `withDevelopmentTeam` wrote
verbatim into `DEVELOPMENT_TEAM` for every native target. See
[env-files.md](./env-files.md) — _the one non-`EXPO_PUBLIC_` var_ — for where
`APPLE_TEAM_ID` lives and why it's `.env.local`.

Two gotchas if you touch this:

- **`tsconfig.app.json` excludes it.** The config file must sit at the project
  root, but that tsconfig's `include` glob is `**/*.ts` against
  `rootDir: "src"` — left in, `tsc --build` fails with TS6059. (The other
  root-level config files escape only because they're `.js` and `allowJs` is
  off.) So it isn't covered by `nx typecheck`; its `ExpoConfig` annotation plus
  `npx expo config --type prebuild` is the check. Run the latter after editing.
- **A config change needs `npx expo prebuild`** to reach the native projects,
  like any config-plugin change.

#### expo-image-picker + expo-image-manipulator (brace-expo)

The edit screen's custom-image flow (pick + client-side resize —
docs/editors.md, invariant 2). Added like expo-router below:

    npx expo install expo-image-picker expo-image-manipulator

(run inside `apps/brace-expo`; then move each to `*` in the app and pin the
real version in the root `package.json`, per the normal convention).
`expo-image-manipulator` is also a peerDependency `*` of `@stxapps/expo-react`
(its `lib/image.ts` — the NetInfo/expo-sqlite pattern). `app.config.ts`
carries the `expo-image-picker` config plugin with a `photosPermission`
string. Both are native modules — `npx expo prebuild` required. This section's
own image surface — the edit screen's preview — deliberately stays on **core RN
`Image`**, and so does `lib/image.ts`'s `probeImageSize`; `expo-image` (below)
arrived for the link LIST's slots only, and neither reason it was added reaches
here.

#### expo-image (brace-expo)

The renderer behind the link list's media slots — favicons and preview images
(`src/features/links/link-media.tsx`, whose header is canonical). Added per the
normal convention: `*` in the app, the real pin in the root `package.json`
(`~3.0.11` — the version `expo/bundledNativeModules.json` names for SDK 54).
Native module — `npx expo prebuild` required. Two things bought it, and NEITHER
is the usual reason to reach for it:

- **`recyclingKey`.** The list is a FlashList, which RECYCLES item views. Core RN
  `Image` keeps painting the previous source until the new one decodes, so a fast
  scroll flashes the wrong thumbnail on the row it's recycling into;
  `recyclingKey` blanks the view when the key changes. This is the FlashList
  docs' own recommendation for images in recycled cells.
- **SVG decoding** — `SDWebImageSVGCoder` on iOS, `androidsvg` on Android, both
  content-sniffed rather than extension-driven (the favicon cache writes
  extension-less files, so that matters). This is what lets the icon sniff accept
  `<link rel="icon" type="image/svg+xml">` at all; see
  [link-extraction.md](./link-extraction.md) — _favicons_.

What did **not** buy it: remote fetching, disk caching, placeholders,
transitions. Every source here is a local plaintext `file://` path this app
already wrote, which constrains one prop — **no slot may use `cachePolicy:
'disk' | 'memory-disk'`**, since that duplicates the user's image library into a
second on-device copy. Preview images use `'memory'` (a file id is immutable, so
a uri-keyed cache can't go stale, and it pays for the re-decode as rows recycle
back into view); favicons use `'none'` (the per-host path is stable while its
bytes are **replaceable** — the declared-icon capture landing over the guessed
`/favicon.ico` — so any uri-keyed cache would go on serving the superseded icon).

Two wiring notes: expo-image's `Image` is a composite, not a core RN host, so it
needs `withUniwind()` to accept `className` (the `SafeAreaView` treatment —
_uniwind_ above), and `resizeMode` is spelled `contentFit`. No jest mock is
wired, because no spec renders these slots today; add one in
`src/testing/setup.ts` (the uniwind/NetInfo pattern) if that changes. The SVG
path can only be exercised on a device build.

#### expo-iap (brace-expo)

Store IAP for the subscription section (docs/iap.md — the store purchase flow).
`expo-iap` is the OpenIAP successor to the deprecated react-native-iap (same
maintainer; the old repo is archived). Added per the normal convention: `*` in
the app, real pin (`^4.7.0`) in the root `package.json`. Its config plugin is in
`app.config.ts` (`expo-iap` — it wires the Android BILLING permission and the
native OpenIAP SDKs), and it's a native module — `npx expo prebuild` required;
the store sheet itself only works on a real device/simulator with a store
account (jest/Metro can't exercise it). No API keys on the client: server-side
verification config lives in brace-api's `wrangler.jsonc` (docs/iap.md — config
per env).

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
plugin to the app config. Wiring (already done):

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
- **plugin**: `["expo-font", { fonts: ["./assets/fonts/InterVariable.ttf"] }]`
  in `app.config.ts` — picked up on `npx expo prebuild` (the dev client is already
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

#### android release minification — R8 (brace-expo)

Release Android builds run **R8** (shrink + obfuscate) with resource shrinking,
via the `expo-build-properties` plugin in `app.config.ts`:

    ["expo-build-properties", { android: {
      enableMinifyInReleaseBuilds: true,
      enableShrinkResourcesInReleaseBuilds: true } }]

Both are **off by default** — the prebuild template reads
`findProperty('android.enableMinifyInReleaseBuilds') ?: false`, so without this
block `minifyEnabled` is false and any proguard rule anywhere is inert.
`enableShrinkResourcesInReleaseBuilds` **requires** the minify flag (the plugin
throws otherwise). Debug builds are unaffected; `expo-build-properties` is a
prebuild-time config plugin, so a change here needs `npx expo prebuild`.

**Deliberately no `extraProguardRules`.** The old app
(`brace-client/packages/expo/app.config.ts`) carried ~25 hand-written lines;
none of them should be ported, because every one is either dead or now shipped
by the library itself as `consumerProguardFiles` (R8 merges those from each AAR
automatically):

| old rule                                       | why it's not here                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `com.horcrux.svg.**`                           | shipped by `react-native-svg/android/proguard-rules.pro` (same line, verbatim) |
| Glide / `AppGlideModule` / `ImageHeaderParser` | was for `react-native-fast-image` (not used); `expo-image` ships a superset    |
| `com.facebook.jni.**`, `animal_sniffer`        | shipped by `react-native/ReactAndroid/proguard-rules.pro`                      |
| `com.facebook.hermes.unicode.**`               | that Java package no longer exists in RN 0.81 — dead rule                      |
| okhttp `PublicSuffixDatabase`, conscrypt       | shipped in okhttp's own AAR consumer rules (4.x+)                              |
| MMKV block                                     | not a dependency (expo-sqlite + expo-secure-store instead)                     |
| bouncycastle, slf4j                            | Blockstack-only — gone with the password-derived account model                 |

Our own native code is covered the same way: `expo-modules-core`'s consumer
rules keep every `expo.modules.kotlin.modules.Module` subclass, which is what
`BraceFileCryptoModule` (the `BraceCrypto` pod's Kotlin side) is.

**No nitro keep rule either — and specifically not
`-keep class com.margelo.nitro.** { *; }`.** `react-native-nitro-modules` is
the one dependency here that ships no consumer proguard file, so it looks like
the exception. It isn't, for two checked reasons:

- **`react-native-quick-crypto` has no Java/Kotlin classes for R8 to strip.**
  Nitro resolves a hybrid object one of two ways, and only the Kotlin-backed
  one goes through JNI `findClassStatic` by name (`DefaultConstructableObject`,
  invisible to R8). Every one of quick-crypto's ~30 hybrids takes the **C++**
  path — `QuickCryptoOnLoad.cpp` registers each as
  `std::make_shared<HybridArgon2>()` etc., with zero `JHybrid` references. Its
  whole JVM surface is one `QuickCryptoPackage.java` that calls
  `System.loadLibrary`, reached from the generated `PackageList` (so R8 sees
  it). R8 does not touch the `.so`.
- **Nitro's own runtime Kotlin classes are already annotated.**
  `HybridObject`, `Promise`, `ArrayBuffer`, `AnyMap`, `AnyValue`,
  `NativeRunnable`, `ThreadUtils`, and `NitroModules` all carry
  `@com.facebook.proguard.annotations.DoNotStrip` + `@androidx.annotation.Keep`
  — kept by RN's consumer rules and AGP's default `proguard-android.txt`
  respectively. A blanket `com.margelo.nitro.**` keep would add nothing but
  would suppress obfuscation across the package.

So the keep-set stays empty, and each future addition should name the crash it
fixes. That's affordable because **nitro's failure mode is self-diagnosing**:
if a Kotlin-backed hybrid ever is stripped (a future nitro module, or if
`@stxapps/expo-crypto` grows one), the thrown message is literally
_"Couldn't find class `X`! … If you are using ProGuard, add `@Keep` and
`@DoNotStrip` annotations"_ — and note it prescribes annotating the class, not
a blanket keep.

**Only a real release build exercises this** — not jest, not Metro, not `expo
run:android` (debug). Until brace-expo has a release/EAS pipeline
(docs/deployment.md doesn't cover mobile yet), this is configured but unproven;
verify with a release build before the first store submission.

#### docs (future)

- npx nx g @nx/next:app apps/brace-docs

#### serwist

- npm install serwist -w @stxapps/brace-web
- npm install @serwist/next -w @stxapps/brace-web
- npm install @serwist/cli --save-dev -w @stxapps/brace-web

#### wrangler

- rm -rf apps/brace-api/.wrangler/state/v3/d1 or rm -rf apps/brace-api/.wrangler/state
- npx nx run brace-api:migrate
