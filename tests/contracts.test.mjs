import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { createStore } = require('../server/admin/store');
const { createApp } = require('../server');
const ContractDoc = require('../contract/contract-doc');
const { validSignature } = require('../server/admin/contracts');

const PASSWORD = 'correct horse battery staple';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-contracts-'));

// A real (tiny, blank) PNG, as a drawn signature would arrive.
function png() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(40, 0); header.writeUInt32BE(10, 4); header[8] = 8; header[9] = 6;
  const rows = crypto.randomBytes((40 * 4 + 1) * 10);
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

test('the agreement fills in its fields, works out the totals, and leaves blanks visible', () => {
  const fields = { client_name: 'Ana & Iulian', event_date: '2027-06-05', package_price: 5000, add_ons: 700, retainer: 1710, balance_days: 7 };
  const words = ContractDoc.words(fields);
  assert.equal(words.total, '$5,700.00');
  assert.equal(words.balance, '$3,990.00');
  assert.equal(words.balance_due, 'May 29, 2027');
  const text = ContractDoc.text(fields);
  assert.match(text, /total fee stated in Schedule A \(\$5,700\.00\)/);
  assert.match(text, /non-refundable retainer of \$1,710\.00 is due upon signing/);
  assert.match(text, /Address: _{10,}/, 'an empty field prints as a blank line');
  assert.deepEqual(ContractDoc.missing(fields), ['client_email', 'event_locations']);
  assert.deepEqual(ContractDoc.clean({ package_price: '-5', online_gallery: 'maybe', sneaky: 'x' }).package_price, 0);
  assert.equal(ContractDoc.clean({ online_gallery: 'maybe' }).online_gallery, 'Yes');
  assert.ok(!('sneaky' in ContractDoc.clean({ sneaky: 'x' })), 'unknown fields are dropped');
});

test('only a real PNG is accepted as a signature', () => {
  assert.equal(validSignature(png()), true);
  assert.equal(validSignature('data:image/png;base64,AAAA'), false);
  assert.equal(validSignature(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`), false);
  assert.equal(validSignature(`data:image/png;base64,${'A'.repeat(500000)}`), false);
});

test('a contract is drafted from the couple, signed by Alex, then signed once by the couple on their link', async () => {
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: tempDir() });
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

    const id = await store.insertInquiry('contact', { names: 'Ana & Iulian', email: 'ana@example.com', phone: '206 555 0101', event_date: 'June 5, 2027', location: 'Orcas Island', hours: '8 hours' });
    await store.updateInquiry(id, { price: 5700 });

    let { contract } = await (await call('POST', `/inquiries/${id}/contracts`)).json();
    assert.equal(contract.status, 'draft');
    assert.equal(contract.fields.client_name, 'Ana & Iulian');
    assert.equal(contract.fields.event_date, '2027-06-05');
    assert.equal(contract.fields.coverage_hours, 8);
    assert.equal(contract.fields.package_price, 5700);
    assert.equal(contract.fields.retainer, 1710, 'the retainer starts at 30%');

    // The link does nothing until Alex signs and sends.
    assert.equal((await fetch(`${origin}/api/contract/${contract.token}`)).status, 404);
    let res = await call('POST', `/contracts/${contract.id}/send`);
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /signature/);
    assert.equal((await call('PUT', '/signature', { signature: 'data:image/png;base64,AAAA' })).status, 400);
    assert.equal((await call('PUT', '/signature', { signature: png() })).status, 200);

    ({ contract } = await (await call('PATCH', `/contracts/${contract.id}`, { fields: { ...contract.fields, package_price: 5000, add_ons: 700, event_locations: 'Rosario Resort, Orcas Island' } })).json());
    assert.equal(contract.fields.add_ons, 700);
    ({ contract } = await (await call('POST', `/contracts/${contract.id}/send`)).json());
    assert.equal(contract.status, 'sent');
    assert.ok(contract.photographer.signature);
    assert.equal((await call('PATCH', `/contracts/${contract.id}`, { fields: contract.fields })).status, 409, 'a sent contract is locked');

    // The couple's page.
    const page = await fetch(`${origin}/contract/${contract.token}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'/);
    const opened = await (await fetch(`${origin}/api/contract/${contract.token}`)).json();
    assert.equal(opened.contract.status, 'sent');
    assert.deepEqual(opened.contract.can_fill, ['client_address']);
    assert.equal(opened.contract.token, undefined);
    assert.equal(opened.contract.client.ip, undefined, 'the couple never sees audit details');

    const sign = (body) => fetch(`${origin}/api/contract/${contract.token}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'test-browser' }, body: JSON.stringify(body) });
    assert.equal((await sign({ name: 'Ana Pop', signature: png() })).status, 400, 'agreeing to sign electronically is required');
    assert.equal((await sign({ name: 'A', signature: png(), agree: true })).status, 400);
    assert.equal((await sign({ name: 'Ana Pop', signature: 'nope', agree: true })).status, 400);
    res = await sign({ name: 'Ana Pop', signature: png(), agree: true, address: '1 Ferry Lane, Eastsound, WA', phone: 'ignored, it was filled' });
    assert.equal(res.status, 200);
    const { document_hash: hash } = await res.json();
    assert.equal((await sign({ name: 'Someone Else', signature: png(), agree: true })).status, 409, 'signed once only');

    const signed = (await (await call('GET', `/contracts/${contract.id}`)).json()).contract;
    assert.equal(signed.status, 'signed');
    assert.equal(signed.client.name, 'Ana Pop');
    assert.equal(signed.client.agent, 'test-browser');
    assert.equal(signed.fields.client_address, '1 Ferry Lane, Eastsound, WA');
    assert.equal(signed.fields.client_phone, '206 555 0101');
    assert.equal(hash, crypto.createHash('sha256').update(ContractDoc.text(signed.fields)).digest('hex'), 'the fingerprint is of the signed words');
    assert.equal((await call('POST', `/contracts/${contract.id}/take-back`)).status, 409);
    assert.equal((await call('DELETE', `/contracts/${contract.id}`)).status, 409, 'a signed contract is kept');

    const { activity } = await store.getInquiry(id);
    assert.ok(activity.some((a) => a.actor === 'website' && a.summary === 'Ana Pop signed the contract'));
    assert.ok(activity.some((a) => a.actor === 'website' && a.summary === 'Opened the contract'));
    assert.equal((await fetch(`${origin}/api/contract/${'x'.repeat(32)}`)).status, 404);
    assert.equal((await fetch(`${origin}/contract/short`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
});

test('a sent contract can be taken back, changed and sent again, and Today lists it until signed', async () => {
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: tempDir() });
  await store.ready();
  try {
    const id = await store.insertInquiry('contact', { names: 'Back Pair', email: 'b@example.com', event_date: 'June 5, 2027', location: 'Seattle' });
    const contract = await store.createContract(id);
    await store.setPhotographerSignature(png());
    assert.equal((await store.sendContract(contract.id)).status, 'sent');
    assert.equal((await store.contractsWaiting()).length, 1);
    const back = await store.takeBackContract(contract.id);
    assert.equal(back.status, 'draft');
    assert.equal(back.photographer.signature, null);
    assert.equal(await store.contractForClient(contract.token), null, 'the link stops working while it is a draft');
    assert.equal((await store.saveContract(contract.id, { ...back.fields, travel_fee: 150 })).fields.travel_fee, 150);
  } finally {
    await store.close();
  }
});
