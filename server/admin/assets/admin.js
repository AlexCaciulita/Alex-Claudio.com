// The studio dashboard. Everything is drawn with DOM methods, so text from inquiries is never read as HTML.
(() => {
  'use strict';

  const CSRF = (document.querySelector('meta[name="csrf"]') || {}).content || '';
  const app = document.getElementById('app');
  const STATUSES = [['new', 'New'], ['replied', 'Replied'], ['booked', 'Booked'], ['not_booked', 'Not booked']];
  // The whole job, from the first letter to the delivered gallery.
  const STAGE_OPTIONS = [['new', 'New'], ['replied', 'Replied'], ['booked', 'Booked'], ['planning', 'Planning'], ['editing', 'Editing'], ['delivered', 'Delivered'], ['not_booked', 'Not booked']];
  const STAGE_LABEL = Object.fromEntries(STAGE_OPTIONS);
  const TAG_SUGGESTIONS = ['Questionnaire sent', 'Timeline ready', 'Engagement session', 'Photos to edit', 'Album to make', 'Album sent', 'Second photographer', 'Referral'];
  const FORM_LABEL = { contact: 'Website letter', 'wedding-show-lead': 'Wedding show sign-up', manual: 'Added by hand', 'earlier-dashboard': 'From the earlier dashboard' };
  const LIMITS = { names: 300, email: 300, phone: 100, event_date: 200, location: 300, hours: 300, care: 1000, message: 5000, source: 300 };
  const TEXT_FIELDS = Object.keys(LIMITS);
  // Only plain addresses become mailto links, so nothing a visitor typed can add recipients or headers.
  const LINKABLE_EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
  const SHOWN_FIELDS = new Set(['names', 'name', 'email', 'phone', 'phone_number', 'event_date', 'location', 'hours', 'care', 'message', 'source', 'referral']);
  const EXTRA_LABELS = { budget: 'Estimated budget', collection: 'Collection', package: 'Package from the guide' };
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
  const stageBadge = (stage) => h('span', { class: `badge s-${['planning', 'editing', 'delivered'].includes(stage) ? 'booked' : stage} st-${stage}` }, STAGE_LABEL[stage] || stage);

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
    today: { label: 'Today', render: renderToday },
    board: { label: 'Board', render: renderBoard },
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
      h('a', { class: 'brand', href: '#today' },
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
    const token = ++state.token;
    // A couple's own page: #couple/12.
    const contractPage = /^contract\/(\d{1,18})$/.exec(wanted);
    if (contractPage) {
      for (const link of Object.values(navLinks)) link.removeAttribute('aria-current');
      state.refresh = null;
      clear(main);
      if (detail.open) detail.close();
      renderContract(main, () => token === state.token, contractPage[1]);
      window.scrollTo(0, 0);
      return;
    }
    const couple = /^couple\/(\d{1,18})$/.exec(wanted);
    if (couple) {
      for (const link of Object.values(navLinks)) link.removeAttribute('aria-current');
      navLinks.board.setAttribute('aria-current', 'page');
      state.refresh = null;
      clear(main);
      if (detail.open) detail.close();
      renderCouple(main, () => token === state.token, couple[1]);
      window.scrollTo(0, 0);
      return;
    }
    const key = views[wanted] ? wanted : 'today';
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
      h('td', { class: 'c-status' }, stageBadge(inq.stage || inq.status)));
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
    detail.dataset.inquiry = data.inquiry.id;
    drawDetail(data.inquiry, data.notes, data.guide, data);
    if (!detail.open) detail.showModal();
  }

  function drawDetail(inq, notes, guide, extra = {}) {
    // A change that finishes after the sheet has closed refreshes the page behind it right away.
    const changed = () => { if (detail.open) detail.dataset.changed = '1'; else refreshCurrent(); };
    // Saves go out one at a time, in order, so an older answer can never overwrite a newer choice.
    // A control is set back to the saved value only once nothing more is waiting for it.
    let queue = Promise.resolve();
    const pending = { stage: 0, wedding_date: 0, tags: 0 };
    const save = (field, value, message) => {
      pending[field] += 1;
      queue = queue.then(async () => {
        try {
          const { inquiry } = await api(`/inquiries/${inq.id}`, { method: 'PATCH', body: { [field]: value } });
          Object.assign(inq, inquiry);
          changed();
          drawMoney();
          drawWrote();
          loadWork();
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

    const statusSelect = h('select', { id: 'd-status' }, STAGE_OPTIONS.map(([value, label]) => h('option', { value }, label)));
    statusSelect.value = inq.stage || inq.status;
    statusSelect.addEventListener('change', () => save('stage', statusSelect.value, `Moved to ${STAGE_LABEL[statusSelect.value]}.`));

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
      if (field === 'stage') {
        statusSelect.value = inq.stage || inq.status;
        return;
      }
      if (field === 'tags') {
        drawTags();
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
    if (guide) {
      fact('Their guide link', h('span', { class: 'pre' }, `${location.origin}/guide/?for=${guide.code}`));
      fact('Package sent', guide.sent_at ? fmtStamp(guide.sent_at) : 'Not yet');
    }

    // The couple's own link to the pricing guide. A package they send from it comes back to this inquiry.
    // The first copy has to ask the website for the link, so the clipboard is handed a promise of the text:
    // Safari only allows a copy that starts during the click itself.
    const copyGuideLink = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const made = !guide;
      const link = made
        ? api(`/inquiries/${inq.id}/guide-link`, { method: 'POST' }).then((created) => { guide = created; return `${location.origin}/guide/?for=${created.code}`; })
        : Promise.resolve(`${location.origin}/guide/?for=${guide.code}`);
      try {
        try {
          if (made && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
            await navigator.clipboard.write([new ClipboardItem({ 'text/plain': link.then((url) => new Blob([url], { type: 'text/plain' })) })]);
          } else {
            await navigator.clipboard.writeText(await link);
          }
          say(`Guide link for ${coupleName(inq)} copied. Their package will come back to this inquiry.`);
        } catch (error) {
          window.prompt('Copy their guide link:', await link);
        }
        if (made) { changed(); openDetail(inq.id); }
      } catch (error) {
        fail(error);
      }
      button.disabled = false;
    };

    const money = h('div', { class: 'money', 'aria-label': 'Money' });
    const drawMoney = () => {
      const balance = inq.price === null || inq.price === undefined ? null : Math.max(0, inq.price - (inq.paid || 0));
      clear(money).append(
        h('div', {}, h('span', {}, 'Agreed'), h('strong', {}, fmtMoney(inq.price))),
        h('div', {}, h('span', {}, 'Received'), h('strong', {}, fmtMoney(inq.paid))),
        h('div', {}, h('span', {}, 'Balance'), h('strong', {}, fmtMoney(balance))));
    };
    drawMoney();

    // Tags: short labels for where the work stands, saved as a whole list each time.
    const tagWrap = h('div', { class: 'tag-editor' });
    const tagInput = h('input', { type: 'text', maxlength: 40, list: 'tag-suggestions', placeholder: 'Add a tag\u2026', 'aria-label': 'Add a tag' });
    const saveTags = (tags) => { inq.tags = tags; drawTags(); save('tags', tags, 'Tags saved.'); };
    const drawTags = () => {
      clear(tagWrap).append(
        ...(inq.tags || []).map((tag) => h('span', { class: 'tag' }, tag,
          h('button', { class: 'tag-x', type: 'button', 'aria-label': `Remove the tag ${tag}`, onclick: () => saveTags(inq.tags.filter((t) => t !== tag)) }, '\u00d7'))),
        tagInput,
        h('datalist', { id: 'tag-suggestions' }, TAG_SUGGESTIONS.filter((t) => !(inq.tags || []).includes(t)).map((t) => h('option', { value: t }))));
    };
    const addTag = () => {
      const tag = tagInput.value.replace(/\s+/g, ' ').trim();
      if (!tag) return;
      tagInput.value = '';
      if (!(inq.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase())) saveTags([...(inq.tags || []), tag]);
      tagInput.focus();
    };
    tagInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      addTag();
    });
    // Picking a suggestion from the list adds it straight away.
    tagInput.addEventListener('input', (event) => {
      if ((!event.inputType || event.inputType === 'insertReplacementText') && TAG_SUGGESTIONS.includes(tagInput.value)) addTag();
    });
    drawTags();

    // Tasks for this wedding and what changed on it.
    const taskList = h('div');
    const history = h('div');
    const drawWork = (tasks, activity) => {
      drawTasks(taskList, tasks || [], loadWork, false);
      drawActivity(history, activity || [], false);
    };
    async function loadWork() {
      try {
        const data = await api(`/inquiries/${encodeURIComponent(inq.id)}`);
        drawWork(data.tasks, data.activity);
        changed();
      } catch (error) { fail(error); }
    }
    drawWork(extra.tasks, extra.activity);

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
            h('label', { for: 'd-status' }, 'Stage', statusSelect),
            h('label', { for: 'd-date' }, 'Wedding date', dateInput)),
          wrote,
          (extra.drafts || []).length ? h('div', { class: 'drafts' }, extra.drafts.map((draft) => draftCard(draft, inq.email, async () => {
            try {
              await api(`/drafts/${draft.id}`, { method: 'DELETE' });
              changed();
              openDetail(inq.id);
            } catch (error) { fail(error); }
          }))) : null,
          h('div', { class: 'tags-block' }, h('span', { class: 'mini-label' }, 'Tags'), tagWrap),
          facts, money,
          h('div', { class: 'actions' },
            h('a', { class: 'button', href: `#couple/${inq.id}`, onclick: () => detail.close() }, 'Open their page'),
            mailable ? h('a', { class: 'button primary', href: `mailto:${inq.email}?subject=${encodeURIComponent('Your wedding \u00b7 Alex Claudio Photography')}` }, 'Reply by email') : null,
            h('button', { type: 'button', onclick: copyGuideLink }, 'Copy guide link'),
            h('button', { type: 'button', onclick: async () => { await settled(); detail.close(); openEditor(inq); } }, 'Edit details'),
            h('button', { class: 'danger', type: 'button', onclick: remove }, 'Delete'))),
        h('section', { class: 'detail-notes', 'aria-labelledby': 'notes-title' },
          h('h3', { id: 'notes-title' }, 'Private notes'),
          h('p', { class: 'muted small' }, 'Only you see these.'),
          noteForm, noteList,
          h('h3', { class: 'sub-title' }, 'Tasks'),
          taskForm(inq.id, loadWork),
          taskList,
          h('h3', { class: 'sub-title' }, 'History'),
          history)));
  }

  /* ---------- Add or edit ---------- */

  function openEditor(inq) {
    const isNew = !inq;
    const values = inq || { stage: 'new' };
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
    const status = h('select', { id: 'e-status', name: 'stage' }, STAGE_OPTIONS.map(([value, label]) => h('option', { value }, label)));
    status.value = values.stage || values.status || 'new';
    const error = h('p', { class: 'error-text', role: 'alert' });
    const submit = h('button', { class: 'primary', type: 'submit' }, isNew ? 'Add inquiry' : 'Save changes');

    const form = h('form', { class: 'editor-form', novalidate: true },
      h('div', { class: 'form-grid' },
        field('names', 'Couple\u2019s names', { span: 'span2' }),
        h('label', { for: 'e-status' }, 'Stage', status),
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
      body.stage = status.value;
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

  /* ---------- Today ---------- */

  const countdown = (days) => (days === null || days === undefined ? ''
    : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday'
      : days > 0 ? `In ${plural(days, 'day', 'days')}` : `${plural(-days, 'day', 'days')} ago`);
  const daysFromToday = (iso) => Math.round((localDate(iso) - localDate(isoOf(new Date()))) / 86400000);
  const fmtAgo = (stamp) => {
    const minutes = Math.round((Date.now() - new Date(stamp)) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
    const days = Math.round(minutes / 1440);
    return days < 30 ? `${days} d ago` : fmtReceived(stamp);
  };
  const ACTOR_LABEL = { you: 'You', website: 'Website', assistant: 'Assistant' };
  const dateBlock = (iso) => {
    if (!iso) return h('div', { class: 'date-block is-empty' }, h('span', {}, 'No'), h('strong', {}, '\u2014'), h('span', {}, 'date'));
    const d = localDate(iso);
    return h('div', { class: 'date-block' },
      h('span', {}, d.toLocaleDateString('en-US', { month: 'short' })),
      h('strong', {}, String(d.getDate())),
      h('span', {}, String(d.getFullYear())));
  };
  const coupleLink = (id, names) => h('button', { class: 'link couple-link', type: 'button', onclick: () => openDetail(id) }, names || 'No name');

  function renderToday(root, live) {
    const now = new Date();
    const head = h('div', { class: 'today-head' },
      h('p', { class: 'eyebrow' }, now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })),
      h('h1', {}, 'Today'));
    const strip = h('div', { class: 'strip-wrap' });
    const needs = h('div', {}, h('p', { class: 'muted' }, 'Loading\u2026'));
    const tasks = h('div');
    const activity = h('div');
    root.append(
      head,
      h('section', { class: 'today-section', 'aria-labelledby': 'up-title' },
        h('div', { class: 'section-head' }, h('h2', { id: 'up-title' }, 'Coming up'), h('a', { href: '#calendar' }, 'Open the calendar')),
        strip),
      h('div', { class: 'today-grid' },
        h('div', { class: 'today-col' },
          h('section', { class: 'panel', 'aria-labelledby': 'needs-title' }, h('h2', { id: 'needs-title' }, 'Needs you'), needs),
          h('section', { class: 'panel', 'aria-labelledby': 'activity-title' }, h('h2', { id: 'activity-title' }, 'Recent activity'), activity)),
        h('section', { class: 'panel', 'aria-labelledby': 'tasks-title' },
          h('h2', { id: 'tasks-title' }, 'Tasks and deadlines'),
          h('p', { class: 'muted small' }, 'Booked weddings get a questionnaire, a timeline check and the gallery delivery on their own.'),
          taskForm(null, () => load()),
          tasks)));

    async function load() {
      let data;
      try {
        data = await api('/today');
      } catch (error) {
        if (live()) clear(needs).append(problem(error, 'The Today page fills in once the website has a volume to save to.'));
        return;
      }
      if (!live()) return;
      const next = data.upcoming[0];
      clear(head).append(
        h('p', { class: 'eyebrow' }, now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })),
        h('h1', {}, next ? ['Next up: ', coupleLink(next.id, next.names)] : 'Nothing booked ahead yet'),
        next ? h('p', { class: 'next-line' }, [countdown(next.days), fmtDay(next.wedding_date, true), next.location].filter(Boolean).join(' \u00b7 ')) : null);
      drawStrip(data.upcoming);
      drawNeeds(data.needs);
      drawTasks(tasks, data.tasks, load, true);
      drawActivity(activity, data.activity, true);
    }

    function drawStrip(upcoming) {
      clear(strip);
      if (!upcoming.length) {
        strip.append(h('p', { class: 'empty' }, 'Booked weddings with a date appear here.'));
        return;
      }
      strip.append(h('ol', { class: 'strip' }, upcoming.map((w, index) => h('li', {},
        h('a', { class: index === 0 ? 'strip-card is-next' : 'strip-card', href: `#couple/${w.id}` },
          h('small', { class: 'strip-count' }, countdown(w.days)),
          h('strong', { class: 'strip-date' }, localDate(w.wedding_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })),
          h('small', {}, localDate(w.wedding_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric' })),
          h('span', { class: 'strip-names' }, w.names),
          w.location ? h('small', { class: 'strip-place' }, w.location) : null,
          stageBadge(w.stage))))));
    }

    function drawNeeds(items) {
      clear(needs);
      if (!items.length) {
        needs.append(h('p', { class: 'all-clear' }, 'All caught up. Nothing is waiting on you.'));
        return;
      }
      needs.append(h('ul', { class: 'needs' }, items.map((item) => h('li', { class: `need need-${item.kind}` },
        h('div', {}, coupleLink(item.inquiry_id, item.names), h('p', {}, item.text),
          item.draft ? h('p', { class: 'draft-ready' }, 'The assistant left a draft reply. Open the couple to read it.') : null),
        item.action ? h('button', {
          type: 'button',
          onclick: async (event) => {
            event.currentTarget.disabled = true;
            try {
              await api(`/inquiries/${item.inquiry_id}`, { method: 'PATCH', body: { stage: item.action.stage } });
              say(`${item.names} moved to ${STAGE_LABEL[item.action.stage]}.`);
              load();
            } catch (error) { fail(error); }
          }
        }, item.action.label) : null))));
    }

    state.refresh = load;
    load();
  }

  // A small form for a new task, for one couple or for the studio.
  function taskForm(inquiryId, done) {
    const title = h('input', { type: 'text', maxlength: 200, placeholder: inquiryId ? 'A task for this wedding\u2026' : 'Add a task\u2026', 'aria-label': 'New task' });
    const due = h('input', { type: 'date', min: '2000-01-01', max: '2100-12-31', 'aria-label': 'Due date' });
    const button = h('button', { type: 'submit' }, 'Add');
    return h('form', {
      class: 'task-form',
      onsubmit: async (event) => {
        event.preventDefault();
        if (!title.value.trim()) { title.focus(); return; }
        if (!due.validity.valid) { due.focus(); return; }
        button.disabled = true;
        try {
          await api('/tasks', { method: 'POST', body: { title: title.value, due_date: due.value || null, inquiry_id: inquiryId } });
          title.value = '';
          due.value = '';
          done();
        } catch (error) { fail(error); }
        button.disabled = false;
      }
    }, title, due, button);
  }

  function dueLabel(task) {
    if (task.done) return 'Done';
    if (!task.due_date) return 'No date';
    const days = daysFromToday(task.due_date);
    if (days < 0) return `Overdue by ${plural(-days, 'day', 'days')}`;
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    return `Due ${localDate(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined })}`;
  }

  function drawTasks(wrap, tasks, reload, withNames) {
    clear(wrap);
    if (!tasks.length) {
      wrap.append(h('p', { class: 'empty-note' }, withNames ? 'Nothing due in the next two months.' : 'No tasks for this wedding.'));
      return;
    }
    wrap.append(h('ul', { class: 'tasks' }, tasks.map((task) => {
      const overdue = !task.done && task.due_date && daysFromToday(task.due_date) < 0;
      const box = h('input', {
        type: 'checkbox', 'aria-label': `Done: ${task.title}`,
        onchange: async () => {
          box.disabled = true;
          try {
            await api(`/tasks/${task.id}`, { method: 'PATCH', body: { done: box.checked } });
            if (box.checked) say(`Done: ${task.title}`);
            reload();
          } catch (error) { fail(error); box.checked = !box.checked; box.disabled = false; }
        }
      });
      box.checked = task.done;
      return h('li', { class: [task.done ? 'is-done' : '', overdue ? 'is-overdue' : ''].filter(Boolean).join(' ') || null },
        box,
        h('div', { class: 'task-text' },
          h('span', {}, task.title),
          h('small', {}, dueLabel(task), withNames && task.inquiry_id ? [' \u00b7 ', coupleLink(task.inquiry_id, task.names)] : null)),
        h('button', {
          class: 'link', type: 'button', 'aria-label': `Remove the task ${task.title}`,
          onclick: async () => {
            if (!window.confirm(`Remove \u201c${task.title}\u201d?`)) return;
            try { await api(`/tasks/${task.id}`, { method: 'DELETE' }); reload(); } catch (error) { fail(error); }
          }
        }, 'Remove'));
    })));
  }

  function drawActivity(wrap, items, withNames) {
    clear(wrap);
    if (!items.length) {
      wrap.append(h('p', { class: 'empty-note' }, 'Changes show up here as they happen.'));
      return;
    }
    wrap.append(h('ul', { class: 'activity' }, items.map((item) => h('li', { class: item.undone ? 'is-undone' : null },
      h('span', { class: `actor actor-${item.actor}` }, ACTOR_LABEL[item.actor] || item.actor),
      h('div', {},
        h('p', {}, item.summary),
        h('small', {}, fmtAgo(item.at), withNames && item.inquiry_id && item.names ? [' \u00b7 ', coupleLink(item.inquiry_id, item.names)] : null,
          item.undone ? ' \u00b7 undone' : null,
          item.actor === 'assistant' && !item.undone && item.kind !== 'draft'
            ? [' \u00b7 ', h('button', { class: 'link', type: 'button', onclick: (e) => undoChange(item.id, e.currentTarget) }, 'Undo')] : null))))));
  }

  /* ---------- Board ---------- */

  const BOARD_COLUMNS = ['new', 'replied', 'booked', 'planning', 'editing', 'delivered'];
  const boardState = { q: '' };

  function renderBoard(root, live) {
    const board = h('div', { class: 'board' }, h('p', { class: 'muted' }, 'Loading\u2026'));
    const search = h('input', { type: 'search', placeholder: 'Find a couple or a place\u2026', 'aria-label': 'Filter the board', value: boardState.q });
    let cards = [];
    search.addEventListener('input', () => { boardState.q = search.value.trim().toLowerCase(); draw(); });
    root.append(
      h('div', { class: 'view-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Every couple, by stage'), h('h1', {}, 'Board')),
        h('button', { class: 'primary', type: 'button', onclick: () => openEditor(null) }, '+ Add an inquiry')),
      h('div', { class: 'toolbar' }, search, h('p', { class: 'muted small board-hint' }, 'Open a card for the couple\u2019s page, or drag it to another stage.')),
      board);

    async function load() {
      try {
        ({ cards } = await api('/board'));
      } catch (error) {
        if (live()) clear(board).append(problem(error, 'The board fills in once the website has a volume to save to.'));
        return;
      }
      if (live()) draw();
    }

    const move = async (id, stage) => {
      const card = cards.find((c) => c.id === id);
      if (!card || card.stage === stage) return;
      const was = card.stage;
      card.stage = stage;
      draw();
      try {
        await api(`/inquiries/${id}`, { method: 'PATCH', body: { stage } });
        say(`${card.names} moved to ${STAGE_LABEL[stage]}.`);
        load();
      } catch (error) {
        card.stage = was;
        draw();
        fail(error);
      }
    };

    function draw() {
      const shown = boardState.q
        ? cards.filter((c) => [c.names, c.location, c.event_date, ...(c.tags || [])].join(' ').toLowerCase().includes(boardState.q))
        : cards;
      const sortKey = (c) => c.wedding_date || '9999';
      clear(board).append(...BOARD_COLUMNS.map((stage) => {
        let list = shown.filter((c) => c.stage === stage);
        list = stage === 'delivered'
          ? list.sort((a, b) => (sortKey(b) < sortKey(a) ? -1 : 1))
          : stage === 'new' || stage === 'replied'
            ? list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
            : list.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
        const column = h('section', { class: `column col-${stage}`, 'aria-label': STAGE_LABEL[stage] },
          h('header', {}, h('span', { class: `dot-stage st-${stage}` }), h('h2', {}, STAGE_LABEL[stage]), h('small', {}, String(list.length))),
          h('ol', {}, list.length
            ? list.map((c) => h('li', {},
              h('button', {
                class: 'board-card', type: 'button', draggable: 'true',
                'aria-label': [c.names, c.wedding_date ? fmtDay(c.wedding_date) : 'no date', c.location, STAGE_LABEL[c.stage]].filter(Boolean).join(', '),
                onclick: () => { location.hash = `couple/${c.id}`; },
                ondragstart: (event) => { event.dataTransfer.setData('text/plain', c.id); event.dataTransfer.effectAllowed = 'move'; event.currentTarget.classList.add('dragging'); },
                ondragend: (event) => event.currentTarget.classList.remove('dragging')
              },
              dateBlock(c.wedding_date),
              h('span', { class: 'board-text' },
                h('strong', {}, c.names),
                c.location ? h('small', {}, c.location) : !c.wedding_date && c.event_date ? h('small', {}, `\u201c${c.event_date}\u201d`) : null,
                c.days !== null && c.days !== undefined ? h('small', { class: 'board-count' }, countdown(c.days)) : null,
                c.tags && c.tags.length ? h('span', { class: 'tag-row' }, c.tags.map((tag) => h('span', { class: 'tag' }, tag))) : null))))
            : h('li', { class: 'column-empty' }, 'Nothing here')));
        column.addEventListener('dragover', (event) => { event.preventDefault(); column.classList.add('drop'); });
        column.addEventListener('dragleave', (event) => { if (!column.contains(event.relatedTarget)) column.classList.remove('drop'); });
        column.addEventListener('drop', (event) => {
          event.preventDefault();
          column.classList.remove('drop');
          move(event.dataTransfer.getData('text/plain'), stage);
        });
        return column;
      }));
    }

    state.refresh = load;
    load();
  }

  /* ---------- Phone calendar ---------- */

  function phoneCalendar() {
    const box = h('div', { class: 'feed', hidden: true });
    const open = async (renew) => {
      if (renew && !window.confirm('Make a new address? Phones using the old one stop getting updates until you add the new one.')) return;
      try {
        const { url } = await api('/calendar-feed', { method: renew ? 'POST' : 'GET' });
        const webcal = url.replace(/^https:/, 'webcal:');
        clear(box).append(
          h('p', {}, 'Subscribe once and booked weddings and task due dates show up in your phone\u2019s calendar, updated about every hour. Keep this address private: anyone with it can see the weddings.'),
          h('div', { class: 'actions' },
            h('a', { class: 'button primary', href: webcal }, 'Add to this device'),
            h('button', {
              type: 'button',
              onclick: async () => {
                try { await navigator.clipboard.writeText(url); say('Calendar address copied.'); } catch (error) { window.prompt('Copy the calendar address:', url); }
              }
            }, 'Copy the address'),
            h('button', { class: 'quiet', type: 'button', onclick: () => open(true) }, 'Make a new address')));
        box.hidden = false;
      } catch (error) { fail(error); }
    };
    return h('div', {}, h('button', { class: 'quiet', type: 'button', onclick: () => (box.hidden ? open(false) : (box.hidden = true)) }, 'Phone calendar'), box);
  }

  /* ---------- Assistant ---------- */

  const undoChange = async (activityId, button) => {
    button.disabled = true;
    try {
      await api(`/activity/${activityId}/undo`, { method: 'POST' });
      button.textContent = 'Undone';
      say('Undone.');
      refreshCurrent();
      if (detail.open && detail.dataset.inquiry) openDetail(detail.dataset.inquiry);
    } catch (error) {
      fail(error);
      button.disabled = false;
    }
  };

  const mailtoFor = (email, subject, body) => (email && LINKABLE_EMAIL.test(email)
    ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null);

  function draftCard(draft, email, onDiscard) {
    const href = mailtoFor(email, draft.subject, draft.body);
    return h('div', { class: 'draft-card' },
      h('p', { class: 'mini-label' }, 'Draft reply'),
      h('strong', {}, draft.subject),
      h('p', { class: 'pre' }, draft.body),
      h('div', { class: 'actions' },
        href ? h('a', { class: 'button primary', href }, 'Open in email') : null,
        h('button', {
          type: 'button',
          onclick: async () => {
            try { await navigator.clipboard.writeText(`${draft.body}`); say('Draft copied.'); } catch (error) { window.prompt('Copy the draft:', draft.body); }
          }
        }, 'Copy'),
        onDiscard ? h('button', { class: 'quiet', type: 'button', onclick: onDiscard }, 'Discard') : null));
  }

  function eventView(event) {
    if (event.type === 'change') {
      const undo = event.activity_id ? h('button', { class: 'link', type: 'button', onclick: (e) => undoChange(event.activity_id, e.currentTarget) }, 'Undo') : null;
      return h('li', { class: 'ev ev-change' },
        h('span', { class: 'ev-mark', 'aria-hidden': 'true' }, '\u2713'),
        h('span', {}, event.names && event.inquiry_id ? [coupleLink(event.inquiry_id, event.names), ': '] : null, event.text),
        undo);
    }
    if (event.type === 'proposal' && event.payment) {
      const apply = h('button', {
        class: 'primary', type: 'button',
        onclick: async (e) => {
          const button = e.currentTarget;
          button.disabled = true;
          try {
            await api(`/payments/${event.payment.id}`, { method: 'PATCH', body: { paid: true } });
            button.textContent = 'Applied';
            say(`${event.payment.label} marked paid for ${event.names}.`);
            refreshCurrent();
          } catch (error) { fail(error); button.disabled = false; }
        }
      }, 'Apply');
      return h('li', { class: 'ev ev-proposal' },
        h('p', { class: 'mini-label' }, 'Waiting for your click'),
        h('p', {}, coupleLink(event.inquiry_id, event.names), `: mark ${event.payment.label} (${fmtMoney(event.payment.amount)}) paid`),
        event.why ? h('p', { class: 'muted small' }, event.why) : null,
        h('div', { class: 'actions' }, apply));
    }
    if (event.type === 'proposal') {
      const parts = [];
      if ('price' in event.changes) parts.push(`agreed ${fmtMoney(event.was.price)} \u2192 ${fmtMoney(event.changes.price)}`);
      if ('paid' in event.changes) parts.push(`received ${fmtMoney(event.was.paid)} \u2192 ${fmtMoney(event.changes.paid)}`);
      const apply = h('button', {
        class: 'primary', type: 'button',
        onclick: async (e) => {
          const button = e.currentTarget;
          button.disabled = true;
          try {
            await api(`/inquiries/${event.inquiry_id}`, { method: 'PATCH', body: event.changes });
            button.textContent = 'Applied';
            say(`Money updated for ${event.names}.`);
            refreshCurrent();
          } catch (error) { fail(error); button.disabled = false; }
        }
      }, 'Apply');
      return h('li', { class: 'ev ev-proposal' },
        h('p', { class: 'mini-label' }, 'Waiting for your click'),
        h('p', {}, coupleLink(event.inquiry_id, event.names), `: ${parts.join(', ')}`),
        event.why ? h('p', { class: 'muted small' }, event.why) : null,
        h('div', { class: 'actions' }, apply));
    }
    if (event.type === 'draft') {
      return h('li', { class: 'ev ev-draft' }, draftCard(event.draft, event.email, null));
    }
    return null;
  }

  function buildAssistant() {
    const log = h('ol', { class: 'chat-log', 'aria-live': 'polite' });
    const input = h('textarea', { rows: 2, maxlength: 4000, placeholder: 'Ask, or tell me what to change\u2026', 'aria-label': 'Message to the assistant' });
    const send = h('button', { class: 'primary', type: 'submit' }, 'Send');
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    let listening = null;
    const mic = Speech ? h('button', {
      class: 'quiet mic', type: 'button', 'aria-label': 'Speak instead of typing', 'aria-pressed': 'false',
      onclick: () => {
        if (listening) { listening.stop(); return; }
        const recognition = new Speech();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        const start = input.value;
        recognition.onresult = (e) => {
          const said = Array.from(e.results).map((r) => r[0].transcript).join(' ');
          input.value = `${start}${start && !/\s$/.test(start) ? ' ' : ''}${said}`;
        };
        recognition.onend = () => { listening = null; mic.setAttribute('aria-pressed', 'false'); };
        recognition.onerror = () => say('I couldn\u2019t hear that. Check the microphone permission.', 'error');
        listening = recognition;
        mic.setAttribute('aria-pressed', 'true');
        recognition.start();
      }
    }, 'Speak') : null;
    const form = h('form', { class: 'chat-form' }, input, h('div', { class: 'chat-buttons' }, mic, send));
    const panel = h('aside', { class: 'assistant', 'aria-label': 'Studio assistant', hidden: true },
      h('div', { class: 'assistant-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Studio'), h('h2', {}, 'Assistant')),
        h('button', { class: 'quiet', type: 'button', onclick: fresh }, 'New conversation'),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close the assistant', onclick: () => toggle(false) }, '\u00d7')),
      log, form);
    const opener = h('button', { class: 'assistant-open primary', type: 'button', 'aria-expanded': 'false', onclick: () => toggle() }, 'Ask the assistant');
    let loaded = false;
    let enabled = true;

    const bubble = (who, text, events = []) => {
      const item = h('li', { class: `msg msg-${who}` },
        who === 'website' ? h('p', { class: 'mini-label' }, 'New inquiry, first pass') : null,
        text ? h('p', { class: 'pre' }, text) : null,
        events.length ? h('ul', { class: 'events' }, events.map(eventView)) : null);
      log.append(item);
      log.scrollTop = log.scrollHeight;
      return item;
    };
    const intro = () => bubble('assistant', 'Ask me about couples, dates, tasks and money, or tell me what to change. For example: \u201cMove Jessica & Kyle to Editing and add a note that they want the sparkler exit\u201d, or \u201cIs June 12 free?\u201d. I can\u2019t delete anything or send email, and money changes wait for your click.');

    async function load() {
      clear(log);
      try {
        const data = await api('/assistant');
        enabled = data.enabled;
        if (!enabled) {
          log.append(h('li', { class: 'msg msg-assistant' },
            h('p', {}, 'The assistant isn\u2019t turned on yet. Add an OPENROUTER_API_KEY variable (or ANTHROPIC_API_KEY) to the website service on Railway, and it starts working after the site redeploys.')));
          input.disabled = true;
          send.disabled = true;
          return;
        }
        if (!data.turns.length) intro();
        for (const turn of data.turns) bubble(turn.who === 'website' ? 'website' : turn.who === 'you' ? 'you' : 'assistant', turn.who === 'website' ? '' : turn.text, turn.events);
        loaded = true;
      } catch (error) {
        log.append(h('li', { class: 'msg msg-assistant' }, h('p', { class: 'error-text' }, error.message)));
      }
    }

    async function fresh() {
      try {
        await api('/assistant/new', { method: 'POST' });
        clear(log);
        intro();
      } catch (error) { fail(error); }
    }

    function toggle(open = panel.hidden) {
      panel.hidden = !open;
      opener.hidden = open;
      opener.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('with-assistant', open);
      if (open) {
        if (!loaded) load();
        input.focus();
      }
    }

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = input.value.trim();
      if (!message || !enabled) return;
      if (listening) listening.stop();
      input.value = '';
      bubble('you', message);
      const waiting = bubble('assistant', 'Working on it\u2026');
      waiting.classList.add('is-waiting');
      send.disabled = true;
      try {
        const { reply, events } = await api('/assistant', { method: 'POST', body: { message } });
        waiting.remove();
        bubble('assistant', reply, events);
        if (events.length) refreshCurrent();
      } catch (error) {
        waiting.remove();
        bubble('assistant', error.message);
        if (!error.silent) input.value = input.value || message;
      }
      send.disabled = false;
      input.focus();
    });

    return { panel, opener, toggle };
  }

  /* ---------- One couple's page ---------- */

  const fmtClock = (time) => {
    if (!time) return '';
    const [hh, mm] = time.split(':').map(Number);
    return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
  };
  const CATEGORY_NAMES = { wedding: 'wedding', engagement: 'engagement', session: 'session' };

  function renderCouple(root, live, id) {
    const hero = h('section', { class: 'couple-hero' }, h('p', { class: 'muted' }, 'Loading\u2026'));
    const timeline = h('section', { class: 'panel', 'aria-labelledby': 'tl-title' });
    const payments = h('section', { class: 'panel', 'aria-labelledby': 'pay-title' });
    const gallery = h('section', { class: 'panel', 'aria-labelledby': 'gal-title' });
    root.append(
      h('a', { class: 'back-link', href: '#board' }, '\u2190 Board'),
      hero,
      h('div', { class: 'couple-grid' }, timeline, h('div', {}, contractsPanel(id), payments, gallery)));

    let inq = null;
    let project = null;

    async function load() {
      try {
        const [one, proj] = await Promise.all([api(`/inquiries/${encodeURIComponent(id)}`), api(`/inquiries/${encodeURIComponent(id)}/project`)]);
        if (!live()) return;
        inq = one.inquiry;
        project = proj;
        document.title = `${coupleName(inq)} \u00b7 Studio \u00b7 Alex Claudio`;
        drawHero();
        drawTimeline();
        drawPayments();
        drawGallery();
      } catch (error) {
        if (live()) append(clear(hero), [problem(error, 'Couples appear here once the website has a volume to save to.')]);
      }
    }
    const reloadProject = async () => {
      try {
        const [one, proj] = await Promise.all([api(`/inquiries/${encodeURIComponent(id)}`), api(`/inquiries/${encodeURIComponent(id)}/project`)]);
        if (!live()) return;
        inq = one.inquiry;
        project = proj;
        drawHero();
        drawTimeline();
        drawPayments();
        drawGallery();
      } catch (error) { fail(error); }
    };

    function drawHero() {
      const cover = project.gallery && project.gallery.found && project.gallery.hero;
      const days = inq.wedding_date ? daysFromToday(inq.wedding_date) : null;
      const img = cover ? h('img', { class: 'couple-cover', src: cover, alt: '' }) : null;
      if (img && project.gallery.hero_position) img.style.objectPosition = project.gallery.hero_position;
      append(clear(hero), [
        img,
        h('div', { class: 'couple-hero-text' },
          h('p', { class: 'eyebrow' }, stageBadge(inq.stage)),
          h('h1', {}, coupleName(inq)),
          h('p', { class: 'couple-line' }, [
            inq.wedding_date ? fmtDay(inq.wedding_date, true) : inq.event_date ? `They wrote \u201c${inq.event_date}\u201d` : 'No date yet',
            days !== null ? countdown(days) : '',
            inq.location
          ].filter(Boolean).join(' \u00b7 ')),
          inq.tags && inq.tags.length ? h('p', { class: 'tag-row' }, inq.tags.map((tag) => h('span', { class: 'tag' }, tag))) : null,
          h('div', { class: 'actions' },
            h('button', { class: 'primary', type: 'button', onclick: () => openDetail(inq.id) }, 'Details, notes and tasks'),
            inq.email && LINKABLE_EMAIL.test(inq.email) ? h('a', { class: 'button', href: `mailto:${inq.email}` }, 'Email them') : null))]);
      hero.classList.toggle('has-cover', Boolean(img));
    }

    /* The day's timeline */
    function drawTimeline() {
      const light = project.light;
      const items = project.timeline;
      const lightLine = light
        ? h('p', { class: 'light-line' }, `Sunset ${fmtClock(light.sunset)} \u00b7 golden hour from about ${fmtClock(light.golden_hour)} (Seattle)`)
        : h('p', { class: 'muted small' }, 'Set the wedding date to see sunset and golden hour.');
      const copy = items.length ? h('button', {
        class: 'quiet', type: 'button',
        onclick: async () => {
          const text = [`${coupleName(inq)}${inq.wedding_date ? ` \u00b7 ${fmtDay(inq.wedding_date, true)}` : ''}`, '',
            ...items.map((item) => `${item.time ? fmtClock(item.time).padEnd(9) : '         '}${item.title}${item.place ? ` (${item.place})` : ''}${item.note ? ` \u2013 ${item.note}` : ''}`)].join('\n');
          try { await navigator.clipboard.writeText(text); say('Timeline copied as text.'); } catch (error) { window.prompt('Copy the timeline:', text); }
        }
      }, 'Copy as text') : null;

      const rows = items.map((item) => {
        const time = h('input', { type: 'time', value: item.time || '', 'aria-label': 'Time' });
        const title = h('input', { type: 'text', value: item.title, maxlength: 200, 'aria-label': 'What happens' });
        const place = h('input', { type: 'text', value: item.place, maxlength: 200, placeholder: 'Where', 'aria-label': 'Where' });
        const save = async (field, value) => {
          if ((item[field] || '') === value) return;
          try {
            const { item: saved } = await api(`/timeline/${item.id}`, { method: 'PATCH', body: { [field]: value } });
            Object.assign(item, saved);
            if (field === 'time') { project.timeline.sort((a, b) => ((a.time || '99') < (b.time || '99') ? -1 : 1)); drawTimeline(); }
          } catch (error) { fail(error); }
        };
        time.addEventListener('change', () => save('time', time.value));
        title.addEventListener('change', () => { if (title.value.trim()) save('title', title.value.trim()); else title.value = item.title; });
        place.addEventListener('change', () => save('place', place.value.trim()));
        return h('li', { class: item.title.toLowerCase().includes('sunset') ? 'is-sunset' : null }, time, title, place,
          h('button', {
            class: 'tag-x', type: 'button', 'aria-label': `Remove ${item.title}`,
            onclick: async () => {
              try {
                await api(`/timeline/${item.id}`, { method: 'DELETE' });
                project.timeline = project.timeline.filter((other) => other.id !== item.id);
                drawTimeline();
              } catch (error) { fail(error); }
            }
          }, '\u00d7'));
      });

      const newTime = h('input', { type: 'time', 'aria-label': 'Time of the new line' });
      const newTitle = h('input', { type: 'text', maxlength: 200, placeholder: 'Add a moment\u2026', 'aria-label': 'What happens' });
      const addForm = h('form', {
        class: 'timeline-add',
        onsubmit: async (event) => {
          event.preventDefault();
          if (!newTitle.value.trim()) { newTitle.focus(); return; }
          try {
            const { item } = await api(`/inquiries/${inq.id}/timeline`, { method: 'POST', body: { time: newTime.value || null, title: newTitle.value } });
            project.timeline.push(item);
            project.timeline.sort((a, b) => ((a.time || '99') < (b.time || '99') ? -1 : 1));
            drawTimeline();
          } catch (error) { fail(error); }
        }
      }, newTime, newTitle, h('button', { type: 'submit' }, 'Add'));

      let starter = null;
      if (!items.length) {
        const ceremony = h('input', { type: 'time', value: '16:00', 'aria-label': 'Ceremony time' });
        starter = h('form', {
          class: 'timeline-start',
          onsubmit: async (event) => {
            event.preventDefault();
            if (!ceremony.value) { ceremony.focus(); return; }
            try {
              project = { ...project, ...(await api(`/inquiries/${inq.id}/timeline/start`, { method: 'POST', body: { ceremony: ceremony.value } })) };
              drawTimeline();
              say('Started from a typical day. Change any line.');
            } catch (error) { fail(error); }
          }
        }, h('label', {}, 'Ceremony at', ceremony), h('button', { class: 'primary', type: 'submit' }, 'Start from a typical day'));
      }

      append(clear(timeline), [
        h('div', { class: 'panel-head' }, h('h2', { id: 'tl-title' }, 'The day'), copy),
        lightLine,
        starter,
        items.length ? h('ol', { class: 'timeline' }, rows) : h('p', { class: 'muted small' }, 'Or add the moments one by one.'),
        addForm]);
    }

    /* Payments */
    function drawPayments() {
      const price = inq.price;
      const paid = inq.paid || 0;
      const left = price === null || price === undefined ? null : Math.max(0, price - paid);
      const list = project.payments;
      const rows = list.map((payment) => {
        const box = h('input', {
          type: 'checkbox', 'aria-label': `${payment.label} paid`,
          onchange: async () => {
            box.disabled = true;
            try {
              await api(`/payments/${payment.id}`, { method: 'PATCH', body: { paid: box.checked } });
              say(box.checked ? `${payment.label} marked paid.` : `${payment.label} marked not paid.`);
              reloadProject();
            } catch (error) { fail(error); box.checked = !box.checked; box.disabled = false; }
          }
        });
        box.checked = payment.paid;
        const status = payment.paid ? `Paid ${fmtReceived(payment.paid_at)}`
          : !payment.due_date ? 'No due date'
            : payment.overdue ? `Overdue since ${fmtDay(payment.due_date)}` : `Due ${fmtDay(payment.due_date)}`;
        return h('li', { class: [payment.paid ? 'is-paid' : '', payment.overdue ? 'is-overdue' : ''].filter(Boolean).join(' ') || null },
          box,
          h('div', { class: 'task-text' }, h('span', {}, `${payment.label} \u00b7 ${fmtMoney(payment.amount)}`), h('small', {}, status)),
          h('button', {
            class: 'link', type: 'button', 'aria-label': `Remove ${payment.label}`,
            onclick: async () => {
              if (!window.confirm(`Remove \u201c${payment.label}\u201d from the schedule?`)) return;
              try { await api(`/payments/${payment.id}`, { method: 'DELETE' }); reloadProject(); } catch (error) { fail(error); }
            }
          }, 'Remove'));
      });

      const label = h('input', { type: 'text', maxlength: 100, placeholder: 'e.g. Album', 'aria-label': 'Payment name' });
      const amount = h('input', { type: 'text', inputmode: 'decimal', placeholder: '$', 'aria-label': 'Amount' });
      const due = h('input', { type: 'date', min: '2000-01-01', max: '2100-12-31', 'aria-label': 'Due date' });
      const addForm = h('form', {
        class: 'payment-add',
        onsubmit: async (event) => {
          event.preventDefault();
          const raw = amount.value.replace(/[$,\s]/g, '');
          if (!label.value.trim()) { label.focus(); return; }
          if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw)) { amount.focus(); say('Amounts are plain numbers, like 1200.', 'error'); return; }
          try {
            await api(`/inquiries/${inq.id}/payments`, { method: 'POST', body: { label: label.value, amount: Number(raw), due_date: due.value || null } });
            reloadProject();
          } catch (error) { fail(error); }
        }
      }, label, amount, due, h('button', { type: 'submit' }, 'Add'));

      const gap = project.schedule.unscheduled;
      append(clear(payments), [
        h('h2', { id: 'pay-title' }, 'Payments'),
        h('div', { class: 'money' },
          h('div', {}, h('span', {}, 'Agreed'), h('strong', {}, fmtMoney(price))),
          h('div', {}, h('span', {}, 'Received'), h('strong', {}, fmtMoney(inq.paid))),
          h('div', {}, h('span', {}, 'Left'), h('strong', {}, fmtMoney(left)))),
        !list.length
          ? h('div', { class: 'schedule-start' },
            h('button', {
              class: 'primary', type: 'button', disabled: !price,
              onclick: async () => {
                try { await api(`/inquiries/${inq.id}/payments/start`, { method: 'POST' }); say('Payment schedule made.'); reloadProject(); } catch (error) { fail(error); }
              }
            }, 'Make the usual schedule'),
            h('p', { class: 'muted small' }, price
              ? `${fmtMoney(Math.round(price * 30) / 100)} retainer (30%) now, the balance a week before the wedding, as in your contract. Every line can be changed.`
              : 'Set the agreed price in Details first.'))
          : h('ul', { class: 'tasks payments' }, rows),
        list.length && gap ? h('p', { class: 'schedule-gap' }, gap > 0
          ? `The schedule adds up to ${fmtMoney(project.schedule.total)}, ${fmtMoney(gap)} less than the agreed price.`
          : `The schedule adds up to ${fmtMoney(project.schedule.total)}, ${fmtMoney(-gap)} more than the agreed price.`) : null,
        h('p', { class: 'mini-label add-label' }, 'Add a payment'),
        addForm]);
    }

    /* Gallery */
    function drawGallery() {
      const g = project.gallery;
      const unlink = h('button', {
        class: 'link', type: 'button',
        onclick: async () => {
          try { project = { ...project, ...(await api(`/inquiries/${inq.id}/gallery`, { method: 'PUT', body: { slug: null } })) }; drawGallery(); drawHero(); } catch (error) { fail(error); }
        }
      }, 'Unlink');
      let body;
      if (!g) {
        const slug = h('input', { type: 'text', placeholder: 'renee-alan', 'aria-label': 'Gallery name', autocomplete: 'off' });
        body = [
          h('p', { class: 'muted small' }, 'Link the gallery once it\u2019s uploaded: the name at the end of alex-claudio.com/gallery/\u2026, or paste the whole link. Its cover becomes this page\u2019s photo.'),
          h('form', {
            class: 'gallery-link',
            onsubmit: async (event) => {
              event.preventDefault();
              if (!slug.value.trim()) { slug.focus(); return; }
              try {
                project = { ...project, ...(await api(`/inquiries/${inq.id}/gallery`, { method: 'PUT', body: { slug: slug.value } })) };
                drawGallery();
                drawHero();
                say(project.gallery && project.gallery.found ? 'Gallery linked.' : 'Linked. No photos found under that name yet.');
              } catch (error) { fail(error); }
            }
          }, slug, h('button', { type: 'submit' }, 'Link'))
        ];
      } else if (!g.found) {
        body = [h('p', {}, h('a', { href: g.url, target: '_blank', rel: 'noopener' }, `/gallery/${g.slug}`)), h('p', { class: 'error-text' }, g.reason), unlink];
      } else {
        const counts = Object.entries(g.counts).map(([category, n]) => `${n.toLocaleString('en-US')} ${CATEGORY_NAMES[category] || category}`).join(' \u00b7 ');
        body = [
          h('p', {}, h('strong', {}, g.name || g.slug), g.date ? ` \u00b7 ${g.date}` : ''),
          h('p', { class: 'muted small' }, `${counts} photos`),
          h('div', { class: 'actions' },
            h('a', { class: 'button', href: g.url, target: '_blank', rel: 'noopener' }, 'Open the gallery'),
            h('button', {
              type: 'button',
              onclick: async () => {
                const url = `${location.origin}${g.url}`;
                try { await navigator.clipboard.writeText(url); say('Gallery link copied.'); } catch (error) { window.prompt('Copy the gallery link:', url); }
              }
            }, 'Copy link'),
            inq.stage === 'editing' ? h('button', {
              class: 'primary', type: 'button',
              onclick: async () => {
                try { await api(`/inquiries/${inq.id}`, { method: 'PATCH', body: { stage: 'delivered' } }); say('Marked delivered. The gallery task is done.'); reloadProject(); } catch (error) { fail(error); }
              }
            }, 'Mark delivered') : null),
          unlink
        ];
      }
      append(clear(gallery), [h('h2', { id: 'gal-title' }, 'Gallery'), ...body]);
    }

    state.refresh = reloadProject;
    load();
  }

  /* ---------- Contracts ---------- */

  const CONTRACT_STATUS = { draft: 'Draft', sent: 'Waiting for their signature', signed: 'Signed' };
  const contractLink = (contract) => `${location.origin}/contract/${contract.token}`;

  // Your own signature: drawn once here, put on every contract you send.
  function signatureDialog(onSaved) {
    const dialog = h('dialog', { class: 'sheet sig-dialog', 'aria-labelledby': 'sig-title' });
    const pad = window.SignaturePad({ label: 'Draw your signature' });
    const error = h('p', { class: 'error-text', role: 'alert' });
    const save = h('button', {
      class: 'primary', type: 'button',
      onclick: async () => {
        const signature = pad.toDataURL();
        if (!signature) { error.textContent = 'Draw your signature first.'; return; }
        save.disabled = true;
        try {
          await api('/signature', { method: 'PUT', body: { signature } });
          dialog.close();
          say('Signature saved. It goes on every contract you send.');
          onSaved(signature);
        } catch (err) { error.textContent = err.message; save.disabled = false; }
      }
    }, 'Save my signature');
    dialog.append(
      h('div', { class: 'sheet-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Once, for every contract'), h('h2', { id: 'sig-title' }, 'Your signature')),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, '\u00d7')),
      h('div', { class: 'sig-body' }, pad.element, error, h('div', { class: 'actions' }, save)));
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }

  function renderContract(root, live, id) {
    const panel = h('aside', { class: 'contract-fields', 'aria-label': 'Fields to fill in' });
    const paper = h('article', { class: 'contract-paper' });
    const bar = h('div', { class: 'contract-bar' });
    root.append(bar, h('div', { class: 'contract-layout' }, panel, h('div', { class: 'contract-preview' }, paper)));

    let contract = null;
    let couple = null;
    let mySignature = null;
    let saveTimer = 0;
    let saving = Promise.resolve();
    const savedNote = h('small', { class: 'save-note', 'aria-live': 'polite' });

    async function load() {
      try {
        const [one, sig] = await Promise.all([api(`/contracts/${encodeURIComponent(id)}`), api('/signature')]);
        if (!live()) return;
        contract = one.contract;
        couple = one.couple;
        mySignature = sig.signature;
        document.title = `Contract \u00b7 ${coupleName(couple || {})} \u00b7 Studio`;
        drawBar();
        drawFields();
        drawPaper();
      } catch (error) {
        if (live()) append(clear(root), [problem(error, 'Contracts appear here once the website has a volume to save to.')]);
      }
    }

    const drawPaper = () => {
      window.ContractDoc.render(paper, contract.fields, {
        photographer: contract.status === 'draft' ? { signature: mySignature, signed_at: null } : contract.photographer,
        client: contract.client
      });
    };

    const saveSoon = () => {
      clearTimeout(saveTimer);
      savedNote.textContent = 'Saving\u2026';
      saveTimer = setTimeout(() => {
        saving = saving.then(async () => {
          try {
            ({ contract } = await api(`/contracts/${contract.id}`, { method: 'PATCH', body: { fields: contract.fields } }));
            savedNote.textContent = 'Saved';
          } catch (error) { savedNote.textContent = ''; fail(error); }
        });
      }, 600);
    };
    const flush = async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = 0;
        saving = saving.then(async () => { ({ contract } = await api(`/contracts/${contract.id}`, { method: 'PATCH', body: { fields: contract.fields } })); });
      }
      await saving;
    };

    function drawFields() {
      const locked = contract.status !== 'draft';
      const missing = new Set(window.ContractDoc.missing(contract.fields));
      const groups = {};
      for (const field of window.ContractDoc.FIELDS) (groups[field.group] = groups[field.group] || []).push(field);
      const words = () => window.ContractDoc.words(contract.fields);
      const totals = h('dl', { class: 'contract-totals' });
      const drawTotals = () => {
        const w = words();
        append(clear(totals), [
          h('div', {}, h('dt', {}, 'Total fee'), h('dd', {}, w.total)),
          h('div', {}, h('dt', {}, 'Balance'), h('dd', {}, w.balance)),
          h('div', {}, h('dt', {}, 'Balance due'), h('dd', {}, w.balance_due))]);
      };
      drawTotals();
      append(clear(panel), [
        locked ? h('p', { class: 'contract-locked' }, contract.status === 'signed'
          ? 'Signed, so nothing here can change.'
          : 'Sent to the couple. Take it back to change anything.') : null,
        ...Object.entries(groups).map(([group, fields]) => h('fieldset', { class: 'contract-group', disabled: locked },
          h('legend', {}, group),
          fields.map((field) => {
            const value = contract.fields[field.key];
            let control;
            if (field.type === 'yesno') {
              control = h('select', {}, h('option', { value: 'Yes' }, 'Yes'), h('option', { value: 'No' }, 'No'));
              control.value = value;
            } else {
              control = h('input', {
                type: field.type === 'date' ? 'date' : 'text',
                inputmode: field.type === 'money' || field.type === 'number' ? 'decimal' : null,
                value: value === null || value === undefined ? '' : String(value),
                placeholder: field.client ? 'They can fill this in when signing' : null
              });
            }
            const label = h('label', { class: missing.has(field.key) ? 'is-missing' : null }, field.label + (field.type === 'money' ? ' ($)' : ''), control);
            control.addEventListener('input', () => {
              let next = control.value;
              if (field.type === 'money' || field.type === 'number') next = next.replace(/[$,\s]/g, '');
              contract.fields = window.ContractDoc.clean({ ...contract.fields, [field.key]: next === '' && field.type !== 'text' && field.type !== 'date' ? '' : next });
              label.classList.toggle('is-missing', window.ContractDoc.missing(contract.fields).includes(field.key));
              drawPaper();
              drawTotals();
              saveSoon();
            });
            return label;
          }),
          group === 'Fees' ? totals : null))]);
    }

    function drawBar() {
      const status = h('span', { class: `badge contract-status cs-${contract.status}` }, CONTRACT_STATUS[contract.status]);
      const actions = [];
      if (contract.status === 'draft') {
        actions.push(h('button', { type: 'button', class: 'quiet', onclick: () => signatureDialog((sig) => { mySignature = sig; drawPaper(); }) }, mySignature ? 'Redraw my signature' : 'Add my signature'));
        actions.push(h('button', {
          type: 'button', class: 'primary',
          onclick: async () => {
            await flush();
            if (!mySignature) { signatureDialog((sig) => { mySignature = sig; drawPaper(); }); return; }
            if (!window.confirm(`Sign this contract and make the link for ${coupleName(couple || {})}? You can take it back until they sign.`)) return;
            try {
              ({ contract } = await api(`/contracts/${contract.id}/send`, { method: 'POST' }));
              say('Signed by you. Copy the link and send it to the couple.');
              drawBar(); drawFields(); drawPaper();
            } catch (error) { fail(error); }
          }
        }, 'Sign and get the link'));
        actions.push(h('button', {
          type: 'button', class: 'danger',
          onclick: async () => {
            if (!window.confirm('Delete this draft contract?')) return;
            try { await api(`/contracts/${contract.id}`, { method: 'DELETE' }); location.hash = `couple/${contract.inquiry_id}`; } catch (error) { fail(error); }
          }
        }, 'Delete draft'));
      } else {
        const url = contractLink(contract);
        actions.push(h('button', {
          type: 'button', class: contract.status === 'sent' ? 'primary' : null,
          onclick: async () => { try { await navigator.clipboard.writeText(url); say('Link copied.'); } catch (error) { window.prompt('Copy the contract link:', url); } }
        }, 'Copy their link'));
        if (contract.status === 'sent' && couple && couple.email && LINKABLE_EMAIL.test(couple.email)) {
          const body = `Hi ${(couple.names || '').split(/\s*&\s*|\s+and\s+/)[0] || 'there'},\n\nHere is our agreement to read and sign online:\n${url}\n\nOnce it's signed, the ${window.ContractDoc.words(contract.fields).retainer} retainer reserves your date. Let me know if anything should change.\n\nAlex`;
          actions.push(h('a', { class: 'button', href: `mailto:${couple.email}?subject=${encodeURIComponent('Our agreement for your wedding')}&body=${encodeURIComponent(body)}` }, 'Email it to them'));
        }
        actions.push(h('a', { class: 'button quiet', href: url, target: '_blank', rel: 'noopener' }, 'See their page'));
        if (contract.status === 'sent') {
          actions.push(h('button', {
            type: 'button', class: 'quiet',
            onclick: async () => {
              if (!window.confirm('Take the contract back to change it? Their link stops working until you sign and send it again.')) return;
              try { ({ contract } = await api(`/contracts/${contract.id}/take-back`, { method: 'POST' })); drawBar(); drawFields(); drawPaper(); } catch (error) { fail(error); }
            }
          }, 'Take back to edit'));
        }
      }
      const audit = contract.status === 'signed'
        ? h('p', { class: 'contract-audit' }, `Signed by ${contract.client.name} on ${fmtStamp(contract.client.signed_at)}${contract.client.ip ? ` from ${contract.client.ip}` : ''}. Fingerprint ${contract.document_hash.slice(0, 16)}\u2026`)
        : contract.status === 'sent'
          ? h('p', { class: 'contract-audit' }, `Sent ${fmtStamp(contract.sent_at)} \u00b7 ${contract.viewed_at ? `opened ${fmtStamp(contract.viewed_at)}` : 'not opened yet'}`)
          : null;
      append(clear(bar), [
        h('a', { class: 'back-link', href: `#couple/${contract.inquiry_id}` }, `\u2190 ${coupleName(couple || {})}`),
        h('div', { class: 'contract-bar-row' },
          h('h1', {}, 'Contract'), status, contract.status === 'draft' ? savedNote : null,
          h('div', { class: 'actions' }, actions)),
        audit]);
    }

    state.refresh = null;
    load();
  }

  // The Contract panel on a couple's page.
  function contractsPanel(inquiryId) {
    const wrap = h('section', { class: 'panel', 'aria-labelledby': 'ct-title' }, h('h2', { id: 'ct-title' }, 'Contract'));
    (async () => {
      let contracts = [];
      try { ({ contracts } = await api(`/inquiries/${inquiryId}/contracts`)); } catch (error) { wrap.append(h('p', { class: 'error-text' }, error.message)); return; }
      append(wrap, [
        contracts.length ? h('ul', { class: 'contract-list' }, contracts.map((c) => h('li', {},
          h('a', { href: `#contract/${c.id}` }, `Agreement started ${fmtReceived(c.created_at)}`),
          h('span', { class: `badge contract-status cs-${c.status}` }, CONTRACT_STATUS[c.status])))) : h('p', { class: 'muted small' }, 'No contract yet. A new one fills in from this couple\u2019s details.'),
        h('button', {
          type: 'button', class: contracts.length ? 'quiet' : 'primary',
          onclick: async () => {
            try { const { contract } = await api(`/inquiries/${inquiryId}/contracts`, { method: 'POST' }); location.hash = `contract/${contract.id}`; } catch (error) { fail(error); }
          }
        }, contracts.length ? 'New contract' : 'Make the contract')]);
    })();
    return wrap;
  }

  /* ---------- Analytics ---------- */

  const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['12m', '12 months']];
  const VERSUS = { today: 'yesterday by this time', '7d': 'the 7 days before', '30d': 'the 30 days before', '90d': 'the 90 days before', '12m': 'the year before' };
  const PAGE_NAMES = {
    '/': 'Home', '/portfolio/': 'Portfolio', '/blog/': 'Journal', '/privacy/': 'Privacy',
    '/links/': 'Links (Instagram bio)', '/lead/': 'Wedding show sign-up', '/guide/': 'Pricing guide', '/AlexClaudioVentures/': 'Alex Claudio Ventures'
  };
  const ALBUM_NAMES = { none: 'No album', 10: '10 \u00d7 10 album', 12: '12 \u00d7 12 album' };
  // One step a couple took in the pricing guide, as it reads in a visit's trail.
  const guideStep = (step) => ({
    builder: () => 'Opened the package builder',
    letter: () => 'Reached the letter',
    window: () => 'Moved the coverage window',
    copy: () => 'Copied the package link',
    start: () => `Started from ${step.detail}`,
    hours: () => `Chose ${step.value} hours`,
    session: () => (step.detail === 'on' ? 'Added the engagement session' : 'Took off the engagement session'),
    album: () => (step.detail === 'none' ? 'Chose no album' : `Chose the ${ALBUM_NAMES[step.detail] || step.detail}`),
    second: () => (step.detail === 'on' ? 'Added a second photographer' : 'Took off the second photographer'),
    sent: () => `Sent a ${fmtMoney(step.value)} package ${step.detail === 'personal' ? 'from their guide link' : 'with the letter'}`
  }[step.event] || (() => null))();
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
      panel('Pricing guide', 'What people did on /guide/', guidePanel(data.guide)),
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

  // How far people got in the pricing guide, what they picked, and what they sent.
  function guidePanel(guide) {
    if (!guide || !guide.visits) return h('p', { class: 'muted' }, 'Nobody opened the pricing guide in this period.');
    const stage = (label, count, note) => h('div', { class: 'card' },
      h('span', { class: 'card-label' }, label), h('strong', {}, fmtCount(count)), h('small', {}, note));
    const ofOpened = (n) => `${share(n, guide.visits)} of visits`;
    const visitsOf = (rows, detail) => (rows.find((row) => row.detail === detail) || { visits: 0 }).visits;
    const choices = [
      { name: 'Added the engagement session', visits: visitsOf(guide.session, 'on') },
      ...['10', '12', 'none'].map((size) => ({ name: `Chose ${size === 'none' ? 'no album' : `the ${ALBUM_NAMES[size]}`}`, visits: visitsOf(guide.albums, size) })),
      { name: 'Added a second photographer', visits: visitsOf(guide.second, 'on') },
      { name: 'Copied the package link', visits: guide.copied }
    ].filter((row) => row.visits);
    const visitsMetric = [{ label: 'Visits', value: (row) => row.visits }];
    return [
      h('div', { class: 'cards funnel' },
        stage('Opened the guide', guide.visits, `${plural(guide.views, 'view', 'views')}${guide.seconds ? `, ${fmtDuration(guide.seconds)} each` : ''}`),
        stage('Opened the builder', guide.builder, ofOpened(guide.builder)),
        stage('Picked something', guide.chose, ofOpened(guide.chose)),
        stage('Reached the letter', guide.letter, ofOpened(guide.letter)),
        stage('Sent a package', guide.sent.count, guide.sent.count
          ? `${guide.sent.average ? `${fmtMoney(guide.sent.average)} on average, ` : ''}${guide.sent.personal} from guide links`
          : ofOpened(guide.sent_visits))),
      h('div', { class: 'guide-tables' },
        h('div', {},
          h('h3', { class: 'sub-head' }, 'Started from'),
          barTable({ head: 'Collection', rows: guide.starts, empty: 'No collection buttons pressed yet.', label: (row) => row.detail, metrics: visitsMetric }),
          h('h3', { class: 'sub-head' }, 'Hours picked'),
          barTable({ head: 'Hours', rows: guide.hours, empty: 'Nobody changed the hours yet.', label: (row) => `${row.value} hours`, limit: 7, metrics: visitsMetric })),
        h('div', {},
          h('h3', { class: 'sub-head' }, 'Extras'),
          barTable({ head: 'Choice', rows: choices, empty: 'No extras chosen yet.', label: (row) => row.name, metrics: visitsMetric }),
          h('h3', { class: 'sub-head' }, 'Packages sent'),
          barTable({ head: 'Package', rows: guide.packages, empty: 'No packages sent yet.', label: (row) => (row.detail === 'Custom' ? 'Their own package' : row.detail),
            sub: (row) => `${row.value} hours`, metrics: [{ label: 'Sent', value: (row) => row.times }] })))
    ];
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
      // Guide clicks in a row of the same kind (dragging the hours back and forth) read as the last one.
      const guide = [];
      for (const step of visit.guide || []) {
        if (step.event === 'package') continue;
        const last = guide[guide.length - 1];
        if (last && last.event === step.event && ['hours', 'session', 'album', 'second'].includes(step.event)) guide[guide.length - 1] = step;
        else guide.push(step);
      }
      const steps = [...visit.pages.map((page) => ({ at: page.at, page })), ...actions.map((action) => ({ at: action.at, action })),
        ...guide.map((step) => ({ at: step.at, guide: step }))]
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      return h('li', {},
        h('div', { class: 'visit-meta' },
          h('strong', {}, fmtStamp(visit.started_at)),
          h('span', {}, visit.source),
          h('span', {}, visit.timezone ? `${visit.country ? countryName(visit.country) : 'Country unknown'}, ${zoneName(visit.timezone)} time` : 'Country unknown'),
          h('span', {}, `${visit.device} \u00b7 ${visit.browser} on ${visit.os}`)),
        h('ol', { class: 'trail' }, steps.map((step) => (step.page
          ? h('li', {}, pageName(step.page.path), step.page.seconds ? h('small', {}, fmtDuration(step.page.seconds)) : null)
          : step.guide
            ? h('li', { class: 'did guide-step' }, guideStep(step.guide))
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
      phoneCalendar(),
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
          stageBadge(w.stage || w.status))))));
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
            title: `${coupleName(w)} \u00b7 ${STAGE_LABEL[w.stage || w.status]}`,
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
  const assistantUi = buildAssistant();
  app.append(assistantUi.panel, assistantUi.opener);

  window.addEventListener('hashchange', route);
  route();
})();
