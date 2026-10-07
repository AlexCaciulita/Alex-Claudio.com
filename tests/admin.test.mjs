import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createApp } = require('../server');
const { parseWeddingDate } = require('../server/admin/dates');

const PASSWORD = 'correct horse battery staple';
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

// An in-memory stand-in for the PostgreSQL store with the same methods and shapes.
function fakeStore() {
  const inquiries = new Map();
  const notes = new Map();
  let nextId = 1;
  let nextNote = 1;
  const store = {
    saved: [],
    failSaves: false,
    ready: async () => {},
    ping: async () => ({ configured: true, connected: true, database: 'railway', version: '16.4' }),
    async insertInquiry(formName, data) {
      if (store.failSaves) throw new Error('connection refused');
      store.saved.push({ formName, data });
      const id = String(nextId++);
      inquiries.set(id, {
        id, form_name: formName, created_at: new Date().toISOString(), status: 'new', names: data.names || data.name || '',
        email: data.email || '', event_date: data.event_date || '', wedding_date: parseWeddingDate(data.event_date), hours: data.hours || '',
        care: data.care || '', price: null, paid: null
      });
      return id;
    },
    async listInquiries({ q = '', status = '' } = {}) {
      return [...inquiries.values()]
        .filter((inquiry) => (!status || inquiry.status === status) && (!q || JSON.stringify(inquiry).toLowerCase().includes(q.toLowerCase())))
        .map((inquiry) => ({ ...inquiry, note_count: [...notes.values()].filter((note) => note.inquiry_id === inquiry.id).length }));
    },
    async getInquiry(id) {
      const inquiry = inquiries.get(id);
      return inquiry ? { inquiry: { ...inquiry }, notes: [...notes.values()].filter((note) => note.inquiry_id === id) } : null;
    },
    async createInquiry(fields) {
      const id = String(nextId++);
      inquiries.set(id, { id, form_name: 'manual', created_at: new Date().toISOString(), status: 'new', wedding_date: null, price: null, paid: null, ...fields });
      return { ...inquiries.get(id) };
    },
    async updateInquiry(id, fields) {
      if (!inquiries.has(id)) return null;
      Object.assign(inquiries.get(id), fields);
      return { ...inquiries.get(id) };
    },
    deleteInquiry: async (id) => inquiries.delete(id),
    async addNote(inquiryId, body) {
      if (!inquiries.has(inquiryId)) return null;
      const note = { id: String(nextNote++), inquiry_id: inquiryId, created_at: new Date().toISOString(), body };
      notes.set(note.id, note);
      return note;
    },
    deleteNote: async (id) => notes.delete(id),
    async stats() {
      const all = [...inquiries.values()];
      const count = (status) => all.filter((inquiry) => inquiry.status === status).length;
      return { new: count('new'), replied: count('replied'), booked: count('booked'), upcoming: 0, last30: all.length, total: all.length, year_agreed: 0, year_paid: 0, year: 2026 };
    },
    async calendar(from, to) {
      return [...inquiries.values()].filter((inquiry) => inquiry.wedding_date && inquiry.wedding_date >= from && inquiry.wedding_date <= to && inquiry.status !== 'not_booked');
    },
    legacyTables: async () => [{ schema: 'public', name: 'leads', rows: 1, columns: 3, hidden: ['password_hash'] }],
    async legacyRows(schema, name, page) {
      if (schema !== 'public' || name !== 'leads') return null;
      return { schema, name, total: 1, page, pageSize: 50, columns: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'text' }], hidden: ['password_hash'], orderedBy: null, rows: [[1, 'Old couple']] };
    }
  };
  return store;
}

async function withSite(options, run) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function signIn(origin, headers = {}) {
  const response = await fetch(`${origin}/admin/login`, {
    method: 'POST', redirect: 'manual', headers: { ...FORM, ...headers }, body: new URLSearchParams({ password: PASSWORD }).toString()
  });
  assert.equal(response.status, 303);
  const [session, device] = response.headers.getSetCookie().map((value) => value.split(';')[0]);
  const cookie = session;
  const page = await fetch(`${origin}/admin`, { headers: { cookie, ...headers } });
  assert.equal(page.status, 200);
  const csrf = /<meta name="csrf" content="([^"]+)">/.exec(await page.text())[1];
  return { cookie, csrf, device };
}

