// Builds the tab icon from the signature's handwritten "A" (EMS Society).
const fs = require('fs');
const path = require('path');

const font = require('./fonts.json').EMSSociety;
const A = font.glyphs.A;

const subpaths = A.d.trim().split(/(?=M)/).map((s) => {
  const nums = s.replace(/[ML]/g, ' ').trim().split(/\s+/).map(Number);
  const pts = [];
  for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], -nums[i + 1]]);
  return pts;
});

const xs = subpaths.flat().map((p) => p[0]);
const ys = subpaths.flat().map((p) => p[1]);
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const side = Math.max(maxX - minX, maxY - minY) + 230;
const ox = (minX + maxX) / 2 - side / 2;
const oy = (minY + maxY) / 2 - side / 2;
const f = (n) => Math.round(n);

// Catmull-Rom through the glyph's points, as cubic Beziers.
const smooth = (pts) => {
  let d = 'M' + f(pts[0][0] - ox) + ' ' + f(pts[0][1] - oy);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += 'C' + [c1, c2, p2].map((p) => f(p[0] - ox) + ' ' + f(p[1] - oy)).join(' ');
  }
  return d;
};

const S = f(side);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">` +
  `<rect width="${S}" height="${S}" rx="${f(S * 0.22)}" fill="#f2ede4"/>` +
  `<path d="${subpaths.map(smooth).join('')}" fill="none" stroke="#171412" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</svg>`;

const uri = 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%22/g, "'");
fs.writeFileSync(path.join(__dirname, 'favicon.svg'), svg);
fs.writeFileSync(path.join(__dirname, 'favicon-uri.txt'), uri);
console.log('svg', svg.length, 'bytes; data uri', uri.length, 'chars');
