import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createStore } = require('../server/admin/store');
const { createApp } = require('../server');
const { calendarFeed, fold } = require('../server/admin/ical');
const { localDay } = require('../server/admin/analytics');

const PASSWORD = 'correct horse battery staple';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-work-'));
const today = () => localDay('America/Los_Angeles');
const inDays = (n) => {
  const [y, m, d] = today().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

async function withStore(run) {
  const dir = tempDir();
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: dir });
  await store.ready();
  try { await run(store, dir); } finally { await store.close(); }
}

test('booking a wedding makes its tasks, and they follow the date and the stage', async () => {
  await withStore(async (store) => {
    const id = await store.insertInquiry('contact', { names: 'Ana & Iulian', email: 'ana@example.com' });
    assert.deepEqual(await store.tasksFor(id), [], 'an inquiry has no tasks yet');

    await store.updateInquiry(id, { status: 'booked', wedding_date: inDays(100) });
    let tasks = await store.tasksFor(id);
    assert.deepEqual(tasks.map((t) => [t.kind, t.due_date]), [
      ['questionnaire', inDays(44)], ['timeline', inDays(86)], ['gallery', inDays(142)]
    ]);

    await store.updateInquiry(id, { wedding_date: inDays(110) });
    tasks = await store.tasksFor(id);
    assert.equal(tasks.find((t) => t.kind === 'gallery').due_date, inDays(152), 'a new date moves the due dates');

    // Set aside, an automatic task stays away.
    await store.deleteTask(tasks.find((t) => t.kind === 'timeline').id);
    await store.updateInquiry(id, { wedding_date: inDays(120) });
    assert.equal((await store.tasksFor(id)).some((t) => t.kind === 'timeline'), false);

    await store.updateInquiry(id, { progress: 'delivered' });
    assert.equal((await store.tasksFor(id)).find((t) => t.kind === 'gallery').done, true, 'delivered means the gallery is done');

    await store.updateInquiry(id, { status: 'not_booked', progress: null });
    assert.deepEqual((await store.tasksFor(id)).map((t) => t.kind), ['gallery'], 'open tasks go when the wedding is off; done ones stay');
  });
});

test('a wedding booked late skips the tasks that were already due', async () => {
  await withStore(async (store) => {
    const id = await store.insertInquiry('contact', { names: 'Late & Booked' });
    await store.updateInquiry(id, { status: 'booked', wedding_date: inDays(10) });
    // The questionnaire (8 weeks before) and the timeline check (2 weeks before) were due already.
    assert.deepEqual((await store.tasksFor(id)).map((t) => t.kind), ['gallery']);
  });
});

test('every change is recorded with what it was before', async () => {
  await withStore(async (store) => {
    const id = await store.insertInquiry('contact', { names: 'Dana & Sam', email: 'dana@example.com' });
    await store.updateInquiry(id, { status: 'booked', price: 5700, paid: 1710, tags: JSON.stringify(['Album to make']) });
    await store.updateInquiry(id, { price: 5700 });
    await store.addNote(id, 'Loves the ferry.');
    const { activity } = await store.getInquiry(id);
    assert.deepEqual(activity.map((a) => [a.actor, a.summary]), [
      ['you', 'Note: Loves the ferry.'],
      ['you', 'Moved to Booked, agreed price $5,700, received $1,710, tagged Album to make'],
      ['website', 'New inquiry from Dana & Sam']
    ], 'an unchanged value records nothing');
  });
});

test('the Today page lists replies owed, date clashes, past weddings and open balances', async () => {
  await withStore(async (store) => {
    const booked = await store.insertInquiry('contact', { names: 'Booked Pair' });
    await store.updateInquiry(booked, { status: 'booked', wedding_date: inDays(20), price: 4000, paid: 1200 });
    const asking = await store.insertInquiry('contact', { names: 'Asking Pair' });
    await store.updateInquiry(asking, { status: 'replied', wedding_date: inDays(20) });
    const past = await store.insertInquiry('contact', { names: 'Past Pair' });
    await store.updateInquiry(past, { status: 'booked', wedding_date: inDays(-5), price: 4000, paid: 4000 });
    await store.insertInquiry('contact', { names: 'New Pair' });

    const day = await store.today();
    assert.equal(day.today, today());
    assert.deepEqual(day.upcoming.map((w) => [w.names, w.days]), [['Booked Pair', 20]]);
    assert.deepEqual(day.needs.map((n) => [n.kind, n.names]), [
      ['reply', 'New Pair'], ['clash', 'Asking Pair'], ['editing', 'Past Pair'], ['balance', 'Booked Pair']
    ]);
    assert.match(day.needs.find((n) => n.kind === 'balance').text, /^\$2,800 still open\. Wedding in 20 days\.$/);
    assert.ok(day.tasks.some((t) => t.kind === 'timeline' && t.names === 'Booked Pair'));

    const board = await store.board();
    assert.deepEqual(board.map((c) => c.stage).sort(), ['booked', 'booked', 'new', 'replied']);
  });
});

