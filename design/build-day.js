// Builds the design study into one standalone HTML file: structure + styles + motion + glyph data.
const fs = require('fs');
const path = require('path');

const lab = __dirname;
const fonts = JSON.parse(fs.readFileSync(path.join(lab, 'fonts.json'), 'utf8'));
const html = fs.readFileSync(path.join(lab, 'the-day.html'), 'utf8');
const css = fs.readFileSync(path.join(lab, 'the-day.css'), 'utf8');
const js = fs.readFileSync(path.join(lab, 'the-day.js'), 'utf8');
const outFile = process.argv[2];

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
  const space = font.glyphs[' '] ? Math.round(font.glyphs[' '].a) : 300;
  return { asc: font.ascent, desc: font.descent, space, g };
}

let ascii = '';
for (let c = 33; c < 127; c++) ascii += String.fromCharCode(c);

const glyphs = JSON.stringify({
  society: pack(fonts.EMSSociety, 'Alex Claudio&'),
  felix: pack(fonts.EMSFelix, ascii)
});

const need = (s, token) => { if (!s.includes(token)) throw new Error('missing ' + token); };
need(html, '/*__CSS__*/');
need(html, '/*__JS__*/');
need(js, '/*__GLYPHS__*/null');

// Replacer functions, so "$" in the code is never read as a replacement pattern.
const script = js.replace('/*__GLYPHS__*/null', () => glyphs);
const out = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => script);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out);
console.log('wrote ' + outFile + ' (' + (out.length / 1024).toFixed(1) + ' KB, glyph data ' + (glyphs.length / 1024).toFixed(1) + ' KB)');
