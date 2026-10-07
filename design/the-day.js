(() => {
  'use strict';

  const GLYPHS = /*__GLYPHS__*/null;
  const doc = document.documentElement;
  const body = document.body;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const mqNarrow = matchMedia('(max-width: 900px)');
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const r1 = (n) => Math.round(n * 10) / 10;

  let lite = reduce || mqNarrow.matches;
  doc.classList.toggle('lite', lite);
  doc.classList.toggle('reduce', reduce);
  if (fine) doc.classList.add('fine');

  /* ---------- Ink: strokes that draw themselves ---------- */

  // Catmull-Rom through the font's polyline, keeping sharp turns as corners.
  function smooth(f) {
    const n = f.length / 2;
    let d = 'M' + f[0] + ' ' + f[1];
    if (n < 3) {
      for (let i = 1; i < n; i++) d += 'L' + f[2 * i] + ' ' + f[2 * i + 1];
      return d;
    }
    const corner = new Array(n).fill(false);
    corner[0] = corner[n - 1] = true;
    for (let i = 1; i < n - 1; i++) {
      const ax = f[2 * i] - f[2 * i - 2], ay = f[2 * i + 1] - f[2 * i - 1];
      const bx = f[2 * i + 2] - f[2 * i], by = f[2 * i + 3] - f[2 * i + 1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la && lb && Math.acos(clamp((ax * bx + ay * by) / (la * lb), -1, 1)) > 1.22) corner[i] = true;
    }
    const P = (i) => [f[2 * i], f[2 * i + 1]];
    for (let i = 0; i < n - 1; i++) {
      const p1 = P(i), p2 = P(i + 1);
      const p0 = corner[i] ? p1 : P(i - 1);
      const p3 = corner[i + 1] ? p2 : P(i + 2);
      d += 'C' + r1(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + r1(p1[1] + (p2[1] - p0[1]) / 6) + ' ' +
        r1(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + r1(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + p2[0] + ' ' + p2[1];
    }
    return d;
  }

  function polyLen(f) {
    let L = 0;
    for (let i = 2; i < f.length; i += 2) L += Math.hypot(f[i] - f[i - 2], f[i + 1] - f[i - 1]);
    return L;
  }

  const glyphCache = new Map();
  function layout(fontKey, text) {
    const font = GLYPHS[fontKey];
    let x = 0;
    const strokes = [];
    for (const ch of text) {
      const g = font.g[ch];
      if (!g) { x += font.space; continue; }
      for (let i = 1; i < g.length; i++) {
        const key = fontKey + ch + i;
        let c = glyphCache.get(key);
        if (!c) { c = { d: smooth(g[i]), len: polyLen(g[i]) }; glyphCache.set(key, c); }
        strokes.push({ d: c.d, len: c.len, x });
      }
      x += g[0];
    }
    return { width: x, strokes, asc: font.asc, desc: font.desc };
  }

  // A nib turns one centre line into the thick-thin line of a broad pen:
  // the same stroke is drawn several times, offset along the nib's angle.
  function inkSvg(strokes, o) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', o.viewBox);
    svg.setAttribute('width', typeof o.width === 'number' ? r1(o.width) : o.width);
    svg.setAttribute('height', typeof o.height === 'number' ? r1(o.height) : o.height);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('pen');
    const root = document.createElementNS(NS, 'g');
    if (o.flip) root.setAttribute('transform', 'scale(1 -1)');
    root.setAttribute('fill', 'none');
    root.setAttribute('stroke', o.color || 'currentColor');
    root.setAttribute('stroke-linecap', 'round');
    root.setAttribute('stroke-linejoin', 'round');
    root.setAttribute('stroke-width', String(Math.round(o.sw * 100) / 100));
    svg.appendChild(root);
    const copies = o.nib ? o.nib.n : 1;
    const items = strokes.map((s) => ({ len: s.len, paths: [] }));
    for (let c = 0; c < copies; c++) {
      const g = document.createElementNS(NS, 'g');
      if (copies > 1) {
        const t = c / (copies - 1) - 0.5;
        const a = (o.nib.angle * Math.PI) / 180;
        g.setAttribute('transform', 'translate(' + r1(Math.cos(a) * o.nib.w * t) + ' ' + r1(Math.sin(a) * o.nib.w * t) + ')');
      }
      strokes.forEach((s, i) => {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', s.d);
        p.setAttribute('pathLength', '1000');
        if (s.x) p.setAttribute('transform', 'translate(' + r1(s.x) + ' 0)');
        g.appendChild(p);
        items[i].paths.push(p);
      });
      root.appendChild(g);
    }
    return { svg, items };
  }

  function controller(svg, items) {
    let anims = [];
    const api = {
      svg,
      drawn: false,
      play({ duration = 1400, delay = 0, lift = 50, easing = 'cubic-bezier(.45,.05,.55,.95)' } = {}) {
        api.stop();
        svg.classList.remove('drawn');
        api.drawn = true;
        if (reduce) { api.show(); return Promise.resolve(); }
        const total = items.reduce((a, it) => a + it.len, 0) || 1;
        const drawTime = Math.max(duration * 0.5, duration - lift * (items.length - 1));
        let t = delay;
        for (const it of items) {
          const d = Math.max(30, (drawTime * it.len) / total);
          for (const p of it.paths) {
            anims.push(p.animate([
              { strokeDashoffset: 1000, opacity: 0 },
              { strokeDashoffset: 998, opacity: 1, offset: 0.004 },
              { strokeDashoffset: 0, opacity: 1 }
            ], { duration: d, delay: t, easing, fill: 'both' }));
          }
          t += d + lift;
        }
        const mine = anims;
        return Promise.all(mine.map((a) => a.finished)).then(() => { if (anims === mine) api.show(); }, () => {});
      },
      show() {
        svg.classList.add('drawn');
        api.drawn = true;
        const a = anims;
        anims = [];
        a.forEach((x) => x.cancel());
      },
      hide() { api.stop(); svg.classList.remove('drawn'); api.drawn = false; },
      stop() { const a = anims; anims = []; a.forEach((x) => x.cancel()); }
    };
    return api;
  }

  function pen(host, text, o = {}) {
    const em = o.em || 28;
    const k = em / 1000;
    const lay = layout(o.font || 'felix', text);
    const padX = o.padX ?? 60;
    const top = o.top ?? lay.asc + 160;
    const bottom = o.bottom ?? -lay.desc + 120;
    const W = lay.width + padX * 2, H = top + bottom;
    const { svg, items } = inkSvg(lay.strokes, {
      viewBox: -padX + ' ' + -top + ' ' + r1(W) + ' ' + H,
      width: W * k,
      height: H * k,
      flip: true,
      sw: (o.sw || 1.3) / k,
      color: o.color,
      nib: o.nib ? { n: o.nib.n, w: o.nib.w / k, angle: o.nib.angle } : null
    });
    if (o.label) {
      svg.removeAttribute('aria-hidden');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', o.label);
    }
    host.appendChild(svg);
    return controller(svg, items);
  }

  function scribble(host, ds, o) {
    const { svg, items } = inkSvg(ds.map((d) => ({ d, len: 1 })), {
      viewBox: o.viewBox, width: o.width, height: o.height, sw: o.sw || 2, color: o.color, nib: o.nib || null
    });
    if (o.className) svg.classList.add(...o.className.split(' '));
    host.appendChild(svg);
    items.forEach((it) => {
      try { it.len = it.paths[0].getTotalLength() || 1; } catch (e) { it.len = 1; }
    });
    return controller(svg, items);
  }

  function rand(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A loose pencil loop: a little more than one turn, slightly spiralling outwards.
  function loop(cx, cy, rx, ry, seed = 1, turns = 1.12) {
    const rnd = rand(seed);
    const start = -2.4 + rnd() * 0.6;
    const N = 64;
    let d = '';
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = start + t * turns * Math.PI * 2;
      const w = 1 + Math.sin(t * Math.PI * 3 + seed) * 0.022 + t * 0.065;
      d += (i ? 'L' : 'M') + r1(cx + Math.cos(a) * rx * w) + ' ' + r1(cy + Math.sin(a) * ry * w * (1 - t * 0.03));
    }
    return d;
  }

  function wobble(w, y, seed) {
    const rnd = rand(seed);
    return 'M1 ' + r1(y + 0.8) + ' C' + r1(w * 0.28) + ' ' + r1(y - 1.4 - rnd()) + ' ' + r1(w * 0.6) + ' ' + r1(y + 1.6 + rnd()) + ' ' + r1(w - 1) + ' ' + r1(y - 0.6);
  }

  function fmt(m) {
    m = Math.round(m) % 1440;
    let h = Math.floor(m / 60);
    const mm = m % 60;
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return h + ':' + String(mm).padStart(2, '0') + ' ' + ap;
  }

  function fmtRange(s, e) {
    const a = fmt(s);
    const b = e >= 1440 ? 'midnight' : fmt(e);
    if (b !== 'midnight' && a.slice(-2) === b.slice(-2)) return a.slice(0, -3) + ' to ' + b;
    return a + ' to ' + b;
  }

  function listJoin(a) {
    if (a.length < 2) return a.join('');
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }

  /* ---------- Words that rise ---------- */

  function split(el) {
    let i = 0;
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span');
            w.className = 'w';
            const inner = document.createElement('span');
            inner.textContent = part;
            inner.style.setProperty('--i', i++);
            w.appendChild(inner);
            frag.appendChild(w);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && child.tagName !== 'BR') {
          walk(child);
        }
      });
    };
    walk(el);
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      en.target.classList.add('in');
      if (en.target._onIn) en.target._onIn();
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });

  function watch(el, cb) {
    if (!el) return;
    if (cb) el._onIn = cb;
    io.observe(el);
  }

  $$('[data-split]').forEach(split);
  const prologueEl = $('.prologue');
  $$('[data-split], [data-rise], [data-develop]').forEach((el) => {
    if (!prologueEl.contains(el)) watch(el, el._onIn);
  });

  /* ---------- Hand-drawn underlines and the nav oval ---------- */

  function underline(a, always) {
    const old = a.querySelector(':scope > .ul');
    const wasDrawn = old && old.classList.contains('drawn');
    if (old) old.remove();
    const w = a.offsetWidth;
    if (!w) return null;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ul' + (always ? ' always' : '') + (wasDrawn ? ' drawn' : ''));
    svg.setAttribute('width', w);
    svg.setAttribute('height', 10);
    svg.setAttribute('viewBox', '0 0 ' + w + ' 10');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', wobble(w, 5, w));
    p.setAttribute('pathLength', '1000');
    svg.appendChild(p);
    a.appendChild(svg);
    return svg;
  }
  const drawUnderlines = () => $$('[data-ul]').forEach((a) => underline(a, a.hasAttribute('data-ul-always')));
  drawUnderlines();

  let navOval = null;
  function drawNavOval(play) {
    const a = $('#navWrite');
    if (navOval) navOval.svg.remove();
    const w = a.offsetWidth + 32, h = a.offsetHeight + 16;
    if (w < 40) return;
    navOval = scribble(a, [loop(w / 2, h / 2, w / 2 - 4, h / 2 - 3, 7, 1.08)], { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, sw: 1.3, className: 'oval' });
    if (play) navOval.play({ duration: 900 });
  }
  $('#navWrite').addEventListener('pointerenter', () => { if (navOval) navOval.play({ duration: 700 }); });

  const see = $('.see');
  let seeLine = null;
  function drawSee() {
    const wasDrawn = seeLine && seeLine.drawn;
    if (seeLine) seeLine.svg.remove();
    const w = see.offsetWidth * 1.14, h = 28;
    seeLine = scribble(see, [
      'M4 ' + r1(h * 0.58) + ' C' + r1(w * 0.3) + ' ' + r1(h * 0.26) + ' ' + r1(w * 0.64) + ' ' + r1(h * 0.5) + ' ' + r1(w - 4) + ' ' + r1(h * 0.34),
      'M' + r1(w * 0.14) + ' ' + r1(h * 0.88) + ' C' + r1(w * 0.42) + ' ' + r1(h * 0.66) + ' ' + r1(w * 0.7) + ' ' + r1(h * 0.76) + ' ' + r1(w * 0.92) + ' ' + r1(h * 0.66)
    ], { viewBox: '0 0 ' + r1(w) + ' ' + h, width: w, height: h, sw: 2.4, className: 'uline' });
    if (wasDrawn) seeLine.show();
  }
  drawSee();

  /* ---------- The signature ---------- */

  const SIG = 'Alex Claudio';
  function sigOpts(em, label) {
    return {
      font: 'society', em,
      nib: { n: em > 60 ? 11 : 7, w: em * 0.036, angle: 35 },
      sw: Math.max(0.55, em * 0.0072),
      padX: 40, top: 980, bottom: 330,
      label
    };
  }
  const markHost = $('#mark');
  const navSig = pen(markHost, SIG, sigOpts(innerWidth < 600 ? 26 : 32));

  /* ---------- Prologue: the plate and its slideshow ---------- */

  const plate = $('#plate');
  const spreadEl = $('.spread');
  const metaEl = $('.plate-meta');
  const slideEls = $$('.slide').map((el) => ({ el, f: (el.dataset.focus || '0.5 0.5').split(' ').map(Number) }));
  slideEls.forEach((s) => s.el.classList.remove('on'));

  const slideshow = (() => {
    const noteBox = $('#plateNote');
    const counter = $('#plateCount');
    const bar = $('#plateBar');
    const pauseBtn = $('#platePause');
    const DUR = 6400;
    let i = 0, paused = reduce, started = false, barAnim = null;
    const notes = slideEls.map((s) => {
      const host = document.createElement('div');
      host.className = 'gone';
      noteBox.appendChild(host);
      return { host, n: pen(host, s.el.dataset.note, { font: 'felix', em: innerWidth < 600 ? 22 : 27, sw: 1.25 }) };
    });
    if (reduce) pauseBtn.textContent = 'Play';
    function go(n) {
      slideEls[i].el.classList.remove('on');
      notes[i].host.classList.add('gone');
      i = (n + slideEls.length) % slideEls.length;
      slideEls[i].el.classList.add('on');
      notes[i].host.classList.remove('gone');
      notes[i].n.play({ duration: 1200, delay: 500 });
      counter.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(slideEls.length).padStart(2, '0');
      if (barAnim) barAnim.cancel();
      const me = (barAnim = bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: DUR, fill: 'forwards' }));
      if (paused) me.pause();
      me.finished.then(() => { if (barAnim === me) go(i + 1); }, () => {});
    }
    $('#platePrev').addEventListener('click', () => started && go(i - 1));
    $('#plateNext').addEventListener('click', () => started && go(i + 1));
    pauseBtn.addEventListener('click', () => {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Play' : 'Pause';
      pauseBtn.setAttribute('aria-pressed', String(paused));
      if (barAnim) (paused ? barAnim.pause() : barAnim.play());
    });
    return {
      start(delay) {
        if (started) return;
        started = true;
        setTimeout(() => go(0), delay);
      }
    };
  })();

  function prologue(y) {
    const s = M.prologue;
    if (!s) return;
    const W = plate.clientWidth, H = plate.clientHeight;
    const p = clamp((y - s.top) / Math.max(1, s.height - innerHeight));
    const e = easeIO(clamp((p - 0.05) / 0.7));
    const t = lerp(0.13 * H, 0, e), r = lerp(0.05 * W, 0, e), b = lerp(0.12 * H, 0, e), l = lerp(0.53 * W, 0, e);
    plate.style.clipPath = 'inset(' + r1(t) + 'px ' + r1(r) + 'px ' + r1(b) + 'px ' + r1(l) + 'px)';
    const cx = (l + W - r) / 2, cy = (t + H - b) / 2;
    for (const sl of slideEls) {
      sl.el.style.setProperty('--tx', r1(clamp(cx - sl.f[0] * W, -r, l)) + 'px');
      sl.el.style.setProperty('--ty', r1(clamp(cy - sl.f[1] * H, -b, t)) + 'px');
    }
    const q = easeOut(clamp(p / 0.42));
    spreadEl.style.opacity = String(r1((1 - q) * 100) / 100);
    spreadEl.style.transform = 'translate3d(' + r1(-q * 7) + 'vw,0,0)';
    spreadEl.style.pointerEvents = q > 0.8 ? 'none' : '';
    metaEl.style.opacity = String(r1((1 - clamp(p / 0.16)) * 100) / 100);
  }

  /* ---------- I. Two cameras ---------- */

  const camA = $('.cam-a'), camB = $('.cam-b');
  function cams(y) {
    const s = M.cams;
    if (!s) return;
    const p = clamp((y + innerHeight - s.top) / (s.height + innerHeight));
    const R = innerHeight * (lite ? 0.1 : 0.22);
    camA.style.transform = 'translate3d(0,' + r1((p - 0.5) * -R) + 'px,0)';
    camB.style.transform = 'translate3d(0,' + r1((p - 0.5) * R) + 'px,0)';
  }

  $$('[data-pen]').forEach((host) => {
    const p = pen(host, host.dataset.pen, { font: 'felix', em: Number(host.dataset.em || 26) * (innerWidth < 600 ? 0.82 : 1), sw: 1.3 });
    watch(host, () => p.play({ duration: 1100, delay: 450 }));
  });

  /* ---------- II. The ceremony, marked up ---------- */

  const cPlate = $('#ceremonyPlate');
  const cMarks = scribble(cPlate, [
    'M1296 200 C1334 304 1262 432 1188 552',
    'M1224 530 L1187 557 L1184 510'
  ], { viewBox: '0 0 1500 1000', width: '100%', height: '100%', sw: 4, className: 'marks' });
  cMarks.svg.style.position = 'absolute';
  cMarks.svg.style.inset = '0';
  const cNote = pen($('#ceremonyNote'), "he's watching too", { font: 'felix', em: clamp(innerWidth * 0.022, 15, 34), sw: 1.7 });
  watch(cPlate, () => {
    cNote.play({ duration: 1300, delay: 900 });
    cMarks.play({ duration: 900, delay: 2300, lift: 140 });
  });

  /* ---------- III. Golden hour, sideways ---------- */

  const goldenEl = $('.golden');
  const track = $('#track');
  const shotEls = $$('.shot', track);
  shotEls.forEach((s) => { s._img = s.querySelector('img'); });
  let gDist = 0;
  function layoutGolden() {
    if (lite) { goldenEl.style.height = ''; track.style.transform = ''; return; }
    gDist = Math.max(0, track.scrollWidth - innerWidth);
    goldenEl.style.height = r1(gDist + innerHeight) + 'px';
    shotEls.forEach((s) => { s._cx = s.offsetLeft + s.offsetWidth / 2; });
  }
  function golden(y) {
    const s = M.golden;
    if (!s) return;
    const p = clamp((y - s.top) / Math.max(1, s.height - innerHeight));
    const x = -p * gDist;
    track.style.transform = 'translate3d(' + r1(x) + 'px,0,0)';
    for (const sh of shotEls) {
      const rel = (sh._cx + x - innerWidth / 2) / innerWidth;
      sh._img.style.setProperty('--px', r1(rel * -50) + 'px');
    }
  }

  /* ---------- IV. Night: the aperture opens ---------- */

  const aperture = $('#aperture');
  const fstop = $('#fstop');
  const STOPS = ['f/22', 'f/16', 'f/11', 'f/8', 'f/5.6', 'f/4', 'f/2.8', 'f/2', 'f/1.4'];
  const nightBox = $('#nightNote');
  const nightEm = clamp(innerWidth * 0.024, 19, 34);
  const nightPens = ['rain, sparklers, umbrellas.', 'nobody went inside.'].map((t) => {
    const host = document.createElement('div');
    nightBox.appendChild(host);
    return pen(host, t, { font: 'felix', em: nightEm, sw: 1.6 });
  });
  let nightShown = false;
  function night(y) {
    const s = M.night;
    if (!s) return;
    const p = clamp((y - s.top) / Math.max(1, s.height - innerHeight));
    const e = easeIO(clamp(p / 0.78));
    const W = innerWidth, H = innerHeight;
    const R = lerp(Math.min(W, H) * 0.05, Math.hypot(W, H) * 0.6, e);
    const rot = (lerp(70, 0, e) * Math.PI) / 180;
    // The aperture opens on the bride's face, then drifts to the centre as it widens.
    const ax = lerp(W * 0.57, W / 2, e), ay = lerp(H * 0.3, H / 2, e);
    let pts = '';
    for (let i = 0; i < 6; i++) {
      const a = rot + (i * Math.PI) / 3;
      pts += (i ? ',' : '') + r1(ax + R * Math.cos(a)) + 'px ' + r1(ay + R * Math.sin(a)) + 'px';
    }
    aperture.style.clipPath = 'polygon(' + pts + ')';
    fstop.textContent = STOPS[Math.min(STOPS.length - 1, Math.floor(e * STOPS.length))];
    if (e > 0.97 && !nightShown) {
      nightShown = true;
      nightPens[0].play({ duration: 1300, delay: 200 });
      nightPens[1].play({ duration: 1100, delay: 1700 });
    } else if (e < 0.4 && nightShown) {
      nightShown = false;
      nightPens.forEach((p) => p.hide());
    }
  }
  if (reduce) watch(nightBox, () => nightPens.forEach((p) => p.show()));

  /* ---------- V. The light table ---------- */

  const table = $('#table');
  let pencil = null, pencilNotes = [], tableDrawn = false;
  function tableMarks() {
    if (pencil) pencil.svg.remove();
    pencilNotes.forEach((n) => n.host.remove());
    pencilNotes = [];
    const W = table.clientWidth, H = table.clientHeight;
    const ds = [], notes = [];
    $$('.mount[data-select]', table).forEach((m, i) => {
      const x = m.offsetLeft, y = m.offsetTop, w = m.offsetWidth, h = m.offsetHeight;
      if (m.dataset.select === 'check') {
        const cx = x + w + 4, cy = y + 10;
        ds.push('M' + r1(cx - 18) + ' ' + r1(cy - 2) + ' L' + r1(cx - 7) + ' ' + r1(cy + 12) + ' L' + r1(cx + 15) + ' ' + r1(cy - 22));
      } else {
        ds.push(loop(x + w / 2, y + h / 2, w / 2 + 14, h / 2 + 12, i + 3));
        notes.push({ text: m.dataset.select, x: x + w + 10, y: y - 14 });
      }
    });
    pencil = scribble(table, ds, { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, sw: 2.6, className: 'pencil' });
    notes.forEach((n) => {
      const host = document.createElement('div');
      host.className = 'pencil-note';
      table.appendChild(host);
      const p = pen(host, n.text, { font: 'felix', em: innerWidth < 600 ? 22 : 30, sw: 2.1 });
      const nw = parseFloat(p.svg.getAttribute('width'));
      const left = n.x + nw > W ? n.x - nw - $$('.mount[data-select]', table)[0].offsetWidth - 30 : n.x;
      host.style.left = r1(Math.max(4, left)) + 'px';
      host.style.top = r1(Math.max(-30, n.y)) + 'px';
      pencilNotes.push({ host, p });
    });
    if (tableDrawn) { pencil.show(); pencilNotes.forEach((n) => n.p.show()); }
  }
  tableMarks();
  watch(table, () => {
    tableDrawn = true;
    pencil.play({ duration: 2600, delay: 500, lift: 520 });
    pencilNotes.forEach((n, i) => n.p.play({ duration: 900, delay: 1500 + i * 1250 }));
    $$('.mount', table).forEach((m) => { const im = new Image(); im.src = m.dataset.full; });
  });

  if (fine) {
    const loupe = $('#loupe');
    const Z = 2.6, R = 110;
    let lx = 0, ly = 0, tx = 0, ty = 0, on = false, raf = 0;
    const follow = () => {
      lx += (tx - lx) * 0.32;
      ly += (ty - ly) * 0.32;
      loupe.style.transform = 'translate3d(' + r1(lx - R) + 'px,' + r1(ly - R) + 'px,0)';
      raf = on || Math.abs(tx - lx) > 0.5 ? requestAnimationFrame(follow) : 0;
    };
    $$('.mount', table).forEach((m) => {
      const img = m.querySelector('img');
      m.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse') return;
        on = true;
        loupe.style.backgroundImage = 'url("' + m.dataset.full + '")';
        loupe.classList.add('on');
        lx = tx = e.clientX;
        ly = ty = e.clientY;
        if (!raf) raf = requestAnimationFrame(follow);
      });
      m.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = img.getBoundingClientRect();
        const rx = clamp((e.clientX - r.left) / r.width), ry = clamp((e.clientY - r.top) / r.height);
        const bw = r.width * Z, bh = r.height * Z;
        loupe.style.backgroundSize = r1(bw) + 'px ' + r1(bh) + 'px';
        loupe.style.backgroundPosition = r1(R - rx * bw) + 'px ' + r1(R - ry * bh) + 'px';
        tx = e.clientX;
        ty = e.clientY;
      });
      m.addEventListener('pointerleave', () => { on = false; loupe.classList.remove('on'); });
    });
  }

  /* ---------- VI. How much of the day ---------- */

  const DAY0 = 660, DAY1 = 1440, SPAN = DAY1 - DAY0;
  const MOMENTS = [
    [780, 'getting dressed', 'getting dressed'],
    [870, 'first look', 'the first look'],
    [960, 'ceremony', 'the ceremony'],
    [1000, 'family photos', 'family photos'],
    [1080, 'dinner and toasts', 'dinner and toasts'],
    [1185, 'golden hour', 'golden hour'],
    [1230, 'first dance', 'the first dance'],
    [1350, 'send-off', 'the send-off']
  ];
  const START = { 6: 840, 8: 780, 10: 765 };
  const HOURS_WORD = { 6: 'six', 8: 'eight', 10: 'ten' };
  let hours = 8, start = START[8], moved = false;
  const dayline = $('#dayline'), win = $('#win'), winLabel = $('#winLabel'), fit = $('#fit');
  const windowNote = $('#windowNote');

  const tickLabel = (m) => (m === 660 ? '11 am' : m === 720 ? 'noon' : m === 780 ? '1 pm' : m === 1440 ? 'midnight' : String((m / 60) % 12 || 12));
  for (let m = DAY0; m <= DAY1; m += 60) {
    const t = document.createElement('span');
    t.className = 'tick';
    t.style.left = ((m - DAY0) / SPAN) * 100 + '%';
    const b = document.createElement('b');
    b.textContent = tickLabel(m);
    t.appendChild(b);
    dayline.insertBefore(t, win);
  }
  const momentEls = MOMENTS.map(([m, name, phrase], i) => {
    const el = document.createElement('div');
    el.className = 'moment ' + (i % 2 ? 'down' : 'up');
    el.style.left = ((m - DAY0) / SPAN) * 100 + '%';
    el.innerHTML = '<span class="dot"></span><span class="ml">' + name + '<small>' + fmt(m) + '</small></span>';
    dayline.appendChild(el);
    return { el, m, phrase };
  });

  function render() {
    const end = start + hours * 60;
    win.style.left = ((start - DAY0) / SPAN) * 100 + '%';
    win.style.width = ((hours * 60) / SPAN) * 100 + '%';
    winLabel.textContent = fmtRange(start, end);
    win.setAttribute('aria-valuemin', DAY0);
    win.setAttribute('aria-valuemax', DAY1 - hours * 60);
    win.setAttribute('aria-valuenow', start);
    win.setAttribute('aria-valuetext', fmtRange(start, end));
    const inside = [], outside = [];
    momentEls.forEach((o) => {
      const isIn = o.m >= start && o.m <= end;
      o.el.classList.toggle('in', isIn);
      o.el.classList.toggle('out', !isIn);
      (isIn ? inside : outside).push(o.phrase);
    });
    fit.textContent = outside.length === 0
      ? 'Everything on this example day fits inside the window.'
      : 'Inside the window: ' + inside.length + ' of ' + MOMENTS.length + ' moments. Outside it: ' + listJoin(outside) + '.';
    windowNote.textContent = 'Your window: ' + HOURS_WORD[hours] + ' hours, ' + fmtRange(start, end) + ". We\u2019ll price your proposal around it.";
  }

  const hourBtns = $$('.hours button');
  const dayScroll = $('.day-scroll');
  function centerWindow(smooth) {
    if (dayScroll.scrollWidth <= dayScroll.clientWidth + 2) return;
    const x = dayline.offsetLeft + ((start - DAY0 + hours * 30) / SPAN) * dayline.offsetWidth;
    dayScroll.scrollTo({ left: Math.max(0, x - dayScroll.clientWidth / 2), behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }
  let hourOval = null;
  function drawHourOval(play) {
    if (hourOval) hourOval.svg.remove();
    const b = hourBtns.find((x) => Number(x.dataset.h) === hours);
    const w = b.offsetWidth + 16, h = b.offsetHeight + 12;
    hourOval = scribble(b, [loop(w / 2, h / 2, w / 2 - 6, h / 2 - 4, hours + 2, 1.1)], { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, sw: 1.5, className: 'oval' });
    if (play) hourOval.play({ duration: 650 }); else if (instrumentSeen) hourOval.show();
  }
  let instrumentSeen = false;
  function setHours(h, user) {
    hours = h;
    if (!moved) start = START[h];
    start = clamp(start, DAY0, DAY1 - h * 60);
    hourBtns.forEach((b) => {
      const on = Number(b.dataset.h) === h;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    drawHourOval(user);
    render();
    if (user) centerWindow(true);
    const sel = $('#fHours');
    if (sel) { sel.value = String(h); sel.dispatchEvent(new Event('change')); }
  }
  hourBtns.forEach((b) => b.addEventListener('click', () => setHours(Number(b.dataset.h), true)));
  $('.hours').addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const order = [6, 8, 10];
    const next = order[(order.indexOf(hours) + dir + 3) % 3];
    setHours(next, true);
    hourBtns.find((x) => Number(x.dataset.h) === next).focus();
  });

  let drag = null;
  win.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, s: start, w: dayline.clientWidth };
    win.setPointerCapture(e.pointerId);
    win.classList.add('dragging');
    e.preventDefault();
  });
  win.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dm = ((e.clientX - drag.x) / drag.w) * SPAN;
    const next = clamp(Math.round((drag.s + dm) / 15) * 15, DAY0, DAY1 - hours * 60);
    if (next !== start) { start = next; moved = true; render(); }
  });
  const endDrag = () => { if (!drag) return; drag = null; win.classList.remove('dragging'); };
  win.addEventListener('pointerup', endDrag);
  win.addEventListener('pointercancel', endDrag);
  win.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -15, ArrowDown: -15, ArrowRight: 15, ArrowUp: 15, PageDown: -60, PageUp: 60 }[e.key];
    if (step) start = clamp(start + step, DAY0, DAY1 - hours * 60);
    else if (e.key === 'Home') start = DAY0;
    else if (e.key === 'End') start = DAY1 - hours * 60;
    else return;
    e.preventDefault();
    moved = true;
    render();
  });
  $('#colAsk').addEventListener('click', () => {
    const sel = $('#fHours');
    sel.value = String(hours);
    sel.dispatchEvent(new Event('change'));
    setTimeout(() => $('#fNames').focus({ preventScroll: true }), 1100);
  });
  setHours(8, false);
  watch($('.instrument'), () => { instrumentSeen = true; drawHourOval(true); centerWindow(false); });

  /* ---------- VII. A stack of notes ---------- */

  const stack = $('#stack');
  const cards = $$('.card', stack);
  let order = cards.map((_, i) => i);
  const ROT = [-1.2, 2.6, -3.4];
  function layoutCards() {
    order.forEach((ci, pos) => {
      const c = cards[ci];
      c.style.zIndex = String(10 - pos);
      c.style.setProperty('--rot', ROT[pos] + 'deg');
      c.style.setProperty('--x', pos * 12 + 'px');
      c.style.setProperty('--y', pos * 14 + 'px');
      c.classList.toggle('top', pos === 0);
      c.setAttribute('aria-hidden', pos === 0 ? 'false' : 'true');
    });
  }
  function toss(dir) {
    const c = cards[order[0]];
    if (c._tossing) return;
    c._tossing = true;
    if (reduce) {
      order.push(order.shift());
      layoutCards();
      c._tossing = false;
      return;
    }
    c.style.transition = 'transform .55s cubic-bezier(.5,0,.75,0)';
    c.style.transform = 'translate3d(' + dir * 120 + '%, -6%, 0) rotate(' + dir * 16 + 'deg)';
    setTimeout(() => {
      order.push(order.shift());
      c.style.transition = 'none';
      c.style.transform = '';
      layoutCards();
      void c.offsetWidth;
      c.style.transition = '';
      c._tossing = false;
    }, 560);
  }
  let cd = null;
  stack.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.card.top');
    if (!c || c._tossing) return;
    cd = { c, x: e.clientX, y: e.clientY, dx: 0 };
    c.setPointerCapture(e.pointerId);
    c.classList.add('dragging');
  });
  stack.addEventListener('pointermove', (e) => {
    if (!cd) return;
    cd.dx = e.clientX - cd.x;
    const dy = (e.clientY - cd.y) * 0.25;
    cd.c.style.transform = 'translate3d(' + r1(cd.dx) + 'px,' + r1(dy) + 'px,0) rotate(' + r1(cd.dx * 0.05 - 1.2) + 'deg)';
  });
  const endCard = () => {
    if (!cd) return;
    const { c, dx } = cd;
    cd = null;
    c.classList.remove('dragging');
    if (Math.abs(dx) > 110) toss(Math.sign(dx));
    else c.style.transform = '';
  };
  stack.addEventListener('pointerup', endCard);
  stack.addEventListener('pointercancel', endCard);
  $('#nextNote').addEventListener('click', () => toss(1));
  layoutCards();
  watch($('#nextNote'), () => { const u = $('#nextNote > .ul'); if (u) setTimeout(() => u.classList.add('drawn'), 600); });

  /* ---------- VIII. Studio portraits lean toward the cursor ---------- */

  if (fine && !reduce) {
    $$('.portraits figure').forEach((f) => {
      f.addEventListener('pointermove', (e) => {
        const r = f.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        f.style.transition = 'transform .25s ease-out';
        f.style.transform = 'rotateY(' + r1(x * 12) + 'deg) rotateX(' + r1(-y * 10) + 'deg)';
      });
      f.addEventListener('pointerleave', () => { f.style.transition = ''; f.style.transform = ''; });
    });
  }

  /* ---------- IX. The letter ---------- */

  const form = $('#letterForm');
  const sizeInput = (el) => { el.style.width = Math.max(el.value.length, el.placeholder.length) + 1.4 + 'ch'; };
  const hoursSel = $('#fHours');
  const sizeSelect = () => { hoursSel.style.width = hoursSel.options[hoursSel.selectedIndex].text.length + 2.4 + 'ch'; };
  hoursSel.addEventListener('change', sizeSelect);
  // Older links carry ?collection=essential|signature|heirloom; those were six, eight and ten hours.
  const legacyHours = { essential: '6', signature: '8', heirloom: '10' }[new URLSearchParams(location.search).get('collection')];
  if (legacyHours) hoursSel.value = legacyHours;
  sizeSelect();
  $$('input', form).forEach((el) => {
    sizeInput(el);
    el.addEventListener('input', () => { sizeInput(el); el.classList.remove('bad'); });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bad = [];
    ['fNames', 'fDate', 'fEmail'].forEach((id) => {
      const el = $('#' + id);
      const v = el.value.trim();
      const ok = id === 'fEmail' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) : v.length > 0;
      el.classList.toggle('bad', !ok);
      if (!ok) bad.push(el);
    });
    const err = $('#formError');
    if (bad.length) {
      err.textContent = 'Your names, the date and an email are all we need to reply.';
      bad[0].focus();
      return;
    }
    err.textContent = '';
    const endpoint = form.dataset.endpoint;
    if (endpoint) {
      if (form.classList.contains('sending')) return;
      const send = $('button[type="submit"]', form);
      const data = new URLSearchParams();
      data.set('form-name', 'contact');
      $$('input[name]', form).forEach((el) => { if (!el.hasAttribute('data-fold')) data.set(el.name, el.value.trim()); });
      const hours = hoursSel.value === 'unsure' ? 'Not sure yet' : hoursSel.options[hoursSel.selectedIndex].text + ' hours';
      const care = $('#fCare').value.trim();
      data.set('message', 'Coverage they are thinking about: ' + hours + '.' + (care ? '\nThe part of the day they care about most: ' + care : ''));
      form.classList.add('sending');
      send.disabled = true;
      err.textContent = 'Sending your letter…';
      let ok = false;
      try {
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: data.toString() });
        ok = res.ok;
        if (!ok) {
          const body = await res.json().catch(() => ({}));
          err.textContent = res.status === 429 ? 'Too many letters from this connection. Please try again in a few minutes, or write to contact@alex-claudio.com.'
            : body.error ? body.error + '. You can also write to contact@alex-claudio.com.' : 'Your letter did not go through. Please try again, or write to contact@alex-claudio.com.';
        }
      } catch (e2) {
        err.textContent = 'Your letter did not go through. Please check your connection and try again, or write to contact@alex-claudio.com.';
      }
      form.classList.remove('sending');
      send.disabled = false;
      if (!ok) return;
      err.textContent = '';
    }
    form.classList.add('sent');
    const box = $('#thanks');
    box.innerHTML = '';
    const em = innerWidth < 600 ? 26 : 40;
    const lines = innerWidth < 600 ? ['thank you.', "we'll write back", 'within a few hours.'] : ['thank you.', "we'll write back within a few hours."];
    const pens = lines.map((t, i) => pen(box, t, { font: 'felix', em, sw: 1.6, label: i === 0 ? "Thank you. We'll write back within a few hours." : undefined }));
    for (const [i, p] of pens.entries()) await p.play({ duration: i === 0 ? 900 : 1500, delay: i ? 120 : 0 });
  });

  /* ---------- Footer: signed again ---------- */

  const footSig = pen($('#footSig'), SIG, sigOpts(Math.min(150, innerWidth * 0.11), 'Alex Claudio'));
  watch($('#footSig'), () => footSig.play({ duration: 2500, delay: 250, lift: 60 }));

  /* ---------- Cursor and magnetic buttons ---------- */

  if (fine) {
    const cur = $('.cursor'), dot = $('.c-dot'), ringPos = $('.c-ring-pos'), label = $('.c-label');
    let mx = -100, my = -100, rx = -100, ry = -100, mode = '';
    const cursorFor = (t) => {
      if (!t || !t.closest) return '';
      if (t.closest('.mount')) return 'loupe';
      if (t.closest('.card.top, .win')) return 'drag';
      if (t.closest('[data-lb]')) return 'view';
      if (t.closest('a, button, select, [role="radio"]')) return 'link';
      return '';
    };
    const setMode = (m) => {
      mode = m;
      cur.className = 'cursor' + (m ? ' ' + m : '');
      label.textContent = m === 'view' ? 'View' : m === 'drag' ? 'Drag' : '';
    };
    addEventListener('pointermove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      if (cur.classList.contains('away')) cur.classList.remove('away');
      const m = cursorFor(e.target);
      if (m !== mode) setMode(m);
    }, { passive: true });
    document.addEventListener('pointerleave', () => cur.classList.add('away'));
    let cq = 0;
    addEventListener('scroll', () => {
      if (cq || mx < 0 || cur.classList.contains('away')) return;
      cq = requestAnimationFrame(() => {
        cq = 0;
        const m = cursorFor(document.elementFromPoint(mx, my));
        if (m !== mode) setMode(m);
      });
    }, { passive: true });
    const tick = () => {
      rx += (mx - rx) * 0.2;
      ry += (my - ry) * 0.2;
      dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
      ringPos.style.transform = 'translate3d(' + r1(rx) + 'px,' + r1(ry) + 'px,0)';
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    if (!reduce) {
      $$('[data-magnetic]').forEach((b) => {
        b.addEventListener('pointermove', (e) => {
          const r = b.getBoundingClientRect();
          b.style.transform = 'translate(' + r1((e.clientX - r.left - r.width / 2) * 0.2) + 'px,' + r1((e.clientY - r.top - r.height / 2) * 0.3) + 'px)';
        });
        b.addEventListener('pointerleave', () => { b.style.transform = ''; });
      });
    }
  }

  /* ---------- Lightbox ---------- */

  const lb = $('#lb'), lbImg = $('#lbImg'), lbCap = $('#lbCap'), lbCount = $('#lbCount');
  let group = [], gi = 0, lastFocus = null;
  function lbShow(first, from) {
    const el = group[gi];
    const thumb = el.querySelector('img');
    const ar = thumb.naturalWidth && thumb.naturalHeight
      ? thumb.naturalWidth / thumb.naturalHeight
      : Number(thumb.getAttribute('width')) / Number(thumb.getAttribute('height')) || 1.5;
    const maxW = innerWidth * (innerWidth < 700 ? 0.94 : 0.84), maxH = innerHeight * 0.78;
    let w = maxW, h = w / ar;
    if (h > maxH) { h = maxH; w = h * ar; }
    lbImg.style.width = r1(w) + 'px';
    lbImg.style.height = r1(h) + 'px';
    lbImg.src = el.dataset.full || thumb.currentSrc || thumb.src;
    lbImg.alt = thumb.alt;
    lbCap.textContent = el.dataset.caption || thumb.alt;
    lbCount.textContent = group.length > 1 ? gi + 1 + ' / ' + group.length : '';
    if (reduce) return;
    if (first && from) {
      const r = from.getBoundingClientRect();
      const dx = r.left + r.width / 2 - innerWidth / 2, dy = r.top + r.height / 2 - innerHeight / 2;
      const s = clamp(r.width / w, 0.05, 1.5);
      lbImg.animate([{ transform: 'translate(' + r1(dx) + 'px,' + r1(dy) + 'px) scale(' + s + ')', opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 750, easing: 'cubic-bezier(.22,1,.36,1)' });
    } else {
      lbImg.animate([{ opacity: 0, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'ease-out' });
    }
  }
  function lbOpen(el) {
    group = $$('[data-lb="' + el.dataset.lb + '"]');
    gi = Math.max(0, group.indexOf(el));
    lastFocus = document.activeElement;
    lb.hidden = false;
    void lb.offsetWidth;
    lb.classList.add('open');
    lbShow(true, el.querySelector('img'));
    doc.style.overflow = 'hidden';
    doc.classList.add('lb-on');
    $('#lbClose').focus({ preventScroll: true });
  }
  function lbClose() {
    lb.classList.remove('open');
    const a = lbImg.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.97)' }], { duration: reduce ? 1 : 280, fill: 'forwards' });
    a.finished.then(() => {
      lb.hidden = true;
      a.cancel();
      doc.style.overflow = '';
      doc.classList.remove('lb-on');
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    });
  }
  const lbStep = (d) => { gi = (gi + d + group.length) % group.length; lbShow(false); };
  $('#lbClose').addEventListener('click', lbClose);
  $('#lbPrev').addEventListener('click', () => lbStep(-1));
  $('#lbNext').addEventListener('click', () => lbStep(1));
  lb.addEventListener('click', (e) => { if (e.target === lb) lbClose(); });
  $$('[data-lb]').forEach((el) => {
    if (el.classList.contains('slide')) return;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const img = el.querySelector('img');
    el.setAttribute('aria-label', 'Open photograph: ' + (img ? img.alt : ''));
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-lb]');
    if (el && lb.hidden) lbOpen(el);
  });
  document.addEventListener('keydown', (e) => {
    if (!lb.hidden) {
      if (e.key === 'Escape') lbClose();
      else if (e.key === 'ArrowRight') lbStep(1);
      else if (e.key === 'ArrowLeft') lbStep(-1);
      else if (e.key === 'Tab') {
        const f = [$('#lbClose'), $('#lbPrev'), $('#lbNext')];
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
      return;
    }
    const el = e.target.closest && e.target.closest('[data-lb]');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); lbOpen(el); }
  });

  /* ---------- Menu ---------- */

  const menuBtn = $('#menuBtn'), menu = $('#menu');
  let menuOpen = false;
  menuBtn.addEventListener('click', () => {
    menuOpen = !menuOpen;
    menu.hidden = !menuOpen;
    menuBtn.setAttribute('aria-expanded', String(menuOpen));
    menuBtn.textContent = menuOpen ? 'Close' : 'Menu';
    doc.style.overflow = menuOpen ? 'hidden' : '';
    if (menuOpen) nav.classList.remove('away');
  });
  $$('a', menu).forEach((a) => a.addEventListener('click', () => { if (menuOpen) menuBtn.click(); }));

  /* ---------- Scroll: nav, tone, clock and the pinned scenes ---------- */

  const nav = $('#nav');
  const clock = $('#clock'), clockTime = $('#clockTime'), clockLabel = $('#clockLabel'), sunDot = $('#clock .sun');
  const toneEls = $$('main > [data-tone]');
  const M = {};
  function measure() {
    layoutGolden();
    const y = scrollY;
    const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top + y, height: r.height, el }; };
    M.prologue = box(prologueEl);
    M.cams = box($('.cams'));
    M.golden = box(goldenEl);
    M.night = box($('#nightStage'));
    M.tones = toneEls.map(box);
  }

  function clockUpdate(sec, mid) {
    const el = sec.el;
    const label = el.dataset.label;
    if (!label) { clock.classList.add('off'); return; }
    clock.classList.remove('off');
    if (el.dataset.clock) {
      const [a, b] = el.dataset.clock.split(',').map(Number);
      const m = lerp(a, b, clamp((mid - sec.top) / sec.height));
      clockTime.textContent = fmt(m);
      clockLabel.textContent = label;
      const sunset = 1250;
      const moon = m > sunset;
      const u = moon ? clamp((m - sunset) / (1800 - sunset)) : clamp((m - 360) / (sunset - 360));
      const th = Math.PI * (1 - u);
      sunDot.setAttribute('cx', r1(27 + 22 * Math.cos(th)));
      sunDot.setAttribute('cy', r1(27 - 22 * Math.sin(th)));
      clock.classList.toggle('moon', moon);
    } else {
      clockTime.textContent = label;
      clockLabel.textContent = '';
    }
  }

  let lastY = scrollY, ticking = false, started = false;
  function frame() {
    ticking = false;
    const y = scrollY;
    nav.classList.toggle('solid', y > 30);
    const dy = y - lastY;
    if (y < 140 || menuOpen) nav.classList.remove('away');
    else if (dy > 6) nav.classList.add('away');
    else if (dy < -6) nav.classList.remove('away');
    const mid = y + innerHeight * 0.5;
    let cur = M.tones[0];
    for (const s of M.tones) if (mid >= s.top) cur = s;
    if (body.dataset.tone !== cur.el.dataset.tone) body.dataset.tone = cur.el.dataset.tone;
    if (started) clockUpdate(cur, mid);
    const pr = M.prologue;
    clock.classList.toggle('hush', !lite && y > pr.top + (pr.height - innerHeight) * 0.35 && y < pr.top + pr.height - innerHeight + 80);
    if (!lite) { prologue(y); golden(y); }
    if (!reduce) { cams(y); night(y); }
    lastY = y;
  }
  const requestFrame = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', requestFrame, { passive: true });

  function onResize() {
    lite = reduce || mqNarrow.matches;
    doc.classList.toggle('lite', lite);
    if (lite) {
      plate.style.clipPath = '';
      spreadEl.style.opacity = '';
      spreadEl.style.transform = '';
      metaEl.style.opacity = '';
      track.style.transform = '';
      slideEls.forEach((s) => { s.el.style.removeProperty('--tx'); s.el.style.removeProperty('--ty'); });
    }
    drawUnderlines();
    drawSee();
    if (started) drawNavOval(false);
    if (navOval && started) navOval.show();
    tableMarks();
    drawHourOval(false);
    measure();
    frame();
  }
  let rz = 0;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(onResize, 160); });
  let roT = 0;
  new ResizeObserver(() => { clearTimeout(roT); roT = setTimeout(() => { measure(); frame(); }, 120); }).observe($('main'));

  /* ---------- Opening: the signature writes itself ---------- */

  function startPage(instant) {
    if (started) return;
    started = true;
    doc.style.overflow = '';
    $$('[data-split], [data-rise]', prologueEl).forEach((el) => el.classList.add('in'));
    setTimeout(() => seeLine.play({ duration: 800, lift: 120 }), instant ? 500 : 1500);
    setTimeout(() => { const u = $('.spread .link > .ul'); if (u) u.classList.add('drawn'); }, instant ? 900 : 2000);
    setTimeout(() => drawNavOval(true), instant ? 900 : 2100);
    slideshow.start(instant ? 0 : 300);
    frame();
  }

  const hashTarget = (() => {
    const id = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : '';
    const el = id ? document.getElementById(id) : null;
    // Older names (#contact, #intro, #reviews) are empty markers inside the new sections.
    return el && el.tagName === 'SPAN' && !el.textContent.trim() ? (el.closest('section') || el) : el;
  })();

  // Arriving from another page with a section link (#letter, #collections): go straight there.
  function landOnHash() {
    if (!hashTarget) return;
    let touched = false;
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach((ev) => addEventListener(ev, () => { touched = true; }, { passive: true, once: true }));
    const go = () => {
      if (touched) return;
      measure();
      const prev = doc.style.scrollBehavior;
      doc.style.scrollBehavior = 'auto';
      scrollTo(0, Math.round(hashTarget.getBoundingClientRect().top + scrollY));
      doc.style.scrollBehavior = prev;
      lastY = scrollY;
      frame();
    };
    go();
    requestAnimationFrame(go);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go);
    if (document.readyState !== 'complete') addEventListener('load', go, { once: true });
    setTimeout(() => { touched = true; }, 4000);
  }

  async function runIntro() {
    const intro = $('#opening');
    let seen = false;
    try { seen = sessionStorage.getItem('ac-day-seen') === '1'; } catch (e) { /* storage unavailable */ }
    if (!intro || reduce || seen || hashTarget) {
      if (intro) intro.remove();
      navSig.show();
      startPage(true);
      landOnHash();
      return;
    }
    try { sessionStorage.setItem('ac-day-seen', '1'); } catch (e) { /* storage unavailable */ }
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    scrollTo(0, 0);
    doc.style.overflow = 'hidden';
    markHost.style.opacity = '0';
    const em = Math.min(160, innerWidth * 0.11);
    const big = pen($('#introSig'), SIG, sigOpts(em));
    let skipResolve;
    const skipped = new Promise((r) => { skipResolve = r; });
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    const onSkip = () => skipResolve('skip');
    events.forEach((ev) => addEventListener(ev, onSkip, { passive: true }));
    const lineTimer = setTimeout(() => intro.classList.add('lined'), 1500);
    const how = await Promise.race([big.play({ duration: 2300, delay: 300, lift: 60 }), skipped]);
    events.forEach((ev) => removeEventListener(ev, onSkip));
    clearTimeout(lineTimer);
    big.show();
    intro.classList.add('lined');
    if (how !== 'skip') await wait(420);

    const from = big.svg.getBoundingClientRect();
    const to = navSig.svg.getBoundingClientRect();
    const sx = to.width / from.width;
    const dur = 1150;
    const ink = getComputedStyle(body).color;
    const flight = big.svg.animate([
      { transform: 'none', color: '#efe8dc' },
      { transform: 'translate(' + r1(to.left - from.left) + 'px,' + r1(to.top - from.top) + 'px) scale(' + sx + ')', color: ink }
    ], { duration: dur, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' });
    $('.intro-bg').animate([{ clipPath: 'inset(0 0 0 0)' }, { clipPath: 'inset(0 0 100% 0)' }], { duration: dur - 120, easing: 'cubic-bezier(.76,0,.24,1)', fill: 'forwards' });
    intro.classList.add('leaving');
    setTimeout(() => startPage(false), dur * 0.42);
    await flight.finished.catch(() => {});
    markHost.style.opacity = '';
    navSig.show();
    intro.remove();
  }

  measure();
  frame();
  runIntro();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      drawUnderlines();
      drawSee();
      if (started && navOval) drawNavOval(false), navOval && navOval.show();
      tableMarks();
      drawHourOval(false);
      measure();
      frame();
    });
  }
})();
