import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createStore, fromEarlierWedding } = require('../server/admin/store');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
const digest = (file) => (fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null);
const digests = (file) => [file, `${file}-wal`, `${file}-shm`].map(digest);

// The earlier dashboard's layout (the tables that matter), in WAL mode like the file on the volume.
// The connection stays open, so most of the data sits in the -wal file, as it does on the server.
function earlierDashboard(dir) {
  const file = path.join(dir, 'admin.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE weddings (id TEXT PRIMARY KEY, partner1 TEXT, partner2 TEXT, email TEXT, phone TEXT, date TEXT, start_time TEXT, end_time TEXT,
      timezone TEXT, location TEXT, collection TEXT, price INTEGER, currency TEXT, deposit INTEGER, deposit_status TEXT, balance INTEGER,
      balance_date TEXT, source TEXT, tags TEXT, status TEXT, archived INTEGER, version INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE notes (id TEXT PRIMARY KEY, wedding_id TEXT, body TEXT, author TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, password TEXT, role TEXT, created_at TEXT);
    CREATE TABLE sessions (sid TEXT PRIMARY KEY, data TEXT, expires INTEGER);
    CREATE TABLE analytics (id TEXT PRIMARY KEY, occurred_at TEXT, path TEXT);`);
  const wedding = db.prepare('INSERT INTO weddings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  wedding.run('w1', 'Ana', 'Iulian', 'ana@example.com', '206 555 0101', '2027-07-10', '', '', 'America/Los_Angeles', 'Orcas Island', '',
    470000, 'USD', 100000, 'paid', 0, '', 'Instagram', 'referral, ferry', 'booked', 0, 2, '2026-09-18T00:45:31.590Z', '2026-09-18T00:46:00.000Z');
  wedding.run('w2', 'Maria', '', 'maria@example.com', '', '2026-05-01', '', '', 'America/Los_Angeles', '', 'Premium \u2014 8 hours, 2 photographers',
    250000, 'USD', 0, 'paid', 0, '', 'Wedding show', '', 'delivered', 0, 2, '2026-09-18T00:46:31.590Z', '2026-09-18T00:47:00.000Z');
  wedding.run('w3', 'Dana', 'Sam', '', '', '2026-10-03', '14:00', '18:00', 'America/Los_Angeles', 'Kirkland', '4 hours wedding photography',
    220000, 'USD', 50000, 'unpaid', 0, '2026-09-26', '', '', 'editing', 0, 1, 'not a date', null);
  const note = db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?)');
  note.run('n1', 'w1', 'Called them; they love the ferry.', 'alex@alex-claudio.com', '2026-09-18T00:47:00.000Z', '2026-09-18T00:47:00.000Z');
  note.run('n2', 'w2', 'Album delivered.', 'alex@alex-claudio.com', '2026-09-18T00:48:00.000Z', '2026-09-18T00:48:00.000Z');
  note.run('n3', 'w2', '   ', 'alex@alex-claudio.com', '2026-09-18T00:49:00.000Z', '2026-09-18T00:49:00.000Z');
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run('u1', 'alex@alex-claudio.com', '$argon2id$v=19$m=65536$SHOULD-NEVER-SHOW', 'owner', '2026-09-17T22:04:23.987Z');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('sid-should-never-show', '{"user":"u1"}', 0);
  const visit = db.prepare('INSERT INTO analytics VALUES (?, ?, ?)');
  for (let n = 0; n < 60; n += 1) visit.run(`a${n}`, new Date(Date.UTC(2026, 8, 18) + n * 3600000).toISOString(), '/');
  return { file, db };
}

test('without a volume or a file location there is nowhere to save', () => {
  assert.equal(createStore({}), null);
  assert.equal(createStore({ DATABASE_PATH: '/data/admin.sqlite' }), null);
});

test('inquiries, notes and money are kept in SQLite on the volume', async () => {
  const dir = tempDir();
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: dir });
  try {
    await store.ready();
    assert.ok(fs.existsSync(path.join(dir, 'studio.sqlite')), 'the file sits on the volume');

    const id = await store.insertInquiry('contact', {
      'form-name': 'contact', company: '', names: 'Ana & Iulian', email: 'ana@example.com', event_date: 'Saturday, June 12th, 2027',
      location: 'Orcas Island', hours: 'eight hours', care: 'The ferry ride', budget: '5k'
    });
    const { inquiry, notes } = await store.getInquiry(id);
    assert.equal(inquiry.wedding_date, '2027-06-12');
    assert.equal(inquiry.hours, 'eight hours');
    assert.equal(inquiry.care, 'The ferry ride');
    assert.equal(inquiry.status, 'new');
    assert.equal(inquiry.price, null);
    assert.equal(inquiry.fields.budget, '5k');
    assert.equal(inquiry.fields['form-name'], undefined);
    assert.equal(inquiry.fields.company, undefined);
    assert.match(inquiry.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(notes, []);

    const lead = await store.insertInquiry('wedding-show-lead', { 'form-name': 'wedding-show-lead', name: 'Show Lead', email: 'lead@example.com', source: 'Wedding Show | January 31, 2026' });
    assert.equal((await store.getInquiry(lead)).inquiry.names, 'Show Lead');

    const thisYear = new Date().getFullYear();
    const manual = await store.createInquiry({ names: '100% _real_ couple\\', email: '', wedding_date: '2027-06-20', status: 'booked', price: 4000, paid: 1000.5 });
    assert.equal(manual.form_name, 'manual');
    assert.equal(manual.price, 4000);
    assert.equal(manual.paid, 1000.5);

    const count = async (filter) => (await store.listInquiries(filter)).length;
    assert.equal(await count({ q: '100%' }), 1);
    assert.equal(await count({ q: '_real_' }), 1);
    assert.equal(await count({ q: '\\' }), 1);
    assert.equal(await count({ q: '%' }), 1, 'a % search matches only a literal %');
    assert.equal(await count({ q: 'ORCAS' }), 1, 'search ignores case');
    assert.equal(await count({ status: 'booked' }), 1);
    assert.equal(await count({}), 3);

    const note = await store.addNote(id, 'Called them');
    assert.match(note.id, /^\d+$/);
    assert.equal(await store.addNote('999999', 'nobody'), null);
    assert.equal((await store.listInquiries({ q: 'Ana' }))[0].note_count, 1);

    const updated = await store.updateInquiry(id, { status: 'booked', price: 4800, paid: null, wedding_date: `${thisYear}-12-30` });
    assert.equal(updated.status, 'booked');
    assert.equal(updated.price, 4800);
    assert.equal(updated.paid, null);
    assert.equal(await store.updateInquiry('999999', { status: 'booked' }), null);
    await assert.rejects(store.updateInquiry(id, { price: -1 }), /CHECK constraint/);
    await assert.rejects(store.updateInquiry(id, { status: 'maybe' }), /CHECK constraint/);

    const stats = await store.stats();
    assert.equal(stats.total, 3);
    assert.equal(stats.booked, 2);
    assert.equal(stats.new, 1);
    assert.equal(stats.upcoming, 2);
    assert.equal(stats.year, thisYear);
    assert.equal(stats.year_agreed, 4800);
    assert.equal(stats.year_paid, 0);

    assert.deepEqual((await store.calendar('2027-06-01', '2027-06-30')).map((w) => w.names), ['100% _real_ couple\\']);
    await store.updateInquiry(manual.id, { status: 'not_booked' });
    assert.deepEqual(await store.calendar('2027-06-01', '2027-06-30'), [], 'weddings that did not book leave the calendar');

    assert.equal(await store.deleteInquiry(id), true);
    assert.equal(await store.deleteInquiry(id), false);
    assert.equal(await store.deleteNote(note.id), false, 'notes go with their inquiry');
    assert.equal(await store.getInquiry(id), null);
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the earlier dashboard is copied in once, and its file is never changed', async () => {
  const dir = tempDir();
  const earlier = earlierDashboard(dir);
  const before = digests(earlier.file);
  assert.ok(before[1], 'the stand-in keeps its data in a -wal file');
  const env = { STUDIO_DB_PATH: path.join(dir, 'studio.sqlite'), DATABASE_PATH: earlier.file };
  let store = createStore(env);
  try {
    assert.deepEqual(await store.ready(), { imported: 3 });
    const list = await store.listInquiries({});
    assert.equal(list.length, 3);
    assert.ok(list.every((inquiry) => inquiry.form_name === 'earlier-dashboard'));
    const byName = Object.fromEntries(list.map((inquiry) => [inquiry.names, inquiry]));

    const ana = await store.getInquiry(byName['Ana & Iulian'].id);
    assert.equal(ana.inquiry.status, 'booked');
    assert.equal(ana.inquiry.wedding_date, '2027-07-10');
    assert.equal(ana.inquiry.price, 4700);
    assert.equal(ana.inquiry.paid, 1000);
    assert.equal(ana.inquiry.location, 'Orcas Island');
    assert.equal(ana.inquiry.source, 'Instagram');
    assert.equal(ana.inquiry.created_at, '2026-09-18T00:45:31.590Z');
    assert.deepEqual(ana.inquiry.fields, { 'Stage in the earlier dashboard': 'Booked', Deposit: '$1,000 (paid)', Tags: 'referral, ferry' });
    assert.deepEqual(ana.notes.map((n) => [n.body, n.created_at]), [['Called them; they love the ferry.', '2026-09-18T00:47:00.000Z']]);

    const maria = await store.getInquiry(byName.Maria.id);
    assert.equal(maria.inquiry.status, 'booked');
    assert.equal(maria.inquiry.hours, 'Premium \u2014 8 hours, 2 photographers');
    assert.equal(maria.inquiry.paid, null, 'only a paid deposit counts as received');
    assert.equal(maria.inquiry.fields['Stage in the earlier dashboard'], 'Delivered');
    assert.deepEqual(maria.notes.map((n) => n.body), ['Album delivered.'], 'empty notes are skipped');

    const dana = await store.getInquiry(byName['Dana & Sam'].id);
    assert.equal(dana.inquiry.paid, null);
    assert.equal(dana.inquiry.fields.Deposit, '$500 (unpaid)');
    assert.equal(dana.inquiry.fields.Time, '14:00\u201318:00 (America/Los_Angeles)');
    assert.equal(dana.inquiry.fields['Balance due'], '2026-09-26');
    assert.match(dana.inquiry.created_at, /^\d{4}-\d{2}-\d{2}T/, 'a missing date becomes the time of the copy');

    const tables = await store.legacyTables();
    assert.deepEqual(tables.map((t) => t.name), ['analytics', 'notes', 'users', 'weddings'], 'sign-in sessions are never listed');
    assert.ok(tables.every((t) => t.schema === 'main'));
    assert.deepEqual(tables.find((t) => t.name === 'users').hidden, ['password']);
    assert.equal(tables.find((t) => t.name === 'analytics').rows, 60);
    const users = await store.legacyRows('main', 'users', 0);
    assert.ok(!JSON.stringify(users).includes('argon2'), 'password hashes never leave the store');
    assert.deepEqual(users.columns.map((c) => c.name), ['id', 'email', 'role', 'created_at']);
    const visits = await store.legacyRows('main', 'analytics', 1);
    assert.equal(visits.orderedBy, 'occurred_at');
    assert.equal(visits.rows.length, 10);
    assert.equal(visits.total, 60);
    for (const [schema, name] of [['main', 'sessions'], ['public', 'users'], ['main', 'nope'], ['main', 'users"; DROP TABLE users; --']]) {
      assert.equal(await store.legacyRows(schema, name, 0), null, `${schema}.${name}`);
    }

    const ping = await store.ping();
    assert.equal(ping.connected, true);
    assert.equal(ping.engine, 'SQLite');
    assert.deepEqual(ping.earlier, { file: earlier.file, found: true, imported: 3 });

    await store.deleteInquiry(byName.Maria.id);
    await store.close();
    store = createStore(env);
    assert.deepEqual(await store.ready(), { imported: 0 }, 'a restart copies nothing twice, and a deleted wedding stays deleted');
    assert.equal((await store.listInquiries({})).length, 2);
  } finally {
    await store.close();
    assert.deepEqual(digests(earlier.file), before, 'the earlier dashboard\u2019s files are byte-for-byte unchanged');
    earlier.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the dashboard refuses to use the earlier dashboard\u2019s own file', async () => {
  const dir = tempDir();
  const earlier = earlierDashboard(dir);
  const before = digests(earlier.file);
  const store = createStore({ STUDIO_DB_PATH: earlier.file, DATABASE_PATH: earlier.file });
  try {
    await assert.rejects(store.ready(), /must not point at the earlier dashboard/);
    assert.equal((await store.ping()).connected, false);
  } finally {
    await store.close();
    assert.deepEqual(digests(earlier.file), before);
    earlier.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a copy is kept every day, the newest 30 stay, and a full copy can be downloaded', async () => {
  const dir = tempDir();
  const store = createStore({ RAILWAY_VOLUME_MOUNT_PATH: dir });
  try {
    await store.ready();
    const folder = path.join(dir, 'backups', 'studio');
    const first = fs.readdirSync(folder);
    assert.equal(first.length, 1);
    assert.match(first[0], /^studio-\d{4}-\d{2}-\d{2}\.sqlite$/);
    assert.equal(await store.backupToday(), null, 'one copy a day');

    for (let day = 1; day <= 35; day += 1) fs.writeFileSync(path.join(folder, `studio-2020-01-${String(day).padStart(2, '0')}.sqlite`), 'old');
    fs.rmSync(path.join(folder, first[0]));
    await store.insertInquiry('contact', { names: 'Backup Couple', email: 'b@example.com', event_date: 'June 1, 2027' });
    const made = await store.backupToday();
    const kept = fs.readdirSync(folder).sort();
    assert.equal(kept.length, 30);
    assert.equal(kept[kept.length - 1], first[0], 'today\u2019s copy is kept');
    assert.ok(!kept.includes('studio-2020-01-01.sqlite'), 'the oldest copies go first');
    const copy = new DatabaseSync(made);
    assert.equal(copy.prepare('SELECT names FROM inquiries').get().names, 'Backup Couple', 'the daily copy is complete');
    copy.close();

    const download = await store.snapshot();
    const snapshot = new DatabaseSync(download);
    assert.equal(snapshot.prepare('SELECT count(*) AS n FROM inquiries').get().n, 1);
    snapshot.close();
    fs.rmSync(download);

    const ping = await store.ping();
    assert.equal(ping.backups.count, 30);
    assert.equal(ping.backups.latest.name, first[0]);
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the key for remembered browsers survives a restart', async () => {
  const dir = tempDir();
  const env = { STUDIO_DB_PATH: path.join(dir, 'studio.sqlite') };
  let store = createStore(env);
  try {
    const first = await store.deviceSecret();
    assert.ok(Buffer.isBuffer(first) && first.length === 32);
    await store.close();
    store = createStore(env);
    assert.ok((await store.deviceSecret()).equals(first));
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unusable location is reported, not thrown', async () => {
  const dir = tempDir();
  const blocker = path.join(dir, 'not-a-folder');
  fs.writeFileSync(blocker, 'a file where the folder should be');
  const store = createStore({ STUDIO_DB_PATH: path.join(blocker, 'studio.sqlite') });
  try {
    let pending;
    assert.doesNotThrow(() => { pending = store.ready(); });
    await assert.rejects(pending);
    const ping = await store.ping();
    assert.equal(ping.connected, false);
    assert.ok(ping.error);
    await assert.rejects(store.listInquiries({}));
    await assert.rejects(store.insertInquiry('contact', { names: 'A', email: 'a@example.com' }));
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('weddings from the earlier dashboard keep their stage, money and date', () => {
  const row = fromEarlierWedding({
    id: 'x', partner1: ' Ana ', partner2: 'Iulian', email: 'ana@example.com', date: '2027-07-10', price: 470050, deposit: 100000,
    deposit_status: 'paid', balance: 120000, balance_date: '2027-06-01', status: 'Booked', archived: 1, currency: 'EUR', created_at: '2026-09-18T00:45:31.590Z'
  });
  assert.equal(row.names, 'Ana & Iulian');
  assert.equal(row.price_cents, 470050);
  assert.equal(row.paid_cents, 100000);
  assert.equal(row.status, 'booked');
  assert.deepEqual(JSON.parse(row.fields), {
    'Stage in the earlier dashboard': 'Booked', Deposit: '$1,000 (paid)', Balance: '$1,200, due 2027-06-01',
    Currency: 'EUR', 'Archived in the earlier dashboard': 'Yes'
  });
  assert.equal(fromEarlierWedding({ status: 'lost' }).status, 'not_booked');
  assert.equal(fromEarlierWedding({ status: 'inquiry' }).status, 'new');
  assert.equal(fromEarlierWedding({ status: 'something new' }).status, 'booked', 'anything else in the weddings table was a wedding');
  assert.equal(fromEarlierWedding({ date: 'June 12, 2027' }).wedding_date, '2027-06-12');
  assert.equal(fromEarlierWedding({ date: 'next summer' }).wedding_date, null);
  assert.equal(fromEarlierWedding({ price: -5, deposit: 'n/a' }).price_cents, null);
  assert.equal(fromEarlierWedding({ price: '' }).price_cents, null);
});
