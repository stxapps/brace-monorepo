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

Two fully isolated tiers. Each tier is its own Cloudflare account (api + data)
and its own AWS stack (web), so blast radius is contained, D1/R2 data can never
cross tiers (they're per-account), and each tier gets its own free-tier limits.

```
STAGING
  brace-web  ──WXT_/NEXT_PUBLIC_API_URL──▶  brace-api        ──▶  D1 (staging)
  S3 + CloudFront (AWS stack A)             Worker (CF acct A)     R2 (staging)

PRODUCTION
  brace-web  ──WXT_/NEXT_PUBLIC_API_URL──▶  brace-api        ──▶  D1 (production)
  S3 + CloudFront (AWS stack B)             Worker (CF acct B)     R2 (production)

  brace-extension ──▶ Chrome Web Store + Firefox AMO (points at production api)
```

### brace-web → AWS (S3 + CloudFront) _(planned)_

Static export (`output: 'export'` → `apps/brace-web/out/`), served as static
files behind CloudFront.

- **S3** — one bucket per tier, holds the exported `out/`.
- **CloudFront** — one distribution per tier; origin is the S3 bucket. Alternate
  domain name + ACM cert for the custom domain.
- **CloudFront Functions** — viewer-request function for clean-URL / `index.html`
  rewrites and security headers. **Both distributions must use the same
  function** so staging genuinely mirrors production.

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

| tier         | web (CloudFront)            | api (Worker)                    |
| ------------ | --------------------------- | ------------------------------- |
| `staging`    | `TODO: staging web domain`  | `TODO: staging api domain`      |
| `production` | `TODO: prod web domain`     | `TODO: prod api domain`         |

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

| resource              | staging                  | production               |
| --------------------- | ------------------------ | ------------------------ |
| S3 bucket             | `TODO`                   | `TODO`                   |
| CloudFront dist       | `TODO`                   | `TODO`                   |
| Worker name / env     | `…-staging` / `staging`  | `…-prod` / `production`  |
| D1 database           | `TODO`                   | `TODO`                   |
| R2 bucket             | `TODO`                   | `TODO`                   |
| web domain            | `TODO`                   | `TODO`                   |
| api domain            | `TODO`                   | `TODO`                   |

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
- [ ] brace-extension: add `WXT_PUBLIC_API_URL` + `.env.*` + `--mode staging`
      build when it starts calling the api.
- [ ] CI/CD: pick provider; wire the merge→staging, tag→production flow with
      per-tier credentials.