test('weddings from the earlier dashboard keep their stage when the new columns arrive', () => {
  const dir = tempDir();
  const file = path.join(dir, 'studio.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '',
    form_name TEXT NOT NULL DEFAULT 'manual', names TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL DEFAULT '', wedding_date TEXT, location TEXT NOT NULL DEFAULT '', hours TEXT NOT NULL DEFAULT '',
    care TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new',
    price_cents INTEGER, paid_cents INTEGER, fields TEXT NOT NULL DEFAULT '{}');`);
  db.prepare("INSERT INTO inquiries (form_name, names, status, fields) VALUES ('earlier-dashboard', 'Old Pair', 'booked', ?)").run(JSON.stringify({ 'Stage in the earlier dashboard': 'Delivered' }));
  db.close();
  return (async () => {
    const store = createStore({ STUDIO_DB_PATH: file });
    await store.ready();
    try {
      assert.equal((await store.getInquiry('1')).inquiry.stage, 'delivered');
    } finally { await store.close(); }
  })();
});

test('the calendar feed escapes text, folds long lines and lists weddings and tasks', () => {
  const ics = calendarFeed({
    weddings: [{ id: '7', names: 'Ana, Iulian; & co', wedding_date: '2027-06-05', location: 'Orcas Island', stage: 'planning', hours: '8 hours' }],
    tasks: [{ id: '3', title: 'Send the questionnaire', due_date: '2027-04-10', names: 'Ana' }]
  }, 'https://alex-claudio.com');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270605\r\nDTEND;VALUE=DATE:20270606\r\n/);
  assert.ok(ics.includes('SUMMARY:Wedding: Ana\\, Iulian\\; & co\r\n'));
  assert.match(ics, /SUMMARY:To do: Send the questionnaire \(Ana\)\r\n/);
  assert.ok(ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
  assert.equal(fold('x'.repeat(80)), `${'x'.repeat(75)}\r\n ${'x'.repeat(5)}`);
});

test('the calendar feed opens only with its private address, and a new address closes the old one', async () => {
  const dir = tempDir();
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: dir });
  await store.ready();
  const server = createApp({ env: { ADMIN_PASSWORD: PASSWORD }, store }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const id = await store.insertInquiry('contact', { names: 'Feed Pair' });
    await store.updateInquiry(id, { status: 'booked', wedding_date: inDays(30) });

    const key = await store.feedKey();
    const feed = await fetch(`${origin}/admin/feed/${key}/weddings.ics`);
    assert.equal(feed.status, 200);
    assert.match(feed.headers.get('content-type'), /^text\/calendar/);
    assert.equal(feed.headers.get('cache-control'), 'no-store');
    assert.match(await feed.text(), /SUMMARY:Wedding: Feed Pair/);

    assert.equal((await fetch(`${origin}/admin/feed/${'x'.repeat(key.length)}/weddings.ics`)).status, 404);
    const renewed = await store.feedKey(true);
    assert.notEqual(renewed, key);
    assert.equal((await fetch(`${origin}/admin/feed/${key}/weddings.ics`)).status, 404, 'the old address stops working');

    // Without signing in, the rest of the dashboard stays shut.
    assert.equal((await fetch(`${origin}/admin/api/today`)).status, 401);
    assert.equal((await fetch(`${origin}/admin/api/calendar-feed`)).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
});

test('the dashboard moves couples between stages and manages tasks through the API', async () => {
  const dir = tempDir();
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: dir });
  await store.ready();
  const server = createApp({ env: { ADMIN_PASSWORD: PASSWORD }, store }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${origin}/admin/login`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: PASSWORD }).toString()
    });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const csrf = /<meta name="csrf" content="([^"]+)">/.exec(await (await fetch(`${origin}/admin`, { headers: { cookie } })).text())[1];
    const call = (method, url, body) => fetch(`${origin}/admin/api${url}`, {
      method, headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
    });

    const id = await store.insertInquiry('contact', { names: 'Api Pair' });
    let res = await call('PATCH', `/inquiries/${id}`, { stage: 'editing', wedding_date: inDays(-3), tags: [' Photos  to edit ', 'photos to edit', 'Album'] });
    assert.equal(res.status, 200);
    const { inquiry } = await res.json();
    assert.equal(inquiry.status, 'booked');
    assert.equal(inquiry.stage, 'editing');
    assert.deepEqual(inquiry.tags, ['Photos to edit', 'Album']);

    res = await call('PATCH', `/inquiries/${id}`, { stage: 'replied' });
    assert.equal((await res.json()).inquiry.stage, 'replied', 'leaving booked clears the progress');
    assert.equal((await call('PATCH', `/inquiries/${id}`, { stage: 'shipped' })).status, 400);
    assert.equal((await call('PATCH', `/inquiries/${id}`, { tags: 'Album' })).status, 400);

    res = await call('POST', '/tasks', { title: '  Order   albums ', due_date: inDays(3), inquiry_id: id });
    assert.equal(res.status, 201);
    const { task } = await res.json();
    assert.equal(task.title, 'Order albums');
    assert.equal((await call('POST', '/tasks', { title: '' })).status, 400);
    assert.equal((await call('POST', '/tasks', { title: 'x', due_date: '2027-02-30' })).status, 400);
    assert.equal((await call('POST', '/tasks', { title: 'x', inquiry_id: '999' })).status, 404);

    res = await call('PATCH', `/tasks/${task.id}`, { done: true });
    assert.equal((await res.json()).task.done, true);
    const today = await (await call('GET', '/today')).json();
    assert.ok(today.activity.some((a) => a.summary === 'Done: Order albums'));
    assert.equal((await call('DELETE', `/tasks/${task.id}`)).status, 204);
    assert.equal((await call('DELETE', `/tasks/${task.id}`)).status, 404);

    const board = await (await call('GET', '/board')).json();
    assert.deepEqual(board.cards.map((c) => c.stage), ['replied']);
    const feed = await (await call('GET', '/calendar-feed')).json();
    assert.match(feed.url, /^https:\/\/127\.0\.0\.1\/admin\/feed\/[\w-]{43}\/weddings\.ics$/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
});
