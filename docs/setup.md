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
- Note: `jest-expo` ships a bin literally named `jest`, colliding with the real
  jest CLI in `node_modules/.bin` — whichever npm links last wins. The root
  `postinstall` (`tools/scripts/fix-jest-bin.mjs`) re-points the bin at the
  real jest 30 deterministically (every project, including brace-expo with the
  jest-expo _preset_, runs fine on it; only the _bin_ is the trap).

#### docs (future)

- npx nx g @nx/next:app apps/brace-docs

#### dependencies

- npm install serwist -w @stxapps/brace-web
- npm install @serwist/next -w @stxapps/brace-web
- npm install @serwist/cli --save-dev -w @stxapps/brace-web

#### wrangler

- rm -rf apps/brace-api/.wrangler/state/v3/d1 or rm -rf apps/brace-api/.wrangler/state
- npx nx run brace-api:migrate
