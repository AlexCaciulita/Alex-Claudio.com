// The studio dashboard at /admin: a password sign-in and a small JSON API for the dashboard page.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { STATUSES, TEXT_LIMITS, safeMessage } = require('./store');
const { isValidIsoDate, parseWeddingDate } = require('./dates');

const ASSETS = path.join(__dirname, 'assets');
const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_IP_LIMIT = 5;
const LOGIN_GLOBAL_LIMIT = 50;
const DEVICE_MAX_MS = 180 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 12;
const FAILED_LOGIN_DELAY_MS = 400;
const ID = /^\d{1,18}$/;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const EDITABLE = {
  names: 'text', email: 'text', phone: 'text', event_date: 'text', wedding_date: 'date', location: 'text',
  hours: 'text', care: 'text', message: 'text', source: 'text', status: 'status', price: 'money', paid: 'money'
};
const SETTINGS = [
  ['ADMIN_PASSWORD', 'Studio sign-in password'],
  ['RAILWAY_VOLUME_MOUNT_PATH', 'Railway volume (where the dashboard keeps its file)'],
  ['STUDIO_DB_PATH', 'Another location for the dashboard\u2019s file (optional)'],
  ['DATABASE_PATH', 'The earlier dashboard\u2019s file (read only)'],
  ['RESEND_API_KEY', 'Inquiry emails (Resend)'],
  ['CONTACT_TO_EMAIL', 'Inquiry email recipient'],
  ['GOOGLE_SHEET_ID', 'Google Sheet for inquiries'],
  ['R2_BUCKET_NAME', 'Client gallery storage']
];
const SHOW_VALUE = new Set(['CONTACT_TO_EMAIL', 'RAILWAY_VOLUME_MOUNT_PATH', 'STUDIO_DB_PATH', 'DATABASE_PATH']);

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function readCookies(header) {
  const cookies = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    if (name && !(name in cookies)) cookies[name] = part.slice(at + 1).trim();
  }
  return cookies;
}

function passwordState(env) {
  const value = String(env.ADMIN_PASSWORD || '');
  if (!value) return { state: 'missing' };
  if (value.length < MIN_PASSWORD_LENGTH) return { state: 'short' };
  return { state: 'ok', digest: sha256(value) };
}

// Browsers that have signed in before carry a signed note saying so. It grants nothing by itself;
// it only lets the owner past the site-wide failure limit, which strangers could otherwise trip
// on purpose to lock everyone out. It is signed with a random key that never leaves the server,
// so a copied note reveals nothing about the password, and it covers a hash of the password, so
// changing ADMIN_PASSWORD voids every note.
const deviceMac = (secret, passwordDigest, issued) => crypto.createHmac('sha256', secret)
  .update(`device:${issued}:`).update(passwordDigest).digest('base64url');
const deviceNote = (secret, passwordDigest, now = Date.now()) => {
  const issued = now.toString(36);
  return `${issued}.${deviceMac(secret, passwordDigest, issued)}`;
};
function knownDevice(note, secret, passwordDigest, now = Date.now()) {
  const match = /^([0-9a-z]{1,12})\.([\w-]{43})$/.exec(String(note || ''));
  if (!match) return false;
  const issued = parseInt(match[1], 36);
  if (!(issued <= now + 5 * 60 * 1000 && now - issued < DEVICE_MAX_MS)) return false;
  const wanted = Buffer.from(deviceMac(secret, passwordDigest, match[1]));
  const sent = Buffer.from(match[2]);
  return sent.length === wanted.length && crypto.timingSafeEqual(sent, wanted);
}

function createLoginLimiter() {
  const byIp = new Map();
  let everyone = [];
  const recent = (times, now) => times.filter((time) => now - time < LOGIN_WINDOW_MS);
  return {
    blocked(ip, trusted = false, now = Date.now()) {
      everyone = recent(everyone, now);
      const mine = recent(byIp.get(ip) || [], now);
      if (mine.length) byIp.set(ip, mine); else byIp.delete(ip);
      return mine.length >= LOGIN_IP_LIMIT || (!trusted && everyone.length >= LOGIN_GLOBAL_LIMIT);
    },
    fail(ip, now = Date.now()) {
      const mine = recent(byIp.get(ip) || [], now);
      mine.push(now);
      byIp.set(ip, mine);
      everyone.push(now);
      if (byIp.size > 5000) for (const [key, times] of byIp) if (!recent(times, now).length) byIp.delete(key);
    },
    succeed(ip) { byIp.delete(ip); }
  };
}

