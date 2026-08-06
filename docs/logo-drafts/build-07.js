// Builds compare-07.html — draft4 across every size and every surface it has to
// survive, against the shipping mark (01) and last round's corrected letterform
// (06).
//   node build-07.js
//
// The raster ladder is the point of this page. Every small-size PNG is
// rasterised by sharp AT ITS TRUE PIXEL SIZE and then blown up with nearest
// neighbour. Rendering at 512 and downscaling is NOT the same test — it hides
// exactly the hairline-and-smudge failures this page exists to find.

const fs = require('fs');
const sharp = require('sharp');

const FG_LIGHT = '#101828';
const BG_LIGHT = '#ffffff';
const FG_DARK = '#ffffff';
const BG_DARK = '#0b1220';

function load(file) {
  const s = fs.readFileSync(file, 'utf8');
  const vb = s
    .match(/viewBox="([^"]+)"/)[1]
    .trim()
    .split(/\s+/)
    .map(Number);
  const d = [...s.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(' ');
  return { d, x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
}

const MARKS = {
  draft4: { label: 'draft4', mark: load('draft4.svg') },
  '01': { label: '01 (shipping)', mark: load('01-baseline-dogear.svg') },
  '06': { label: '06 (waist deepened)', mark: load('06-waist-deepened.svg') },
};

// mark scaled so its HEIGHT is `inset` of a `size` square, centred
function tile(m, size, fg, bg, inset) {
  const s = (size * inset) / m.h;
  const dx = (size - m.w * s) / 2 - m.x * s;
  const dy = (size - m.h * s) / 2 - m.y * s;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    (bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : '') +
    `<g transform="translate(${dx} ${dy}) scale(${s})">` +
    `<path d="${m.d}" fill-rule="evenodd" fill="${fg}"/></g></svg>`
  );
}

// inline, themeable: currentColor, no background, cropped to the ink
function inline(m, cls) {
  return (
    `<svg class="${cls}" viewBox="${m.x} ${m.y} ${m.w} ${m.h}" ` +
    `xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true">` +
    `<path d="${m.d}" fill-rule="evenodd" fill="currentColor"/></svg>`
  );
}

