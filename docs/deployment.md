## deployment

Where each app runs and how it ships, across the two deploy tiers — `staging`
and `production` (see [env-files.md](./env-files.md) for the **config** side:
how each app gets its per-environment values). This doc owns the
**infrastructure / tech stack** and the **deploy flow**.

> **Status: plan / scaffold.** As of this writing nothing is deployed yet —
> brace-api is Workers-only (`src/worker.ts`; local dev via `wrangler dev`), and
> its `wrangler.jsonc` + `deploy` target exist but point at unprovisioned
> resources (placeholder account IDs / D1 / R2), and no AWS stack exists. Items
> below marked _(planned)_ are decisions, not yet built; the
> [status & setup checklist](#status--setup-checklist) at the end tracks what's
> real. `TODO:` markers flag values you must fill in (domains, account IDs, CI
> provider).

### topology

Two fully isolated tiers. Each tier is its own Cloudflare account (api +
extractor + data) and its own AWS stack (web), so blast radius is contained,
D1/R2 data can never cross tiers (they're per-account), and each tier gets its
own free-tier limits.

```
STAGING
  brace-web  ──WXT_/NEXT_PUBLIC_API_URL──▶  brace-api        ──▶  D1 (staging)
  S3 + CloudFront (AWS stack A)             Worker (CF acct A)     R2 (staging)
  brace-web  ──NEXT_PUBLIC_EXTRACT_URL──▶  brace-extractor        (no D1/R2)
                                            Worker (CF acct A)

PRODUCTION
  brace-web  ──WXT_/NEXT_PUBLIC_API_URL──▶  brace-api        ──▶  D1 (production)
  S3 + CloudFront (AWS stack B)             Worker (CF acct B)     R2 (production)
  brace-web  ──NEXT_PUBLIC_EXTRACT_URL──▶  brace-extractor        (no D1/R2)
                                            Worker (CF acct B)

  brace-extension ──▶ Chrome Web Store + Firefox AMO (points at production api)
```

### brace-web → AWS (S3 + CloudFront) _(planned)_

Static export (`output: 'export'` → `apps/brace-web/out/`), served as static
files behind CloudFront.

- **S3** — one bucket per tier, holds the exported `out/`.
- **CloudFront** — one distribution per tier; origin is the S3 bucket. Alternate
  domain name + ACM cert for the custom domain.
- **CloudFront Functions** — viewer-request function for clean-URL / `index.html`
  rewrites. **Both distributions must use the same function** so staging
  genuinely mirrors production. (A viewer-request function runs before the
  response exists and cannot add response headers — those belong to the
  response headers policy below.)
- **Response headers policy** — one **custom response headers policy per tier**
  attaching the security headers, chiefly the **CSP** that
  [account.md](./account.md) names as the XSS mitigation for the bearer token +
  encryption key in IndexedDB. With `output: 'export'` there is no Next server,
  so `next.config` `headers()` never runs — CloudFront is the only place these
  headers can be set. Per tier (not shared) because `connect-src` must name
  that tier's api origin; keep the two policies otherwise identical. Roll out
  as `Content-Security-Policy-Report-Only` first, then enforce. Known
  constraints to bake in: `script-src` needs `'wasm-unsafe-eval'` (hash-wasm
  Argon2); a static export can't mint per-request nonces, so Next's inline
  bootstrap scripts need either a build-time hash union (regenerated each
  deploy) or `'unsafe-inline'` with `connect-src` as the load-bearing
  exfiltration block; `worker-src 'self'` covers the Argon2 worker and the
  serwist service worker; `frame-ancestors` only works from a real header
  (ignored in `<meta>`), another reason this lives at CloudFront.

Deploy (per tier):

```bash
# staging
npx nx build brace-web --configuration=staging   # bakes staging NEXT_PUBLIC_API_URL
aws s3 sync apps/brace-web/out s3://<staging-bucket> --delete
aws cloudfront create-invalidation --distribution-id <staging-dist> --paths '/*'

# production
npx nx build brace-web                            # bakes production NEXT_PUBLIC_API_URL
aws s3 sync apps/brace-web/out s3://<prod-bucket> --delete
aws cloudfront create-invalidation --distribution-id <prod-dist> --paths '/*'
```

`NEXT_PUBLIC_API_URL` is **baked at build time**, so staging and production are
genuinely different artifacts — build once per tier from the same commit, never
reuse the staging bundle for production.

### brace-api → Cloudflare Workers _(planned)_

Hono app, **Workers-only** (`src/worker.ts`, `export default app`; no Node
entry). Config is read at runtime from `c.env` bindings — see
[env-files.md](./env-files.md#brace-api). Local dev is `wrangler dev` (workerd +
local D1/R2 emulation), not Node.

- **Two Cloudflare accounts** — one per tier (`account_id` differs).
- **`wrangler.jsonc`** — named environments pin each tier to its account, with
  its own bindings:
  - `[vars]` for non-secret config (e.g. `CORS_ORIGINS`).
  - secrets via `wrangler secret put <NAME> --env <env>` (never committed).
  - `d1_databases` — one D1 (sqlite) per account.
  - `r2_buckets` — one R2 bucket per account.
- **Custom domain** — Workers custom domain / route per tier.

```bash
wrangler deploy --env staging      # → CF account A, with that account's API token
wrangler deploy --env production   # → CF account B, with that account's API token
```

Give CI a **separate API token per account** — never one token that can reach
both tiers.

Migration mechanics live next to the code they govern, one per storage layer:
[`apps/brace-api/src/db/migrations/README.md`](../apps/brace-api/src/db/migrations/README.md)
(D1, `wrangler`-applied) and
[`apps/brace-api/src/do/README.md`](../apps/brace-api/src/do/README.md)
(per-user Durable Object SQLite, migrated in code).

### brace-extractor → Cloudflare Workers _(planned)_

Hono app, **Workers-only** like brace-api, but a **pure function** — no D1, no
R2, no Durable Objects (see [architecture.md](./architecture.md) and
[link-extraction.md](./link-extraction.md) — _server extraction_). It `fetch`es
arbitrary user-supplied URLs, so it runs as a **separate Worker on its own
origin** (`extractor.brace.to`), never a route on brace-api — that separation is
what keeps "`api.brace.to` only ever sees ciphertext" code-provable.

- **Same two Cloudflare accounts as brace-api** — one per tier. The extractor
  deploys into the same tier account as the api; it's just a different Worker
  name and origin, so no data ever crosses to it (it has no storage bindings).
- **`wrangler.jsonc`** — named environments per tier; `[vars]` carries its own
  `CORS_ORIGINS` (the `app.*` app origin + the marketing apex, never `*`) and
  the rate-limit bindings are the only bindings — no `d1_databases`, no
  `r2_buckets`.
- **Custom domain** — Workers custom domain per tier
  (`extractor.staging.brace.to` / `extractor.brace.to`), auto-provisioned
  per-host cert like the api.

```bash
wrangler deploy --env staging      # → CF account A (same account as api staging)
wrangler deploy --env production   # → CF account B (same account as api production)
```

Same per-account-token rule as brace-api — the token that deploys the staging
extractor cannot reach the production account.

### brace-extension → store publishing _(planned)_

The extension isn't deployed to infra; it's **packaged and published** to the
Chrome Web Store and Firefox AMO. It points at the **production** brace-api (a
store build is a production build).

```bash
npx nx zip brace-extension           # Chrome MV3 → .output/*-chrome.zip
npx nx zip:firefox brace-extension   # Firefox MV3 → .output/*-firefox.zip
```

For internal testing against **staging** brace-api, produce a `--mode staging`
build (see [env-files.md](./env-files.md#brace-extension)) and load it
unpacked / as an unlisted item — don't publish a staging build to the stores.

### custom domains

Stable custom domains are **required**, not optional: the frontends bake the API
URL into their bundles, so pointing at `*.workers.dev` / `*.cloudfront.net` would
mean rebuilding whenever an infra subdomain changes.

| tier         | web (CloudFront)       | api (Worker)           | extractor (Worker)           |
| ------------ | ---------------------- | ---------------------- | ---------------------------- |
| `staging`    | `app.staging.brace.to` | `api.staging.brace.to` | `extractor.staging.brace.to` |
| `production` | `app.brace.to`         | `api.brace.to`         | `extractor.brace.to`         |

Staging nests under a `staging.brace.to` subdomain (`<role>.staging.brace.to`)
rather than going flat (`staging-<role>.brace.to`) — see
[why nested staging](#why-nested-staging) below.

**Two web origins per tier, both real API clients.** `app.*` is the application
(brace-web, this monorepo); the **apex** (`brace.to`, `staging.brace.to`) is the
marketing site, which also calls the api for public data (stats, health check).
Both therefore appear in `CORS_ORIGINS` — neither is a redirect-only host. The
marketing site is a **separate static site in its own repository** — its source,
build, and hosting are out of scope for this doc (no `brace-marketing-*` bucket
or distribution is managed here); only its origin is allowlisted in
`CORS_ORIGINS`. The S3 / CloudFront rows below cover the brace-web app
(`app.*`) only.

### cors & frontend↔backend wiring

Each frontend tier points at the matching api tier, and each api tier allows
only its own frontend origin back (`CORS_ORIGINS`, never `*`). The full table
lives in [env-files.md](./env-files.md#wiring-the-frontends-to-the-backend) —
keep the two docs in sync.

### ci/cd — build per tier, promote one commit

`TODO: pick CI provider.` Target flow:

1. **merge to `main`** → deploy **staging** (web + api) automatically.
2. **tag / manual approval** → deploy **production** from that _same commit_.

Notes:

- Build the frontends **once per tier** (baked API URLs differ) — don't promote
  a staging bundle to production.
- Reproduce both builds from one source revision so the tiers never drift.
- Secrets in CI: separate Cloudflare API token per account, separate AWS
  credentials per tier; no single credential spans both tiers.

### naming conventions

One suffix scheme — `staging` / `production` — across **everything**, so a
glance tells you the tier:

| resource          | staging                                                                                  | production                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| S3 bucket         | `brace-web-staging`                                                                      | `brace-web-production`                                                                            |
| CloudFront dist   | comment `brace-web-staging`                                                              | comment `brace-web-production`                                                                    |
| Worker name / env | `brace-api-staging` / `staging`                                                          | `brace-api-production` / `production`                                                             |
| Extractor Worker  | `brace-extractor-staging` / `staging`                                                    | `brace-extractor-production` / `production`                                                       |
| D1 databases      | `brace-directory-db-staging`, `brace-accounts-db-1-staging`, `brace-sessions-db-staging` | `brace-directory-db-production`, `brace-accounts-db-1-production`, `brace-sessions-db-production` |
| R2 bucket         | `brace-user-files-staging`                                                               | `brace-user-files-production`                                                                     |
| web domain        | `app.staging.brace.to`                                                                   | `app.brace.to`                                                                                    |
| api domain        | `api.staging.brace.to`                                                                   | `api.brace.to`                                                                                    |
| extractor domain  | `extractor.staging.brace.to`                                                             | `extractor.brace.to`                                                                              |

`brace-<resource>-<tier>` throughout — the Worker auto-suffixes its `name`
(`brace-api` → `brace-api-staging` / `brace-api-production`), so the env name
_is_ the tier with no separate `-prod` shorthand. The `*-dev` peers
(`brace-directory-db-dev`, `brace-accounts-db-1-dev`, `brace-sessions-db-dev`,
`brace-user-files-dev`) are the local `wrangler dev` bindings and aren't deployed. S3 / CloudFront names are proposed (not yet
provisioned); CloudFront distributions are addressed by generated ID, so the
name lives in the distribution **comment**.

#### why nested staging

Staging hosts nest (`app.staging.brace.to`) instead of going flat
(`staging-app.brace.to`) for one structural reason: **each tier is its own
Cloudflare account** (see [topology](#topology)). A zone lives in exactly one
account, so `brace.to` sits in the production account. Nesting lets you delegate
the whole `staging.brace.to` subdomain (its own NS records → a separate zone) to
the staging account, keeping the two tiers genuinely isolated. A flat
`staging-app.brace.to` is a direct child of `brace.to` and would have to live in
the production account's zone — breaking that isolation.

Trade-off: Cloudflare Universal SSL and an ACM `*.brace.to` wildcard only cover
one label deep, so they don't match `app.staging.brace.to`. Cloudflare Workers
custom domains auto-provision a per-host cert (no action needed for the api),
but the staging **web** (CloudFront + ACM) needs a `*.staging.brace.to` wildcard
cert. Production stays on the clean apex hosts (`app.brace.to`, `api.brace.to`),
which is what end users see.

### status & setup checklist

Current reality and the work to make this doc true:

- [x] brace-web env files + Nx `staging` build configuration (done — see
      [env-files.md](./env-files.md#brace-web)).
- [x] brace-api: Workers-only (`src/worker.ts`); `wrangler.jsonc` (`staging` /
      `production` envs); Nx targets in `package.json` `nx.targets` — `dev`
      (`wrangler dev`), `build` (dry-run bundle), `deploy` (default staging,
      `-c production`); `CORS_ORIGINS` reads `c.env`. (Fill the wrangler `TODO`s
      and provision D1/R2 before a real deploy.)
- [ ] Cloudflare: create the two accounts; provision D1 + R2 per account; set
      vars/secrets; wire custom domains.
- [ ] AWS: two S3 buckets + two CloudFront distributions + shared CloudFront
      Function; ACM certs; custom domains.
- [ ] brace-extractor: provision the Worker per tier (no D1/R2); set its
      `CORS_ORIGINS` var + custom domain (`extractor.*.brace.to`); wire
      `NEXT_PUBLIC_EXTRACT_URL` into brace-web's per-tier builds.
- [ ] brace-extension: add `WXT_PUBLIC_API_URL` + `.env.*` + `--mode staging`
      build when it starts calling the api.
- [ ] CI/CD: pick provider; wire the merge→staging, tag→production flow with
      per-tier credentials.
