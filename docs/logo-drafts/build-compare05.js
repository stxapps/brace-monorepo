// Builds compare-05.html — the two open questions: does the ribbon top want a
// curl, and what colour should the ribbon be.
//   node build-compare05.js
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const H = 640 / 557;

function inline(file, h, fill) {
  let s = fs.readFileSync(path.join(DIR, file), 'utf8');
  s = s.replace(/<!--[\s\S]*?-->/g, '').trim();
  s = s.replace(/<rect[^>]*fill="white"[^>]*\/>/, '');
  s = s.replace(/viewBox="0 0 720 720"/, 'viewBox="95 40 557 640"');
  s = s.replace(/width="720"\s+height="720"/, '');
  if (fill) s = s.replace(/oklch\([^)]*\)/, fill);
  return s.replace('<svg', `<svg width="${Math.round(h / H)}" height="${h}"`);
}

const CURLS = [
  ['04e-counters-accent.svg', 'no curl', 'plain slot'],
  ['04f-curl-drape.svg', 'drape', "draft3's gesture"],
  ['04g-curl-taper.svg', 'taper', 'symmetric flare'],
];

// Tailwind v4 values, read out of node_modules/tailwindcss/theme.css.
const COLORS = [
  ['oklch(0.43 0.062 205)', 'petrol', '#1c5a60 · today’s signal token'],
  ['oklch(0.75 0.183 55.934)', 'orange-400', '#ff8904'],
  ['oklch(0.769 0.188 70.08)', 'amber-500', '#fe9a00'],
  ['oklch(0.646 0.222 41.116)', 'orange-600', '#f54900'],
  ['oklch(0.553 0.195 38.402)', 'orange-700', '#ca3500'],
];

const CONTRAST = [
  ['petrol', '#1c5a60', 7.83, 2.53, 7.51],
  ['orange-400', '#ff8904', 2.38, 8.33, 2.28],
  ['amber-500', '#fe9a00', 2.13, 9.27, 2.05],
  ['orange-600', '#f54900', 3.6, 5.5, 3.45],
  ['orange-700', '#ca3500', 5.22, 3.79, 5.0],
];
const flag = (v, min) =>
  `<span style="color:${v >= min ? '#15803d' : '#b91c1c'};font-weight:600">${v.toFixed(2)}</span>`;

const ladder = [128, 64, 32, 16];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root{--fg:oklch(0.145 0 0);--muted:#6b7280;--rule:#e5e7eb}
  *{box-sizing:border-box}
  body{margin:0;padding:40px;background:#fff;color:var(--fg);width:1400px;
       font:13px/1.5 ui-sans-serif,-apple-system,"Helvetica Neue",sans-serif}
  h1{font-size:20px;margin:0 0 4px}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
     margin:44px 0 16px;border-top:1px solid var(--rule);padding-top:12px}
  .sub{color:var(--muted);margin:0 0 14px;max-width:70ch}
  .row{display:flex;gap:28px;align-items:flex-end}
  figure{margin:0;text-align:center}
  figcaption{font-size:12px;color:var(--muted);margin-top:8px}
  .box{background:#fafafa;border:1px solid var(--rule);border-radius:10px;padding:18px}
  .dark{background:oklch(0.145 0 0);border-radius:10px;padding:22px 26px;color:oklch(0.985 0 0)}
  .dark figcaption{color:#9ca3af}
  table{border-collapse:collapse;font-size:12.5px}
  th,td{padding:7px 14px;text-align:right;border-bottom:1px solid var(--rule)}
  th:first-child,td:first-child{text-align:left}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:500}
  .sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;margin-right:7px}
</style></head><body>

<h1>Two questions: the curl, and the colour</h1>

<h2>1 · does the ribbon top want a curl?</h2>
<p class="sub">All three carry 04b's letterform and the same orange-400 ribbon, so only the top of the ribbon differs. draft3's curl is rebuilt here as part of the knockout — as authored it is a white rect with a dark circle over it, which hard-codes a light background.</p>
<div class="row">
${CURLS.map(([f, n, d]) => `  <figure><div class="box">${inline(f, 240)}</div><figcaption><b>${n}</b><br>${d}</figcaption></figure>`).join('\n')}
</div>
<div class="row" style="margin-top:26px">
${CURLS.map(([f, n]) => `  <figure>${ladder.map((h) => `<span style="display:inline-block;margin:0 12px;vertical-align:bottom">${inline(f, h)}</span>`).join('')}<figcaption><b>${n}</b> — 128 / 64 / 32 / 16</figcaption></figure>`).join('\n')}
</div>

<h2>2 · the ribbon colour</h2>
<p class="sub">04e's geometry throughout; only the ribbon fill changes. The top row is the light theme (mark is near-black); the bottom is the dark theme, where <code>currentColor</code> flips the B to near-white and the fixed ribbon colour does not move.</p>
<div class="row">
${COLORS.map(([c, n, d]) => `  <figure><div class="box">${inline('04e-counters-accent.svg', 190, c)}</div><figcaption><b>${n}</b><br>${d}</figcaption></figure>`).join('\n')}
</div>
<div class="row dark" style="margin-top:22px">
${COLORS.map(([c, n]) => `  <figure>${inline('04e-counters-accent.svg', 190, c)}<figcaption><b>${n}</b></figcaption></figure>`).join('\n')}
</div>
<div class="row" style="margin-top:22px">
${COLORS.map(([c, n]) => `  <figure>${[64, 32, 16].map((h) => `<span style="display:inline-block;margin:0 10px;vertical-align:bottom">${inline('04e-counters-accent.svg', h, c)}</span>`).join('')}<figcaption><b>${n}</b> — 64 / 32 / 16</figcaption></figure>`).join('\n')}
</div>

<h2>3 · can it be the app accent too?</h2>
<p class="sub">WCAG contrast. The accent in <code>globals.css</code> is spent on prose links, feature marks and the featured plan — all of it text on white, which needs 4.5. The ribbon is a large shape and needs no minimum, but it does need to be told apart from the B it sits inside, in both themes.</p>
<table>
  <tr><th>colour</th><th>vs white<br><span style="font-weight:400">(link text — needs 4.5)</span></th><th>vs B, light theme<br><span style="font-weight:400">(ribbon legibility)</span></th><th>vs B, dark theme<br><span style="font-weight:400">(ribbon legibility)</span></th></tr>
${CONTRAST.map(([n, hex, w, l, d]) => `  <tr><td><span class="sw" style="background:${hex}"></span>${n} <span style="color:#9ca3af">${hex}</span></td><td>${flag(w, 4.5)}</td><td>${flag(l, 3)}</td><td>${flag(d, 3)}</td></tr>`).join('\n')}
</table>

</body></html>`;

fs.writeFileSync(path.join(DIR, 'compare-05.html'), html);
console.log('wrote compare-05.html');
