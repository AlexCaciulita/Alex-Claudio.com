import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createApp } = require('../server');
const { createStore } = require('../server/admin/store');
const { priceList, pricePackage, readChoice } = require('../server/guide');

const PASSWORD = 'correct horse battery staple';
const P = priceList();

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

async function signIn(origin) {
  const response = await fetch(`${origin}/admin/login`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: PASSWORD }).toString()
  });
  assert.equal(response.status, 303);
  const cookie = response.headers.getSetCookie()[0].split(';')[0];
  const page = await fetch(`${origin}/admin`, { headers: { cookie } });
  const csrf = /<meta name="csrf" content="([^"]+)">/.exec(await page.text())[1];
  return { cookie, csrf };
}

test('the server prices every package the way the guide page does', () => {
  // The page's own formula: hours, then the second photographer, engagement session and album.
  const pageTotal = ({ hours, session, album, second }) => P.base + (hours - P.baseHours) * P.perHour
    + (hours >= P.secondFromHours && second ? P.secondPhotographer : 0)
    + (session ? P.session : 0) + (album ? P.albums[album] : 0);
  for (let hours = P.baseHours; hours <= P.maxHours; hours += 1) {
    for (const session of [false, true]) {
      for (const album of ['', ...Object.keys(P.albums)]) {
        for (const second of [true, false]) {
          const { choice, error } = readChoice({ hours, session, album, second });
          assert.equal(error, undefined);
          assert.equal(pricePackage(choice).total, pageTotal({ hours, session, album, second }), JSON.stringify(choice));
        }
      }
    }
  }
  assert.equal(pricePackage(readChoice({ hours: 6 }).choice).collection, 'Essential');
  assert.equal(pricePackage(readChoice({ hours: 8, album: '10' }).choice).collection, 'Signature');
  assert.equal(pricePackage(readChoice({ hours: 10, session: true, album: '12' }).choice).collection, 'Heirloom');
  assert.equal(pricePackage(readChoice({ hours: 8, album: '10', second: true }).choice).collection, '');
  assert.equal(pricePackage(readChoice({ hours: 8, album: '10', second: true }).choice).total, 6700);
  assert.equal(pricePackage(readChoice({ hours: 10, session: true, album: '12', second: true }).choice).total, 8500);
  assert.equal(pricePackage(readChoice({ hours: 7, second: true }).choice).total, 4500, 'no second photographer under eight hours');

  for (const bad of [{}, { hours: 5 }, { hours: 13 }, { hours: 8.5 }, { hours: 8, album: '16' }, { hours: 8, session: 'yes' }, [8]]) {
    assert.ok(readChoice(bad).error, JSON.stringify(bad));
  }
  assert.equal(readChoice({ hours: 8, window: '<script>' }).choice.window, '');
  assert.equal(readChoice({ hours: 8, window: '1 to 9 pm' }).choice.window, '1 to 9 pm');
});

test('more coverage or another extra always costs more, whatever the starting package', () => {
  // Every package the guide can build, then every pair where one gives at least as much as the other.
  const rank = { '': 0, ...Object.fromEntries(Object.keys(P.albums).map((size, index) => [size, index + 1])) };
  const all = [];
  for (let hours = P.baseHours; hours <= P.maxHours; hours += 1) {
    for (const second of hours >= P.secondFromHours ? [false, true] : [false]) {
      for (const session of [false, true]) {
        for (const album of Object.keys(rank)) all.push({ hours, second, session, album, total: pricePackage(readChoice({ hours, second, session, album }).choice).total });
      }
    }
  }
  assert.equal(all.length, 72);
  const overlaps = [];
  for (const a of all) {
    for (const b of all) {
      const asMuch = b.hours >= a.hours && b.second >= a.second && b.session >= a.session && rank[b.album] >= rank[a.album];
      if (a !== b && asMuch && b.total <= a.total) overlaps.push(`${JSON.stringify(b)} costs no more than ${JSON.stringify(a)}`);
    }
  }
  assert.deepEqual(overlaps, []);
});

