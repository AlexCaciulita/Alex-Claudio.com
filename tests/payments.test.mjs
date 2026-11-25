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
const { createPayments, formEncode } = require('../server/payments');

const WEBHOOK_SECRET = 'whsec_test_secret';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-payments-'));

function png() {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(40, 0); header.writeUInt32BE(10, 4); header[8] = 8; header[9] = 6;
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(crypto.randomBytes(1610))), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

// A stand-in for Stripe's API: Checkout sessions it makes, and their payment status, which a test can set.
function fakeStripe() {
  const sessions = new Map();
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    if (init.method === 'POST' && url.endsWith('/checkout/sessions')) {
      const form = new URLSearchParams(init.body);
      const id = `cs_test_${crypto.randomBytes(8).toString('hex')}`;
      const session = {
        id, url: `https://checkout.stripe.com/c/pay/${id}`, payment_status: 'unpaid',
        amount_total: Number(form.get('line_items[0][price_data][unit_amount]')),
        metadata: { payment_id: form.get('metadata[payment_id]'), inquiry_id: form.get('metadata[inquiry_id]') },
        form
      };
      sessions.set(id, session);
      return { ok: true, status: 200, json: async () => session };
    }
    const match = /\/checkout\/sessions\/(cs_[\w]+)$/.exec(url);
    if (init.method === 'GET' && match && sessions.has(match[1])) return { ok: true, status: 200, json: async () => sessions.get(match[1]) };
    return { ok: false, status: 404, json: async () => ({ error: { message: 'No such session' } }) };
  };
  return { fetch, sessions, requests };
}

async function signedCouple(store, { price = 5700 } = {}) {
  const id = await store.insertInquiry('contact', { names: 'Pay Pair', email: 'pay@example.com', event_date: 'June 5, 2027', location: 'Orcas Island' });
  await store.updateInquiry(id, { status: 'replied', price });
  const contract = await store.createContract(id);
  await store.setPhotographerSignature(png());
  await store.sendContract(contract.id);
  await store.signContract(contract.token, { name: 'Pay Pair', signature: png(), agree: true, address: '1 Lane' });
  return { id, token: contract.token };
}

async function withSite(env, run) {
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: tempDir() });
  await store.ready();
  const stripe = fakeStripe();
  const server = createApp({ env: { ADMIN_PASSWORD: 'correct horse battery staple', ...env }, store, stripeFetch: stripe.fetch }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run({ store, stripe, origin: `http://127.0.0.1:${server.address().port}` });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await store.close();
  }
}

test('Stripe form bodies nest keys the way Stripe reads them', () => {
  assert.equal(formEncode({ line_items: { 0: { price_data: { unit_amount: 171000 } } }, metadata: { payment_id: '4' }, skip: undefined }).toString(),
    'line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=171000&metadata%5Bpayment_id%5D=4');
});

test('signing the contract makes the payment schedule from it', async () => {
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: tempDir() });
  await store.ready();
  try {
    const { id, token } = await signedCouple(store);
    const project = await store.project(id);
    assert.deepEqual(project.payments.map((p) => [p.label, p.amount, p.due_date]), [['Retainer', 1710, project.payments[0].due_date], ['Balance', 3990, '2027-05-29']]);
    const payments = await store.contractPayments(token);
    assert.equal(payments.methods, 'Zelle, Venmo, Check, PayPal, Wire');
    assert.equal(payments.payments.length, 2);
  } finally {
    await store.close();
  }
});

