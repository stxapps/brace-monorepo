## business model

Working economics for bracemark.com as a **privacy-first** bookmark / read-later app:
tiering, infra cost, and break-even. Companion to the product/architecture docs —
see [link-extraction.md](./link-extraction.md) for why extraction (and its heavy
image/screenshot/page-copy blobs) is the main storage line item,
[local-first-sync.md](./local-first-sync.md) for the blind-broker data path that
keeps server cost low, [deployment.md](./deployment.md) for the Cloudflare
(R2/D1/Workers) infrastructure these numbers are priced against, and
[iap.md](./iap.md) for how the tiers below are implemented (Paddle
subscriptions, the entitlement fold, and which limit is enforced where).

All figures are **planning estimates**, not committed prices. Flex the assumptions.

### the cost structure is unusually favorable

Two architectural decisions make infra cost a non-issue, and they're the same
decisions that make bracemark private:

- **Cloudflare R2 has zero egress fees.** The instinctive "30k images downloaded
  over and over = transfer bill" fear is the AWS/S3 model. R2 doesn't charge
  egress, so the heavy preview-image blobs (see
  [link-extraction.md](./link-extraction.md) — _the preview image is a downloaded
  blob_) cost storage only, not transfer.
- **`bracemark-api` is a blind sync broker — clients do all extraction.** The server
  does no per-user fetch, render, or content compute (see
  [link-extraction.md](./link-extraction.md) — _the stance_). So none of the
  per-user CPU/egress that kills cloud-AI read-later apps applies here. Privacy
  stance and cost structure are the **same** decision.

Rough infra for a heavy 30k-link / 3 GB user, priced on R2:

| item                       | math            | cost/yr         |
| -------------------------- | --------------- | --------------- |
| R2 storage (3 GB)          | 3 × $0.015 × 12 | **~$0.54**      |
| R2 egress                  | free            | **$0**          |
| R2 writes (Class A, ~30k)  | 30k × $4.50/M   | **~$0.14**      |
| R2 reads (Class B, sparse) | sync-driven     | **~$0.10–0.50** |
| D1 (metadata rows)         | tiny            | **~cents**      |

So even a worst-case whale costs **~$1–2/yr** in infra against $48+/yr revenue —
a 95%+ gross margin. **Cost is never the wall; customer acquisition is.**

The one place cost _does_ leak in is the **`bracemark-extractor`** server path
(outbound fetch + compute, and anonymous/abuse-exposed). It's now a
**necessary** app to build — once the extension went active-context only it's the
only bulk-enrichment path for web/desktop users — but its _feature_ stays **opt-in
and off by default**, which is the right call on cost/abuse grounds too (see
[link-extraction.md](./link-extraction.md) — _server extraction_).

**The image proxy is part of this path — and deliberately the cheap shape.** A
web-app save can't fetch the og:image itself (CORS blocks JS from reading
cross-origin image bytes), so `bracemark-extractor` **streams** the preview image
through to the client — inline for a single save, a `GET /image?url=…` proxy for a
bulk import (see [link-extraction.md](./link-extraction.md) — _the preview image is
a downloaded blob_ / _server extraction_). The rejected alternative — extractor
**stores** the image in R2 and hands back a signed URL — would have added a storage
line item, orphan/TTL cleanup, _and_ a plaintext-at-rest leak. Streaming through
costs almost nothing on Cloudflare: **Workers don't bill bandwidth and the image is
never stored**, so the proxy adds only request count + a little streaming CPU
(streaming is I/O, billed as CPU-ms it barely uses) — ~**$0.01** even for a
30k-link import (30k × ~$0.30/M requests). It rides the **same opt-in +
IP-rate-limit** as the HTML fetch, opening no abuse surface that path doesn't
already carry. Net: a rounding error on top of the already-opt-in `bracemark-extractor`
cost, not a new cost category — the storage tables below are unchanged.

### tiers

Two kinds of gate do the work here, and keeping them straight is the whole model:

