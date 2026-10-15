import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createApp } = require('../server');
const { createStore } = require('../server/admin/store');
const { createRateLimit, describeAgent, isBot, readTime, readView, sourceOf } = require('../server/analytics');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 389.0.0.29.87';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';
const NOON_IN_SEATTLE = Date.parse('2026-10-15T19:00:00Z');

const pageId = (seed) => seed.repeat(24).slice(0, 24);
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-visits-'));
const view = (seed, pathname, extra = {}) => ({
  page: pageId(seed), path: pathname, source: 'Direct', referrer: '', medium: '', campaign: '', device: 'Mobile',
  timezone: 'America/Los_Angeles', country: 'US', browser: 'Safari', os: 'iOS', ...extra
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

async function openStore(t) {
  const dir = tempDir();
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: dir });
  await store.ready();
  t.after(() => store.close());
  return { store, file: path.join(dir, 'studio.sqlite') };
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

// A stand-in store that only writes down what it was asked to count.
function countingStore() {
  const calls = { views: [], times: [], actions: [] };
  return {
    calls,
    ready: async () => {},
    insertInquiry: async () => '1',
    recordView: async (seen, who) => { calls.views.push({ view: seen, who }); return 1; },
    recordTime: async (time) => { calls.times.push(time); return true; },
    recordAction: async (kind, detail, who) => { calls.actions.push({ kind, detail, who }); return null; }
  };
}

test('visits are filed under a tagged link, the referring site, or the app they were opened in', () => {
  assert.equal(sourceOf({ referrer: 'https://www.google.com/' }), 'Google');
  assert.equal(sourceOf({ referrer: 'https://www.google.co.uk/' }), 'Google');
  assert.equal(sourceOf({ referrer: 'https://gemini.google.com/app/123' }), 'Gemini');
  assert.equal(sourceOf({ referrer: 'https://l.instagram.com/?u=https%3A%2F%2Falex-claudio.com' }), 'Instagram');
  assert.equal(sourceOf({ referrer: 'android-app://com.google.android.gm/' }), 'Gmail');
  assert.equal(sourceOf({ referrer: 'https://www.theknot.com/marketplace/alex-claudio' }), 'The Knot');
  assert.equal(sourceOf({ referrer: 'https://seattle-bride.example/vendors' }), 'seattle-bride.example');
  assert.equal(sourceOf({ tag: 'instagram' }), 'Instagram', 'the /ig link');
  assert.equal(sourceOf({ tag: 'chatgpt.com', referrer: 'https://chatgpt.com/' }), 'ChatGPT');
  assert.equal(sourceOf({ tag: 'spring-fair' }), 'Spring-fair');
  assert.equal(sourceOf({ userAgent: INSTAGRAM }), 'Instagram', 'in-app browsers often send no referrer');
  assert.equal(sourceOf({ referrer: 'https://alex-claudio.com/portfolio/' }), 'Direct');
  assert.equal(sourceOf({}), 'Direct');
});

test('a page view keeps only summaries: the referring host, the country and the kind of device', () => {
  const seen = readView({
    kind: 'view', page: pageId('a'), path: '/', referrer: 'https://www.google.com/search?q=seattle+wedding+photographer',
    device: 'Mobile', tz: 'America/Los_Angeles', source: '', medium: '', campaign: ''
  }, IPHONE);
  assert.deepEqual(seen, {
    page: pageId('a'), path: '/', source: 'Google', referrer: 'google.com', medium: '', campaign: '',
    device: 'Mobile', timezone: 'America/Los_Angeles', country: 'US', browser: 'Safari', os: 'iOS'
  });
  assert.equal(readView({ kind: 'view', page: 'nope', path: '/' }, IPHONE), null);
  assert.equal(readView({ kind: 'time', page: pageId('a') }, IPHONE), null);
  assert.equal(readView({ kind: 'view', page: pageId('a'), device: 'Fridge' }, IPHONE).device, 'Desktop');
  assert.equal(readView({ kind: 'view', page: pageId('a'), referrer: 'https://www.alex-claudio.com/blog/' }, IPHONE).referrer, '');
  assert.equal(readView({ kind: 'view', page: pageId('a'), tz: 'Etc/UTC' }, IPHONE).country, '');

  assert.deepEqual(readTime({ kind: 'time', page: pageId('a'), seconds: 99999 }), { page: pageId('a'), seconds: 4 * 60 * 60 });
  assert.equal(readTime({ kind: 'time', page: pageId('a'), seconds: -3 }), null);
  assert.equal(readTime({ kind: 'time', page: pageId('a'), seconds: 'soon' }), null);

  assert.deepEqual(describeAgent(EDGE), { browser: 'Edge', os: 'Windows' });
  assert.deepEqual(describeAgent(INSTAGRAM), { browser: 'Instagram app', os: 'iOS' });
  assert.deepEqual(describeAgent(MAC), { browser: 'Chrome', os: 'macOS' });
  for (const robot of ['', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'curl/8.7.1', 'facebookexternalhit/1.1']) {
    assert.equal(isBot(robot), true, robot);
  }
  assert.equal(isBot(IPHONE), false);

  const allowed = createRateLimit(2, 1000);
  assert.deepEqual([allowed('a', 0), allowed('a', 10), allowed('a', 20), allowed('b', 20), allowed('a', 1500)], [true, true, false, true, true]);
});

test('pages from one person within half an hour make one visit, and the visitor code changes every day', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOON_IN_SEATTLE });
  const { store, file } = await openStore(t);
  const phone = { ip: '203.0.113.7', userAgent: IPHONE };

  const first = await store.recordView(view('a', '/'), phone);
  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal(await store.recordView(view('b', '/portfolio/'), phone), first, 'ten minutes later is the same visit');
  assert.equal(await store.recordView(view('b', '/portfolio/'), phone), first, 'a page sent twice is counted once');
  assert.notEqual(await store.recordView(view('c', '/'), { ip: '203.0.113.8', userAgent: IPHONE }), first, 'someone else');
  t.mock.timers.tick(31 * 60 * 1000);
  assert.notEqual(await store.recordView(view('d', '/'), phone), first, 'after half an hour away a new visit starts');

  t.mock.timers.setTime(NOON_IN_SEATTLE + 24 * 60 * 60 * 1000);
  await store.recordView(view('e', '/'), phone);

  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const visits = db.prepare('SELECT visitor, day FROM visits ORDER BY id').all();
    assert.equal(visits.length, 4);
    assert.equal(db.prepare('SELECT count(*) AS n FROM views').get().n, 5);
    for (const visit of visits) {
      assert.match(visit.visitor, /^[0-9a-f]{32}$/);
      assert.ok(!visit.visitor.includes('203.0.113'), 'no address is stored');
    }
    assert.equal(visits[0].visitor, visits[2].visitor, 'the same person on the same day');
    assert.notEqual(visits[0].visitor, visits[3].visitor, 'the same person the next day is a stranger');
    assert.deepEqual(db.prepare('SELECT day FROM visitor_keys').all().map((row) => row.day), ['2026-10-16'], 'yesterday\u2019s key is gone');
    const columns = ['visits', 'views', 'actions'].flatMap((table) => db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
    assert.ok(!columns.some((name) => /ip|agent|address/i.test(name)), 'no column for addresses or user agents');
  } finally {
    db.close();
  }
});

