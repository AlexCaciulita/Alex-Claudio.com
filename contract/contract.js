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

  function showSigned(contract) {
    sign.hidden = true;
    $('print').hidden = false;
    done.hidden = false;
    done.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = 'Signed';
    const p = document.createElement('p');
    p.textContent = `Signed by ${contract.client.name} on ${stamp(contract.client.signed_at)}. Keep a copy with Print or save as PDF. I'll be in touch about the retainer.`;
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
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
      button.textContent = 'Sign the agreement';
    }
  });
  $('print').addEventListener('click', () => window.print());

  load();
})();
