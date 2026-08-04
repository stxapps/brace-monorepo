## brand — the name, the domains, the trademark

A decision record, not a design doc. It owns **what this app is called**: the
name Bracemark, the domain estate behind it, the trademark position, and the
record of the rename that has already landed in this repo.

Its sibling, [legacy-brace-to.md](./legacy-brace-to.md), owns the other half of
the v1 transition: how the ~100 paying users of the legacy Stacks-based Brace.to
get their data into this repo's app. The two are constantly confused for each
other and are in fact **independent** — renaming does not remove one line of
migration work; migrating does not require a rename. That is why they are two
files.

Companions: [deployment.md](./deployment.md) for the domain topology the rename
has to move, [legacy-brace-to.md](./legacy-brace-to.md) for the phasing that
decides _when_ the domain cutover lands.

### the decision

**The app is named Bracemark. App name and domain match** — the store listings,
the marketing copy, the docs site, and the extension listings all say
_Bracemark_, not _Brace_. A split (product called "Brace", domain
`bracemark.com`) is explicitly rejected: anyone who hears "Brace" types
`brace.com`, which belongs to someone else, and that leak is unfixable at any
price.

Two rejected alternatives, with the reasoning, so this isn't relitigated:

- **Keep `brace.to` as-is.** The _word_ "Brace" was never the problem — the
  category is full of semantically empty names (Raindrop, Pinboard, Instapaper)
  and they do fine. The `.to` was the problem, for three reasons that compound:
  domain hacks read as 2013 and date the product; unusual TLDs carry spam-filter
  friction, which matters precisely because a **migration email to 100 paying
  users** is on the critical path and deliverability decides whether the
  migration happens at all; and "brace dot to" does not survive being said out
  loud.
- **A wholly new, unrelated name.** Checked against the registry rather than
  guessed: every short, good, one-word candidate has its `.com` **and** `.app`
  already gone (`trove.app`, `dogear.app`, `tuck.app`, `brace.app`, `brace.com` —
  all registered). A fresh name would have landed on a second-tier TLD anyway, so
  it **relocates** the TLD complaint instead of solving it, while additionally
  discarding the one word the existing users recognise. "Bracemark" keeps "Brace"
  inside it, so recognition partially carries — a soft rename, not a cold start.

Known weakness, accepted: the `brace-*` trademark space is dense with orthopedic
and orthodontic marks (BraceAlign, BraceLayer, M-Brace, Brace Direct), all in
medical devices rather than software. So "Bracemark" reads faintly like an
orthodontic bracket on first encounter and inherits some of the SEO drag "Brace"
already carried. This is not made worse by the rename, but it is not fixed by it
either. A registry-wide knockout search has since been run and the name survives
it — see _trademark knockout_ below. What remains is attorney review of two
specific senior marks, not an open-ended clearance question.

### domains

