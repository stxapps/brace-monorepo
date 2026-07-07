## business model

Working economics for brace.to as a **privacy-first** bookmark / read-later app:
tiering, infra cost, and break-even. Companion to the product/architecture docs —
see [link-extraction.md](./link-extraction.md) for why extraction (and its heavy
image/screenshot/archive blobs) is the main storage line item,
[local-first-sync.md](./local-first-sync.md) for the blind-broker data path that
keeps server cost low, [deployment.md](./deployment.md) for the Cloudflare
(R2/D1/Workers) infrastructure these numbers are priced against, and
[iap.md](./iap.md) for how the tiers below are implemented (Paddle
subscriptions, the entitlement fold, and which limit is enforced where).

All figures are **planning estimates**, not committed prices. Flex the assumptions.

### the cost structure is unusually favorable

Two architectural decisions make infra cost a non-issue, and they're the same
decisions that make brace private:

- **Cloudflare R2 has zero egress fees.** The instinctive "30k images downloaded
  over and over = transfer bill" fear is the AWS/S3 model. R2 doesn't charge
  egress, so the heavy preview-image blobs (see
  [link-extraction.md](./link-extraction.md) — _the preview image is a downloaded
  blob_) cost storage only, not transfer.
- **`brace-api` is a blind sync broker — clients do all extraction.** The server
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

So even a worst-case whale costs **~$1–2/yr** in infra against $24+/yr revenue —
an 85%+ gross margin. **Cost is never the wall; customer acquisition is.**

The one place cost _does_ leak in is the **`brace-extractor`** server path
(outbound fetch + compute, and anonymous/abuse-exposed). It's now a
**necessary** app to build — once the extension went active-context only it's the
only bulk-enrichment path for web/desktop users — but its _feature_ stays **opt-in
and off by default**, which is the right call on cost/abuse grounds too (see
[link-extraction.md](./link-extraction.md) — _server extraction_).

**The image proxy is part of this path — and deliberately the cheap shape.** A
web-app save can't fetch the og:image itself (CORS blocks JS from reading
cross-origin image bytes), so `brace-extractor` **streams** the preview image
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
already carry. Net: a rounding error on top of the already-opt-in `brace-extractor`
cost, not a new cost category — the storage tables below are unchanged.

### tiers

Design principle: the free tier limits the things that **cost money or weaken the
moat** (image/screenshot/archive blobs = the storage tail; AI = compute), never
the things that are nearly free and build the habit (metadata, sync, encryption).
Free users then cost cents, and the upgrade triggers are features people feel.

