// Emails that go to couples on their own: a nudge about the questionnaire eight weeks out and again at
// five, a heads-up ten days before a payment is due, and a note when their gallery is delivered.
// Each one goes out once. Until email can be sent from the studio's own address, the reminders wait on
// the Today page for Alex to send by hand.
const crypto = require('node:crypto');
const { logActivity, addDays } = require('./work');
const { localDay } = require('./analytics');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const LINKABLE_EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
// A reminder whose day passed more than this many days ago is no longer sent (a late "eight weeks out"
// reads wrong), so a pause or an outage never ends in a pile of old emails.
const LATE_DAYS = 3;
const UPCOMING_DAYS = 7;
const MAX_ATTEMPTS = 3;
// Sent in the morning where the studio is, never at night.
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 20;

const KINDS = {
  questionnaire: { label: 'Questionnaire reminder', offset: -56 },
  questionnaire_again: { label: 'Second questionnaire reminder', offset: -35 },
  payment: { label: 'Payment reminder', offset: -10 },
  gallery: { label: 'Gallery is ready' }
};

const REMINDERS_MIGRATION = `
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  to_email TEXT,
  subject TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL DEFAULT (${NOW}),
  UNIQUE (inquiry_id, kind, ref)
);
CREATE TABLE IF NOT EXISTS studio_settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const migrateReminders = (db) => db.exec(REMINDERS_MIGRATION);

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const dollars = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "Ana & Iulian" -> "Ana and Iulian"; one name stays one name.
function greeting(names) {
  const parts = String(names || '').split(/\s*(?:&|\band\b|\+)\s*/i).map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
  if (!parts.length) return 'Hi there';
  return `Hi ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`}`;
}

const weeks = (days) => {
  const n = Math.max(1, Math.round(days / 7));
  return `${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || n} week${n === 1 ? '' : 's'}`;
};

