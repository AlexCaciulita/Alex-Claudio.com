// The couple's own page: one private link per couple, showing their day, contract, payments, the
// questionnaire and, later, their gallery. Their answers can draft the day's timeline.
const crypto = require('node:crypto');
const Questionnaire = require('../../portal/questions');
const { logActivity } = require('./work');
const { typicalDay, light, shift } = require('./project');
const { localDay } = require('./analytics');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const TOKEN = /^[A-Za-z0-9_-]{32}$/;

const PORTAL_MIGRATION = `
CREATE TABLE IF NOT EXISTS couple_links (
  inquiry_id INTEGER PRIMARY KEY REFERENCES inquiries(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  viewed_at TEXT
);
CREATE TABLE IF NOT EXISTS questionnaires (
  inquiry_id INTEGER PRIMARY KEY REFERENCES inquiries(id) ON DELETE CASCADE,
  answers TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  submitted_at TEXT
);
`;

const migratePortal = (db) => db.exec(PORTAL_MIGRATION);

// A first draft of the day from the couple's answers, built on a typical day around their ceremony.
// Places, a first look or not, the end of coverage and a send-off come from what they wrote.
function planFromAnswers(answers, sun) {
  const a = Questionnaire.clean(answers);
  if (!a.ceremony_time) return [];
  const ceremony = a.ceremony_time;
  const reception = a.reception_place || a.ceremony_place;
  const ready = [a.getting_ready_1, a.getting_ready_2].filter(Boolean).join(' / ');
  let items = typicalDay(ceremony, sun).map((item) => ({ ...item, place: '', note: '' }));
  for (const item of items) {
    if (/^Getting ready/.test(item.title)) item.place = ready;
    else if (item.title === 'Ceremony') {
      item.place = a.ceremony_place;
      if (a.unplugged === 'Yes') item.note = 'Unplugged ceremony';
    } else if (item.title === 'Family photos') {
      item.place = a.ceremony_place;
      const groups = a.family_groups.split('\n').filter((line) => line.trim()).length;
      if (groups) item.note = `${groups} groupings from the questionnaire`;
      if (a.family_helper) item.note = [item.note, `${a.family_helper} helps gather people`].filter(Boolean).join('; ');
    } else if (/First look|Wedding party/.test(item.title)) item.place = '';
    else item.place = reception;
  }
  if (a.first_look === 'No') {
    items = items.filter((item) => !/^First look/.test(item.title));
    items.push({ time: shift(ceremony, 60), title: 'Portraits of the two of you (during cocktail hour)', place: reception, note: '' });
  }
  if (a.coverage_end) {
    // Coverage may run past midnight; times are compared on the same clock from the getting-ready start.
    const start = items[0] ? items[0].time : ceremony;
    const after = (time, limit) => (time < start ? `1${time}` : `0${time}`) > (limit < start ? `1${limit}` : `0${limit}`);
    items = items.filter((item) => !after(item.time, a.coverage_end));
    if (a.send_off === 'Sparklers' || a.send_off === 'Other') {
      items.push({ time: shift(a.coverage_end, -15), title: a.send_off === 'Sparklers' ? 'Sparkler send-off' : 'Send-off', place: reception, note: '' });
    }
    items.push({ time: a.coverage_end, title: 'Coverage ends', place: '', note: '' });
  }
  return items.sort((x, y) => (x.time < y.time ? -1 : x.time > y.time ? 1 : 0));
}

