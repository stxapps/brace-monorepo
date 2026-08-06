# logo drafts

Scratch exploration for the Bracemark mark. **Nothing here is wired into the
build** — the shipping mark is the path in
`packages/web-ui/src/components/icons/bracemark-icon.tsx`, ported by
`apps/bracemark-expo/src/components/icons/bracemark-icon.tsx` and rendered out
to the icon PNGs.

> ## settled: `01-baseline` ships
>
> The exploration is **closed**. `01-baseline` — the mark that was already
> shipping — wins, because it is the only candidate acceptable at both ends of
> the size range. The two challengers each traded one end for the other:
> **`06-waist-deepened`** is better at 16px but its letterform is not beautiful
> large; **`draft4`** is handsome at 128px and up but falls apart small. Neither
> was a refinement that could be merged into `01`.
>
> The decision and the asset inventory now live in
> [`docs/brand.md`](../brand.md), _the mark_ — that is the doc to read and
> to update. Everything below is kept as the **working record**: the
> measurements, the dead ends, and why each one died. Read it before reopening
> any of these questions; do not treat its recommendations as live.

Five comparison pages (see _rebuilding_ below — `compare-06.html` is hand-written,
the other four are generated):

- **`compare-07.html`** — `draft4` at every size and on every surface. The page the
  decision above was made from.
- **`compare-06.html`** — the letterform against Bricolage Grotesque.
- **`compare-05.html`** — the curl and the ribbon colour.
- **`compare-04.html`** — the ribbon studies.
- **`compare.html`** — the earlier round: dog-ear vs ribbon vs brace.

## draft4 (`compare-07.html`)

`draft4.svg` is a new drawing, not a variant of anything above: a rounded
rectangle whose **right edge has been replaced by the two bowls of a B**, with
the 45° dog-ear kept. Same 0.863 aspect as the shipping mark, on a 442×512 box.

Measured the same way as everything else in this file (rasterise to 1024 tall,
outer width per scanline, minimum between the counters):

|                     | w/h   | stem  | waist     | upper bowl | lower bowl | upper counter | lower counter | ink   |
| ------------------- | ----- | ----- | --------- | ---------- | ---------- | ------------- | ------------- | ----- |
| Bricolage 600       | 0.830 | 22.4% | 66.2%     | 94.5%      | —          | —             | —             | 62.7% |
| `01` shipping       | 0.863 | 23.6% | 74.5%     | 86.9%      | 97.4%      | 46.0%         | 57.9%         | 58.6% |
| `06` waist deepened | 0.863 | 23.6% | 64.0%     | 86.9%      | 97.3%      | 48.8%         | 57.9%         | 56.0% |
| `draft4`            | 0.863 | 21.7% | **84.8%** | 93.7%      | 100.0%     | **55.5%**     | **63.1%**     | 57.1% |

Two findings pull opposite ways.

**It is the best small-size performer here.** Its counters are 55.5% / 63.1% of
glyph width against `01`'s 46.0% / 57.9%, and counters are what decides 16px —
the same conclusion the `04*` studies reached. On the 1:1 strip in
`compare-07.html` §1, draft4 at 16px is the only one of the three whose upper
counter is unambiguously open.

**Its waist is the shallowest in the whole exploration — 84.8%.** `01` was
already flagged at 74.5% for welding the bowls into one mass down the right
side; `06` was cut specifically to bring that to 64%. draft4 moves it ten points
the other way. As a _letterform_ that is a straight regression on the one number
last round settled. As a _page whose right edge happens to be two bowls_ — which
is what the straight left edge, the two 46.5-unit corner radii and the straight
bottom actually draw — a shallow waist is the point, because a deep notch stops
the silhouette reading as a card. draft4 should be judged as the second thing,
not scored as a worse version of the first.

### the top-right corner

The upper counter is not a closed bowl. Its right boundary runs out to a curved
point at `(341.5, 152.8)` and back to `(257, 68)`, leaving about **48 units** of
ink between that tip and the 45° cut, where every other bar in the mark is 68 and
the stem is 96.

The obvious accusation — that this turns to grey mush when downscaled — **does
not survive measurement.** Counting pixels that land neither as ink nor as
background in the mark's top-right quadrant, at 16/20/24/32/48px draft4 runs
21/18/23/13/9% against `01`'s 17/20/21/14/11%. All three marks put a 45° diagonal
through that corner, so they all antialias about the same. The pinch is thin, not
blurry.