- **Cost-defensive gates** protect real cost / the moat — heavy blob storage
  (screenshot / read-mode / page copy, _not_ the free preview image), byte quota,
  page-copy count, `serverExtraction`, AI compute. Enforced where the cost is
  (server-hard where countable; see [iap.md](./iap.md) and
  `packages/shared/src/iap/plans.ts`). These are why a free user costs cents.
  Note the **200-link cap is the one cost-defensive gate that is NOT server-hard**
  — it is a conversion lever whose bypass costs a few hundred KB, so it is
  enforced on the create surfaces and backstopped by the byte ceiling; see
  _the link cap is honor-system_ below.
- **Value-capture gates** are pure willingness-to-pay for things that cost
  ~nothing to serve — client-enforced UX. This is where the "extra features"
  live, and they carry conversion while on-device AI is still parked. The
  **preview image is _not_ one of these**: the client extracts it for free and it's
  table-stakes for a modern bookmark app, so it stays **free for everyone** (see the
  keystone note below) — gating a zero-cost daily-loop basic would cost more in
  first-impression bounce than it wins in conversion.

Design principle for the **cost-defensive** gates: the free tier limits the
things that **cost money or weaken the moat** (screenshot / read-mode / page copy
blobs + `serverExtraction` = the storage / fetch tail; AI = compute), never the
things that are nearly free and build the habit (metadata, sync, encryption — and
the client-extracted preview image, which costs us ~nothing and is table-stakes, so
free users **see** it). Free users then cost cents, and the upgrade triggers are
features people feel — not a crippled daily view.

The **value-capture** gates follow a different rule — gate only what passes all
four tests: costs ~nothing, is **not** in the daily habit loop, signals identity
to the wedge audience, and reads as "a pro unlocked something" rather than "they
crippled the basics." Theme, flat tags, flat lists, pin, sort options, sibling
reorder, multi-select move/tag/delete, **client-extracted preview images**, and
**full data export** all fail that test on purpose — so they stay **free for
everyone** (see _no lock-in_ below). The
gated levers all share one shape: **structural depth or bespoke sequence** the
free library is too small to need.

The two paid tiers then have a spine, not just a longer list:

- **Plus** — the deeply-organized library: _you_ structure it
  (nested lists, nested tags, per-list link order + locks).
- **Pro** — the library that organizes and understands itself (automated /
  dynamic organization + intelligence).

