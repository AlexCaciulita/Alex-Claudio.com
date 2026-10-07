(() => {
  'use strict';

  const GLYPHS = /*__GLYPHS__*/null;
  const WORK = /*__WORK__*/null;
  const doc = document.documentElement;
  const body = document.body;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const r1 = (n) => Math.round(n * 10) / 10;
  doc.classList.toggle('reduce', reduce);
  if (fine) doc.classList.add('fine');

  /*__INK__*/

  $$('[data-split]').forEach(split);
  const headEls = $$('.work-head [data-split], .work-head [data-rise]');
  $$('[data-split], [data-rise]').forEach((el) => { if (!headEls.includes(el)) watch(el, el._onIn); });

  /* ---------- Nav: signature, underlines, the oval round "Write to us" ---------- */

  const SIG = 'Alex Claudio';
  const sigOpts = (em, label) => ({
    font: 'society', em, nib: { n: em > 60 ? 11 : 7, w: em * 0.036, angle: 35 },
    sw: Math.max(0.55, em * 0.0072), padX: 40, top: 980, bottom: 330, label
  });
  const navSig = pen($('#mark'), SIG, sigOpts(innerWidth < 600 ? 26 : 32));

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
    if (play) navOval.play({ duration: 900 }); else navOval.show();
  }
  $('#navWrite').addEventListener('pointerenter', () => { if (navOval) navOval.play({ duration: 700 }); });

  const titleWord = $('#titleWord');
  let titleLine = null;
  function drawTitleLine(play) {
    if (titleLine) titleLine.svg.remove();
    const w = titleWord.offsetWidth * 1.08, h = 30;
    titleLine = scribble(titleWord, [
      'M4 ' + r1(h * 0.6) + ' C' + r1(w * 0.3) + ' ' + r1(h * 0.3) + ' ' + r1(w * 0.62) + ' ' + r1(h * 0.52) + ' ' + r1(w - 4) + ' ' + r1(h * 0.34),
      'M' + r1(w * 0.18) + ' ' + r1(h * 0.9) + ' C' + r1(w * 0.44) + ' ' + r1(h * 0.68) + ' ' + r1(w * 0.72) + ' ' + r1(h * 0.78) + ' ' + r1(w * 0.9) + ' ' + r1(h * 0.68)
    ], { viewBox: '0 0 ' + r1(w) + ' ' + h, width: w, height: h, sw: 2.6, className: 'uline' });
    if (play) titleLine.play({ duration: 800, lift: 120 }); else titleLine.show();
  }

  /* ---------- The photographs ---------- */

  const PLATES = new Set(['04', '29', '52', '59', '64']);
  const SELECTS = { '38': 'this one', '58': 'yes', '21': 'check' };
  const gallery = $('#gallery');
  const stripLayer = document.createElement('div');
  const capLayer = document.createElement('div');
  gallery.append(stripLayer, capLayer);

  const items = WORK.map((d) => {
    const el = document.createElement('figure');
    el.className = 'item';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Open photograph ' + d.n + ': ' + d.alt);
    el.dataset.full = d.full;
    el.dataset.caption = 'Frame ' + d.n + '. ' + d.alt + '.';
    const img = document.createElement('img');
    img.alt = d.alt;
    img.width = d.w;
    img.height = d.h;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.sizes = '400px';
    img.srcset = d.srcset;
    img.src = d.mid;
    const fno = document.createElement('span');
    fno.className = 'fno';
    fno.textContent = d.n;
    fno.setAttribute('aria-hidden', 'true');
    el.append(img, fno);
    gallery.insertBefore(el, capLayer);
    return { d, el, img, ar: d.w / d.h, rect: null, shown: true };
  });
  items.forEach((it) => watch(it.el));

  let mode = 'book', filter = 'all';
  const match = (it) => filter === 'all' || (filter === 'bw' ? it.d.bw : it.d.cat === filter);
  const COUNTS = {
    all: items.length,
    wedding: items.filter((i) => i.d.cat === 'wedding').length,
    engagement: items.filter((i) => i.d.cat === 'engagement').length,
    bw: items.filter((i) => i.d.bw).length
  };
  $$('[data-count]').forEach((el) => { el.textContent = COUNTS[el.dataset.count]; });

  // Book: justified rows that keep every photograph's shape, with a few full-width plates for rhythm.
  function bookLayout(list, W) {
    const narrow = W < 700;
    const gap = narrow ? 8 : 14;
    const target = narrow ? 170 : clamp(W * 0.25, 230, 380);
    const rects = new Map(), caps = [];
    const pending = [];
    let y = 0, row = [], sum = 0;
    const placeRow = (h) => {
      let x = 0;
      for (const it of row) { const w = it.ar * h; rects.set(it, { x, y, w, h }); x += w + gap; }
      y += h + gap;
      row = [];
      sum = 0;
    };
    const placePlate = (it) => {
      y += narrow ? 22 : 54;
      let h = W / it.ar;
      h = Math.min(h, innerHeight * 0.84, 1000);
      rects.set(it, { x: 0, y, w: W, h, plate: true });
      y += h + 12;
      caps.push({ it, y });
      y += (narrow ? 40 : 30) + (narrow ? 22 : 54);
    };
    for (const it of list) {
      if (PLATES.has(it.d.n) && it.ar > 1.2) { pending.push(it); continue; }
      row.push(it);
      sum += it.ar;
      const h = (W - gap * (row.length - 1)) / sum;
      if (h <= target) { placeRow(h); while (pending.length) placePlate(pending.shift()); }
    }
    if (row.length) placeRow(Math.min(target, (W - gap * (row.length - 1)) / sum));
    while (pending.length) placePlate(pending.shift());
    return { rects, caps, strips: [], height: Math.max(0, y - gap) };
  }

  // Contact sheet: every frame at one height, laid along strips of film with frame numbers.
  function sheetLayout(list, W) {
    const narrow = W < 700;
    const fh = narrow ? 62 : 132, gap = narrow ? 6 : 12, side = narrow ? 10 : 20;
    const band = narrow ? 22 : 27, label = 18, stripGap = narrow ? 10 : 16;
    const stripH = band + fh + label + band - 6;
    const rects = new Map(), strips = [];
    let y = 0, x = side;
    strips.push({ y, h: stripH });
    for (const it of list) {
      const w = it.ar * fh;
      if (x + w > W - side && x > side) {
        y += stripH + stripGap;
        strips.push({ y, h: stripH });
        x = side;
      }
      rects.set(it, { x, y: y + band, w, h: fh + label });
      x += w + gap;
    }
    return { rects, caps: [], strips: list.length ? strips : [], height: list.length ? y + stripH : 0 };
  }

  let pencil = null, pencilNotes = [], pencilTimer = 0;
  function clearPencil() {
    clearTimeout(pencilTimer);
    if (pencil) { pencil.svg.remove(); pencil = null; }
    pencilNotes.forEach((n) => n.remove());
    pencilNotes = [];
  }
  function drawPencil(play) {
    clearPencil();
    if (mode !== 'sheet') return;
    const W = gallery.clientWidth, H = gallery.offsetHeight;
    const ds = [], notes = [];
    let seed = 3;
    for (const it of items) {
      const kind = SELECTS[it.d.n];
      const r = it.rect;
      if (!kind || !it.shown || !r) continue;
      const h = r.h - 18;
      if (kind === 'check') {
        ds.push('M' + r1(r.x + r.w - 16) + ' ' + r1(r.y + 6) + ' L' + r1(r.x + r.w - 5) + ' ' + r1(r.y + 20) + ' L' + r1(r.x + r.w + 17) + ' ' + r1(r.y - 14));
      } else {
        ds.push(loop(r.x + r.w / 2, r.y + h / 2, r.w / 2 + 12, h / 2 + 11, seed++));
        notes.push({ text: kind, r });
      }
    }
    if (!ds.length) return;
    pencil = scribble(gallery, ds, { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, sw: 2.4, className: 'pencil-layer' });
    if (play) pencil.play({ duration: 1900, lift: 380 }); else pencil.show();
    notes.forEach((n, i) => {
      const host = document.createElement('div');
      host.className = 'pencil-note';
      gallery.appendChild(host);
      const p = pen(host, n.text, { font: 'felix', em: W < 700 ? 20 : 27, sw: 2 });
      const nw = parseFloat(p.svg.getAttribute('width'));
      const left = n.r.x + n.r.w + 4 + nw <= W ? n.r.x + n.r.w + 4 : n.r.x - nw - 4;
      host.style.left = r1(Math.max(0, left)) + 'px';
      host.style.top = r1(n.r.y - 34) + 'px';
      pencilNotes.push(host);
      if (play) p.play({ duration: 900, delay: 700 + i * 900 }); else p.show();
    });
  }

  function applyLayout(animate) {
    const W = gallery.clientWidth;
    const list = items.filter(match);
    const L = mode === 'book' ? bookLayout(list, W) : sheetLayout(list, W);
    const motion = animate && !reduce;
    gallery.classList.toggle('book', mode === 'book');
    gallery.classList.toggle('sheet', mode === 'sheet');

    stripLayer.innerHTML = '';
    L.strips.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'strip';
      d.style.top = r1(s.y) + 'px';
      d.style.height = r1(s.h) + 'px';
      d.style.animationDelay = (motion ? i * 45 : 0) + 'ms';
      if (!motion) d.style.animation = 'none';
      const e = document.createElement('span');
      e.className = 'edge';
      e.textContent = 'AC \u25B8 ' + String(i + 1).padStart(2, '0');
      d.appendChild(e);
      stripLayer.appendChild(d);
    });

    capLayer.innerHTML = '';
    L.caps.forEach((c) => {
      const p = document.createElement('p');
      p.className = 'pcap';
      p.style.left = '0px';
      p.style.top = r1(c.y) + 'px';
      const b = document.createElement('b');
      b.textContent = c.it.d.n;
      p.append(b, document.createTextNode(c.it.d.alt + '.'));
      capLayer.appendChild(p);
      if (motion) p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 700, fill: 'backwards' });
    });

    let k = 0;
    for (const it of items) {
      const r = L.rects.get(it);
      it.el.getAnimations().forEach((a) => a.cancel());
      if (!r) {
        if (it.shown && motion) {
          it.shown = false;
          const a = it.el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 320, easing: 'ease-in', fill: 'forwards' });
          a.finished.then(() => { if (!it.shown) { it.el.hidden = true; a.cancel(); } }, () => {});
        } else {
          it.shown = false;
          it.el.hidden = true;
        }
        continue;
      }
      const prev = it.rect;
      const appearing = !it.shown || it.el.hidden;
      it.shown = true;
      it.el.hidden = false;
      const s = it.el.style;
      s.left = r1(r.x) + 'px';
      s.top = r1(r.y) + 'px';
      s.width = r1(r.w) + 'px';
      s.height = r1(r.h) + 'px';
      it.img.sizes = Math.ceil(r.w) + 'px';
      if (motion) {
        if (prev && !appearing) {
          it.el.animate([
            { left: r1(prev.x) + 'px', top: r1(prev.y) + 'px', width: r1(prev.w) + 'px', height: r1(prev.h) + 'px' },
            { left: r1(r.x) + 'px', top: r1(r.y) + 'px', width: r1(r.w) + 'px', height: r1(r.h) + 'px' }
          ], { duration: 950, delay: Math.min(k * 9, 380), easing: 'cubic-bezier(.65,0,.35,1)' });
        } else {
          it.el.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 220 + Math.min(k * 12, 420), easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
        }
      }
      it.rect = r;
      k++;
    }
    gallery.style.height = r1(L.height) + 'px';
    clearPencil();
    if (mode === 'sheet') {
      if (motion) pencilTimer = setTimeout(() => drawPencil(true), 1250);
      else drawPencil(false);
    }
    requestFrame();
  }

  /* ---------- Controls ---------- */

  const viewBtns = $$('.views button'), filterBtns = $$('.filters button');
  const viewsNote = $('#viewsNote');
  let viewOval = null, filterOval = null;
  function oval(btn, prev, play, seed) {
    if (prev) prev.svg.remove();
    const w = btn.offsetWidth + 14, h = btn.offsetHeight + 10;
    const o = scribble(btn, [loop(w / 2, h / 2, w / 2 - 5, h / 2 - 4, seed, 1.1)], { viewBox: '0 0 ' + w + ' ' + h, width: w, height: h, sw: 1.4, className: 'oval' });
    if (play) o.play({ duration: 600 }); else o.show();
    return o;
  }
  const status = $('#status');
  const announce = () => {
    const n = items.filter(match).length;
    status.textContent = 'Showing ' + n + ' photographs, laid out as a ' + (mode === 'book' ? 'book' : 'contact sheet') + '.';
  };
  const headEl = $('.work-head'), wrapEl = $('#galleryWrap');
  function setView(v, user) {
    if (user && v === mode) return;
    mode = v;
    viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    viewOval = oval(viewBtns.find((b) => b.dataset.view === v), viewOval, user, v === 'book' ? 4 : 9);
    const tone = v === 'sheet' ? 'night' : 'paper';
    headEl.dataset.tone = tone;
    wrapEl.dataset.tone = tone;
    if (v === 'sheet') viewsNote.classList.add('gone');
    if (user) {
      const top = wrapEl.getBoundingClientRect().top + scrollY - 90;
      if (scrollY > top + 40) scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
    }
    applyLayout(user);
    if (user) announce();
  }
  function setFilter(f, user) {
    filter = f;
    filterBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
    filterOval = oval(filterBtns.find((b) => b.dataset.filter === f), filterOval, user, f.length + 2);
    applyLayout(user);
    if (user) announce();
  }
  viewBtns.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view, true)));
  filterBtns.forEach((b) => b.addEventListener('click', () => { if (b.dataset.filter !== filter) setFilter(b.dataset.filter, true); }));

  // A pencilled hint pointing at the contact sheet.
  let notePen = null, noteArrow = null;
  function drawViewsNote(play) {
    viewsNote.innerHTML = '';
    if (innerWidth <= 900) return;
    noteArrow = scribble(viewsNote, ['M40 10 C28 7 14 13 8 30', 'M4 20 L8 31 L18 25'], { viewBox: '0 0 44 36', width: 44, height: 36, sw: 1.8 });
    notePen = pen(viewsNote, 'all at once', { font: 'felix', em: 27, sw: 1.8 });
    if (play) { noteArrow.play({ duration: 600, delay: 900 }); notePen.play({ duration: 1000, delay: 1500 }); } else { noteArrow.show(); notePen.show(); }
  }

  /* ---------- Loupe on the contact sheet ---------- */

  if (fine) {
    const loupe = $('#loupe');
    const Z = 2.8, R = 110;
    let lx = 0, ly = 0, tx = 0, ty = 0, on = false, raf = 0;
    const follow = () => {
      lx += (tx - lx) * 0.32;
      ly += (ty - ly) * 0.32;
      loupe.style.transform = 'translate3d(' + r1(lx - R) + 'px,' + r1(ly - R) + 'px,0)';
      raf = on || Math.abs(tx - lx) > 0.5 ? requestAnimationFrame(follow) : 0;
    };
    items.forEach((it) => {
      it.el.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse' || mode !== 'sheet') return;
        on = true;
        loupe.style.backgroundImage = 'url("' + it.d.loupe + '")';
        loupe.classList.add('on');
        lx = tx = e.clientX;
        ly = ty = e.clientY;
        if (!raf) raf = requestAnimationFrame(follow);
      });
      it.el.addEventListener('pointermove', (e) => {
        if (!on) return;
        const r = it.img.getBoundingClientRect();
        const rx = clamp((e.clientX - r.left) / r.width), ry = clamp((e.clientY - r.top) / r.height);
        const bw = r.width * Z, bh = r.height * Z;
        loupe.style.backgroundSize = r1(bw) + 'px ' + r1(bh) + 'px';
        loupe.style.backgroundPosition = r1(R - rx * bw) + 'px ' + r1(R - ry * bh) + 'px';
        tx = e.clientX;
        ty = e.clientY;
      });
      it.el.addEventListener('pointerleave', () => { on = false; loupe.classList.remove('on'); });
    });
  }

  /* ---------- Cursor and magnetic buttons ---------- */

  if (fine) {
    const cur = $('.cursor'), dot = $('.c-dot'), ringPos = $('.c-ring-pos'), label = $('.c-label');
    let mx = -100, my = -100, rx = -100, ry = -100, cmode = '';
    const cursorFor = (t) => {
      if (!t || !t.closest) return '';
      if (t.closest('.item')) return mode === 'sheet' ? 'loupe' : 'view';
      if (t.closest('a, button, select')) return 'link';
      return '';
    };
    const setMode = (m) => {
      cmode = m;
      cur.className = 'cursor' + (m ? ' ' + m : '');
      label.textContent = m === 'view' ? 'View' : '';
    };
    addEventListener('pointermove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      if (cur.classList.contains('away')) cur.classList.remove('away');
      const m = cursorFor(e.target);
      if (m !== cmode) setMode(m);
    }, { passive: true });
    document.addEventListener('pointerleave', () => cur.classList.add('away'));
    let cq = 0;
    addEventListener('scroll', () => {
      if (cq || mx < 0 || cur.classList.contains('away')) return;
      cq = requestAnimationFrame(() => {
        cq = 0;
        const m = cursorFor(document.elementFromPoint(mx, my));
        if (m !== cmode) setMode(m);
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

  /* ---------- Viewer ---------- */

  const lb = $('#lb'), lbImg = $('#lbImg'), lbCap = $('#lbCap'), lbCount = $('#lbCount');
  let group = [], gi = 0, lastFocus = null, swiped = false;
  function lbShow(first, from) {
    const el = group[gi];
    const it = items.find((x) => x.el === el);
    const ar = it.ar;
    const maxW = innerWidth * (innerWidth < 700 ? 0.94 : 0.84), maxH = innerHeight * 0.78;
    let w = maxW, h = w / ar;
    if (h > maxH) { h = maxH; w = h * ar; }
    lbImg.style.width = r1(w) + 'px';
    lbImg.style.height = r1(h) + 'px';
    lbImg.src = it.d.full;
    lbImg.alt = it.d.alt;
    lbCap.textContent = el.dataset.caption;
    lbCount.textContent = gi + 1 + ' / ' + group.length;
    [group[gi + 1], group[gi - 1]].forEach((n) => { if (n) { const pre = new Image(); pre.src = n.dataset.full; } });
    if (reduce) return;
    if (first && from) {
      const r = from.getBoundingClientRect();
      const dx = r.left + r.width / 2 - innerWidth / 2, dy = r.top + r.height / 2 - innerHeight / 2;
      const s = clamp(r.width / w, 0.05, 1.5);
      lbImg.animate([{ transform: 'translate(' + r1(dx) + 'px,' + r1(dy) + 'px) scale(' + s + ')', opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 750, easing: 'cubic-bezier(.22,1,.36,1)' });
    } else {
      lbImg.animate([{ opacity: 0, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'ease-out' });
    }
  }
  function lbOpen(el) {
    group = items.filter((i) => i.shown).map((i) => i.el);
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
  let sx = null;
  lb.addEventListener('pointerdown', (e) => { sx = e.pointerType === 'mouse' ? null : e.clientX; swiped = false; });
  lb.addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (Math.abs(dx) > 50) { swiped = true; lbStep(dx < 0 ? 1 : -1); }
  });
  lb.addEventListener('click', (e) => { if (e.target === lb && !swiped) lbClose(); swiped = false; });
  gallery.addEventListener('click', (e) => {
    const el = e.target.closest('.item');
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
    const el = e.target.closest && e.target.closest('.item');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); lbOpen(el); }
  });

  /* ---------- Menu, footer ---------- */

  const menuBtn = $('#menuBtn'), menu = $('#menu'), nav = $('#nav');
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

  const footSig = pen($('#footSig'), SIG, sigOpts(Math.min(150, innerWidth * 0.11), 'Alex Claudio'));
  watch($('#footSig'), () => footSig.play({ duration: 2500, delay: 250, lift: 60 }));

  /* ---------- Scroll: nav, tone, frame counter ---------- */

  const frameCount = $('#frameCount');
  const toneEls = $$('main > [data-tone]');
  let lastY = scrollY, ticking = false;
  function frame() {
    ticking = false;
    const y = scrollY;
    nav.classList.toggle('solid', y > 30);
    const dy = y - lastY;
    if (y < 140 || menuOpen) nav.classList.remove('away');
    else if (dy > 6) nav.classList.add('away');
    else if (dy < -6) nav.classList.remove('away');
    lastY = y;
    const mid = innerHeight * 0.5;
    let tone = toneEls[0].dataset.tone;
    for (const el of toneEls) if (el.getBoundingClientRect().top <= mid) tone = el.dataset.tone;
    if (body.dataset.tone !== tone) body.dataset.tone = tone;

    const gr = gallery.getBoundingClientRect();
    if (gr.top > innerHeight * 0.55 || gr.bottom < innerHeight * 0.45) { frameCount.classList.add('off'); return; }
    const local = mid - gr.top;
    let best = null, bd = Infinity, bi = 0, n = 0;
    for (const it of items) {
      if (!it.shown || !it.rect) continue;
      const c = it.rect.y + it.rect.h / 2;
      const dd = Math.abs(c - local) + Math.abs(it.rect.x + it.rect.w / 2 - gr.width / 2) * 0.05;
      if (dd < bd) { bd = dd; best = it; bi = n; }
      n++;
    }
    if (!best) { frameCount.classList.add('off'); return; }
    frameCount.classList.remove('off');
    frameCount.innerHTML = 'frame <b>' + best.d.n + '</b> <span>&middot; ' + (bi + 1) + ' of ' + n + '</span>';
  }
  function requestFrame() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  addEventListener('scroll', requestFrame, { passive: true });

  let rz = 0, lastW = innerWidth;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      const widthChanged = innerWidth !== lastW;
      lastW = innerWidth;
      drawUnderlines();
      drawNavOval(false);
      drawTitleLine(false);
      viewOval = oval(viewBtns.find((b) => b.dataset.view === mode), viewOval, false, mode === 'book' ? 4 : 9);
      filterOval = oval(filterBtns.find((b) => b.dataset.filter === filter), filterOval, false, filter.length + 2);
      if (mode === 'book') drawViewsNote(false);
      if (widthChanged) applyLayout(false); else requestFrame();
    }, 160);
  });

  /* ---------- Start ---------- */

  setView('book', false);
  setFilter('all', false);
  announce();
  if (reduce) navSig.show(); else navSig.play({ duration: 1300, delay: 150, lift: 45 });
  requestAnimationFrame(() => {
    headEls.forEach((el) => el.classList.add('in'));
    setTimeout(() => drawTitleLine(!reduce), reduce ? 0 : 1000);
    setTimeout(() => drawNavOval(!reduce), reduce ? 0 : 1400);
    setTimeout(() => { const u = $('.nav-links a[aria-current] > .ul'); if (u) u.classList.add('drawn'); }, reduce ? 0 : 1100);
    drawViewsNote(!reduce);
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      drawUnderlines();
      const u = $('.nav-links a[aria-current] > .ul');
      if (u) u.classList.add('drawn');
      viewOval = oval(viewBtns.find((b) => b.dataset.view === mode), viewOval, false, mode === 'book' ? 4 : 9);
      filterOval = oval(filterBtns.find((b) => b.dataset.filter === filter), filterOval, false, filter.length + 2);
      if (titleLine) drawTitleLine(false);
      requestFrame();
    });
  }
})();