The real objection is shape. The counter's boundary is _convex_ into the corner,
so the leftover wedge reads as a crescent or a pennant rather than as a folded
triangle — and it comes to a point at the top instead of meeting the cut
squarely. It reads as deliberate ornament at 48px and up and it is gone below
24px, which is where `08` also landed: the fold is a 512px feature either way.

### what has to change before it can ship

- **The fill is hardcoded `#101828`** — the same failure `04-draft2.svg` had, and
  the reason the _file hygiene_ note below exists. The mark has to be
  `currentColor` to compose on any surface; see the comment atop
  `bracemark-icon.tsx`.
- **The geometry is a tool export, not a construction** — `46.5098`,
  `0.000270318`, `465.454`. 442×512 is 11.6364× the 38×44 grid, so nothing lands
  on a round number, and `bracemark-expo`'s port copies these numbers by hand.
- **The middle bar is heavier than the horizontals** — 80 units between the
  counters against 68 for the top and bottom bars.
- **The ink bbox is exactly the viewBox**, lower bowl touching x=442. Fine for a
  source file; it just means padding is entirely the caller's job.

### what it does not change

The maskable number. Measuring the circumradius about the tile centre, `draft4`,
`01` and `06` all fit the Android 80% safe circle at a mark height of **64.2%** of
the tile — identical, because they share the 0.863 aspect and proportionally
identical corner radii (46.5/512 against 4/44). That confirms the _maskable icons_
note below rather than moving it.

## the letterform (`06`, `07`)

**The shipping mark is not derived from Bricolage Grotesque**, though it is
close enough to it that the question is a fair one. Three pieces of evidence,
all in `compare-06.html`:

- **Construction.** `01-baseline` is built entirely from circular arc commands
  (`A5 5`, `A5.5 5.5`, `A6.5 6.5`) on integer and half-integer units of a 38×44
  grid — exactly as `bracemark-icon.tsx` documents. Tracing a font gives cubic
  Béziers at arbitrary coordinates, which is what `04-draft2.svg` has.
- **Overlay.** Section 2 puts the outline over Bricolage 600 at matched cap
  height. The counters, the waist and the upper bowl all diverge.
- **Measurement.** It sits _inside_ Bricolage's 400–800 range on width/height
  (0.840), stem (24.4%) and waist height (47.5%) — which is why it feels
  related — and outside it on one number.

That number is the **waist**: `01-baseline` still reaches 77% of glyph width
where Bricolage holds 65–67% at every weight. A shallow waist welds the two
bowls into one mass down the right side, and the right side is what carries the
letter when the mark is small.

`06-waist-deepened.svg` fixes it, measuring 65.2%. The fix is not just moving
the waist point: `01-baseline`'s upper bowl is not a bowl, because the 45° cut
lands on a _vertical_ segment at x=33, so the right side drops straight down and
then turns hard inward. Deepen the waist under that and you get a visible spur.
The vertical segment has to go, and the cut runs into a single convex arc
instead. `07-plain-bowl.svg` is the same corrected letterform with the dog-ear
removed — the base to build a ribbon on, since every `04*` study so far is drawn
on draft2's letterform rather than a corrected version of this one.

