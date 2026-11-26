import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createStore } = require('../server/admin/store');
const { createApp } = require('../server');
const Questionnaire = require('../portal/questions');
const { planFromAnswers } = require('../server/admin/portal');

const PASSWORD = 'correct horse battery staple';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-portal-'));
const FULL = {
  names_full: 'Ana Pop and Iulian Pop', phones: '206 555 0101', getting_ready_1: 'Hotel Andra, room 412',
  ceremony_time: '16:00', ceremony_place: 'Chateau Lill', first_look: 'Yes', family_groups: 'Us with parents\nUs with grandparents'
};

test('answers keep only known questions, each in its own shape', () => {
  const a = Questionnaire.clean({ ceremony_time: '25:00', guests: '120', first_look: 'Maybe', names_full: '  Ana   Pop ', sneaky: 'x' });
  assert.equal(a.ceremony_time, '');
  assert.equal(a.guests, 120);
  assert.equal(a.first_look, '');
  assert.equal(a.names_full, 'Ana Pop');
  assert.ok(!('sneaky' in a));
  assert.deepEqual(Questionnaire.missing(Questionnaire.clean(FULL)), []);
  assert.ok(Questionnaire.missing(Questionnaire.clean({})).includes('ceremony_time'));
});

test('the day is drafted from the answers: places, first look, end of coverage and send-off', () => {
  const plan = planFromAnswers({ ...FULL, first_look: 'No', reception_place: 'The Barn', coverage_end: '22:00', send_off: 'Sparklers', unplugged: 'Yes' }, { sunset: '20:36' });
  const by = (title) => plan.find((item) => item.title === title);
  assert.equal(by('Getting ready and details').place, 'Hotel Andra, room 412');
  assert.equal(by('Ceremony').place, 'Chateau Lill');
  assert.equal(by('Ceremony').note, 'Unplugged ceremony');
  assert.equal(by('Family photos').note, '2 groupings from the questionnaire');
  assert.equal(by('Toasts').place, 'The Barn');
  assert.ok(!plan.some((item) => /^First look/.test(item.title)), 'no first look when they said no');
  assert.equal(by('Portraits of the two of you (during cocktail hour)').time, '17:00');
  assert.equal(by('Sparkler send-off').time, '21:45');
  assert.equal(plan.at(-1).title, 'Coverage ends');
  assert.ok(plan.every((item) => item.time <= '22:00'));
  assert.deepEqual(plan.map((i) => i.time), [...plan.map((i) => i.time)].sort());
  assert.deepEqual(planFromAnswers({ ...FULL, ceremony_time: '' }, null), [], 'no ceremony time, no plan');
});

test('the couple fills in the questionnaire on their page, and sending it drafts the day', async () => {
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: tempDir() });
  await store.ready();
  const server = createApp({ env: { ADMIN_PASSWORD: PASSWORD }, store }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const id = await store.insertInquiry('contact', { names: 'Ana & Iulian', email: 'ana@example.com', event_date: 'June 5, 2027', location: 'Woodinville' });
    await store.updateInquiry(id, { status: 'booked' });
    const login = await fetch(`${origin}/admin/login`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: PASSWORD }).toString()
    });
    const cookie = login.headers.getSetCookie()[0].split(';')[0];
    const csrf = /<meta name="csrf" content="([^"]+)">/.exec(await (await fetch(`${origin}/admin`, { headers: { cookie } })).text())[1];
    const call = (method, url, body) => fetch(`${origin}/admin/api${url}`, {
      method, headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
    });

    const portal = await (await call('GET', `/inquiries/${id}/portal`)).json();
    const token = /\/couple\/([\w-]{32})$/.exec(portal.url)[1];
    assert.equal(portal.viewed_at, null);
    assert.equal(portal.questionnaire, null);
    assert.equal((await call('GET', `/inquiries/${id}/portal`)).status, 200, 'the same link every time');
    assert.equal((await (await call('GET', `/inquiries/${id}/portal`)).json()).url, portal.url);

    const page = await fetch(`${origin}/couple/${token}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    let data = await (await fetch(`${origin}/api/couple/${token}`)).json();
    assert.equal(data.names, 'Ana & Iulian');
    assert.equal(data.wedding_date, '2027-06-05');
    assert.equal(data.inquiry_id, undefined, 'no internal ids on the couple’s page');
    assert.equal(data.gallery, null);
    assert.equal(data.can_pay, false);
    assert.equal(data.questionnaire.status, 'draft');
    assert.ok((await store.getInquiry(id)).activity.some((a) => a.summary === 'Opened their page'));

    const put = (body) => fetch(`${origin}/api/couple/${token}/questionnaire`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await put({ answers: { names_full: 'Ana Pop and Iulian Pop' } })).status, 200, 'a draft saves without every answer');
    let res = await put({ answers: { names_full: 'Ana Pop and Iulian Pop' }, send: true });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).missing.includes('ceremony_time'));
    assert.equal((await put({ answers: 'nope' })).status, 400);

    res = await put({ answers: { ...FULL, coverage_end: '22:00' }, send: true });
    assert.equal(res.status, 200);
    const sent = await res.json();
    assert.equal(sent.status, 'submitted');
    assert.equal(sent.timeline.ok, true);

    data = await (await fetch(`${origin}/api/couple/${token}`)).json();
    assert.equal(data.questionnaire.status, 'submitted');
    assert.equal(data.timeline.find((item) => item.title === 'Ceremony').place, 'Chateau Lill');
    const found = await store.getInquiry(id);
    assert.ok(found.activity.some((a) => a.actor === 'website' && a.summary === 'Sent their questionnaire'));
    assert.equal(found.tasks.find((t) => t.kind === 'questionnaire').done, true, 'the questionnaire task is done');

    // Sending again updates the answers but leaves the timeline Alex may have edited.
    const before = (await store.project(id)).timeline.length;
    res = await put({ answers: { ...FULL, ceremony_time: '17:00' }, send: true });
    assert.equal((await res.json()).timeline.exists, true);
    assert.equal((await store.project(id)).timeline.length, before);
    assert.ok((await store.getInquiry(id)).activity.some((a) => a.summary === 'Updated their questionnaire'));
    assert.equal((await call('POST', `/inquiries/${id}/portal/timeline`)).status, 409);

    // The gallery shows once the wedding is delivered.
    await store.setGallery(id, 'ana-iulian');
    assert.equal((await (await fetch(`${origin}/api/couple/${token}`)).json()).gallery, null);
    await store.updateInquiry(id, { progress: 'delivered' });
    assert.deepEqual((await (await fetch(`${origin}/api/couple/${token}`)).json()).gallery, { url: '/gallery/ana-iulian' });

    assert.equal((await fetch(`${origin}/api/couple/${'x'.repeat(32)}`)).status, 404);
    assert.equal((await fetch(`${origin}/couple/short`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
});
