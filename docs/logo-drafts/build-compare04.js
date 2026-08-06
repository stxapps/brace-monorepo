// Builds compare-04.html — the ribbon studies side by side.
//   node build-compare04.js
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const H = 640 / 557; // the tight-cropped aspect the 04 studies share

const ITEMS = [
  ['04-draft2.svg', 'draft2', 'yours — ribbon shortened'],
  ['04a-ribbon-proportioned.svg', '04a', 'ribbon re-proportioned 1:2.3'],
  ['04b-ribbon-counters.svg', '04b', 'ribbon as counter + lower counter'],
  ['04c-ribbon-pages.svg', '04c', 'ribbon + page edges (mono)'],
  ['04d-ribbon-accent.svg', '04d', 'petrol ribbon — two colours'],
  ['04e-counters-accent.svg', '04e', '04b geometry + petrol ribbon'],
];

function inline(file, h) {
  let s = fs.readFileSync(path.join(DIR, file), 'utf8');
  s = s.replace(/<!--[\s\S]*?-->/g, '').trim();
  // draft2 ships a white backing rect and its own square canvas; drop the rect
  // and crop to the same tight box as the studies so the sizes are comparable.
  s = s.replace(/<rect[^>]*fill="white"[^>]*\/>/, '');
  s = s.replace(/viewBox="0 0 720 720"/, 'viewBox="95 40 557 640"');
  s = s.replace(/width="720"\s+height="720"/, '');
  return s.replace('<svg', `<svg width="${Math.round(h / H)}" height="${h}"`);
}

const ladder = [128, 64, 32, 16];
const row = (h) => ITEMS.map(([f]) => `<td>${inline(f, h)}</td>`).join('');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { --fg: oklch(0.145 0 0); --muted:#6b7280; --rule:#e5e7eb; }
  *{box-sizing:border-box}
  body{margin:0;padding:40px;background:#fff;color:var(--fg);width:1560px;
       font:13px/1.5 ui-sans-serif,-apple-system,"Helvetica Neue",sans-serif}
  h1{font-size:20px;margin:0 0 4px;letter-spacing:-.01em}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
     margin:44px 0 16px;border-top:1px solid var(--rule);padding-top:12px}
  .sub{color:var(--muted);margin:0 0 8px}
  .hero{display:flex;gap:24px}
  .hero>div{flex:1;text-align:center}
  .hero .box{background:#fafafa;border:1px solid var(--rule);border-radius:10px;padding:20px;
             height:250px;display:flex;align-items:center;justify-content:center}
  .name{font-weight:600;margin-top:10px}
  .note{color:var(--muted);font-size:12px}
  table{border-collapse:collapse;width:100%}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
     font-weight:500;padding-bottom:10px}
  th.l,td.l{text-align:left;width:110px}
  td{text-align:center;padding:14px 0;border-top:1px solid var(--rule);vertical-align:middle}
  td.l{font-weight:600}
  .dark{background:oklch(0.145 0 0);color:oklch(0.985 0 0);border-radius:10px;padding:20px 24px}
  .dark th{color:#9ca3af} .dark td{border-top:1px solid #262626}
  .pixrow{display:flex;gap:24px}
  .pixrow figure{margin:0;text-align:center}
  .pixrow canvas{image-rendering:pixelated;border:1px solid var(--rule);border-radius:6px}
  .pixrow canvas+canvas{margin-top:8px}
  figcaption{font-size:12px;color:var(--muted);margin-top:8px}
</style></head><body>

<h1>Ribbon studies — all on draft2's B</h1>
<p class="sub">The outline is draft2's, byte for byte, in every one of these except 04b (which adds counters, and says so). Cropped tight to the ink.</p>

<h2>512 px</h2>
<div class="hero">
${ITEMS.map(
  ([f, n, d]) =>
    `  <div><div class="box">${inline(f, 200)}</div><div class="name">${n}</div><div class="note">${d}</div></div>`,
).join('\n')}
</div>

<h2>The size ladder</h2>
<table>
  <tr><th class="l"></th>${ITEMS.map(([, n]) => `<th>${n}</th>`).join('')}</tr>
${ladder.map((h) => `  <tr><td class="l">${h}px</td>${row(h)}</tr>`).join('\n')}
</table>

<h2>Dark surface</h2>
<div class="dark"><table>
  <tr><th class="l"></th>${ITEMS.map(([, n]) => `<th>${n}</th>`).join('')}</tr>
${[64, 32, 16].map((h) => `  <tr><td class="l">${h}px</td>${row(h)}</tr>`).join('\n')}
</table></div>

<h2>16 px, magnified 12× — the actual pixels</h2>
<div class="pixrow" id="pix"></div>

<script>
const MARKS = ${JSON.stringify(ITEMS.map(([f, n]) => ({ label: n, svg: inline(f, 16) })))};
const SCALE = 12, N = 16;
const host = document.getElementById('pix');
MARKS.forEach((m) => {
  const fig = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = m.label;
  [['#0a0a0a', '#ffffff'], ['#fafafa', '#0a0a0a']].forEach(([fg, bg]) => {
    const c = document.createElement('canvas');
    c.width = c.height = N * SCALE;
    const ctx = c.getContext('2d');
    const off = document.createElement('canvas');
    off.width = off.height = N;
    const octx = off.getContext('2d');
    const img = new Image();
    img.onload = () => {
      octx.clearRect(0, 0, N, N);
      octx.drawImage(img, (N - img.width) / 2, (N - img.height) / 2, img.width, img.height);
      ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, N, N, 0, 0, c.width, c.height);
    };
    img.width = Math.round(16 * 557 / 640); img.height = 16;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(m.svg.replace(/currentColor/g, fg));
    fig.appendChild(c);
  });
  fig.appendChild(cap);
  host.appendChild(fig);
});
</script>
</body></html>`;

fs.writeFileSync(path.join(DIR, 'compare-04.html'), html);
console.log('wrote compare-04.html');
