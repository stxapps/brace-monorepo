## architecture

Living reference for how the workspace is organized. See
[setup.md](./setup.md) for the one-time scaffold commands,
[safe-area.md](./safe-area.md) for safe-area insets, viewport sizing, and popup
positioning, [local-first-sync.md](./local-first-sync.md) for the
local-first data path (local store + encrypted file sync),
[client-queries.md](./client-queries.md) for the read edge (IndexedDB indexes,
liveQuery + virtual scrolling, and why pagination is growing-`limit` +
a decode cache),
[api-contracts.md](./api-contracts.md) for the contract-first endpoint pattern
(typed once in `@stxapps/shared`, shared by server and clients),
[account.md](./account.md) for the password-derived account model (key
derivation, username/password rules, the wallet comparison),
[iap.md](./iap.md) for subscriptions (Paddle checkout + webhook, the
entitlement fold, and the plan-aware quota gate),
[data-lifecycle.md](./data-lifecycle.md) for the whole-library data actions
(import/export — client-only by E2E necessity, the format matrix and dedup/
quota policy — and delete all data & delete account: the server-side wipe,
multi-device convergence via the sync fallback, and the username tombstone),
[link-extraction.md](./link-extraction.md) for how a saved link's
title/image/screenshot/archive get filled in (privacy-first, clients do the
work, the `extraction/` entity),
[extension.md](./extension.md) for the brace-extension auth flow (own sign-in,
no inherited session) and the move-shared-auth-code-later decision,
[env-files.md](./env-files.md) for per-app environment configuration across
`development` / `staging` / `production`, [deployment.md](./deployment.md)
for the deploy tiers, infrastructure (Cloudflare + AWS), and CI flow, and
[theme.md](./theme.md) for the light/dark theme model (four modes, the
sync/device split shared with link-layout, and the pre-paint FOUC script), and
[editors.md](./editors.md) for the link editors (create + full edit across the
extension and web) and the list/tag taxonomy UI — the shared `ListSelect`/
`TagsField` pickers, the invariants every editor upholds (copy-to-draft, input
validation, close guard), how the sidebar and the row menu's "Move to" couple to
the same trees, and bulk edit, and [search.md](./search.md) for the links-page
search subsystem (the URL⇄`LinkQuery` grammar, the `setSimpleQuery`/`setQuery`
writers, `selection` as a derived projection with a `none` state, and the
basic-box + advanced-popover UI — the read-side evaluation lives in
client-queries.md, the tiering in business-model.md), and
[share-sheet.md](./share-sheet.md) for the brace-expo share sheet (share from
Safari/Chrome → pick list/tags → save; the iOS App Group snapshot/outbox next
to a separate-process extension vs. Android's in-process translucent share
activity, and why sync converges either way).

### apps

