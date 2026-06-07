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

#### expo (future)

- npx nx add @nx/expo
- npx nx g @nx/expo:app apps/brace-expo

#### docs (future)

- npx nx g @nx/next:app apps/brace-docs

#### dependencies

- npm install serwist -w @stxapps/brace-web
- npm install @serwist/next -w @stxapps/brace-web
- npm install @serwist/cli --save-dev -w @stxapps/brace-web
