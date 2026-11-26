import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createStore } = require('../server/admin/store');
const { createApp } = require('../server');
const { compose, createMailer, runReminders, greeting } = require('../server/admin/reminders');
const { localDay } = require('../server/admin/analytics');
const { addDays } = require('../server/admin/work');

const PASSWORD = 'correct horse battery staple';
const ZONE = 'America/Los_Angeles';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-reminders-'));
// 10 AM in Seattle, so the morning send window is open.
const MORNING = new Date(`${localDay(ZONE)}T18:00:00Z`);

function fakeMailer() {
  const sent = [];
  return { ready: true, from: 'Alex <alex@alex-claudio.com>', sent, async send(email) { sent.push(email); return true; } };
}

async function setup() {
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: tempDir() });
  await store.ready();
  return store;
}

test('the sender has to be on the studio’s own domain', () => {
  assert.equal(createMailer({ env: {} }).ready, false);
  assert.match(createMailer({ env: { RESEND_API_KEY: 'k' } }).reason, /STUDIO_FROM_EMAIL/);
  assert.match(createMailer({ env: { RESEND_API_KEY: 'k', CONTACT_FROM_EMAIL: 'Site <onboarding@resend.dev>' } }).reason, /test address/);
  assert.equal(createMailer({ env: { RESEND_API_KEY: 'k', STUDIO_FROM_EMAIL: 'Alex <alex@alex-claudio.com>' } }).ready, true);
});

test('emails greet the couple by first name and link to their page', () => {
  assert.equal(greeting('Ana Pop & Iulian Pop'), 'Hi Ana and Iulian');
  assert.equal(greeting('Sam'), 'Hi Sam');
  assert.equal(greeting(''), 'Hi there');
  const email = compose({ kind: 'questionnaire', names: 'Ana & Iulian', days_to_wedding: 56, portal_token: 'abc' }, { origin: 'https://alex-claudio.com' });
  assert.match(email.text, /^Hi Ana and Iulian,/);
  assert.match(email.text, /eight weeks away/);
  assert.match(email.text, /https:\/\/alex-claudio\.com\/couple\/abc/);
  assert.match(email.html, /<a href="https:\/\/alex-claudio\.com\/couple\/abc"/);
  const pay = compose({ kind: 'payment', names: 'Ana', payment_label: 'Balance', amount_cents: 350000, due_date: '2027-05-29', portal_token: 'abc' }, { origin: 'https://x.test', canPay: true });
  assert.match(pay.subject, /^Your balance is due May 29$/);
  assert.match(pay.text, /\$3,500 is due on Saturday, May 29\. You can pay by card on your page:/);
  assert.match(compose({ kind: 'gallery', names: 'Ana', gallery_slug: 'ana-iulian' }, { origin: 'https://x.test' }).text, /https:\/\/x\.test\/gallery\/ana-iulian/);
});

test('reminders go out once, on their day, and never late or at night', async () => {
  const store = await setup();
  try {
    const day = localDay(ZONE);
    // Questionnaire due today (wedding in 56 days), and a second couple whose day was 10 days ago (too late).
    const ana = await store.insertInquiry('contact', { names: 'Ana & Iulian', email: 'ana@example.com' });
    await store.updateInquiry(ana, { status: 'booked', wedding_date: addDays(day, 56) });
    const late = await store.insertInquiry('contact', { names: 'Late Couple', email: 'late@example.com' });
    await store.updateInquiry(late, { status: 'booked', wedding_date: addDays(day, 46) });
    // A payment due in 10 days, and one due in 20 (next week's list, not today's).
    const bo = await store.insertInquiry('contact', { names: 'Bo', email: 'bo@example.com' });
    await store.updateInquiry(bo, { status: 'booked', progress: 'editing', wedding_date: addDays(day, -5) });
    await store.addPayment(bo, { label: 'Balance', amount: 3500, due_date: addDays(day, 10) });
    await store.addPayment(bo, { label: 'Album', amount: 400, due_date: addDays(day, 14) });
    // A gallery delivered before reminders started gets no email; one delivered after does.
    const old = await store.insertInquiry('contact', { names: 'Old Gallery', email: 'old@example.com' });
    await store.updateInquiry(old, { status: 'booked', progress: 'delivered', wedding_date: addDays(day, -90) });
    await store.setGallery(old, 'old-gallery');

    let list = await store.reminders();
    assert.deepEqual(list.due.map((r) => [r.names, r.kind]).sort(), [['Ana & Iulian', 'questionnaire'], ['Bo', 'payment']]);
    assert.deepEqual(list.upcoming.map((r) => r.payment_label), ['Album']);
    assert.ok(!list.due.some((r) => r.names === 'Late Couple'), 'a reminder more than 3 days late is dropped');

    const mailer = fakeMailer();
    const night = new Date(`${day}T08:00:00Z`); // midnight in Seattle
    assert.equal((await runReminders({ store, mailer, origin: 'https://x.test', now: night })).sent, 0);
    await store.setRemindersPaused(true);
    assert.equal((await runReminders({ store, mailer, origin: 'https://x.test', now: MORNING })).reason, 'Paused');
    await store.setRemindersPaused(false);

    const result = await runReminders({ store, mailer, origin: 'https://x.test', now: MORNING });
    assert.equal(result.sent, 2);
    assert.deepEqual(mailer.sent.map((m) => m.to).sort(), ['ana@example.com', 'bo@example.com']);
    assert.match(mailer.sent.find((m) => m.to === 'ana@example.com').text, /\/couple\/[\w-]{32}/, 'the couple got a page link');
    const found = await store.getInquiry(ana);
    assert.ok(found.activity.some((a) => a.actor === 'reminders' && /questionnaire reminder/.test(a.summary)));
    assert.equal(found.tasks.find((t) => t.kind === 'questionnaire').done, true, 'sending it ticks the questionnaire task');

    assert.equal((await runReminders({ store, mailer, origin: 'https://x.test', now: MORNING })).sent, 0, 'never twice');

    // Delivered now, with a gallery: the gallery email goes out.
    const cy = await store.insertInquiry('contact', { names: 'Cy & Di', email: 'cy@example.com' });
    await store.updateInquiry(cy, { status: 'booked', progress: 'delivered', wedding_date: addDays(day, -40) });
    await store.setGallery(cy, 'cy-and-di');
    await runReminders({ store, mailer, origin: 'https://x.test', now: MORNING });
    assert.deepEqual(mailer.sent.slice(2).map((m) => [m.to, m.subject]), [['cy@example.com', 'Your wedding gallery is ready']]);

    // A failed send is retried, up to three times, then waits on Today.
    const failing = { ready: true, from: 'x', async send() { throw new Error('Resend 500'); } };
    await store.addPayment(cy, { label: 'Prints', amount: 90, due_date: addDays(day, 9) });
    for (let i = 0; i < 4; i += 1) await runReminders({ store, mailer: failing, origin: 'https://x.test', now: MORNING });
    list = await store.reminders();
    assert.equal(list.failed.length, 1);
    assert.match(list.failed[0].error, /Resend 500/);
    assert.equal(list.due.length, 0);
  } finally {
    await store.close();
  }
});