async function pngUri(svg) {
  // density 72 => the SVG's declared width/height IS the output pixel size
  const buf = await sharp(Buffer.from(svg), { density: 72 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

const LADDER = [16, 20, 24, 32, 48, 64, 96, 128];

// ---------------------------------------------------------------- measurement

const PROFILE_H = 1024;

async function measure(m) {
  const W = Math.round((PROFILE_H * m.w) / m.h);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${PROFILE_H}" ` +
    `viewBox="${m.x} ${m.y} ${m.w} ${m.h}"><path d="${m.d}" fill-rule="evenodd" fill="#000"/></svg>`;
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rows = [];
  let ink = 0;
  for (let y = 0; y < info.height; y++) {
    const segs = [];
    let inSeg = false;
    let st = 0;
    for (let x = 0; x < info.width; x++) {
      const on = data[(y * info.width + x) * info.channels + info.channels - 1] > 127;
      if (on) {
        ink++;
        if (!inSeg) {
          inSeg = true;
          st = x;
        }
      } else if (inSeg) {
        inSeg = false;
        segs.push([st, x - 1]);
      }
    }
    if (inSeg) segs.push([st, info.width - 1]);
    rows.push(segs);
  }
  const width = (y) => (rows[y].length ? rows[y].at(-1)[1] - rows[y][0][0] + 1 : 0);

  // the two counters are separated by the one run of single-segment rows
  const multi = [];
  for (let y = 0; y < PROFILE_H; y++) if (rows[y].length > 1) multi.push(y);
  let gap = [multi[0], multi.at(-1)];
  for (let k = 1; k < multi.length; k++) {
    if (multi[k] - multi[k - 1] > 1) {
      gap = [multi[k - 1], multi[k]];
      break;
    }
  }

  let waist = Infinity;
  let waistY = 0;
  for (let y = gap[0]; y <= gap[1]; y++) {
    const w = width(y);
    if (w < waist) {
      waist = w;
      waistY = y;
    }
  }
  let upper = 0;
  for (let y = 0; y < gap[0]; y++) upper = Math.max(upper, width(y));
  let lower = 0;
  for (let y = gap[1]; y < PROFILE_H; y++) lower = Math.max(lower, width(y));

  const stemSeg = rows[Math.round(PROFILE_H * 0.25)][0];
  const stem = stemSeg[1] - stemSeg[0] + 1;

  const counter = (y0, y1) => {
    let x0 = Infinity,
      x1 = -1,
      t0 = Infinity,
      t1 = -1;
    for (let y = y0; y <= y1; y++) {
      const s = rows[y];
      for (let k = 1; k < s.length; k++) {
        const a = s[k - 1][1] + 1,
          b = s[k][0] - 1;
        if (b >= a) {
          x0 = Math.min(x0, a);
          x1 = Math.max(x1, b);
          t0 = Math.min(t0, y);
          t1 = Math.max(t1, y);
        }
      }
    }
    return { w: (100 * (x1 - x0 + 1)) / W, h: (100 * (t1 - t0 + 1)) / PROFILE_H };
  };

  return {
    wh: W / PROFILE_H,
    stem: (100 * stem) / W,
    waist: (100 * waist) / W,
    waistY: (100 * waistY) / PROFILE_H,
    upper: (100 * upper) / W,
    lower: (100 * lower) / W,
    ink: (100 * ink) / (info.width * info.height),
    upperCounter: counter(0, gap[0]),
    lowerCounter: counter(gap[1], PROFILE_H - 1),
  };
}

// ------------------------------------------------------------------ the page

(async () => {
  const font = fs.readFileSync('bricolage-latin.woff2').toString('base64');

  // raster ladder
  const raster = {};
  for (const [key, { mark }] of Object.entries(MARKS)) {
    raster[key] = {};
    for (const size of LADDER) {
      raster[key][size] = {
        light: await pngUri(tile(mark, size, FG_LIGHT, BG_LIGHT, 0.82)),
        dark: await pngUri(tile(mark, size, FG_DARK, BG_DARK, 0.82)),
        bleedLight: await pngUri(tile(mark, size, FG_LIGHT, BG_LIGHT, 1)),
      };
    }
  }

  const stats = {};
  for (const [key, { mark }] of Object.entries(MARKS)) stats[key] = await measure(mark);

  // zoom each cell to roughly the same on-screen size so the strip stays one row
  // and the small end is not visually swamped by the large end
  const zoomFor = (s) => Math.max(1, Math.round(176 / s));

  const ladderRow = (key, theme) =>
    LADDER.map((s) => {
      const z = zoomFor(s);
      return `<div class="cell"><img src="${raster[key][s][theme]}" width="${s * z}" height="${s * z}" alt="${key} at ${s}px"><div class="cap">${s} &middot; ${z}&times;</div></div>`;
    }).join('');

  const oneToOne = (key, theme) =>
    LADDER.map(
      (s) =>
        `<div class="cell1"><img src="${raster[key][s][theme]}" width="${s}" height="${s}" alt=""></div>`,
    ).join('');

  const row = (label, cells) => `<tr><th>${label}</th>${cells}</tr>`;
  const num = (v, d = 1) => v.toFixed(d);

  const metricTable = `
<table class="metrics">
  <thead><tr><th></th><th>w/h</th><th>stem</th><th>waist</th><th>upper bowl</th><th>lower bowl</th><th>upper counter</th><th>lower counter</th><th>ink</th></tr></thead>
  <tbody>
    <tr class="ref"><th>Bricolage 600</th><td>0.830</td><td>22.4%</td><td>66.2%</td><td>94.5%</td><td>—</td><td>—</td><td>—</td><td>62.7%</td></tr>
    ${['01', '06', 'draft4']
      .map((k) => {
        const s = stats[k];
        const bad = k === 'draft4' ? ' class="bad"' : '';
        return `<tr${k === 'draft4' ? ' class="hi"' : ''}><th>${MARKS[k].label}</th><td>${num(s.wh, 3)}</td><td>${num(s.stem)}%</td><td${bad}>${num(s.waist)}%</td><td>${num(s.upper)}%</td><td>${num(s.lower)}%</td><td>${num(s.upperCounter.w)}%</td><td>${num(s.lowerCounter.w)}%</td><td>${num(s.ink)}%</td></tr>`;
      })
      .join('')}
  </tbody>
</table>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>compare-07 — draft4 at every size</title>
<style>
@font-face {
  font-family: 'Bricolage';
  src: url(data:font/woff2;base64,${font}) format('woff2');
  font-weight: 200 800;
  font-display: block;
}
:root {
  color-scheme: light dark;
  --bg: #ffffff; --fg: #101828; --muted: #667085; --line: #e4e7ec; --panel: #f9fafb;
  --dark-bg: ${BG_DARK};
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0b1220; --fg: #f2f4f7; --muted: #98a2b3; --line: #1d2939; --panel: #111a2b; }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 48px 32px 120px;
  background: var(--bg); color: var(--fg);
  font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
}
main { max-width: 1180px; margin: 0 auto; }
h1 { font-family: Bricolage, sans-serif; font-weight: 800; font-size: 40px; letter-spacing: -0.02em; margin: 0 0 4px; }
h2 {
  font-family: Bricolage, sans-serif; font-weight: 700; font-size: 24px; letter-spacing: -0.01em;
  margin: 72px 0 8px; padding-top: 24px; border-top: 1px solid var(--line);
}
h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 32px 0 12px; font-weight: 600; }
p { max-width: 68ch; }
.lede { color: var(--muted); font-size: 17px; max-width: 68ch; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: var(--panel); padding: 1px 5px; border-radius: 4px; }
.note { border-left: 3px solid var(--line); padding-left: 16px; color: var(--muted); }
.verdict { border-left: 3px solid #f79009; padding-left: 16px; }

.strip { display: flex; gap: 20px; align-items: flex-end; flex-wrap: wrap; overflow-x: auto; padding-bottom: 4px; }
.cell { text-align: center; }
.cell img { image-rendering: pixelated; display: block; border: 1px solid var(--line); }
.cap { font-size: 11px; color: var(--muted); margin-top: 6px; font-variant-numeric: tabular-nums; }
.strip1 { display: flex; gap: 20px; align-items: center; padding: 20px; background: var(--panel); border-radius: 8px; overflow-x: auto; }
.cell1 img { display: block; }
.lbl { font-size: 12px; color: var(--muted); width: 150px; flex: none; }
.darkstrip { background: ${BG_DARK}; }

.side { display: grid; grid-template-columns: 150px 1fr; gap: 20px; align-items: center; margin-bottom: 24px; }

.masks { display: flex; gap: 28px; flex-wrap: wrap; }
.mask { text-align: center; }
.mask .frame { position: relative; width: 128px; height: 128px; background: var(--panel); }
.mask svg.m { position: absolute; inset: 0; width: 100%; height: 100%; }
.squircle { border-radius: 22.37%; overflow: hidden; }
.circle { border-radius: 50%; overflow: hidden; }
.safe { position: absolute; inset: 0; pointer-events: none; }
.safe circle { fill: none; stroke: #f04438; stroke-width: 1; stroke-dasharray: 3 3; }

.tile { display: grid; place-items: center; }
.tile svg { display: block; }

table { border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; margin-top: 12px; }
th, td { text-align: right; padding: 7px 14px; border-bottom: 1px solid var(--line); }
th:first-child, thead th { text-align: left; }
thead th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
tr.ref { color: var(--muted); }
tr.hi { background: color-mix(in oklab, #f79009 12%, transparent); }
td.bad { color: #d92d20; font-weight: 700; }

.wordmark { font-family: Bricolage, sans-serif; font-weight: 600; letter-spacing: -0.01em; }
.chrome {
  display: flex; align-items: center; gap: 10px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px 10px 0 0;
  padding: 9px 14px; width: 300px; font-size: 13px; color: var(--muted);
}
.chrome svg { flex: none; }

.overlay { position: relative; width: 320px; height: 370px; }
.overlay svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ov-a { color: color-mix(in oklab, currentColor 22%, transparent); }
.ov-b { fill: none; }
.ov-b path { fill: none; stroke: #f04438; stroke-width: 1.2; vector-effect: non-scaling-stroke; }

.corner { width: 320px; height: 320px; background: var(--panel); display: block; border-radius: 6px; }

.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 32px; align-items: start; }
ul { max-width: 68ch; }
li { margin-bottom: 8px; }
</style>
</head>
<body>
<main>

<h1>draft4, at every size</h1>
<p class="lede">draft4 against the shipping mark (<code>01</code>) and last round's corrected
letterform (<code>06</code>), rendered at true pixel sizes rather than downscaled from 512.
Regenerate with <code>node build-07.js</code>.</p>

<p class="verdict"><strong>Short version.</strong> draft4 is the best small-size performer here
&mdash; its counters are ${num(stats.draft4.upperCounter.w)}% / ${num(stats.draft4.lowerCounter.w)}%
wide against <code>01</code>'s ${num(stats['01'].upperCounter.w)}% / ${num(stats['01'].lowerCounter.w)}%,
and counters are what decides 16px. It is also the <em>only</em> mark in the exploration whose
waist goes the wrong way (${num(stats.draft4.waist)}%, against the 64&ndash;67% that <code>06</code>
and Bricolage hold), which is defensible only because draft4 is a different concept &mdash; a page
whose right edge is two bowls, rather than a letterform with a corner cut. It cannot ship as
exported: hardcoded fill, off-grid geometry. See section 6.</p>

<h2>1. the raster ladder</h2>
<p>Every image below was rasterised by the renderer <em>at that pixel size</em> and then blown
up with nearest neighbour &mdash; by the factor printed under each cell, chosen so the whole
ladder is comparable on screen. Mark height is 82% of the tile, the inset
<code>logo512.png</code> ships at today.</p>

<h3>draft4 — light</h3>
<div class="strip">${ladderRow('draft4', 'light')}</div>
<h3>01 shipping — light</h3>
<div class="strip">${ladderRow('01', 'light')}</div>
<h3>06 waist deepened — light</h3>
<div class="strip">${ladderRow('06', 'light')}</div>

<h3>the same pixels at 1:1</h3>
<div class="strip1"><span class="lbl">draft4</span>${oneToOne('draft4', 'light')}</div>
<div class="strip1"><span class="lbl">01 shipping</span>${oneToOne('01', 'light')}</div>
<div class="strip1"><span class="lbl">06 waist</span>${oneToOne('06', 'light')}</div>

<h3>draft4 — dark</h3>
<div class="strip">${ladderRow('draft4', 'dark')}</div>
<div class="strip1 darkstrip"><span class="lbl">draft4</span>${oneToOne('draft4', 'dark')}</div>
<div class="strip1 darkstrip"><span class="lbl">01 shipping</span>${oneToOne('01', 'dark')}</div>

<h2>2. the top-right corner</h2>
<div class="grid2">
<div>
<h3>draft4, top-right corner, measured</h3>
<svg class="corner" viewBox="232 -18 226 226" xmlns="http://www.w3.org/2000/svg">
  <path d="${MARKS.draft4.mark.d}" fill-rule="evenodd" fill="currentColor" opacity="0.9"/>
  <!-- the 45 degree cut, extended -->
  <line x1="245" y1="-12" x2="440" y2="183" stroke="#98a2b3" stroke-width="1" stroke-dasharray="5 5"/>
  <!-- perpendicular from the counter lobe tip to the cut: 48.3 units -->
  <line x1="341.53" y1="152.84" x2="375.68" y2="118.69" stroke="#f04438" stroke-width="3"/>
  <circle cx="341.53" cy="152.84" r="5" fill="#f04438"/>
  <!-- the top bar, for scale: 68 units -->
  <line x1="300" y1="0" x2="300" y2="68" stroke="#12b76a" stroke-width="3"/>
  <text x="384" y="112" font-size="17" fill="#f04438" font-weight="700">48</text>
  <text x="270" y="40" font-size="17" fill="#12b76a" font-weight="700" text-anchor="end">68</text>
</svg>
<div class="cap" style="margin-top:8px">red: the ink left between the counter's tip and the
45&deg; cut. green: the top bar, every other bar in the mark.</div>
</div>
<div>
<p>The upper counter is not a closed bowl. Its right boundary runs out to a
<strong>curved point</strong> at <code>(341.5, 152.8)</code> and back to <code>(257, 68)</code>,
so the ink between that tip and the 45&deg; cut narrows to about <strong>48 units</strong> where
every other bar in the mark is <strong>68</strong> and the stem is <strong>96</strong>.</p>
<p>The obvious accusation &mdash; that the pinch turns to grey mush at small sizes &mdash;
does <strong>not</strong> hold up when measured. Counting pixels that land neither as ink nor as
background in the mark's top-right quadrant: at 16/20/24/32/48px draft4 runs 21/18/23/13/9%
against <code>01</code>'s 17/20/21/14/11%. All three marks carry a 45&deg; diagonal through that
corner, so they all antialias about the same, and draft4 is if anything the cleanest by 48px.
The pinch is thin, not blurry.</p>
<p>The real objection is <strong>shape</strong>. Because the counter's boundary is
<em>convex</em> into the corner, the leftover wedge reads as a crescent &mdash; a pennant, a
flag &mdash; rather than as a folded triangle. A dog-ear flap has straight edges; this one
bulges, and it comes to a point at the top instead of meeting the cut squarely. Whether that
is a bug depends on whether the corner is still meant to say &ldquo;folded page&rdquo;. It
reads as deliberate ornament at 48px and up, and it is simply gone below 24px, which is the
same place <code>08</code> landed: the fold is a 512px feature either way.</p>
</div>
</div>

<h2>3. the waist</h2>
${metricTable}
<p>Same measurement method for every row: rasterise to 1024 tall, take the outer width
of each scanline, and read the minimum between the two counters.</p>
<p class="verdict"><strong>draft4 has the shallowest waist in the entire exploration &mdash; 84.8%.</strong>
<code>01</code> was already flagged at 74.5% for welding the two bowls into one mass down the
right side, and <code>06</code> was cut specifically to bring that to 64%. draft4 moves it 10
points the <em>other</em> way.</p>
<p>Whether that is a defect depends on which mark draft4 is. As a
<strong>letterform</strong> it is a regression on the one number last round settled. As a
<strong>page whose right edge happens to be two bowls</strong> &mdash; which is what the straight
left edge, the two 46.5-unit corner radii and the straight bottom actually draw &mdash; a
shallow waist is the point, because a deep notch would stop the silhouette reading as a
card. draft4 is a different concept, not a worse execution of the old one, and it should be
judged as one.</p>
<p>What is <em>not</em> in tension: draft4's counters are much larger
(${num(stats.draft4.upperCounter.w)}% / ${num(stats.draft4.lowerCounter.w)}% wide against
<code>01</code>'s ${num(stats['01'].upperCounter.w)}% / ${num(stats['01'].lowerCounter.w)}%), and that is
what keeps it open at 16px. Counters are the thing that decides the small end &mdash; the same
finding the <code>04*</code> studies landed on.</p>

<h3>draft4 (filled) under 06 (outline)</h3>
<div class="overlay">
  ${inline(MARKS.draft4.mark, 'x ov-a')}
  <svg class="ov-b" viewBox="0 0 38 44" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><path d="${MARKS['06'].mark.d}"/></svg>
</div>

<h2>4. app icon masks</h2>
<p>All three marks at full bleed and at 82%, under the masks the platforms actually apply.
The dashed circle is the Android maskable safe zone (80% diameter); anything crossing it can
be cropped.</p>
<p class="note">draft4 does <strong>not</strong> move the maskable number. Measuring the
circumradius about the tile centre, all three marks fit the safe circle at a mark height of
<strong>64.2%</strong> of the tile &mdash; identical, because they share the 0.863 aspect and
proportionally identical corner radii (46.5/512 against 4/44). The 82% row above is over that
budget for every one of them, which is the finding <code>compare.html</code> already carried;
draft4 neither helps nor hurts it.</p>

<div class="masks">
${['draft4', '01', '06']
  .map(
    (k) => `
  <div class="mask">
    <div class="frame squircle tile">${tile(MARKS[k].mark, 128, FG_LIGHT, BG_LIGHT, 1)}</div>
    <div class="cap">${MARKS[k].label}<br>iOS squircle, bleed</div>
  </div>`,
  )
  .join('')}
</div>

<div class="masks" style="margin-top:28px">
${['draft4', '01', '06']
  .map(
    (k) => `
  <div class="mask">
    <div class="frame tile" style="position:relative">
      ${tile(MARKS[k].mark, 128, FG_LIGHT, BG_LIGHT, 0.82)}
      <svg class="safe" viewBox="0 0 128 128"><circle cx="64" cy="64" r="51.2"/></svg>
    </div>
    <div class="cap">${MARKS[k].label}<br>82% + safe zone</div>
  </div>`,
  )
  .join('')}
</div>

<div class="masks" style="margin-top:28px">
${['draft4', '01', '06']
  .map(
    (k) => `
  <div class="mask">
    <div class="frame circle tile">${tile(MARKS[k].mark, 128, FG_LIGHT, BG_LIGHT, 0.62)}</div>
    <div class="cap">${MARKS[k].label}<br>Android circle, 62%</div>
  </div>`,
  )
  .join('')}
</div>

<h2>5. in place</h2>

<h3>browser tab, 16px</h3>
<div class="side" style="grid-template-columns:1fr">
  <div class="chrome"><img src="${raster.draft4[16].light}" width="16" height="16" alt=""><span>Bracemark &mdash; Links</span></div>
</div>
<div class="side" style="grid-template-columns:1fr">
  <div class="chrome"><img src="${raster['01'][16].light}" width="16" height="16" alt=""><span>Bracemark &mdash; Links (01 shipping)</span></div>
</div>

<h3>site header, mark set to the 18px wordmark's cap height</h3>
${['draft4', '01', '06']
  .map(
    (k) => `<div style="display:flex;align-items:center;gap:9px;margin-bottom:18px">
  ${inline(MARKS[k].mark, 'x').replace('<svg ', '<svg style="height:13px;width:auto;display:block" ')}
  <span class="wordmark" style="font-size:18px">Bracemark</span>
  <span style="font-size:12px;color:var(--muted);margin-left:12px">${MARKS[k].label}</span>
</div>`,
  )
  .join('')}

<h3>sidebar row, 20px</h3>
${['draft4', '01']
  .map(
    (
      k,
    ) => `<div style="display:flex;align-items:center;gap:12px;padding:8px 12px;width:280px;border-radius:8px;background:var(--panel);margin-bottom:8px">
  ${inline(MARKS[k].mark, 'x').replace('<svg ', '<svg style="height:20px;width:auto;display:block" ')}
  <span>All links</span><span style="margin-left:auto;font-size:12px;color:var(--muted)">${k}</span>
</div>`,
  )
  .join('')}

<h2>6. what has to change before this can ship</h2>
<ul>
<li><strong>The fill is hardcoded <code>#101828</code>.</strong> The shipping mark is one path in
<code>currentColor</code> so it composes on any surface and needs no theme token &mdash; see the
comment at the top of <code>bracemark-icon.tsx</code>. draft4 as exported stays near-black on a
near-black background. This is the same failure <code>04-draft2.svg</code> had.</li>
<li><strong>The geometry is a tool export, not a construction.</strong> <code>46.5098</code>,
<code>0.000270318</code>, <code>465.454</code>. The 442&times;512 box is 11.6364&times; the 38&times;44
grid, so nothing lands on a round number. Whatever wins gets re-cut on one grid before it
goes into <code>bracemark-icon.tsx</code> &mdash; <code>bracemark-expo</code>'s port copies the
numbers by hand.</li>
<li><strong>The middle bar is heavier than the horizontals</strong> &mdash; 80 units between the
counters against 68 for the top and bottom bars. Conventionally a B's middle bar is equal or
slightly lighter.</li>
<li><strong>The upper counter's pointed lobe</strong> &mdash; section 2.</li>
<li><strong>The ink bbox is exactly the viewBox</strong>, with the lower bowl touching the right
edge at x=442. Correct for a source file; it just means padding is entirely the caller's
job, and the caller currently is nine PNG sizes plus three iOS variants.</li>
</ul>

<h2>7. rebuilding</h2>
<p>This page inlines every SVG and every PNG, so it goes stale the moment you edit a variant.</p>
<p><code>node build-07.js</code></p>
</main>
</body>
</html>`;

  fs.writeFileSync('compare-07.html', html);
  console.log('compare-07.html written,', (html.length / 1024).toFixed(0) + 'KB');
})();
