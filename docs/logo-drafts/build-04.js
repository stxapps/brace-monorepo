// Generates the 04-* ribbon studies. All of them reuse the B outline from
// 04-draft2.svg byte for byte — only the ribbon (and, where noted, the lower
// counter) changes, so the comparison isolates the ribbon.
//
//   node build-04.js
//
// viewBox is cropped tight to the ink (x 95..651.7, y 40..680 in draft2's
// 720 canvas) rather than keeping draft2's square canvas. draft2 sat 27px
// right of centre; cropping tight removes the question entirely and makes
// padding a placement decision, which is what it should be for an icon.
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const VIEWBOX = '95 40 557 640';

// draft2's outline, unmodified.
const B =
  'M567.728 330.909C655 243.636 631.784 84.3071 508.707 40.0002C447.064 40 182.273 39.9999 153.182 40.0001C124.091 40.0005 95.0002 63.2033 95.0002 98.1819L95.0001 154.038C95 284.858 94.9996 598.266 95 621.818C95.0004 650.909 118.283 680 153.182 680C178.807 680 329.467 680 432.243 680H516.818C714.02 607.273 662.273 374.545 567.728 330.909Z';

// A bookmark ribbon as a knockout subpath. Its top edge sits exactly on the
// B's top edge (y=40) so evenodd opens it into a notch rather than leaving a
// closed hole — a ribbon has to breach the top edge to read as tucked in.
const rib = (x0, x1, yBot, apexY) =>
  `M${x0} 40V${yBot}L${(x0 + x1) / 2} ${apexY}L${x1} ${yBot}V40Z`;

// The ribbon accent. Tailwind orange-400, from node_modules/tailwindcss/theme.css.
//
// This started out as the site's petrol (oklch(0.43 0.062 205)) on the theory
// that colour survives downscaling where shape detail does not. The theory
// holds; petrol was the wrong colour for it. Petrol against the near-black
// mark is 2.53:1, so at 32px and below the ribbon stops reading as coloured
// at all and goes back to looking like a plain knockout — it spends the whole
// cost of a second colour and collects none of the benefit. orange-400 is
// 8.33:1 against the same mark and is still obviously orange at 16px.
// See compare-05.html, section 2, bottom row.
const ACCENT = 'oklch(0.75 0.183 55.934)';

const svg = (body, comment) =>
  `${comment}\n<svg viewBox="${VIEWBOX}" fill="none" xmlns="http://www.w3.org/2000/svg">\n${body}\n</svg>\n`;

const onePath = (d) =>
  `  <path d="${d}" fill-rule="evenodd" fill="currentColor" />`;

const files = {};

// ── 04a ── the minimal fix: same idea as draft2, re-proportioned.
// draft2's ribbon is 150 wide × 153 long — square, so it reads as a notch cut
// in the top edge rather than as a ribbon. Bookmark ribbons read at roughly
// 1:2 and longer. 120 × 280 (1:2.3), swallowtail 95 deep (34% of the length,
// against draft1's 11%). Stem widened 83→85 by moving the ribbon right.
files['04a-ribbon-proportioned.svg'] = svg(
  onePath(B + rib(180, 300, 320, 225)),
  `<!-- 04a — RIBBON, RE-PROPORTIONED. draft2's B untouched; only the ribbon\n     changes: 150×153 (square) becomes 120×280 (1:2.3), and the swallowtail\n     goes from 37% to 34% of a much longer ribbon, so the tail reads as a tail\n     instead of as a chevron. This is the smallest change that makes the\n     negative space say "bookmark".\n     What it does NOT fix: 56% of the mark's width is still unbroken ink to the\n     right of the ribbon, because the B has no counters. See the 16px row. -->`
);

// ── 04b ── the ribbon doubles as the upper counter, and the lower counter
// comes back. This is the one that changes the B, so it is labelled as such.
// The ribbon is widened to 182 so it occupies the space an upper counter
// would, and a stadium-shaped lower counter breaks the bottom mass.
files['04b-ribbon-counters.svg'] = svg(
  onePath(
    B +
      rib(178, 345, 355, 245) +
      'M178 430H485A85 85 0 0 1 485 600H178Z'
  ),
  `<!-- 04b — RIBBON AS COUNTER, PLUS A LOWER COUNTER. The one study here that\n     edits the B, because the ribbon alone cannot carry the letter: a B needs\n     two counters and draft1/draft2 have none, which is why they go to a solid\n     blob when you shrink them. On the 16px row this is the only one of the\n     five still legible as a letter.\n     The ribbon is 167 × 315 (1:1.9) with a 110-deep swallowtail (35%) — wide\n     enough to sit where the upper counter belongs and do that job as well as\n     its own, long enough to still read as a ribbon. A stadium counter opens\n     the lower bowl; its left edge is aligned with the ribbon's at x=178 so the\n     stem holds one width down the whole letter, and the bars around it come\n     out 75 top / 82 right / 80 bottom, near enough even. -->`
);

// ── 04c ── the reference's structure in one colour: ribbon above, page edges
// below. The page lines are what stop the lower half going solid in the
// reference screenshot; they do the job a counter would.
const pages = [545, 585, 625]
  .map((y) => `M171 ${y}H509A11 11 0 0 1 509 ${y + 22}H171A11 11 0 0 1 171 ${y}Z`)
  .join('');
