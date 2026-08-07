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

**`/docs` and `/blog` are deferred past launch, and their routes are gone.** The
path-not-subdomain decision above stands — it is what the URLs will be — but both
routes existed only as placeholders awaiting a content-pipeline decision (MDX vs.
a `[slug]` route), and a placeholder that prerenders to the apex is a "TODO" page
Google can index. They were deleted rather than noindexed, so re-adding them is a
deliberate act taken together with the pipeline choice; the reasoning that was in
their `page.tsx` headers is in git. The nav that pointed at them
(`HEADER_LINKS`/`FOOTER_LINKS` in `apps/bracemark-site/src/lib/site.ts`) lost the
entries at the same time.

**What the apex actually ships at launch:** `/`, `/about`, `/pricing`, `/faq`,
`/support`, `/terms`, `/privacy`. The last two are store-submission blockers and
now carry real content — they name `COMPANY` from `lib/site.ts`, whose postal
address is carried over from the Brace.to policies and still wants verifying.

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

### the mark

**`01-baseline` ships — a solid geometric B with its top-right corner cut away at
45°, the way a page corner is turned down to keep a place.** The shape, the
one-path/`currentColor` invariant, and the 38×44 grid it is constructed on are
documented at the top of
`packages/web-ui/src/components/icons/bracemark-icon.tsx`; that comment is the
source of truth for _what the shape is doing_ and is not repeated here. This
section owns the **decision** and the **inventory**.

An exploration in `docs/logo-drafts/` (not wired into any build — see its
README) tested the alternatives and produced two serious challengers. Both were
rejected, for opposite reasons, and the pair is the useful record:

- **`06-waist-deepened`** — `01` with the waist cut from 74.5% of glyph width to
  64%, which is the one measurement where `01` falls outside Bricolage
  Grotesque's 65–67% range. It is genuinely better at 16px. It is **not
  beautiful at large sizes**: the deeper waist buys small-size clarity at the
  cost of the letterform.