test('without a Stripe key the couple sees their payments but no card button', async () => {
  await withSite({}, async ({ store, origin }) => {
    const { token } = await signedCouple(store);
    const data = await (await fetch(`${origin}/api/contract/${token}`)).json();
    assert.equal(data.payments.can_pay, false);
    assert.equal(data.payments.payments[0].label, 'Retainer');
    assert.equal((await fetch(`${origin}/api/contract/${token}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"payment_id":"1"}' })).status, 404);
  });
});

test('a couple pays the retainer by card: the amount comes from the schedule, and coming back marks it paid and books them', async () => {
  await withSite({ STRIPE_SECRET_KEY: 'sk_test_123', PUBLIC_ORIGIN: 'https://alex-claudio.com' }, async ({ store, stripe, origin }) => {
    const { id, token } = await signedCouple(store);
    let data = await (await fetch(`${origin}/api/contract/${token}`)).json();
    assert.equal(data.payments.can_pay, true);
    const retainer = data.payments.payments.find((p) => p.label === 'Retainer');

    const pay = (body) => fetch(`${origin}/api/contract/${token}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await pay({ payment_id: '999' })).status, 404);
    const res = await pay({ payment_id: retainer.id, amount: 1 });
    assert.equal(res.status, 200);
    const { url } = await res.json();
    assert.match(url, /^https:\/\/checkout\.stripe\.com\//);
    const [session] = stripe.sessions.values();
    assert.equal(session.amount_total, 171000, 'the amount is the scheduled one, whatever the browser sent');
    assert.equal(session.form.get('success_url'), `https://alex-claudio.com/contract/${token}?session={CHECKOUT_SESSION_ID}`);
    assert.equal(session.form.get('customer_email'), 'pay@example.com');
    assert.equal(stripe.requests[0].init.headers.Authorization, 'Bearer sk_test_123');

    // Back from Checkout before paying: nothing changes.
    await fetch(`${origin}/api/contract/${token}?session=${session.id}`);
    assert.equal((await store.getInquiry(id)).inquiry.paid, null);

    session.payment_status = 'paid';
    data = await (await fetch(`${origin}/api/contract/${token}?session=${session.id}`)).json();
    assert.equal(data.payments.payments.find((p) => p.label === 'Retainer').paid, true);
    assert.equal(data.payments.payments.find((p) => p.label === 'Retainer').method, 'card');
    const { inquiry, activity } = await store.getInquiry(id);
    assert.equal(inquiry.paid, 1710);
    assert.equal(inquiry.stage, 'booked', 'signed and paid means booked');
    assert.ok(activity.some((a) => a.summary === 'Paid Retainer by card, $1,710'));
    assert.equal((await pay({ payment_id: retainer.id })).status, 409, 'a paid payment can’t be paid twice');
    assert.ok((await store.tasksFor(id)).some((t) => t.kind === 'gallery'), 'booking made the wedding’s tasks');
  });
});

test('the Stripe webhook is believed only with a valid signature, and a wrong amount is flagged, not paid', async () => {
  await withSite({ STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }, async ({ store, origin }) => {
    const { id, token } = await signedCouple(store);
    const [retainer, balance] = (await store.contractPayments(token)).payments;
    const send = (event, { secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000) } = {}) => {
      const body = JSON.stringify(event);
      const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
      return fetch(`${origin}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body });
    };
    const completed = (paymentId, amount) => ({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_webhook_1', payment_status: 'paid', amount_total: amount, metadata: { payment_id: paymentId } } }
    });

    assert.equal((await send(completed(retainer.id, 171000), { secret: 'whsec_wrong' })).status, 400);
    assert.equal((await send(completed(retainer.id, 171000), { t: Math.floor(Date.now() / 1000) - 3600 })).status, 400, 'an old signature is refused');
    assert.equal((await store.getInquiry(id)).inquiry.paid, null);

    assert.equal((await send(completed(balance.id, 100))).status, 200);
    let found = await store.getInquiry(id);
    assert.equal(found.inquiry.paid, null, 'a wrong amount isn’t counted');
    assert.ok(found.activity.some((a) => /didn't match Balance/.test(a.summary)));

    assert.equal((await send(completed(retainer.id, 171000))).status, 200);
    assert.equal((await send(completed(retainer.id, 171000))).status, 200, 'the same event twice is fine');
    found = await store.getInquiry(id);
    assert.equal(found.inquiry.paid, 1710);
    assert.equal(found.activity.filter((a) => a.summary === 'Paid Retainer by card, $1,710').length, 1);
  });
});

test('payments know test keys from live ones', () => {
  assert.equal(createPayments({ env: {} }).enabled, false);
  assert.equal(createPayments({ env: { STRIPE_SECRET_KEY: 'sk_test_x' } }).mode, 'test');
  assert.equal(createPayments({ env: { STRIPE_SECRET_KEY: 'sk_live_x' } }).mode, 'live');
});
