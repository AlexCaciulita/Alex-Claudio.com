import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createStore } = require('../server/admin/store');
const { createApp } = require('../server');
const { light, typicalDay } = require('../server/admin/project');
const { localDay } = require('../server/admin/analytics');

const PASSWORD = 'correct horse battery staple';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-project-'));
const inDays = (n) => {
  const [y, m, d] = localDay('America/Los_Angeles').split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

async function withStore(run) {
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: tempDir() });
  await store.ready();
  try { await run(store); } finally { await store.close(); }
}

test('sunset in Seattle comes out within a couple of minutes of the published times', () => {
  const zone = 'America/Los_Angeles';
  assert.deepEqual(light('2026-06-21', zone), { sunset: '21:10', golden_hour: '20:10' });
  assert.deepEqual(light('2026-12-21', zone), { sunset: '16:20', golden_hour: '15:20' });
  assert.equal(light(null, zone), null);
});

test('a typical day is built around the ceremony and adds sunset portraits in the evening', () => {
  const day = typicalDay('16:00', { sunset: '20:36' });
  assert.equal(day.find((item) => item.title === 'Ceremony').time, '16:00');
  assert.equal(day.find((item) => /Sunset portraits/.test(item.title)).time, '20:06');
  assert.deepEqual(day.map((item) => item.time), [...day.map((item) => item.time)].sort());
  assert.ok(!typicalDay('16:00', { sunset: '16:20' }).some((item) => /Sunset/.test(item.title)), 'no sunset slot before the reception');
});

test('the usual payment schedule splits the price, counts what was paid, and keeps "received" in step', async () => {
  await withStore(async (store) => {
    const id = await store.insertInquiry('contact', { names: 'Pay Pair' });
    assert.deepEqual(await store.startSchedule(id), { error: 'Set the agreed price first.' });
    await store.updateInquiry(id, { status: 'booked', wedding_date: inDays(60), price: 5700, paid: 1710 });

    const project = await store.startSchedule(id);
    assert.deepEqual(project.payments.map((p) => [p.label, p.amount, p.due_date, p.paid]), [
      ['Retainer (30%)', 1710, inDays(0), true], ['Balance', 3990, inDays(53), false]
    ]);
    assert.equal(project.schedule.unscheduled, 0);
    assert.deepEqual(await store.startSchedule(id), { error: 'This couple already has a payment schedule.' });

    const balance = project.payments[1];
    await store.updatePayment(balance.id, { paid: true });
    assert.equal((await store.getInquiry(id)).inquiry.paid, 5700, 'received follows the paid lines');
    await store.updatePayment(balance.id, { paid: false });
    assert.equal((await store.getInquiry(id)).inquiry.paid, 1710);

    await store.addPayment(id, { label: 'Album', amount: 700, due_date: inDays(-1) });
    const after = await store.project(id);
    assert.equal(after.schedule.unscheduled, -700, 'a schedule over the agreed price shows');
    assert.equal(after.payments.find((p) => p.label === 'Album').overdue, true);

    const today = await store.today();
    const due = today.needs.filter((n) => n.kind === 'balance').map((n) => n.text);
    assert.deepEqual(due, [`Album, $700, was due ${new Date(`${inDays(-1)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}.`],
      'a couple with a schedule is chased per payment, not for the whole balance');
  });
});

test('the timeline keeps its order, refuses to start twice, and its lines can be undone', async () => {
  await withStore(async (store) => {
    const id = await store.insertInquiry('contact', { names: 'Day Pair' });
    await store.updateInquiry(id, { wedding_date: '2027-07-10' });
    const started = await store.startTimeline(id, '15:30');
    assert.ok(started.timeline.length >= 10);
    assert.deepEqual(started.timeline.map((i) => i.time), [...started.timeline.map((i) => i.time)].sort());
    assert.deepEqual(await store.startTimeline(id, '15:30'), { exists: true });

    const added = await store.addTimelineItem(id, { time: '12:00', title: 'Hair and makeup' }, 'assistant');
    const [entry] = await store.activityFor(id, 1);
    assert.equal(entry.summary, 'Timeline: 12:00 Hair and makeup');
    assert.deepEqual(await store.undoActivity(entry.id), { ok: true });
    assert.ok(!(await store.project(id)).timeline.some((i) => i.id === added.id));
  });
});

test('the couple page API checks its input, and the gallery cover may load from the photo storage', async () => {
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: tempDir() });
  await store.ready();
  const server = createApp({ env: { ADMIN_PASSWORD: PASSWORD, R2_PUBLIC_DOMAIN: 'photos.example.com' }, store }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${origin}/admin/login`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: PASSWORD }).toString()
    });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const page = await fetch(`${origin}/admin`, { headers: { cookie } });
    assert.match(page.headers.get('content-security-policy'), /img-src 'self' data: https:\/\/photos\.example\.com;/);
    const csrf = /<meta name="csrf" content="([^"]+)">/.exec(await page.text())[1];
    const call = (method, url, body) => fetch(`${origin}/admin/api${url}`, {
      method, headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const id = await store.insertInquiry('contact', { names: 'Api Pair' });

    assert.equal((await call('POST', `/inquiries/${id}/timeline`, { title: 'Ceremony', time: '25:00' })).status, 400);
    assert.equal((await call('POST', `/inquiries/${id}/timeline`, { title: ' ', time: '16:00' })).status, 400);
    assert.equal((await call('POST', `/inquiries/${id}/timeline`, { title: 'Ceremony', time: '16:00', place: 'The lawn' })).status, 201);
    assert.equal((await call('POST', `/inquiries/${id}/timeline/start`, { ceremony: '16:00' })).status, 409);
    assert.equal((await call('POST', `/inquiries/${id}/payments`, { label: 'Retainer', amount: -5 })).status, 400);
    assert.equal((await call('POST', `/inquiries/${id}/payments/start`)).status, 409, 'no agreed price yet');
    assert.equal((await call('PUT', `/inquiries/${id}/gallery`, { slug: 'Bad Slug!' })).status, 400);

    const linked = await (await call('PUT', `/inquiries/${id}/gallery`, { slug: 'https://alex-claudio.com/gallery/renee-alan?x=1' })).json();
    assert.equal(linked.gallery_slug, 'renee-alan', 'a pasted link is cut down to the gallery name');
    assert.equal(linked.gallery.found, false, 'without the photo storage the gallery shows as not found');
    const project = await (await call('GET', `/inquiries/${id}/project`)).json();
    assert.deepEqual(project.timeline.map((i) => [i.time, i.title, i.place]), [['16:00', 'Ceremony', 'The lawn']]);
    assert.equal((await call('GET', '/inquiries/999/project')).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
});