|                                           | **Free**                       | **Plus** — $48/yr             | **Pro** — $96/yr _(planned)_ |
| ----------------------------------------- | ------------------------------ | ----------------------------- | ---------------------------- |
| Price                                     | $0                             | $48/yr ($4/mo) · $5.99/mo     | $96/yr ($8/mo)               |
| Free trial                                | —                              | 14 days, **annual plan only** | 14 days, annual only         |
| Lifetime _(launch lever, then retired)_   | —                              | $149                          | —                            |
| Saved links                               | 200                            | Unlimited                     | Unlimited                    |
| Storage quota (blobs)                     | preview imgs only (≤200)       | 5 GB                          | 20 GB                        |
| E2E encryption                            | ✅                             | ✅                            | ✅                           |
| Sync across devices                       | ✅ (habit-builder — don't cap) | ✅                            | ✅                           |
| Browser extension (save)                  | ✅                             | ✅                            | ✅                           |
| Mobile share sheet (save)                 | ✅                             | ✅                            | ✅                           |
| Theme, flat tags, flat lists, pin         | ✅                             | ✅                            | ✅                           |
| Sort + manual reorder (lists/tags/pins)   | ✅                             | ✅                            | ✅                           |
| Layouts (card, list)                      | ✅                             | ✅                            | ✅                           |
| Multi-select move / tag / delete          | ✅                             | ✅                            | ✅                           |
| Full data export (no lock-in)             | ✅                             | ✅                            | ✅                           |
| Search (words, all links)                 | ✅                             | ✅                            | ✅                           |
| Preview images (downloaded blob)          | ✅ (client-extracted)          | ✅                            | ✅                           |
| Browser extension extraction              | ✅                             | ✅                            | ✅                           |
| Mobile app extraction.                    | ✅                             | ✅                            | ✅                           |
| Server extraction (`bracemark-extractor`) | ❌                             | opt-in                        | opt-in                       |
| Nested lists                              | ❌                             | ✅                            | ✅                           |
| Locks (app lock + per-list hide)          | ❌                             | ✅                            | ✅                           |
| Search editor (fields, lists, tags)       | ❌                             | ✅                            | ✅                           |
| Read-mode (clean reader text)             | ❌                             | ▹ planned                     | ▹ planned                    |
| Table layout (custom columns)             | ❌                             | ▹ planned                     | ▹ planned                    |
| Screenshot capture                        | ❌                             | ▹ planned                     | ▹ planned                    |
| Full page copy (offline snapshot)         | ❌                             | ▹ planned                     | ▹ planned                    |
| Nested tags (tag hierarchy)               | ❌                             | ▹ planned                     | ▹ planned                    |
| Per-list manual link ordering             | ❌                             | ▹ planned                     | ▹ planned                    |
| Smart lists / smart tags                  | ❌                             | ❌                            | ▹ planned                    |
| Saved searches (persist queries)          | ❌                             | ❌                            | ▹ planned                    |
| AI (auto-tag, summary, semantic search)   | ❌                             | ❌                            | ▹ planned                    |

▹ **planned** = held for feedback, not committed even as the destination — gate
if/when demand shows (see _launch sequencing_).

Why these cuts:

- **The free tier is genuinely good — and that's the point; the keystone paywall
  is scale + heavy blobs, not the preview image.** A client (browser extension /
  expo) extracts the preview image itself at **zero cost to us** (the expensive,
  abuse-exposed `bracemark-extractor` path never runs), and a thumbnail-less library
  looks broken next to every competitor — so withholding it would lose more to
  first-impression bounce than it wins in conversion, and it's misaligned with the
  wedge (privacy / PKM / research users convert on **scale and structure**, not
  thumbnails). So free **shows** the client-extracted image (encrypted, ~tens of
  KB/link — a maxed 200-link free user is ~16 MB, ~0.3¢/yr, so a million cost pocket
  change). What actually drives Free→Plus is the honest, load-bearing set: the
  **200-link cap** (scale), nested lists/tags + per-list order (structure), **locks**
  (the wedge lever), and the genuinely-costly server/compute tail below.
- **Read-mode / screenshot / page copy** are the heavy blobs — and unlike the free
  preview image these are the true _storage_ gate (server-fetched / compute-side),
  gated for cost. The page copy is metered (50 → unlimited) because full-page snapshots
  are the single biggest storage line item; the Plus→Pro jump is "permanent offline
  library."
- **200 free links** is enough to evaluate seriously but past "free forever."
  Tune 100–300 after real usage.
- **The link cap is honor-system, deliberately.** Every create surface refuses at
  the cap — the three in-process editors via `useLinkQuota`, the share sheet via
  `isAtLinkCap`, and import up front — but `files/sign` does not count links, so
  devtools or a patched extension build walks through it. That was a trade, not
  an oversight. Enforcing it blind cost a create-vs-update existence check on
  every sign batch (an account AT its cap must still be able to retitle and
  **trash** what it owns, and trashing is itself a `links/` put), a partial-push
  retry in the sync engine, and a whole sync state for "some of your changes were
  refused" — all to defend a few hundred KB of metadata that the byte ceiling
  still bounds. The gates that actually cost money (`maxBytes`, `maxFiles`) stay
  server-hard. The bet is that a user who patches JS to dodge $48/yr was never a
  conversion, and that the machinery was buying us less than it cost; if
  free-tier abuse ever shows up in the numbers, the check goes back in
  server-side and the honest place to put it back is `lib/quota.ts`. Mechanics:
  [iap.md](./iap.md), _enforcement_.
- **Don't cap sync/devices on free** — nearly free for us, and the only thing that
  builds a daily habit. Crippling it just guarantees churn before any paywall.
- **The value-capture layer is deliberately small and honest, and split by a
  bright line: STRUCTURE is gated, cosmetics and basics are not.** Plus gates the
  hand-structuring levers (nested lists, nested tags, per-list link order) plus
  locks; Pro gates the automated ones (smart lists/tags, saved searches).
  Everything habit-loop or table-stakes — theme, flat tags, flat lists, pin, sort,
  **manual reorder of list/tag siblings and pins**, multi-select move/tag/delete —
  stays free, because gating those raises churn and earns bad reviews, not
  upgrades. Note the tag split mirrors the list split: **flat tags are free**
  (the free tier's core organizing primitive), only tag _hierarchy_ is the lever.
- **Sibling ordering is free; per-list link ordering is the one that's gated.**
  Manual reorder of the list/tag trees' **siblings** and of **pins** stays free:
  at the free tier's scale (≤200 links, a handful of lists/tags) hand-arranging is
  a cheap habit-loop nicety with ~no willingness-to-pay, and free users already
  hand-order links via **pins** (core daily-loop, table-stakes) — so paywalling
  tree order would be an arbitrary, petty line. The exception is per-list manual
  **link** ordering: a hand-curated sequence only pays off once a list outgrows
  the free tier's whole library, so it's coupled to unlimited links and sits in
  the Plus structural spine (next to nested lists / nested tags).
- **Search is a three-rung ladder, split by structure — not by whether you can
  search at all.** Free gets real word search across the _whole_ library
  (title / url / host); gating that would cripple a daily-loop basic and earn bad
  reviews (the same trap as capping sort/pins). Plus gets the **structured query
  editor** — field-scoped (url vs title), multi-list / multi-tag, boolean — which
  is client-side so it costs nothing and couples to unlimited links the same way
  per-list ordering does. Pro persists those queries as **saved searches**, the
  automated rung next to smart lists. Basic → structure-by-hand → automated mirrors
  the Free → Plus → Pro spine exactly.
- **Layouts: the customizable table is the lever, not the view.** Card and list
  layouts are free — a bare view mode is cosmetic, and cosmetics stay free. The Plus
  gate is the **table with user-chosen, reorderable columns**: a power/density tool
  for the research/PKM wedge, client-rendered so ~free, outside the casual daily loop
  (casual users live in cards), and it reads as "a pro unlocked a grid," not "they
  crippled the basics." It's a desktop power view — on narrow viewports it falls back
  to the list layout rather than fighting horizontal scroll.
- **The Plus→Pro spine is structural vs automated organization.** Plus lets you
  structure the library by hand (nested lists, nested tags, per-list link order)
  and lock it down; Pro makes it organize itself (smart lists, saved searches).
  That second half is **deterministic — buildable without waiting on AI**, so Pro
  isn't hostage to on-device-model timing. That's a readiness point, _not_ a
  ship-date: Pro is **sequenced after Plus**, not live at launch (see _launch
  sequencing_).
- **Locks are the wedge lever, and not a privacy contradiction.** E2E encryption
  is free for everyone — that's the security substrate. The lock is only the
  convenience layer over it (biometric quick-lock, hide-a-list), so charging for
  it isn't charging for privacy. The mechanism — a shoulder-surfing deterrent
  over already-decrypted data, gated on this `locks` entitlement — is
  [locks.md](./locks.md).
- **No lock-in: full data export is free.** This is local-first + E2E — the data
  already lives on the user's device, so "export" is just serializing what they
  already hold. Charging to leave would betray exactly the privacy wedge you're
  courting; instead, easy exit is a trust asset that lowers the risk of trying the
  app and paradoxically improves retention.
- **AI is parked, not a current lever.** On-device models aren't good enough yet,
  so no plan ships AI today; it's marketed as "coming" and, when it lands, belongs
  wholly to Pro (all intelligence lives in Pro). Plus is already carried by
  unlimited links + locks + the heavy-blob upgrades (read-mode / page copy), so
  nothing bets on AI timing.
- **Free needs no user-facing quota meter:** the only blob it stores is the
  client-extracted preview image, bounded by the 200-link cap (× a per-image byte
  ceiling, the same one `bracemark-extractor`'s `safeFetch` enforces); every _heavier_
  blob (screenshot / read-mode / page copy) is still absent, so there is nothing to
  surface in a quota UI.
- **Lifetime ($149)** front-loads cash and suits the privacy/PKM crowd, but is a
  long-tail liability under E2E — offer as a launch lever, then retire. It's
  attached to **Plus**, not Pro: Plus is the only paid plan on sale at launch
  (see _launch sequencing_), and $149 against $48/yr is a ~3.1-year payback,
  which reads as a real deal. Against the old $24/yr it was 6+ years and would
  have converted nobody.

### pricing — why $48, and why not $28

The instinct is to price against **Raindrop Pro ($28/yr)**, the category
incumbent. That's the one number to _not_ match, and the reasoning is
positioning before it's arithmetic.

**Raindrop is the wrong comp set.** The wedge audience (privacy / PKM /
research) has different anchors, and they all sit far above $28:

| product           | price   | what it buys                       |
| ----------------- | ------- | ---------------------------------- |
| Raindrop Pro      | $28/yr  | bookmarks, **not** private         |
| 1Password         | ~$36/yr | E2E vault                          |
| **Obsidian Sync** | ~$48/yr | **encrypted sync. That's all.**    |
| Proton Mail Plus  | ~$48/yr | private mail                       |
| Readwise Reader   | ~$90/yr | read-later + highlights (cloud AI) |

Obsidian charges ~$48/yr for E2E sync **alone** — no organization, no locks, no
capture surfaces — and the PKM tribe pays it without complaint. Bracemark at $48
gives that same tribe encrypted sync _plus_ nested structure, locks, a query
editor, a browser extension, and a mobile share sheet. In that table Bracemark is
the one doing the most work for the money, not the expensive option. (Verify
these against current pricing pages before committing — they move.)

**Matching $28 invites the comparison we lose.** Sitting at the incumbent's
price declares "Raindrop, but private," so the buyer runs a feature diff — and
at launch Plus is thinner than Raindrop Pro (read-mode, page copy, screenshot,
nested tags, table layout are all ▹ planned; see _launch sequencing_). $48
positions Bracemark beside Obsidian Sync instead, where the differentiator is the
axis of comparison rather than a missing row.

**The elasticity math says the downside is covered.** Going $28 → $48 cuts the
free base required for a given income by ~46% (see _break-even_). So **$48 wins
even if the higher price costs up to ~46% of conversions** — and realistic
prosumer elasticity in the $2–5/month band is a 10–25% hit, not 46%. Nobody
choosing an encrypted research vault is price-shopping $2 vs $4 a month; the
users who bounce at $4 are the ones who'd have churned in month three anyway.

**Why not $60, then?** Because $60 would promise what Plus doesn't contain yet.
The heavy-blob levers that justify a premium (read-mode, offline page copy,
screenshot) are exactly the unbuilt ones, and the rule below is _never promise in
the paywall what isn't built_. $48 clears that bar; $60 doesn't, **yet** —
revisit once the fast-follows land.

**Frame it monthly.** Nobody evaluates "$48.00/year"; they evaluate **"$4 a
month,"** which lands next to Obsidian Sync and reads cheap. The sticker shock
that makes $59.99 feel steep is a presentation problem, and the $4/mo framing
sidesteps it while capturing most of the revenue.

**Launch at $48 — don't launch low and raise later.** Raising prices on a live
base is a thing founders plan and then never do, and it would land precisely when
there are the most users to annoy. Launch here, use _early supporters keep this
price forever_ as the launch urgency, and route new signups to a higher price
once read-mode and page copy ship. The grandfathered cohort then has a standing
reason not to churn — which, per _the thing the table hides_, is worth more than
the price increase itself.

**Monthly is not on sale at launch.** The price row above is the CATALOG; the
storefront at launch is annual only (`AVAILABLE_CADENCES` in `iap/plans.ts`).
The economics below are half the reason — a monthly sub only out-earns annual if
it survives twelve months, which at 30–50% churn most won't — but the blocker is
mechanical: switching cadence is the same unbuilt subscription-update flow as
Plus→Pro (docs/iap.md, _open follow-ups_), so selling monthly first would ship a
one-way door, where a monthly customer who wants annual has no path but cancel,
wait out the period, and re-subscribe. Add it with that flow, not before.

**The trial goes on the annual plan only.** The monthly option exists to remove
the "$48 up front" objection, not to be the default: putting the trial solely on
annual funnels conversions into the plan that pays ~$48 at once instead of ~$6,
which matters a lot at this stage. It also keeps the fee model below honest — an
annual sub is **one** payment-processor charge a year, a monthly sub is twelve,
so monthly nets materially less per dollar billed.

**14 days, not 3 — because Bracemark's value is cumulative.** The 3-day trial is
calibrated for apps with an instant gotcha moment (photograph a plate, get the
calories), where the product proves itself in five seconds and a short clock
just accelerates cash. Bracemark is the opposite shape: a bookmark vault is worth
nothing on day one and something real once there's a library in it. A trial has
to span **at least one full weekly usage cycle** plus the browser-extension
install that unlocks thumbnails (see _the web-only gap_ under _related risks_) —
3 days expires before the habit that justifies paying has formed, and converts
on sunk cost rather than demonstrated value, which is churn deferred, not
revenue earned.

Note what the trial is _for_ here, though: **the free tier is the evaluation,
not the trial.** 200 links is a serious trial of Bracemark-the-product, so a Plus
trial started at signup demos features the user has no library to feel yet
(unlimited links when they have twelve; nested lists with nothing to nest). The
trial's real job is de-risking the upgrade at the moment the free tier binds,
where the question isn't "is Bracemark good" but "is _structure_ worth $48" — and
that question takes a couple of weekends of reorganizing to answer. 14 days
covers it; 3 doesn't.

**Trial length is not a refund strategy — and refunds aren't fully ours to
grant.** The tempting logic is that a 14-day trial "covers" the EU/UK statutory
14-day right of withdrawal, so nobody ever asks for their money back. It doesn't
stack that way: the withdrawal window runs from the **contract/charge date**, so
a trial that converts on day 14 starts a _fresh_ 14-day window on day 14. What a
longer trial actually buys is a lower refund _rate_ (people cancel instead of
charging back), which is worth real money — fees on a refunded sub aren't
returned, and chargebacks carry a penalty — but it is not legal cover.

More importantly, the premise that refunds are discretionary is wrong in the
markets that matter:

- **EU/UK** — distance-selling gives a **statutory 14-day withdrawal right**. For
  digital services it is waivable, but only if the customer expressly consents to
  immediate performance _and_ acknowledges losing the right; that consent flow is
  a checkout requirement, not an afterthought.
- **Paddle is the Merchant of Record**, so Paddle — not us — is the legal seller
  (this is the point of using them: they carry VAT/sales-tax and the withdrawal
  consent). Paddle can and does refund on its own policy, over the seller's
  objection, because it carries the chargeback liability.
- **App Store / Google Play** — refunds are handled entirely by Apple/Google and
  granted at their discretion. The developer has no veto and often no notice.

So the honest position is: a published, generous refund policy costs us almost
nothing we could have withheld anyway, and buys trust with exactly the
privacy/PKM audience that reads terms pages. Market it rather than defend
against it — **"cancel anytime, 30-day money back, full export on the way out"**
sits naturally beside the no-lock-in stance above. Confirm the current specifics
with Paddle's seller terms and the store policies before writing any of it into
customer-facing copy; the shapes above are stable, the numbers move.

### launch sequencing

The tiers table above is the **destination**, not day one — it's the plan, while
`AVAILABLE_PAID_PLANS` (in `iap/plans.ts`) and the upgrade-card copy are the
reality. What ships when:

- **Launch — Free + Plus only.** Plus rests on the keystone (unlimited links +
  `serverExtraction` + the heavy-blob upgrades), with **locks** as the wedge lever
  built first — it's what makes the privacy tribe adopt and evangelize. Pro is
  **not on sale**: `AVAILABLE_PAID_PLANS` is `['plus']`, so the checkout contract
  and the cards offer Plus alone. Pro stays fully specified as spec-in-waiting
  (its entitlements, price, and Paddle branch are all in place).
- **Plus fast-follow — read-mode, then screenshot / page copy.** Gated in the table
  already; each added as it's built. Card copy only ever promises what's live.
- **Held for feedback — nested tags + per-list link ordering** (marked ▹ in the
  table). Planned Plus levers, in this doc but not yet entitlement fields (see
  `iap/plans.ts` _DOC-AHEAD-OF-CODE_); gate them if/when demand shows.
- **Plus value-capture fast-follows — search editor + table layout.** Client-only,
  cost-free levers (a client gate, no quota to meter), shipped as each is built. Like
  every gate, the card copy only ever promises what's live.
- **Pro — after the app is stable.** Its spine (smart lists / saved searches) is
  deterministic, so it's buildable without waiting on AI — that independence is
  why Pro isn't hostage to model timing, _not_ a claim it's live now. AI
  (`aiTier`) stays parked and is Pro-only when it lands.

The rule this enforces: **never promise in the paywall what isn't built.** Tune
the table freely as the plan; the cards and `AVAILABLE_PAID_PLANS` gate what a
customer can actually see and buy.

### break-even

Headline: **infra break-even is trivial (~10 paying subs); the meaningful
break-even is replacing your income, which is an acquisition problem.**

Assumptions (all editable):

| input                       | value                  | note                              |
| --------------------------- | ---------------------- | --------------------------------- |
| Blended price               | 80% Plus / 20% Pro     | = $57.60/yr gross per paid sub    |
| Payment fees                | 2.9% + $0.30/yr        | annual billing = one charge/yr    |
| **Net revenue / paid sub**  | **~$55.6/yr**          | after Paddle                      |
| Infra / paid sub            | ~$2/yr                 | heavy blob user; most lighter     |
| Infra / free sub            | ~$0.05/yr              | metadata + preview imgs, sync ops |
| **Contribution / paid sub** | **~$53.6/yr**          | net rev − infra                   |
| Fixed baseline              | ~$500/yr               | Workers paid plan, domains, tools |
| Free→paid conversion        | 2% (cons.) – 4% (opt.) | typical prosumer freemium         |

The blend assumes annual billing throughout. A **monthly** sub at $5.99 grosses
~$71.88/yr but pays twelve processor charges (~$5.70/yr in fees vs ~$1.97), so
it nets ~$66/yr — still more than annual, but only if it survives twelve months,
which at 30–50% churn most won't. That asymmetry is the whole reason the trial
sits on the annual plan (see _pricing_).

`paid subs needed ≈ (annual target + $500 + free_base × $0.05) ÷ $53.6`

| Goal                                 | Annual target | Paid subs  | Free base @ 2% | Free base @ 4% |
| ------------------------------------ | ------------- | ---------- | -------------- | -------------- |
| **A. Cover infra only**              | ~$500         | **~10**    | ~500           | ~250           |
| **B. Ramen / part-time** ($12k)      | ~$13k         | **~250**   | ~12,250        | ~6,125         |
| **C. Modest salary** ($60k)          | ~$63.5k¹      | **~1,180** | ~59,000        | ~29,500        |
| **D. Comfortable solo SaaS** ($120k) | ~$126.5k¹     | **~2,360** | ~118,000       | ~59,000        |

¹ includes free-base infra drag: 118k free × $0.05 ≈ **$5.9k/yr** of pure
hosting cost for non-payers. Real at scale — at the salary level, free-user
hosting costs more than paid-user serving.

**Scenario D is the "$10K/month" line** ($120k/yr), and it's the clearest read on
what the repricing bought: at the old $24/$48 it needed ~4,900 subs on a
~245,000 free base; at $48/$96 it needs **~2,360 subs on ~118,000** — and at 4%
conversion, ~59,000. That's the difference between a number that requires a
quarter-million free users and one that doesn't.

How to read it:

- **Cost is never the wall.** Infra break-even is ~10 subs.
- **The wall is the free base.** A modest $60k salary needs ~1,180 paid subs ≈
  **~59,000 free users at 2% conversion.** Acquiring/retaining that in the
  bookmark-app graveyard is the whole game — point every lever (extension store
  presence, a sharp wedge audience, privacy-tribe word-of-mouth) at it.
- **Conversion is a 2× lever.** 2%→4% halves the free base required (59k→29.5k).
  Conversion rests on the load-bearing gates — the 200-link cap (scale), structure
  (nested lists/tags), locks, and the heavy-blob upgrades (read-mode / page copy) —
  **not** on crippling the daily view: free shows client-extracted thumbnails, so the
  free tier looks alive and forms the habit that retention depends on. The cap
  being client-enforced (above) doesn't change this arithmetic: it is defeatable
  by someone who goes looking, not by someone who just hits 200 links, and the
  latter is who the 2% is drawn from.
- **Pricing leverages the count, and it's the cheapest lever there is.** Every
  halving of price roughly **doubles** every "paid subs" number: a modest salary
  needs ~1,180 subs at $48/$96, ~2,560 at $24/$48, and ~5,000 at the original
  $10–12/yr. Same customers, a quarter of the mountain — and unlike conversion or
  churn, it's a config change, not a year of product work. This is the argument
  for $48/$96 (see _pricing_); it applies again at $60 once the fast-follows ship.

### the thing the table hides: churn

These are **steady-state** counts — the base you must _maintain_, not reach once.
Read-later/bookmark apps churn hard (often 30–50%/yr). At 40% annual churn and a
1,180-sub steady state you re-acquire ~470 paid subs **every year** to stand
still — ~23,500 new free signups/yr at 2%. Retention feeds straight back into the
model: **a 10-point churn improvement is worth more than a 10-point price
increase** — though note the corollary the repricing exposes: a 100% price
increase beat both, and cost a config change. Take the cheap lever first, then
go back to earning the expensive ones.

Realistic read: **Scenario B (part-time income, ~250 subs / ~6–12k free users)
is an achievable 18–24 month target** for a well-built privacy niche with
extension distribution. **Scenario C (full salary)** is the "real business"
threshold and depends almost entirely on holding conversion ≥3% and churn ≤30%.
**Scenario D ($10K/month)** stays a 3–5 year outcome on organic/extension
distribution — the repricing makes it reachable, not fast.

### the real lever: habit, not cost or marketing

Pulling the model together: **it's not cost, and it's not even "marketing" — it's
whether the product becomes a habit for a specific audience.** Cost is already
solved by the architecture (see _the cost structure_); nothing on the infra side
moves the business. What's left looks like "acquisition + churn," but those aren't
two problems — they're both downstream of one:

- **Churn is the root; acquisition is the symptom.** At 40% churn you re-acquire
  ~1,000 subs/yr just to stand still, turning acquisition into a treadmill. Fix
  retention and the acquisition target drops for the same income — a 10-point
  churn improvement beats a 10-point price increase.
- **Acquisition here is distribution, not ad spend.** Even at $48/yr paid
  marketing rarely pays back: at a $2.50 CPM, 100k influencer views buys maybe
  ~125 signups, which at 2–4% is ~$120–240 of year-one revenue against $250
  spent — and you learn the answer over twelve months, not the one-to-three days
  a viral-app playbook assumes. The repricing narrows that gap; it does not close
  it. This category grows through **browser-extension store search**
  (people search "save links chrome extension"), **word-of-mouth inside a tribe**,
  and **mentions in the right communities** (privacy / PKM / Obsidian / HN). The
  extension is a _growth channel_, not just a feature — product-led distribution.
- **Both have the same root: a sharp wedge audience.** A generic "private bookmark
  manager for everyone" churns because nobody's identity depends on it. A specific
  wedge — "the encrypted research vault for journalists / security folks / PKM
  diehards" — lowers churn (it's their daily tool) _and_ drives organic acquisition
  (the tribe evangelizes). Same product, completely different trajectory.

The thing that earns the habit — privacy + speed + a genuinely good local-first
experience — is exactly what's being built, and exactly what AI coding agents help
ship. The build advantage is real; **point it at a sharp audience, not "everyone."**

### related risks (tracked elsewhere / open)

- **The web-only gap is a conversion leak.** Free users _with_ the browser
  extension get client-extracted thumbnails for free, but a web-only user (no
  extension) gets bare URLs and no images — a steep first impression next to
  competitors' auto-thumbnails (see
  [link-extraction.md](./link-extraction.md) — _the web-only gap_). The remedy
  is the growth lever the model already leans on: onboarding must push the extension
  hard on day one (installing it _is_ what unlocks images), with opt-in
  `serverExtraction` as the no-extension fallback.
- **E2E is a moat and a cage.** It blocks server-side full-text search, good
  cloud AI today, and account recovery. Password-loss = unrecoverable data is the
  #1 support/trust issue — a clear recovery-key UX is part of the product (see
  [account.md](./account.md)).
- **On-device AI is a bet on the future tense.** Cloud-AI competitors win on
  summary quality now; sequence AI as a private "coming" promise, don't gate
  launch on it.
