// The work after a couple writes: stages past booking, tags, tasks with due dates, a log of what changed,
// the Today page and the calendar feed for phones. Kept in the dashboard's own SQLite file.
const crypto = require('node:crypto');
const { localDay } = require('./analytics');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
// One list of stages for the whole job. The first two and the last are the inquiry's status; the
// middle four are all "booked", told apart by progress.
const STAGES = ['new', 'replied', 'booked', 'planning', 'editing', 'delivered', 'not_booked'];
const STAGE_LABELS = {
  new: 'New', replied: 'Replied', booked: 'Booked', planning: 'Planning', editing: 'Editing', delivered: 'Delivered', not_booked: 'Not booked'
};
const PROGRESS = ['planning', 'editing', 'delivered'];
const TAG_LIMIT = 12;
const TAG_LENGTH = 40;
const TASK_TITLE_LENGTH = 200;
// Made for every booked wedding with a date, due this many days from it. Galleries arrive within six weeks.
const AUTO_TASKS = [
  { kind: 'questionnaire', title: 'Send the questionnaire', offset: -56 },
  { kind: 'timeline', title: 'Confirm the day’s timeline', offset: -14 },
  { kind: 'gallery', title: 'Deliver the gallery', offset: 42 }
];
const UPCOMING = 12;
const PAST_WEDDING_DAYS = 60;
const BALANCE_DAYS = 30;
const FEED_PAST_DAYS = 90;

const WORK_MIGRATION = `
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER REFERENCES inquiries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'manual',
  title TEXT NOT NULL,
  due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  done_at TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_auto_idx ON tasks (inquiry_id, kind) WHERE kind <> 'manual';
CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks (due_date);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (${NOW}),
  inquiry_id INTEGER REFERENCES inquiries(id) ON DELETE SET NULL,
  actor TEXT NOT NULL DEFAULT 'you',
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  before TEXT,
  after TEXT
);
CREATE INDEX IF NOT EXISTS activity_at_idx ON activity (at);
CREATE INDEX IF NOT EXISTS activity_inquiry_idx ON activity (inquiry_id, at);
`;

const EARLIER_PROGRESS = { editing: 'editing', delivered: 'delivered', completed: 'delivered', done: 'delivered' };

// Columns added to inquiries after the first release. SQLite has no ADD COLUMN IF NOT EXISTS.
function migrateWork(db) {
  db.exec(WORK_MIGRATION);
  const have = new Set(db.prepare('PRAGMA table_info(inquiries)').all().map((column) => column.name));
  if (!have.has('tags')) db.exec("ALTER TABLE inquiries ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  if (!have.has('progress')) {
    db.exec("ALTER TABLE inquiries ADD COLUMN progress TEXT CHECK (progress IS NULL OR progress IN ('planning', 'editing', 'delivered'))");
    // Weddings copied from the earlier dashboard keep the stage they had there.
    const update = db.prepare('UPDATE inquiries SET progress = ? WHERE id = ?');
    for (const row of db.prepare("SELECT id, fields FROM inquiries WHERE status = 'booked' AND form_name = 'earlier-dashboard'").all()) {
      let fields;
      try { fields = JSON.parse(row.fields || '{}'); } catch (error) { fields = {}; }
      const progress = EARLIER_PROGRESS[String(fields['Stage in the earlier dashboard'] || '').toLowerCase()];
      if (progress) update.run(progress, row.id);
    }
  }
}

const stageOf = (status, progress) => (status === 'booked' ? progress || 'booked' : status);
const fromStage = (stage) => (PROGRESS.includes(stage) ? { status: 'booked', progress: stage } : { status: stage, progress: null });

function parseTags(value) {
  try {
    const tags = JSON.parse(value || '[]');
    return Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : [];
  } catch (error) {
    return [];
  }
}

// Tags as they're saved: trimmed, no doubles (ignoring case), at most 12 of 40 characters each.
function cleanTags(list) {
  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    const tag = String(raw).replace(/\s+/g, ' ').trim().slice(0, TAG_LENGTH);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length >= TAG_LIMIT) break;
  }
  return tags;
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const fmtDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtDollars = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const nameOf = (row) => row.names || row.email || 'a couple';

// Records one change. Before and after hold the changed columns, so a change can be put back later.
function logActivity(db, { inquiryId = null, actor = 'you', kind, summary, before = null, after = null }) {
  db.prepare('INSERT INTO activity (inquiry_id, actor, kind, summary, before, after) VALUES (?, ?, ?, ?, ?, ?)').run(
    inquiryId === null ? null : Number(inquiryId), actor, kind, String(summary).slice(0, 500),
    before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null
  );
}

