// The couple's page for one agreement: read it, fill in what's missing, sign it.
(() => {
  'use strict';

  const token = (/^\/contract\/([A-Za-z0-9_-]{32})\/?$/.exec(location.pathname) || [])[1];
  const $ = (id) => document.getElementById(id);
  const status = $('status');
  const doc = $('doc');
  const sign = $('sign');
  const done = $('done');
  const LABELS = { client_address: 'Your address', client_phone: 'Your phone' };
  let pad = null;

  const stamp = (iso) => new Date(iso).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const returning = new URLSearchParams(location.search).get('session');
  if (returning) history.replaceState(null, '', location.pathname);

  // What's paid and what's due, with a card button for each unpaid payment when card payments are on.
  function drawPayments(info) {
    const box = $('payments');
    box.replaceChildren();
    if (!info || !info.payments.length) { box.hidden = true; return; }
    box.hidden = false;
    const h = document.createElement('h2');
    h.textContent = 'Payments';
    const list = document.createElement('ul');
    list.className = 'cp-payments';
    for (const payment of info.payments) {
      const li = document.createElement('li');
      const what = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = `${payment.label} · ${money(payment.amount)}`;
      const small = document.createElement('small');
      small.textContent = payment.paid
        ? `Paid ${new Date(payment.paid_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}${payment.method === 'card' ? ' by card' : ''}. Thank you.`
        : payment.due_date ? `Due ${day(payment.due_date)}` : 'Due when you’re ready';
      what.append(strong, small);
      li.append(what);
      if (!payment.paid && info.can_pay) {
        const pay = document.createElement('button');
        pay.type = 'button';
        pay.className = 'cp-button';
        pay.textContent = `Pay ${money(payment.amount)} by card`;
        pay.addEventListener('click', async () => {
          pay.disabled = true;
          pay.textContent = 'Opening the secure payment page…';
          try {
            const res = await fetch(`/api/contract/${token}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ payment_id: payment.id }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.url) throw new Error(data.error || 'The payment page couldn’t be opened.');
            location.assign(data.url);
          } catch (error) {
            pay.disabled = false;
            pay.textContent = `Pay ${money(payment.amount)} by card`;
            $('pay-error').textContent = error.message;
          }
        });
        li.append(pay);
      } else if (payment.paid) li.classList.add('is-paid');
      list.append(li);
    }
    const note = document.createElement('p');
    note.className = 'cp-note';
    note.textContent = info.can_pay
      ? `Card payments go through Stripe. You can also pay by ${info.methods}.`
      : `You can pay by ${info.methods}. I'll send the details.`;
    const error = document.createElement('p');
    error.className = 'cp-error';
    error.id = 'pay-error';
    error.setAttribute('role', 'alert');
    box.append(h, list, error, note);
    if (returning && info.payments.some((p) => p.paid)) {
      const thanks = document.createElement('p');
      thanks.className = 'cp-thanks';
      thanks.textContent = 'Payment received. Thank you! A receipt from Stripe is on its way to your email.';
      box.prepend(thanks);
    }
  }

  function showSigned(contract) {
    sign.hidden = true;
    $('print').hidden = false;
    done.hidden = false;
    done.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = 'Signed';
    const p = document.createElement('p');
    p.textContent = `Signed by ${contract.client.name} on ${stamp(contract.client.signed_at)}. Keep a copy with Print or save as PDF.`;
    const code = document.createElement('p');
    code.className = 'cp-hash';
    code.textContent = `Document fingerprint (SHA-256): ${contract.document_hash}`;
    done.append(h, p, code);
  }

  function draw(contract) {
    status.hidden = true;
    doc.hidden = false;
    window.ContractDoc.render(doc, contract.fields, { photographer: contract.photographer, client: contract.client });
    document.title = `Agreement for ${contract.fields.client_name} | Alex Claudio Photography`;
    if (contract.status === 'signed') { showSigned(contract); return; }
    sign.hidden = false;
    const fill = $('fill');
    fill.replaceChildren(...contract.can_fill.map((key) => {
      const label = document.createElement('label');
      label.textContent = LABELS[key] || key;
      const input = document.createElement('input');
      input.type = key === 'client_phone' ? 'tel' : 'text';
      input.name = key;
      input.maxLength = 300;
      input.autocomplete = key === 'client_phone' ? 'tel' : 'street-address';
      input.setAttribute('aria-label', LABELS[key] || key);
      label.append(input);
      return label;
    }));
    pad = window.SignaturePad({ label: 'Signature box. Draw your signature with a finger or the mouse, or choose Type it instead.' });
    $('pad').replaceChildren(pad.element);
    $('signer').value = '';
  }

  async function load() {
    if (!token) { status.textContent = 'This link isn’t complete. Check the link in the email.'; return; }
    try {
      const res = await fetch(`/api/contract/${token}`, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { status.textContent = data.error || 'This agreement couldn’t be opened.'; return; }
      draw(data.contract);
      drawPayments(data.payments);
      if (returning) $('payments').scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
      status.textContent = 'This agreement couldn’t be opened. Check the connection and try again.';
    }
  }

  $('sign-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('error');
    error.textContent = '';
    const name = $('signer').value.trim();
    const signature = pad && pad.toDataURL();
    if (name.length < 2) { error.textContent = 'Type your full name.'; $('signer').focus(); return; }
    if (!signature) { error.textContent = 'Sign in the box, or choose Type it instead.'; return; }
    if (!$('agree').checked) { error.textContent = 'Tick the box to agree to sign electronically.'; $('agree').focus(); return; }
    const body = { name, signature, agree: true };
    for (const input of $('fill').querySelectorAll('input')) body[input.name === 'client_address' ? 'address' : 'phone'] = input.value.trim();
    const button = $('submit');
    button.disabled = true;
    button.textContent = 'Signing…';
    try {
      const res = await fetch(`/api/contract/${token}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The signature couldn’t be saved. Please try again.');
      await load();
      ($('payments').hidden ? done : $('payments')).scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
      button.textContent = 'Sign the agreement';
    }
  });
  $('print').addEventListener('click', () => window.print());

  load();
})();
