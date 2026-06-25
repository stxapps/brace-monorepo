## env files

How each app gets its configuration per environment. There are **three
environments everywhere**, with the same names across every app and (eventually)
every piece of infrastructure:

| name          | what it is                          |
| ------------- | ----------------------------------- |
| `development` | local dev on your machine           |
| `staging`     | the testing deploy (pre-production) |
| `production`  | the live deploy                     |

`development` is the odd one out conceptually: it's the local mode the bundlers
already call "development", not a deploy target. The two deploy tiers are
`staging` and `production` — use exactly those two words everywhere (env files,
Nx configurations, wrangler envs, bucket / D1 names, domains, CI) so nothing
drifts.

For the infrastructure `staging` and `production` deploy onto (the two
Cloudflare accounts, the two AWS CloudFront distributions, custom domains), see
`deployment.md` — a separate doc, because that's infra/tech-stack, not config.

### the one constraint that explains everything: bake-time vs run-time

- **brace-web** (Next.js static export) and **brace-extension** (packaged
  extension) **inline their public vars at _build_ time** — the value is frozen
  into the shipped artifact. So each environment is a _separate build_, and
  **nothing here can be secret**: every var ends up in code the client
  downloads. These apps use `.env` files.
- **brace-api** reads its config **at _run_ time** from the host (Node
  `process.env` today, Cloudflare Workers bindings later). This is where secrets
  live, and they are **never committed and never bundled**. This app uses
  host-provided vars/secrets, not committed `.env` files.

So: frontends → build-time `.env` files; backend → runtime host config. The rest
of this doc is just the per-app spelling of that.

### brace-web — Next.js, static export (implemented)

Next.js auto-loads `.env.<mode>` from the app dir based on `NODE_ENV`. Public
vars need the **`NEXT_PUBLIC_`** prefix and are baked into the static bundle.

`staging` is the wrinkle: it is a _production-mode_ build (`NODE_ENV=production`,
same as `production`), so Next can't pick it by mode. Nx supplies it via the
**`envFile`** option on the build target's `staging` configuration. `envFile` is
an **Nx `run-commands` option, not a Next feature** — Nx loads the file into
`process.env` before `next build` runs, and that overrides Next's
auto-loaded `.env.production`.

Files in `apps/brace-web/` (committed except `*.local`):

| file               | used by                         | loaded by    |
| ------------------ | ------------------------------- | ------------ |
| `.env.development` | `nx dev brace-web`              | Next (auto)  |
| `.env.production`  | `nx build brace-web`            | Next (auto)  |
| `.env.staging`     | `nx build brace-web -c staging` | Nx `envFile` |

Current var: `NEXT_PUBLIC_API_URL` → the matching brace-api URL. Adding a new
var = add the line to all three files (the symmetry is deliberate: there is no
config hiding in `package.json`).

### brace-extension — wxt / Vite (implemented)

wxt builds through Vite, which loads `.env` / `.env.<mode>`. Public vars need the
**`WXT_PUBLIC_`** prefix and are read via `import.meta.env.WXT_PUBLIC_*` — baked
into the bundle just like brace-web. The mode is chosen with `--mode`, and unlike
brace-web's `staging` (which needs the Nx `envFile` indirection because Next
can't pick a production-mode build by mode) wxt selects the file natively:

| command                    | mode          | env file           |
| -------------------------- | ------------- | ------------------ |
| `wxt` (dev)                | `development` | `.env.development` |
| `wxt build`                | `production`  | `.env.production`  |
| `wxt build --mode staging` | `staging`     | `.env.staging`     |

Files in `apps/brace-extension/` (all committed — every value is public):

| file               | used by                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `.env.development` | `nx dev @stxapps/brace-extension`                                         |
| `.env.production`  | `nx build @stxapps/brace-extension`                                       |
| `.env.staging`     | `nx build:staging @stxapps/brace-extension` (and `build:firefox:staging`) |

Current var: `WXT_PUBLIC_API_URL` → the matching brace-api URL.