function createSessions() {
  const sessions = new Map();
  const expired = (session, now) => now - session.seen > SESSION_IDLE_MS || now - session.created > SESSION_MAX_MS;
  return {
    create() {
      const now = Date.now();
      for (const [key, session] of sessions) if (expired(session, now)) sessions.delete(key);
      const token = crypto.randomBytes(32).toString('base64url');
      const csrf = crypto.randomBytes(24).toString('base64url');
      sessions.set(sha256(token).toString('hex'), { csrf, created: now, seen: now });
      return token;
    },
    get(token) {
      if (!token || token.length > 128) return null;
      const key = sha256(token).toString('hex');
      const session = sessions.get(key);
      if (!session) return null;
      const now = Date.now();
      if (expired(session, now)) {
        sessions.delete(key);
        return null;
      }
      session.seen = now;
      return { key, csrf: session.csrf };
    },
    destroy(key) { sessions.delete(key); }
  };
}

function volumeFiles(root) {
  if (!root) return null;
  const files = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (error) { return; }
    for (const entry of entries) {
      if (files.length >= 60) return;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        files.push({ path: `${rel}/`, size: null });
        if (depth < 2) walk(full, depth + 1);
      } else {
        let size = null;
        try { size = fs.statSync(full).size; } catch (error) { size = null; }
        files.push({ path: rel, size });
      }
    }
  };
  walk(root, 0);
  return files;
}

function cleanFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid request.' };
  const fields = {};
  for (const [key, kind] of Object.entries(EDITABLE)) {
    if (!has(body, key)) continue;
    const value = body[key];
    if (kind === 'text') {
      if (value !== null && typeof value !== 'string') return { error: `${key} must be text.` };
      fields[key] = String(value || '').trim().slice(0, TEXT_LIMITS[key]);
    } else if (kind === 'date') {
      if (value === null || value === '') fields[key] = null;
      else if (isValidIsoDate(value)) fields[key] = value;
      else return { error: 'Use a real calendar date for the wedding.' };
    } else if (kind === 'status') {
      if (!STATUSES.includes(value)) return { error: 'Unknown status.' };
      fields[key] = value;
    } else if (kind === 'money') {
      if (value === null || value === '') fields[key] = null;
      else {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return { error: 'Amounts must be between 0 and 10,000,000.' };
        fields[key] = Math.round(amount * 100) / 100;
      }
    }
  }
  return { fields };
}

const page = (title, bodyClass, body, head = '') => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="/assets/fonts/the-day.css">
<link rel="stylesheet" href="/admin/assets/admin.css">
${head}
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;

function loginPage(message, disabled) {
  return page('Sign in · Studio · Alex Claudio', 'login-page', `<main class="login-card">
  <img class="login-mark" src="/favicon.svg" alt="" width="64" height="64">
  <p class="eyebrow">Alex Claudio &middot; Studio</p>
  <h1>Sign in</h1>
  ${message ? `<p class="login-message" role="alert">${escapeHtml(message)}</p>` : ''}
  <form method="post" action="/admin/login">
    <input type="text" name="username" value="Alex Claudio Studio" autocomplete="username" hidden>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required${disabled ? ' disabled' : ' autofocus'}>
    <button type="submit"${disabled ? ' disabled' : ''}>Sign in</button>
  </form>
  <a class="login-back" href="/">Back to the website</a>
</main>`);
}