files['04c-ribbon-pages.svg'] = svg(
  onePath(B + rib(180, 300, 320, 225) + pages),
  `<!-- 04c — RIBBON + PAGE EDGES, ONE COLOUR. The structure of the reference\n     screenshot: ribbon in the upper bowl, the stacked page edges of a book in\n     the lower one. Worth seeing because the page lines are doing a counter's\n     job — they are the reason the reference does not read as a blob even\n     though its B, like draft2's, has no counters.\n     They are interior detail rather than silhouette, so they are the first\n     thing to go when it shrinks. That is the trade the 16px row prices. -->`
);

// ── 04d ── the reference's look: an accent ribbon on the near-black B.
files['04d-ribbon-accent.svg'] = svg(
  `  <path d="${B}" fill="currentColor" />\n` +
    `  <path d="${rib(180, 300, 320, 225)}" fill="${ACCENT}" />`,
  // NB: no "--" anywhere in these comment strings. A double hyphen is illegal
  // inside an XML comment, and while a browser will forgive it when the SVG is
  // inlined into HTML, it makes the standalone .svg file unparseable. So the
  // custom properties are named here without their leading dashes.
  `<!-- 04d — ACCENT RIBBON. The reference's move: the ribbon coloured rather\n     than knocked out. Tailwind orange-400, oklch(0.75 0.183 55.934).\n     COST, and it is not small: this is two colours and one of them is fixed,\n     so the mark stops being a single currentColor path. Read the header of\n     packages/web-ui/src/components/icons/bracemark-icon.tsx before adopting\n     it — the brand-mark / brand-mark-dot token pair that was deleted from\n     styles.css existed for exactly this reason, and this reintroduces the\n     need for it. It also no longer composes on an arbitrary surface.\n     The letterform is still 04a's, so this is a blob at 16px however good the\n     ribbon colour is. 04e is this colour on a letterform that survives. -->`
);

// ── 04e ── 04b's geometry with 04d's colour. Downscaling the reference
// screenshot to 16px shows its page lines and swallowtail gone but the teal
// ribbon still plainly there: at icon sizes colour survives where shape detail
// does not. So the accent is worth most on the one study whose letterform
// already survives — which is 04b, not 04a or 04c.
files['04e-counters-accent.svg'] = svg(
  `  <path d="${B}M178 430H485A85 85 0 0 1 485 600H178Z" fill-rule="evenodd" fill="currentColor" />\n` +
    `  <path d="${rib(178, 345, 355, 245)}" fill="${ACCENT}" />`,
  `<!-- 04e — 04b's GEOMETRY, 04d's COLOUR. The recommendation.\n     04b is the only study whose letter survives 16px, and downscaling the\n     reference screenshot to 16px shows why colour is worth spending there:\n     its page lines and its swallowtail are gone at that size but the coloured\n     ribbon is still unmistakable. Colour is the one attribute that does not\n     degrade with resolution — provided it actually contrasts with the mark it\n     sits in, which is why this is orange-400 and not the site's petrol. See\n     the ACCENT note at the top of build-04.js.\n     Same trade as 04d, and it is a real one: two colours, one of them fixed,\n     so this is no longer a single currentColor path. It will need a token pair\n     back in styles.css and it will not compose on an arbitrary surface — read\n     the header of packages/web-ui/src/components/icons/bracemark-icon.tsx,\n     which explains why the last pair was deleted. -->`
);

// ── 04f / 04g ── does the ribbon's top want a curl?
// draft3 builds one, but out of stacked opaque shapes: a white rect, a dark
// circle over it, a dark corner patch. That hard-codes a light background —
// the white rect stays white when everything else inverts. Rebuilt here as
// part of the knockout so the question can be judged on the drawing alone.
//
// draft3's gesture, measured: at the top edge the ribbon spans x 153..289, and
// by y=100 it spans 215..328. Near-constant width, shifted right on the way
// down — the ribbon DRAPES over the top edge rather than sitting in a slot.
// 04g is the symmetric alternative: same flare, both sides, which reads as the
// ribbon emerging from behind the cover instead of lying across it.
const RIB_BODY = 'V355L261.5 245L345 355V100';
files['04f-curl-drape.svg'] = svg(
  `  <path d="${B}M178 430H485A85 85 0 0 1 485 600H178Z" fill-rule="evenodd" fill="currentColor" />\n` +
    `  <path d="M155 40C165 70 170 85 178 100${RIB_BODY}C337 85 330 70 315 40Z" fill="${ACCENT}" />`,
  `<!-- 04f — CURL, DRAPED. draft3's top-of-ribbon gesture rebuilt as geometry\n     rather than as opaque overlays, on 04b's letterform. The ribbon leans:\n     wider to the left at the top edge, settling right as it falls, so it\n     reads as lying ACROSS the cover.\n     It is a 512px refinement. Below about 128px it is gone — see the ladder. -->`
);
files['04g-curl-taper.svg'] = svg(
  `  <path d="${B}M178 430H485A85 85 0 0 1 485 600H178Z" fill-rule="evenodd" fill="currentColor" />\n` +
    `  <path d="M196 40C188 68 180 86 178 100${RIB_BODY}C343 86 335 68 327 40Z" fill="${ACCENT}" />`,
  `<!-- 04g — CURL, SYMMETRIC. The same flare taken to both sides: 131 wide at\n     the top edge, 167 by y=100. Reads as the ribbon coming out from BEHIND\n     the cover rather than draping over it, and unlike 04f it does not make the\n     ribbon look like it is leaning. Also a 512px-only refinement. -->`
);

for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), content);
  console.log('wrote', name);
}