test('the summary counts visitors, pages, sources, inquiries and gallery downloads', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOON_IN_SEATTLE - 10 * 24 * 60 * 60 * 1000 });
  const { store } = await openStore(t);
  await store.recordView(view('p', '/blog/'), { ip: '198.51.100.9', userAgent: MAC });

  t.mock.timers.setTime(NOON_IN_SEATTLE);
  const couple = { ip: '198.51.100.1', userAgent: IPHONE };
  await store.recordView(view('a', '/', { source: 'Instagram', referrer: 'instagram.com' }), couple);
  await store.recordTime({ page: pageId('a'), seconds: 40 });
  await store.recordTime({ page: pageId('a'), seconds: 25 });
  t.mock.timers.tick(60 * 1000);
  await store.recordView(view('b', '/portfolio/', { source: 'Instagram', referrer: 'instagram.com' }), couple);
  await store.recordTime({ page: pageId('b'), seconds: 20 });
  await store.recordAction('inquiry', 'contact', couple);

  t.mock.timers.tick(60 * 1000);
  const client = { ip: '198.51.100.2', userAgent: MAC };
  await store.recordView(view('g', '/gallery/renee-alan', { source: 'Google', referrer: 'google.com', country: 'GB', timezone: 'Europe/London', device: 'Desktop', browser: 'Chrome', os: 'macOS' }), client);
  await store.recordAction('photo', 'renee-alan', client);
  await store.recordAction('photo', 'renee-alan', client);
  await store.recordAction('zip', 'renee-alan', { ip: '198.51.100.3', userAgent: MAC });

  const summary = await store.analytics('7d');
  assert.deepEqual(summary.range, { key: '7d', from: '2026-10-09', to: '2026-10-15', days: 7, bucket: 'day' });
  assert.equal(summary.counting_since, '2026-10-05');
  assert.deepEqual(summary.totals, {
    visitors: 2, visits: 2, views: 3, single_page: 1, seconds_per_visit: 30,
    inquiries: 1, inquiry_visits: 1, photo_downloads: 2, zip_downloads: 1
  });
  assert.equal(summary.previous.visits, 1);
  assert.equal(summary.series.length, 7);
  assert.deepEqual(summary.series.at(-1), { key: '2026-10-15', visitors: 2, visits: 2, views: 3 });
  assert.ok(summary.series.slice(0, -1).every((day) => !day.visits && !day.views));
  assert.deepEqual(summary.pages.find((page) => page.path === '/'), { path: '/', views: 1, visitors: 1, landings: 1, seconds: 40 });
  assert.deepEqual(summary.sources.map(({ name, visits, inquiries }) => [name, visits, inquiries]), [['Google', 1, 0], ['Instagram', 1, 1]]);
  assert.deepEqual(summary.countries.map((row) => row.name).sort(), ['GB', 'US']);
  assert.deepEqual(summary.galleries, [{ slug: 'renee-alan', views: 1, visitors: 1, photos: 2, zips: 1, last_view: summary.galleries[0].last_view, last_download: summary.galleries[0].last_download }]);
  assert.equal(summary.recent[0].landing, '/gallery/renee-alan');
  assert.deepEqual(summary.recent[1].pages.map((page) => page.path), ['/', '/portfolio/']);
  assert.deepEqual(summary.recent[1].actions.map((action) => action.kind), ['inquiry']);
  assert.ok(summary.recent.every((visit) => !('visitor' in visit) && !('id' in visit)));

  const year = await store.analytics('12m');
  assert.equal(year.range.bucket, 'month');
  assert.equal(year.series.length, 13);
  assert.deepEqual(year.series.at(-1), { key: '2026-10', visitors: 3, visits: 3, views: 4 });
  assert.equal((await store.analytics('forever')).range.key, '30d');
});

