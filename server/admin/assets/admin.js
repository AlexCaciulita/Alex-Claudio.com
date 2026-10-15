// The studio dashboard. Everything is drawn with DOM methods, so text from inquiries is never read as HTML.
(() => {
  'use strict';

  const CSRF = (document.querySelector('meta[name="csrf"]') || {}).content || '';
  const app = document.getElementById('app');
  const STATUSES = [['new', 'New'], ['replied', 'Replied'], ['booked', 'Booked'], ['not_booked', 'Not booked']];
  const STATUS_LABEL = Object.fromEntries(STATUSES);
  const FORM_LABEL = { contact: 'Website letter', 'wedding-show-lead': 'Wedding show sign-up', manual: 'Added by hand', 'earlier-dashboard': 'From the earlier dashboard' };
  const LIMITS = { names: 300, email: 300, phone: 100, event_date: 200, location: 300, hours: 300, care: 1000, message: 5000, source: 300 };
  const TEXT_FIELDS = Object.keys(LIMITS);
  // Only plain addresses become mailto links, so nothing a visitor typed can add recipients or headers.
  const LINKABLE_EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
  const SHOWN_FIELDS = new Set(['names', 'name', 'email', 'phone', 'phone_number', 'event_date', 'location', 'hours', 'care', 'message', 'source', 'referral']);
  const EXTRA_LABELS = { budget: 'Estimated budget', collection: 'Collection' };
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const NOT_COUNTED = 'ac-not-counted';

  // This browser belongs to the studio, so the website stops counting its visits (assets/visits.js reads this).
  try { if (localStorage.getItem(NOT_COUNTED) === null) localStorage.setItem(NOT_COUNTED, '1'); } catch (error) { /* storage is blocked */ }

  /* ---------- Building blocks ---------- */

  function append(el, kids) {
    for (const kid of [kids].flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false || kid === '') continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key === 'value') el.value = value;
      else if (key === 'disabled' || key === 'required') el[key] = true;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    return append(el, kids);
  }

  const clear = (el) => { el.replaceChildren(); return el; };
  const plural = (n, one, many) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;
  const wholeDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
  const fmtMoney = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '\u2014' : (Number.isInteger(Number(n)) ? wholeDollars : cents).format(Number(n)));
  const localDate = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); };
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fmtDay = (iso, long) => localDate(iso).toLocaleDateString('en-US', long
    ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtReceived = (stamp) => new Date(stamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtStamp = (stamp) => new Date(stamp).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtSize = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
  const telHref = (phone) => {
    const dialed = String(phone || '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
    return dialed.replace(/\D/g, '').length >= 7 ? `tel:${dialed}` : null;
  };
  const coupleName = (inq) => inq.names || inq.email || 'No name';
  const statusBadge = (status) => h('span', { class: `badge s-${status}` }, STATUS_LABEL[status] || status);

  /* ---------- Talking to the website ---------- */

  async function api(path, options = {}) {
    const init = { method: options.method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json', 'X-CSRF-Token': CSRF } };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    let res;
    try {
      res = await fetch(`/admin/api${path}`, init);
    } catch (error) {
      throw new Error('Can\u2019t reach the website. Check the connection and try again.');
    }
    if (res.status === 401) {
      location.assign('/admin/login');
      const error = new Error('Signed out.');
      error.silent = true;
      throw error;
    }
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || `Something went wrong (${res.status}).`);
      error.status = res.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }

  // The message bubble is a popover when the browser supports it, so it also shows above open dialogs.
  const toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  const canPopover = typeof toast.showPopover === 'function';
  if (canPopover) toast.setAttribute('popover', 'manual');
  let toastTimer = 0;
  function say(message, kind) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle('error', kind === 'error');
    toast.classList.add('show');
    if (canPopover) {
      try { toast.hidePopover(); } catch (error) { /* it was not showing */ }
      try { toast.showPopover(); } catch (error) { /* shown without the top layer */ }
    }
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      if (canPopover) { try { toast.hidePopover(); } catch (error) { /* already hidden */ } }
    }, kind === 'error' ? 6000 : 2800);
  }
  const fail = (error) => { if (!error.silent) say(error.message, 'error'); };
  const problem = (error, whenNoDatabase) => (error.code === 'no-database'
    ? h('p', { class: 'empty' }, whenNoDatabase, ' ', h('a', { href: '#setup' }, 'See Setup.'))
    : h('p', { class: 'error-text' }, error.message));

  /* ---------- Page frame ---------- */

  const views = {
    inquiries: { label: 'Inquiries', render: renderInquiries },
    analytics: { label: 'Analytics', render: renderAnalytics },
    calendar: { label: 'Calendar', render: renderCalendar },
    records: { label: 'Old records', render: renderRecords },
    setup: { label: 'Setup', render: renderSetup }
  };
  const navLinks = {};
  const main = h('main', { class: 'view', id: 'main', tabindex: '-1' });
  const detail = h('dialog', { class: 'sheet', 'aria-labelledby': 'detail-title' });
  const editor = h('dialog', { class: 'sheet editor', 'aria-labelledby': 'editor-title' });
  const state = { refresh: null, token: 0 };
  const refreshCurrent = () => { if (state.refresh) state.refresh(); };

  app.append(
    h('header', { class: 'top' },
      h('a', { class: 'brand', href: '#inquiries' },
        h('img', { src: '/favicon.svg', alt: '', width: 32, height: 32 }),
        h('span', {}, 'Alex Claudio'),
        h('small', {}, 'Studio')),
      h('nav', { class: 'nav', 'aria-label': 'Dashboard' },
        Object.entries(views).map(([key, view]) => (navLinks[key] = h('a', { href: `#${key}` }, view.label)))),
      h('div', { class: 'top-actions' },
        h('a', { href: '/', target: '_blank', rel: 'noopener' }, 'Website'),
        h('button', { class: 'quiet', type: 'button', onclick: signOut }, 'Sign out'))),
    main, detail, editor, toast);

  function route() {
    const wanted = location.hash.replace(/^#/, '');
    const key = views[wanted] ? wanted : 'inquiries';
    const token = ++state.token;
    for (const [name, link] of Object.entries(navLinks)) {
      if (name === key) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.title = `${views[key].label} \u00b7 Studio \u00b7 Alex Claudio`;
    state.refresh = null;
    clear(main);
    // Answers that arrive after the view has changed are dropped.
    views[key].render(main, () => token === state.token);
  }

  async function signOut() {
    try {
      await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': CSRF } });
    } catch (error) { /* the sign-in page is shown either way */ }
    location.assign('/admin/login');
  }

  /* ---------- Inquiries ---------- */

  const listState = { q: '', status: '' };

  function renderInquiries(root, live) {
    const banner = h('div');
    const cards = h('div', { class: 'cards', hidden: true });
    const listWrap = h('div', { class: 'list-wrap' }, h('p', { class: 'muted' }, 'Loading\u2026'));
    const search = h('input', { type: 'search', placeholder: 'Search names, emails, places\u2026', 'aria-label': 'Search inquiries', value: listState.q });
    const chipButtons = [['', 'All'], ...STATUSES].map(([value, label]) => h('button', {
      type: 'button',
      'aria-pressed': String(listState.status === value),
      onclick: (event) => {
        listState.status = value;
        for (const chip of chipButtons) chip.setAttribute('aria-pressed', String(chip === event.currentTarget));
        loadList();
      }
    }, label));
    let typing = 0;
    search.addEventListener('input', () => {
      clearTimeout(typing);
      typing = setTimeout(() => { listState.q = search.value.trim(); loadList(); }, 250);
    });

    root.append(
      h('div', { class: 'view-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Letters from couples'), h('h1', {}, 'Inquiries')),
        h('button', { class: 'primary', type: 'button', onclick: () => openEditor(null) }, '+ Add an inquiry')),
      banner, cards,
      h('div', { class: 'toolbar' }, search, h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' }, chipButtons)),
      listWrap);

    let listSeq = 0;
    async function loadList() {
      const mine = ++listSeq;
      const params = new URLSearchParams();
      if (listState.q) params.set('q', listState.q);
      if (listState.status) params.set('status', listState.status);
      const query = params.toString();
      try {
        const { inquiries } = await api(`/inquiries${query ? `?${query}` : ''}`);
        if (mine === listSeq && live()) drawList(listWrap, inquiries);
      } catch (error) {
        if (mine === listSeq && live()) clear(listWrap).append(problem(error, 'Inquiries appear here once the website has a volume to save to.'));
      }
    }

    async function loadOverview() {
      try {
        const data = await api('/overview');
        if (!live()) return;
        drawCards(cards, data.stats);
        clear(banner);
        if (!data.db.connected) banner.append(databaseBanner(data.db));
      } catch (error) {
        if (live()) fail(error);
      }
    }

    state.refresh = () => { loadOverview(); loadList(); };
    state.refresh();
  }

  function databaseBanner(db) {
    return h('div', { class: 'banner', role: 'note' },
      h('strong', {}, db.configured ? 'The dashboard\u2019s file can\u2019t be opened.' : 'The dashboard has nowhere to save yet.'),
      h('p', {}, db.configured
        ? 'Letters still arrive by email. They will be saved here again as soon as the file can be opened.'
        : 'Letters still arrive by email, but they aren\u2019t saved here until the website has a volume.'),
      h('a', { href: '#setup' }, 'See Setup'));
  }

  function drawCards(cards, stats) {
    clear(cards);
    cards.hidden = !stats;
    if (!stats) return;
    const card = (label, value, note, hot) => h('div', { class: hot ? 'card hot' : 'card' },
      h('span', { class: 'card-label' }, label), h('strong', {}, value), h('small', {}, note));
    cards.append(
      card('New', String(stats.new), stats.new ? 'waiting for a reply' : 'all answered', stats.new > 0),
      card('Replied', String(stats.replied), 'waiting on the couple'),
      card('Booked', String(stats.booked), `${stats.upcoming} still ahead`),
      card(`${stats.year} weddings`, fmtMoney(stats.year_agreed), `${fmtMoney(stats.year_paid)} received`));
  }

  function drawList(wrap, inquiries) {
    clear(wrap);
    if (!inquiries.length) {
      wrap.append(h('p', { class: 'empty' }, listState.q || listState.status
        ? 'Nothing matches.'
        : 'No inquiries yet. New letters from the website appear here as they arrive.'));
      return;
    }
    const cell = (className, value) => h('td', { class: value ? className : `${className} is-empty` }, value || '\u2014');
    const rows = inquiries.map((inq) => {
      const open = () => openDetail(inq.id);
      const sub = [inq.names && inq.email ? inq.email : '', inq.note_count ? plural(inq.note_count, 'note', 'notes') : ''].filter(Boolean).join(' \u00b7 ');
      return h('tr', {
        class: inq.status === 'new' ? 'is-new' : null,
        tabindex: '0',
        onclick: open,
        onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }
      },
      h('td', { class: 'c-received' }, fmtReceived(inq.created_at)),
      h('td', { class: 'c-couple' }, h('strong', {}, coupleName(inq)), sub ? h('small', {}, sub) : null),
      cell('c-wedding', inq.wedding_date ? fmtDay(inq.wedding_date) : inq.event_date),
      cell('c-place', inq.location),
      cell('c-hours', inq.hours),
      h('td', { class: 'c-status' }, statusBadge(inq.status)));
    });
    wrap.append(h('table', { class: 'list' },
      h('thead', {}, h('tr', {}, ['Received', 'Couple', 'Wedding', 'Place', 'Coverage', 'Status'].map((title) => h('th', { scope: 'col' }, title)))),
      h('tbody', {}, rows)));
    if (inquiries.length >= 500) wrap.append(h('p', { class: 'muted small' }, 'Showing the latest 500. Search to find older ones.'));
  }

  /* ---------- One inquiry ---------- */

  let detailSeq = 0;
  detail.addEventListener('close', () => {
    if (detail.dataset.changed) {
      delete detail.dataset.changed;
      refreshCurrent();
    }
  });
  detail.addEventListener('click', (event) => { if (event.target === detail) detail.close(); });

  async function openDetail(id) {
    const mine = ++detailSeq;
    let data;
    try {
      data = await api(`/inquiries/${encodeURIComponent(id)}`);
    } catch (error) {
      fail(error);
      return;
    }
    if (mine !== detailSeq) return;
    drawDetail(data.inquiry, data.notes);
    if (!detail.open) detail.showModal();
  }

  function drawDetail(inq, notes) {
    // A change that finishes after the sheet has closed refreshes the page behind it right away.
    const changed = () => { if (detail.open) detail.dataset.changed = '1'; else refreshCurrent(); };
    // Saves go out one at a time, in order, so an older answer can never overwrite a newer choice.
    // A control is set back to the saved value only once nothing more is waiting for it.
    let queue = Promise.resolve();
    const pending = { status: 0, wedding_date: 0 };
    const save = (field, value, message) => {
      pending[field] += 1;
      queue = queue.then(async () => {
        try {
          const { inquiry } = await api(`/inquiries/${inq.id}`, { method: 'PATCH', body: { [field]: value } });
          Object.assign(inq, inquiry);
          changed();
          drawMoney();
          drawWrote();
          say(message);
        } catch (error) {
          fail(error);
        } finally {
          pending[field] -= 1;
          if (!pending[field]) showSaved(field);
        }
      });
      return queue;
    };

    const statusSelect = h('select', { id: 'd-status' }, STATUSES.map(([value, label]) => h('option', { value }, label)));
    statusSelect.value = inq.status;
    statusSelect.addEventListener('change', () => save('status', statusSelect.value, `Marked ${STATUS_LABEL[statusSelect.value].toLowerCase()}.`));

    // Chrome and Edge report a new date after every digit typed (0002, 0020, 0202, 2028), so the date
    // is saved only once it is complete and within range, after a pause or when the field is left.
    const dateInput = h('input', { id: 'd-date', type: 'date', min: '2000-01-01', max: '2100-12-31', value: inq.wedding_date || '' });
    let requestedDate = inq.wedding_date || null;
    let dateTimer = 0;
    const saveDate = () => {
      clearTimeout(dateTimer);
      if (!dateInput.validity.valid) return;
      const value = dateInput.value || null;
      if (value === requestedDate) return;
      requestedDate = value;
      save('wedding_date', value, value ? 'Wedding date saved.' : 'Wedding date cleared.');
    };
    const saveDateSoon = () => { clearTimeout(dateTimer); dateTimer = setTimeout(saveDate, 1200); };
    dateInput.addEventListener('input', saveDateSoon);
    dateInput.addEventListener('change', saveDateSoon);
    dateInput.addEventListener('blur', saveDate);
    const showSaved = (field) => {
      if (field === 'status') {
        statusSelect.value = inq.status;
        return;
      }
      requestedDate = inq.wedding_date || null;
      if (document.activeElement !== dateInput) dateInput.value = requestedDate || '';
    };
    const settled = () => { saveDate(); return queue; };

    const wrote = h('p', { class: 'wrote' });
    const drawWrote = () => {
      wrote.textContent = inq.event_date && !inq.wedding_date
        ? `They wrote \u201c${inq.event_date}\u201d. Set the date above to put it on the calendar.`
        : '';
      wrote.hidden = !wrote.textContent;
    };
    drawWrote();

    const facts = h('dl', { class: 'facts' });
    const fact = (label, value) => { if (value) facts.append(h('div', {}, h('dt', {}, label), h('dd', {}, value))); };
    const mailable = inq.email && LINKABLE_EMAIL.test(inq.email);
    const tel = telHref(inq.phone);
    fact('Email', mailable ? h('a', { href: `mailto:${inq.email}` }, inq.email) : inq.email);
    fact('Phone', inq.phone && tel ? h('a', { href: tel }, inq.phone) : inq.phone);
    fact('Their date, as they wrote it', inq.event_date);
    fact('Place', inq.location);
    fact('Coverage', inq.hours);
    fact('The part of the day they care about most', inq.care ? h('span', { class: 'pre' }, inq.care) : '');
    fact('Message', inq.message ? h('span', { class: 'pre' }, inq.message) : '');
    fact('How they found us', inq.source);
    for (const [key, value] of Object.entries(inq.fields || {})) {
      if (!SHOWN_FIELDS.has(key) && value) fact(EXTRA_LABELS[key] || key.replace(/[_-]+/g, ' '), h('span', { class: 'pre' }, String(value)));
    }
    fact('Came in through', FORM_LABEL[inq.form_name] || inq.form_name);

    const money = h('div', { class: 'money', 'aria-label': 'Money' });
    const drawMoney = () => {
      const balance = inq.price === null || inq.price === undefined ? null : Math.max(0, inq.price - (inq.paid || 0));
      clear(money).append(
        h('div', {}, h('span', {}, 'Agreed'), h('strong', {}, fmtMoney(inq.price))),
        h('div', {}, h('span', {}, 'Received'), h('strong', {}, fmtMoney(inq.paid))),
        h('div', {}, h('span', {}, 'Balance'), h('strong', {}, fmtMoney(balance))));
    };
    drawMoney();

    const remove = async () => {
      await settled();
      if (!window.confirm(`Delete the inquiry from ${coupleName(inq)}? Its notes go too. This can\u2019t be undone.`)) return;
      try {
        await api(`/inquiries/${inq.id}`, { method: 'DELETE' });
        changed();
        detail.close();
        say('Inquiry deleted.');
      } catch (error) {
        fail(error);
      }
    };

    const noteText = h('textarea', { id: 'd-note', rows: 3, maxlength: 5000, 'aria-label': 'New private note', placeholder: 'A call, a detail to remember, what you promised\u2026' });
    const noteButton = h('button', { type: 'submit' }, 'Add note');
    const noteList = h('ul', { class: 'notes' });
    const drawNotes = () => {
      clear(noteList);
      if (!notes.length) {
        noteList.append(h('li', { class: 'empty-note' }, 'No notes yet.'));
        return;
      }
      for (const note of notes) {
        noteList.append(h('li', {},
          h('div', { class: 'note-meta' },
            h('span', {}, fmtStamp(note.created_at)),
            h('button', {
              class: 'link',
              type: 'button',
              onclick: async () => {
                if (!window.confirm('Delete this note?')) return;
                try {
                  await api(`/notes/${note.id}`, { method: 'DELETE' });
                  notes = notes.filter((other) => other.id !== note.id);
                  changed();
                  drawNotes();
                } catch (error) {
                  fail(error);
                }
              }
            }, 'Delete')),
          h('p', { class: 'pre' }, note.body)));
      }
    };
    drawNotes();
    const noteForm = h('form', {
      class: 'note-form',
      onsubmit: async (event) => {
        event.preventDefault();
        const body = noteText.value.trim();
        if (!body) { noteText.focus(); return; }
        noteButton.disabled = true;
        try {
          const { note } = await api(`/inquiries/${inq.id}/notes`, { method: 'POST', body: { body } });
          notes = [note, ...notes];
          noteText.value = '';
          changed();
          drawNotes();
        } catch (error) {
          fail(error);
        }
        noteButton.disabled = false;
      }
    }, noteText, noteButton);

    clear(detail).append(
      h('div', { class: 'sheet-head' },
        h('div', {},
          h('p', { class: 'eyebrow' }, `${FORM_LABEL[inq.form_name] || inq.form_name} \u00b7 received ${fmtStamp(inq.created_at)}`),
          h('h2', { id: 'detail-title' }, coupleName(inq))),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close', onclick: () => detail.close() }, '\u00d7')),
      h('div', { class: 'sheet-body' },
        h('section', {},
          h('div', { class: 'quick' },
            h('label', { for: 'd-status' }, 'Status', statusSelect),
            h('label', { for: 'd-date' }, 'Wedding date', dateInput)),
          wrote, facts, money,
          h('div', { class: 'actions' },
            mailable ? h('a', { class: 'button primary', href: `mailto:${inq.email}?subject=${encodeURIComponent('Your wedding \u00b7 Alex Claudio Photography')}` }, 'Reply by email') : null,
            h('button', { type: 'button', onclick: async () => { await settled(); detail.close(); openEditor(inq); } }, 'Edit details'),
            h('button', { class: 'danger', type: 'button', onclick: remove }, 'Delete'))),
        h('section', { class: 'detail-notes', 'aria-labelledby': 'notes-title' },
          h('h3', { id: 'notes-title' }, 'Private notes'),
          h('p', { class: 'muted small' }, 'Only you see these.'),
          noteForm, noteList)));
  }

  /* ---------- Add or edit ---------- */

  function openEditor(inq) {
    const isNew = !inq;
    const values = inq || { status: 'new' };
    const shown = (name) => (values[name] === null || values[name] === undefined ? '' : String(values[name]));
    const field = (name, label, options = {}) => {
      const id = `e-${name}`;
      const control = options.multiline
        ? h('textarea', { id, name, rows: options.rows || 3, maxlength: LIMITS[name], value: shown(name) })
        : h('input', {
          id, name, type: options.type || 'text', value: shown(name), maxlength: LIMITS[name], min: options.min, max: options.max,
          inputmode: options.inputmode, placeholder: options.placeholder, autocomplete: 'off'
        });
      return h('label', { class: options.span || null, for: id }, label, control);
    };
    const status = h('select', { id: 'e-status', name: 'status' }, STATUSES.map(([value, label]) => h('option', { value }, label)));
    status.value = values.status || 'new';
    const error = h('p', { class: 'error-text', role: 'alert' });
    const submit = h('button', { class: 'primary', type: 'submit' }, isNew ? 'Add inquiry' : 'Save changes');

    const form = h('form', { class: 'editor-form', novalidate: true },
      h('div', { class: 'form-grid' },
        field('names', 'Couple\u2019s names', { span: 'span2' }),
        h('label', { for: 'e-status' }, 'Status', status),
        field('email', 'Email', { type: 'email' }),
        field('phone', 'Phone', { type: 'tel' }),
        field('wedding_date', 'Wedding date', { type: 'date', min: '2000-01-01', max: '2100-12-31' }),
        field('event_date', 'Their date, as they wrote it', { placeholder: 'e.g. next June' }),
        field('location', 'Place'),
        field('hours', 'Coverage', { placeholder: 'e.g. eight hours' }),
        field('price', 'Agreed price ($)', { inputmode: 'decimal', placeholder: '4000' }),
        field('paid', 'Received so far ($)', { inputmode: 'decimal', placeholder: '0' }),
        field('source', 'How they found us'),
        field('care', 'The part of the day they care about most', { span: 'wide', multiline: true, rows: 2 }),
        field('message', 'Message', { span: 'wide', multiline: true, rows: 5 })),
      h('div', { class: 'form-actions' },
        submit,
        h('button', { type: 'button', onclick: () => { editor.close(); if (!isNew) openDetail(inq.id); } }, 'Cancel'),
        error));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const body = {};
      for (const name of TEXT_FIELDS) body[name] = form.elements[name].value.trim();
      body.status = status.value;
      const dateField = form.elements.wedding_date;
      if (!dateField.validity.valid) {
        error.textContent = 'Use a wedding date between 2000 and 2100, or clear it.';
        dateField.focus();
        return;
      }
      body.wedding_date = dateField.value || null;
      for (const name of ['price', 'paid']) {
        const raw = form.elements[name].value.replace(/[$,\s]/g, '');
        if (!raw) { body[name] = null; continue; }
        if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw)) {
          error.textContent = 'Amounts are plain numbers, like 4000 or 4000.50.';
          form.elements[name].focus();
          return;
        }
        body[name] = Number(raw);
      }
      if (!body.names && !body.email) {
        error.textContent = 'Add at least the couple\u2019s names or an email.';
        form.elements.names.focus();
        return;
      }
      submit.disabled = true;
      try {
        const { inquiry } = isNew
          ? await api('/inquiries', { method: 'POST', body })
          : await api(`/inquiries/${inq.id}`, { method: 'PATCH', body });
        editor.close();
        say(isNew ? 'Inquiry added.' : 'Changes saved.');
        refreshCurrent();
        openDetail(inquiry.id);
      } catch (err) {
        if (!err.silent) error.textContent = err.message;
        submit.disabled = false;
      }
    });

    clear(editor).append(
      h('div', { class: 'sheet-head' },
        h('div', {},
          h('p', { class: 'eyebrow' }, isNew ? 'A couple who wrote another way' : 'Edit details'),
          h('h2', { id: 'editor-title' }, isNew ? 'Add an inquiry' : coupleName(inq))),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close', onclick: () => editor.close() }, '\u00d7')),
      form);
    if (!editor.open) editor.showModal();
    form.elements.names.focus();
  }

  /* ---------- Analytics ---------- */

  const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['12m', '12 months']];
  const VERSUS = { today: 'yesterday by this time', '7d': 'the 7 days before', '30d': 'the 30 days before', '90d': 'the 90 days before', '12m': 'the year before' };
  const PAGE_NAMES = {
    '/': 'Home', '/portfolio/': 'Portfolio', '/blog/': 'Journal', '/privacy/': 'Privacy',
    '/links/': 'Links (Instagram bio)', '/lead/': 'Wedding show sign-up', '/AlexClaudioVentures/': 'Alex Claudio Ventures'
  };
  const CHANNELS = {
    Search: ['Google', 'Bing', 'DuckDuckGo', 'Yahoo', 'Ecosia', 'Yandex', 'Baidu', 'Brave Search'],
    Social: ['Instagram', 'Facebook', 'Pinterest', 'X', 'LinkedIn', 'Reddit', 'TikTok', 'YouTube', 'Threads'],
    'AI assistant': ['ChatGPT', 'Perplexity', 'Claude', 'Gemini', 'Copilot'],
    'Wedding site': ['The Knot', 'WeddingWire', 'Zola', 'Junebug Weddings', 'Yelp'],
    Email: ['Gmail', 'Email'],
    'Typed or bookmarked': ['Direct']
  };
  const CHANNEL_OF = new Map(Object.entries(CHANNELS).flatMap(([channel, names]) => names.map((name) => [name, channel])));
  const analyticsState = { range: '30d' };
  const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch (error) { return null; } })();

  const fmtCount = (n) => Number(n || 0).toLocaleString('en-US');
  const share = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '\u2014');
  const fmtDuration = (s) => {
    if (s === null || s === undefined) return '\u2014';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  };
  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const countryName = (code) => {
    if (!code) return 'Unknown';
    try { return (regionNames && regionNames.of(code)) || code; } catch (error) { return code; }
  };
  const zoneName = (zone) => (zone ? zone.split('/').pop().replace(/_/g, ' ') : 'Unknown');
  // "renee-alan" -> "Renee & Alan"; a random code at the end of older gallery links is left out.
  const galleryName = (slug) => {
    const words = String(slug).split('-').filter((word) => word && !/^[0-9a-f]{8,}$/.test(word)).map(capital);
    return words.length === 2 ? words.join(' & ') : words.join(' ') || slug;
  };
  const pageName = (path) => {
    if (PAGE_NAMES[path]) return PAGE_NAMES[path];
    if (path.startsWith('/blog/')) return `Journal: ${capital(path.slice(6).replace(/\/$/, '').replace(/-/g, ' '))}`;
    if (path.startsWith('/gallery/')) return `Gallery: ${galleryName(path.slice(9))}`;
    return path;
  };
  const dayLabel = (iso, options) => localDate(iso).toLocaleDateString('en-US', options);
  // "2026-10-15T09" -> "9 AM", or "9\u201310 AM" in full ("11 AM\u201312 PM" across noon).
  const hourLabel = (key, full) => {
    const hour = Number(key.slice(11, 13));
    const twelve = (h) => h % 12 || 12;
    const half = (h) => (h % 24 < 12 ? 'AM' : 'PM');
    if (!full) return `${twelve(hour)} ${half(hour)}`;
    return half(hour) === half(hour + 1)
      ? `${twelve(hour)}\u2013${twelve(hour + 1)} ${half(hour)}`
      : `${twelve(hour)} ${half(hour)}\u2013${twelve(hour + 1)} ${half(hour + 1)}`;
  };
  // How a chart slot is named: an hour today, a day, or a month (with its year when that isn't this year's).
  const slotLabel = (point, bucket, full, lastYear) => {
    if (bucket === 'hour') return hourLabel(point.key, full);
    if (bucket === 'day') return dayLabel(point.key, full ? { weekday: 'long', month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric' });
    if (full) return dayLabel(`${point.key}-01`, { month: 'long', year: 'numeric' });
    const month = dayLabel(`${point.key}-01`, { month: 'short' });
    return point.key.slice(0, 4) === lastYear ? month : `${month} \u2019${point.key.slice(2, 4)}`;
  };

  function renderAnalytics(root, live) {
    const body = h('div', { class: 'analytics' }, h('p', { class: 'muted' }, 'Loading\u2026'));
    const chips = RANGES.map(([value, label]) => h('button', {
      type: 'button',
      'aria-pressed': String(analyticsState.range === value),
      onclick: (event) => {
        analyticsState.range = value;
        for (const chip of chips) chip.setAttribute('aria-pressed', String(chip === event.currentTarget));
        load();
      }
    }, label));
    root.append(
      h('div', { class: 'view-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Visits to the website'), h('h1', {}, 'Analytics'))),
      h('div', { class: 'toolbar' }, h('div', { class: 'chips', role: 'group', 'aria-label': 'Period' }, chips)),
      body);

    let seq = 0;
    async function load() {
      const mine = ++seq;
      body.setAttribute('aria-busy', 'true');
      try {
        const data = await api(`/analytics?range=${encodeURIComponent(analyticsState.range)}`);
        if (mine === seq && live()) drawAnalytics(body, data);
      } catch (error) {
        if (mine === seq && live()) clear(body).append(problem(error, 'Visits are counted once the website has a volume to save to.'));
      } finally {
        if (mine === seq) body.removeAttribute('aria-busy');
      }
    }
    state.refresh = load;
    load();
  }

  function drawAnalytics(body, data) {
    const { totals: now, previous: before, range } = data;
    const versus = VERSUS[range.key];
    const delta = (current, earlier, upIsGood = true) => {
      if (!earlier) return current ? h('small', { class: 'delta' }, `none in ${versus}`) : null;
      const change = Math.round(((current - earlier) / earlier) * 100);
      if (!change) return h('small', { class: 'delta' }, `same as ${versus}`);
      const good = change > 0 === upIsGood;
      return h('small', { class: `delta ${good ? 'good' : 'bad'}` }, `${change > 0 ? '\u25b2' : '\u25bc'} ${Math.abs(change)}% vs ${versus}`);
    };
    const card = (label, value, note, change) => h('div', { class: 'card' },
      h('span', { class: 'card-label' }, label), h('strong', {}, value), h('small', {}, note), change);
    const period = range.key === 'today'
      ? `Today, ${dayLabel(range.to, { month: 'short', day: 'numeric' })}`
      : `${dayLabel(range.from, { month: 'short', day: 'numeric', year: range.from.slice(0, 4) === range.to.slice(0, 4) ? undefined : 'numeric' })} \u2013 ${dayLabel(range.to, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    const started = data.counting_since;

    append(clear(body), [
      !started
        ? h('p', { class: 'intro' }, 'Nothing counted yet. Visits show up here a few seconds after someone opens a page on the website.')
        : started > range.from
          ? h('p', { class: 'muted small' }, `Counting started on ${dayLabel(started, { month: 'long', day: 'numeric', year: 'numeric' })}, so earlier days are empty.`)
          : null,
      h('div', { class: 'cards' },
        card('Visitors', fmtCount(now.visitors), `${plural(now.visits, 'visit', 'visits')}`, delta(now.visitors, before.visitors)),
        card('Page views', fmtCount(now.views), now.visits ? `${(now.views / now.visits).toFixed(1)} pages per visit` : 'no visits yet', delta(now.views, before.views)),
        card('Time per visit', fmtDuration(now.seconds_per_visit), `${share(now.single_page, now.visits)} looked at one page`, delta(now.seconds_per_visit, before.seconds_per_visit)),
        card('Inquiries', fmtCount(now.inquiries), now.visits ? `from ${share(now.inquiry_visits, now.visits)} of visits` : 'sent from the website', delta(now.inquiries, before.inquiries))),
      panel(`Visitors by ${range.bucket}`, period, columnChart(data.series, range.bucket), seriesTable(data.series, range.bucket)),
      panel('Pages', 'What people opened, most viewed first', barTable({
        head: 'Page', rows: data.pages, empty: 'No page views in this period.',
        label: (row) => pageName(row.path), sub: (row) => row.path,
        metrics: [
          { label: 'Views', value: (row) => row.views },
          { label: 'Visitors', value: (row) => row.visitors, optional: true },
          { label: 'First page', value: (row) => row.landings, optional: true, title: 'Visits that started on this page' },
          { label: 'Time', value: (row) => row.seconds, text: (row) => fmtDuration(row.seconds), title: 'Average time the page stayed open' }
        ]
      })),
      h('div', { class: 'panels' },
        panel('How they found the site', null,
          barTable({
            head: 'Source', rows: data.sources, empty: 'No visits in this period.',
            label: (row) => row.name, sub: (row) => CHANNEL_OF.get(row.name) || 'Another website',
            metrics: [{ label: 'Visits', value: (row) => row.visits }, { label: 'Inquiries', value: (row) => row.inquiries }]
          }),
          data.referrers.length ? h('h3', { class: 'sub-head' }, 'Linking websites') : null,
          data.referrers.length ? barTable({ head: 'Website', rows: data.referrers, label: (row) => row.name, metrics: [{ label: 'Visits', value: (row) => row.visits }] }) : null,
          data.campaigns.length ? h('h3', { class: 'sub-head' }, 'Tagged links') : null,
          data.campaigns.length ? barTable({
            head: 'Campaign', rows: data.campaigns,
            label: (row) => row.campaign || '(no campaign)', sub: (row) => [row.source, row.medium].filter(Boolean).join(' \u00b7 '),
            metrics: [{ label: 'Visits', value: (row) => row.visits }]
          }) : null),
        panel('Where they are', 'From each device\u2019s time zone',
          barTable({
            head: 'Country', rows: data.countries, empty: 'No visits in this period.', label: (row) => countryName(row.name),
            metrics: [{ label: 'Visits', value: (row) => row.visits }, { label: 'Share', value: (row) => row.visits, text: (row) => share(row.visits, now.visits) }]
          }),
          data.timezones.length ? h('h3', { class: 'sub-head' }, 'Time zones') : null,
          data.timezones.length ? barTable({
            head: 'Time zone', rows: data.timezones, label: (row) => zoneName(row.name), sub: (row) => row.name,
            metrics: [{ label: 'Visits', value: (row) => row.visits }]
          }) : null),
        panel('Devices', null,
          ...[['Device', data.devices], ['Browser', data.browsers], ['System', data.systems]].flatMap(([head, rows], index) => [
            index && rows.length ? h('h3', { class: 'sub-head' }, `${head}s`) : null,
            barTable({
              head, rows, empty: index ? null : 'No visits in this period.', label: (row) => row.name || 'Other', limit: 5,
              metrics: [{ label: 'Visits', value: (row) => row.visits }, { label: 'Share', value: (row) => row.visits, text: (row) => share(row.visits, now.visits) }]
            })
          ])),
        panel('Client galleries', 'Opened and downloaded', galleryTable(data.galleries))),
      panel('Latest visits', 'Newest first, page by page', recentVisits(data.recent)),
      h('p', { class: 'muted small analytics-note' },
        'No cookies or IP addresses are kept. Each visitor is counted once a day, so the same person on two days counts twice. Visits are kept for 13 months.'),
      ownerNote()]);
  }

  function panel(title, note, ...kids) {
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, title), note ? h('span', { class: 'muted small' }, note) : null),
      kids);
  }

  // A ranked table whose first column carries a bar as long as its share of the top row.
  function barTable({ head, rows, label, sub, metrics, empty, limit = 8 }) {
    if (!rows.length) return empty ? h('p', { class: 'muted' }, empty) : null;
    const max = Math.max(1, ...rows.map((row) => metrics[0].value(row) || 0));
    const tbody = h('tbody');
    const drawRows = (all) => clear(tbody).append(...(all ? rows : rows.slice(0, limit)).map((row) => {
      const fill = h('span', { class: 'fill', 'aria-hidden': 'true' });
      fill.style.width = `${Math.max(1.5, ((metrics[0].value(row) || 0) / max) * 100)}%`;
      const detail = sub ? sub(row) : '';
      return h('tr', {},
        h('th', { scope: 'row', class: 'name' }, fill, h('span', { class: 'label' }, label(row), detail ? h('small', {}, detail) : null)),
        metrics.map((metric) => h('td', { class: metric.optional ? 'num optional' : 'num' }, metric.text ? metric.text(row) : fmtCount(metric.value(row)))));
    }));
    drawRows(false);
    const box = h('div', { class: 'bar-table' },
      h('table', { class: 'bars' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, head),
          metrics.map((metric) => h('th', { scope: 'col', class: metric.optional ? 'num optional' : 'num', title: metric.title }, metric.label)))),
        tbody));
    if (rows.length > limit) {
      let all = false;
      const more = h('button', {
        class: 'link more', type: 'button',
        onclick: () => { all = !all; drawRows(all); more.textContent = all ? 'Show fewer' : `Show all ${rows.length}`; }
      }, `Show all ${rows.length}`);
      box.append(more);
    }
    return box;
  }

  // Visitors per day (or month) as columns, with the exact numbers on hover, focus and in the table below.
  function columnChart(series, bucket) {
    const SVG = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attrs, text) => {
      const el = document.createElementNS(SVG, tag);
      for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
      if (text !== undefined) el.textContent = text;
      return el;
    };
    // Months from an earlier year carry it ("Oct \u201925"), so the two Octobers of a year view differ.
    const lastYear = series.length ? series[series.length - 1].key.slice(0, 4) : '';
    const short = (point) => slotLabel(point, bucket, false, lastYear);
    const long = (point) => slotLabel(point, bucket, true, lastYear);
    const wrap = h('div', { class: 'chart' });
    const tip = h('div', { class: 'chart-tip', hidden: true });
    let marks = [];
    let active = -1;
    let drawnWidth = 0;

    const show = (index) => {
      active = index;
      marks.forEach((mark, i) => mark.bar.classList.toggle('on', i === index));
      const { point, cx, top } = marks[index];
      clear(tip).append(
        h('span', { class: 'tip-when' }, long(point)),
        h('strong', {}, plural(point.visitors, 'visitor', 'visitors')),
        h('span', {}, `${plural(point.visits, 'visit', 'visits')} \u00b7 ${plural(point.views, 'page view', 'page views')}`));
      tip.hidden = false;
      const half = tip.offsetWidth / 2;
      tip.style.left = `${Math.min(Math.max(cx, half), drawnWidth - half)}px`;
      tip.style.top = `${Math.max(0, top - tip.offsetHeight - 10)}px`;
    };
    const hide = () => {
      active = -1;
      tip.hidden = true;
      for (const mark of marks) mark.bar.classList.remove('on');
    };

    const draw = () => {
      const width = Math.round(wrap.clientWidth);
      if (!width || width === drawnWidth) return;
      drawnWidth = width;
      const height = 230;
      const m = { top: 14, right: 4, bottom: 28, left: 42 };
      const plotW = width - m.left - m.right;
      const plotH = height - m.top - m.bottom;
      const base = m.top + plotH;
      const highest = Math.max(0, ...series.map((point) => point.visitors));
      const rough = Math.max(1, highest / 4);
      const magnitude = 10 ** Math.floor(Math.log10(rough));
      const step = Math.max(1, [1, 2, 5, 10].find((n) => n * magnitude >= rough) * magnitude);
      const top = Math.max(step, Math.ceil(highest / step) * step);
      const y = (value) => base - (value / top) * plotH;
      const slot = plotW / series.length;
      const barW = Math.max(1, Math.min(24, slot - 2));

      const svg = svgEl('svg', {
        width, height, viewBox: `0 0 ${width} ${height}`, tabindex: 0, role: 'img',
        'aria-label': `Visitors per ${bucket}. Use the arrow keys to read each ${bucket}; every number is also in the table below.`
      });
      for (let value = 0; value <= top; value += step) {
        svg.append(svgEl('line', { class: 'gridline', x1: m.left, x2: width - m.right, y1: y(value), y2: y(value) }));
        svg.append(svgEl('text', { class: 'tick', x: m.left - 8, y: y(value) + 4, 'text-anchor': 'end' }, fmtCount(value)));
      }
      marks = series.map((point, i) => {
        const x = m.left + i * slot + (slot - barW) / 2;
        const tall = point.visitors ? Math.max(2, (point.visitors / top) * plotH) : 0;
        const r = Math.min(4, barW / 2, tall);
        const yTop = base - tall;
        const bar = svgEl('path', {
          class: 'bar',
          d: tall ? `M${x},${base}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + barW - r}Q${x + barW},${yTop} ${x + barW},${yTop + r}V${base}Z` : ''
        });
        svg.append(bar);
        return { bar, point, cx: x + barW / 2, top: tall ? yTop : base };
      });
      const every = Math.max(1, Math.ceil(series.length / Math.max(2, Math.floor(plotW / 70))));
      series.forEach((point, i) => {
        if (i % every) return;
        svg.append(svgEl('text', { class: 'tick', x: marks[i].cx, y: height - 8, 'text-anchor': 'middle' }, short(point)));
      });
      series.forEach((point, i) => {
        const hit = svgEl('rect', { class: 'hit', x: m.left + i * slot, y: m.top, width: slot, height: plotH });
        hit.addEventListener('pointerenter', () => show(i));
        svg.append(hit);
      });
      svg.addEventListener('pointerleave', () => { if (document.activeElement !== svg) hide(); });
      svg.addEventListener('focus', () => show(active >= 0 ? active : series.length - 1));
      svg.addEventListener('blur', hide);
      svg.addEventListener('keydown', (event) => {
        const move = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[event.key];
        if (move === undefined) return;
        event.preventDefault();
        show(Math.min(series.length - 1, Math.max(0, (active < 0 ? series.length - 1 : active) + move)));
      });
      wrap.replaceChildren(svg, tip);
      active = -1;
    };

    if (typeof ResizeObserver === 'function') {
      const watcher = new ResizeObserver(() => {
        if (!wrap.isConnected) { watcher.disconnect(); return; }
        draw();
      });
      watcher.observe(wrap);
    } else {
      requestAnimationFrame(draw);
    }
    return wrap;
  }

  function seriesTable(series, bucket) {
    const when = (point) => (bucket === 'day'
      ? dayLabel(point.key, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      : slotLabel(point, bucket, true, ''));
    return h('details', { class: 'chart-table' },
      h('summary', {}, 'Show as a table'),
      h('div', { class: 'scroll' }, h('table', { class: 'grid' },
        h('thead', {}, h('tr', {}, [capital(bucket), 'Visitors', 'Visits', 'Page views'].map((title) => h('th', { scope: 'col' }, title)))),
        h('tbody', {}, [...series].reverse().map((point) => h('tr', {},
          h('td', {}, when(point)), h('td', {}, fmtCount(point.visitors)), h('td', {}, fmtCount(point.visits)), h('td', {}, fmtCount(point.views))))))));
  }

  function galleryTable(galleries) {
    if (!galleries.length) return h('p', { class: 'muted' }, 'No client gallery was opened in this period.');
    const when = (stamp) => (stamp ? fmtStamp(stamp) : '\u2014');
    return h('div', { class: 'bar-table' }, h('table', { class: 'bars plain' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Gallery'),
        h('th', { scope: 'col', class: 'num' }, 'Opened'),
        h('th', { scope: 'col', class: 'num', title: 'Single photos downloaded' }, 'Photos'),
        h('th', { scope: 'col', class: 'num', title: '\u201cDownload all\u201d zips' }, 'Zips'),
        h('th', { scope: 'col', class: 'num optional' }, 'Last opened'))),
      h('tbody', {}, galleries.map((gallery) => h('tr', {},
        h('th', { scope: 'row', class: 'name' }, h('span', { class: 'label' },
          h('a', { href: `/gallery/${encodeURIComponent(gallery.slug)}`, target: '_blank', rel: 'noopener' }, galleryName(gallery.slug)),
          h('small', {}, gallery.visitors ? plural(gallery.visitors, 'visitor', 'visitors') : gallery.slug))),
        h('td', { class: 'num' }, fmtCount(gallery.views)),
        h('td', { class: 'num' }, fmtCount(gallery.photos)),
        h('td', { class: 'num' }, fmtCount(gallery.zips)),
        h('td', { class: 'num optional' }, when(gallery.last_view)))))));
  }

  function recentVisits(visits) {
    if (!visits.length) return h('p', { class: 'muted' }, 'No visits in this period.');
    const actionText = (action) => {
      if (action.kind === 'inquiry') return action.detail === 'wedding-show-lead' ? 'Signed up at a wedding show' : 'Sent an inquiry';
      if (action.kind === 'zip') return `Downloaded all of ${galleryName(action.detail)}`;
      return action.count > 1 ? `Downloaded ${action.count} photos from ${galleryName(action.detail)}` : `Downloaded a photo from ${galleryName(action.detail)}`;
    };
    return h('ol', { class: 'visits' }, visits.map((visit) => {
      // Many downloads in a row read as one step.
      const actions = [];
      for (const action of visit.actions) {
        const last = actions[actions.length - 1];
        if (last && last.kind === action.kind && last.detail === action.detail) last.count += 1;
        else actions.push({ ...action, count: 1 });
      }
      const steps = [...visit.pages.map((page) => ({ at: page.at, page })), ...actions.map((action) => ({ at: action.at, action }))]
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      return h('li', {},
        h('div', { class: 'visit-meta' },
          h('strong', {}, fmtStamp(visit.started_at)),
          h('span', {}, visit.source),
          h('span', {}, visit.timezone ? `${visit.country ? countryName(visit.country) : 'Country unknown'}, ${zoneName(visit.timezone)} time` : 'Country unknown'),
          h('span', {}, `${visit.device} \u00b7 ${visit.browser} on ${visit.os}`)),
        h('ol', { class: 'trail' }, steps.map((step) => (step.page
          ? h('li', {}, pageName(step.page.path), step.page.seconds ? h('small', {}, fmtDuration(step.page.seconds)) : null)
          : h('li', { class: 'did' }, actionText(step.action))))));
    }));
  }

  function ownerNote() {
    let flag;
    try { flag = localStorage.getItem(NOT_COUNTED); } catch (error) { return null; }
    const note = h('p', { class: 'muted small analytics-note' });
    const draw = () => {
      clear(note).append(
        flag === '1' ? 'Your own visits from this browser aren\u2019t counted. ' : 'Visits from this browser are counted. ',
        h('button', {
          class: 'link', type: 'button',
          onclick: () => {
            flag = flag === '1' ? '0' : '1';
            try { localStorage.setItem(NOT_COUNTED, flag); } catch (error) { /* storage is blocked */ }
            draw();
          }
        }, flag === '1' ? 'Count them' : 'Stop counting them'));
    };
    draw();
    return note;
  }

  /* ---------- Calendar ---------- */

  const calendarState = { month: null };
  const thisMonth = () => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); };

  function renderCalendar(root, live) {
    if (!calendarState.month) calendarState.month = thisMonth();
    const title = h('h2', { class: 'month-title', 'aria-live': 'polite' });
    const grid = h('div', { class: 'calendar' });
    const agenda = h('section', { class: 'agenda', 'aria-live': 'polite' });
    const go = (month) => { calendarState.month = month; load(); };
    const shift = (n) => go(new Date(calendarState.month.getFullYear(), calendarState.month.getMonth() + n, 1));

    root.append(
      h('div', { class: 'view-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Weddings by date'), h('h1', {}, 'Calendar')),
        h('div', { class: 'month-nav' },
          h('button', { type: 'button', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '\u2039'),
          title,
          h('button', { type: 'button', 'aria-label': 'Next month', onclick: () => shift(1) }, '\u203a'),
          h('button', { class: 'quiet', type: 'button', onclick: () => go(thisMonth()) }, 'Today'))),
      h('p', { class: 'intro' }, 'Booked weddings are filled in; dashed ones are still being talked about. An inquiry shows up once it has a wedding date.'),
      h('div', { class: 'calendar-wrap' }, grid),
      agenda);

    let seq = 0;
    async function load() {
      const mine = ++seq;
      const first = calendarState.month;
      const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 41);
      const monthName = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      title.textContent = monthName;
      drawGrid(start, first, []);
      clear(agenda);
      let weddings;
      try {
        ({ weddings } = await api(`/calendar?from=${isoOf(start)}&to=${isoOf(end)}`));
      } catch (error) {
        if (mine === seq && live()) agenda.append(problem(error, 'Weddings appear here once the website has a volume to save to.'));
        return;
      }
      if (mine !== seq || !live()) return;
      drawGrid(start, first, weddings);
      const inMonth = weddings.filter((w) => w.wedding_date.slice(0, 7) === isoOf(first).slice(0, 7));
      agenda.append(h('h2', {}, `${monthName} \u00b7 ${plural(inMonth.length, 'wedding', 'weddings')}`));
      if (!inMonth.length) {
        agenda.append(h('p', { class: 'muted' }, 'Nothing on the calendar this month.'));
        return;
      }
      agenda.append(h('ul', {}, inMonth.map((w) => h('li', {},
        h('button', { type: 'button', onclick: () => openDetail(w.id) },
          h('span', {}, h('strong', {}, fmtDay(w.wedding_date, true)), ` \u2014 ${coupleName(w)}${w.location ? ` \u00b7 ${w.location}` : ''}`),
          statusBadge(w.status))))));
    }

    function drawGrid(start, first, weddings) {
      const byDay = new Map();
      for (const wedding of weddings) {
        if (!byDay.has(wedding.wedding_date)) byDay.set(wedding.wedding_date, []);
        byDay.get(wedding.wedding_date).push(wedding);
      }
      const today = isoOf(new Date());
      clear(grid).append(...DAY_NAMES.map((name) => h('div', { class: 'day-name', 'aria-hidden': 'true' }, name)));
      for (let i = 0; i < 42; i += 1) {
        const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const iso = isoOf(day);
        const classes = ['cell', day.getMonth() !== first.getMonth() ? 'dim' : '', iso === today ? 'today' : ''].filter(Boolean).join(' ');
        grid.append(h('div', { class: classes },
          h('span', { class: 'day-num' }, String(day.getDate())),
          (byDay.get(iso) || []).map((w) => h('button', {
            class: `event s-${w.status}`,
            type: 'button',
            title: `${coupleName(w)} \u00b7 ${STATUS_LABEL[w.status]}`,
            onclick: () => openDetail(w.id)
          }, coupleName(w)))));
      }
    }

    state.refresh = load;
    load();
  }

  /* ---------- Old records ---------- */

  function renderRecords(root, live) {
    const holder = h('div', {}, h('p', { class: 'muted' }, 'Looking for older records\u2026'));
    const tableBox = h('section', { class: 'record-table', hidden: true, 'aria-live': 'polite' });
    root.append(
      h('div', { class: 'view-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Read only'), h('h1', {}, 'Old records'))),
      h('p', { class: 'intro' }, 'Everything the earlier dashboard saved, exactly as it was. Its weddings and notes were also copied into Inquiries, where they can be changed; nothing here can be, and columns that look like passwords or keys are never shown.'),
      holder, tableBox);

    let seq = 0;
    async function openTable(schema, name, page) {
      const mine = ++seq;
      tableBox.hidden = false;
      clear(tableBox).append(h('p', { class: 'muted' }, 'Loading\u2026'));
      let data;
      try {
        data = await api(`/archive/${encodeURIComponent(schema)}/${encodeURIComponent(name)}?page=${page}`);
      } catch (error) {
        if (mine === seq && live()) clear(tableBox).append(problem(error, 'Older records appear here once the website has a volume.'));
        return;
      }
      if (mine !== seq || !live()) return;
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
      const label = schema === 'public' || schema === 'main' ? name : `${schema}.${name}`;
      append(clear(tableBox), [
        h('div', { class: 'record-head' },
          h('h2', {}, label),
          h('span', { class: 'muted small' }, `${plural(data.total, 'row', 'rows')}${data.orderedBy ? ` \u00b7 newest first (${data.orderedBy})` : ''}`)),
        data.hidden.length ? h('p', { class: 'muted small' }, `Not shown: ${data.hidden.join(', ')}.`) : null,
        data.columns.length
          ? h('div', { class: 'scroll' }, h('table', { class: 'grid' },
            h('thead', {}, h('tr', {}, data.columns.map((column) => h('th', { scope: 'col', title: column.type }, column.name)))),
            h('tbody', {}, data.rows.length
              ? data.rows.map((row) => h('tr', {}, row.map((value) => h('td', {}, value === null ? '' : String(value)))))
              : h('tr', {}, h('td', { colspan: data.columns.length }, 'No rows.')))))
          : h('p', { class: 'muted' }, 'Every column in this table is hidden.'),
        pages > 1 ? h('div', { class: 'pager' },
          h('button', { type: 'button', disabled: page <= 0, onclick: () => openTable(schema, name, page - 1) }, data.orderedBy ? '\u2039 Newer' : '\u2039 Previous'),
          h('span', {}, `Page ${page + 1} of ${pages}`),
          h('button', { type: 'button', disabled: page + 1 >= pages, onclick: () => openTable(schema, name, page + 1) }, data.orderedBy ? 'Older \u203a' : 'Next \u203a')) : null]);
      tableBox.scrollIntoView({ block: 'start' });
    }

    (async () => {
      let tables;
      try {
        ({ tables } = await api('/archive'));
      } catch (error) {
        if (live()) clear(holder).append(problem(error, 'Older records appear here once the website has a volume.'));
        return;
      }
      if (!live()) return;
      clear(holder);
      if (!tables.length) {
        holder.append(h('p', { class: 'empty' }, 'There is no earlier dashboard file to show.'));
        return;
      }
      const buttons = tables.map((table) => h('button', {
        type: 'button',
        'aria-pressed': 'false',
        onclick: (event) => {
          for (const button of buttons) button.setAttribute('aria-pressed', String(button === event.currentTarget));
          openTable(table.schema, table.name, 0);
        }
      },
      h('strong', {}, table.schema === 'public' || table.schema === 'main' ? table.name : `${table.schema}.${table.name}`),
      h('small', {}, [
        table.rows === null ? 'rows unknown' : plural(table.rows, 'row', 'rows'),
        plural(table.columns, 'column', 'columns'),
        table.hidden.length ? `${table.hidden.length} hidden` : ''
      ].filter(Boolean).join(' \u00b7 '))));
      holder.append(h('ul', { class: 'table-list' }, buttons.map((button) => h('li', {}, button))));
    })();
  }

  /* ---------- Setup ---------- */

  function renderSetup(root, live) {
    const body = h('div', {}, h('p', { class: 'muted' }, 'Checking\u2026'));
    root.append(h('div', { class: 'view-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'How the studio is connected'), h('h1', {}, 'Setup'))), body);
    const load = async () => {
      let data;
      try {
        data = await api('/overview');
      } catch (error) {
        if (live()) clear(body).append(h('p', { class: 'error-text' }, error.message));
        return;
      }
      if (!live()) return;
      append(clear(body), [databasePanel(data.db), settingsPanel(data.settings), data.volume ? volumePanel(data.volume) : null, signInPanel(data.node)]);
    };
    state.refresh = load;
    load();
  }

  function databasePanel(db) {
    const panel = h('section', { class: 'panel' }, h('h2', {}, 'Where everything is kept'));
    if (db.connected) {
      const latest = db.backups && db.backups.latest;
      append(panel, [
        h('p', { class: 'state' }, h('span', { class: 'dot ok', 'aria-hidden': 'true' }),
          `Saved in ${db.file} on the website\u2019s Railway volume (SQLite ${db.version}${db.size === null || db.size === undefined ? '' : `, ${fmtSize(db.size)}`}).`),
        h('p', { class: 'muted small' }, 'Letters from the website are saved here as they arrive, as well as being emailed.'),
        h('p', {},
          latest
            ? `A copy is made every day and the newest ${db.backups.kept} are kept in ${db.backups.folder}. Latest: ${latest.name.replace(/^studio-|\.sqlite$/g, '')}.`
            : `A copy is made every day and the newest ${db.backups.kept} are kept in ${db.backups.folder}.`),
        h('p', { class: 'muted small' }, 'Those copies live on the same volume, so keep one somewhere else now and then:'),
        h('a', { class: 'button', href: '/admin/api/backup', download: '' }, 'Download a copy'),
        db.earlier
          ? h('p', { class: 'muted small backup-note' }, db.earlier.found
            ? `The earlier dashboard\u2019s file (${db.earlier.file}) is left exactly as it was. ${plural(db.earlier.imported, 'wedding was', 'weddings were')} copied into Inquiries with their notes; everything else in it is under Old records.`
            : `The earlier dashboard\u2019s file (${db.earlier.file}) wasn\u2019t found.`)
          : null]);
      return panel;
    }
    if (db.configured) {
      append(panel, [
        h('p', { class: 'state' }, h('span', { class: 'dot bad', 'aria-hidden': 'true' }), `The dashboard\u2019s file (${db.file}) can\u2019t be opened.`),
        db.error ? h('p', {}, h('code', {}, db.error)) : null,
        h('p', { class: 'muted small' }, 'Check on Railway that the volume is still attached to the website service. Letters still arrive by email in the meantime.')]);
      return panel;
    }
    panel.append(
      h('p', { class: 'state' }, h('span', { class: 'dot bad', 'aria-hidden': 'true' }), 'The dashboard has nowhere to save yet.'),
      h('p', {}, 'Letters still arrive by email. To keep them here as well, give the website a volume on Railway:'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Open the website service (alex-claudio-site) \u2192 Settings \u2192 Volumes, and add a volume mounted at ', h('code', {}, '/data'), '.'),
        h('li', {}, 'Deploy the change. A minute later this page shows where everything is kept.')));
    return panel;
  }

  function settingsPanel(settings) {
    return h('section', { class: 'panel' },
      h('h2', {}, 'Settings on Railway'),
      h('p', { class: 'muted small' }, 'Which variables the website can see. Their values stay hidden.'),
      h('ul', { class: 'settings' }, settings.map((setting) => h('li', {},
        h('span', { class: setting.present ? 'dot ok' : 'dot', 'aria-hidden': 'true' }),
        h('span', {}, setting.label),
        h('code', {}, setting.name),
        h('span', { class: 'muted small' }, setting.present ? (setting.value || 'set') : 'not set')))));
  }

  function volumePanel(volume) {
    return h('section', { class: 'panel' },
      h('h2', {}, 'Railway volume'),
      h('p', { class: 'muted small' }, `Mounted at ${volume.path}. The dashboard writes only studio.sqlite and backups/studio/; the earlier dashboard\u2019s admin.sqlite files are left as they were.`),
      volume.files && volume.files.length
        ? h('ul', { class: 'files' }, volume.files.map((file) => h('li', {}, h('code', {}, file.path), h('span', { class: 'muted small' }, file.size === null ? '' : fmtSize(file.size)))))
        : h('p', { class: 'muted' }, 'The volume is empty.'));
  }

  function signInPanel(node) {
    return h('section', { class: 'panel' },
      h('h2', {}, 'Signing in'),
      h('p', {}, 'The password is the ADMIN_PASSWORD variable on the website service. To change it, edit the variable on Railway and deploy.'),
      h('p', { class: 'muted small' }, `You stay signed in for 8 hours of quiet, 7 days at most, and every deploy signs you out. After 5 wrong passwords, sign-in pauses for 15 minutes. The website runs on Node ${node}.`));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !detail.open && !editor.open) refreshCurrent();
  });
  window.addEventListener('hashchange', route);
  route();
})();
