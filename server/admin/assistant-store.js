// What the assistant keeps in the dashboard's SQLite file: its conversations (exactly as sent to the
// model, plus a readable copy for the chat panel), reply drafts, and putting a change back.
const { logActivity, syncTasks, stageOf, parseTags } = require('./work');
const { localDay } = require('./analytics');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const ASSISTANT_MIGRATION = `
CREATE TABLE IF NOT EXISTS assistant_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (${NOW}),
  role TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assistant_messages_idx ON assistant_messages (conversation, id);
CREATE TABLE IF NOT EXISTS assistant_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (${NOW}),
  who TEXT NOT NULL,
  text TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS assistant_turns_idx ON assistant_turns (conversation, id);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'chat',
  inquiry_id INTEGER REFERENCES inquiries(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  discarded_at TEXT
);
`;

// Columns the assistant may put back when a change is undone.
const UNDOABLE = new Set(['gallery_slug', 'names', 'email', 'phone', 'event_date', 'wedding_date', 'location', 'hours', 'care', 'message', 'source', 'status', 'progress', 'tags', 'price_cents', 'paid_cents']);
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

function migrateAssistant(db) {
  db.exec(ASSISTANT_MIGRATION);
  const have = new Set(db.prepare('PRAGMA table_info(activity)').all().map((column) => column.name));
  if (!have.has('undone_at')) db.exec('ALTER TABLE activity ADD COLUMN undone_at TEXT');
  // Each conversation belongs to one model service, because each keeps its history in its own shape.
  const columns = new Set(db.prepare('PRAGMA table_info(conversations)').all().map((column) => column.name));
  if (!columns.has('provider')) db.exec("ALTER TABLE conversations ADD COLUMN provider TEXT NOT NULL DEFAULT 'anthropic'");
}

const mapDraft = (row) => ({ id: String(row.id), inquiry_id: String(row.inquiry_id), created_at: row.created_at, subject: row.subject, body: row.body, names: row.names || undefined });
const toDollars = (cents) => (cents === null || cents === undefined ? null : Number(cents) / 100);

