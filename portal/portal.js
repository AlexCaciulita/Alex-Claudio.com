// The couple's page: their questionnaire, their day, the agreement, payments and gallery.
(() => {
  'use strict';

  const token = (/^\/couple\/([A-Za-z0-9_-]{32})\/?$/.exec(location.pathname) || [])[1];
  const $ = (id) => document.getElementById(id);
  const Q = window.Questionnaire;
  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
    return node;
  };
  const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const clock = (time) => { const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  let data = null;
  let answers = {};
  let saveTimer = 0;

  async function load() {
    if (!token) { $('status').textContent = 'This link isn’t complete. Check the link in my email.'; return; }
    try {
      const res = await fetch(`/api/couple/${token}`, { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { $('status').textContent = body.error || 'This page couldn’t be opened.'; return; }
      data = body;
      answers = { ...data.questionnaire.answers };
      draw();
    } catch (error) {
      $('status').textContent = 'This page couldn’t be opened. Check the connection and try again.';
    }
  }

  function draw() {
    $('status').hidden = true;
    $('page').hidden = false;
    $('for').textContent = `For ${data.names}`;
    $('date').textContent = data.wedding_date ? longDate(data.wedding_date) : 'Your wedding';
    const days = data.days;
    $('line').textContent = [
      days === null ? '' : days > 1 ? `${days} days to go` : days === 1 ? 'Tomorrow' : days === 0 ? 'Today' : '',
      data.location
    ].filter(Boolean).join(' · ');
    if (data.light) {
      $('light').hidden = false;
      $('light').textContent = `Sunset ${clock(data.light.sunset)} · golden hour from about ${clock(data.light.golden_hour)}`;
    }
    document.title = `${data.names} | Alex Claudio Photography`;
    drawQuestions();
    drawDay();
    drawAgreement();
    drawPayments();
    if (data.gallery) {
      $('gallery').hidden = false;
      $('gallery-link').hidden = false;
      $('gallery-open').href = data.gallery.url;
    }
  }

  /* Questionnaire */
  function progress() {
    const done = Q.QUESTIONS.filter((q) => answers[q.key] !== '' && answers[q.key] !== undefined).length;
    $('progress').textContent = `${done} of ${Q.QUESTIONS.length} answered`;
  }

  function drawQuestions() {
    const form = $('q-form');
    form.replaceChildren(...Q.SECTIONS.map((section) => el('fieldset', { class: 'pt-section' },
      el('legend', { text: section.title }),
      section.questions.map((q) => {
        const id = `q-${q.key}`;
        let control;
        if (q.type === 'choice') {
          control = el('div', { class: 'pt-choices', role: 'radiogroup', 'aria-labelledby': `${id}-label` },
            q.options.map((option) => {
              const input = el('input', { type: 'radio', name: q.key, value: option });
              input.checked = answers[q.key] === option;
              input.addEventListener('change', () => { answers[q.key] = option; changed(); });
              return el('label', { class: 'pt-choice' }, input, el('span', { text: option }));
            }));
        } else {
          control = q.type === 'long' || q.type === 'list'
            ? el('textarea', { id, rows: q.type === 'list' ? 4 : 3, maxlength: 3000 })
            : el('input', { id, type: q.type === 'time' ? 'time' : q.type === 'number' ? 'number' : 'text', min: q.type === 'number' ? 0 : null, inputmode: q.type === 'number' ? 'numeric' : null, maxlength: q.type === 'text' ? 300 : null });
          control.value = answers[q.key] === undefined || answers[q.key] === null ? '' : String(answers[q.key]);
          control.addEventListener('input', () => { answers[q.key] = q.type === 'number' && control.value !== '' ? Number(control.value) : control.value; changed(); });
        }
        return el('div', { class: 'pt-q', 'data-key': q.key },
          el(q.type === 'choice' ? 'p' : 'label', { class: 'pt-label', id: `${id}-label`, for: q.type === 'choice' ? null : id },
            q.label, q.optional ? el('span', { class: 'pt-optional', text: ' (optional)' }) : null),
          q.hint ? el('p', { class: 'pt-hint', text: q.hint }) : null,
          control);
      }))));
    progress();
    drawSendState();
  }

  function drawSendState() {
    const sent = data.questionnaire.status === 'submitted';
    $('send').textContent = sent ? 'Send my changes' : 'Send to Alex';
    $('q-intro').textContent = sent
      ? `Thank you, I have your answers${data.questionnaire.submitted_at ? ` (sent ${shortDate(data.questionnaire.submitted_at.slice(0, 10))})` : ''}. You can still change anything and send the changes.`
      : 'A few questions so I can plan your day with you. Your answers save as you type, so you can come back any time. Send them to me when you’re done.';
  }

  const save = async (send) => {
    const res = await fetch(`/api/couple/${token}/questionnaire`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ answers, send })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const error = new Error(body.error || 'Your answers couldn’t be saved.'); error.missing = body.missing; throw error; }
    return body;
  };

  function changed() {
    progress();
    $('saved').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await save(false); $('saved').textContent = 'Saved'; } catch (error) { $('saved').textContent = ''; $('q-error').textContent = error.message; }
    }, 800);
  }

  $('send').addEventListener('click', async () => {
    clearTimeout(saveTimer);
    $('q-error').textContent = '';
    for (const node of document.querySelectorAll('.pt-q.is-missing')) node.classList.remove('is-missing');
    const button = $('send');
    button.disabled = true;
    try {
      const result = await save(true);
      data.questionnaire.status = result.status;
      data.questionnaire.submitted_at = new Date().toISOString();
      drawSendState();
      $('saved').textContent = 'Sent. Thank you!';
      if (result.timeline && result.timeline.ok) {
        const fresh = await (await fetch(`/api/couple/${token}`)).json();
        data.timeline = fresh.timeline;
        drawDay();
      }
    } catch (error) {
      $('q-error').textContent = error.missing ? `${error.message} They’re marked below.` : error.message;
      for (const key of error.missing || []) {
        const node = document.querySelector(`.pt-q[data-key="${key}"]`);
        if (node) node.classList.add('is-missing');
      }
      const first = document.querySelector('.pt-q.is-missing');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    button.disabled = false;
  });

  /* The day */
  function drawDay() {
    const body = $('day-body');
    if (!data.timeline.length) {
      body.replaceChildren(el('p', { class: 'pt-muted', text: 'Once your questionnaire is in, I’ll put a first plan for the day here, and we’ll go over it together.' }));
      return;
    }
    body.replaceChildren(
      el('p', { class: 'pt-muted', text: 'A first plan. We’ll go over it together and it will change as the day takes shape.' }),
      el('ol', { class: 'pt-timeline' }, data.timeline.map((item) => el('li', {},
        el('span', { class: 'pt-time', text: item.time ? clock(item.time) : '' }),
        el('span', {}, el('strong', { text: item.title }), item.place ? el('small', { text: item.place }) : null, item.note ? el('small', { text: item.note }) : null)))));
  }

  /* Agreement */
  function drawAgreement() {
    const body = $('ag-body');
    const c = data.contract;
    if (!c) { body.replaceChildren(el('p', { class: 'pt-muted', text: 'Your agreement will be here once I send it.' })); return; }
    body.replaceChildren(
      el('p', { text: c.status === 'signed' ? `Signed ${shortDate(c.signed_at.slice(0, 10))}. Thank you.` : 'Ready for you to read and sign.' }),
      el('a', { class: c.status === 'signed' ? 'pt-button pt-quiet' : 'pt-button', href: `/contract/${c.token}`, text: c.status === 'signed' ? 'Read your signed agreement' : 'Read and sign' }));
  }

  /* Payments */
  function drawPayments() {
    const body = $('pay-body');
    if (!data.payments.length) { body.replaceChildren(el('p', { class: 'pt-muted', text: 'Your payments will show here once the agreement is signed.' })); return; }
    body.replaceChildren(el('ul', { class: 'pt-payments' }, data.payments.map((p) => {
      const button = !p.paid && data.can_pay ? el('button', { type: 'button', class: 'pt-button', text: `Pay ${money(p.amount)} by card` }) : null;
      if (button) {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const res = await fetch(`/api/contract/${data.contract.token}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ payment_id: p.id }) });
            const out = await res.json().catch(() => ({}));
            if (!res.ok || !out.url) throw new Error(out.error || 'The payment page couldn’t be opened.');
            location.assign(out.url);
          } catch (error) { button.disabled = false; $('pay-error').textContent = error.message; }
        });
      }
      return el('li', { class: p.paid ? 'is-paid' : null },
        el('span', {}, el('strong', { text: `${p.label} · ${money(p.amount)}` }),
          el('small', { text: p.paid ? `Paid ${shortDate(p.paid_at.slice(0, 10))}${p.method === 'card' ? ' by card' : ''}` : p.due_date ? `Due ${shortDate(p.due_date)}` : 'Due when you’re ready' })),
        button);
    })));
  }

  load();
})();
