import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createApp } = require('../server');
const { createStore } = require('../server/admin/store');
const { readGuideEvent } = require('../server/analytics');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const pageId = (seed) => seed.repeat(24).slice(0, 24);
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
const view = (seed, pathname) => ({
  page: pageId(seed), path: pathname, source: 'Gmail', referrer: 'mail.google.com', medium: '', campaign: '', device: 'Mobile',
  timezone: 'America/Los_Angeles', country: 'US', browser: 'Safari', os: 'iOS'
});

async function openStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-analytics-'));
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: dir });
  await store.ready();
  t.after(async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return store;
}

test('only the guide’s own kinds of click are accepted, with their allowed choices', () => {
  const page = pageId('a');
  const ok = (body) => readGuideEvent({ kind: 'guide', page, ...body });
  assert.deepEqual(ok({ event: 'start', detail: 'Signature' }), { page, event: 'start', detail: 'Signature', value: null });
  assert.deepEqual(ok({ event: 'hours', value: 10 }), { page, event: 'hours', detail: '', value: 10 });
  assert.deepEqual(ok({ event: 'album', detail: 'none' }), { page, event: 'album', detail: 'none', value: null });
  assert.deepEqual(ok({ event: 'sent', detail: 'personal', value: 5700 }), { page, event: 'sent', detail: 'personal', value: 5700 });
  assert.deepEqual(ok({ event: 'package', detail: 'Custom', value: 9 }), { page, event: 'package', detail: 'Custom', value: 9 });
  for (const bad of [
    { event: 'start', detail: 'Platinum' }, { event: 'hours', value: 13 }, { event: 'hours', value: 7.5 }, { event: 'hours' },
    { event: 'builder', detail: 'x' }, { event: 'builder', value: 1 }, { event: 'album', detail: '16' }, { event: 'clicked' },
    { event: 'toString' }, { event: 'sent', detail: 'email', value: 100 }
  ]) assert.equal(ok(bad), null, JSON.stringify(bad));
  assert.equal(readGuideEvent({ kind: 'guide', page: 'nope', event: 'builder' }), null);
  assert.equal(readGuideEvent({ kind: 'view', page, event: 'builder' }), null);
});

test('guide clicks join the visit of their page view and add up on the Analytics page', async (t) => {
  const store = await openStore(t);
  const who = { ip: '203.0.113.7', userAgent: IPHONE };
  await store.recordView(view('a', '/guide/'), who);
  const steps = [
    ['builder'], ['start', 'Signature'], ['hours', '', 9], ['hours', '', 10], ['second', 'on'], ['album', '12'],
    ['session', 'on'], ['copy'], ['letter'], ['sent', 'personal', 8500], ['package', 'Custom', 10]
  ];
  for (const [event, detail = '', value = null] of steps) assert.equal(await store.recordGuideEvent({ page: pageId('a'), event, detail, value }), true);

  // A second visitor who only looked.
  await store.recordView(view('b', '/guide/'), { ip: '198.51.100.4', userAgent: IPHONE });
  await store.recordGuideEvent({ page: pageId('b'), event: 'builder', detail: '', value: null });

  // Clicks that don't belong to a counted guide page view are dropped.
  await store.recordView(view('c', '/'), { ip: '192.0.2.9', userAgent: IPHONE });
  assert.equal(await store.recordGuideEvent({ page: pageId('c'), event: 'builder', detail: '', value: null }), false);
  assert.equal(await store.recordGuideEvent({ page: pageId('d'), event: 'builder', detail: '', value: null }), false);

  const { guide, recent } = await store.analytics('30d');
  assert.equal(guide.visits, 2);
  assert.equal(guide.builder, 2);
  assert.equal(guide.chose, 1);
  assert.equal(guide.letter, 1);
  assert.equal(guide.sent_visits, 1);
  assert.equal(guide.copied, 1);
  assert.deepEqual(guide.sent, { count: 1, personal: 1, average: 8500 });
  assert.deepEqual(guide.starts.map((row) => [row.detail, row.visits]), [['Signature', 1]]);
  assert.deepEqual(guide.hours.map((row) => [row.value, row.times]), [[9, 1], [10, 1]]);
  assert.deepEqual(guide.second.map((row) => row.detail), ['on']);
  assert.deepEqual(guide.albums.map((row) => row.detail), ['12']);
  assert.deepEqual(guide.packages.map((row) => [row.detail, row.value, row.times]), [['Custom', 10, 1]]);

  const visit = recent.find((v) => v.guide.length > 2);
  assert.deepEqual(visit.guide.map((step) => step.event), steps.map(([event]) => event));
  assert.equal(recent.find((v) => v.landing === '/').guide.length, 0);
});

test('the website takes guide clicks through the visit counter, from its own pages only', async (t) => {
  const store = await openStore(t);
  const server = createApp({ store, env: {} }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${origin}/api/visit`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'User-Agent': IPHONE, ...headers }, body: JSON.stringify(body)
  });

  await post({ kind: 'view', page: pageId('e'), path: '/guide/', referrer: 'https://mail.google.com/', device: 'Mobile', tz: 'America/Los_Angeles' });
  await settle();
  const answer = await post({ kind: 'guide', page: pageId('e'), event: 'start', detail: 'Heirloom' });
  assert.equal(answer.status, 204);
  await post({ kind: 'guide', page: pageId('e'), event: 'hours', value: 99 });
  await post({ kind: 'guide', page: pageId('e'), event: 'builder' }, { 'Sec-Fetch-Site': 'cross-site' });
  await post({ kind: 'guide', page: pageId('e'), event: 'letter' }, { 'User-Agent': 'curl/8.7.1' });
  await settle();

  const { guide } = await store.analytics('today');
  assert.equal(guide.visits, 1);
  assert.deepEqual(guide.starts.map((row) => row.detail), ['Heirloom']);
  assert.equal(guide.hours.length, 0, 'an hour outside the price list is refused');
  assert.equal(guide.builder, 0, 'clicks sent from another site are ignored');
  assert.equal(guide.letter, 0, 'bots are ignored');
});

test('the guide page reports its clicks against the visit counter’s page view', () => {
  const page = read('guide/index.html');
  const script = read('guide/guide.js');
  assert.match(read('assets/visits.js'), /window\.acVisitPage = page;/);
  assert.match(page, /<script src="\/assets\/visits\.js\?v=2" defer><\/script>/);
  assert.ok(page.indexOf('/assets/visits.js') < page.indexOf('/guide/guide.js'), 'the visit counter loads first');
  for (const call of ["track('builder')", "track('letter')", "track('window')", "track('copy')", "track('start', c.name)",
    "track('hours', '', state.hours)", "track('session',", "track('second',", "track('album',", "track('sent',", "track('package',"]) {
    assert.ok(script.includes(call), call);
  }
  assert.match(read('server/admin/assets/admin.js'), /'\/guide\/': 'Pricing guide'/);
});
