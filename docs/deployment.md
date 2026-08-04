## deployment

Where each app runs and how it ships, across the two deploy tiers — `staging`
and `production` (see [env-files.md](./env-files.md) for the **config** side:
how each app gets its per-environment values). This doc owns the
**infrastructure / tech stack** and the **deploy flow**.

> **Status: plan / scaffold.** As of this writing nothing is deployed yet —
> bracemark-api is Workers-only (`src/worker.ts`; local dev via `wrangler dev`), and
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
  bracemark-web  ──WXT_/NEXT_PUBLIC_API_URL──▶  bracemark-api        ──▶  D1 (staging)
  S3 + CloudFront (AWS stack A)             Worker (CF acct A)     R2 (staging)
  bracemark-web  ──NEXT_PUBLIC_EXTRACT_URL──▶  bracemark-extractor        (no D1/R2)
                                            Worker (CF acct A)

PRODUCTION
  bracemark-web  ──WXT_/NEXT_PUBLIC_API_URL──▶  bracemark-api        ──▶  D1 (production)
  S3 + CloudFront (AWS stack B)             Worker (CF acct B)     R2 (production)
  bracemark-web  ──NEXT_PUBLIC_EXTRACT_URL──▶  bracemark-extractor        (no D1/R2)
                                            Worker (CF acct B)

  bracemark-extension ──▶ Chrome Web Store + Firefox AMO (points at production api)
```

### bracemark-web → AWS (S3 + CloudFront) _(planned)_

Static export (`output: 'export'` → `apps/bracemark-web/out/`), served as static
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
  so `next.config` `headers()` never runs — **CloudFront (AWS) is the only place
  these headers can be set** for bracemark-web. (Note: only bracemark-api / bracemark-extractor
  run on **Cloudflare** Workers, and they serve JSON, not HTML — no CSP concern
  there. So the app's CSP is a CloudFront artifact, _not_ a Cloudflare one, even
  though the backend is on Cloudflare.) Per tier (not shared) because
  `connect-src` must name that tier's api + extractor origins; keep the two
  policies otherwise identical. Roll out as `Content-Security-Policy-Report-Only`
  first, then enforce. Known constraints to bake in:
  - `script-src` needs `'wasm-unsafe-eval'` (hash-wasm Argon2).
  - a static export can't mint per-request nonces, so Next's inline bootstrap
    scripts need either a build-time hash union (regenerated each deploy) or
    `'unsafe-inline'` with `connect-src` as the load-bearing exfiltration block.
  - `worker-src 'self'` covers the Argon2 worker and the serwist service worker.
  - `connect-src` is pinned to `'self'` + that tier's **api** origin + **extractor**
    origin (see [account.md](./account.md) — it's the exfiltration block that makes
    `'unsafe-inline'` on `script-src` survivable). Adding any host here widens
    that block, so add deliberately (Paddle needs it — below).
  - `frame-ancestors` only works from a real header (ignored in `<meta>`),
    another reason this lives at CloudFront.
  - **Paddle.js** (the subscription checkout — see [iap.md](./iap.md)) is loaded
    from Paddle's CDN and opens its checkout as an overlay `<iframe>`, so the
    policy must allow Paddle's origins. All the relevant hosts (`cdn.paddle.com`,
    `buy.paddle.com`, `checkout-service.paddle.com`, and their `sandbox-*` peers)
    are one label under `paddle.com`, so a single `https://*.paddle.com` per
    directive covers **both** the sandbox env (staging) and live env (production)
    — the Paddle allowances are therefore **identical across tiers** (only the
    api/extractor `connect-src` hosts differ per tier). Add:
    - `script-src https://*.paddle.com` — loads `paddle.js`.
    - `frame-src https://*.paddle.com` — embeds the checkout overlay iframe.
    - `connect-src https://*.paddle.com` — `paddle.js` XHR/fetch (price preview,
      init) from the bracemark-web origin. This is the one that widens the
      exfiltration block above; it's the price of overlay checkout. (The checkout
      iframe itself runs on Paddle's origin under Paddle's own CSP — the parent
      policy governs only loading it and the SDK's own calls.)
    - `img-src https://*.paddle.com` and `style-src https://*.paddle.com` — the
      SDK injects a styled overlay container + spinner on the parent page.

  > These mirror Paddle's official CSP guidance for Paddle Billing; re-check it
  > against Paddle's docs at integration time, and prefer the `Report-Only`
  > rollout to catch any host the SDK adds before enforcing.

Deploy (per tier):

