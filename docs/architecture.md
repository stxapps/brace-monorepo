## architecture

Living reference for how the workspace is organized. See
[setup.md](./setup.md) for the one-time scaffold commands.

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
