// One couple's wedding in detail: the day's timeline, the payment schedule and the gallery it belongs to.
// Kept in the dashboard's own SQLite file.
const { logActivity, addDays, syncTasks } = require('./work');
const { localDay } = require('./analytics');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const GALLERY_SLUG = /^[a-z0-9-]{6,64}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Seattle, for sunset times. Venues are a short drive away, so the minute barely moves.
const SEATTLE = { lat: 47.6062, lng: -122.3321 };
const RETAINER_SHARE = 0.3;
// Alex's contract: the balance is due 7 days before the event.
const BALANCE_DAYS_BEFORE = 7;

const PROJECT_MIGRATION = `
CREATE TABLE IF NOT EXISTS timeline_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  time TEXT CHECK (time IS NULL OR time GLOB '[0-2][0-9]:[0-5][0-9]'),
  title TEXT NOT NULL,
  place TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS timeline_inquiry_idx ON timeline_items (inquiry_id, time);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE INDEX IF NOT EXISTS payments_inquiry_idx ON payments (inquiry_id, due_date);
`;

function migrateProject(db) {
  db.exec(PROJECT_MIGRATION);
  const have = new Set(db.prepare('PRAGMA table_info(inquiries)').all().map((column) => column.name));
  if (!have.has('gallery_slug')) db.exec('ALTER TABLE inquiries ADD COLUMN gallery_slug TEXT');
  // How a payment was made (card, through Stripe) and the Checkout session that collected it.
  const paymentColumns = new Set(db.prepare('PRAGMA table_info(payments)').all().map((column) => column.name));
  if (!paymentColumns.has('method')) db.exec('ALTER TABLE payments ADD COLUMN method TEXT');
  if (!paymentColumns.has('stripe_session')) db.exec('ALTER TABLE payments ADD COLUMN stripe_session TEXT');
}

const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Sunset for a day, by the sunrise equation (accurate to a minute or two). Returns a Date, or null in
// polar day or night.
function sunset(iso, { lat, lng } = SEATTLE) {
  const [y, m, d] = iso.split('-').map(Number);
  const julian = Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5;
  const n = Math.ceil(julian - 2451545.0 + 0.0008);
  const mean = n - lng / 360;
  const anomaly = (357.5291 + 0.98560028 * mean) % 360;
  const centre = 1.9148 * Math.sin(rad(anomaly)) + 0.02 * Math.sin(rad(2 * anomaly)) + 0.0003 * Math.sin(rad(3 * anomaly));
  const ecliptic = (anomaly + centre + 180 + 102.9372) % 360;
  const transit = 2451545.0 + mean + 0.0053 * Math.sin(rad(anomaly)) - 0.0069 * Math.sin(rad(2 * ecliptic));
  const declination = Math.asin(Math.sin(rad(ecliptic)) * Math.sin(rad(23.4397)));
  const cosHour = (Math.sin(rad(-0.833)) - Math.sin(rad(lat)) * Math.sin(declination)) / (Math.cos(rad(lat)) * Math.cos(declination));
  if (cosHour < -1 || cosHour > 1) return null;
  const set = transit + deg(Math.acos(cosHour)) / 360;
  return new Date((set - 2440587.5) * 86400000);
}