**`bracemark.com` is registered** — bought at Namecheap on **2026-08-04**, with
DNS delegated to Cloudflare ([deployment.md](./deployment.md#dns)). The two
defensive names below are still unbought; they were verified unregistered
against Verisign's authoritative `.com` RDAP endpoint (HTTP 404 = unregistered)
on **2026-08-03**, and that check goes stale — re-verify before purchase.

| domain             | role          | why                                                                                                                                                                    |
| ------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **bracemark.com**  | primary       | name and domain match; carries "bookmark" inside it, so it explains the product without a tagline                                                                      |
| **braceto.com**    | 301 → primary | **the high-value defensive buy.** Same character string as `brace.to`, so every existing user, stale directory listing, and half-remembered mention resolves correctly |
| **bracemarks.com** | 301 → primary | typo defence; only earns its keep once the brand has recognition worth mistyping                                                                                       |

Registration priority is `bracemark.com` → `braceto.com` → `bracemarks.com`. The
ordering matters and is easy to get backwards: **`braceto.com` defends a brand
people already know; `bracemarks.com` defends a typo of a brand nobody knows
yet.** All three at standard registration price, no broker or aftermarket.

`brace.to` itself is **retained**, not dropped — it is the single highest-value
redirect source and the legacy web app still serves from it during the
transition (see _phasing_ in
[legacy-brace-to.md](./legacy-brace-to.md#phasing--keep-legacy-work-off-the-launch-critical-path)).

**The apex is a real property, not a redirect to the app.** `bracemark.com`
serves the marketing site (`apps/bracemark-site`) while the app keeps
`app.bracemark.com`. Docs and blog are **paths** on the apex (`/docs`, `/blog`),
not subdomains, and `www` 301s to it — so a single hostname accrues the
authority, which is the point of consolidating onto one name at all. What the
site is and what it may depend on is
[architecture.md](./architecture.md#apps), _apps_; its origins, buckets, and
hosts are [deployment.md](./deployment.md#custom-domains).

### trademark knockout — run 2026-08-03

A knockout search via TMview (aggregates USPTO, EUIPO, WIPO, UK IPO and ~70
national registers). **The name survives it.** This is still not legal clearance
— that is an attorney's likelihood-of-confusion opinion — but the step that
kills most candidate names is passed.

- **Exact and near-exact: clean.** `BRACEMARK`, `BRACEMARKS`, `BRACEMARC` —
  zero hits in any register, any class. "BRACE MARK" matches only an expired
  cosmetics mark (MARK CROSS EMBRACE, dead 2012). No common-law use found
  either: no product or company named "Bracemark" anywhere on the web; the
  nearest neighbour is the unrelated logo app "BrandMark".
- **The `brace` field in software classes** (Nice 9/42; 475 raw hits surveyed
  across US/EM/WO/GB, filtered to live registrations) reduces to two marks that
  matter:

1. **BRACE — US reg. 6456171** (Brace Software, Inc., class 42, live). The mark
   a USPTO examiner could cite under §2(d). Its identification is narrow: SaaS
   for **mortgage servicing** (loan workouts, loss mitigation). Distant
   services, different channels, and BRACEMARK differs in sound, length, and
   impression — a citation is possible but defensible. Draft the BRACEMARK
   identification tightly ("downloadable software and SaaS for bookmarking and
   organising web links …") to maximise the distance.
2. **BRACE — EUTM 019047711 + WO 1813319** (Hantverksdata Holding II AB,
   classes 9/35/36/38/42, registered late 2024). The real flag. Hantverksdata
   is a Swedish construction-trades ERP maker in the EQT-backed Aceve group —
   a broad, fresh filing with a well-funded owner. Its goods specification was
   not retrievable programmatically (EUIPO record endpoints need a browser
   session); pulling and reading it is the **attorney task**. Practical
   consequence: an EUTM _application_ carries real opposition risk, while
   merely _using_ the name in the EU is far lower-risk than registering it.

Dismissed after review: BRACER (QinetiQ, GB 9/42 — defence comms), `braced`
(GB, fashion-adjacent multi-class), BRACES (US 42 — dental), the EMBRACE family
(a different word with a different commercial impression), and the orthopedic
cluster already noted above (classes 10/44 — legally irrelevant to software).

**Sequencing:** file US first, classes 9 + 42, narrow identification; defer any
EUTM until the attorney has read the Hantverksdata specification. The attorney
review belongs **before store submission** — the bundle ID and listings lock
the name in (see _the rename in this repo_ below) — not after. The
domain purchases are cheap and safe regardless and need not wait on it.

### the rename in this repo — done

Landed in one change, with a follow-up pass for the crypto constants. What
moved: the **domain topology** (every host in
[deployment.md](./deployment.md) and in the apps, so `brace.to` no longer
appears in any source file); **Nx project and directory names**
(`apps/brace-*` → `apps/bracemark-*`, `@stxapps/brace-*` →
`@stxapps/bracemark-*` — purely internal, no user, store, or DNS record ever saw
them, done in the same pass only to avoid a second disruptive sweep later);
**bundle identifiers** (`to.brace.app` → `com.bracemark.app`, dragging the iOS
app group and the `packages/expo-crypto` keychain service with them); the
**native module and pod names**, down to the Kotlin package path; **user-visible
strings**; **all of `docs/`**; and the **frozen crypto constants** in
`packages/shared/src/crypto/params.ts`, with everything they derive in
`crypto/contract-vectors.ts` regenerated through the real web-crypto pipeline.
The file-level inventory is in git; what the rename still _constrains_ is below.

**The expo `scheme` was the sharp edge**, more than the bundle ID. It was
`bracedotto` — the scheme legacy v1 registers — so with both apps installed on
one device, both claimed it. It moved with the identifier, as did the expo
`name` and `slug`.

**The crypto constants were renamed on a greenfield argument, and that window is
closing.** `params.ts` says never edit these; the rule protects _existing users'
keys_, and there are none yet, so the only cost was recomputing what they derive.
Once real accounts exist they are frozen for good, and rotating one means minting
a `.v2.` constant rather than editing this one — see
[account.md](./account.md#the-derivation-pipeline).

**What the bundle-ID change costs.** Because the identifier changes, v2 gets
brand-new listings on every store no matter what the app is called — so **no
ratings, reviews, or store ranking carry over**. This is a consequence of the
rename, not of the legacy wind-down, and it is not avoidable by naming choices.
What does carry over is the developer accounts and the ability to cross-promote
from the v1 listings; that is the real inherited asset. The listing mechanics on
the legacy side are in
[legacy-brace-to.md](./legacy-brace-to.md#stores-and-extensions--what-actually-needs-a-build).

Everything still outstanding is external to the repo and tracked where it gets
done: the two defensive domains under _domains_ above, DNS and certs for the new
hosts in [deployment.md](./deployment.md#status--setup-checklist), and the store
listing URLs under _open decisions_ below.

### open decisions

- Attorney review of the two senior `BRACE` marks (see _trademark knockout_) —
  the knockout search itself is done and clean; the EUTM goods specification
  still needs to be pulled and read.
- The store listing URLs in `packages/shared/src/stores/listings.ts` are still
  `TODO_` placeholders: the values they replaced addressed the legacy listings,
  and the real ones don't exist until v2 is submitted. They block store
  submission and the marketing site's download links, not the domain work.
