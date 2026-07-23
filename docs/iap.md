## iap — subscriptions, paywall, entitlements

How a brace account buys, holds, and exercises a subscription. Companion to
[business-model.md](./business-model.md) (the tiers and why they cut where they
cut); see [api-contracts.md](./api-contracts.md) for the endpoint pattern the
IAP contracts follow and [local-first-sync.md](./local-first-sync.md) for the
`files/sign` quota gate the entitlements feed.

### the two decisions everything else follows from

**1. IAP lives in brace-api — not a separate app.** The extractor earned its own
app because it fetches arbitrary user URLs (plaintext content through a server —
the thing "api.brace.to only sees ciphertext" must exclude). Billing is not
content: brace-api already holds plaintext _account_ metadata (usernames,
`public_key`, sessions), and a subscription row is the same class. Decisively,
brace-api is itself the main **consumer** of entitlements — the plan-aware quota
gate runs on its own `files/sign` hot path — so a separate billing service would
put a cross-service read on that path for nothing.

**2. Subscription state is NOT a synced entity.** It is a server-derived fact
whose writer of record is a payment-provider webhook; the server can't write
into the user's encrypted keyspace, so a synced `settings/iap.enc` could only be
a stale, client-authored echo — unverifiable (any client could write
`plan: 'pro'` into its own ciphertext) and racing itself under LWW. Instead,
**`GET /v1/iap/status` is the one authority** and every device caches its
answer (web: `useEntitlements`' localStorage last-known copy, so an offline
start doesn't flash free). Cross-device consistency needs no sync here: any
device that can sync can ask.

### the pieces

| layer     | piece                                    | role                                                                                                                                       |
| --------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| shared    | `iap/plans.ts`                           | `PLANS`, `entitlementsOf(plan)` — the tiers table as data, read by BOTH the client paywall and the server gate (the `LINK_TITLE_MAX` move) |
| shared    | `iap/endpoints.ts`                       | contracts: `iap/status`, `iap/checkout`, `iap/portal`, `iap/verify` + `subscriptionStatusSchema`                                           |
| brace-api | `purchases` table (DIRECTORY_DB)         | one row per provider subscription, `UNIQUE(source, external_id)`                                                                           |
| brace-api | `services/iap.ts`                        | the purchases→status **fold** (grace windows, plan rank), webhook application, Paddle API calls                                            |
| brace-api | `routes/iap.ts`                          | the contract routes + `POST /v1/iap/paddle/webhook` (HMAC-authenticated, log-and-ACK)                                                      |
| brace-api | `lib/quota.ts`                           | `checkPutQuota(entitlements, usage, paths)` at `files/sign`                                                                                |
| react     | `useSubscriptionStatus`                  | the TanStack query on `iap/status`                                                                                                         |
| shared    | `iap/store-products.ts`                  | the store product-id ↔ plan catalog, read by the expo client AND the server verifiers (ids are ours, identical sandbox/production)         |
| brace-api | `lib/appstore.ts`, `lib/playstore.ts`    | provider-vocab edges (lib/paddle.ts's siblings): store-API auth, authoritative fetch, status normalization                                 |
| web-react | `useEntitlements`                        | + device-local last-known copy; cleared on sign-out                                                                                        |
| brace-web | `lib/paddle.ts`, settings → Subscription | Paddle.js overlay checkout + plan cards + portal                                                                                           |
| brace-expo| `lib/iap.ts`, settings → Subscription    | expo-iap store sheet + `iap/verify` + plan cards + restore + store-manage deep link (expo-react's `useEntitlements` caches in sqlite)      |

`purchases` is **global** (DIRECTORY*DB, not an account shard) because webhook
events after the first arrive keyed by the \_provider's* subscription id with no
username/session to route a shard by — a per-shard table would force the
forbidden try-every-shard scan. Rows are tiny, bounded per user, and
money-adjacent (Tier-0 backup set).

### the purchase flow (Paddle Billing — web)

> The old stxapps iap-server was **Paddle Classic** (`p_signature`,
> vendor/product ids, `/paddle/pre` randomId passthrough) — closed to new
> accounts. This is **Paddle Billing**: `pri_…` price ids, `Paddle-Signature`
> HMAC webhooks, `@paddle/paddle-js`. None of the Classic code ports.

1. **Checkout** — `POST /v1/iap/checkout { plan }` (authed). The server creates
   the Paddle transaction: it stamps `custom_data.userId` from the session (the
   client never knows its own userId — it's server-minted) and picks the
   `pri_…` id from env config, so both the account binding and the price are
   server-authoritative. Client opens `Paddle.Checkout.open({ transactionId })`.
   Guard: an already-subscribed account 409s (`already_subscribed`) — a second
   checkout would mint a second live subscription; Plus→Pro is a subscription
   _update_ (proration), a separate flow, not yet built.
2. **Webhook** — Paddle → `POST /v1/iap/paddle/webhook`. Signature = HMAC-SHA256
   over `${ts}:${rawBody}` against the per-destination secret, ±5 min replay
   window. Past the signature everything is **log-and-ACK** (a signed event we
   can't apply must still 200, or Paddle redelivers it forever). Only
   `subscription.*` events are consumed (renewals arrive as
   `subscription.updated`; `transaction.completed` is deliberately ignored).
   Application is one idempotent upsert keyed by `(source, external_id)` with
   three in-SQL guards: stale events lose on `event_occurred_at`, `user_id` is
   first-write-wins for life, and `expires_at` COALESCEs so an event that omits
   the period keeps the last known end.
3. **Activation** — payment truth reaches the account via the webhook, never the
   client; after `checkout.completed` the UI just **polls `iap/status`** until
   the plan flips (webhooks lag checkout by seconds).

**The fold** (`foldSubscriptionStatus`, pure + unit-tested): best entitled row
wins (plan rank, then latest expiry; `expiresAt: null` = non-expiring
manual/lifetime grant). Entitlement windows: `active`/`trialing` get +1 day
slack past `expires_at` (renewal-webhook lag must not flicker subscribers to
free); `past_due` stays entitled ~16 days (Paddle dunning) and surfaces as
`status: 'grace'` (the UI shows "payment issue", features stay on);
`canceled` is entitled to `expires_at` exactly; `paused` is not entitled.

**Manage/cancel** — `POST /v1/iap/portal` mints a Paddle customer-portal
session URL (needs the secret API key + stored `ctm_…` id, hence server-side).
Store-bought subscriptions (future) are managed in their store.

### enforcement — who enforces which limit

The E2E trust split, spelled out (matches the business model's principle: hard
walls exactly where the cost is):

| limit                                     | enforced                                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| storage bytes (free 100 MiB / 5 / 20 GiB) | **server-hard** — `files/sign`; on free it's the only backstop on preview-image blobs (with the count cap + the 200-link cap)                                                                                                 |
| free: 200 `links/`                        | **server-hard** (namespace count in the DO size map) + client UX                                                                                                                                                              |
| free: preview-image `files/` blobs        | **allowed** — no per-namespace plan gate: a preview image is an opaque `files/` blob the server can't tell from a heavy one, so it's bounded only by the bytes/count backstop; the heavy-blob facets are client-gated (below) |
| Plus page-copy meter (last 50)            | client-only — a page copy is indistinguishable from any other `files/` blob server-side; bytes backstop                                                                                                                       |
| read-mode / screenshot / AI gates         | client-only (they run on-device), backstopped by the blob rules                                                                                                                                                               |
| extractor access (plan-gated opt-in)      | client + IP rate limits for now (the extractor is anonymous by design); a brace-api-minted signed entitlement token is the upgrade path if abused                                                                             |

Error codes at the gate: `upgrade_required` (a **plan** gate — client maps to
the paywall) vs `quota_exceeded` (a **capacity** gate on an entitled plan —
"storage full"). Puts are the only gated op: GETs and deletes always work, so an
over-quota or downgraded account degrades to **read-only-plus-delete, never
data loss**.

### the purchase flow (store IAP — brace-expo)

The client library is **expo-iap** (the OpenIAP successor to the deprecated
react-native-iap; Expo Modules-based, config plugin in `app.json`, native — so
`npx expo prebuild` required). `apps/brace-expo/src/lib/iap.ts` is the
`lib/paddle.ts` sibling: lazy store connection, global purchase listeners
routed to the open checkout's handlers, and the verify-then-finish protocol.
The store product ids are OURS and identical in sandbox and production (unlike
Paddle's per-env `pri_…` ids), so they're shared constants —
`iap/store-products.ts` in `@stxapps/shared` — read by both the client
(`fetchProducts`, the purchase request) and the server (productId → plan, the
authoritative mapping).

The flow inverts Paddle's direction: a store purchase is a **client-side event**
the server only learns about from the receipt the app submits.

1. **Purchase** — the section's upgrade card opens the store's own sheet
   (`requestPurchase`); prices shown come from the fetched product's
   `displayPrice` (the store's localized, tax-correct number — the USD table is
   only placeholder copy).
2. **Verify** — on the purchase event the app POSTs `/v1/iap/verify`
   `{ source, productId, token }` (App Store transaction id / Play purchase
   token). The token is only a **lookup key**: brace-api fetches the
   authoritative state server-to-server — App Store Server API
   `subscriptions/{transactionId}` (ES256 JWT; production falls back to the
   sandbox host on 404 for App Review) or Play Developer API
   `subscriptionsv2.get` (service-account OAuth) — normalizes the status at the
   edge (`lib/appstore.ts` / `lib/playstore.ts`, the `lib/paddle.ts` siblings),
   and upserts the same `purchases` row. **This call is what binds
   subscription → account** (first sight is for life, the webhook rule); a
   replayed token 409s (`purchase_bound`). The response is the fresh fold — no
   post-checkout polling (the webhook lag that polling covers on web doesn't
   exist here).
3. **Finish** — only after the server has recorded it does the app
   `finishTransaction`. A failed verify leaves the transaction unfinished, so
   the store REPLAYS it on the next connection — the built-in retry;
   "Restore purchases" re-drives the same verify for anything the store holds
   (App-Review-required, and the reinstall/new-device recovery).
4. **Notifications** — renewals/cancellations reach brace-api via
   `appstore/notify` (App Store Server Notifications V2) and `playstore/notify`
   (Pub/Sub RTDN push, guarded by a static `?token=` secret). Neither verifies
   provider signatures: the pushed payload is used only to find WHICH
   subscription changed, and the facts are **re-fetched from the store's API**
   (the call-back pattern — a forged POST can only make the server re-read the
   truth, bounded by the webhook rate tier). Log-and-ACK like Paddle;
   notifications carry no account and rely on the binding verify created.

The fold, `iap/status`, and the quota gate don't change at all. Manage/cancel
for store purchases lives in the platform store's own surface (the app
deep-links to it); a Paddle purchase seen from the app gets a
"manage on the web" note, the converse of the web's store note.
`source: 'manual'` covers comps/lifetime grants (non-expiring rows).

### config per env

- **brace-api** (`wrangler.jsonc`): `PADDLE_API_BASE` (sandbox for
  development/staging, live for production), `PADDLE_PRICE_ID_PLUS/_PRO`
  (per-env — sandbox and live mint different `pri_…` ids); secrets
  `PADDLE_WEBHOOK_SECRET` + `PADDLE_API_KEY` via `wrangler secret put`
  (`.dev.vars` locally). Register the webhook destination per env at
  `…/v1/iap/paddle/webhook`, subscribed to `subscription.*` events.
- **brace-api, store IAP** (`wrangler.jsonc`): `APPSTORE_API_BASE` (sandbox host
  for development/staging, production host for production — production also
  falls back to sandbox on 404 in code, for App Review),
  `APPSTORE_ISSUER_ID`/`APPSTORE_KEY_ID`/`APPSTORE_BUNDLE_ID`,
  `PLAY_PACKAGE_NAME`/`PLAY_SA_EMAIL`; secrets `APPSTORE_PRIVATE_KEY` (the
  In-App Purchase key's PKCS#8 PEM), `PLAY_SA_PRIVATE_KEY` (the service
  account's), and `PLAY_NOTIFY_TOKEN` (the push-endpoint guard) via
  `wrangler secret put` (`.dev.vars` locally). Register per env: App Store
  Server Notifications V2 → `…/v1/iap/appstore/notify`; Play RTDN Pub/Sub push
  → `…/v1/iap/playstore/notify?token=<PLAY_NOTIFY_TOKEN>`. No store product-id
  vars — those are shared constants (`iap/store-products.ts`).
- **brace-web** (`.env.*`): `NEXT_PUBLIC_PADDLE_ENV` +
  `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` (client tokens are public by design).
- **CSP note**: when brace-web's CSP ships (it lives in the **CloudFront response
  headers policy**, not Next or Cloudflare — brace-web is a static export), it
  must allow Paddle's origins: `script-src`/`frame-src`/`connect-src`/`img-src`/
  `style-src` all need `https://*.paddle.com` (one wildcard covers sandbox +
  live). Concrete directives + the `connect-src` exfiltration-widening tradeoff
  are in [deployment.md](./deployment.md#brace-web--aws-s3--cloudfront-planned).

### open follow-ups

- **Plan change (Plus→Pro)** — a Paddle subscription _update_ with proration;
  until then upgrade cards show only on free and the server 409s a second
  checkout.
- **Save-time link-cap UX** — the 200-link wall is server-enforced at sync, but
  the create editors don't pre-check it yet; a local count check + upsell dialog
  beats a silent sync failure. Same for surfacing `upgrade_required` from the
  sync engine.
- **Extraction gating beyond the settings toggle** — free stores the preview
  image, but the HEAVY blob facets (read-mode / screenshot / page copy) are
  client-gated: since the server no longer refuses any `files/` put (it can't
  tell a preview image from a heavy blob), client extractors must skip those
  heavier facets on free accounts themselves — the bytes/count quota is only a
  backstop, not the feature gate.
- **Plan change on the stores** — same gap as Paddle's Plus→Pro: a store
  crossgrade (both plans share one App Store subscription group / Play
  subscription) is its own flow; until then upgrade cards show only on free.
- **Privacy note** — payment inherently deanonymizes (Paddle holds email +
  payment identity). brace-api stores only `userId ↔ subscription id ↔ ctm_…`;
  keep it that minimal so "the server knows who pays but still can't read
  anything" stays true.