// What a set of changed columns says in the activity list.
function describeChange(before, after) {
  const parts = [];
  if ('status' in after || 'progress' in after) {
    const was = stageOf(before.status, before.progress);
    const now = stageOf(after.status ?? before.status, 'progress' in after ? after.progress : before.progress);
    if (was !== now) parts.push(`moved to ${STAGE_LABELS[now]}`);
  }
  if ('wedding_date' in after) parts.push(after.wedding_date ? `wedding date set to ${fmtDate(after.wedding_date)}` : 'wedding date cleared');
  if ('price_cents' in after) parts.push(after.price_cents === null ? 'agreed price cleared' : `agreed price ${fmtDollars(after.price_cents)}`);
  if ('paid_cents' in after) parts.push(after.paid_cents === null ? 'received cleared' : `received ${fmtDollars(after.paid_cents)}`);
  if ('tags' in after) {
    const old = parseTags(before.tags);
    const now = parseTags(after.tags);
    const added = now.filter((tag) => !old.includes(tag));
    const removed = old.filter((tag) => !now.includes(tag));
    if (added.length) parts.push(`tagged ${added.join(', ')}`);
    if (removed.length) parts.push(`untagged ${removed.join(', ')}`);
  }
  const other = Object.keys(after).filter((key) => !['status', 'progress', 'wedding_date', 'price_cents', 'paid_cents', 'tags', 'updated_at'].includes(key));
  if (other.length) parts.push('details edited');
  if (!parts.length) return null;
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Keeps a wedding's automatic tasks in step with its status and date. Booked with a date: each task
// exists and follows the date. A task whose due date had already passed when it would first be made
// (a wedding booked late, or copied in after the fact) is skipped. Not booked any more: open ones go.
function syncTasks(db, inquiryId, today) {
  const row = db.prepare('SELECT status, progress, wedding_date FROM inquiries WHERE id = ?').get(Number(inquiryId));
  if (!row) return;
  const existing = new Map(db.prepare("SELECT id, kind, due_date, done_at, dismissed_at FROM tasks WHERE inquiry_id = ? AND kind <> 'manual'")
    .all(Number(inquiryId)).map((task) => [task.kind, task]));
  if (row.status !== 'booked' || !row.wedding_date) {
    db.prepare("DELETE FROM tasks WHERE inquiry_id = ? AND kind <> 'manual' AND done_at IS NULL").run(Number(inquiryId));
    return;
  }
  for (const auto of AUTO_TASKS) {
    const due = addDays(row.wedding_date, auto.offset);
    const task = existing.get(auto.kind);
    if (task) {
      if (task.due_date !== due && !task.done_at) db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(due, task.id);
    } else if (due >= today) {
      db.prepare('INSERT INTO tasks (inquiry_id, kind, title, due_date) VALUES (?, ?, ?, ?)').run(Number(inquiryId), auto.kind, auto.title, due);
    }
  }
  // A delivered wedding has had its gallery.
  if (row.progress === 'delivered') {
    db.prepare(`UPDATE tasks SET done_at = ${NOW} WHERE inquiry_id = ? AND kind = 'gallery' AND done_at IS NULL`).run(Number(inquiryId));
  }
}

const mapTask = (row) => ({
  id: String(row.id),
  inquiry_id: row.inquiry_id === null ? null : String(row.inquiry_id),
  names: row.names === undefined ? undefined : row.names || row.email || null,
  kind: row.kind,
  title: row.title,
  due_date: row.due_date,
  done: Boolean(row.done_at),
  done_at: row.done_at || null,
  created_at: row.created_at
});

const mapActivity = (row) => ({
  id: String(row.id),
  at: row.at,
  inquiry_id: row.inquiry_id === null ? null : String(row.inquiry_id),
  names: row.names || null,
  actor: row.actor,
  kind: row.kind,
  summary: row.summary
});

function workMethods({ use, timeZone }) {
  const today = () => localDay(timeZone);

  return {
    syncAllTasks: () => use((db) => {
      const day = today();
      const rows = db.prepare("SELECT id FROM inquiries WHERE status = 'booked' AND wedding_date >= ?").all(addDays(day, -AUTO_TASKS[AUTO_TASKS.length - 1].offset));
      for (const row of rows) syncTasks(db, row.id, day);
      return rows.length;
    }),

    tasksFor: (inquiryId) => use((db) => db.prepare(`SELECT * FROM tasks WHERE inquiry_id = ? AND dismissed_at IS NULL
        ORDER BY done_at IS NOT NULL, due_date IS NULL, due_date, id`).all(Number(inquiryId)).map(mapTask)),

    addTask: ({ inquiry_id: inquiryId = null, title, due_date: due = null }, actor = 'you') => use((db) => {
      let names = null;
      if (inquiryId !== null) {
        const row = db.prepare('SELECT names, email FROM inquiries WHERE id = ?').get(Number(inquiryId));
        if (!row) return null;
        names = nameOf(row);
      }
      const row = db.prepare('INSERT INTO tasks (inquiry_id, title, due_date) VALUES (?, ?, ?) RETURNING *')
        .get(inquiryId === null ? null : Number(inquiryId), String(title).slice(0, TASK_TITLE_LENGTH), due);
      logActivity(db, { inquiryId, actor, kind: 'task', summary: `Added a task: ${row.title}${due ? `, due ${fmtDate(due)}` : ''}`, after: { task: row.id } });
      return mapTask({ ...row, names });
    }),

    updateTask: (id, changes, actor = 'you') => use((db) => {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND dismissed_at IS NULL').get(Number(id));
      if (!task) return null;
      const sets = [];
      const values = [];
      if ('title' in changes) { sets.push('title = ?'); values.push(String(changes.title).slice(0, TASK_TITLE_LENGTH)); }
      if ('due_date' in changes) { sets.push('due_date = ?'); values.push(changes.due_date); }
      if ('done' in changes) { sets.push(changes.done ? `done_at = COALESCE(done_at, ${NOW})` : 'done_at = NULL'); }
      if (sets.length) db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values, Number(id));
      if ('done' in changes && Boolean(changes.done) !== Boolean(task.done_at)) {
        logActivity(db, {
          inquiryId: task.inquiry_id, actor, kind: 'task',
          summary: `${changes.done ? 'Done' : 'Opened again'}: ${task.title}`,
          before: { task: task.id, done_at: task.done_at }, after: { task: task.id, done: Boolean(changes.done) }
        });
      }
      const row = db.prepare('SELECT t.*, i.names, i.email FROM tasks t LEFT JOIN inquiries i ON i.id = t.inquiry_id WHERE t.id = ?').get(Number(id));
      return mapTask(row);
    }),

    // An automatic task is set aside rather than deleted, so it isn't made again.
    deleteTask: (id) => use((db) => {
      const task = db.prepare('SELECT kind FROM tasks WHERE id = ? AND dismissed_at IS NULL').get(Number(id));
      if (!task) return false;
      if (task.kind === 'manual') db.prepare('DELETE FROM tasks WHERE id = ?').run(Number(id));
      else db.prepare(`UPDATE tasks SET dismissed_at = ${NOW} WHERE id = ?`).run(Number(id));
      return true;
    }),

    activityFor: (inquiryId, limit = 30) => use((db) => db.prepare(`SELECT a.*, i.names FROM activity a LEFT JOIN inquiries i ON i.id = a.inquiry_id
        WHERE a.inquiry_id = ? ORDER BY a.at DESC, a.id DESC LIMIT ?`).all(Number(inquiryId), limit).map(mapActivity)),

    // Everything the Today page shows, worked out for today where the studio is.
    today: () => use((db) => {
      const day = today();
      const booked = db.prepare(`SELECT id, names, email, wedding_date, location, hours, status, progress, tags FROM inquiries
          WHERE status = 'booked' AND wedding_date >= ? ORDER BY wedding_date, names LIMIT ?`).all(day, UPCOMING)
        .map((row) => ({
          id: String(row.id), names: nameOf(row), wedding_date: row.wedding_date, location: row.location, hours: row.hours,
          stage: stageOf(row.status, row.progress), tags: parseTags(row.tags), days: daysBetween(day, row.wedding_date)
        }));

      const needs = [];
      for (const row of db.prepare(`SELECT id, names, email, created_at, wedding_date, event_date FROM inquiries
          WHERE status = 'new' ORDER BY created_at LIMIT 50`).all()) {
        const waiting = Math.max(0, daysBetween(localDay(timeZone, new Date(row.created_at)), day));
        needs.push({
          kind: 'reply', inquiry_id: String(row.id), names: nameOf(row), days: waiting,
          text: waiting === 0 ? 'Wrote today. Waiting for your reply.' : `Waiting for your reply for ${waiting} day${waiting === 1 ? '' : 's'}.`
        });
      }
      for (const row of db.prepare(`SELECT i.id, i.names, i.email, i.wedding_date, b.names AS booked_names, b.email AS booked_email
          FROM inquiries i JOIN inquiries b ON b.wedding_date = i.wedding_date AND b.status = 'booked' AND b.id <> i.id
          WHERE i.status IN ('new', 'replied') AND i.wedding_date >= ? ORDER BY i.wedding_date LIMIT 20`).all(day)) {
        needs.push({
          kind: 'clash', inquiry_id: String(row.id), names: nameOf(row),
          text: `Asked about ${fmtDate(row.wedding_date)}, already booked for ${row.booked_names || row.booked_email || 'another couple'}.`
        });
      }
      for (const row of db.prepare(`SELECT id, names, email, wedding_date FROM inquiries
          WHERE status = 'booked' AND (progress IS NULL OR progress = 'planning') AND wedding_date < ? AND wedding_date >= ?
          ORDER BY wedding_date`).all(day, addDays(day, -PAST_WEDDING_DAYS))) {
        needs.push({
          kind: 'editing', inquiry_id: String(row.id), names: nameOf(row),
          text: `Their wedding was on ${fmtDate(row.wedding_date)}. Move it to Editing?`, action: { stage: 'editing', label: 'Move to Editing' }
        });
      }
      for (const row of db.prepare(`SELECT id, names, email, wedding_date, price_cents, paid_cents FROM inquiries
          WHERE status = 'booked' AND price_cents > COALESCE(paid_cents, 0) AND wedding_date <= ? AND wedding_date >= ?
          ORDER BY wedding_date`).all(addDays(day, BALANCE_DAYS), addDays(day, -PAST_WEDDING_DAYS))) {
        const owed = row.price_cents - (row.paid_cents || 0);
        const days = daysBetween(day, row.wedding_date);
        needs.push({
          kind: 'balance', inquiry_id: String(row.id), names: nameOf(row),
          text: `${fmtDollars(owed)} still open. ${days > 0 ? `Wedding in ${days} day${days === 1 ? '' : 's'}.` : days === 0 ? 'Wedding today.' : `Wedding was ${fmtDate(row.wedding_date)}.`}`
        });
      }

      const tasks = db.prepare(`SELECT t.*, i.names, i.email FROM tasks t LEFT JOIN inquiries i ON i.id = t.inquiry_id
          WHERE t.done_at IS NULL AND t.dismissed_at IS NULL AND (t.due_date IS NULL OR t.due_date <= ?)
          ORDER BY t.due_date IS NULL, t.due_date, t.id LIMIT 60`).all(addDays(day, 60)).map(mapTask);

      const activity = db.prepare(`SELECT a.*, i.names FROM activity a LEFT JOIN inquiries i ON i.id = a.inquiry_id
          ORDER BY a.at DESC, a.id DESC LIMIT 15`).all().map(mapActivity);

      return { today: day, upcoming: booked, needs, tasks, activity };
    }),

    // The stage board: everything still being talked about, every booked wedding, and the latest 30 delivered.
    board: () => use((db) => {
      const columns = `id, names, email, wedding_date, event_date, location, hours, status, progress, tags, created_at`;
      const rows = [
        ...db.prepare(`SELECT ${columns} FROM inquiries WHERE status IN ('new', 'replied') OR (status = 'booked' AND (progress IS NULL OR progress <> 'delivered'))`).all(),
        ...db.prepare(`SELECT ${columns} FROM inquiries WHERE status = 'booked' AND progress = 'delivered' ORDER BY wedding_date DESC LIMIT 30`).all()
      ];
      const day = today();
      return rows.map((row) => ({
        id: String(row.id), names: nameOf(row), wedding_date: row.wedding_date, event_date: row.event_date, location: row.location,
        hours: row.hours, stage: stageOf(row.status, row.progress), tags: parseTags(row.tags), created_at: row.created_at,
        days: row.wedding_date ? daysBetween(day, row.wedding_date) : null
      }));
    }),

    // A private address for the calendar feed, made once. Making a new one stops the old one working.
    feedKey: (renew = false) => use((db) => {
      if (renew) db.prepare('DELETE FROM secrets WHERE name = ?').run('calendar-feed');
      db.prepare('INSERT OR IGNORE INTO secrets (name, value) VALUES (?, ?)').run('calendar-feed', Buffer.from(crypto.randomBytes(32).toString('base64url')));
      return Buffer.from(db.prepare('SELECT value FROM secrets WHERE name = ?').get('calendar-feed').value).toString();
    }),

    feedEntries: () => use((db) => {
      const from = addDays(today(), -FEED_PAST_DAYS);
      const weddings = db.prepare(`SELECT id, names, email, wedding_date, location, hours, status, progress, updated_at FROM inquiries
          WHERE status = 'booked' AND wedding_date >= ? ORDER BY wedding_date`).all(from)
        .map((row) => ({ ...row, id: String(row.id), names: nameOf(row), stage: stageOf(row.status, row.progress) }));
      const tasks = db.prepare(`SELECT t.*, i.names, i.email FROM tasks t LEFT JOIN inquiries i ON i.id = t.inquiry_id
          WHERE t.done_at IS NULL AND t.dismissed_at IS NULL AND t.due_date >= ? ORDER BY t.due_date`).all(from).map(mapTask);
      return { weddings, tasks };
    })
  };
}

module.exports = {
  STAGES, STAGE_LABELS, PROGRESS, AUTO_TASKS, TAG_LIMIT, TAG_LENGTH, TASK_TITLE_LENGTH,
  migrateWork, workMethods, syncTasks, logActivity, describeChange, stageOf, fromStage, parseTags, cleanTags, addDays
};