test('the studio sign-in stays closed until a long enough password is set', async () => {
  await withSite({ env: {}, store: null }, async (origin) => {
    const login = await fetch(`${origin}/admin/login`);
    assert.equal(login.status, 503);
    assert.match(await login.text(), /Add an ADMIN_PASSWORD variable/);
    const attempt = await fetch(`${origin}/admin/login`, { method: 'POST', headers: FORM, body: 'password=anything-at-all', redirect: 'manual' });
    assert.equal(attempt.status, 503);
    assert.equal(attempt.headers.get('set-cookie'), null);
    const empty = await fetch(`${origin}/admin/login`, { method: 'POST', redirect: 'manual' });
    assert.equal(empty.status, 503);
    const dashboard = await fetch(`${origin}/admin`, { redirect: 'manual' });
    assert.equal(dashboard.status, 303);
    assert.equal(dashboard.headers.get('location'), '/admin/login');
    const api = await fetch(`${origin}/admin/api/overview`);
    assert.equal(api.status, 401);
  });
  await withSite({ env: { ADMIN_PASSWORD: 'too-short' }, store: null }, async (origin) => {
    const login = await fetch(`${origin}/admin/login`);
    assert.equal(login.status, 503);
    assert.match(await login.text(), /too short/);
  });
});

test('signing in sets a private session cookie and wrong passwords are refused', async () => {
  await withSite({ env: { ADMIN_PASSWORD: PASSWORD }, store: fakeStore() }, async (origin) => {
    const page = await fetch(`${origin}/admin/login`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'/);

    const wrong = await fetch(`${origin}/admin/login`, { method: 'POST', redirect: 'manual', headers: FORM, body: 'password=not+the+password' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('set-cookie'), null);

    const right = await fetch(`${origin}/admin/login`, { method: 'POST', redirect: 'manual', headers: FORM, body: new URLSearchParams({ password: PASSWORD }).toString() });
    assert.equal(right.status, 303);
    assert.equal(right.headers.get('location'), '/admin');
    const [sessionCookie, deviceCookie] = right.headers.getSetCookie();
    assert.match(sessionCookie, /^ac_studio=[\w-]{43}; Path=\/admin; HttpOnly; SameSite=Lax$/);
    assert.match(deviceCookie, /^ac_device=[0-9a-z]+\.[\w-]{43}; Path=\/admin\/login; HttpOnly; SameSite=Strict; Max-Age=15552000$/);

    const secure = await fetch(`${origin}/admin/login`, {
      method: 'POST', redirect: 'manual', headers: { ...FORM, 'X-Forwarded-Proto': 'https' }, body: new URLSearchParams({ password: PASSWORD }).toString()
    });
    const [secureSession, secureDevice] = secure.headers.getSetCookie();
    assert.match(secureSession, /^__Secure-ac_studio=[\w-]{43}; Path=\/admin; HttpOnly; SameSite=Lax; Secure$/);
    assert.match(secureDevice, /^__Secure-ac_device=[0-9a-z]+\.[\w-]{43}; Path=\/admin\/login; HttpOnly; SameSite=Strict; Max-Age=15552000; Secure$/);

    // What Edge and Chrome actually send from the sign-in page, and what another site would send.
    const fromThePage = await fetch(`${origin}/admin/login`, {
      method: 'POST', redirect: 'manual', headers: { ...FORM, Origin: 'null', 'Sec-Fetch-Site': 'same-origin' }, body: new URLSearchParams({ password: PASSWORD }).toString()
    });
    assert.equal(fromThePage.status, 303);
    for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { Origin: 'https://evil.example' }, { Origin: 'null' }]) {
      const forged = await fetch(`${origin}/admin/login`, {
        method: 'POST', redirect: 'manual', headers: { ...FORM, ...headers }, body: new URLSearchParams({ password: PASSWORD }).toString()
      });
      assert.equal(forged.status, 403, JSON.stringify(headers));
      assert.equal(forged.headers.get('set-cookie'), null);
    }
    assert.equal(page.headers.get('referrer-policy'), 'same-origin');

    const { cookie } = await signIn(origin);
    const dashboard = await fetch(`${origin}/admin`, { headers: { cookie } });
    const html = await dashboard.text();
    assert.match(html, /<script src="\/admin\/assets\/admin.js" defer><\/script>/);
    assert.doesNotMatch(html, /<script>|style="/);
    const signedInLogin = await fetch(`${origin}/admin/login`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(signedInLogin.status, 303);

    const forged = await fetch(`${origin}/admin/api/overview`, { headers: { cookie: 'ac_studio=forged-token' } });
    assert.equal(forged.status, 401);
  });
});

test('five wrong passwords pause sign-in from that address for a while', async () => {
  await withSite({ env: { ADMIN_PASSWORD: PASSWORD }, store: null }, async (origin) => {
    const attacker = { 'X-Forwarded-For': '198.51.100.7' };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${origin}/admin/login`, { method: 'POST', headers: { ...FORM, ...attacker }, body: `password=guess-${attempt}` });
      assert.equal(response.status, 401);
    }
    const locked = await fetch(`${origin}/admin/login`, {
      method: 'POST', redirect: 'manual', headers: { ...FORM, ...attacker }, body: new URLSearchParams({ password: PASSWORD }).toString()
    });
    assert.equal(locked.status, 429);
    assert.equal(locked.headers.get('set-cookie'), null);
    await signIn(origin, { 'X-Forwarded-For': '203.0.113.20' });
  });
});

test('strangers tripping the site-wide limit cannot lock out a browser that signed in before', async () => {
  // The device-note key normally lives in the database; this stand-in keeps one fixed key across "deploys".
  const store = { ...fakeStore(), deviceSecret: async () => Buffer.alloc(32, 7) };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  const attempt = (origin, ip, password, cookie) => fetch(`${origin}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { ...FORM, 'X-Forwarded-For': ip, ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams({ password }).toString()
  });
  // Ten addresses, five wrong guesses each: the site-wide limit of 50 is reached.
  const tripSiteWideLimit = (origin) => Promise.all(Array.from({ length: 10 }, async (_, n) => {
    for (let guess = 0; guess < 5; guess += 1) assert.equal((await attempt(origin, `198.51.100.${n + 10}`, `guess-${guess}`)).status, 401);
  }));

  let device;
  await withSite({ env: { ADMIN_PASSWORD: PASSWORD }, store }, async (origin) => {
    await settle();
    ({ device } = await signIn(origin, { 'X-Forwarded-For': '192.0.2.1' }));
    await tripSiteWideLimit(origin);
    assert.equal((await attempt(origin, '203.0.113.50', PASSWORD)).status, 429, 'an unknown browser waits');
    assert.equal((await attempt(origin, '203.0.113.51', PASSWORD, `${device.split('=')[0]}=lmn0pq.${'A'.repeat(43)}`)).status, 429, 'a forged note does not help');
    assert.equal((await attempt(origin, '203.0.113.52', 'not the password', device)).status, 401, 'the note never replaces the password');
    assert.equal((await attempt(origin, '203.0.113.53', PASSWORD, device)).status, 303, 'the owner\u2019s browser still signs in');
  });
  await withSite({ env: { ADMIN_PASSWORD: PASSWORD }, store }, async (origin) => {
    await settle();
    await tripSiteWideLimit(origin);
    assert.equal((await attempt(origin, '203.0.113.60', PASSWORD, device)).status, 303, 'the note still counts after a deploy');
  });
  await withSite({ env: { ADMIN_PASSWORD: `${PASSWORD} changed` }, store }, async (origin) => {
    await settle();
    await tripSiteWideLimit(origin);
    assert.equal((await attempt(origin, '203.0.113.61', `${PASSWORD} changed`, device)).status, 429, 'a new password voids old notes');
  });
});

test('a database address that cannot be read never takes the website down', async () => {
  const { createStore } = require('../server/admin/store');
  let tried = 0;
  for (const url of ['postgresql://user:pa#ss@db.example.com:5432/db', 'postgres://user:secret@:5432/railway', 'postgres://user@db.example.com:port/db']) {
    const store = createStore({ DATABASE_URL: url });
    if (!store) continue;
    tried += 1;
    let pending;
    assert.doesNotThrow(() => { pending = store.ready(); }, url);
    await assert.rejects(pending, url);
    const ping = await store.ping();
    assert.equal(ping.connected, false, url);
    assert.doesNotMatch(ping.error, /secret|pa#ss/, url);
    await store.close();
  }
  assert.ok(tried > 0, 'at least one bad address reached the store');
});

test('the dashboard API needs the session and a CSRF token from this site', async () => {
  const store = fakeStore();
  await withSite({ env: { ADMIN_PASSWORD: PASSWORD }, store }, async (origin) => {
    const { cookie, csrf } = await signIn(origin);
    const call = (path, init = {}) => fetch(`${origin}/admin/api${path}`, {
      ...init,
      headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...(init.headers || {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });

    assert.deepEqual(await (await call('/inquiries')).json(), { inquiries: [] });
    const noToken = await fetch(`${origin}/admin/api/inquiries`, {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ names: 'Ana' })
    });
    assert.equal(noToken.status, 403);
    const elsewhere = await call('/inquiries', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: { names: 'Ana' } });
    assert.equal(elsewhere.status, 403);
    for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { Origin: 'null' }]) {
      assert.equal((await call('/inquiries', { method: 'POST', headers, body: { names: 'Ana' } })).status, 403, JSON.stringify(headers));
    }
    const signedOut = await fetch(`${origin}/admin/api/inquiries`, { method: 'POST', headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(signedOut.status, 401);

    assert.equal((await call('/inquiries', { method: 'POST', body: {} })).status, 400);
    const created = await call('/inquiries', { method: 'POST', headers: { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' }, body: { names: 'Ana & Iulian', event_date: 'June 12th, 2027', wedding_date: '' } });
    assert.equal(created.status, 201);
    const { inquiry } = await created.json();
    assert.equal(inquiry.form_name, 'manual');
    assert.equal(inquiry.wedding_date, '2027-06-12');

    for (const bad of [{ wedding_date: '2027-02-30' }, { price: -5 }, { paid: 'lots' }, { status: 'maybe' }, { names: ['Ana'] }]) {
      assert.equal((await call(`/inquiries/${inquiry.id}`, { method: 'PATCH', body: bad })).status, 400, JSON.stringify(bad));
    }
    const booked = await call(`/inquiries/${inquiry.id}`, { method: 'PATCH', headers: { Origin: origin }, body: { status: 'booked', price: 4000, paid: '1000.5', form_name: 'contact', id: '99' } });
    assert.equal(booked.status, 200);
    const updated = (await booked.json()).inquiry;
    assert.equal(updated.status, 'booked');
    assert.equal(updated.price, 4000);
    assert.equal(updated.paid, 1000.5);
    assert.equal(updated.form_name, 'manual');
    assert.equal(updated.id, inquiry.id);

    assert.equal((await call(`/inquiries/${inquiry.id}/notes`, { method: 'POST', body: { body: '   ' } })).status, 400);
    const note = await call(`/inquiries/${inquiry.id}/notes`, { method: 'POST', body: { body: 'Called them; they love the ferry.' } });
    assert.equal(note.status, 201);
    const noteId = (await note.json()).note.id;
    assert.equal((await (await call(`/inquiries/${inquiry.id}`)).json()).notes.length, 1);
    assert.equal((await call(`/notes/${noteId}`, { method: 'DELETE' })).status, 204);

    const june = await (await call('/calendar?from=2027-06-01&to=2027-06-30')).json();
    assert.deepEqual(june.weddings.map((wedding) => wedding.id), [inquiry.id]);
    assert.equal((await call('/calendar?from=2027-01-01&to=2027-06-30')).status, 400);
    assert.equal((await call('/calendar?from=2027-06-01&to=nope')).status, 400);

    assert.equal((await (await call('/archive')).json()).tables[0].name, 'leads');
    assert.deepEqual((await (await call('/archive/public/leads?page=0')).json()).rows, [[1, 'Old couple']]);
    assert.equal((await call('/archive/public/missing')).status, 404);

    assert.equal((await call('/inquiries/not-a-number')).status, 404);
    assert.equal((await call(`/inquiries/${inquiry.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/inquiries/${inquiry.id}`)).status, 404);

    const logoutWithoutToken = await fetch(`${origin}/admin/logout`, { method: 'POST', headers: { cookie } });
    assert.equal(logoutWithoutToken.status, 403);
    const logout = await fetch(`${origin}/admin/logout`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf } });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie'), /^ac_studio=; Path=\/admin; HttpOnly; SameSite=Lax; Max-Age=0$/);
    assert.equal((await call('/overview')).status, 401);
  });
});

test('letters from the website are saved to the studio database', async () => {
  const store = fakeStore();
  await withSite({ env: {}, store }, async (origin) => {
    const letter = new URLSearchParams({
      'form-name': 'contact', company: '', names: 'Maria and Dan', event_date: 'Saturday, August 7, 2027', location: 'Orcas Island',
      email: 'maria@example.com', hours: 'eight hours', care: 'The quiet bit after the ceremony'
    });
    const response = await fetch(`${origin}/api/submissions`, { method: 'POST', headers: FORM, body: letter.toString() });
    assert.equal(response.status, 200);
    assert.equal(store.saved.length, 1);
    assert.equal(store.saved[0].formName, 'contact');
    assert.equal(store.saved[0].data.hours, 'eight hours');
    assert.equal(store.saved[0].data.care, 'The quiet bit after the ceremony');

    store.failSaves = true;
    const failed = await fetch(`${origin}/api/submissions`, { method: 'POST', headers: FORM, body: letter.toString() });
    assert.equal(failed.status, 503, 'a letter nobody accepted is not reported as sent');

    const noBody = await fetch(`${origin}/api/submissions`, { method: 'POST' });
    assert.equal(noBody.status, 400);
  });
});

test('without a database the dashboard explains itself and never shows secret values', async () => {
  await withSite({ env: { ADMIN_PASSWORD: PASSWORD, RESEND_API_KEY: 're_secret_value', CONTACT_TO_EMAIL: 'contact@alex-claudio.com' }, store: null }, async (origin) => {
    const { cookie } = await signIn(origin);
    const overview = await fetch(`${origin}/admin/api/overview`, { headers: { cookie } });
    const text = await overview.text();
    const data = JSON.parse(text);
    assert.deepEqual(data.db, { configured: false, connected: false });
    assert.equal(data.stats, null);
    assert.equal(data.settings.find((setting) => setting.name === 'ADMIN_PASSWORD').present, true);
    assert.equal(data.settings.find((setting) => setting.name === 'RESEND_API_KEY').present, true);
    assert.equal(data.settings.find((setting) => setting.name === 'CONTACT_TO_EMAIL').value, 'contact@alex-claudio.com');
    assert.doesNotMatch(text, /re_secret_value|correct horse/);
    const list = await fetch(`${origin}/admin/api/inquiries`, { headers: { cookie } });
    assert.equal(list.status, 503);
    assert.equal((await list.json()).code, 'no-database');
  });
});

test('dashboard files come only from /admin/assets and plain HTTP is refused', async () => {
  await withSite({ env: { ADMIN_PASSWORD: PASSWORD }, store: null }, async (origin) => {
    const script = await fetch(`${origin}/admin/assets/admin.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    const styles = await fetch(`${origin}/admin/assets/admin.css`);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /text\/css/);
    for (const hidden of ['/server/admin/assets/admin.js', '/server/admin/store.js', '/server/admin/index.js']) {
      assert.equal((await fetch(`${origin}${hidden}`, { redirect: 'manual' })).status, 404, hidden);
    }
    for (const unknown of ['/admin/store.js', '/admin/nothing-here']) {
      const response = await fetch(`${origin}${unknown}`, { redirect: 'manual' });
      assert.equal(response.status, 303, unknown);
      assert.equal(response.headers.get('location'), '/admin/login');
    }
    const http = await fetch(`${origin}/admin/login`, { headers: { 'X-Forwarded-Proto': 'http' }, redirect: 'manual' });
    assert.equal(http.status, 301);
    assert.equal(http.headers.get('location'), 'https://127.0.0.1/admin/login');
    const httpPost = await fetch(`${origin}/admin/login`, {
      method: 'POST', redirect: 'manual', headers: { ...FORM, 'X-Forwarded-Proto': 'http' }, body: new URLSearchParams({ password: PASSWORD }).toString()
    });
    assert.equal(httpPost.status, 403);
    assert.equal(httpPost.headers.get('set-cookie'), null);
  });
  assert.match(await readFile(new URL('../robots.txt', import.meta.url), 'utf8'), /^Disallow: \/admin$/m);
});

test('the dashboard script never turns inquiry text into HTML', async () => {
  const source = await readFile(new URL('../server/admin/assets/admin.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
});

test('wedding dates are read the ways couples write them', () => {
  for (const [written, expected] of [
    ['June 12, 2027', '2027-06-12'], ['12 June 2027', '2027-06-12'], ['Saturday, June 12th 2027', '2027-06-12'],
    ['Sept. 4, 2027', '2027-09-04'], ['6/12/2027', '2027-06-12'], ['12.06.2027', '2027-06-12'], ['2027-06-12', '2027-06-12'],
    ['June 2027', null], ['next summer', null], ['February 30, 2027', null], ['13/13/2027', null], ['June 12, 1999', null], ['', null]
  ]) {
    assert.equal(parseWeddingDate(written), expected, written);
  }
});