function portalMethods({ use, timeZone }) {
  const today = () => localDay(timeZone);

  const link = (db, inquiryId) => {
    db.prepare('INSERT OR IGNORE INTO couple_links (inquiry_id, token) VALUES (?, ?)').run(Number(inquiryId), crypto.randomBytes(24).toString('base64url'));
    return db.prepare('SELECT * FROM couple_links WHERE inquiry_id = ?').get(Number(inquiryId));
  };
  const readQuestionnaire = (db, inquiryId) => {
    const row = db.prepare('SELECT * FROM questionnaires WHERE inquiry_id = ?').get(Number(inquiryId));
    if (!row) return null;
    const answers = Questionnaire.clean(JSON.parse(row.answers || '{}'));
    return { answers, status: row.status, updated_at: row.updated_at, submitted_at: row.submitted_at || null, answered: Questionnaire.answered(answers), of: Questionnaire.QUESTIONS.length };
  };

  // Writes the plan from their answers into an empty timeline. A timeline with lines is left alone.
  const buildTimeline = (db, inquiryId, actor) => {
    if (db.prepare('SELECT count(*) AS n FROM timeline_items WHERE inquiry_id = ?').get(Number(inquiryId)).n) return { exists: true };
    const q = readQuestionnaire(db, inquiryId);
    if (!q || !q.answers.ceremony_time) return { error: 'Their answers don’t have a ceremony time yet.' };
    const couple = db.prepare('SELECT wedding_date FROM inquiries WHERE id = ?').get(Number(inquiryId));
    const items = planFromAnswers(q.answers, light(couple && couple.wedding_date, timeZone));
    const insert = db.prepare('INSERT INTO timeline_items (inquiry_id, time, title, place, note) VALUES (?, ?, ?, ?, ?)');
    for (const item of items) insert.run(Number(inquiryId), item.time, item.title, String(item.place || '').slice(0, 200), String(item.note || '').slice(0, 1000));
    logActivity(db, { inquiryId, actor, kind: 'timeline', summary: `Drafted the day's timeline from their questionnaire (${items.length} moments)` });
    return { ok: true, count: items.length };
  };

  return {
    portalLink: (inquiryId) => use((db) => {
      if (!db.prepare('SELECT 1 FROM inquiries WHERE id = ?').get(Number(inquiryId))) return null;
      const row = link(db, inquiryId);
      return { token: row.token, viewed_at: row.viewed_at || null };
    }),

    questionnaire: (inquiryId) => use((db) => readQuestionnaire(db, inquiryId)),

    timelineFromQuestionnaire: (inquiryId, actor = 'you') => use((db) => buildTimeline(db, inquiryId, actor)),

    // Everything the couple's page shows. Opening it the first time is recorded.
    portalForCouple: (token) => use((db) => {
      if (!TOKEN.test(String(token || ''))) return null;
      const row = db.prepare('SELECT * FROM couple_links WHERE token = ?').get(String(token));
      if (!row) return null;
      const inquiry = db.prepare('SELECT id, names, email, wedding_date, location, status, progress, gallery_slug FROM inquiries WHERE id = ?').get(row.inquiry_id);
      if (!inquiry) return null;
      if (!row.viewed_at) {
        db.prepare(`UPDATE couple_links SET viewed_at = ${NOW} WHERE inquiry_id = ?`).run(row.inquiry_id);
        logActivity(db, { inquiryId: row.inquiry_id, actor: 'website', kind: 'portal', summary: 'Opened their page' });
      }
      const contract = db.prepare("SELECT token, status, client_signed_at FROM contracts WHERE inquiry_id = ? AND status IN ('sent', 'signed') ORDER BY id DESC LIMIT 1").get(row.inquiry_id);
      const payments = db.prepare('SELECT id, label, amount_cents, due_date, paid_at, method FROM payments WHERE inquiry_id = ? ORDER BY due_date IS NULL, due_date, id').all(row.inquiry_id)
        .map((p) => ({ id: String(p.id), label: p.label, amount: p.amount_cents / 100, due_date: p.due_date, paid: Boolean(p.paid_at), paid_at: p.paid_at || null, method: p.method || null }));
      const timeline = db.prepare('SELECT time, title, place, note FROM timeline_items WHERE inquiry_id = ? ORDER BY time IS NULL, time, id').all(row.inquiry_id);
      const day = today();
      return {
        inquiry_id: String(row.inquiry_id),
        names: inquiry.names || inquiry.email || '',
        wedding_date: inquiry.wedding_date,
        days: inquiry.wedding_date ? Math.round((Date.parse(`${inquiry.wedding_date}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000) : null,
        location: inquiry.location,
        delivered: inquiry.status === 'booked' && inquiry.progress === 'delivered',
        gallery_slug: inquiry.gallery_slug || null,
        light: light(inquiry.wedding_date, timeZone),
        contract: contract ? { token: contract.token, status: contract.status, signed_at: contract.client_signed_at || null } : null,
        payments,
        timeline,
        questionnaire: readQuestionnaire(db, row.inquiry_id) || { answers: Questionnaire.clean({}), status: 'draft', submitted_at: null }
      };
    }),

    // The couple saves their answers as they go; "send" also tells Alex and drafts the timeline.
    saveQuestionnaire: (token, answers, send = false) => use((db) => {
      if (!TOKEN.test(String(token || ''))) return null;
      const row = db.prepare('SELECT inquiry_id FROM couple_links WHERE token = ?').get(String(token));
      if (!row) return null;
      const clean = Questionnaire.clean(answers);
      const missing = Questionnaire.missing(clean);
      if (send && missing.length) return { error: 'A few answers are still needed.', missing };
      const before = db.prepare('SELECT status FROM questionnaires WHERE inquiry_id = ?').get(row.inquiry_id);
      db.prepare(`INSERT INTO questionnaires (inquiry_id, answers, status, updated_at, submitted_at) VALUES (?, ?, ?, ${NOW}, ${send ? NOW : 'NULL'})
          ON CONFLICT(inquiry_id) DO UPDATE SET answers = excluded.answers, updated_at = excluded.updated_at,
            status = CASE WHEN ? THEN 'submitted' ELSE questionnaires.status END,
            submitted_at = CASE WHEN ? THEN excluded.submitted_at ELSE questionnaires.submitted_at END`)
        .run(row.inquiry_id, JSON.stringify(clean), send ? 'submitted' : 'draft', send ? 1 : 0, send ? 1 : 0);
      let timeline = null;
      if (send) {
        const again = before && before.status === 'submitted';
        logActivity(db, { inquiryId: row.inquiry_id, actor: 'website', kind: 'questionnaire', summary: again ? 'Updated their questionnaire' : 'Sent their questionnaire' });
        db.prepare(`UPDATE tasks SET done_at = COALESCE(done_at, ${NOW}) WHERE inquiry_id = ? AND kind = 'questionnaire'`).run(row.inquiry_id);
        timeline = buildTimeline(db, row.inquiry_id, 'website');
      }
      return { ok: true, status: send || (before && before.status === 'submitted') ? 'submitted' : 'draft', timeline };
    })
  };
}

module.exports = { PORTAL_MIGRATION, migratePortal, portalMethods, planFromAnswers, TOKEN };