test('today is shown hour by hour and set against yesterday up to the same time', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T16:30:00Z') });
  const { store } = await openStore(t);
  await store.recordView(view('y', '/'), { ip: '192.0.2.5', userAgent: IPHONE });
  t.mock.timers.setTime(Date.parse('2026-10-14T23:00:00Z'));
  await store.recordView(view('z', '/'), { ip: '192.0.2.6', userAgent: IPHONE });
  t.mock.timers.setTime(Date.parse('2026-10-15T17:10:00Z'));
  await store.recordView(view('t', '/portfolio/'), { ip: '192.0.2.7', userAgent: IPHONE });

  const today = await store.analytics('today');
  assert.deepEqual(today.range, { key: 'today', from: '2026-10-15', to: '2026-10-15', days: 1, bucket: 'hour' });
  assert.equal(today.series.length, 24);
  assert.deepEqual(today.series[10], { key: '2026-10-15T10', visitors: 1, visits: 1, views: 1 }, '10 AM in Seattle');
  assert.equal(today.series.reduce((n, hour) => n + hour.visits, 0), 1);
  assert.equal(today.previous.visits, 1, 'yesterday counts only up to 10:10 AM, not the 4 PM visit');
});

test('visits older than 13 months are deleted', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2025-08-01T19:00:00Z') });
  const { store } = await openStore(t);
  await store.recordView(view('o', '/'), { ip: '192.0.2.1', userAgent: IPHONE });
  await store.recordAction('zip', 'old-gallery', { ip: '192.0.2.1', userAgent: IPHONE });
  t.mock.timers.setTime(NOON_IN_SEATTLE);
  await store.recordView(view('n', '/'), { ip: '192.0.2.1', userAgent: IPHONE });
  assert.equal(await store.pruneAnalytics(), 1);
  assert.equal((await store.analytics('12m')).totals.visits, 1);
  assert.equal((await store.analytics('12m')).counting_since, '2026-10-15');
});