test('a couple’s guide link sends their package to the inquiry they already sent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-links-'));
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: dir });
  try {
    await store.ready();
    const id = await store.insertInquiry('contact', {
      names: 'Sam and Riley', email: 'sam@example.com', event_date: 'June 5, 2027', location: 'Woodinville', hours: 'eight hours', message: 'Hi Alex!'
    });

    await withSite({ env: { ADMIN_PASSWORD: PASSWORD }, store }, async (origin) => {
      const anonymous = await fetch(`${origin}/admin/api/inquiries/${id}/guide-link`, { method: 'POST' });
      assert.equal(anonymous.status, 401);

      const { cookie, csrf } = await signIn(origin);
      const makeLink = () => fetch(`${origin}/admin/api/inquiries/${id}/guide-link`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf } });
      const first = await (await makeLink()).json();
      assert.match(first.code, /^[A-Za-z0-9_-]{24}$/);
      assert.equal(first.path, `/guide/?for=${first.code}`);
      assert.equal((await (await makeLink()).json()).code, first.code, 'one link per couple');
      const code = first.code;

      const lookup = async (value) => fetch(`${origin}/api/guide/${value}`);
      const couple = await lookup(code);
      assert.equal(couple.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await couple.json(), { names: 'Sam and Riley', sent: false });
      assert.equal((await lookup('A'.repeat(24))).status, 404);
      assert.equal((await lookup('not-a-code')).status, 404);

      const send = (body) => fetch(`${origin}/api/guide/${code}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const sent = await send({ hours: 8, album: '10', session: false, second: false, notes: 'Rehearsal dinner too', window: '1 to 9 pm', total: 1 });
      assert.equal(sent.status, 200);
      assert.deepEqual(await sent.json(), { ok: true, total: 5700, collection: 'Signature' });

      let found = await store.getInquiry(id);
      assert.equal(found.inquiry.names, 'Sam and Riley');
      assert.equal(found.inquiry.message, 'Hi Alex!', 'their first letter is kept');
      assert.equal(found.inquiry.hours, 'eight hours');
      assert.equal(found.inquiry.price, 5700, 'the agreed price follows the package, not the browser');
      assert.match(found.inquiry.fields.package, /^Wedding day, 8 hours: \$5,000\n10 × 10 in leather album: \$700\nEstimated total: \$5,700 \(the Signature collection\)\nCoverage window: 1 to 9 pm\n\nAnything else: Rehearsal dinner too$/);
      assert.match(found.notes[0].body, /^Sent a package from the pricing guide\.\n/);
      assert.ok(found.guide.sent_at);
      assert.deepEqual(await (await lookup(code)).json(), { names: 'Sam and Riley', sent: true });

      // A changed package replaces the last one, and the price follows it while Alex hasn't set one by hand.
      assert.equal((await send({ hours: 10, session: true, album: '12', second: true })).status, 200);
      found = await store.getInquiry(id);
      assert.equal(found.inquiry.price, 8500);
      assert.equal(found.inquiry.hours, 'ten hours');
      assert.match(found.inquiry.fields.package, /Second photographer: \$1,000/);
      assert.equal(found.notes.length, 2);

      await store.updateInquiry(id, { price: 6000 });
      assert.equal((await send({ hours: 8 })).status, 200);
      found = await store.getInquiry(id);
      assert.equal(found.inquiry.price, 6000, 'a price set by hand stays');
      assert.match(found.inquiry.fields.package, /Estimated total: \$5,000/);

      const refused = await send({ hours: 20 });
      assert.equal(refused.status, 400);
      assert.match((await refused.json()).error, /six and twelve hours/);

      assert.equal((await store.listInquiries()).length, 1, 'no second inquiry for the same couple');
    });
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without a database a guide link is simply not found', async () => {
  await withSite({ store: null }, async (origin) => {
    const response = await fetch(`${origin}/api/guide/${'A'.repeat(24)}`);
    assert.equal(response.status, 404);
    const post = await fetch(`${origin}/api/guide/${'A'.repeat(24)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"hours":8}' });
    assert.equal(post.status, 404);
  });
});