```bash
# staging
npx nx build bracemark-web --configuration=staging   # bakes staging NEXT_PUBLIC_API_URL
aws s3 sync apps/bracemark-web/out s3://<staging-bucket> --delete
aws cloudfront create-invalidation --distribution-id <staging-dist> --paths '/*'

# production
npx nx build bracemark-web                            # bakes production NEXT_PUBLIC_API_URL
aws s3 sync apps/bracemark-web/out s3://<prod-bucket> --delete
aws cloudfront create-invalidation --distribution-id <prod-dist> --paths '/*'
```

`NEXT_PUBLIC_API_URL` is **baked at build time**, so staging and production are
genuinely different artifacts — build once per tier from the same commit, never
reuse the staging bundle for production.

### bracemark-api → Cloudflare Workers _(planned)_

Hono app, **Workers-only** (`src/worker.ts`, `export default app`; no Node
entry). Config is read at runtime from `c.env` bindings — see
[env-files.md](./env-files.md#bracemark-api). Local dev is `wrangler dev` (workerd +
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
[`apps/bracemark-api/src/db/migrations/README.md`](../apps/bracemark-api/src/db/migrations/README.md)
(D1, `wrangler`-applied) and
[`apps/bracemark-api/src/do/README.md`](../apps/bracemark-api/src/do/README.md)
(per-user Durable Object SQLite, migrated in code).

### bracemark-extractor → Cloudflare Workers _(planned)_

Hono app, **Workers-only** like bracemark-api, but a **pure function** — no D1, no
R2, no Durable Objects (see [architecture.md](./architecture.md) and
[link-extraction.md](./link-extraction.md) — _server extraction_). It `fetch`es
arbitrary user-supplied URLs, so it runs as a **separate Worker on its own
origin** (`extractor.bracemark.com`), never a route on bracemark-api — that separation is
what keeps "`api.bracemark.com` only ever sees ciphertext" code-provable.

- **Same two Cloudflare accounts as bracemark-api** — one per tier. The extractor
  deploys into the same tier account as the api; it's just a different Worker
  name and origin, so no data ever crosses to it (it has no storage bindings).
- **`wrangler.jsonc`** — named environments per tier; `[vars]` carries its own
  `CORS_ORIGINS` (the `app.*` app origin + the marketing apex, never `*`) and
  the rate-limit bindings are the only bindings — no `d1_databases`, no
  `r2_buckets`.
- **Custom domain** — Workers custom domain per tier
  (`extractor.staging.bracemark.com` / `extractor.bracemark.com`), auto-provisioned
  per-host cert like the api.

```bash
wrangler deploy --env staging      # → CF account A (same account as api staging)
wrangler deploy --env production   # → CF account B (same account as api production)
```

Same per-account-token rule as bracemark-api — the token that deploys the staging
extractor cannot reach the production account.

### bracemark-extension → store publishing _(planned)_

The extension isn't deployed to infra; it's **packaged and published** to the
Chrome Web Store and Firefox AMO. It points at the **production** bracemark-api (a
store build is a production build).

```bash
npx nx zip bracemark-extension           # Chrome MV3 → .output/*-chrome.zip
npx nx zip:firefox bracemark-extension   # Firefox MV3 → .output/*-firefox.zip
```

For internal testing against **staging** bracemark-api, produce a `--mode staging`
build (see [env-files.md](./env-files.md#bracemark-extension)) and load it
unpacked / as an unlisted item — don't publish a staging build to the stores.

### custom domains

Stable custom domains are **required**, not optional: the frontends bake the API
URL into their bundles, so pointing at `*.workers.dev` / `*.cloudfront.net` would
mean rebuilding whenever an infra subdomain changes.

| tier         | web (CloudFront)            | api (Worker)                | extractor (Worker)                |
| ------------ | --------------------------- | --------------------------- | --------------------------------- |
| `staging`    | `app.staging.bracemark.com` | `api.staging.bracemark.com` | `extractor.staging.bracemark.com` |
| `production` | `app.bracemark.com`         | `api.bracemark.com`         | `extractor.bracemark.com`         |

Staging nests under a `staging.bracemark.com` subdomain (`<role>.staging.bracemark.com`)
rather than going flat (`staging-<role>.bracemark.com`) — see
[why nested staging](#why-nested-staging) below.

**Two web origins per tier, both real API clients.** `app.*` is the application
(bracemark-web, this monorepo); the **apex** (`bracemark.com`, `staging.bracemark.com`) is the
marketing site, which also calls the api for public data (stats, health check).
Both therefore appear in `CORS_ORIGINS` — neither is a redirect-only host. The
marketing site is a **separate static site in its own repository** — its source,
build, and hosting are out of scope for this doc (no `bracemark-marketing-*` bucket
or distribution is managed here); only its origin is allowlisted in
`CORS_ORIGINS`. The S3 / CloudFront rows below cover the bracemark-web app
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

| resource          | staging                                                                                              | production                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| S3 bucket         | `bracemark-web-staging`                                                                              | `bracemark-web-production`                                                                                    |
| CloudFront dist   | comment `bracemark-web-staging`                                                                      | comment `bracemark-web-production`                                                                            |
| Worker name / env | `bracemark-api-staging` / `staging`                                                                  | `bracemark-api-production` / `production`                                                                     |
| Extractor Worker  | `bracemark-extractor-staging` / `staging`                                                            | `bracemark-extractor-production` / `production`                                                               |
| D1 databases      | `bracemark-directory-db-staging`, `bracemark-accounts-db-1-staging`, `bracemark-sessions-db-staging` | `bracemark-directory-db-production`, `bracemark-accounts-db-1-production`, `bracemark-sessions-db-production` |
| R2 bucket         | `bracemark-user-files-staging`                                                                       | `bracemark-user-files-production`                                                                             |
| web domain        | `app.staging.bracemark.com`                                                                          | `app.bracemark.com`                                                                                           |
| api domain        | `api.staging.bracemark.com`                                                                          | `api.bracemark.com`                                                                                           |
| extractor domain  | `extractor.staging.bracemark.com`                                                                    | `extractor.bracemark.com`                                                                                     |

`bracemark-<resource>-<tier>` throughout — the Worker auto-suffixes its `name`
(`bracemark-api` → `bracemark-api-staging` / `bracemark-api-production`), so the env name
_is_ the tier with no separate `-prod` shorthand. The `*-dev` peers
(`bracemark-directory-db-dev`, `bracemark-accounts-db-1-dev`, `bracemark-sessions-db-dev`,
`bracemark-user-files-dev`) are the local `wrangler dev` bindings and aren't deployed. S3 / CloudFront names are proposed (not yet
provisioned); CloudFront distributions are addressed by generated ID, so the
name lives in the distribution **comment**.

#### why nested staging

Staging hosts nest (`app.staging.bracemark.com`) instead of going flat
(`staging-app.bracemark.com`) for one structural reason: **each tier is its own
Cloudflare account** (see [topology](#topology)). A zone lives in exactly one
account, so `bracemark.com` sits in the production account. Nesting lets you delegate
the whole `staging.bracemark.com` subdomain (its own NS records → a separate zone) to
the staging account, keeping the two tiers genuinely isolated. A flat
`staging-app.bracemark.com` is a direct child of `bracemark.com` and would have to live in
the production account's zone — breaking that isolation.

Trade-off: Cloudflare Universal SSL and an ACM `*.bracemark.com` wildcard only cover
one label deep, so they don't match `app.staging.bracemark.com`. Cloudflare Workers
custom domains auto-provision a per-host cert (no action needed for the api),
but the staging **web** (CloudFront + ACM) needs a `*.staging.bracemark.com` wildcard
cert. Production stays on the clean apex hosts (`app.bracemark.com`, `api.bracemark.com`),
which is what end users see.

### status & setup checklist

Current reality and the work to make this doc true:

- [x] bracemark-web env files + Nx `staging` build configuration (done — see
      [env-files.md](./env-files.md#bracemark-web)).
- [x] bracemark-api: Workers-only (`src/worker.ts`); `wrangler.jsonc` (`staging` /
      `production` envs); Nx targets in `package.json` `nx.targets` — `dev`
      (`wrangler dev`), `build` (dry-run bundle), `deploy` (default staging,
      `-c production`); `CORS_ORIGINS` reads `c.env`. (Fill the wrangler `TODO`s
      and provision D1/R2 before a real deploy.)
- [ ] Cloudflare: create the two accounts; provision D1 + R2 per account; set
      vars/secrets; wire custom domains.
- [ ] AWS: two S3 buckets + two CloudFront distributions + shared CloudFront
      Function; ACM certs; custom domains.
- [ ] bracemark-extractor: provision the Worker per tier (no D1/R2); set its
      `CORS_ORIGINS` var + custom domain (`extractor.*.bracemark.com`); wire
      `NEXT_PUBLIC_EXTRACT_URL` into bracemark-web's per-tier builds.
- [ ] bracemark-extension: add `WXT_PUBLIC_API_URL` + `.env.*` + `--mode staging`
      build when it starts calling the api.
- [ ] CI/CD: pick provider; wire the merge→staging, tag→production flow with
      per-tier credentials.