- **brace-web** — Next.js web app
- **brace-extension** — browser extension (wxt)
- **brace-api** — backend API (hand-written, not nx-generated)
- **brace-extractor** — Cloudflare Workers + hono server that fetches
  link metadata (title/image; read-mode deferred) for clients that can't reach the
  URL themselves (`brace-web` without an extension, bulk imports). Its **own app on
  its own origin** `extractor.brace.to`, **separate from `brace-api`** (the blind sync
  broker) so that "`api.brace.to` only ever sees ciphertext" stays code-provable —
  the extractor is the one component that fetches arbitrary user URLs. A pure
  function (returns plaintext, holds no key, persists nothing — no D1/R2/DO
  bindings, only CORS config + rate limiters), anonymous, off-by-default and opt-in.
  Not "someday": the design **needs** it now that the extension is active-context
  only (no background bg-fetch), so web/desktop users have no other bulk-enrichment
  path. Two endpoints, contract-typed in `@stxapps/shared` (`extract/endpoints.ts`):
  `POST /v1/extract` (per-URL `{ title, image }` metadata) and `GET /v1/image` (a
  stateless, stream-don't-store image proxy). All arbitrary-URL fetches go through
  one `safeFetch` choke point — SSRF guard re-validated on every redirect hop,
  per-response byte ceiling, timeout, content-type allowlist. See
  [link-extraction.md](./link-extraction.md) — _server extraction_.
- **brace-expo** — Expo mobile app. The crypto/account layer is
  `@stxapps/expo-crypto` below; the RN-specific React logic lives in
  `@stxapps/expo-react` below (the local-first data layer is still to come).
  The client stack mirrors the web apps with the RN equivalents: **expo-router**
  for file-based routing (routes in `src/app/`, the analogue of brace-web's
  Next.js App Router — the same `(app)`/`(auth)` route groups and
  `layout`→`_layout`, `page`→`index` renames; entry is `expo-router/entry`, not
  a hand-written `registerRootComponent`. One divergence: expo-router has **no**
  `_`-private-folder convention, so unlike brace-web's colocated
  `_components`/`_panes`, screen code lives **outside** `src/app/` in
  `src/components`/`src/features` — every file under the app root is a route.
  See setup.md), **Uniwind**
  for Tailwind classes (styling — a Metro-plugin, Tailwind **v4** CSS-first
  binding; see the version note below), **react-native-reusables** for
  shadcn-style components (copied into the app via its CLI, like shadcn on web;
  the CLI auto-detects Uniwind vs NativeWind and pulls the matching component
  variant — there is no `expo-ui` package: with a single expo app, components
  live in the app until a second expo surface exists), **expo-sqlite + drizzle**
  as the Dexie analogue (drizzle's `useLiveQuery` ≈ Dexie `liveQuery`),
  **expo-file-system** for decrypted file blobs (see `expo-crypto`),
  **FlashList** in place of TanStack Virtual, and the same TanStack Query /
  react-hook-form / zod as web (TanStack Query's online/focus detection is
  browser-only, so `expo-react`'s `useQueryManagers` rewires it to
  NetInfo/AppState). Styling is now **Tailwind v4 across the whole workspace**:
  Uniwind requires Tailwind v4 (unlike NativeWind v4, which pinned Tailwind v3
  and forced a version split), so every Tailwind consumer — brace-expo plus
  each web project (`brace-web`, `brace-extension`, `web-ui`) — pins
  `tailwindcss@^4.x` itself; there is no root `overrides` split anymore
  (see setup.md).
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
- web-only crypto-global primitives: KDF, AES-256-GCM, and id minting
  (`newId`, a `crypto.randomUUID()` wrapper; brace-api keeps its own copy since
  it's `platform:worker` and can't import this `platform:web` package)
- also owns the **v1 blob frame** (`blob.ts` — `packBlob`/`unpackBlob` +
  `encryptEntity`/`decryptEntity`): the `[version(1) || iv(12) || ciphertext+tag]`
  wire/at-rest layout wrapped around the AES-256-GCM primitive. Lives here (not in
  `web-react`, whose sync engine is the caller) so the framing sits next to the
  primitive it frames and the golden-vector spec (below) can assert the real
  `unpackBlob`. On expo the same frame is produced two ways (see `expo-crypto`);
  web has no native content path, so this is its only framer.

#### @stxapps/expo-crypto

- used by brace-expo only
- expo-only crypto — the `platform:expo` sibling of `web-crypto`: the same
  account derivation pipeline (docs/account.md) and AES-256-GCM primitives,
  implemented on React Native. Heavy compute runs **native**: Argon2id, HKDF,
  and AES-GCM go through `react-native-quick-crypto` (C++ JSI/Nitro); Ed25519
  stays on the same `@noble/ed25519` as web (signing is microseconds, and
  sharing the library makes credential drift structurally impossible). Also
  ships the **`BraceFileCrypto` Expo native module** (`ios/` Swift CryptoKit,
  `android/` Kotlin `javax.crypto`, autolinked by `expo prebuild`): whole-file
  encrypt/decrypt path-to-path in the native layer, reading/writing the frozen
  v1 blob frame — file bytes never enter the JS heap; the app stores content
  DECRYPTED on device (the Dexie-`data` analogue) and e.g. `expo-image` renders
  straight from the plaintext `file://` path. The **small ENTITY blobs** take the
  JS-side path instead: `blob.ts` (`packBlob`/`unpackBlob` + `encryptEntity`/
  `decryptEntity`, the sibling of `web-crypto`'s) frames the identical v1 layout
  in JS over the `react-native-quick-crypto` AES — so the same wire frame is
  produced on whichever side of the JSI boundary suits the payload size (native
  for `files/` content, JS for KB-sized entity JSON). The frozen parameters stay
  in `shared`; the golden vectors (`shared` `crypto/contract-vectors.ts`) are asserted by
  both this package's and `web-crypto`'s specs, so "web and native derive
  identical keys/blobs" is CI-proven. One deliberate divergence: the account's
  `encryptionKey` is raw bytes, not a non-extractable `CryptoKey` (native has
  no such handle) — at-rest protection is `expo-secure-store`'s job.

#### @stxapps/web-react

- used by brace-web, brace-extension, brace-docs, web-ui (auth forms)
- web-only React hooks/contexts/logic — the web-only sibling of `@stxapps/react`
  (same React-logic layer, but free to use browser-only APIs like IndexedDB and
  Web Crypto). Home for things shared across the web apps that aren't components
  (those live in `web-ui`) or pure crypto (that lives in `web-crypto`). In
  particular it owns the **local-first stack** shared by brace-web and
  brace-extension: the auth + sync providers (`contexts/`), the Dexie store and
  data layer (`data/`), the hand-rolled sync engine (`sync/`), and the
  editor/auth hooks (`hooks/`). These reach the API through `useApiClient()` /
  `SyncDeps.api` — the `@stxapps/react` seam each app binds to its own baseUrl —
  so nothing here imports an app's `process.env`.

#### @stxapps/expo-react

- used by brace-expo only
- expo-only React hooks/contexts/logic — the `platform:expo` sibling of
  `web-react` (same React-logic layer, but free to use React Native and Expo
  APIs). Home of the brace-expo local-first stack as it gets built: the
  expo-sqlite + drizzle store and data layer, the sync-engine bindings, and
  the editor/auth hooks — plus what exists today: the session store
  (`data/session-store.ts`, web-react's sibling — expo-secure-store-backed
  since the key is raw bytes; `AFTER_FIRST_UNLOCK` for background sync, plus a
  sandbox sentinel file so an iOS reinstall doesn't resurrect the Keychain's
  old session), the first slice of the expo-sqlite + drizzle store
  (`data/db.ts` — lazy-opened, change-listener on for drizzle's `useLiveQuery`,
  idempotent DDL per the greenfield no-migrations policy — holding the `locks`
  table behind `data/lock-store.ts`, web lock-store's sibling; lock verifiers
  are deliberately NOT in secure-store — they're one-way PBKDF2 pairs gating
  already-decrypted data, and the pure covering logic both platforms share is
  `computeCoverage` in `@stxapps/shared` `sync/lock-coverage.ts`), and
  `useQueryManagers` (rewires TanStack Query's browser-only
  online/focus managers to NetInfo and AppState). Native modules it builds on
  (`expo-sqlite`, `expo-file-system`, `expo-secure-store`, NetInfo) are
  **peerDependencies** — the
  app owns them so Expo autolinking sees them (the same pattern `expo-crypto`
  uses for `react-native-quick-crypto`).

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
- `web-ui` may import `shared`, `react`, and `web-react` (it's the UI layer,
  above the React-logic layer) — not the other way around. Most `web-ui`
  components are presentational and don't reach for `web-react`, but the auth
  forms (`components/auth/*`) do: they pair the shared field UI with the
  `useSignIn` / `useCreateAccount` submit hooks that live in `web-react`.
- `web-crypto` may import `shared` only.
- `expo-crypto` is the `platform:expo` sibling of `web-crypto` (same crypto
  layer): it may import `shared` only. Only `brace-expo` (and future
  `platform:expo` React-logic packages) can consume it.
- `web-react` is the web-only sibling of `react` (same React-logic layer, but
  `platform:web`): it may import `shared`, `react`, and `web-crypto`. Apps and
  `web-ui` (for the auth forms) consume it; it must not import `web-ui`.
- `expo-react` is the `platform:expo` sibling of `web-react` (same React-logic
  layer): it may import `shared`, `react`, and `expo-crypto`. Only `brace-expo`
  consumes it.
- Apps may import any package; **packages must never import an app.**
- `web-ui`, `web-crypto`, and `web-react` are web-only — do not import them from
  code meant to run on Expo/native; `expo-crypto` and `expo-react` are
  expo-only — do not import them from web/worker code (`react` and `shared`
  stay platform-agnostic).

These rules are **enforced at lint time** by `@nx/enforce-module-boundaries`
(config in `eslint.config.mjs`) — an illegal import fails `npm run lint`.
Enforcement is driven by two tag dimensions set in each project's
`package.json` under `nx.tags`:

| project         | type          | platform            |
| --------------- | ------------- | ------------------- |
| shared          | `type:shared` | `platform:agnostic` |
| react           | `type:react`  | `platform:agnostic` |
| web-ui          | `type:ui`     | `platform:web`      |
| web-crypto      | `type:crypto` | `platform:web`      |
| expo-crypto     | `type:crypto` | `platform:expo`     |
| expo-react      | `type:react`  | `platform:expo`     |
| web-react       | `type:react`  | `platform:web`      |
| brace-web       | `type:app`    | `platform:web`      |
| brace-extension | `type:app`    | `platform:web`      |
| brace-api       | `type:app`    | `platform:worker`   |
| brace-extractor | `type:app`    | `platform:worker`   |
| brace-expo      | `type:app`    | `platform:expo`     |

- **type** enforces the layering: a project may depend only on its own layer
  and lower ones (`app` → `ui` → `react` → `crypto` → `shared`). `crypto` sits
  below `react` so React logic can build on it, and is also consumed directly by
  apps (`app` → `crypto` → `shared`).
- **platform** enforces portability: `agnostic` may depend only on `agnostic`;
  `web`/`worker`/`expo` may also use `agnostic` but never each other. (`worker`
  is the Cloudflare Workers runtime — web-standards, not Node — see `bundling
brace-api` below; `expo` is React Native/Hermes — no DOM, no Web Crypto.)

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
- **typecheck** — `tsc --noEmit` (wrangler/esbuild don't type-check); this is the
  type gate. Declared as an explicit `typecheck` **npm script** in
  `package.json` (`tsc --noEmit -p tsconfig.app.json && … -p tsconfig.spec.json`,
  app sources then specs) rather than left to the `@nx/js/typescript` plugin's
  inferred target: that inferred target is `tsc --build`-based and auto-disables
  itself into a green-exiting `echo` whenever a referenced tsconfig sets
  `noEmit: true` — which `tsconfig.spec.json` does (you don't emit test files).
  Left inferred, `npm run typecheck` would silently skip brace-api. An npm script
  named `typecheck` overrides the inferred target (the same reason brace-web's own
  `tsc --noEmit` script works), so nx runs the real `tsc`.

  Both passes are **self-contained — no prior build required.** `tsconfig.spec.json`
  deliberately **compiles the app sources directly** (`include: src/**/*.ts`) instead
  of pulling app types via a project `reference` to the composite `tsconfig.app.json`.
  A `tsc -p` reference resolves the referenced composite project's types from its
  emitted `dist/*.d.ts` — which this `--noEmit` typecheck never writes — so a
  reference made `npx nx typecheck @stxapps/brace-api` fail with `TS6305` on a clean
  clone or after any add/move/rename/delete under `src` (stale `dist/`). Compiling
  from source removes that `dist/` dependency entirely. The split still pulls its
  weight: the **app pass** (`tsconfig.app.json`, Workers-only types, no `node`) is
  the portability gate on app source; the **spec pass** adds the specs and
  `node` / `cloudflare:test` types. **Do not re-add the `references` block to
  `tsconfig.spec.json`** — it reintroduces the prebuilt-`dist/` requirement.

esbuild remains a single workspace-root devDependency for `@serwist/cli`'s
optional-peer service-worker build in `brace-web` (don't redeclare it per-app).