test('the website counts its own pages from its own visitors, and nothing else', async () => {
  const store = countingStore();
  await withSite({ env: {}, store }, async (origin) => {
    const post = (body, headers = {}) => fetch(`${origin}/api/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'User-Agent': IPHONE, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    });
    const page = { kind: 'view', page: pageId('f'), path: '/gallery/renee-alan/', referrer: 'https://www.instagram.com/', device: 'Mobile', tz: 'Europe/Bucharest' };
    const answer = await post(page);
    assert.equal(answer.status, 204);
    assert.equal(await answer.text(), '');
    await post({ kind: 'time', page: pageId('f'), seconds: 75 });
    await post({ ...page, page: pageId('1'), path: '/admin/' });
    await post({ ...page, page: pageId('2'), path: '/server.js' });
    await post({ ...page, page: pageId('3') }, { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
    await post({ ...page, page: pageId('4') }, { 'Sec-Fetch-Site': 'cross-site' });
    await post('{not json');
    await post({ ...page, page: pageId('5'), path: '/blog/index.html' });
    await settle();

    assert.deepEqual(store.calls.views.map(({ view: seen }) => seen.path), ['/gallery/renee-alan', '/blog/']);
    const [{ view: seen, who }] = store.calls.views;
    assert.equal(seen.source, 'Instagram');
    assert.equal(seen.country, 'RO');
    assert.equal(seen.referrer, 'instagram.com');
    assert.equal(who.userAgent, IPHONE);
    assert.deepEqual(store.calls.times, [{ page: pageId('f'), seconds: 75 }]);

    const letter = new URLSearchParams({ 'form-name': 'contact', company: '', names: 'Maria and Dan', email: 'maria@example.com', event_date: 'August 7, 2027' });
    const sent = await fetch(`${origin}/api/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': IPHONE }, body: letter.toString() });
    assert.equal(sent.status, 200);
    await settle();
    assert.deepEqual(store.calls.actions.map(({ kind, detail }) => [kind, detail]), [['inquiry', 'contact']]);
  });
});

test('an inquiry still goes through when counting it fails', async () => {
  const store = { ...countingStore(), recordAction: () => { throw new Error('disk full'); } };
  await withSite({ env: {}, store }, async (origin) => {
    const letter = new URLSearchParams({ 'form-name': 'contact', company: '', names: 'Maria and Dan', email: 'maria@example.com', event_date: 'August 7, 2027' });
    const sent = await fetch(`${origin}/api/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': IPHONE }, body: letter.toString() });
    assert.equal(sent.status, 200);
  });
});

test('gallery downloads are counted once each: whole photos and zips, never partial requests', async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(req.url.endsWith('missing.jpg') ? 404 : 200, { 'Content-Type': 'image/jpeg' });
    res.end(req.method === 'HEAD' ? undefined : 'jpeg bytes');
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => upstream.once('listening', resolve));
  const saved = process.env.R2_PUBLIC_DOMAIN;
  process.env.R2_PUBLIC_DOMAIN = `http://127.0.0.1:${upstream.address().port}`;
  t.after(() => {
    if (saved === undefined) delete process.env.R2_PUBLIC_DOMAIN; else process.env.R2_PUBLIC_DOMAIN = saved;
    upstream.close();
  });

  const store = countingStore();
  await withSite({ env: {}, store }, async (origin) => {
    const get = async (key, init = {}) => {
      const response = await fetch(`${origin}/cdn/${key}`, { ...init, headers: { 'User-Agent': MAC, ...(init.headers || {}) } });
      await response.arrayBuffer();
      return response.status;
    };
    assert.equal(await get('renee-alan/wedding/Renee%20%26%20Alan%20-%20Wedding%20Day-622.jpg'), 200);
    assert.equal(await get('renee-alan/renee-alan-wedding.zip'), 200);
    await get('renee-alan/wedding/Renee%20%26%20Alan%20-%20Wedding%20Day-622.jpg', { headers: { Range: 'bytes=1000-' } });
    await get('renee-alan/wedding/Renee%20%26%20Alan%20-%20Wedding%20Day-622.jpg', { method: 'HEAD' });
    await get('renee-alan/manifest.json');
    await get('renee-alan/wedding/missing.jpg');
    await get('renee-alan/wedding/a.jpg', { headers: { 'User-Agent': 'curl/8.7.1' } });
    await settle();
    assert.deepEqual(store.calls.actions.map(({ kind, detail }) => [kind, detail]), [['photo', 'renee-alan'], ['zip', 'renee-alan']]);
  });
});