function createAdminRouter({ store = null, env = process.env } = {}) {
  const router = express.Router();
  const limiter = createLoginLimiter();
  const sessions = createSessions();

  // The key for device notes lives in the database, so notes survive deploys. Sign-in never waits
  // for it: until it has loaded (or with no database) a key made at startup is used instead, and
  // notes signed with that one simply stop counting later.
  const startupSecret = crypto.randomBytes(32);
  let storedSecret = null;
  let loadingSecret = null;
  const deviceSecret = () => {
    if (!storedSecret && !loadingSecret && store && typeof store.deviceSecret === 'function') {
      loadingSecret = Promise.resolve()
        .then(() => store.deviceSecret())
        .then((value) => { if (Buffer.isBuffer(value) && value.length >= 32) storedSecret = value; })
        .catch(() => { /* the database is unavailable; try again on the next sign-in */ })
        .finally(() => { loadingSecret = null; });
    }
    return storedSecret || startupSecret;
  };
  deviceSecret();

  const cookieName = (req) => (req.secure ? '__Secure-ac_studio' : 'ac_studio');
  const deviceCookieName = (req) => (req.secure ? '__Secure-ac_device' : 'ac_device');
  const sessionCookie = (req, value, maxAge) => [
    `${cookieName(req)}=${value}`, 'Path=/admin', 'HttpOnly', 'SameSite=Lax',
    ...(maxAge !== undefined ? [`Max-Age=${maxAge}`] : []), ...(req.secure ? ['Secure'] : [])
  ].join('; ');
  const deviceCookie = (req, value) => [
    `${deviceCookieName(req)}=${value}`, 'Path=/admin/login', 'HttpOnly', 'SameSite=Strict',
    `Max-Age=${Math.floor(DEVICE_MAX_MS / 1000)}`, ...(req.secure ? ['Secure'] : [])
  ].join('; ');
  // Changes must come from this site's own pages. Browsers state where a request came from in
  // Sec-Fetch-Site, which page scripts can't forge; without it, the Origin host is compared (not the
  // scheme, because the hosting proxy terminates HTTPS). Clients that send neither aren't browsers,
  // so cross-site request forgery doesn't apply to them; they still need the password or the token.
  const sameOrigin = (req) => {
    const site = String(req.get('sec-fetch-site') || '').trim().toLowerCase();
    if (site) return site === 'same-origin';
    const origin = req.get('origin');
    if (!origin) return true;
    let host;
    try { host = new URL(origin).host.toLowerCase(); } catch (error) { return false; }
    if (!host) return false;
    return [req.get('host'), req.get('x-forwarded-host')]
      .filter(Boolean)
      .some((value) => String(value).split(',')[0].trim().toLowerCase() === host);
  };
  const csrfOk = (req) => {
    const sent = Buffer.from(String(req.get('x-csrf-token') || ''));
    const wanted = Buffer.from(req.studio.csrf);
    return sent.length === wanted.length && crypto.timingSafeEqual(sent, wanted) && sameOrigin(req);
  };

  // Every dashboard response: never cached, never indexed, never framed, scripts only from this site.
  router.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': CSP,
      'Cross-Origin-Opener-Policy': 'same-origin'
    });
    next();
  });

  // The password never travels over plain HTTP: requests the proxy marks as http are refused.
  router.use((req, res, next) => {
    const proto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    if (proto !== 'http') return next();
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
    return res.status(403).type('text').send('HTTPS required');
  });

  router.get('/assets/admin.css', (req, res) => res.type('text/css').sendFile(path.join(ASSETS, 'admin.css'), { cacheControl: false }));
  router.get('/assets/admin.js', (req, res) => res.type('application/javascript').sendFile(path.join(ASSETS, 'admin.js'), { cacheControl: false }));

  const currentSession = (req) => sessions.get(readCookies(req.headers.cookie)[cookieName(req)]);

  router.get('/login', (req, res) => {
    if (currentSession(req)) return res.redirect(303, '/admin');
    const password = passwordState(env);
    if (password.state === 'missing') return res.status(503).send(loginPage('Sign-in isn\u2019t set up yet. Add an ADMIN_PASSWORD variable (at least 12 characters) to the website service on Railway.', true));
    if (password.state === 'short') return res.status(503).send(loginPage('The ADMIN_PASSWORD variable on Railway is too short. Use at least 12 characters.', true));
    res.send(loginPage('', false));
  });

  router.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).send(loginPage('Please sign in from this page.', false));
    const password = passwordState(env);
    if (password.state !== 'ok') return res.status(503).send(loginPage('Sign-in isn\u2019t set up yet.', true));
    const ip = req.ip || 'unknown';
    const trusted = knownDevice(readCookies(req.headers.cookie)[deviceCookieName(req)], deviceSecret(), password.digest);
    if (limiter.blocked(ip, trusted)) return res.status(429).send(loginPage('Too many attempts. Please wait 15 minutes and try again.', false));
    const body = req.body || {};
    const given = typeof body.password === 'string' ? body.password : '';
    const ok = given.length > 0 && given.length <= 1024 && crypto.timingSafeEqual(sha256(given), password.digest);
    if (!ok) {
      limiter.fail(ip);
      console.warn(`Studio sign-in failed from ${ip}`);
      await sleep(FAILED_LOGIN_DELAY_MS);
      return res.status(401).send(loginPage('That password isn\u2019t right.', false));
    }
    limiter.succeed(ip);
    res.append('Set-Cookie', sessionCookie(req, sessions.create()));
    res.append('Set-Cookie', deviceCookie(req, deviceNote(deviceSecret(), password.digest)));
    console.log(`Studio sign-in from ${ip}`);
    res.redirect(303, '/admin');
  });

  // Everything below needs a signed-in session.
  router.use((req, res, next) => {
    const session = currentSession(req);
    if (!session) {
      if (req.path.startsWith('/api/') || req.method !== 'GET') return res.status(401).json({ error: 'Signed out. Please sign in again.' });
      return res.redirect(303, '/admin/login');
    }
    req.studio = session;
    next();
  });

  router.post('/logout', (req, res) => {
    if (!csrfOk(req)) return res.status(403).json({ error: 'Please reload the page and try again.' });
    sessions.destroy(req.studio.key);
    res.append('Set-Cookie', sessionCookie(req, '', 0));
    res.status(204).end();
  });

  router.get('/', (req, res) => {
    res.send(page('Studio · Alex Claudio', 'studio', '<div id="app"></div>\n<noscript><p class="noscript">The studio dashboard needs JavaScript.</p></noscript>',
      `<meta name="csrf" content="${escapeHtml(req.studio.csrf)}">\n<script src="/admin/assets/admin.js" defer></script>`));
  });

  const api = express.Router();
  api.use(express.json({ limit: '64kb' }));
  api.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !csrfOk(req)) return res.status(403).json({ error: 'Please reload the page and try again.' });
    next();
  });

  api.get('/overview', async (req, res) => {
    const db = store ? await store.ping() : { configured: false, connected: false };
    let stats = null;
    if (db.connected) {
      try { stats = await store.stats(); } catch (error) { db.error = safeMessage(error); }
    }
    res.json({
      db,
      stats,
      settings: SETTINGS.map(([name, label]) => ({ name, label, present: Boolean(env[name]), value: SHOW_VALUE.has(name) && env[name] ? String(env[name]) : undefined })),
      volume: env.RAILWAY_VOLUME_MOUNT_PATH ? { path: env.RAILWAY_VOLUME_MOUNT_PATH, files: volumeFiles(env.RAILWAY_VOLUME_MOUNT_PATH) } : null,
      node: process.version
    });
  });

  api.use((req, res, next) => {
    if (!store) return res.status(503).json({ error: 'The dashboard has nowhere to save yet. See Setup.', code: 'no-database' });
    next();
  });

  const idParam = (req, res, name = 'id') => {
    const id = String(req.params[name] || '');
    if (!ID.test(id)) { res.status(404).json({ error: 'Not found.' }); return null; }
    return id;
  };

  api.get('/inquiries', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 200);
    const status = STATUSES.includes(req.query.status) ? req.query.status : '';
    res.json({ inquiries: await store.listInquiries({ q, status }) });
  });

  api.post('/inquiries', async (req, res) => {
    const { fields, error } = cleanFields(req.body);
    if (error) return res.status(400).json({ error });
    if (!fields.names && !fields.email) return res.status(400).json({ error: 'Add at least the couple\u2019s names or an email.' });
    if (!fields.wedding_date && fields.event_date) fields.wedding_date = parseWeddingDate(fields.event_date);
    res.status(201).json({ inquiry: await store.createInquiry(fields) });
  });

  api.get('/inquiries/:id', async (req, res) => {
    const id = idParam(req, res);
    if (!id) return;
    const found = await store.getInquiry(id);
    if (!found) return res.status(404).json({ error: 'Not found.' });
    res.json(found);
  });

  api.patch('/inquiries/:id', async (req, res) => {
    const id = idParam(req, res);
    if (!id) return;
    const { fields, error } = cleanFields(req.body);
    if (error) return res.status(400).json({ error });
    const inquiry = await store.updateInquiry(id, fields);
    if (!inquiry) return res.status(404).json({ error: 'Not found.' });
    res.json({ inquiry });
  });

  api.delete('/inquiries/:id', async (req, res) => {
    const id = idParam(req, res);
    if (!id) return;
    if (!(await store.deleteInquiry(id))) return res.status(404).json({ error: 'Not found.' });
    res.status(204).end();
  });

  api.post('/inquiries/:id/notes', async (req, res) => {
    const id = idParam(req, res);
    if (!id) return;
    const body = typeof (req.body || {}).body === 'string' ? req.body.body.trim().slice(0, 5000) : '';
    if (!body) return res.status(400).json({ error: 'Write something first.' });
    const note = await store.addNote(id, body);
    if (!note) return res.status(404).json({ error: 'Not found.' });
    res.status(201).json({ note });
  });

  api.delete('/notes/:id', async (req, res) => {
    const id = idParam(req, res);
    if (!id) return;
    if (!(await store.deleteNote(id))) return res.status(404).json({ error: 'Not found.' });
    res.status(204).end();
  });

  api.get('/calendar', async (req, res) => {
    const { from, to } = req.query;
    if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to || Date.parse(to) - Date.parse(from) > 62 * 86400000) {
      return res.status(400).json({ error: 'Invalid date range.' });
    }
    res.json({ weddings: await store.calendar(from, to) });
  });

  api.get('/archive', async (req, res) => {
    res.json({ tables: await store.legacyTables() });
  });

  api.get('/archive/:schema/:table', async (req, res) => {
    const pageNumber = Math.min(10000, Math.max(0, parseInt(req.query.page, 10) || 0));
    const result = await store.legacyRows(String(req.params.schema), String(req.params.table), pageNumber);
    if (!result) return res.status(404).json({ error: 'Not found.' });
    res.json(result);
  });

  // The whole dashboard as one SQLite file, to keep a copy somewhere other than Railway.
  api.get('/backup', async (req, res) => {
    const file = await store.snapshot();
    let stamp;
    try {
      stamp = new Intl.DateTimeFormat('en-CA', { timeZone: env.STUDIO_TIMEZONE || 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (error) {
      stamp = new Date().toISOString().slice(0, 10);
    }
    res.set('Content-Type', 'application/vnd.sqlite3');
    res.download(file, `alex-claudio-studio-${stamp}.sqlite`, { cacheControl: false, headers: { 'Content-Type': 'application/vnd.sqlite3' } }, () => {
      fs.rm(file, { force: true }, () => {});
    });
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  router.use('/api', api);

  router.use((req, res) => res.status(404).type('text').send('Not found'));

  // eslint-disable-next-line no-unused-vars
  router.use((error, req, res, next) => {
    const status = error.status || error.statusCode || 500;
    if (status >= 500) console.error('Studio dashboard error:', safeMessage(error));
    const message = status === 413 ? 'That is too large.' : status < 500 ? 'Invalid request.' : 'Something went wrong. Please try again.';
    if (req.originalUrl.startsWith('/admin/api/') && req.studio) {
      return res.status(status).json({ error: message, detail: status >= 500 ? safeMessage(error) : undefined });
    }
    res.status(status).type('text').send(message);
  });

  return router;
}

module.exports = { createAdminRouter, parseWeddingDate };
