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
> real. `TODO:` markers flag values you must fill in (Cloudflare account IDs, D1
> database IDs, Paddle/store IDs, CI provider).
>
> **The domain is real.** `bracemark.com` was registered at Namecheap on
> **2026-08-04**, so every host in this doc is a name you can now provision
> rather than a placeholder. See [dns](#dns) for the zone layout and
> [brand.md](./brand.md#domains) for the rest of the domain estate.

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
  bracemark-site ──NEXT_PUBLIC_API_URL─────▶  bracemark-api        (public data only)
  S3 + CloudFront (AWS stack A)

PRODUCTION
  bracemark-web  ──WXT_/NEXT_PUBLIC_API_URL──▶  bracemark-api        ──▶  D1 (production)
  S3 + CloudFront (AWS stack B)             Worker (CF acct B)     R2 (production)
  bracemark-web  ──NEXT_PUBLIC_EXTRACT_URL──▶  bracemark-extractor        (no D1/R2)
                                            Worker (CF acct B)
  bracemark-site ──NEXT_PUBLIC_API_URL─────▶  bracemark-api        (public data only)
  S3 + CloudFront (AWS stack B)

  bracemark-extension ──▶ Chrome Web Store + Firefox AMO (points at production api)
```

Two static sites per tier, not one: **bracemark-web** on `app.*` and
**bracemark-site** on the apex. They're separate S3 buckets and separate
CloudFront distributions inside the same AWS stack, because they're separate
origins with different headers (below) — but the same tier, so a tier is still
one blast radius.

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

### bracemark-site → AWS (S3 + CloudFront) _(planned)_

The marketing apex. Same stack and the same deploy shape as bracemark-web above
(`output: 'export'` → `apps/bracemark-site/out/`, one bucket + one distribution
per tier, the shared clean-URL CloudFront Function), so only the differences are
listed here:

- **Its own bucket and distribution**, not a path prefix on bracemark-web's.
  They're different origins (`bracemark.com` vs `app.bracemark.com`), which is
  the whole point — see [custom domains](#custom-domains).
- **A much smaller response headers policy.** bracemark-web's CSP is load-bearing
  because that origin holds a bearer token and an encryption key in IndexedDB
  ([account.md](./account.md)). The apex holds no credentials, runs no crypto,
  and has no service worker, so it needs none of `wasm-unsafe-eval`,
  `worker-src`, or the Paddle allowances — checkout happens in the app, not
  here. Give it a tight default-src `'self'` policy plus its tier's api origin in
  `connect-src` (for the public stats/health calls) and nothing else. **Do not
  reuse bracemark-web's policy**: copying it would silently widen the apex to
  every host the app needs, for no reason.
- **Caching differs.** Marketing content changes on an editorial cadence and is
  read by crawlers, so it wants a longer default TTL than the app shell —
  invalidate on deploy the same way.

Deploy (per tier):

```bash
# staging
npx nx build bracemark-site --configuration=staging
aws s3 sync apps/bracemark-site/out s3://<staging-site-bucket> --delete
aws cloudfront create-invalidation --distribution-id <staging-site-dist> --paths '/*'

# production
npx nx build bracemark-site
aws s3 sync apps/bracemark-site/out s3://<prod-site-bucket> --delete
aws cloudfront create-invalidation --distribution-id <prod-site-dist> --paths '/*'
```

`NEXT_PUBLIC_APP_URL` is baked in alongside `NEXT_PUBLIC_API_URL` — it's what the
"Sign in" / "Get Started" links point at, and it differs per tier like everything
else. A staging build of the site linking to production's app is exactly the kind
of cross-tier leak the two-stack split exists to prevent.

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
  (`extractor.bracemark-staging.com` / `extractor.bracemark.com`), auto-provisioned
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
mean rebuilding whenever an infra subdomain changes. This section names the
hosts; [dns](#dns) covers the zones, records, and certs that make them resolve.

| tier         | site (CloudFront)       | web (CloudFront)            | api (Worker)                | extractor (Worker)                |
| ------------ | ----------------------- | --------------------------- | --------------------------- | --------------------------------- |
| `staging`    | `bracemark-staging.com` | `app.bracemark-staging.com` | `api.bracemark-staging.com` | `extractor.bracemark-staging.com` |
| `production` | `bracemark.com`         | `app.bracemark.com`         | `api.bracemark.com`         | `extractor.bracemark.com`         |

The two tiers sit on **two different registrable domains**, not one domain split
by subdomain — see
[why staging is a separate domain](#why-staging-is-a-separate-domain) below.
Within each, the pattern is identical (`<role>.<domain>`), and the site is the
exception that proves the rule: it has no `<role>.` label because it **is** the
zone apex.

**Two web origins per tier, both real API clients.** `app.*` is the application
(bracemark-web); the **apex** (`bracemark.com`, `bracemark-staging.com`) is the
marketing site (bracemark-site), which also calls the api for public data (stats,
health check). Both therefore appear in `CORS_ORIGINS` — neither is a
redirect-only host.

> **This reverses an earlier decision.** The marketing site used to be specified
> as a separate static site in its own repository, out of scope for this doc. It
> now lives in this monorepo as `apps/bracemark-site`, and its bucket,
> distribution, and domain are managed here like any other app. The reason for
> the reversal is drift: the pricing/quota numbers, the store-listing URLs, and
> the brand tokens are all defined once in `@stxapps/shared` /
> `@stxapps/web-ui` and enforced elsewhere in the codebase, and a marketing site
> in another repo can only hand-copy them. See
> [architecture.md](./architecture.md#apps) for what the site is allowed to
> depend on.

### dns

**Registrar: Namecheap. Authoritative DNS: Cloudflare.** Namecheap holds the
registration and nothing else; its nameservers point at the **production**
Cloudflare account, which hosts the `bracemark.com` zone.

That split isn't a preference. **A Workers custom domain requires its hostname's
zone to live in the same Cloudflare account, on Cloudflare nameservers.** There
is no record you can write at a third-party registrar that points
`api.bracemark.com` at a Worker — Workers won't route a custom `Host` through
`*.workers.dev`, and the CNAME-only ("partial") zone setup that would allow it is
a Business-plan feature. That constraint covers all four Worker hosts (`api.*`
and `extractor.*`, both tiers), so the zone has to be on Cloudflare no matter
what else lives there.

CloudFront, by contrast, doesn't care who serves DNS — it needs a CNAME, and
Cloudflare flattens a CNAME at the apex, which also lets the apex keep MX and TXT
records alongside it (a stricter provider would reject that pair). So splitting
the zone across two providers buys nothing and costs a second control plane to
keep in sync. **One zone per tier, both on Cloudflare.**

#### proxy off for everything that isn't a Worker

Every CloudFront and ACM-validation record is **DNS only** (grey cloud).
Orange-clouding CloudFront stacks two CDNs: an extra hop, TLS terminated twice,
CloudFront seeing Cloudflare IPs instead of client IPs, and two cache layers to
invalidate on every deploy. It also puts Cloudflare's own header features in
front of the CloudFront **response headers policy** that carries bracemark-web's
CSP — the one place [above](#bracemark-web--aws-s3--cloudfront-planned) insists
that CSP can live.

Worker hosts are the exception: a Workers custom domain creates and proxies its
own record, which is correct and not optional.

#### production zone — `bracemark.com` (production Cloudflare account)

| name                  | type    | value                                         | proxy               |
| --------------------- | ------- | --------------------------------------------- | ------------------- |
| `@`                   | CNAME   | `<prod-site-dist>.cloudfront.net`             | DNS only            |
| `www`                 | CNAME   | `<prod-site-dist>.cloudfront.net`             | DNS only            |
| `app`                 | CNAME   | `<prod-web-dist>.cloudfront.net`              | DNS only            |
| `api`                 | —       | created by the Worker custom domain           | proxied (automatic) |
| `extractor`           | —       | created by the Worker custom domain           | proxied (automatic) |
| `_<hash>`             | CNAME   | `…acm-validations.aws` (one per cert SAN)     | DNS only            |
| `@` / `_dmarc` / DKIM | MX, TXT | Namecheap Private Email (see [email](#email)) | n/a                 |

`www` resolves to the same distribution as the apex and **301s to the apex** in
the shared clean-URL CloudFront Function, so one host accrues the SEO — the same
reasoning that puts docs and blog on apex _paths_ rather than subdomains
([brand.md](./brand.md#domains)). It still needs to be an alternate
domain name on the distribution and a SAN on the cert, or the redirect is a TLS
error instead of a redirect.

#### staging zone — a separate registrable domain (staging Cloudflare account)

**Staging does not nest under `bracemark.com`.** It gets its own domain, added as
a normal apex zone in the second Cloudflare account — see
[why staging is a separate domain](#why-staging-is-a-separate-domain) for the
constraint that forces this. Proposed name: **`bracemark-staging.com`** (not yet
registered).

| name        | type  | value                               | proxy               |
| ----------- | ----- | ----------------------------------- | ------------------- |
| `@`         | CNAME | `<stg-site-dist>.cloudfront.net`    | DNS only            |
| `app`       | CNAME | `<stg-web-dist>.cloudfront.net`     | DNS only            |
| `api`       | —     | created by the Worker custom domain | proxied (automatic) |
| `extractor` | —     | created by the Worker custom domain | proxied (automatic) |
| `_<hash>`   | CNAME | `…acm-validations.aws`              | DNS only            |

Its nameservers are set at **its own** registrar entry, pointing at the staging
Cloudflare account. The production zone gets no `NS` delegation record and
`bracemark.com` never learns staging exists — which is a cleaner separation than
the delegation would have been.

#### certificates

- **ACM certs for CloudFront must be issued in `us-east-1`**, regardless of where
  the buckets or anything else live. Validation is by CNAME, added to the zone
  above.
- Production cert: `bracemark.com` + `www.bracemark.com` + `app.bracemark.com`.
  A `*.bracemark.com` wildcard covers `app.` and `www.` but **not** the apex, so
  name the apex explicitly.
- Staging cert: the staging apex + a plain `*.<staging-domain>` wildcard. Because
  staging is now its own registrable domain rather than a nested subdomain, a
  one-label wildcard covers `app.`, `api.` and `extractor.` — the awkward
  two-label wildcard the nested design needed is gone.
- The Worker hosts need no ACM work at all: a Workers custom domain
  auto-provisions its own per-host certificate.

#### email

`support@bracemark.com` is the published support address (`SUPPORT_EMAIL` in
`apps/bracemark-site/src/lib/site.ts`) and the contact of record for App Store,
Play, and Paddle review. Mail is **Namecheap Private Email** — a real mailbox,
not forwarding — so replies genuinely come _from_ `support@` with no SMTP relay
in the path.

Because DNS moved to Cloudflare, **Namecheap's automatic mail setup does not
apply**: it writes records into Namecheap's own BasicDNS, which is no longer
authoritative for this domain. Add the MX / SPF / DKIM records **by hand in the
production Cloudflare zone**, copying the exact values from Namecheap's Private
Email DNS panel — treat that panel as authoritative and don't transcribe them
from here, they change. Shape, for orientation only: `MX` →
`mx1.privateemail.com` / `mx2.privateemail.com`, SPF `TXT` →
`v=spf1 include:spf.privateemail.com ~all`, plus the DKIM record for the key
generated in the Private Email dashboard.

Three consequences worth recording:

- **Do not also enable Cloudflare Email Routing.** It and Private Email both want
  to own the apex `MX` records; enabling both breaks inbound mail, silently.
- **The app itself never sends email.** The account model has no email address at
  all ([account.md](./account.md)) — no verification, no password reset — and
  Paddle sends its own receipts. There is no transactional sender to configure
  and no ESP in the stack, which is why a single mailbox is sufficient. Publish a
  strict `DMARC` policy once mail is flowing and Private Email is the only
  sender.
- **The legacy migration email does not go out from this domain.** A bulk send
  from a domain with no sending reputation is a deliverability problem, and
  `brace.to` is both warm and the sender those users actually recognise — send it
  from there, linking to `bracemark.com`. See
  [legacy-brace-to.md](./legacy-brace-to.md).

Aliases on the cheapest Private Email plan cover the inbound-only addresses that
never reply — `abuse@` ([abuse.md](./abuse.md)), `postmaster@`, `security@` — and
the second Cloudflare account needs its own login address, which is another
alias rather than a personal mailbox.

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
  a staging bundle to production. "Frontends" is now three artifacts per tier:
  bracemark-web, bracemark-site, and the browser extension.
- `nx affected` is what keeps this cheap: an edit to marketing copy rebuilds and
  redeploys only bracemark-site, and never touches the app's bucket.
- Reproduce both builds from one source revision so the tiers never drift.
- Secrets in CI: separate Cloudflare API token per account, separate AWS
  credentials per tier; no single credential spans both tiers.

### naming conventions

One suffix scheme — `staging` / `production` — across **everything**, so a
glance tells you the tier:

| resource          | staging                                                                                              | production                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| S3 bucket (web)   | `bracemark-web-staging`                                                                              | `bracemark-web-production`                                                                                    |
| S3 bucket (site)  | `bracemark-site-staging`                                                                             | `bracemark-site-production`                                                                                   |
| CloudFront (web)  | comment `bracemark-web-staging`                                                                      | comment `bracemark-web-production`                                                                            |
| CloudFront (site) | comment `bracemark-site-staging`                                                                     | comment `bracemark-site-production`                                                                           |
| Worker name / env | `bracemark-api-staging` / `staging`                                                                  | `bracemark-api-production` / `production`                                                                     |
| Extractor Worker  | `bracemark-extractor-staging` / `staging`                                                            | `bracemark-extractor-production` / `production`                                                               |
| D1 databases      | `bracemark-directory-db-staging`, `bracemark-accounts-db-1-staging`, `bracemark-sessions-db-staging` | `bracemark-directory-db-production`, `bracemark-accounts-db-1-production`, `bracemark-sessions-db-production` |
| R2 bucket         | `bracemark-user-files-staging`                                                                       | `bracemark-user-files-production`                                                                             |
| site domain       | `bracemark-staging.com`                                                                              | `bracemark.com`                                                                                               |
| web domain        | `app.bracemark-staging.com`                                                                          | `app.bracemark.com`                                                                                           |
| api domain        | `api.bracemark-staging.com`                                                                          | `api.bracemark.com`                                                                                           |
| extractor domain  | `extractor.bracemark-staging.com`                                                                    | `extractor.bracemark.com`                                                                                     |

`bracemark-<resource>-<tier>` throughout — the Worker auto-suffixes its `name`
(`bracemark-api` → `bracemark-api-staging` / `bracemark-api-production`), so the env name
_is_ the tier with no separate `-prod` shorthand. The `*-dev` peers
(`bracemark-directory-db-dev`, `bracemark-accounts-db-1-dev`, `bracemark-sessions-db-dev`,
`bracemark-user-files-dev`) are the local `wrangler dev` bindings and aren't deployed. S3 / CloudFront names are proposed (not yet
provisioned); CloudFront distributions are addressed by generated ID, so the
name lives in the distribution **comment**.

#### why staging is a separate domain

Staging lives on its own registrable domain (`bracemark-staging.com`) rather than
under `bracemark.com` at all. The reason is a hard Cloudflare constraint meeting
the [topology](#topology):

- **Each tier is its own Cloudflare account**, and **a zone lives in exactly one
  account.** `bracemark.com` is in the production account.
- **A Workers custom domain requires its zone to be in the same account as the
  Worker** (see [dns](#dns)), so the staging api and extractor need a zone the
  _staging_ account owns.
- Therefore staging hosts cannot be children of `bracemark.com` — flat
  (`staging-app.bracemark.com`) or nested (`app.staging.bracemark.com`) alike —
  because both resolve out of the production account's zone.

> **This supersedes an earlier design.** Staging used to nest under
> `staging.bracemark.com`, delegated to the staging account as its own zone via
> `NS` records. **That does not work on a non-Enterprise plan:** Cloudflare only
> accepts an apex domain when adding a site, and treating a subdomain as an
> independent zone ("Subdomain support") is
> [an Enterprise-only feature](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-subdomain/).
> On every other plan a subdomain is just a DNS record inside the parent zone —
> which puts it in the production account, defeating the isolation.

The alternative — folding staging into the production account — was rejected: it
would put staging D1/R2 and production D1/R2 under one set of credentials and one
blast radius, which is the single thing the two-account split exists to prevent.
A second domain costs ~$10–15/year; that isolation is worth more than that.

It also turns out **cleaner** than the nested design it replaces. Staging is now
a plain apex zone, so a one-label `*.bracemark-staging.com` wildcard covers
`app.`, `api.` and `extractor.` — no two-label wildcard, no delegation records,
and `bracemark.com` never references staging at all. Production keeps the clean
apex hosts (`app.bracemark.com`, `api.bracemark.com`) that end users see.

Pick a name that is **obviously internal**. Don't reuse a defensive domain from
[brand.md](./brand.md#domains) (`braceto.com`, `bracemarks.com`): those are
user-facing 301 sources aimed at real visitors, and pointing one at the staging
app means a mistyped URL lands a stranger on unreleased code.

### status & setup checklist

Current reality and the work to make this doc true:

- [x] bracemark-web env files + Nx `staging` build configuration (done — see
      [env-files.md](./env-files.md#bracemark-web)).
- [x] bracemark-api: Workers-only (`src/worker.ts`); `wrangler.jsonc` (`staging` /
      `production` envs); Nx targets in `package.json` `nx.targets` — `dev`
      (`wrangler dev`), `build` (dry-run bundle), `deploy` (default staging,
      `-c production`); `CORS_ORIGINS` reads `c.env`. (Fill the wrangler `TODO`s
      and provision D1/R2 before a real deploy.)
- [x] `bracemark.com` registered at Namecheap (2026-08-04).
- [ ] Register the staging domain (`bracemark-staging.com` proposed). Required,
      not optional — a subdomain of `bracemark.com` cannot be a zone in the
      staging Cloudflare account on a non-Enterprise plan, see
      [why staging is a separate domain](#why-staging-is-a-separate-domain).
- [ ] DNS: add `bracemark.com` to the **production** Cloudflare account and the
      staging domain to the **staging** account, pointing each registrar entry at
      the nameserver pair Cloudflare assigns that zone — see [dns](#dns).
- [ ] Propagate the chosen staging domain over the now-dead
      `*.staging.bracemark.com` hosts still in: `docs/env-files.md`,
      `apps/bracemark-api/wrangler.jsonc`, `apps/bracemark-extractor/wrangler.jsonc`,
      `apps/bracemark-{web,site,expo,extension}/.env.staging`,
      `apps/bracemark-{web,site}/src/lib/site.ts`,
      `apps/bracemark-extension/utils/web-app-url.ts`.
- [ ] Email: Namecheap Private Email mailbox for `support@bracemark.com`, with
      its MX / SPF / DKIM records added **by hand** in the Cloudflare zone
      (Namecheap's automatic setup doesn't apply once DNS moves). Don't enable
      Cloudflare Email Routing alongside it — see [email](#email).
- [ ] Cloudflare: create the two accounts; provision D1 + R2 per account; set
      vars/secrets; wire custom domains (uncomment the `routes` entries in each
      `wrangler.jsonc` once the zone exists in that account).
- [ ] AWS: **four** S3 buckets + four CloudFront distributions (bracemark-web and
      bracemark-site, per tier) + shared CloudFront Function; ACM certs (**issued
      in `us-east-1`** — see [certificates](#certificates)); custom domains. Two
      response headers policies per tier — the app's CSP and the site's much
      smaller one (see
      [bracemark-site](#bracemark-site--aws-s3--cloudfront-planned)).
- [x] bracemark-site: scaffolded in this monorepo (`apps/bracemark-site`), env
      files + Nx `staging` build configuration mirroring bracemark-web. Not
      deployed; `/docs` and `/blog` still need a content pipeline, and `/terms`,
      `/privacy`, `/support` need real copy before store submission.
- [ ] bracemark-extractor: provision the Worker per tier (no D1/R2); set its
      `CORS_ORIGINS` var + custom domain (`extractor.*.bracemark.com`); wire
      `NEXT_PUBLIC_EXTRACT_URL` into bracemark-web's per-tier builds.
- [ ] bracemark-extension: add `WXT_PUBLIC_API_URL` + `.env.*` + `--mode staging`
      build when it starts calling the api.
- [ ] CI/CD: pick provider; wire the merge→staging, tag→production flow with
      per-tier credentials.
