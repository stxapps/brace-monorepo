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

#### nativewind + react-native-reusables (brace-expo)

The RN equivalent of the web tailwind + shadcn stack (see architecture.md —
_brace-expo_). Wiring (already done):

- deps: `nativewind` + `tailwindcss@~3.4.x` pinned **in
  `apps/brace-expo/package.json` with real versions** — the one deviation from
  the "app declares `*`, root holds the version" convention, because
  NativeWind v4 hard-requires Tailwind **v3** (`nativewind/dist/metro/tailwind`
  throws on v4) while the web projects use Tailwind v4. Consequently **no
  project relies on a root-hoisted `tailwindcss`**: `brace-web`,
  `brace-extension`, and `web-ui` each pin `tailwindcss@^4.x` themselves (they
  get nested v4 copies), and the root `overrides` entry
  (`nativewind > tailwindcss: ~3.4.19`) keeps nativewind's tailwind edge on v3
  no matter how npm hoists. If styling breaks after dependency surgery, check
  `require.resolve('tailwindcss', { paths: [<nativewind dir>] })` resolves v3.
- config: `tailwind.config.js` (nativewind preset; `content` must list any
  workspace package the app renders classNames from), `global.css` (tailwind
  directives, imported once in `index.js`), `.babelrc.js`
  (`jsxImportSource: 'nativewind'` + `nativewind/babel`), `metro.config.js`
  (`withNativeWind(..., { input: './global.css' })` wrapping `withNxMetro`),
  `nativewind-env.d.ts` + `jsxImportSource` in `tsconfig.app.json` for
  `className` types. NativeWind auto-adds `nativewind-env.d.ts` to the app's
  solution `tsconfig.json` `include` on first metro run — keep that edit.
- components come from **react-native-reusables** (the shadcn analogue —
  same copy-into-the-app model), added like shadcn on web:
  npx @react-native-reusables/cli@latest add <component>
  (run inside `apps/brace-expo`; components land in the app, not a package —
  there is deliberately no `expo-ui` lib while brace-expo is the only expo
  app). Components that animate will pull in `react-native-reanimated` /
  `react-native-worklets` (already installed, SDK 54-pinned at root).
- jest: the official mocks for NetInfo and safe-area-context are wired in
  `src/test-setup.ts` (the real modules need a native runtime).

#### docs (future)

- npx nx g @nx/next:app apps/brace-docs

#### dependencies

- npm install serwist -w @stxapps/brace-web
- npm install @serwist/next -w @stxapps/brace-web
- npm install @serwist/cli --save-dev -w @stxapps/brace-web

#### wrangler

- rm -rf apps/brace-api/.wrangler/state/v3/d1 or rm -rf apps/brace-api/.wrangler/state
- npx nx run brace-api:migrate
