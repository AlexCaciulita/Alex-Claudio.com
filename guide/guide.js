// The pricing guide's package builder. Hours, an engagement session and an album add up to a package that a couple
// can send Alex with their date, or share as a link: /guide/?h=9&s=1&a=12, or /guide/?c=signature for a collection.
// Prices come from the JSON block in index.html, so they live in one place.
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const Ink = window.Ink;

  const P = JSON.parse($('#guide-prices').textContent);
  const WORDS = { 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve' };
  const ALBUMS = {
    10: { name: '10 × 10 in leather album', sub: '30 pages, designed by me', short: 'a 10 × 10 album' },
    12: { name: '12 × 12 in leather album', sub: '40 pages, designed by me', short: 'a 12 × 12 album' }
  };
  const money = (n) => '$' + n.toLocaleString('en-US');
  const priceLabel = (n) => (n > 0 ? money(n) : n < 0 ? '\u2212' + money(-n) : 'Included');
  const listJoin = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

  const state = { hours: 8, session: false, album: '', second: true };

  const q = new URLSearchParams(location.search);
  const linked = P.collections[(q.get('c') || q.get('collection') || '').toLowerCase()];
  if (linked) Object.assign(state, { hours: linked.hours, session: linked.session, album: linked.album, second: true });
  const linkedHours = Number(q.get('h'));
  if (Number.isInteger(linkedHours) && linkedHours >= P.baseHours && linkedHours <= P.maxHours) state.hours = linkedHours;
  if (q.has('s')) state.session = q.get('s') === '1';
  if (q.has('a')) state.album = P.albums[q.get('a')] ? q.get('a') : '';
  if (q.get('p') === '0') state.second = false;

  const hoursPrice = (h) => P.base + (h - P.baseHours) * P.perHour;
  // From eight hours a second photographer comes along, so Signature and Heirloom have one.
  // The hour price already counts them; leaving them out takes P.secondPhotographer off.
  const canHaveSecond = () => state.hours >= P.secondFromHours;
  const hasSecond = () => canHaveSecond() && state.second;

  function items() {
    const rate = money(P.base) + ' for ' + WORDS[P.baseHours] + ' hours, then ' + money(P.perHour) + ' an hour';
    const list = [{ key: 'hours', name: 'Wedding day, ' + state.hours + ' hours', sub: rate, price: hoursPrice(state.hours) }];
    if (hasSecond()) list.push({ key: 'second', name: 'Second photographer', sub: 'Included from ' + P.secondFromHours + ' hours', price: 0 });
    else if (canHaveSecond()) list.push({ key: 'second', name: 'Without a second photographer', sub: 'Just me, for all ' + WORDS[state.hours] + ' hours', price: -P.secondPhotographer });
    if (state.session) list.push({ key: 'session', name: 'Engagement session', sub: '60 minutes, before the wedding', price: P.session });
    if (state.album) list.push({ key: 'album', name: ALBUMS[state.album].name, sub: ALBUMS[state.album].sub, price: P.albums[state.album] });
    return list;
  }
  const total = () => items().reduce((sum, it) => sum + it.price, 0);

  function matching() {
    const c = Object.values(P.collections).find((x) => x.hours === state.hours && x.session === state.session && x.album === state.album && hasSecond() === x.hours >= P.secondFromHours);
    return c ? c.name : '';
  }

  function words() {
    const parts = [WORDS[state.hours] + ' hours of coverage' + (hasSecond() ? ' with a second photographer' : canHaveSecond() ? ' without a second photographer' : '')];
    if (state.album) parts.push(ALBUMS[state.album].short);
    if (state.session) parts.push('an engagement session');
    return listJoin(parts);
  }

  const query = () => '?h=' + state.hours + (state.session ? '&s=1' : '') + (state.album ? '&a=' + state.album : '') + (canHaveSecond() && !state.second ? '&p=0' : '');

  /* ---------- Handwriting ---------- */

  function sigOpts(em, label) {
    return {
      font: 'society', em,
      nib: { n: em > 60 ? 11 : 7, w: em * 0.036, angle: 35 },
      sw: Math.max(0.55, em * 0.0072),
      padX: 40, top: 980, bottom: 330,
      label
    };
  }

  function watch(el, fn, margin = '0px 0px -12% 0px') {
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
    }, { rootMargin: margin });
    io.observe(el);
  }

  if (Ink) {
    const markSig = Ink.pen($('#mark'), 'Alex Claudio', sigOpts(innerWidth < 600 ? 24 : 30));
    markSig.play({ duration: 1800, delay: 200, lift: 40 });
    const coverNote = Ink.pen($('#coverNote'), 'for the two of you', { font: 'felix', em: clamp(innerWidth * 0.022, 19, 32), sw: 1.5 });
    coverNote.play({ duration: 1500, delay: 1100 });
    const helloSig = Ink.pen($('#helloSig'), 'Alex Claudio', sigOpts(Math.min(84, innerWidth * 0.16), 'Alex Claudio'));
    watch($('#helloSig'), () => helloSig.play({ duration: 2200, delay: 200, lift: 50 }));
    const footSig = Ink.pen($('#footSig'), 'Alex Claudio', sigOpts(Math.min(150, innerWidth * 0.11), 'Alex Claudio'));
    watch($('#footSig'), () => footSig.play({ duration: 2500, delay: 250, lift: 60 }));
  } else {
    document.documentElement.classList.remove('js');
  }

  /* ---------- Cover and navigation ---------- */

  const cover = $('.cover');
  const nav = $('#nav');
  requestAnimationFrame(() => cover.classList.add('ready'));
  let navQueued = false;
  function navTone() {
    navQueued = false;
    const overCover = cover.getBoundingClientRect().bottom > nav.offsetHeight;
    nav.classList.toggle('on-dark', overCover);
    nav.classList.toggle('solid', !overCover);
  }
  addEventListener('scroll', () => { if (!navQueued) { navQueued = true; requestAnimationFrame(navTone); } }, { passive: true });
  navTone();

  const risers = $$('[data-rise]');
  const riseIo = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      riseIo.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  risers.forEach((el) => {
    const siblings = Array.from(el.parentElement.children).filter((x) => x.hasAttribute('data-rise'));
    const i = siblings.indexOf(el);
    if (i > 0) el.style.transitionDelay = Math.min(i, 6) * 70 + 'ms';
    riseIo.observe(el);
  });

  /* ---------- The day: when the hours fall ---------- */

  const DAY0 = 660, DAY1 = 1440, SPAN = DAY1 - DAY0;
  const MOMENTS = [
    [780, 'getting dressed', 'getting dressed'],
    [870, 'first look', 'the first look'],
    [960, 'ceremony', 'the ceremony'],
    [1000, 'family photos', 'family photos'],
    [1080, 'dinner', 'dinner and toasts'],
    [1185, 'golden hour', 'golden hour'],
    [1230, 'first dance', 'the first dance'],
    [1350, 'send-off', 'the send-off']
  ];
  // Where the window sits for each length until the couple moves it.
  const START = { 6: 840, 7: 810, 8: 780, 9: 780, 10: 765, 11: 720, 12: 690 };
  let start = START[state.hours];
  let moved = false;

  function fmt(m) {
    if (m === 720) return 'noon';
    if (m === 1440) return 'midnight';
    const h = Math.floor(m / 60) % 24, mm = m % 60;
    return (h % 12 || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? ' am' : ' pm');
  }
  function fmtRange(a, b) {
    const plain = ![720, 1440].includes(a) && ![720, 1440].includes(b) && (a < 720) === (b < 720);
    return (plain ? fmt(a).replace(/ [ap]m$/, '') : fmt(a)) + ' to ' + fmt(b);
  }

  const dayline = $('#dayline'), win = $('#win'), winLabel = $('#winLabel'), fit = $('#fit');
  const dayScroll = $('.day-scroll');
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
    const label = document.createElement('span');
    label.className = 'ml';
    label.textContent = name;
    const time = document.createElement('small');
    time.textContent = fmt(m);
    label.appendChild(time);
    const dot = document.createElement('span');
    dot.className = 'dot';
    el.append(dot, label);
    dayline.appendChild(el);
    return { el, m, phrase };
  });

  function renderDay() {
    const length = state.hours * 60;
    const end = start + length;
    win.style.left = ((start - DAY0) / SPAN) * 100 + '%';
    win.style.width = (length / SPAN) * 100 + '%';
    winLabel.textContent = fmtRange(start, end);
    win.setAttribute('aria-valuemin', DAY0);
    win.setAttribute('aria-valuemax', DAY1 - length);
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
      ? 'Everything on this example day fits inside your ' + WORDS[state.hours] + ' hours.'
      : 'Inside your hours: ' + inside.length + ' of ' + MOMENTS.length + ' moments. Outside them: ' + listJoin(outside) + '.';
  }

  function centerWindow(smooth) {
    if (dayScroll.scrollWidth <= dayScroll.clientWidth + 2) return;
    const x = dayline.offsetLeft + ((start - DAY0 + state.hours * 30) / SPAN) * dayline.offsetWidth;
    dayScroll.scrollTo({ left: Math.max(0, x - dayScroll.clientWidth / 2), behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }

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
    const next = clamp(Math.round((drag.s + dm) / 15) * 15, DAY0, DAY1 - state.hours * 60);
    if (next !== start) { start = next; moved = true; renderDay(); }
  });
  const endDrag = () => { if (!drag) return; drag = null; win.classList.remove('dragging'); };
  win.addEventListener('pointerup', endDrag);
  win.addEventListener('pointercancel', endDrag);
  win.addEventListener('keydown', (e) => {
    const last = DAY1 - state.hours * 60;
    const step = { ArrowLeft: -15, ArrowDown: -15, ArrowRight: 15, ArrowUp: 15, PageDown: -60, PageUp: 60 }[e.key];
    if (step) start = clamp(start + step, DAY0, last);
    else if (e.key === 'Home') start = DAY0;
    else if (e.key === 'End') start = last;
    else return;
    e.preventDefault();
    moved = true;
    renderDay();
  });

  /* ---------- The package sheet ---------- */

  const builder = $('#builder');
  const sheet = $('#sheet');
  const linesEl = $('#sheetLines');
  const totalEl = $('#total'), statusEl = $('#totalStatus'), barTotal = $('#barTotal');
  const matchEl = $('#sheetMatch');
  let shownKeys = new Set(items().map((it) => it.key));
  let shownTotal = total();
  let tween = 0;
  let lastMatch = null;

  function syncInputs() {
    $$('.hour input', builder).forEach((i) => {
      i.checked = Number(i.value) === state.hours;
      i.parentElement.classList.toggle('on', i.checked);
    });
    const second = $('#second');
    second.checked = hasSecond();
    second.disabled = !canHaveSecond();
    second.parentElement.classList.toggle('on', hasSecond());
    second.parentElement.classList.toggle('is-off', !canHaveSecond());
    $('#secondMeta').textContent = canHaveSecond()
      ? (state.second ? 'Included \u00b7 leave out for ' + money(P.secondPhotographer) + ' off' : 'Left out \u00b7 ' + money(P.secondPhotographer) + ' off')
      : 'Comes with ' + WORDS[P.secondFromHours] + ' hours or more';
    const session = $('#session');
    session.checked = state.session;
    session.parentElement.classList.toggle('on', state.session);
    $$('.album input', builder).forEach((i) => {
      i.checked = i.value === state.album;
      i.parentElement.classList.toggle('on', i.checked);
    });
  }

  function renderSheet() {
    const list = items();
    linesEl.textContent = '';
    for (const it of list) {
      const li = document.createElement('li');
      li.className = 'line' + (shownKeys.has(it.key) ? '' : ' new');
      const name = document.createElement('span');
      name.className = 'l-name';
      name.textContent = it.name;
      const sub = document.createElement('small');
      sub.textContent = it.sub;
      name.appendChild(sub);
      const lead = document.createElement('span');
      lead.className = 'lead';
      const price = document.createElement('span');
      price.className = 'l-price';
      price.textContent = priceLabel(it.price);
      li.append(name, lead, price);
      linesEl.appendChild(li);
    }
    shownKeys = new Set(list.map((it) => it.key));
  }

  function showTotal(to) {
    cancelAnimationFrame(tween);
    const paint = (n) => { totalEl.textContent = money(n); barTotal.textContent = money(n); };
    const from = shownTotal;
    if (reduce || from === to) { shownTotal = to; paint(to); return; }
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / 650);
      shownTotal = t === 1 ? to : Math.round((from + (to - from) * (1 - Math.pow(1 - t, 3))) / 10) * 10;
      paint(shownTotal);
      if (t < 1) tween = requestAnimationFrame(frame);
    };
    tween = requestAnimationFrame(frame);
  }

  function renderMatch(play) {
    const name = matching();
    if (name === lastMatch) return;
    lastMatch = name;
    matchEl.textContent = '';
    if (!name) return;
    if (!Ink) { matchEl.textContent = 'The same as my ' + name + ' collection.'; return; }
    const note = Ink.pen(matchEl, "that's my " + name, { font: 'felix', em: 26, sw: 1.5, label: 'The same as my ' + name + ' collection' });
    if (play && !reduce) note.play({ duration: 1100 }); else note.show();
  }

  function renderLetter() {
    $('#pkgWords').textContent = words();
    $('#pkgTotal').textContent = money(total());
  }

  function update(user) {
    syncInputs();
    renderSheet();
    showTotal(total());
    renderMatch(user);
    renderLetter();
    const name = matching();
    statusEl.textContent = 'Estimated total ' + money(total()) + (name ? ', the same as my ' + name + ' collection.' : '.');
    if (user) {
      try { history.replaceState(null, '', location.pathname + query() + location.hash); } catch (e) { /* the address bar keeps the old link */ }
      $('#copied').textContent = '';
    }
  }

  function setHours(h, user) {
    state.hours = h;
    if (!moved) start = START[h];
    start = clamp(start, DAY0, DAY1 - h * 60);
    renderDay();
    update(user);
    if (user) centerWindow(true);
  }

  builder.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'hours') setHours(Number(t.value), true);
    else if (t.name === 'session') { state.session = t.checked; update(true); }
    else if (t.name === 'second') { state.second = t.checked; update(true); }
    else if (t.name === 'album') { state.album = t.value; update(true); }
  });
  builder.addEventListener('submit', (e) => e.preventDefault());

  $$('[data-start]').forEach((button) => button.addEventListener('click', () => {
    const c = P.collections[button.dataset.start];
    state.session = c.session;
    state.album = c.album;
    state.second = true;
    moved = false;
    setHours(c.hours, true);
    $('#build').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    sheet.classList.remove('flash');
    void sheet.offsetWidth;
    sheet.classList.add('flash');
  }));

  $('#copyLink').addEventListener('click', async () => {
    const url = location.origin + '/guide/' + query() + '#build';
    const note = $('#copied');
    try {
      await navigator.clipboard.writeText(url);
      note.textContent = 'Link copied. It opens this guide with your package filled in.';
    } catch (e) {
      note.textContent = 'Copy this link: ' + url;
    }
  });

  $('#sendPkg').addEventListener('click', (e) => {
    e.preventDefault();
    $('#send').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setTimeout(() => $('#fNames').focus({ preventScroll: true }), reduce ? 0 : 700);
  });

  // On a phone the sheet sits below the choices, so a small bar keeps the total in view while choosing.
  const bar = $('#bar');
  let buildIn = false, sheetIn = false;
  const barIo = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.target === sheet) sheetIn = e.isIntersecting; else buildIn = e.isIntersecting; });
    bar.classList.toggle('show', buildIn && !sheetIn);
  }, { rootMargin: '0px 0px -30% 0px' });
  barIo.observe($('.controls'));
  barIo.observe(sheet);

  /* ---------- The letter ---------- */

  const form = $('#sendForm');
  const sizeInput = (el) => { el.style.width = Math.max(el.value.length, el.placeholder.length) + 1.4 + 'ch'; };
  $$('.lines input', form).forEach((el) => {
    sizeInput(el);
    el.addEventListener('input', () => { sizeInput(el); el.classList.remove('bad'); });
  });

  function message() {
    const lines = items().map((it) => it.name + ': ' + priceLabel(it.price).toLowerCase());
    lines.push('Estimated total: ' + money(total()));
    if (moved) lines.push('Coverage window: ' + fmtRange(start, start + state.hours * 60));
    const notes = $('#notes').value.trim();
    return 'Package from the pricing guide\n' + lines.join('\n') + (notes ? '\n\nAnything else: ' + notes : '');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#formError');
    const bad = [];
    ['fNames', 'fDate', 'fEmail'].forEach((id) => {
      const el = $('#' + id);
      const v = el.value.trim();
      const ok = id === 'fEmail' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) : v.length > 0;
      el.classList.toggle('bad', !ok);
      if (!ok) bad.push(el);
    });
    if (bad.length) {
      err.textContent = 'Your names, the date and an email are all I need to reply.';
      bad[0].focus();
      return;
    }
    if (form.classList.contains('sending')) return;
    const send = $('button[type="submit"]', form);
    const data = new URLSearchParams();
    data.set('form-name', 'contact');
    for (const name of ['names', 'event_date', 'location', 'email', 'company']) data.set(name, form.elements[name].value.trim());
    data.set('hours', WORDS[state.hours] + ' hours');
    data.set('collection', matching() || 'Custom package');
    data.set('message', message());
    form.classList.add('sending');
    send.disabled = true;
    err.textContent = 'Sending your letter…';
    let ok = false;
    try {
      const res = await fetch(form.dataset.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: data.toString() });
      ok = res.ok;
      if (!ok) {
        const body = await res.json().catch(() => ({}));
        err.textContent = res.status === 429 ? 'Too many letters sent from here in a short time. Please try again in a few minutes, or write to contact@alex-claudio.com.'
          : body.error ? body.error + '. You can also write to contact@alex-claudio.com.' : 'Your letter did not go through. Please try again, or write to contact@alex-claudio.com.';
      }
    } catch (e2) {
      err.textContent = 'Your letter did not go through. Please check your connection and try again, or write to contact@alex-claudio.com.';
    }
    form.classList.remove('sending');
    send.disabled = false;
    if (!ok) return;
    err.textContent = '';
    form.classList.add('sent');
    const box = $('#thanks');
    box.textContent = '';
    if (!Ink) { box.textContent = "Thank you. I'll write back within a few hours."; return; }
    const em = innerWidth < 600 ? 26 : 40;
    const lines = innerWidth < 600 ? ['thank you.', "I'll write back", 'within a few hours.'] : ['thank you.', "I'll write back within a few hours."];
    const pens = lines.map((t, i) => Ink.pen(box, t, { font: 'felix', em, sw: 1.6, label: i === 0 ? "Thank you. I'll write back within a few hours." : undefined }));
    for (const [i, p] of pens.entries()) await p.play({ duration: i === 0 ? 900 : 1500, delay: i ? 120 : 0 });
  });

  /* ---------- First paint ---------- */

  renderDay();
  update(false);
  // On a phone the day line scrolls sideways; start with the window in view.
  requestAnimationFrame(() => centerWindow(false));
  addEventListener('load', () => centerWindow(false), { once: true });
})();
