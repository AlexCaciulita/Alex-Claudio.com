// Builds the Work page of the design study into the-day/work/index.html.
// Shares the homepage's styles and its handwriting engine, so both pages stay in step.
const fs = require('fs');
const path = require('path');

const lab = __dirname;
const outFile = process.argv[2];
const read = (f) => fs.readFileSync(path.join(lab, f), 'utf8');

const fonts = JSON.parse(read('fonts.json'));
const homeJs = read('the-day.js');
const html = read('work.html');
const css = read('the-day.css') + '\n' + read('work.css');
let js = read('work.js');
const portfolio = read('portfolio-source.html');

function parse(d) {
  const subs = [];
  const re = /([ML])\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g;
  let m, cur = null;
  while ((m = re.exec(d))) {
    const x = Math.round(parseFloat(m[2]));
    const y = Math.round(parseFloat(m[3]));
    if (m[1] === 'M') { cur = [x, y]; subs.push(cur); } else if (cur) cur.push(x, y);
  }
  return subs.filter((s) => s.length >= 4);
}
function pack(font, chars) {
  const g = {};
  for (const ch of chars) {
    const gl = font.glyphs[ch];
    if (!gl || ch === ' ') continue;
    g[ch] = [Math.round(gl.a), ...parse(gl.d)];
  }
  return { asc: font.ascent, desc: font.descent, space: font.glyphs[' '] ? Math.round(font.glyphs[' '].a) : 300, g };
}
let ascii = '';
for (let c = 33; c < 127; c++) ascii += String.fromCharCode(c);
const glyphs = JSON.stringify({ society: pack(fonts.EMSSociety, 'Alex Claudio&'), felix: pack(fonts.EMSFelix, ascii) });

// The handwriting engine, word reveals and scroll watcher, taken verbatim from the homepage.
const a = homeJs.indexOf('/* ---------- Ink: strokes that draw themselves ---------- */');
const b = homeJs.indexOf("  $$('[data-split]').forEach(split);");
if (a < 0 || b < 0 || b <= a) throw new Error('engine markers not found in the-day.js');
const ink = homeJs.slice(a, b);

// The 64 portfolio photographs, in the live portfolio's order.
const ORIGIN = 'https://alex-claudio.com';
const work = [];
const figRe = /<figure class="portfolio-photo[^>]*><a href="([^"]+)"[^>]*><img src="([^"]+)" alt="([^"]*)" width="(\d+)" height="(\d+)" srcset="([^"]+)"/g;
let m;
while ((m = figRe.exec(portfolio))) {
  const [, href, src, alt, w, h, srcset] = m;
  const n = (src.match(/portfolio-(\d+)-/) || [])[1];
  const sizes = srcset.split(',').map((s) => s.trim().split(/\s+/)).map(([u, wd]) => ({ u: ORIGIN + u, w: parseInt(wd, 10) })).sort((x, y) => x.w - y.w);
  const pick = (max) => (sizes.filter((s) => s.w <= max).pop() || sizes[0]).u;
  work.push({
    n, alt, w: +w, h: +h,
    cat: /engagement/i.test(href) ? 'engagement' : 'wedding',
    bw: /black[- ]and[- ]white/i.test(alt),
    srcset: sizes.map((s) => s.u + ' ' + s.w + 'w').join(', '),
    mid: pick(800),
    loupe: pick(1200),
    full: sizes[sizes.length - 1].u
  });
}
if (work.length !== 64) throw new Error('expected 64 photographs, found ' + work.length);

const need = (s, token) => { if (!s.includes(token)) throw new Error('missing ' + token); };
need(js, '/*__INK__*/');
need(js, '/*__GLYPHS__*/null');
need(js, '/*__WORK__*/null');
need(html, '/*__CSS__*/');
need(html, '/*__JS__*/');
need(html, '<!--__NOSCRIPT__-->');
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const fallback = '<ul class="noscript-work">' + work.map((x) => '<li><a href="' + x.full + '"><img src="' + x.mid + '" alt="' + attr(x.alt) + '" width="' + x.w + '" height="' + x.h + '" loading="lazy"></a></li>').join('') + '</ul>';
js = js.replace('/*__INK__*/', () => ink).replace('/*__GLYPHS__*/null', () => glyphs).replace('/*__WORK__*/null', () => JSON.stringify(work));
const out = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js).replace('<!--__NOSCRIPT__-->', () => fallback);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out);
const counts = work.reduce((c, x) => { c[x.cat]++; if (x.bw) c.bw++; return c; }, { wedding: 0, engagement: 0, bw: 0 });
console.log('wrote ' + outFile + ' (' + (out.length / 1024).toFixed(1) + ' KB) photographs: ' + work.length + ' ' + JSON.stringify(counts));
