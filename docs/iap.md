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

| layer      | piece                                    | role                                                                                                                                                                             |
| ---------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shared     | `iap/plans.ts`                           | `PLANS`, `entitlementsOf(plan)` — the tiers table as data, read by BOTH the client paywall and the server gate (the `LINK_TITLE_MAX` move)                                       |
| shared     | `iap/endpoints.ts`                       | contracts: `iap/status`, `iap/checkout`, `iap/portal`, `iap/verify` + `subscriptionStatusSchema`                                                                                 |
| brace-api  | `purchases` table (DIRECTORY_DB)         | one row per provider subscription, `UNIQUE(source, external_id)`                                                                                                                 |
| brace-api  | `services/iap.ts`                        | the purchases→status **fold** (grace windows, plan rank), webhook application, the staleness refresh (below), Paddle API calls                                                   |
| brace-api  | `routes/iap.ts`                          | the contract routes + `POST /v1/iap/paddle/webhook` (HMAC-authenticated, log-and-ACK)                                                                                            |
| brace-api  | `lib/quota.ts`                           | `checkPutQuota(entitlements, usage, paths)` at `files/sign`                                                                                                                      |
| react      | `useSubscriptionStatus`                  | the TanStack query on `iap/status`                                                                                                                                               |
| shared     | `iap/store-products.ts`                  | the store product-id ↔ plan catalog, read by the expo client AND the server verifiers (ids are ours, identical sandbox/production)                                               |
| brace-api  | `lib/appstore.ts`, `lib/playstore.ts`    | provider-vocab edges (lib/paddle.ts's siblings): store-API auth, authoritative fetch, status normalization                                                                       |
| brace-api  | `lib/store.ts`, `lib/jwt.ts`             | what those two edges share so neither imports the other: the normalized `StoreSubscriptionSnapshot`/`StoreSource`, and the base64url + PKCS#8 PEM helpers behind both store JWTs |
| web-react  | `useEntitlements`                        | + device-local last-known copy; cleared on sign-out                                                                                                                              |
| brace-web  | `lib/paddle.ts`, settings → Subscription | Paddle.js overlay checkout + plan cards + portal                                                                                                                                 |
| brace-expo | `lib/iap.ts`, settings → Subscription    | expo-iap store sheet + `iap/verify` + plan cards + restore + store-manage deep link (expo-react's `useEntitlements` caches in sqlite)                                            |

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
   server-authoritative. The `txn_…` is also **persisted** (`paddle_checkouts`)
   before it's returned — the only account→Paddle key that exists before a
   subscription does, and what makes a lost first webhook recoverable
   (_reconciliation_ below). Client opens `Paddle.Checkout.open({ transactionId })`.
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
`status: 'grace'` (the UI shows "payment issue", features stay on — and still
`willRenew: true` while nothing says otherwise: dunning means collection
retries are scheduled); `canceled` is entitled to `expires_at` exactly;
`paused` is not entitled. **Refunds claw back** — `expires_at` is the actual
entitlement end, not the originally paid-through date: an Apple revocation
(refund / Family Sharing) clamps it to `revocationDate`, an immediate Paddle
cancel (refund/chargeback) ends at `canceled_at` even though that event drops
the billing period, and Play pulls `expiryTime` back itself. In the other
direction, Apple's configured billing grace period (`gracePeriodExpiresDate`)
is honored as the period end while in grace, with the fold's `past_due` slack
running past whatever the provider last promised.

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
   sandbox host on 404 for App Review, since a sandbox transaction id is
   invisible to the production host — App Review buys with sandbox accounts
   against the production build) or Play Developer API
   `subscriptionsv2.get` (service-account OAuth; **no such fallback and none
   needed** — Google ships one host, so a license tester's purchase, an
   internal-track purchase and a real paid one all resolve through the same URL
   under the same package name, flagged in the response body's `testPurchase`
   rather than by endpoint; a Play 404 means the token genuinely doesn't exist)
   — normalizes the status at the
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
   **Acknowledgement (Play only).** Google auto-refunds and REVOKES an initial
   subscription purchase left unacknowledged for **3 days** (renewals are
   exempt) — the one hard deadline anywhere in this design. The app's
   `finishTransaction({ isConsumable: false })` acknowledges on Android and
   already satisfies it, but that call happens only once `iap/verify` has
   returned, so `verifyStorePurchase` **also** acknowledges server-side
   (`purchases.subscriptions.acknowledge`, the v1 endpoint —
   `subscriptionsv2` is query-only) the moment the entitlement is recorded: a
   client that dies in between can no longer lose the purchase to a silent
   revoke. Gated on Google's own `acknowledgementState` (carried on the
   snapshot as `needsAcknowledge`), which buys two things: a restore — whose
   purchase was acknowledged long ago — makes no call at all, and the
   acknowledge is **convergent** rather than fire-once: the purchase RTDN and
   the staleness refresh re-check the same flag when they re-fetch a purchase
   we have recorded (`applyStoreNotification`), so even both purchase-time
   acknowledgements failing (server 5xx + client death) is healed by the next
   event or refresh that touches the row inside the 3-day window. Best-effort
   throughout — a failure is logged and never fails a recorded purchase, a 4xx
   ("already acknowledged", the client's own call racing in) is swallowed, and
   the client call remains what stops the store replaying the transaction.
   Deliberately **not** retried for an unbound purchase: revoke-after-3-days
   there is Google refunding a payment we never entitled, which is the right
   outcome. **Apple has no equivalent**: StoreKit's
   `finishTransaction` is client-only, there is no server acknowledge endpoint,
   and an unfinished transaction is simply replayed forever with nothing
   revoked. Not to be confused with ACKing the _notifications_ below (a 200 so
   the provider stops redelivering) — different mechanism, same word.
4. **Notifications** — renewals/cancellations reach brace-api via
   `appstore/notify` (App Store Server Notifications V2) and `playstore/notify`
   (Pub/Sub RTDN push, guarded by a static `?token=` secret). Neither verifies
   provider signatures: the pushed payload is used only to find WHICH
   subscription changed, and the facts are **re-fetched from the store's API**
   (the call-back pattern — a forged POST can only make the server re-read the
   truth, bounded by the webhook rate tier). Log-and-ACK like Paddle;
   notifications carry no account and rely on the binding verify created. On a
   FIRST purchase the push routinely arrives before that binding exists — both
   stores emit it when THEIR backend completes the purchase, while verify
   additionally needs the result to reach the device and the device to reach us
   — so `applyStoreNotification`'s no-binding drop is logged at `console.log`,
   not `error`: it is the ordinary case, and verify lands seconds behind it.
   Making the push self-binding is a follow-up below.

#### plan changes on Play — the `linkedPurchaseToken` chain

Paddle and Apple keep **one identity for life**: a plan change updates the
existing `sub_…` / `originalTransactionId`, so it updates the existing
`purchases` row and there is nothing else to do. **Play re-keys.** An
upgrade/downgrade, a re-signup of a canceled-but-not-yet-lapsed subscription,
and the prepaid conversions each mint a **new purchase token** — a new identity,
so a new row — and the new record's `linkedPurchaseToken` points back at the one
it replaced.

The old token does **not** retire itself. It goes on resolving through
`subscriptionsv2.get` with its original period, so a refetch cannot discover
that it died, and the staleness refresh below never even looks at it (a row
reading active with a future expiry is exactly the shape `needsRefresh` skips).
Retiring it is the server's job — `supersedeLinkedPlayPurchase` in
`services/iap.ts`, called from both `verifyStorePurchase` and
`applyStoreNotification`. Two things break without it:

- **Downgrade.** The old higher-plan row stays entitled and the fold takes the
  best plan, so a user who moves pro → plus keeps pro until the old period would
  have ended — up to a year on an annual plan.
- **Re-signup under a second account.** The old token is bound to account A for
  life (the upsert never rewrites `user_id`) and the new one binds to B: two
  entitled accounts on one payment. `purchase_bound` cannot catch this — the two
  rows have different tokens — which is exactly the duplicate-subscription hole
  Google's own guidance is about.

Retirement ends the row now (`status='canceled'`, `expires_at` pulled back to
the supersession time — a backward expiry move like the refund clawbacks, but
asserted as our own inference rather than a provider-stated fact, hence the
idempotent MIN), rather than deleting it, so the replacement chain stays
auditable.
It is deliberately **not** scoped to the caller's `user_id`: the replaced token
may be bound to a different account, which is the whole point of the second case
above. Rows carry `linked_external_id`, so walking a Z→Y→X chain is a local read
per hop; the only outbound call is bridging a hop we never recorded (its verify
never landed), and the walk is capped. In `applyStoreNotification` it runs
**before** the binding check, since an upgrade RTDN that beats the app's verify
would otherwise drop out there and leave the old row entitled. Failure is
best-effort + logged with the alert marker — a purchase already recorded must
not fail over it, and nothing downstream retries.

### reconciliation — when a webhook never arrives

Every writer above is a provider **push**, and push has holes the providers' own
retries don't close:

| failure                                                            | recovered by the provider?          |
| ------------------------------------------------------------------ | ----------------------------------- |
| delivery failed (our 5xx, short outage)                            | yes — retried with backoff          |
| destination disabled / secret rotated wrong                        | partly — manual replay              |
| **we 200'd but couldn't apply** (unknown price/status, no binding) | **no — a 200 is never redelivered** |
| **outage longer than the retry window**                            | **no**                              |

Row three is the sharp one and it's self-inflicted: log-and-ACK is required (or
the provider redelivers forever), so every drop is permanent by construction.
Adding a `pri_…` and forgetting `PADDLE_PRICE_ID_PRO` in one env silently drops
every event for those subscribers.

So there is a **pull** side: `services/iap.ts` re-fetches a row's authoritative
state and applies it through the same code path a push takes. Three properties
are the design:

- **The server decides, not the client.** This is deliberately _not_ the old
  stxapps iap-server's `POST /status { doForce }`, which let any caller turn a
  status read into provider fan-out and refetched healthy rows to learn nothing.
  The trigger is the row's own shape (`needsRefresh`): not entitled but not
  finished (a period that ended with no renewal event; a provider row with no
  period at all), `past_due`, or `paused`. `manual` has no provider to ask;
  `canceled` is terminal. A healthy account stays exactly one indexed D1 query.
- **One pull path per provider, shared with the push path.** Paddle's webhook
  `data` and its `GET /subscriptions/{id}` `data` are the same entity, so
  `applyPaddleSubscription` normalizes and upserts both (`fetchPaddleSubscription`
  is the `lib/paddle.ts` sibling of the store fetchers that already existed).
  Stores need nothing new: the stored `external_id` **is** the provider's lookup
  key for all three sources (Paddle `sub_…`, App Store `originalTransactionId`,
  Play purchase token), so a refresh is the notification path minus the
  notification.
- **Bounded and non-fatal.** `purchases.last_synced_at` is a debounce clock
  stamped on every refresh **attempt** (success _or_ failure) and on every
  applied push — so a permanently-broken row costs one outbound call per window,
  not one per poll, and a provider being down degrades the read to the stored
  fold rather than failing it. A per-read cap bounds the fan-out independently.
  The window (~5 min) is sized by the **user-visible** path, not the background
  one: the settings page's Refresh button is just `iap/status` again, and because
  a failed attempt stamps the clock too, the window is exactly how long that
  button stays a silent no-op after one. That's the case this backstop exists
  for — the user fixes a card or resumes in the provider's portal, the event
  doesn't reach us, they press Refresh — so an hour-scale window would read as a
  broken button. Shortening it costs little, since the debounce was never the
  only bound: the per-read cap, the global rate limiter, and the fact that a
  refresh-worthy row requires a real purchase all still apply.

Three callers opt in, each where a wrong answer costs more than the round-trip:
`iap/status` (the user is asking this exact question), `iap/checkout`'s
already-subscribed guard (a stale row costs the user a second subscription), and
**`deleteAccount`'s billing gate** (`services/account.ts`) — the last read before
an irreversible action, where a row stale in the "period ended, renewal event
never landed" direction reads as free and lets the account go while the provider
keeps charging, with no session left to reach the portal with. The opposite
staleness (looks healthy, canceled at the provider) is the sweep's case either
way, so refreshing there can't block a deletion that would otherwise pass.
**`getEntitlements` never refreshes** — it sits on the `files/sign` put path,
where a provider's latency would become upload latency. Nor does
`verifyStorePurchase`'s closing fold: the upsert it just performed stamped
`last_synced_at`, so the row in question is the freshest read in the system.

**The pre-row hole — pending checkouts.** Everything above iterates `purchases`
rows, which a **first** purchase doesn't have yet: if its `subscription.created`
is lost, no row is written, nothing looks stale, and the user has paid into
silence. It can't be fixed by asking Paddle about the account either — **Paddle
has no such question.** Every list endpoint filters on Paddle's own ids
(`customer_id`, `subscription_id`, `id`); the `custom_data.userId` we stamp is
returned but never queryable, and the account model has no email to match on.

So the key is minted **before** the purchase exists: `createPaddleTransaction`
already had a `txn_…`, and now persists it (`paddle_checkouts` — see the schema
note in `db/schemas/directory.sql`). Recovery is two hops onto the existing path:
`txn_…` → `transaction.subscription_id` → `fetchPaddleSubscription` →
`applyPaddleSubscription`. Same posture as the staleness gate — the server
decides from stored state, the client has no say — but on a **much shorter
clock**: a pending checkout's whole life is the minute after a payment with the
user watching (`pollActivation` re-reads `iap/status` every 2s for 30s), so even
the 5-minute `REFRESH_DEBOUNCE_MS` would be actively harmful here. The first poll
fires before Paddle has provisioned anything, learns nothing, and would then
debounce away the entire window the user is actually waiting through. Hence its
own constants, sized against that ~30s window rather than against a background
sweep: **don't ask under ~20s**, **~10s between attempts**, **3-day TTL**, and a
per-read cap of 2, the sibling of `MAX_REFRESH_PER_READ`.

The spacing is the load-bearing one. A row is inserted with `last_synced_at = 0`,
so the first attempt always lands on the first poll past the age floor — seconds
after payment, when Paddle is least likely to have populated
`transaction.subscription_id` yet. A debounce anywhere near the width of the
client's window would therefore buy exactly **one** attempt, at the worst moment
in the checkout's life; at ~10s the window holds 3-4, the last a full ~30s after
payment. (The age floor can't cover for it: `created_at` is stamped when the
transaction is minted, _before_ the overlay opens, so it measures time since
checkout started, not since payment — nearly every user has cleared it before
polling begins. It suppresses reads that arrive while the overlay is still open,
and little else.)

The TTL is the other end of the same argument, and it is sized by **when the user
comes back**, not by the poll window (the debounce owns that) — so an hour-scale
TTL would discard the only case with real value. 3 days lines it up with
[Paddle's own retry exhaustion](https://developer.paddle.com/webhooks/about/respond-to-webhooks/)
(60 attempts across 3 days, 47 in the first day), so the row is still there to
_pull_ whatever Paddle eventually gave up _pushing_; it also spans a
pay-Friday-reopen-Monday gap and gives an operator time to fix the config bug
behind an `unknown_price` drop — the one hole Paddle never retries at all, and
whose alert token this path suppresses.

The table means exactly one thing — "this account started a checkout we've seen
no subscription for" — so pending is _row exists_, with no status column: every
terminal outcome **deletes**, and the rest age out on the next scan. Four are
terminal:

- **applied** — `purchases` is the durable record from then on (`resolveCheckout`
  when the pull side got there first);
- **the created webhook landed** — the happy path, and the common one.
  `subscription.created` is the one event Paddle stamps with the `transaction_id`
  that caused it, so the push side can retire the row by exact key
  (`applyPaddleEvent`). Gated on the apply having **landed**: an unapplied event
  is exactly the permanent drop the row exists to retry. It's also the only
  reaper for a successful purchase — an entitled account returns before the scan,
  and its next checkout (the other `deleteStale` caller) is refused as
  already-subscribed, so without this a subscriber's row would never leave;
- **the transaction is canceled**, or **Paddle 404s the id** — nothing will come
  of either;
- **abandoned** — old (~12h) and the transaction is still `draft`/`ready`, i.e. no
  payment was ever _attempted_, so it cannot be the paid-into-silence case at all.
  This is what pays for the 3-day TTL: abandonment is the bulk of the table, and
  until a row is gone it adds a Paddle round-trip to that free account's status
  reads (background ones — `useEntitlements` renders a last-known copy meanwhile).
  Gating on the **status** and not on age alone is what makes it safe, and the
  clock is generous on purpose: it's the only irreversible step here, a `ready`
  transaction has no documented expiry at Paddle, and hour-scale delays between
  opening a checkout and paying are ordinary. Half a day sheds ~5/6 of the tax
  without betting a paid user's recovery on a slow checkout.

An abandoned checkout is otherwise indistinguishable from a lost webhook, which
is precisely why the row is disposable. Two properties fall out: the gate is a
plain existence check, and the row's `user_id` (written from the **session**)
serves as a fallback binding when a first-seen subscription's `custom_data`
didn't survive. Cost to everyone else is nil — an entitled fold can't be hiding a
lost first webhook, so the check runs only after a read still says `free`.

**Drop visibility — a log, not a dead-letter table.** The pull side recovers any
drop on a subscription we already have a row for: the row is what the staleness
gate iterates, so once the bad config is fixed the next status read re-pulls it.
A drop on a **first-seen** subscription used to be unrecoverable outright; with
pending checkouts it now gets retried every debounce window until the TTL, so
`IAP_DROP_UNRECOVERABLE` is suppressed on that path and what's left of the token
means a drop that escaped the webhook _and_ that window (no pending row, or one
already aged out). `applyPaddleSubscription` looks up the binding first and tags
only that case, plus the `sub_…` id: one greppable token to alert on, carrying
exactly what a replay needs. Deliberately not a D1 dead-letter table —
Paddle already stores every notification and replays it on demand, so a table
would duplicate the provider's own queue with no drainer to justify it, and a
dead-letter row without something draining it is a log entry with worse
ergonomics. This leans on `observability.enabled` in `wrangler.jsonc` (Workers
Logs retains and makes `console.error` queryable); without that the argument
collapses. Revisit if drops become routine rather than a config bug fixed once,
or if we ever consume an event a provider doesn't retain.

**What this does not catch:** a row that looks healthy but was canceled at the
provider without the event reaching us. It over-entitles until its period ends,
and no read-path heuristic can see it — the row looks perfect. Nor does anything
above run without a user: every trigger hangs off a status read, so an account
nobody opens is never reconciled.

Both are the **scheduled-sweep** case, and when it's worth building, prefer
Paddle's **event stream** (`GET /events?after=<cursor>`, cursor-paginated, ~90-day
retention) over the age-based row scan first sketched here: replaying every
`subscription.*` since the last cursor closes _all four_ rows of the table above
at once — including events we 200'd but couldn't apply — with no per-user key
needed, and the repo upsert's out-of-order guard makes re-applying already-seen
events free. Not built yet: the read-path gates cover the direction users
actually report (paid but showing free), and a cron + cursor is worth its
infrastructure once there's subscriber volume. Meanwhile Paddle's Notifications
API (`GET /notifications`, `POST /notifications/{id}/replay`) is the ops escape
hatch, and the dashboard's replay button is the zero-code version available today.

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
  `PLAY_PACKAGE_NAME`/`PLAY_SA_EMAIL` (**no `PLAY_API_BASE`** — the Play
  Developer API has one host for test and real purchases alike, so Play's
  per-env dimension is the package name + service account); secrets
  `APPSTORE_PRIVATE_KEY` (the
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
- **Self-binding store notifications** — give the stores their own
  `custom_data.userId` so a push can record a purchase the app never verified:
  stamp the account onto the purchase at request time via `appAccountToken`
  (iOS) / `obfuscatedAccountId` (Android) — both typed by the installed
  expo-iap, and both returned on the authoritative fetch (the JWS transaction
  payload; `obfuscatedExternalAccountId` on `subscriptionsv2`). Then
  `applyStoreNotification` gets the same `fallbackUserId` parameter
  `applyPaddleSubscription` already takes for pending checkouts, and the trust
  split is unchanged: **plan from the store, account from the stamp**. Needs a
  binding-key decision first — the client doesn't know its own userId (the fact
  that makes Paddle checkout server-created), so either expose it or mint a
  per-purchase token, which Apple constrains to UUID format (`newId()` is
  `crypto.randomUUID()`, so both qualify). Deliberately deferred: this is
  **purchase recovery, not latency**. Losing the notification race costs the
  user nothing today — verify's own response is the flipped plan, with no
  polling — so the payoff is only where verify never lands at all (app killed,
  offline, a 502), which today ends in Google's 3-day auto-refund or an Apple
  user tapping "Restore purchases". Worth building when store volume makes that
  tail real.
- **Privacy note** — payment inherently deanonymizes (Paddle holds email +
  payment identity). brace-api stores only `userId ↔ subscription id ↔ ctm_…`;
  keep it that minimal so "the server knows who pays but still can't read
  anything" stays true.
