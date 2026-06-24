## api contracts

How brace-api endpoints are typed and shared across the server and every client.
See [architecture.md](./architecture.md) for the package layering and
[local-first-sync.md](./local-first-sync.md) for how the background sync engine
and TanStack Query sit on top of this contract layer.

### the decision: contract-first, not Hono RPC

Every endpoint is described **once** in `@stxapps/shared` as a `defineEndpoint`
descriptor plus zod request/response schemas. The server reads that descriptor
to validate requests and type responses; every client reads the same descriptor
to build a typed call. Nobody imports `brace-api`.

**Why not Hono's `hc<AppType>` RPC client?** It infers types from the brace-api
app instance, forcing clients to `import type { AppType } from '@stxapps/brace-api'`.
That's an `app → app` edge **and** a `web → node` edge — both forbidden by the
Nx `type:` / `platform:` boundaries in `eslint.config.mjs` (see
[architecture.md](./architecture.md)). The hand-written contract keeps every
dependency arrow pointing **down** at `shared`.

### where the pieces live

All in `packages/shared/src`, exported through the package barrel
(`src/index.ts`) — consumers always import from `@stxapps/shared`, never from
internal paths:

- **`api/endpoint.ts`** — the `defineEndpoint` primitive + `ApiEndpoint` type.
- **`api/client.ts`** — the platform-agnostic typed client: `callEndpoint`
  (GET/DELETE → query string, else JSON body; takes an optional `{ signal }` for
  cancellation), `createApiClient` (binds a `baseUrl` once so call sites stay
  terminal: `api.call(endpoint, input)`), and `ApiError`.
- **`auth/credentials.ts`** — pure, reusable field validators (`usernameSchema`,
  `passwordSchema`, the sign-in / create-account form schemas).
- **`auth/endpoints.ts`** — the auth endpoint contracts (e.g.
  `checkUsernameEndpoint`), whose request schemas reuse the validators from
  `auth/credentials.ts` so a rule like username length is defined exactly once
  and enforced identically on client and server.

### url versioning

Every API path is versioned with a `/v1` prefix, built from the `API_V1`
constant in `api/endpoint.ts`:

```ts
path: `${API_V1}/auth/username-available`, // → /v1/auth/username-available
```

The version is **part of the wire contract**, so it lives in the contract path
(in `shared`) rather than in each client's `baseUrl`. That's not just stylistic:
the client does `new URL(endpoint.path, baseUrl)`, and a leading-slash path
**discards** any path segment on `baseUrl` — so `NEXT_PUBLIC_API_URL=…/v1` would
be silently dropped. Keeping `/v1` in the path also means the server inherits it
for free (`routes/auth.ts` mounts `checkUsernameEndpoint.path` verbatim), and the
single descriptor still fully describes the wire URL.

Why version at all: the extension and a future Expo app are long-lived clients
whose update cadence we don't control. URL versioning lets an old client stay
pinned to `/v1` while the web app moves to `/v2`. Bumping means adding an
`API_V2` constant and migrating paths endpoint-by-endpoint. Operational roots
(`/`, `/health`) stay **unversioned** — `app.ts` mixes both by mounting versioned
sub-apps alongside the bare root routes.

### assembling the client (the injection seam)

The contract above says how to *call* brace-api; this is how a running app gets a
*configured* client into its hooks. It's a dependency-inversion seam — each layer
adds one concern and refuses to know the next one up, so the only thing that knows
the runtime URL is the app:

| layer | piece | adds | deliberately doesn't know |
| ----- | ----- | ---- | ------------------------- |
| `shared` | `createApiClient({ baseUrl, fetch? })` | the typed transport (contracts → `fetch`) | auth, React, the environment |
| `react` | `ApiClientProvider` / `useApiClient` | a React **seam** — a context hole the hooks read | which client, which baseUrl |
| `web-react` | `createAuthApiClient({ baseUrl })` | bearer-token `authFetch` (+ the mid-session 401/expiry → `notifySessionInvalid` loop, reading `session-store`) | the environment |
| app | `const baseUrl = <env>; api = createAuthApiClient({ baseUrl })` | the **one** concrete client + provides it | — (it's the top) |

Why the seam exists: the query/mutation hooks in `@stxapps/react` need *a* client,
but importing one would drag an app's env var into a package — forbidden by the
`type:`/`platform:` boundaries. So the hooks read `useApiClient()` from context and
the app injects the concrete client via `<ApiClientProvider client={api}>`. Same
hooks run unchanged in brace-web, brace-extension, and future brace-expo.

Why `baseUrl` stays in the app: auth is shared across the web apps (so it lives in
`web-react`), but the URL is resolved from a **bundler-inlined** env var that
differs per app — `process.env.NEXT_PUBLIC_API_URL` (Next) vs
`import.meta.env.WXT_PUBLIC_API_URL` (wxt) — and the literal access must stay in
app code for the bundler to inline it. See [env-files.md](./env-files.md).

Two consumption paths, one client. A web app has only the React tree
(`<ApiClientProvider client={api}>` in `inner-layout.tsx` / popup `providers.tsx`).
The extension also runs a **background service worker** that isn't React, so it
can't use `useApiClient()` — instead `utils/sync-runner.ts` imports the same `api`
and hands it to the sync engine as `SyncDeps.api`. That's the reason
`createAuthApiClient` is a plain factory in `web-react` rather than a React hook:
it has to be callable from a non-React module too. Both paths share one in-memory
session mirror, so the bearer token stays consistent.

### adding an endpoint

1. **Contract** — in `packages/shared/src/<area>/endpoints.ts`, define the
   request/response zod schemas and a `defineEndpoint({ method, path, request,
response })` descriptor — prefix `path` with `` `${API_V1}/…` `` (see _url
   versioning_ above). Reuse pure validators from `<area>/credentials.ts`
   (or a sibling) rather than re-declaring field rules. It's exported
   automatically via the barrel — add an `export *` line in `src/index.ts` if the
   file is new.

2. **Server** — in `apps/brace-api/src/routes/<area>.ts`, build a `Hono()`
   sub-app whose route uses the contract's own `endpoint.path`, validates with
   `zValidator('query' | 'json', endpoint.request)`, and types the payload as the
   contract's response type so the handler fails to compile if the shape drifts.
   Mount it in `app.ts` via `app.route('/', <area>Routes)`. (CORS lives in
   `app.ts` — `CORS_ORIGINS`, default `http://localhost:3000`, the web dev port.)

3. **Client** — call `api.call(endpoint, input)`. `api` is the per-app client
   from `createAuthApiClient` (`apps/brace-web/src/lib/api.ts` with
   `NEXT_PUBLIC_API_URL`, `apps/brace-extension/utils/api.ts` with
   `WXT_PUBLIC_API_URL`; both default the dev URL to `http://localhost:8787`) —
   see _assembling the client_ above. Components should go through the TanStack
   Query hooks in `@stxapps/react` (which wrap `callEndpoint` via
   `useApiClient()`); the background sync engine calls through `SyncDeps.api`. See
   [local-first-sync.md](./local-first-sync.md) for that dividing line.