test('the Today panel lists reminders with their email, and each can be sent, marked sent or skipped', async () => {
  const store = await setup();
  const mailer = fakeMailer();
  const server = createApp({ env: { ADMIN_PASSWORD: PASSWORD, PUBLIC_ORIGIN: 'https://alex-claudio.com' }, store, mailer }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const day = localDay(ZONE);
    const ana = await store.insertInquiry('contact', { names: 'Ana & Iulian', email: 'ana@example.com' });
    await store.updateInquiry(ana, { status: 'booked', wedding_date: addDays(day, 56) });
    const bo = await store.insertInquiry('contact', { names: 'Bo', email: 'bo@example.com' });
    await store.updateInquiry(bo, { status: 'booked', wedding_date: addDays(day, 35) });

    const login = await fetch(`${origin}/admin/login`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: PASSWORD }).toString()
    });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const csrf = /<meta name="csrf" content="([^"]+)">/.exec(await (await fetch(`${origin}/admin`, { headers: { cookie } })).text())[1];
    const call = (method, url, body) => fetch(`${origin}/admin/api${url}`, {
      method, headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
    });

    let data = await (await call('GET', '/reminders')).json();
    assert.equal(data.sending.ready, true);
    assert.equal(data.due.length, 2);
    const first = data.due.find((r) => r.kind === 'questionnaire');
    assert.match(first.email_preview.text, /https:\/\/alex-claudio\.com\/couple\/[\w-]{32}/);
    assert.equal(first.portal_token, undefined);
    assert.equal(data.due.find((r) => r.inquiry_id === bo).kind, 'questionnaire_again');

    assert.equal((await call('POST', '/reminders/send', { inquiry_id: ana, kind: 'questionnaire', ref: '' })).status, 200);
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0].to, 'ana@example.com');
    assert.equal((await call('POST', '/reminders/send', { inquiry_id: ana, kind: 'questionnaire', ref: '' })).status, 404, 'gone once sent');
    assert.equal((await call('POST', '/reminders/skip', { inquiry_id: bo, kind: 'questionnaire_again', ref: '' })).status, 200);
    assert.equal((await call('POST', '/reminders/skip', { inquiry_id: bo, kind: 'nope', ref: '' })).status, 400);
    assert.equal((await call('POST', '/reminders/explode', {})).status, 404);
    data = await (await call('GET', '/reminders')).json();
    assert.equal(data.due.length, 0);
    assert.equal(data.recent.length, 1);
    assert.ok((await store.getInquiry(bo)).activity.some((a) => a.summary === 'Skipped the second questionnaire reminder'));

    assert.equal((await call('PUT', '/reminders/settings', { paused: true })).status, 200);
    assert.equal((await (await call('GET', '/reminders')).json()).paused, true);
    assert.equal((await call('PUT', '/reminders/settings', { paused: 'yes' })).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
});

test('without a sender on the studio’s domain, a reminder can be marked sent by hand', async () => {
  const store = await setup();
  const server = createApp({ env: { ADMIN_PASSWORD: PASSWORD }, store }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const ana = await store.insertInquiry('contact', { names: 'Ana', email: 'ana@example.com' });
    await store.updateInquiry(ana, { status: 'booked', wedding_date: addDays(localDay(ZONE), 56) });
    const login = await fetch(`${origin}/admin/login`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: PASSWORD }).toString()
    });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const csrf = /<meta name="csrf" content="([^"]+)">/.exec(await (await fetch(`${origin}/admin`, { headers: { cookie } })).text())[1];
    const call = (method, url, body) => fetch(`${origin}/admin/api${url}`, {
      method, headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await (await call('GET', '/reminders')).json();
    assert.equal(data.sending.ready, false);
    assert.equal((await call('POST', '/reminders/send', { inquiry_id: ana, kind: 'questionnaire', ref: '' })).status, 409);
    assert.equal((await call('POST', '/reminders/sent', { inquiry_id: ana, kind: 'questionnaire', ref: '' })).status, 200);
    const found = await store.getInquiry(ana);
    assert.ok(found.activity.some((a) => a.actor === 'you' && a.summary === 'Sent the questionnaire reminder by hand'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
});