**Two consumers, one source of truth.** Unlike brace-web (one consumer,
`lib/api.ts`), the extension reads the URL in two places that must never drift —
the manifest `host_permissions` grant has to match the origin the client fetches,
or the MV3 background worker's CORS-exempt requests break. Both derive from the
same `WXT_PUBLIC_API_URL`:

- `utils/api.ts` reads `import.meta.env.WXT_PUBLIC_API_URL` (bundled context).
- `wxt.config.ts` can't use `import.meta.env` in its `manifest` function (it runs
  at config time, before the bundle env exists), so it reads the same `.env.<mode>`
  via Vite's `loadEnv(mode, process.cwd(), 'WXT_PUBLIC_')` and derives the host
  match pattern as `new URL(apiUrl).origin + '/*'`.

Both throw if the var is unset, mirroring brace-web's missing-`NEXT_PUBLIC_API_URL`
guard. The `staging` build is a plain `--mode staging` npm script + Nx target
(`build:staging`, `build:firefox:staging`) — no Nx `envFile` needed.

### brace-api — Hono on Cloudflare Workers

Server-side: config is read at **runtime**, never baked. brace-api runs **only**
on Workers (`src/worker.ts`, `export default app`) — there is no Node entry.

**Config read.** `src/app.ts` resolves `CORS_ORIGINS` per-request:
`c.env.CORS_ORIGINS` (the Workers binding) first, then the `[]`
default. On Workers `c.env` is the source; the `process.env` fallback only covers
non-Workers callers like `app.request()` in jest tests. `globalThis.process`
(not bare `process`) keeps it safe on Workers, which has no `process` global.

**Per-environment values live in `wrangler.jsonc`**, as three wrangler
environments matching the project's tiers — `development` / `staging` /
`production` (staging & production each pin their own Cloudflare account via
`account_id`; `development` has none — it's never deployed):

- non-secret vars (e.g. `CORS_ORIGINS`) → `vars` under each `env.*`. The
  `development` env sets `CORS_ORIGINS=http://localhost:3000` so local dev needs
  no extra file.
- secrets → `wrangler secret put <NAME> --env staging|production` (never
  committed).
- D1 / R2 → per-env `d1_databases` / `r2_buckets` bindings. `development`'s are
  emulated locally by miniflare (state under `.wrangler/`), so its ids are
  placeholders.
- **`.dev.vars`** (gitignored) is **only for local secrets** you can't commit to
  `wrangler.jsonc` — not for `CORS_ORIGINS`, which lives in the `development`
  env's `vars`. Loaded by `wrangler dev`, it overrides committed `vars` locally.

Local dev is `wrangler dev --env development` (the `dev` target); it uses the
`development` env above with locally emulated D1/R2. There are no
`NEXT_PUBLIC_`-style committed files here because nothing is public.

### wiring the frontends to the backend

Each frontend environment points at the matching brace-api environment, and
brace-api allows the matching frontend origin back:

| environment   | frontend `*_API_URL` →         | brace-api `CORS_ORIGINS` allows                            |
| ------------- | ------------------------------ | ---------------------------------------------------------- |
| `development` | `http://localhost:8787`        | `http://localhost:3000`                                    |
| `staging`     | `https://api.staging.brace.to` | `https://staging.brace.to`, `https://app.staging.brace.to` |
| `production`  | `https://api.brace.to`         | `https://brace.to`, `https://app.brace.to`                 |

CORS is never `*` — each API environment allows only its own frontend
origin(s). Each tier allows **two** web origins: the `app.*` host (the brace-web
application, this monorepo) and the apex (a separate marketing site in its own
repo, which also calls the api for public data like stats / health). See
[deployment.md](./deployment.md#custom-domains) for the host naming scheme.

### what's committed vs ignored

- **committed:** `.env.development`, `.env.staging`, `.env.production` for the
  frontends — every value in them is public.
- **gitignored:** `.env*.local` (frontend personal overrides), `.dev.vars`
  (brace-api Workers local), and all real secrets. These never enter git.
