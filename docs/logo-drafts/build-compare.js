const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.svg')).sort();

const LABELS = {
  '01-baseline-dogear.svg': ['01 · baseline', 'shipping today — dog-eared B'],
  '02-dogear-fold.svg': ['02 · dog-ear, deepened', 'cut 11→13, parallel chamfer'],
  '03-ribbon-knockout.svg': ['03 · ribbon knockout', "draft1's idea, repaired"],
  '04-draft1-traced.svg': ['04 · draft1', 'traced from your PNG'],
  '05-brace-spine.svg': ['05 · brace spine', '{ + B — argues from the name'],
};

// strip the XML comment and the outer width/height so CSS can size it
function inline(file, size) {
  let s = fs.readFileSync(path.join(DIR, file), 'utf8');
  s = s.replace(/<!--[\s\S]*?-->/g, '').trim();
  s = s.replace(/width="38"\s+height="44"/, `width="${(size * 38) / 44}" height="${size}"`);
  return s;
}

const marks = files.map((f) => ({ file: f, label: LABELS[f] || [f, ''] }));

const ladder = [128, 64, 32, 16];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { --fg: oklch(0.145 0 0); --bg: #fff; --muted: #6b7280; --rule: #e5e7eb; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px; background: var(--bg); color: var(--fg);
         font: 13px/1.5 ui-sans-serif, -apple-system, "Helvetica Neue", sans-serif; width: 1280px; }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted);
       margin: 44px 0 16px; border-top: 1px solid var(--rule); padding-top: 12px; }
  .sub { color: var(--muted); margin: 0 0 8px; }
  .hero { display: flex; gap: 28px; }
  .hero > div { flex: 1; text-align: center; }
  .hero .box { background: #fafafa; border: 1px solid var(--rule); border-radius: 10px;
               padding: 24px 8px; display: flex; align-items: center; justify-content: center; height: 230px; }
  .name { font-weight: 600; margin-top: 10px; }
  .note { color: var(--muted); font-size: 12px; }
  table { border-collapse: collapse; width: 100%; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted);
       font-weight: 500; text-align: center; padding-bottom: 10px; }
  th.l, td.l { text-align: left; width: 200px; }
  td { text-align: center; padding: 14px 0; border-top: 1px solid var(--rule); vertical-align: middle; }
  td.l { font-weight: 600; }
  .dark { background: oklch(0.145 0 0); color: oklch(0.985 0 0); border-radius: 10px; padding: 24px 28px; }
  .dark th, .dark .note { color: #9ca3af; }
  .dark td { border-top: 1px solid #262626; }
  .strip16 { display: flex; gap: 40px; align-items: center; padding: 10px 0; }
  .maskable { display: flex; gap: 32px; }
  .maskable figure { margin: 0; text-align: center; }
  .mwrap { position: relative; width: 192px; height: 192px; border: 1px solid var(--rule);
           border-radius: 10px; display: flex; align-items: center; justify-content: center; background: #fafafa; }
  .mwrap::after { content: ""; position: absolute; inset: 10%; border: 2px dashed #dc2626;
                  border-radius: 50%; pointer-events: none; }
  figcaption { font-size: 12px; color: var(--muted); margin-top: 8px; }
  .pixrow { display: flex; gap: 26px; }
  .pixrow figure { margin: 0; text-align: center; }
  .pixrow canvas { image-rendering: pixelated; border: 1px solid var(--rule); border-radius: 6px; }
  .pixrow canvas + canvas { margin-top: 8px; }
</style></head><body>

<h1>Bracemark logo — variant comparison</h1>
<p class="sub">All five on the same 38×44 grid used by <code>bracemark-icon.tsx</code>, so any winner is a drop-in path swap.</p>

<h2>512 px — where you fall in love with a mark</h2>
<div class="hero">
  ${marks
    .map(
      (m) => `<div>
    <div class="box">${inline(m.file, 200)}</div>
    <div class="name">${m.label[0]}</div>
    <div class="note">${m.label[1]}</div>
  </div>`
    )
    .join('\n  ')}
</div>

<h2>The size ladder — where you decide</h2>
<table>
  <tr><th class="l">variant</th>${ladder.map((s) => `<th>${s}px</th>`).join('')}</tr>
  ${marks
    .map(
      (m) =>
        `<tr><td class="l">${m.label[0]}</td>${ladder
          .map((s) => `<td>${inline(m.file, s)}</td>`)
          .join('')}</tr>`
    )
    .join('\n  ')}
</table>

<h2>Dark surface — currentColor inverts, nothing else changes</h2>
<div class="dark">
  <table>
    <tr><th class="l">variant</th>${ladder.map((s) => `<th>${s}px</th>`).join('')}</tr>
    ${marks
      .map(
        (m) =>
          `<tr><td class="l">${m.label[0]}</td>${ladder
            .map((s) => `<td>${inline(m.file, s)}</td>`)
            .join('')}</tr>`
      )
      .join('\n    ')}
  </table>
</div>

<h2>16 px, magnified 10× with smoothing off — the actual pixels</h2>
<p class="sub">Rasterised to a real 16×16 bitmap, then blown up nearest-neighbour. This is what lands in a browser tab.</p>
<div class="pixrow" id="pix"></div>

<h2>Maskable safe zone — Android crops to the dashed circle</h2>
<div class="maskable">
  ${marks
    .map(
      (m) => `<figure>
    <div class="mwrap">${inline(m.file, 176)}</div>
    <figcaption>${m.label[0]} — full bleed</figcaption>
  </figure>`
    )
    .join('\n  ')}
</div>
<div class="maskable" style="margin-top:20px">
  ${marks
    .map(
      (m) => `<figure>
    <div class="mwrap">${inline(m.file, 112)}</div>
    <figcaption>${m.label[0]} — padded to 64%</figcaption>
  </figure>`
    )
    .join('\n  ')}
</div>

<script>
const MARKS = ${JSON.stringify(
  marks.map((m) => ({ label: m.label[0], svg: inline(m.file, 16) }))
)};
const SCALE = 10, N = 16;
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
    const src = m.svg.replace(/currentColor/g, fg);
    img.onload = () => {
      octx.clearRect(0, 0, N, N);
      // centre the 38:44 mark inside a square 16×16 cell
      octx.drawImage(img, (N - img.width) / 2, (N - img.height) / 2, img.width, img.height);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, N, N, 0, 0, c.width, c.height);
    };
    img.width = (16 * 38) / 44;
    img.height = 16;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    fig.appendChild(c);
  });
  fig.appendChild(cap);
  host.appendChild(fig);
});
</script>
</body></html>`;

fs.writeFileSync(process.argv[2], html);

// second page: a bare 16px strip at DSF 1, for nearest-neighbour magnification
const strip = `<!doctype html>
<html><head><meta charset="utf-8"><style>
 body{margin:0;background:#fff;width:400px}
 .row{display:flex;gap:40px;padding:20px 30px;align-items:center}
 .d{background:oklch(0.145 0 0);color:oklch(0.985 0 0)}
 :root{color:oklch(0.145 0 0)}
</style></head><body>
<div class="row">${marks.map((m) => inline(m.file, 16)).join('')}</div>
<div class="row d">${marks.map((m) => inline(m.file, 16)).join('')}</div>
</body></html>`;
fs.writeFileSync(process.argv[3], strip);
console.log('wrote', process.argv[2], process.argv[3]);