|                     | w/h   | stem      | waist     | upper bowl | ink   |
| ------------------- | ----- | --------- | --------- | ---------- | ----- |
| Bricolage 400       | 0.780 | 17.5%     | 65.5%     | 94.2%      | 52.1% |
| Bricolage 600       | 0.830 | 22.4%     | 66.2%     | 94.5%      | 62.7% |
| Bricolage 800       | 0.879 | 26.3%     | 66.8%     | 94.8%      | 71.2% |
| `01-baseline`       | 0.840 | 24.4%     | **77.1%** | 89.0%      | 60.3% |
| `06` waist deepened | 0.840 | 24.4%     | 65.2%     | 89.0%      | 57.7% |
| `07` plain bowl     | 0.840 | 24.4%     | 67.3%     | 92.9%      | 61.1% |
| `04b` (draft2's B)  | 0.870 | **14.9%** | **84.8%** | 94.0%      | 62.2% |

`04b`'s stem is thinner than Bricolage's _lightest_ weight while its bowls are
heavier than its _heaviest_ — the letterform the ribbon studies are built on is
the least typographically settled thing here.

`bricolage-latin.woff2` is the latin subset `next/font` pulled for the site,
copied in so `compare-06.html` survives a `.next` clean. It is
[Bricolage Grotesque](https://github.com/ateliertriay/bricolage), licensed
SIL OFL 1.1 — redistributable, including in this repo, provided the license
travels with it.

### which Bricolage the mark is being matched against

Bricolage has three axes — `opsz 12..96`, `wdth 75..100`, `wght 200..800` — and
`layout.tsx` requests only `wght`, so the other two land on their fvar defaults.

Do not read the subset's family name to find out which cut that is. It says
_"Bricolage Grotesque 96pt ExtraBold"_, but that is nameID 1 of the **whole
variable font** (whose `opsz` default is 96), carried into the subset unchanged.
It says nothing about the instance. Measured against the variable font swept
across `opsz`, the shipped subset matches **opsz 12–18**, not 96:

|                   | w/h   | stem  | waist | ink   |
| ----------------- | ----- | ----- | ----- | ----- |
| subset as shipped | 0.830 | 22.4% | 66.2% | 62.7% |
| var `opsz 18`     | 0.830 | 22.4% | 66.2% | 62.7% |
| var `opsz 96`     | 0.799 | 24.2% | 63.5% | 65.3% |

So the site is serving the **text** cut and using it for headlines up to 48px,
which is the opposite of what the "96pt" in the name suggests.

This matters to the mark because of **which** Bricolage sits next to it. The
wordmark in `site-header.tsx:34` is 18px, so it is already effectively at
`opsz 18`:

- `axes: ['opsz']` **is now requested** (`layout.tsx`). Measured off the shipped
  build with `font-optical-sizing: auto` live, it sharpens headlines and leaves
  the wordmark alone — 18px reads 0.828 w/h / 66.0% waist against the 0.830 /
  66.2% it had before, while 48px goes to 0.815 / 64.9% and 96px to 0.797 /
  63.0%. **The mark's target did not move**, so `06` and `07` still stand.
  Cost: the latin subset goes 40KB → 75KB.
- `wdth` is deliberately **not** requested, and that is the one that would move
  the target. At `wdth 87` the B goes to w/h 0.716 and stem 25.4%; at `wdth 75`,
  0.614 and 29.0%. Narrowing the display face means re-cutting the mark against
  a different letter, so it stays at 100 — see the reasoning in `globals.css`.

Bricolage is also **wider** than Inter, not narrower — 0.830 w/h against 0.746,
on a larger x-height (0.80 of cap vs 0.75). The `globals.css` comment claimed
"narrow" for a long time and has been corrected; what the face actually has is a
deeper waist (66% vs Inter's 71%), which is where the "engineered" quality
comes from.

## the ribbon studies (`04*`)

Every one of these reuses the B outline from `04-draft2.svg` **byte for byte**,
so the comparison isolates the ribbon. The one exception is `04b`, which also
adds counters, and says so in its header.

| file                          | what changes                                                       | reads as a B at 16px |
| ----------------------------- | ------------------------------------------------------------------ | -------------------- |
| `04-draft2.svg`               | your draft — ribbon shortened to 150×153                           | no                   |
| `04a-ribbon-proportioned.svg` | ribbon only: 120×280 (1:2.3), 34% swallowtail                      | no                   |
| `04b-ribbon-counters.svg`     | ribbon 167×315 doubles as the upper counter; stadium lower counter | **yes**              |
| `04c-ribbon-pages.svg`        | `04a` + the reference's page edges, one colour                     | no                   |
| `04d-ribbon-accent.svg`       | `04a` with the ribbon coloured                                     | no                   |
| `04e-counters-accent.svg`     | `04b` + accent ribbon — **the recommendation**                     | **yes**              |
| `04f-curl-drape.svg`          | `04e` + draft3's curl, rebuilt as knockout                         | **yes**              |
| `04g-curl-taper.svg`          | `04e` + a symmetric curl                                           | **yes**              |

They are cropped tight to the ink (`viewBox="95 40 557 640"`) rather than
keeping draft2's square canvas, which sat 27px right of centre. Padding is a
placement decision and belongs to whoever places the mark.

### the finding

Re-proportioning the ribbon is a real improvement at 512px and does nothing at
16px, because **the ribbon was never what was breaking**. draft1 and draft2 have
no counters at all, and a B with no counters is a blob at icon sizes no matter
how good the ribbon is. `04b` is the only study that survives, and what saves it
is the lower counter.

The second finding comes from `reference-at-16px-and-32px.png` — the reference
screenshot downscaled to 16px (left) and 32px (right). Its page lines are a grey
smear and its swallowtail is gone, but the teal ribbon is still unmistakable.
**Colour is the one attribute that does not degrade with resolution.** That is
why `04e` spends the accent on the study whose letterform already works.

## the curl (`04f`, `04g`)

`04-draft3.svg` adds a curl to the top of the ribbon. It works at 512px and it
is gone by 128 — `compare-05.html` section 1 shows both. Two notes:

- **It is built out of opaque overlays** — a white `<rect>`, a dark `<circle>`
  over it, a dark corner patch. That hard-codes a light background even harder
  than draft2 did; the white rect stays white when everything else inverts.
  `04f` rebuilds the same gesture as part of the knockout, which is free.
- **draft3's gesture is a drape**: measured off the file, the ribbon spans
  x 153..289 at the top edge and 215..328 by y=100 — near-constant width,
  shifted right on the way down, so it lies _across_ the cover. `04g` is the
  symmetric alternative, which reads as the ribbon coming out from _behind_ the
  cover and does not make it look like it is leaning.

draft3 also drops back to a 113 × 223 ribbon with no counters, so it regresses
on the 16px finding above. `04f`/`04g` carry the curl on `04b`'s letterform.

## making the fold obvious (`08`)

Short answer: it does not really work, and the reason is geometric rather than
aesthetic.

A folded corner has a fixed grammar — the corner missing from the silhouette,
plus the flap it folded back shown in another tone. The flap is the removed
corner mirrored across the fold line, so for a cut running (22,0)→(33,11) it is
the triangle (22,0)-(33,11)-(22,11), legs of 11. **It does not fit.** The upper
counter bulges to x=27.5 and the outer edge is at x=33, so there are 5.5 units
between them — one bar-width. Four things were tried:

|                                                   | at 512px                  | at 16px                      |
| ------------------------------------------------- | ------------------------- | ---------------------------- |
| flap triangle sized to clear the counter (legs 5) | correct fold grammar      | ~2px, reads as a stray pixel |
| full mirrored flap                                | collides with the counter | —                            |
| band along the fold, knocked out                  | elegant crease            | gone by 32px                 |
| **band along the fold, orange** (`08`)            | reads as a diagonal wedge | **visible**                  |

So the only version that survives is the one that stops reading as a fold. It
says "this corner is orange", not "this page is folded".

Note the evenodd trap found on the way: pairing the flap with the counter
subpath does **not** subtract the counter from the flap. Where only the counter
covers a region the winding is odd, so the counter fills orange. Subtracting a
shape that is not wholly inside the other needs real path arithmetic.

The underlying tension is worth naming: the dog-ear earns its place as a
**silhouette** feature, and silhouettes are monochrome and survive downscaling.
Colour earns its place through **area**, and the dog-ear has the least area in
the mark — `04e`'s ribbon has roughly twenty times as much. Dog-ear and accent
colour pull in opposite directions, so the real choice is which one carries the
brand at icon sizes, not which shape the orange takes.

## the colour

The ribbon accent is **Tailwind `orange-400`, `oklch(0.75 0.183 55.934)`**
(`#ff8904`).

This was the site's petrol at first, on the theory that colour survives
downscaling where shape detail does not. The theory holds; petrol was the wrong
colour for it. Petrol against the near-black mark is **2.53:1**, so by 32px the
ribbon stops reading as coloured at all and goes back to looking like a plain
knockout — paying the full cost of a second colour and collecting none of the
benefit. `orange-400` is **8.33:1** against the same mark and is still obviously
orange at 16px. `compare-05.html` section 2, bottom row.

### can it be the app accent too?

Not `orange-400` or `amber-500` as they are. The site accent is spent on prose
links, feature marks and the featured plan — text on white, which needs 4.5:1.

|                      | vs white (link text) | vs B, light | vs B, dark |
| -------------------- | -------------------- | ----------- | ---------- |
| petrol `#1c5a60`     | **7.83**             | 2.53        | **7.51**   |
| orange-400 `#ff8904` | 2.38                 | **8.33**    | 2.28       |
| amber-500 `#fe9a00`  | 2.13                 | **9.27**    | 2.05       |
| orange-600 `#f54900` | 3.60                 | **5.50**    | **3.45**   |
| orange-700 `#ca3500` | **5.22**             | **3.79**    | **5.00**   |

Two ways through: **`orange-700` for both jobs** (the only row that passes link
text and stays legible in the mark in both themes), or a **ramp** — bright
`orange-400` for the ribbon, `orange-700` for text — which is the structure
`globals.css` already has with `signal` / `signal-strong` / `signal-soft` /
`signal-line`.

Either way this contradicts the rationale written into
`apps/bracemark-site/src/app/globals.css`, which argues for petrol as a cool
accent sitting with the cool near-black mark. Changing it means editing that
comment and `docs/brand.md` in the same change.

## file hygiene

`04-draft2.svg` and `04-draft3.svg` hardcode their fills and paint over a
backing `<rect>`. On the dark row of `compare-04.html` draft2 is the only study
that does not invert — it stays near-black on near-black. Whatever wins needs
`currentColor` for the mark and a real evenodd knockout for the shapes; every
generated `04*` file is built that way.

## the earlier round (`01`–`05`)

| file                     | concept                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `01-baseline-dogear.svg` | the mark shipping today                                                |
| `02-dogear-fold.svg`     | dog-ear deepened 11→13 units, counter chamfered on a parallel 45° line |
| `03-ribbon-knockout.svg` | ribbon with a squared upper bowl to keep the ink at bar-width          |
| `04-draft1-traced.svg`   | `bracemark-logo-draft1.png` traced onto the 38×44 grid                 |
| `05-brace-spine.svg`     | `{` as the B's spine                                                   |

These sit on the **38×44 grid** the shipping icon uses. The `04*` studies do
not — they are on draft2's geometry. Whichever direction wins will need
normalising onto one grid before it goes into `bracemark-icon.tsx`.

`05-brace-spine.svg` is the datapoint for whether a curly brace survives 16px:
it does survive as a shape, but it goes very light, because it is drawn as
strokes rather than as a filled silhouette. A brace can work at that size if
it is drawn heavy enough; it cannot work as a hairline.

## maskable icons

A finding that applies to every variant here, including what ships today: at
full bleed the Android safe circle clips all of them. Whatever wins needs
padding to roughly 64% for `logo192-maskable.png` / `logo512-maskable.png`. The
bottom of `compare.html` shows this.

## rebuilding

Both pages inline the SVGs, so they go stale the moment you edit a variant.

```sh
node build-07.js         # → compare-07.html
node build-04.js         # regenerates 04a–04g from the shared B outline
node build-compare04.js  # → compare-04.html
node build-compare05.js  # → compare-05.html
node build-compare.js compare.html /tmp/strip.html   # → compare.html
```

`build-07.js` also inlines its PNGs. Its one rule worth keeping: every small-size
raster is produced by sharp **at its true pixel size** (`density: 72`, so the
SVG's declared width _is_ the output width). Rendering at 512 and downscaling is
a different test and hides exactly the hairline failures that page exists to
find — the first cut of it made that mistake and every 16px cell was really a
533px render.

`build-04.js` is where the numbers live — `rib(x0, x1, yBottom, apexY)`
generates the ribbon knockout, `ACCENT` is the ribbon colour, and the B outline
is a single constant at the top. Edit there rather than in the generated SVGs.

One trap if you hand-edit the header comments: **no `--` inside them.** A double
hyphen is illegal in an XML comment, and a browser forgives it when the SVG is
inlined into HTML but the standalone `.svg` file becomes unparseable. That is
why the CSS custom properties are written without their leading dashes. Check
with:

```sh
for f in *.svg; do python3 -c "import xml.dom.minidom;xml.dom.minidom.parse('$f')" || echo "FAIL $f"; done
```