- **`draft4`** — a different concept, a rounded rectangle whose right edge is
  replaced by the two bowls of a B. Handsome at 128px and up, and it has the
  widest counters of anything tested (55.5%/63.1% against `01`'s 46.0%/57.9%).
  But its waist goes the **wrong** way — 84.8%, the shallowest in the whole
  exploration — and the shape falls apart at icon sizes.

`01` wins because it is the only one that is acceptable at **both** ends, which
is the property that actually matters: the same path is rendered at 16px in a
browser tab and at 1024px in an App Store listing. Neither challenger was a
refinement of `01` that could simply be merged — each traded one end for the
other. `docs/logo-drafts/compare-07.html` is the size ladder the decision was
made from; `compare-06.html` carries the Bricolage measurements.

**Where the mark lives — two source components and 30 raster assets.**

| where                                                                                                                                                                  | what                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web-ui/src/components/icons/bracemark-icon.tsx`                                                                                                              | the source of truth                                                                                                                                       |
| `apps/bracemark-expo/src/components/icons/bracemark-icon.tsx`                                                                                                          | the RN port — **byte-identical path and viewBox**, colour from `useCSSVariable` because `react-native-svg` takes fill as a prop and has no `currentColor` |
| `bracemark-web/public/` (10), `bracemark-web/src/app/` (4), `bracemark-site/src/app/` (4), `bracemark-expo/assets/images/` (8), `bracemark-extension/public/icon/` (4) | 30 PNG/ICO files rendered from that path                                                                                                                  |

The two components must not drift. Nothing enforces it — no test compares the
two `d` strings — so a retouch of the mark is a **two-file** change plus a
re-render of every raster.

**The lockup — mark beside wordmark — is one set of measurements rendered on
seven surfaces**: a 20px mark (`h-5`), the wordmark at `text-[0.9375rem]
leading-none font-semibold tracking-tight`, `gap-2.5` between them. It is the
brand's only appearance on any surface that has no other carrier, so the surfaces
have to agree: bracemark-web's links rail, its settings rail and its auth card;
the browser extension's `OptionsShell`; and bracemark-expo's two drawers, its
auth screen, and **its share sheet** — which is the purest case of the rule,
since that one floats over somebody else's app and has nothing but the lockup to
say whose sheet it is. Web types the six utilities into each file with a comment
naming the others. **Expo does not, and must not** — the mark's height is a
`height` PROP there (`react-native-svg` sizes by prop, not by class), so a
hand-typed copy drifts by a pixel the first time one is edited; all four native
call sites go through `apps/bracemark-expo/src/components/brand-lockup.tsx`,
which also takes the wordmark from `BRAND.name` rather than the literal.

**The 45° fold is also a UI device, and it carries exactly two MEANINGS.** No
use renders the mark — each cuts the same corner off a rectangle, at a size set
against the object rather than against the mark's 29% ratio, which only reads as
a silhouette on ~40px objects.

| where                                                                       | cut     | what it means                                                                                                               |
| --------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| the browser extension's page tile (`corner-cut`/`corner-square`)            | 0.75rem | **state** — square is unsaved, cut is saved; the whole signal, no badge (`browser-extension.md`)                            |
| bracemark-expo's share-sheet specimen (`features/share/share-specimen.tsx`) | 12px    | **state**, the same one — the native port of the row above, on the same 44px tile (see below)                               |
| bracemark-web's auth card (`(auth)/layout.tsx`)                             | 1.5rem  | **identity** — the signed-out routes have no rail to carry the brand, so the card itself is the Bracemark surface           |
| bracemark-expo's auth card (`components/dog-eared-card.tsx`)                | 24px    | **identity**, the same one — the native port of the row above, not a third meaning; the case is _stronger_ here (see below) |

Count meanings, not surfaces — the table is **four rows and two meanings**, and
each meaning is one idea rendered on two platforms. The expo card is the web card
on another platform: same two screens, same job, same 1.5rem/24px cut, and a
native app has no tab title to fall back on, so it is even more true there that
these screens are the only place the app never says its own name. The share
sheet's specimen is the browser extension's page tile on another platform, and
the pairing is just as tight: the same question ("this page — saved or not?"),
the same 44px tile, the same 12px cut, both drawn as the thing the library will
draw for that link. **A THIRD MEANING is what is still forbidden** — a fold that
means "saved" somewhere and nothing in particular elsewhere teaches users it
means nothing.

The two platforms draw it differently, and on RN the technique is chosen by
SCALE rather than by taste:

- **Web** clips, and the clip takes the ring and the box shadow with it — so the
  card draws its hairline as a 1px filled layer underneath and its shadow as a
  `drop-shadow` filter. Copy that pattern for any clipped surface big enough to
  have a border.
- **RN has no `clip-path` at all**, so it has two techniques, and the dividing
  line is whether the shape carries a hairline:
  - **At CARD scale, a stroked path.** The obvious native trick — a rotated
    square in the page colour laid over the corner — cannot carry a hairline,
    which would leave the diagonal as the one edge with no border, and the
    diagonal is the whole device. So the expo auth card's outline is **one
    filled-and-stroked `react-native-svg` path** sized from the content's
    measured box: three rounded corners and a straight chamfer where the fourth
    would be. It also ships **no shadow**, deliberately — RN would cast the
    CONTENT BOX's rectangular shadow, putting a rectangular halo around a folded
    corner and turning a turned page into a chipped one.
  - **At TILE scale, the overlay is correct** — and it is not an approximation.
    Web's own 44px tile loses its ring along the diagonal too, because
    `clip-path` erases the ring with everything else, so a rotated square in the
    page colour reproduces the web result exactly. That is what the share sheet's
    specimen uses, and it keeps `react-native-svg` off a path whose init cost is
    paid on every cold share.

**The raster conventions, which are a rule and not a per-file judgement:**

- **Favicons and toolbar icons** (`logo16/32/48/64`, the extension's
  `icon/16|32|48|128`, `icon1`/`icon2`, expo `favicon.png`) — transparent
  background, mark in `#0a0a0a`, **ink height = 7N/8 of an N×N canvas**,
  centred, natural 38:44 aspect.
- **App and PWA tiles** (`logo192/512`, `*-maskable`, `apple-touch-icon`,
  `apple-icon`, expo `icon.png`/`ios-light.png`) — opaque **white** tile, mark
  `#0a0a0a`, ink height 50–55%.
- **The expo dark and tinted variants** (`ios-dark.png`, `ios-tinted.png`) —
  transparent, near-white mark, 55%; iOS composites them over its own backdrop.
- **The two `favicon.ico`** (`bracemark-web`, `bracemark-site`) — three frames
  each, 16/32/48, following the favicon rule above.

There is **no committed generator** for any of this — the PNGs were produced ad
hoc, so the rule above is the only thing that makes them reproducible. Two
consequences worth knowing before you re-render: the geometry reproduces exactly
from the rule, but the **antialiasing does not** (a fresh render off the same
path differs from the committed file by up to ~26% alpha on edge pixels alone,
because a different rasteriser drew it), and a re-render is therefore never a
byte-clean diff.

**Maskable padding is a measured number: 64.2%.** The mark fits Android's 80%
safe circle at that ink height and no larger. This is a property of the 0.863
aspect plus the corner radii, so it is identical for `01`, `06` and `draft4` —
changing the mark would not have bought slack here. The `-maskable` files ship at
50%, comfortably inside it; the non-maskable tiles at 55% are **not** maskable
and must not be substituted.

**Known gap: the browser extension's toolbar icons have no dark-theme variant.**
`#0a0a0a` on Chrome's dark toolbar is close to invisible. MV3 has no
manifest-level light/dark icon switch (Firefox's `theme_icons` is Firefox-only),
and the service worker has no `matchMedia` to drive `action.setIcon` from, so
this is a real fix rather than a config line. It predates the mark decision — the
icons were the legacy four-dot artwork until they were regenerated onto `01` —
and it is not tracked anywhere else.

### the brand lines, and the store listings

The name settles what the product is _called_. This settles what it _says_ — one
question down from the name, and the place the name's weakness gets compensated
for, since "Bracemark" alone does not tell anyone what it does.

**Three lines, three jobs, never substituted for each other.** They live in
`packages/shared/src/stores/listing-copy.ts`, next to the listing URLs, because
five consoles and three apps have to agree and nothing else enforces that.

| line           | text                                                   | for                                           |
| -------------- | ------------------------------------------------------ | --------------------------------------------- |
| **descriptor** | End-to-end encrypted bookmark manager                  | directories, categories, anywhere with no wit |
| **tagline**    | The bookmark manager that can't read your bookmarks    | hero, OG title, X bio, press                  |
| **slogan**     | We don't promise not to look. We built it so we can't. | sign-offs, ads, the inverted band             |

The tagline is the asset. It names the category and the mechanism in one clause
and states the mechanism as an **inability rather than an intention**, which is
the entire positioning — and it is one no competitor holding plaintext can copy.
Its one weakness is that "can't read" can momentarily parse as _broken_ rather
than _blind_, which is why it is safest where supporting copy resolves it
immediately and why the ~30-character store fields get a fourth line instead:
**"Bookmarks only you can read"**, the same claim inverted to a positive.

**Adjectives are the failure mode here, not a missing feature.** "Privacy-focused",
"private & secure" and the rest are claims about intent, in a product whose whole
argument is that intent is worthless — putting them next to "we don't promise not
to look" contradicts it out loud. Prose says the mechanism ("a path, a size, and
bytes we hold no key for"). The adjectives go in Apple's **keyword field**, which
is invisible, indexed, and where the people searching them actually are.

**The two stores index different fields, so the copy is shaped differently.**
Apple indexes name + subtitle + the keyword field and **not** the description;
Google indexes title + short description + full description and has **no** keyword
field. Hence one long description written to carry its search terms in ordinary
prose, plus a bare comma-list that only Apple ever reads. Every field's character
budget is data in `listing-copy.ts` and asserted in its spec — these are silent
constraints that otherwise surface as a rejected field on submission day.

**The listing name is not the app name.** App Store Connect's listing name is
`Bracemark: Private Bookmarks` — the bare word would spend 21 of 30 indexed
characters on a brand nobody searches yet, against the SEO drag noted above. The
home-screen label in `apps/bracemark-expo/app.config.ts` stays **`Bracemark`**. A
home screen has no search to be found by and no room, so wiring the two together
looks like removing a duplicate and puts the descriptor under the icon on every
device. Same trap on the Play side.

The **browser extension** is the exception that is genuinely wired: both stores
build that listing's title and summary out of `manifest.json`, so `wxt.config.ts`
imports them. It had to be — those two strings carried Brace.to v1's
decentralised-identity pitch ("technology that empowers you to truly own your
account and data") straight through the rename, because nothing pointed at that
file.

### open decisions

- Attorney review of the two senior `BRACE` marks (see _trademark knockout_) —
  the knockout search itself is done and clean; the EUTM goods specification
  still needs to be pulled and read.
- The store listing URLs in `packages/shared/src/stores/listings.ts` are still
  `TODO_` placeholders: the values they replaced addressed the legacy listings,
  and the real ones don't exist until v2 is submitted. They block store
  submission and the marketing site's download links, not the domain work. The
  listing _copy_ beside them (`listing-copy.ts`) is written and unblocked — it is
  paste-ready for the consoles, and only the browser extension's share of it is
  wired into a build.
- **The extension's toolbar icons are invisible on a dark browser theme** (see
  _the mark_). Needs an `action.setIcon` path driven from an extension page or a
  content script, since the MV3 service worker cannot read the colour scheme.
- **No X handle yet.** `@bracedotto` is the legacy one, and `twitter:site` in the
  marketing site's root layout is deliberately unset until a Bracemark handle
  exists — a wrong handle credits someone else's account on every share. The bio
  to put on it is the tagline plus the slogan; registering the handle and setting
  that one field are the same task.
