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
