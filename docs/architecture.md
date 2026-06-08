## architecture

Living reference for how the workspace is organized. See
[setup.md](./setup.md) for the one-time scaffold commands,
[safe-area.md](./safe-area.md) for safe-area insets, viewport sizing, and popup
positioning, [local-first-sync.md](./local-first-sync.md) for the
local-first data path (local store + encrypted file sync),
[api-contracts.md](./api-contracts.md) for the contract-first endpoint pattern
(typed once in `@stxapps/shared`, shared by server and clients),
[account.md](./account.md) for the password-derived account model (key
derivation, username/password rules, the wallet comparison),
[env-files.md](./env-files.md) for per-app environment configuration across
`development` / `staging` / `production`, and [deployment.md](./deployment.md)
for the deploy tiers, infrastructure (Cloudflare + AWS), and CI flow.

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

#### @stxapps/web-crypto

- used by brace-web, brace-extension, and web-react
- web-only KDF, AES-256-GCM

#### @stxapps/web-react

- used by brace-web, brace-extension, brace-docs
- web-only React hooks/contexts/logic — the web-only sibling of `@stxapps/react`
  (same React-logic layer, but free to use browser-only APIs like IndexedDB and
  Web Crypto). Home for things shared across the web apps that aren't components
  (those live in `web-ui`) or pure crypto (that lives in `web-crypto`).

### dependency rules

Keep the dependency graph acyclic and layered. From lowest to highest:
`shared` → `web-crypto` → `web-react` → `web-ui` → apps. `web-crypto` sits
below the React-logic layer in the type dimension (so React logic may build on
crypto primitives), but because it's `platform:web` the only thing that
actually imports it there is the `platform:web` sibling `web-react` — the
platform-agnostic `react` can't reach it. `web-crypto` itself depends only on
`shared` and is also consumed directly by apps.

- `shared` must not import from any other workspace package.
- `react` may import `shared` and `web-crypto` (at the type layer) — not
  `web-ui`. In practice the platform-agnostic `react` lib still can't reach
  `web-crypto` (it's `platform:web`); only the `platform:web` sibling
  `web-react` does.
- `web-ui` may import `shared` and `react` — not the other way around.
- `web-crypto` may import `shared` only.
- `web-react` is the web-only sibling of `react` (same React-logic layer, but
  `platform:web`): it may import `shared`, `react`, and `web-crypto`. Apps
  consume it; `web-ui` does not.
- Apps may import any package; **packages must never import an app.**
- `web-ui`, `web-crypto`, and `web-react` are web-only — do not import them from
  code meant to run on Expo/native (`react` and `shared` stay platform-agnostic).

These rules are **enforced at lint time** by `@nx/enforce-module-boundaries`
(config in `eslint.config.mjs`) — an illegal import fails `npm run lint`.
Enforcement is driven by two tag dimensions set in each project's
`package.json` under `nx.tags`:

| project          | type          | platform            |
| ---------------- | ------------- | ------------------- |
| shared           | `type:shared` | `platform:agnostic` |
| react            | `type:react`  | `platform:agnostic` |
| web-ui           | `type:ui`     | `platform:web`      |
| web-crypto       | `type:crypto` | `platform:web`      |
| web-react        | `type:react`  | `platform:web`      |
| brace-web        | `type:app`    | `platform:web`      |
| brace-extension  | `type:app`    | `platform:web`      |
| brace-api        | `type:app`    | `platform:worker`   |
| brace-expo (fut) | `type:app`    | `platform:expo`     |

- **type** enforces the layering: a project may depend only on its own layer
  and lower ones (`app` → `ui` → `react` → `crypto` → `shared`). `crypto` sits
  below `react` so React logic can build on it, and is also consumed directly by
  apps (`app` → `crypto` → `shared`).
- **platform** enforces portability: `agnostic` may depend only on `agnostic`;
  `web`/`worker` may also use `agnostic` but not each other. (`worker` is the
  Cloudflare Workers runtime — web-standards, not Node — see `bundling
brace-api` below.)

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
`preserve`) — which is now the **`tsconfig.base.json` default** (`module:
esnext`, `moduleResolution: bundler`), so packages and apps inherit it without
per-project overrides. Only two projects override `module`: `packages/shared`
uses `module: preserve`, and `brace-api`'s `tsconfig.spec.json` drops to
`commonjs`/`node10` for ts-jest.

The same applies to **apps**: extensionless source only works if a bundler is
in the path. `brace-web` (Turbopack) and `brace-extension` (Vite/wxt) bundle by
nature. `brace-api` is bundled at build time too — see below — so it uses
`moduleResolution: bundler` and extensionless imports as well. Since every
current project is bundled, `bundler` is the base default rather than a
per-project override.

### bundling brace-api

`brace-api` runs on **Cloudflare Workers**, with `src/worker.ts`
(`export default app`) as the entry. **wrangler** bundles it (esbuild under the
hood), inlining the workspace `@stxapps/*` packages from source — the same way
the web apps consume them, so the extensionless internal imports resolve.
Third-party deps (`hono`, `@hono/zod-validator`) are inlined too, since Workers
has no `node_modules` at runtime. There is **no Node entry** — brace-api does not
run on Node, so there is no `main.ts` / `@hono/node-server`.

Targets live in `apps/brace-api/package.json` under `nx.targets` (the same place
brace-web/brace-extension keep theirs). Since no plugin infers `build`/`deploy`
for this app, each target declares `"executor": "nx:run-commands"` **explicitly**
— the bare `options.command` form only resolves when a plugin already provides
the target to merge onto (as `@nx/next` does for brace-web's `build`):

- **dev** — `wrangler dev --env development`: runs the Worker in a local runtime
  (workerd/miniflare) with **local emulation** of D1/R2 (state under
  `.wrangler/`). The local-only `development` env in `wrangler.jsonc` supplies
  `CORS_ORIGINS=http://localhost:3000`. Add `--remote` to run on a real edge
  preview against the real bindings instead. Bindings live only under `env.*`,
  so `--env` is required.
- **build** — `wrangler deploy --env staging --dry-run --outdir dist`: bundles
  and validates without deploying (no auth needed). Real deploys use the
  `deploy` target (`wrangler deploy --env staging|production`); see
  [deployment.md](./deployment.md).
- **typecheck** — `tsc` (wrangler/esbuild don't type-check); this is the type
  gate.

esbuild remains a single workspace-root devDependency for `@serwist/cli`'s
optional-peer service-worker build in `brace-web` (don't redeclare it per-app).