function assistantMethods({ use, timeZone }) {
  return {
    // The chat conversation in use: the newest one, or a new one when asked or when there is none.
    conversation: (fresh = false, provider = 'anthropic') => use((db) => {
      if (!fresh) {
        const row = db.prepare("SELECT id FROM conversations WHERE kind = 'chat' AND provider = ? ORDER BY id DESC LIMIT 1").get(provider);
        if (row) return row.id;
      }
      return Number(db.prepare("INSERT INTO conversations (kind, provider) VALUES ('chat', ?) RETURNING id").get(provider).id);
    }),

    triageConversation: (inquiryId, provider = 'anthropic') => use((db) => Number(db.prepare("INSERT INTO conversations (kind, inquiry_id, provider) VALUES ('triage', ?, ?) RETURNING id").get(Number(inquiryId), provider).id)),

    // A message with fields besides role and content (OpenRouter's tool_calls and tool_call_id) is kept whole.
    history: (conversation) => use((db) => db.prepare('SELECT role, content FROM assistant_messages WHERE conversation = ? ORDER BY id')
      .all(Number(conversation)).map((row) => {
        const content = JSON.parse(row.content);
        return content && typeof content === 'object' && !Array.isArray(content) && content.message ? content.message : { role: row.role, content };
      })),

    userTurns: (conversation) => use((db) => db.prepare("SELECT count(*) AS n FROM assistant_turns WHERE conversation = ? AND who = 'you'").get(Number(conversation)).n),

    // Saved only once a whole exchange has finished, so the history sent to the model is only ever added to.
    saveExchange: (conversation, messages, turns) => use((db) => {
      db.exec('BEGIN');
      try {
        const message = db.prepare('INSERT INTO assistant_messages (conversation, role, content) VALUES (?, ?, ?)');
        for (const m of messages) {
          const whole = Object.keys(m).some((key) => key !== 'role' && key !== 'content');
          message.run(Number(conversation), m.role, JSON.stringify(whole ? { message: m } : m.content));
        }
        const turn = db.prepare('INSERT INTO assistant_turns (conversation, who, text, events) VALUES (?, ?, ?, ?)');
        for (const t of turns) turn.run(Number(conversation), t.who, String(t.text || ''), JSON.stringify(t.events || []));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }),

    turns: (conversation) => use((db) => db.prepare('SELECT id, at, who, text, events FROM assistant_turns WHERE conversation = ? ORDER BY id')
      .all(Number(conversation)).map((row) => ({ id: String(row.id), at: row.at, who: row.who, text: row.text, events: JSON.parse(row.events || '[]') }))),

    // Couples by name, email, place or tag, and by stage. Plain facts only; the assistant reads one couple in full with getInquiry.
    findCouples: ({ query = '', stage = '' } = {}) => use((db) => {
      const where = [];
      const params = [];
      if (query) {
        const pattern = `%${String(query).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        where.push("(names LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR event_date LIKE ? ESCAPE '\\')");
        params.push(pattern, pattern, pattern, pattern, pattern);
      }
      if (stage) {
        if (['planning', 'editing', 'delivered'].includes(stage)) { where.push("status = 'booked' AND progress = ?"); params.push(stage); }
        else if (stage === 'booked') where.push("status = 'booked' AND progress IS NULL");
        else { where.push('status = ?'); params.push(stage); }
      }
      return db.prepare(`SELECT id, names, email, wedding_date, event_date, location, status, progress, tags, price_cents, paid_cents, created_at
          FROM inquiries ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(wedding_date, '9999'), created_at DESC LIMIT 40`).all(...params)
        .map((row) => ({
          id: String(row.id), names: row.names, email: row.email, wedding_date: row.wedding_date, date_as_written: row.event_date || undefined,
          location: row.location, stage: stageOf(row.status, row.progress), tags: parseTags(row.tags),
          price: toDollars(row.price_cents), paid: toDollars(row.paid_cents), received: row.created_at
        }));
    }),

    // Who else has this date: booked weddings and couples still talking about it.
    onDate: (date) => use((db) => db.prepare(`SELECT id, names, email, status, progress, location FROM inquiries
        WHERE wedding_date = ? AND status <> 'not_booked' ORDER BY status = 'booked' DESC, names`).all(date)
      .map((row) => ({ id: String(row.id), names: row.names || row.email, stage: stageOf(row.status, row.progress), location: row.location }))),

    addDraft: (inquiryId, subject, body, actor = 'assistant') => use((db) => {
      const couple = db.prepare('SELECT names, email FROM inquiries WHERE id = ?').get(Number(inquiryId));
      if (!couple) return null;
      const row = db.prepare('INSERT INTO drafts (inquiry_id, subject, body) VALUES (?, ?, ?) RETURNING *').get(Number(inquiryId), String(subject).slice(0, 200), String(body).slice(0, 8000));
      logActivity(db, { inquiryId, actor, kind: 'draft', summary: `Drafted a reply: ${row.subject}`, after: { draft: row.id } });
      return mapDraft({ ...row, names: couple.names || couple.email });
    }),

    drafts: (inquiryId) => use((db) => db.prepare('SELECT * FROM drafts WHERE inquiry_id = ? AND discarded_at IS NULL ORDER BY id DESC').all(Number(inquiryId)).map(mapDraft)),

    draftCounts: () => use((db) => Object.fromEntries(db.prepare('SELECT inquiry_id, count(*) AS n FROM drafts WHERE discarded_at IS NULL GROUP BY inquiry_id').all()
      .map((row) => [String(row.inquiry_id), row.n]))),

    discardDraft: (id) => use((db) => db.prepare(`UPDATE drafts SET discarded_at = ${NOW} WHERE id = ? AND discarded_at IS NULL`).run(Number(id)).changes > 0),

    // Puts one recorded change back, if nothing has changed those values since. Returns what happened.
    undoActivity: (id) => use((db) => {
      const row = db.prepare('SELECT * FROM activity WHERE id = ?').get(Number(id));
      if (!row) return { error: 'Not found.', status: 404 };
      if (row.undone_at) return { error: 'That was undone already.', status: 409 };
      const before = row.before ? JSON.parse(row.before) : null;
      const after = row.after ? JSON.parse(row.after) : null;
      const done = (gone = false) => {
        db.prepare(`UPDATE activity SET undone_at = ${NOW} WHERE id = ?`).run(row.id);
        logActivity(db, { inquiryId: gone ? null : row.inquiry_id, actor: 'you', kind: 'undo', summary: `Undid: ${row.summary}` });
        return { ok: true };
      };
      if (row.kind === 'change' && before && after && row.inquiry_id !== null) {
        const columns = Object.keys(after).filter((column) => UNDOABLE.has(column));
        if (!columns.length) return { error: 'This change can’t be undone.', status: 409 };
        const now = db.prepare(`SELECT ${columns.map(quote).join(', ')} FROM inquiries WHERE id = ?`).get(row.inquiry_id);
        if (!now) return { error: 'That couple is gone.', status: 409 };
        if (columns.some((column) => now[column] !== after[column])) return { error: 'It has been changed again since, so it wasn’t undone.', status: 409 };
        db.prepare(`UPDATE inquiries SET ${columns.map((column) => `${quote(column)} = ?`).join(', ')}, updated_at = ${NOW} WHERE id = ?`)
          .run(...columns.map((column) => before[column]), row.inquiry_id);
        syncTasks(db, row.inquiry_id, localDay(timeZone));
        return done();
      }
      if (row.kind === 'task' && after && after.task && 'done' in after) {
        db.prepare('UPDATE tasks SET done_at = ? WHERE id = ?').run(before ? before.done_at : null, after.task);
        return done();
      }
      if (row.kind === 'task' && after && after.task) {
        db.prepare('DELETE FROM tasks WHERE id = ?').run(after.task);
        return done();
      }
      if (row.kind === 'note' && after && after.note) {
        db.prepare('DELETE FROM notes WHERE id = ?').run(after.note);
        return done();
      }
      if (row.kind === 'timeline' && after && after.timeline) {
        db.prepare('DELETE FROM timeline_items WHERE id = ?').run(after.timeline);
        return done();
      }
      if (row.kind === 'draft' && after && after.draft) {
        db.prepare(`UPDATE drafts SET discarded_at = ${NOW} WHERE id = ?`).run(after.draft);
        return done();
      }
      if (row.kind === 'inquiry' && row.actor === 'assistant' && row.inquiry_id !== null) {
        db.prepare('DELETE FROM inquiries WHERE id = ?').run(row.inquiry_id);
        return done(true);
      }
      return { error: 'This change can’t be undone.', status: 409 };
    })
  };
}

module.exports = { ASSISTANT_MIGRATION, migrateAssistant, assistantMethods };
