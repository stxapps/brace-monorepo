## architecture

Living reference for how the workspace is organized. See
[setup.md](./setup.md) for the one-time scaffold commands and
[safe-area.md](./safe-area.md) for safe-area insets, viewport sizing, and popup
positioning.

### apps

- **brace-web** — Next.js web app
- **brace-extension** — browser extension (wxt)
- **brace-api** — backend API (hand-written, not nx-generated)
- **brace-expo** (future) — Expo mobile app
- **brace-docs** (future) — Next.js docs site

### libs

#### @stxapps/shared

- used by any app
- Types, constants, validation, pure utils

#### @stxapps/react

- used by brace-web, brace-extension, brace-expo, brace-docs
- hooks, contexts, React utilities, no-ui components

#### @stxapps/web-ui

- used by brace-web, brace-extension, brace-docs
- web-only ui components

#### @stxapps/web-crypto (future)

- used by brace-web and brace-extension
- web-only KDF, AES-256-GCM

### dependency rules

Keep the dependency graph acyclic and layered. From lowest to highest:
`shared` → `react` / `web-crypto` → `web-ui` → apps.

- `shared` must not import from any other workspace package.
- `react` may import `shared` only — not `web-ui`.
- `web-ui` may import `shared` and `react` — not the other way around.
- `web-crypto` may import `shared` only.
- Apps may import any package; **packages must never import an app.**
- `web-ui` and `web-crypto` are web-only — do not import them from code meant
  to run on Expo/native (`react` and `shared` stay platform-agnostic).

These rules are **enforced at lint time** by `@nx/enforce-module-boundaries`
(config in `eslint.config.mjs`) — an illegal import fails `npm run lint`.
Enforcement is driven by two tag dimensions set in each project's
`package.json` under `nx.tags`:

| project          | type          | platform            |
| ---------------- | ------------- | ------------------- |
| shared           | `type:shared` | `platform:agnostic` |
| react            | `type:react`  | `platform:agnostic` |
| web-ui           | `type:ui`     | `platform:web`      |
| web-crypto (fut) | `type:crypto` | `platform:web`      |
| brace-web        | `type:app`    | `platform:web`      |
| brace-extension  | `type:app`    | `platform:web`      |
| brace-api        | `type:app`    | `platform:node`     |
| brace-expo (fut) | `type:app`    | `platform:agnostic` |

- **type** enforces the layering: a project may depend only on its own layer
  and lower ones (`app` → `ui` → `react`/`crypto` → `shared`).
- **platform** enforces portability: `agnostic` may depend only on `agnostic`;
  `web`/`node` may also use `agnostic` but not each other.

When you add a new package, give it both a `type:` and a `platform:` tag, and
add a matching `type:crypto`-style constraint block if it's a new layer.

### module resolution in packages

Packages are `bundler=none` — apps consume their raw `.ts` source, so each
consuming bundler (Turbopack, Vite/wxt, Metro/Expo) resolves the package's
internal relative imports itself. Use **extensionless, bundler-style imports**
in package source:

```ts
// ✅ portable across every bundler that consumes the source
export * from './lib/theme';
// ❌ NodeNext convention — Turbopack/Metro resolve it literally and 404,
//    since the file on disk is theme.ts, not theme.js
export * from './lib/theme.js';
```

This requires `moduleResolution: bundler` (with `module: esnext` or
`preserve`) in the package's `tsconfig.lib.json` **and** `tsconfig.spec.json`.
The `@nx/react` generator sets this up already; `@nx/js` libs inherit
`nodenext` from `tsconfig.base.json`, so override it per-package (see
`packages/shared`).

The same applies to **apps**: extensionless source only works if a bundler is
in the path. `brace-web` (Turbopack) and `brace-extension` (Vite/wxt) bundle by
nature. `brace-api` is bundled at build time too — see below — so it uses
`moduleResolution: bundler` and extensionless imports as well. The base default
stays `nodenext`, but every current project overrides it to `bundler`.

### bundling brace-api

`brace-api` (Hono on Node) has no inherent bundler, so plain `tsc` output left
`import '@stxapps/shared'` as a bare specifier that Node resolved at runtime to
the package's raw `.ts` source — and crashed on the extensionless internal
imports (`ERR_MODULE_NOT_FOUND`). The fix is to **bundle the app** so workspace
packages are inlined, matching how the web apps consume them.

- **build** — `@nx/esbuild:esbuild` executor (config in
  `apps/brace-api/package.json` under `nx.targets`): `platform: node`,
  `format: ['esm']`, `bundle: true`, `thirdParty: false`. Workspace `@stxapps/*`
  packages get **inlined**; third-party deps (`hono`, `@hono/node-server`) stay
  **external** and resolve from `node_modules` at runtime.
- **dev** — `tsx watch src/main.ts` (esbuild under the hood; resolves source +
  extensionless directly, no build step).
- **typecheck** — still `tsc` (esbuild doesn't type-check); this is the type
  gate.

esbuild is a single workspace-root devDependency, shared by `@nx/esbuild`,
`brace-api`'s build, and `@serwist/cli`'s optional-peer service-worker build in
`brace-web` (don't redeclare it per-app).