|                                       | **Free**                       | **Plus** — $24/yr          | **Pro** — $48/yr                  |
| ------------------------------------- | ------------------------------ | -------------------------- | --------------------------------- |
| Price                                 | $0                             | $24/yr ($3/mo)             | $48/yr ($5/mo) · lifetime $149    |
| Saved links                           | 200                            | Unlimited                  | Unlimited                         |
| E2E encryption                        | ✅                             | ✅                         | ✅                                |
| Sync across devices                   | ✅ (habit-builder — don't cap) | ✅                         | ✅                                |
| Extension (save + extract)            | ✅                             | ✅                         | ✅                                |
| Title + tags + lists/folders          | ✅                             | ✅                         | ✅                                |
| Preview images (downloaded blob)      | ❌ metadata-only (title/host)  | ✅                         | ✅                                |
| Read-mode (clean reader text)         | ❌                             | ✅                         | ✅                                |
| Screenshot capture                    | ❌                             | ✅                         | ✅                                |
| Full-page archive (offline snapshot)  | ❌                             | last 50 links              | Unlimited                         |
| Storage quota (blobs)                 | n/a (no blobs)                 | 5 GB                       | 20 GB                             |
| On-device AI (auto-tag, summary)      | ❌                             | basic (auto-tag, keywords) | full (summaries, semantic search) |
| Server extraction (`brace-extractor`) | ❌                             | opt-in                     | opt-in                            |
| Support                               | community/docs                 | email                      | priority email                    |

Why these cuts:

- **The image-blob paywall is the keystone.** Free users store only metadata
  (~2 KB/link); a 200-link free user is ~400 KB total, so a million free users
  cost pocket change. The free experience is still useful (encrypted sync + save +
  tags + extension) — it just looks like a text list. That visual gap _is_ the
  upsell.
- **Read-mode / screenshot / archive** are the other heavy blobs, gated for the
  same cost reason. Archive is metered (50 → unlimited) because full-page snapshots
  are the single biggest storage line item; the Plus→Pro jump is "permanent offline
  library."
- **200 free links** is enough to evaluate seriously but past "free forever."
  Tune 100–300 after real usage.
- **Don't cap sync/devices on free** — nearly free for us, and the only thing that
  builds a daily habit. Crippling it just guarantees churn before any paywall.
- **AI splits the two paid tiers**, not free-vs-paid — a clean second upgrade lever
  once on-device models are good enough, without betting launch on AI.
- **Free needs no quota meter:** the _absence of blob features_ is the quota.
- **Lifetime ($149)** front-loads cash and suits the privacy/PKM crowd, but is a
  long-tail liability under E2E — offer as a launch lever, then retire.

### break-even

Headline: **infra break-even is trivial (~20 paying subs); the meaningful
break-even is replacing your income, which is an acquisition problem.**

Assumptions (all editable):

| input                       | value                  | note                              |
| --------------------------- | ---------------------- | --------------------------------- |
| Blended price               | 80% Plus / 20% Pro     | = $28.80/yr gross per paid sub    |
| Payment fees                | 2.9% + $0.30/yr        | annual billing = one charge/yr    |
| **Net revenue / paid sub**  | **~$27.7/yr**          | after Stripe                      |
| Infra / paid sub            | ~$2/yr                 | heavy blob user; most lighter     |
| Infra / free sub            | ~$0.05/yr              | metadata-only, mostly sync ops    |
| **Contribution / paid sub** | **~$25.7/yr**          | net rev − infra                   |
| Fixed baseline              | ~$500/yr               | Workers paid plan, domains, tools |
| Free→paid conversion        | 2% (cons.) – 4% (opt.) | typical prosumer freemium         |

`paid subs needed ≈ (annual target + $500 + free_base × $0.05) ÷ $25.7`

| Goal                                 | Annual target | Paid subs  | Free base @ 2% | Free base @ 4% |
| ------------------------------------ | ------------- | ---------- | -------------- | -------------- |
| **A. Cover infra only**              | ~$500         | **~20**    | ~1,000         | ~500           |
| **B. Ramen / part-time** ($12k)      | ~$12.5k       | **~490**   | ~24,500        | ~12,250        |
| **C. Modest salary** ($60k)          | ~$66k¹        | **~2,560** | ~128,000       | ~64,000        |
| **D. Comfortable solo SaaS** ($120k) | ~$126k¹       | **~4,900** | ~245,000       | ~122,500       |

¹ includes free-base infra drag: 128k free × $0.05 ≈ **$6.4k/yr** of pure
hosting cost for non-payers. Real at scale — at the salary level, free-user
hosting costs more than paid-user serving.

How to read it:

- **Cost is never the wall.** Infra break-even is ~20 subs.
- **The wall is the free base.** A modest $60k salary needs ~2,560 paid subs ≈
  **~128,000 free users at 2% conversion.** Acquiring/retaining that in the
  bookmark-app graveyard is the whole game — point every lever (extension store
  presence, a sharp wedge audience, privacy-tribe word-of-mouth) at it.
- **Conversion is a 2× lever.** 2%→4% halves the free base required (128k→64k).
  This is why the free tier is deliberately a little bare (metadata-only, no
  thumbnail) — the visual + read-mode gap drives conversion.
- **Pricing leverages the count.** At the original $10–12/yr every "paid subs"
  number roughly **doubles** (~5,000 for a modest salary vs ~2,560). That's the
  concrete argument for $24/$48 — same customers, half the mountain.

### the thing the table hides: churn

These are **steady-state** counts — the base you must _maintain_, not reach once.
Read-later/bookmark apps churn hard (often 30–50%/yr). At 40% annual churn and a
2,560-sub steady state you re-acquire ~1,000 paid subs **every year** to stand
still — ~50,000 new free signups/yr at 2%. Retention feeds straight back into the
model: **a 10-point churn improvement is worth more than a 10-point price
increase.**

Realistic read: **Scenario B (part-time income, ~490 subs / ~12–25k free users)
is an achievable 18–24 month target** for a well-built privacy niche with
extension distribution. **Scenario C (full salary)** is the "real business"
threshold and depends almost entirely on holding conversion ≥3% and churn ≤30%.

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
- **Acquisition here is distribution, not ad spend.** At $24/yr paid marketing
  rarely pays back. This category grows through **browser-extension store search**
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

- **The web-only gap is a conversion leak.** A free web-only user (no extension)
  gets bare URLs _and_ no images — a steep first impression next to competitors'
  auto-thumbnails (see [link-extraction.md](./link-extraction.md) — _the web-only
  gap_). Onboarding must push the extension hard on day one.
- **E2E is a moat and a cage.** It blocks server-side full-text search, good
  cloud AI today, and account recovery. Password-loss = unrecoverable data is the
  #1 support/trust issue — a clear recovery-key UX is part of the product (see
  [account.md](./account.md)).
- **On-device AI is a bet on the future tense.** Cloud-AI competitors win on
  summary quality now; sequence AI as a private "coming" promise, don't gate
  launch on it.