// "HH:MM" in the studio's time zone.
const clock = (date, timeZone) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
const shift = (time, minutes) => {
  const total = (Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

function light(iso, timeZone) {
  const set = iso ? sunset(iso) : null;
  if (!set) return null;
  const at = clock(set, timeZone);
  return { sunset: at, golden_hour: shift(at, -60) };
}

// A starting point for the day, around the ceremony time. Every line can be changed or removed.
function typicalDay(ceremony, sun) {
  const items = [
    [-150, 'Getting ready and details'],
    [-75, 'First look and portraits of the two of you'],
    [-45, 'Wedding party photos'],
    [0, 'Ceremony'],
    [30, 'Family photos'],
    [60, 'Cocktail hour'],
    [120, 'Grand entrance and dinner'],
    [165, 'Toasts'],
    [210, 'First dance and open dancing'],
    [270, 'Cake cutting and last dances']
  ].map(([offset, title]) => ({ time: shift(ceremony, offset), title }));
  if (sun && sun.sunset > shift(ceremony, 60)) items.push({ time: shift(sun.sunset, -30), title: 'Sunset portraits (about 15 minutes)' });
  return items.sort((a, b) => (a.time < b.time ? -1 : 1));
}

const mapItem = (row) => ({ id: String(row.id), time: row.time, title: row.title, place: row.place, note: row.note });
const mapPayment = (row, today) => ({
  id: String(row.id),
  label: row.label,
  amount: row.amount_cents / 100,
  due_date: row.due_date,
  paid: Boolean(row.paid_at),
  paid_at: row.paid_at || null,
  method: row.method || null,
  overdue: !row.paid_at && Boolean(row.due_date) && row.due_date < today
});
const fmtDollars = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

function projectMethods({ use, timeZone }) {
  const today = () => localDay(timeZone);

  // With a schedule, "received" is what the paid lines add up to; the change is recorded like any other.
  const syncReceived = (db, inquiryId, actor) => {
    const row = db.prepare('SELECT count(*) AS n, COALESCE(sum(amount_cents) FILTER (WHERE paid_at IS NOT NULL), 0) AS paid FROM payments WHERE inquiry_id = ?').get(Number(inquiryId));
    if (!row.n) return;
    const before = db.prepare('SELECT paid_cents FROM inquiries WHERE id = ?').get(Number(inquiryId));
    if (before.paid_cents === row.paid) return;
    db.prepare(`UPDATE inquiries SET paid_cents = ?, updated_at = ${NOW} WHERE id = ?`).run(row.paid, Number(inquiryId));
    logActivity(db, { inquiryId, actor, kind: 'change', summary: `Received ${fmtDollars(row.paid)} in all`, before: { paid_cents: before.paid_cents }, after: { paid_cents: row.paid } });
  };

  const project = (db, inquiryId) => {
    const couple = db.prepare('SELECT id, wedding_date, gallery_slug, price_cents, paid_cents FROM inquiries WHERE id = ?').get(Number(inquiryId));
    if (!couple) return null;
    const day = today();
    const payments = db.prepare('SELECT * FROM payments WHERE inquiry_id = ? ORDER BY due_date IS NULL, due_date, id').all(Number(inquiryId)).map((row) => mapPayment(row, day));
    const scheduled = payments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
    return {
      id: String(couple.id),
      gallery_slug: couple.gallery_slug || null,
      light: light(couple.wedding_date, timeZone),
      timeline: db.prepare('SELECT * FROM timeline_items WHERE inquiry_id = ? ORDER BY time IS NULL, time, id').all(Number(inquiryId)).map(mapItem),
      payments,
      schedule: {
        total: scheduled / 100,
        // How far the schedule is from the agreed price, so a gap or an overlap shows.
        unscheduled: couple.price_cents === null ? null : (couple.price_cents - scheduled) / 100
      }
    };
  };

  return {
    project: (inquiryId) => use((db) => project(db, inquiryId)),

    setGallery: (inquiryId, slug, actor = 'you') => use((db) => {
      const row = db.prepare('SELECT gallery_slug FROM inquiries WHERE id = ?').get(Number(inquiryId));
      if (!row) return null;
      const value = slug || null;
      if ((row.gallery_slug || null) !== value) {
        db.prepare(`UPDATE inquiries SET gallery_slug = ?, updated_at = ${NOW} WHERE id = ?`).run(value, Number(inquiryId));
        logActivity(db, {
          inquiryId, actor, kind: 'change', summary: value ? `Linked the gallery /gallery/${value}` : 'Unlinked the gallery',
          before: { gallery_slug: row.gallery_slug || null }, after: { gallery_slug: value }
        });
      }
      return project(db, inquiryId);
    }),

    addTimelineItem: (inquiryId, { time = null, title, place = '', note = '' }, actor = 'you') => use((db) => {
      if (!db.prepare('SELECT 1 FROM inquiries WHERE id = ?').get(Number(inquiryId))) return null;
      const row = db.prepare('INSERT INTO timeline_items (inquiry_id, time, title, place, note) VALUES (?, ?, ?, ?, ?) RETURNING *')
        .get(Number(inquiryId), time, title, place, note);
      logActivity(db, { inquiryId, actor, kind: 'timeline', summary: `Timeline: ${time ? `${time} ` : ''}${title}`, after: { timeline: row.id } });
      return mapItem(row);
    }),

    updateTimelineItem: (id, changes) => use((db) => {
      const sets = [];
      const values = [];
      for (const key of ['time', 'title', 'place', 'note']) if (key in changes) { sets.push(`${key} = ?`); values.push(changes[key]); }
      if (!sets.length) return mapItem(db.prepare('SELECT * FROM timeline_items WHERE id = ?').get(Number(id)) || {});
      const row = db.prepare(`UPDATE timeline_items SET ${sets.join(', ')} WHERE id = ? RETURNING *`).get(...values, Number(id));
      return row ? mapItem(row) : null;
    }),

    deleteTimelineItem: (id) => use((db) => db.prepare('DELETE FROM timeline_items WHERE id = ?').run(Number(id)).changes > 0),

    // Fills an empty timeline with a typical day around the ceremony. A timeline that has lines is left alone.
    startTimeline: (inquiryId, ceremony, actor = 'you') => use((db) => {
      const couple = db.prepare('SELECT wedding_date FROM inquiries WHERE id = ?').get(Number(inquiryId));
      if (!couple) return null;
      if (db.prepare('SELECT count(*) AS n FROM timeline_items WHERE inquiry_id = ?').get(Number(inquiryId)).n) return { exists: true };
      const insert = db.prepare('INSERT INTO timeline_items (inquiry_id, time, title) VALUES (?, ?, ?)');
      for (const item of typicalDay(ceremony, light(couple.wedding_date, timeZone))) insert.run(Number(inquiryId), item.time, item.title);
      logActivity(db, { inquiryId, actor, kind: 'timeline', summary: `Started the day's timeline around a ${ceremony} ceremony` });
      return project(db, inquiryId);
    }),

    addPayment: (inquiryId, { label, amount, due_date: due = null }, actor = 'you') => use((db) => {
      if (!db.prepare('SELECT 1 FROM inquiries WHERE id = ?').get(Number(inquiryId))) return null;
      const cents = Math.round(amount * 100);
      const row = db.prepare('INSERT INTO payments (inquiry_id, label, amount_cents, due_date) VALUES (?, ?, ?, ?) RETURNING *').get(Number(inquiryId), label, cents, due);
      logActivity(db, { inquiryId, actor, kind: 'payment', summary: `Scheduled ${label}: ${fmtDollars(cents)}${due ? ` due ${due}` : ''}` });
      return mapPayment(row, today());
    }),

    // A payment's label, amount or due date, or marking it paid (which updates "received").
    updatePayment: (id, changes, actor = 'you') => use((db) => {
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(id));
      if (!payment) return null;
      const sets = [];
      const values = [];
      if ('label' in changes) { sets.push('label = ?'); values.push(changes.label); }
      if ('amount' in changes) { sets.push('amount_cents = ?'); values.push(Math.round(changes.amount * 100)); }
      if ('due_date' in changes) { sets.push('due_date = ?'); values.push(changes.due_date); }
      if ('paid' in changes) sets.push(changes.paid ? `paid_at = COALESCE(paid_at, ${NOW})` : 'paid_at = NULL');
      if (sets.length) db.prepare(`UPDATE payments SET ${sets.join(', ')} WHERE id = ?`).run(...values, Number(id));
      if ('paid' in changes && Boolean(changes.paid) !== Boolean(payment.paid_at)) {
        logActivity(db, { inquiryId: payment.inquiry_id, actor, kind: 'payment', summary: `${changes.paid ? 'Paid' : 'Not paid after all'}: ${payment.label}, ${fmtDollars(payment.amount_cents)}` });
      }
      syncReceived(db, payment.inquiry_id, actor);
      return mapPayment(db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(id)), today());
    }),

    deletePayment: (id, actor = 'you') => use((db) => {
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(id));
      if (!payment) return false;
      db.prepare('DELETE FROM payments WHERE id = ?').run(Number(id));
      logActivity(db, { inquiryId: payment.inquiry_id, actor, kind: 'payment', summary: `Removed the payment ${payment.label}, ${fmtDollars(payment.amount_cents)}` });
      syncReceived(db, payment.inquiry_id, actor);
      return true;
    }),

    // The usual schedule: a 30% retainer due now and the balance a week before the wedding. What was
    // already received counts toward the retainer. Needs an agreed price and an empty schedule.
    startSchedule: (inquiryId, actor = 'you') => use((db) => {
      const couple = db.prepare('SELECT wedding_date, price_cents, paid_cents FROM inquiries WHERE id = ?').get(Number(inquiryId));
      if (!couple) return null;
      if (!couple.price_cents) return { error: 'Set the agreed price first.' };
      if (db.prepare('SELECT count(*) AS n FROM payments WHERE inquiry_id = ?').get(Number(inquiryId)).n) return { error: 'This couple already has a payment schedule.' };
      const day = today();
      const retainer = Math.round(couple.price_cents * RETAINER_SHARE);
      const balance = couple.price_cents - retainer;
      const balanceDue = couple.wedding_date ? addDays(couple.wedding_date, -BALANCE_DAYS_BEFORE) : null;
      const insert = db.prepare('INSERT INTO payments (inquiry_id, label, amount_cents, due_date, paid_at) VALUES (?, ?, ?, ?, ?)');
      const paid = couple.paid_cents || 0;
      insert.run(Number(inquiryId), 'Retainer (30%)', retainer, day, paid >= retainer ? new Date().toISOString() : null);
      insert.run(Number(inquiryId), 'Balance', balance, balanceDue && balanceDue > day ? balanceDue : day, paid >= couple.price_cents ? new Date().toISOString() : null);
      logActivity(db, { inquiryId, actor, kind: 'payment', summary: `Made the payment schedule: ${fmtDollars(retainer)} retainer, ${fmtDollars(balance)} balance` });
      syncReceived(db, inquiryId, actor);
      return project(db, inquiryId);
    }),

    // Payments that need chasing: overdue, or due within a week. For the Today page.
    paymentsDue: () => use((db) => {
      const day = today();
      return db.prepare(`SELECT p.*, i.names, i.email FROM payments p JOIN inquiries i ON i.id = p.inquiry_id
          WHERE p.paid_at IS NULL AND p.due_date <= ? AND i.status = 'booked' ORDER BY p.due_date`).all(addDays(day, 7))
        .map((row) => ({ ...mapPayment(row, day), inquiry_id: String(row.inquiry_id), names: row.names || row.email }));
    }),

    // Marks a scheduled payment paid by card, once Stripe has confirmed it. The amount must be the one
    // scheduled; a payment already paid stays as it is. A couple who has signed and pays the retainer is booked.
    markPaidOnline: (paymentId, { session, amountCents }) => use((db) => {
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(paymentId));
      if (!payment) return { error: 'Unknown payment.' };
      if (payment.paid_at) return { ok: true, already: true };
      if (payment.amount_cents !== amountCents) {
        logActivity(db, { inquiryId: payment.inquiry_id, actor: 'website', kind: 'payment', summary: `A card payment of ${fmtDollars(amountCents)} didn't match ${payment.label} (${fmtDollars(payment.amount_cents)}). Check Stripe.` });
        return { error: 'The amount paid doesn\u2019t match.' };
      }
      db.prepare(`UPDATE payments SET paid_at = ${NOW}, method = 'card', stripe_session = ? WHERE id = ?`).run(session, payment.id);
      logActivity(db, { inquiryId: payment.inquiry_id, actor: 'website', kind: 'payment', summary: `Paid ${payment.label} by card, ${fmtDollars(payment.amount_cents)}` });
      syncReceived(db, payment.inquiry_id, 'website');
      const couple = db.prepare('SELECT status FROM inquiries WHERE id = ?').get(payment.inquiry_id);
      const signed = db.prepare("SELECT 1 FROM contracts WHERE inquiry_id = ? AND status = 'signed'").get(payment.inquiry_id);
      if (couple && signed && ['new', 'replied'].includes(couple.status)) {
        db.prepare(`UPDATE inquiries SET status = 'booked', progress = NULL, updated_at = ${NOW} WHERE id = ?`).run(payment.inquiry_id);
        logActivity(db, { inquiryId: payment.inquiry_id, actor: 'website', kind: 'change', summary: 'Moved to Booked (signed and paid)', before: { status: couple.status }, after: { status: 'booked' } });
        syncTasks(db, payment.inquiry_id, today());
      }
      return { ok: true };
    }),

    paymentInquiry: (id) => use((db) => {
      const row = db.prepare('SELECT inquiry_id FROM payments WHERE id = ?').get(Number(id));
      return row ? String(row.inquiry_id) : null;
    }),

    timelineInquiry: (id) => use((db) => {
      const row = db.prepare('SELECT inquiry_id FROM timeline_items WHERE id = ?').get(Number(id));
      return row ? String(row.inquiry_id) : null;
    })
  };
}

module.exports = { PROJECT_MIGRATION, migrateProject, projectMethods, sunset, light, typicalDay, GALLERY_SLUG, TIME, shift };