// The email for one reminder, in Alex's words. Links are absolute so they work in any mail app.
function compose(item, { origin, canPay }) {
  const hi = `${greeting(item.names)},`;
  const page = item.portal_token ? `${origin}/couple/${item.portal_token}` : null;
  let subject;
  let lines;
  if (item.kind === 'questionnaire') {
    subject = 'A few questions about your wedding day';
    lines = [
      hi,
      `Your wedding is ${weeks(item.days_to_wedding)} away. When you have a quiet evening, could you fill in the questionnaire on your page? It asks about times, places and family photos, and your answers save as you go.`,
      page,
      'Once it’s in, I’ll put together a plan for the day and we’ll go over it together.'
    ];
  } else if (item.kind === 'questionnaire_again') {
    subject = 'Your wedding questionnaire';
    lines = [
      hi,
      `A quick reminder about the questionnaire on your page. With ${weeks(item.days_to_wedding)} to go, your answers help me plan the timeline and the family photos.`,
      page,
      'If something isn’t decided yet, leave it blank and we’ll work it out together.'
    ];
  } else if (item.kind === 'payment') {
    subject = `Your ${item.payment_label.toLowerCase()} is due ${longDate(item.due_date).replace(/^\w+, /, '')}`;
    lines = [
      hi,
      `A heads-up that your ${item.payment_label.toLowerCase()} of ${dollars(item.amount_cents)} is due on ${longDate(item.due_date)}.${page ? canPay ? ' You can pay by card on your page:' : ' The details are on your page:' : ''}`,
      page,
      'If you’ve already sent it another way, let me know and I’ll mark it paid.'
    ];
  } else if (item.kind === 'gallery') {
    subject = 'Your wedding gallery is ready';
    lines = [
      hi,
      'Your wedding photos are ready. Here’s your gallery:',
      `${origin}/gallery/${item.gallery_slug}`,
      'Take your time going through them. If you have any questions, just reply to this email.'
    ];
  } else return null;
  lines = lines.filter(Boolean);
  const text = `${lines.join('\n\n')}\n\nAlex`;
  const html = `<div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.55;color:#1a1714;max-width:560px;">${lines.map((line) => (/^https?:\/\//.test(line)
    ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(line)}" style="color:#1a1714;">${escapeHtml(line)}</a></p>`
    : `<p style="margin:0 0 16px;">${escapeHtml(line)}</p>`)).join('')}<p style="margin:0;">Alex</p></div>`;
  return { subject, text, html };
}

// Sending through Resend, from an address on the studio's own domain. Resend's shared test address
// only delivers to the account owner, so it doesn't count.
function createMailer({ env = process.env, fetch: fetchImpl = fetch } = {}) {
  const key = String(env.RESEND_API_KEY || '').trim();
  const from = String(env.STUDIO_FROM_EMAIL || env.CONTACT_FROM_EMAIL || '').trim();
  const replyTo = String(env.CONTACT_TO_EMAIL || 'contact@alex-claudio.com').trim();
  let reason = null;
  if (!key) reason = 'Add RESEND_API_KEY on Railway.';
  else if (!from) reason = 'Add STUDIO_FROM_EMAIL on Railway (for example Alex Claudio <alex@alex-claudio.com>), on a domain verified in Resend.';
  else if (/resend\.dev/i.test(from)) reason = 'The sender is Resend’s test address, which only reaches you. Set STUDIO_FROM_EMAIL to an address on your own domain.';
  return {
    ready: !reason,
    reason,
    from: reason ? null : from,
    async send({ to, subject, text, html }) {
      if (reason) throw new Error(reason);
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, text, html }),
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return true;
    }
  };
}

function reminderMethods({ use, timeZone }) {
  const today = () => localDay(timeZone);
  const setting = (db, name) => {
    const row = db.prepare('SELECT value FROM studio_settings WHERE name = ?').get(name);
    return row ? row.value : null;
  };
  const setSetting = (db, name, value) => db.prepare('INSERT INTO studio_settings (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(name, String(value));

  // Every reminder that could go out, with the day it's for. What was already sent or skipped is left out.
  const candidates = (db, day) => {
    const done = new Map(db.prepare('SELECT inquiry_id, kind, ref, status, attempts, error FROM reminders').all()
      .map((row) => [`${row.inquiry_id}|${row.kind}|${row.ref}`, row]));
    const out = [];
    const add = (row, kind, ref, on, extra = {}) => {
      const record = done.get(`${row.id}|${kind}|${ref}`);
      if (record && (record.status !== 'failed' || record.attempts >= MAX_ATTEMPTS)) {
        if (record.status === 'failed') out.push({ ...base(row, kind, ref, on, extra), failed: true, error: record.error });
        return;
      }
      out.push({ ...base(row, kind, ref, on, extra), attempts: record ? record.attempts : 0, error: record ? record.error : null });
    };
    const base = (row, kind, ref, on, extra) => ({
      key: `${row.id}|${kind}|${ref}`, inquiry_id: String(row.id), names: row.names || row.email, email: row.email, kind, ref, label: KINDS[kind].label,
      day: on, wedding_date: row.wedding_date, days_to_wedding: row.wedding_date ? daysBetween(on > day ? on : day, row.wedding_date) : null, ...extra
    });

    const booked = db.prepare(`SELECT i.id, i.names, i.email, i.wedding_date, q.status AS q_status FROM inquiries i
        LEFT JOIN questionnaires q ON q.inquiry_id = i.id
        WHERE i.status = 'booked' AND (i.progress IS NULL OR i.progress = 'planning') AND i.wedding_date > ?`).all(day);
    for (const row of booked) {
      if (row.q_status === 'submitted') continue;
      for (const kind of ['questionnaire', 'questionnaire_again']) add(row, kind, '', addDays(row.wedding_date, KINDS[kind].offset));
    }
    for (const row of db.prepare(`SELECT p.id AS payment_id, p.label, p.amount_cents, p.due_date, i.id, i.names, i.email, i.wedding_date
        FROM payments p JOIN inquiries i ON i.id = p.inquiry_id
        WHERE p.paid_at IS NULL AND p.due_date IS NOT NULL AND p.due_date >= ? AND p.amount_cents > 0 AND i.status = 'booked'`).all(day)) {
      add(row, 'payment', String(row.payment_id), addDays(row.due_date, KINDS.payment.offset),
        { payment_label: row.label, amount_cents: row.amount_cents, due_date: row.due_date });
    }
    for (const row of db.prepare(`SELECT id, names, email, wedding_date, gallery_slug FROM inquiries
        WHERE status = 'booked' AND progress = 'delivered' AND gallery_slug IS NOT NULL AND gallery_slug <> ''`).all()) {
      add(row, 'gallery', row.gallery_slug, day, { gallery_slug: row.gallery_slug });
    }
    return out.filter((item) => item.failed || item.day >= addDays(day, -LATE_DAYS));
  };

  // The first time reminders run, galleries delivered before then are marked as already handled, so
  // nobody gets a "your gallery is ready" email months later.
  const baseline = (db, day) => {
    if (setting(db, 'reminders_started')) return;
    const insert = db.prepare("INSERT OR IGNORE INTO reminders (inquiry_id, kind, ref, status, error) VALUES (?, 'gallery', ?, 'skipped', 'Delivered before reminders started')");
    for (const row of db.prepare("SELECT id, gallery_slug FROM inquiries WHERE status = 'booked' AND progress = 'delivered' AND gallery_slug IS NOT NULL AND gallery_slug <> ''").all()) {
      insert.run(row.id, row.gallery_slug);
    }
    setSetting(db, 'reminders_started', day);
  };

  const withLinks = (db, items) => {
    const token = db.prepare('SELECT token FROM couple_links WHERE inquiry_id = ?');
    return items.map((item) => {
      const row = token.get(Number(item.inquiry_id));
      return { ...item, portal_token: row ? row.token : null, can_email: LINKABLE_EMAIL.test(item.email || '') };
    });
  };

  return {
    // What's due now, what failed, and what goes out in the next week.
    reminders: () => use((db) => {
      const day = today();
      baseline(db, day);
      const all = withLinks(db, candidates(db, day));
      return {
        today: day,
        paused: setting(db, 'reminders_paused') === '1',
        due: all.filter((item) => !item.failed && item.day <= day),
        failed: all.filter((item) => item.failed),
        upcoming: all.filter((item) => !item.failed && item.day > day && item.day <= addDays(day, UPCOMING_DAYS)).sort((a, b) => (a.day < b.day ? -1 : 1)),
        recent: db.prepare(`SELECT r.inquiry_id, r.kind, r.status, r.at, i.names, i.email FROM reminders r JOIN inquiries i ON i.id = r.inquiry_id
            WHERE r.status = 'sent' ORDER BY r.at DESC LIMIT 5`).all().map((row) => ({ ...row, inquiry_id: String(row.inquiry_id), names: row.names || row.email, label: KINDS[row.kind] ? KINDS[row.kind].label : row.kind }))
      };
    }),

    // Gives a couple their page link if they don't have one yet, so the email can point to it.
    ensurePortalLinks: (ids) => use((db) => {
      const insert = db.prepare('INSERT OR IGNORE INTO couple_links (inquiry_id, token) VALUES (?, ?)');
      for (const id of new Set(ids)) insert.run(Number(id), crypto.randomBytes(24).toString('base64url'));
    }),

    // Records what happened to one reminder. Sending, skipping and marking sent by hand land on the
    // couple's activity; failures are kept for a retry.
    recordReminder: (inquiryId, kind, ref, status, { to = null, subject = null, error = null, actor = 'reminders' } = {}) => use((db) => {
      if (!KINDS[kind] || !['sent', 'skipped', 'failed'].includes(status)) return false;
      const couple = db.prepare('SELECT id FROM inquiries WHERE id = ?').get(Number(inquiryId));
      if (!couple) return false;
      db.prepare(`INSERT INTO reminders (inquiry_id, kind, ref, status, to_email, subject, error, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(inquiry_id, kind, ref) DO UPDATE SET status = excluded.status, to_email = COALESCE(excluded.to_email, reminders.to_email),
            subject = COALESCE(excluded.subject, reminders.subject), error = excluded.error,
            attempts = reminders.attempts + excluded.attempts, at = ${NOW}`)
        .run(Number(inquiryId), kind, String(ref || ''), status, to, subject, error, status === 'failed' ? 1 : 0);
      const label = KINDS[kind].label.toLowerCase();
      // Emailing the questionnaire reminder is sending the questionnaire, so that task is done.
      if (status === 'sent' && kind === 'questionnaire') db.prepare(`UPDATE tasks SET done_at = COALESCE(done_at, ${NOW}) WHERE inquiry_id = ? AND kind = 'questionnaire'`).run(Number(inquiryId));
      if (status === 'sent') logActivity(db, { inquiryId, actor, kind: 'reminder', summary: actor === 'you' ? `Sent the ${label} by hand` : `Emailed the ${label}: “${subject}”` });
      if (status === 'skipped') logActivity(db, { inquiryId, actor: 'you', kind: 'reminder', summary: `Skipped the ${label}` });
      return true;
    }),

    setRemindersPaused: (paused) => use((db) => { setSetting(db, 'reminders_paused', paused ? '1' : '0'); return Boolean(paused); })
  };
}

// One pass: sends what's due, if sending is possible, it's daytime where the studio is, and Alex
// hasn't paused reminders. Returns what happened, for the log and the tests.
async function runReminders({ store, mailer, origin, canPay = false, timeZone = 'America/Los_Angeles', now = new Date() }) {
  if (!mailer || !mailer.ready) return { sent: 0, reason: mailer ? mailer.reason : 'No mailer' };
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) return { sent: 0, reason: 'Outside sending hours' };
  let list = await store.reminders();
  if (list.paused) return { sent: 0, reason: 'Paused' };
  const due = list.due.filter((item) => item.can_email);
  if (!due.length) return { sent: 0 };
  // Questionnaire and payment emails link to the couple's page, so make sure each couple has one.
  await store.ensurePortalLinks(due.filter((item) => item.kind !== 'gallery' && !item.portal_token).map((item) => item.inquiry_id));
  list = await store.reminders();
  let sent = 0;
  let failed = 0;
  for (const item of list.due.filter((entry) => entry.can_email)) {
    const email = compose(item, { origin, canPay });
    if (!email) continue;
    try {
      await mailer.send({ to: item.email, ...email });
      await store.recordReminder(item.inquiry_id, item.kind, item.ref, 'sent', { to: item.email, subject: email.subject });
      sent += 1;
    } catch (error) {
      await store.recordReminder(item.inquiry_id, item.kind, item.ref, 'failed', { to: item.email, subject: email.subject, error: String(error.message || error).slice(0, 300) });
      failed += 1;
    }
  }
  return { sent, failed };
}

// Checks every 15 minutes. The first check waits a minute so a deploy settles first.
function startReminders({ store, mailer, origin, canPay, timeZone, log = console }) {
  const tick = () => runReminders({ store, mailer, origin, canPay, timeZone })
    .then((result) => { if (result.sent || result.failed) log.log(`Reminders: ${result.sent} sent, ${result.failed || 0} failed`); })
    .catch((error) => log.error('Reminders failed:', String((error && error.message) || error).slice(0, 300)));
  const first = setTimeout(tick, 60 * 1000);
  const timer = setInterval(tick, 15 * 60 * 1000);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}

module.exports = { KINDS, REMINDERS_MIGRATION, migrateReminders, reminderMethods, compose, createMailer, runReminders, startReminders, greeting };
