(() => {
  'use strict';

  const GLYPHS = /*__GLYPHS__*/null;
  const doc = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const r1 = (n) => Math.round(n * 10) / 10;
  doc.classList.toggle('reduce', reduce);
  if (fine) doc.classList.add('fine');
  const isIndex = document.body.classList.contains('journal-index');

  /*__INK__*/

  $$('[data-split]').forEach(split);
  const heroEls = $$('.hero-reveal [data-split], .hero-reveal [data-rise], .hero-reveal [data-develop]');
  $$('[data-split], [data-rise], [data-develop]').forEach((el) => { if (!heroEls.includes(el)) watch(el, el._onIn); });

  /* ---------- Navigation ---------- */

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
  const markCurrent = () => { const u = $('.nav-links a[aria-current] > .ul'); if (u) u.classList.add('drawn'); };

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

  /* ---------- Cursor and magnetic buttons ---------- */

  if (fine) {
    const cur = $('.cursor'), dot = $('.c-dot'), ringPos = $('.c-ring-pos'), label = $('.c-label');
    let mx = -100, my = -100, rx = -100, ry = -100, cmode = '';
    const cursorFor = (t) => {
      if (!t || !t.closest) return '';
      if (t.closest('.j-row, .lead-link, .card-link')) return 'read';
      if (t.closest('a, button, summary')) return 'link';
      return '';
    };
    const setMode = (m) => {
      cmode = m;
      cur.className = 'cursor' + (m ? ' ' + m : '');
      label.textContent = m === 'read' ? 'Read' : '';
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

  /* ---------- Index: the title line, a pencilled "new", floating previews ---------- */

  let titleLine = null;
  const titleWord = $('#titleWord');
  function drawTitleLine(play) {
    if (!titleWord) return;
    if (titleLine) titleLine.svg.remove();
    const w = titleWord.offsetWidth * 1.06, h = 30;
    titleLine = scribble(titleWord, [
      'M4 ' + r1(h * 0.6) + ' C' + r1(w * 0.3) + ' ' + r1(h * 0.3) + ' ' + r1(w * 0.62) + ' ' + r1(h * 0.52) + ' ' + r1(w - 4) + ' ' + r1(h * 0.34),
      'M' + r1(w * 0.18) + ' ' + r1(h * 0.9) + ' C' + r1(w * 0.44) + ' ' + r1(h * 0.68) + ' ' + r1(w * 0.72) + ' ' + r1(h * 0.78) + ' ' + r1(w * 0.9) + ' ' + r1(h * 0.68)
    ], { viewBox: '0 0 ' + r1(w) + ' ' + h, width: w, height: h, sw: 2.6, className: 'uline' });
    if (play) titleLine.play({ duration: 800, lift: 120 }); else titleLine.show();
  }

  const newNote = $('#newNote');
  function drawNewNote(play) {
    if (!newNote) return;
    newNote.innerHTML = '';
    const word = pen(newNote, 'new', { font: 'felix', em: innerWidth < 600 ? 26 : 34, sw: 2 });
    const arrow = scribble(newNote, ['M4 6 C14 8 22 18 26 34', 'M17 28 L26 35 L30 24'], { viewBox: '0 0 34 40', width: 34, height: 40, sw: 1.9 });
    if (play) { word.play({ duration: 700, delay: 1200 }); arrow.play({ duration: 600, delay: 1900 }); } else { word.show(); arrow.show(); }
  }

  if (isIndex && fine) {
    const pos = document.createElement('div');
    pos.className = 'hp-pos';
    pos.innerHTML = '<div class="hover-preview"><img alt=""></div>';
    document.body.appendChild(pos);
    const box = $('.hover-preview', pos), pimg = $('img', pos);
    let px = 0, py = 0, tx = 0, ty = 0, on = false, raf = 0;
    const follow = () => {
      px += (tx - px) * 0.16;
      py += (ty - py) * 0.16;
      pos.style.transform = 'translate3d(' + r1(px) + 'px,' + r1(py) + 'px,0)';
      raf = on || Math.abs(tx - px) > 0.5 ? requestAnimationFrame(follow) : 0;
    };
    $$('.j-row').forEach((row) => {
      row.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse') return;
        if (pimg.getAttribute('src') !== row.dataset.preview) pimg.src = row.dataset.preview;
        if (!on) { px = tx = e.clientX; py = ty = e.clientY; }
        on = true;
        box.classList.add('on');
        if (!raf) raf = requestAnimationFrame(follow);
      });
      row.addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; });
      row.addEventListener('pointerleave', () => { on = false; box.classList.remove('on'); });
    });
  }

  /* ---------- Article: contents marker, cover drift, section counter ---------- */

  const toc = $('.toc');
  const tocLinks = toc ? $$('a', toc) : [];
  const marker = $('#tocMarker');
  const sections = tocLinks.map((a) => ({ a, el: document.getElementById(a.getAttribute('href').slice(1)), part: a.classList.contains('part-link') })).filter((s) => s.el);
  const plainSections = sections.filter((s) => !s.part);
  let markerInk = null, active = null;
  if (marker) {
    markerInk = scribble(marker, ['M2 8 C7 6 12 9 17 7', 'M12 3 L17 7 L12 11'], { viewBox: '0 0 20 14', width: 20, height: 14, sw: 1.7 });
    markerInk.show();
  }
  const placeMarker = (s) => {
    marker.style.transform = 'translate3d(' + (s.part ? -28 : 0) + 'px,' + r1(s.a.offsetTop + (s.a.offsetHeight - 14) / 2) + 'px,0)';
  };
  function setActive(s) {
    if (s === active) return;
    if (active) active.a.classList.remove('on');
    active = s;
    if (!s || !marker || !toc.offsetParent) return;
    s.a.classList.add('on');
    placeMarker(s);
    marker.classList.add('on');
    if (!reduce) markerInk.play({ duration: 420, lift: 60 });
  }
  const tocM = $('.toc-m');
  if (tocM) $$('a', tocM).forEach((a) => a.addEventListener('click', () => { tocM.open = false; }));
  const cover = $('.a-cover img');
  const coverBox = $('.a-cover');
  const readCount = $('#readCount');
  const copyEl = $('.copy');

  /* ---------- Scroll ---------- */

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

    if (cover && !reduce) {
      const r = coverBox.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) {
        const lim = r.height * 0.05 - 1;
        const mid = r.top + r.height / 2 - innerHeight / 2;
        cover.style.setProperty('--py', r1(clamp(-mid * 0.1, -lim, lim)) + 'px');
      }
    }
    if (plainSections.length) {
      const line = innerHeight * 0.32;
      let cur = null;
      for (const s of sections) if (s.el.getBoundingClientRect().top <= line) cur = s;
      setActive(cur);
      let sec = null, idx = 0;
      plainSections.forEach((s, i) => { if (s.el.getBoundingClientRect().top <= line) { sec = s; idx = i; } });
      const cr = copyEl.getBoundingClientRect();
      const inside = cr.top < innerHeight * 0.5 && cr.bottom > innerHeight * 0.5;
      if (readCount) {
        readCount.classList.toggle('off', !inside || !sec);
        if (sec) readCount.innerHTML = 'section <b>' + String(idx + 1).padStart(2, '0') + '</b> <span>&middot; ' + (idx + 1) + ' of ' + plainSections.length + '</span>';
      }
    }
  }
  const requestFrame = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', requestFrame, { passive: true });

  const footSig = pen($('#footSig'), SIG, sigOpts(Math.min(150, innerWidth * 0.11), 'Alex Claudio'));
  watch($('#footSig'), () => footSig.play({ duration: 2500, delay: 250, lift: 60 }));

  let rz = 0;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      drawUnderlines();
      markCurrent();
      drawNavOval(false);
      if (titleLine) drawTitleLine(false);
      if (active && marker && toc.offsetParent) { active.a.classList.add('on'); placeMarker(active); marker.classList.add('on'); }
      requestFrame();
    }, 160);
  });

  /* ---------- Start ---------- */

  if (reduce) navSig.show(); else navSig.play({ duration: 1300, delay: 150, lift: 45 });
  requestAnimationFrame(() => {
    heroEls.forEach((el) => el.classList.add('in'));
    setTimeout(markCurrent, reduce ? 0 : 1100);
    setTimeout(() => drawNavOval(!reduce), reduce ? 0 : 1400);
    setTimeout(() => drawTitleLine(!reduce), reduce ? 0 : 1000);
    drawNewNote(!reduce);
    frame();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      drawUnderlines();
      markCurrent();
      if (titleLine) drawTitleLine(false);
      requestFrame();
    });
  }
})();
