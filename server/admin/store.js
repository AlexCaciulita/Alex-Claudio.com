// Storage for the studio dashboard: a SQLite file on the website's Railway volume.
// The dashboard keeps its own file (studio.sqlite). The earlier dashboard's file is never opened
// where it lies: it is copied to a temporary folder, and only that copy is read.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isValidIsoDate, parseWeddingDate } = require('./dates');

const STATUSES = ['new', 'replied', 'booked', 'not_booked'];
const TEXT_LIMITS = { names: 300, email: 300, phone: 100, event_date: 200, location: 300, hours: 300, care: 1000, message: 5000, source: 300 };
const SUBMISSION_HIDDEN = new Set(['company', 'form-name', 'bot-field']);
const HIDDEN_COLUMN = /password|passwd|passcode|pwd|(^|_)pass($|_)|hash|digest|secret|token|salt|api_?key|private_?key|credential|(^|_)(otp|totp|mfa)($|_)|session_?(id|key|token|data)|^(sid|sess)$|cookie|cvv|cvc|card_?num/i;
const HIDDEN_TABLES = new Set(['sessions', 'session']);
const ORDER_COLUMNS = ['created_at', 'createdat', 'created', 'submitted_at', 'inserted_at', 'received_at', 'occurred_at', 'attempted_at', 'applied_at', 'inserted', 'timestamp', 'date', 'updated_at'];
const PAGE_SIZE = 50;
const BACKUPS_KEPT = 30;
const BACKUP_FILE = /^studio-\d{4}-\d{2}-\d{2}\.sqlite$/;
const EARLIER = 'earlier-dashboard';
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const INQUIRY_COLUMNS = 'i.id, i.created_at, i.updated_at, i.form_name, i.names, i.email, i.phone, i.event_date, i.wedding_date, i.location, i.hours, i.care, i.message, i.source, i.status, i.price_cents, i.paid_cents';
const COLUMN_FOR = { price: 'price_cents', paid: 'paid_cents' };
const WRITABLE = new Set(['names', 'email', 'phone', 'event_date', 'wedding_date', 'location', 'hours', 'care', 'message', 'source', 'status', 'price', 'paid']);

const MIGRATION = `
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  form_name TEXT NOT NULL DEFAULT 'manual',
  names TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  wedding_date TEXT CHECK (wedding_date IS NULL OR wedding_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  location TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT '',
  care TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'replied', 'booked', 'not_booked')),
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  paid_cents INTEGER CHECK (paid_cents IS NULL OR paid_cents >= 0),
  fields TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS inquiries_created_idx ON inquiries (created_at);
CREATE INDEX IF NOT EXISTS inquiries_wedding_idx ON inquiries (wedding_date);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_inquiry_idx ON notes (inquiry_id, created_at);
CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  value BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);
CREATE TABLE IF NOT EXISTS imports (
  source TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  inquiry_id INTEGER,
  imported_at TEXT NOT NULL DEFAULT (${NOW}),
  PRIMARY KEY (source, legacy_id)
);
`;

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const toCents = (dollars) => (dollars === null || dollars === undefined ? null : Math.round(Number(dollars) * 100));
const toDollars = (cents) => (cents === null || cents === undefined ? null : Number(cents) / 100);

function safeMessage(error) {
  const text = String((error && error.message) || error || 'Unknown error');
  return `${error && error.code ? `${error.code}: ` : ''}${text}`.slice(0, 300);
}

function text(value, max) {
  if (value === null || value === undefined) return '';
  const joined = Array.isArray(value) ? value.join(', ') : String(value);
  return joined.trim().slice(0, max);
}

function cell(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return '[binary data]';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 2000);
  if (typeof value === 'string') return value.slice(0, 2000);
  return value;
}

function mapInquiry(row, withFields = false) {
  if (!row) return null;
  const { price_cents: price, paid_cents: paid, fields, note_count: notes, ...rest } = row;
  const inquiry = { ...rest, id: String(row.id), price: toDollars(price), paid: toDollars(paid) };
  if (notes !== undefined) inquiry.note_count = Number(notes);
  if (withFields) {
    try { inquiry.fields = JSON.parse(fields || '{}'); } catch (error) { inquiry.fields = {}; }
  }
  return inquiry;
}

const mapNote = (row) => ({ id: String(row.id), created_at: row.created_at, body: row.body });

// "YYYY-MM-DD" for today where the studio is, so a wedding today still counts as ahead after 5 PM.
function todayIn(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (error) {
    return new Date().toISOString().slice(0, 10);
  }
}

const STAGES = {
  inquiry: 'new', lead: 'new', new: 'new', contacted: 'replied', replied: 'replied', proposal: 'replied', quoted: 'replied',
  booked: 'booked', editing: 'booked', delivered: 'booked', completed: 'booked', done: 'booked',
  lost: 'not_booked', declined: 'not_booked', cancelled: 'not_booked', canceled: 'not_booked', not_booked: 'not_booked'
};
const fmtDollars = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const wholeCents = (value) => (value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value)) : null);

// One wedding from the earlier dashboard, as an inquiry in this one. Its money was kept in cents.
function fromEarlierWedding(w) {
  const names = [w.partner1, w.partner2].map((part) => String(part || '').trim()).filter(Boolean).join(' & ');
  const stage = String(w.status || '').trim().toLowerCase();
  const date = isValidIsoDate(w.date) ? w.date : parseWeddingDate(w.date);
  const price = wholeCents(w.price);
  const deposit = wholeCents(w.deposit);
  const balance = wholeCents(w.balance);
  const depositPaid = String(w.deposit_status || '').toLowerCase() === 'paid';
  const fields = {};
  if (stage) fields['Stage in the earlier dashboard'] = stage.charAt(0).toUpperCase() + stage.slice(1);
  if (deposit) fields.Deposit = `${fmtDollars(deposit)} (${depositPaid ? 'paid' : String(w.deposit_status || 'not marked paid')})`;
  if (balance) fields.Balance = fmtDollars(balance) + (w.balance_date ? `, due ${w.balance_date}` : '');
  else if (w.balance_date) fields['Balance due'] = String(w.balance_date);
  if (w.start_time || w.end_time) fields.Time = `${w.start_time || '?'}\u2013${w.end_time || '?'}${w.timezone ? ` (${w.timezone})` : ''}`;
  if (w.tags) fields.Tags = String(w.tags).slice(0, 500);
  if (w.currency && String(w.currency).toUpperCase() !== 'USD') fields.Currency = String(w.currency);
  if (w.archived) fields['Archived in the earlier dashboard'] = 'Yes';
  return {
    created_at: /^\d{4}-\d{2}-\d{2}T/.test(String(w.created_at || '')) ? String(w.created_at) : null,
    updated_at: /^\d{4}-\d{2}-\d{2}T/.test(String(w.updated_at || '')) ? String(w.updated_at) : null,
    names: text(names, TEXT_LIMITS.names),
    email: text(w.email, TEXT_LIMITS.email),
    phone: text(w.phone, TEXT_LIMITS.phone),
    event_date: '',
    wedding_date: date || null,
    location: text(w.location, TEXT_LIMITS.location),
    hours: text(w.collection, TEXT_LIMITS.hours),
    source: text(w.source, TEXT_LIMITS.source),
    status: STAGES[stage] || 'booked',
    price_cents: price,
    paid_cents: depositPaid && deposit ? deposit : null,
    fields: JSON.stringify(fields)
  };
}

function storePaths(env) {
  const file = env.STUDIO_DB_PATH || (env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(env.RAILWAY_VOLUME_MOUNT_PATH, 'studio.sqlite') : '');
  if (!file) return null;
  return {
    file,
    backups: env.STUDIO_BACKUP_DIR || path.join(path.dirname(file), 'backups', 'studio'),
    earlier: env.DATABASE_PATH || '',
    timeZone: env.STUDIO_TIMEZONE || 'America/Los_Angeles'
  };
}

function createStore(env = process.env, sqlite) {
  const paths = storePaths(env);
  if (!paths) return null;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = sqlite || require('node:sqlite'));
  } catch (error) {
    console.error('This version of Node has no built-in SQLite:', safeMessage(error));
    return null;
  }

  let db = null;
  const open = () => {
    if (db) return db;
    if (paths.earlier && path.resolve(paths.earlier) === path.resolve(paths.file)) {
      throw new Error('STUDIO_DB_PATH must not point at the earlier dashboard\u2019s file.');
    }
    fs.mkdirSync(path.dirname(paths.file), { recursive: true });
    const handle = new DatabaseSync(paths.file);
    try {
      handle.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
      handle.exec(MIGRATION);
    } catch (error) {
      handle.close();
      throw error;
    }
    db = handle;
    return db;
  };
  const use = async (work) => work(open());

  // The earlier dashboard's file, read from a private copy. Its -wal file holds most of the data,
  // so both are copied; SQLite rebuilds the -shm index itself.
  const earlier = { db: null, dir: null, signature: null };
  const closeEarlier = () => {
    if (earlier.db) { try { earlier.db.close(); } catch (error) { /* already closed */ } }
    if (earlier.dir) fs.rmSync(earlier.dir, { recursive: true, force: true });
    earlier.db = null;
    earlier.dir = null;
    earlier.signature = null;
  };
  const openEarlier = () => {
    if (!paths.earlier || !fs.existsSync(paths.earlier)) return null;
    const parts = [paths.earlier, `${paths.earlier}-wal`];
    const signature = parts.map((part) => {
      try { const stat = fs.statSync(part); return `${stat.size}:${stat.mtimeMs}`; } catch (error) { return '-'; }
    }).join('|');
    if (earlier.db && earlier.signature === signature) return earlier.db;
    closeEarlier();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-earlier-'));
    try {
      for (const part of parts) if (fs.existsSync(part)) fs.copyFileSync(part, path.join(dir, path.basename(part)));
      earlier.db = new DatabaseSync(path.join(dir, path.basename(paths.earlier)));
      earlier.dir = dir;
      earlier.signature = signature;
    } catch (error) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    return earlier.db;
  };
  const earlierTables = (old) => old.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name").all()
    .map((row) => row.name)
    .filter((name) => !HIDDEN_TABLES.has(String(name).toLowerCase()));
  const earlierColumns = (old, name) => old.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all()
    .map((column) => ({ name: column.name, type: column.type || '', hidden: HIDDEN_COLUMN.test(column.name) }));

  // Copies the earlier dashboard's weddings and their notes into Inquiries, once each.
  const importEarlier = () => {
    const old = openEarlier();
    if (!old || !earlierTables(old).includes('weddings')) return 0;
    const target = open();
    const done = new Set(target.prepare('SELECT legacy_id FROM imports WHERE source = ?').all(EARLIER).map((row) => row.legacy_id));
    const weddings = old.prepare('SELECT * FROM weddings').all().filter((wedding) => !done.has(String(wedding.id)));
    if (!weddings.length) return 0;
    const notes = earlierTables(old).includes('notes')
      ? old.prepare('SELECT wedding_id, body, created_at FROM notes ORDER BY created_at').all()
      : [];
    const addInquiry = target.prepare(`INSERT INTO inquiries
      (created_at, updated_at, form_name, names, email, phone, event_date, wedding_date, location, hours, source, status, price_cents, paid_cents, fields)
      VALUES (COALESCE(?, ${NOW}), COALESCE(?, ${NOW}), '${EARLIER}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const addNote = target.prepare(`INSERT INTO notes (inquiry_id, body, created_at) VALUES (?, ?, COALESCE(?, ${NOW}))`);
    const remember = target.prepare('INSERT INTO imports (source, legacy_id, inquiry_id) VALUES (?, ?, ?)');
    target.exec('BEGIN IMMEDIATE');
    try {
      for (const wedding of weddings) {
        const row = fromEarlierWedding(wedding);
        const id = Number(addInquiry.run(row.created_at, row.updated_at, row.names, row.email, row.phone, row.event_date, row.wedding_date,
          row.location, row.hours, row.source, row.status, row.price_cents, row.paid_cents, row.fields).lastInsertRowid);
        for (const note of notes.filter((n) => n.wedding_id === wedding.id && String(n.body || '').trim())) {
          addNote.run(id, String(note.body).slice(0, 5000), /^\d{4}-\d{2}-\d{2}T/.test(String(note.created_at || '')) ? String(note.created_at) : null);
        }
        remember.run(EARLIER, String(wedding.id), id);
      }
      target.exec('COMMIT');
    } catch (error) {
      target.exec('ROLLBACK');
      throw error;
    }
    return weddings.length;
  };

  const listBackups = () => {
    let names = [];
    try { names = fs.readdirSync(paths.backups).filter((name) => BACKUP_FILE.test(name)).sort().reverse(); } catch (error) { names = []; }
    return names.map((name) => {
      let size = null;
      try { size = fs.statSync(path.join(paths.backups, name)).size; } catch (error) { size = null; }
      return { name, size };
    });
  };
  // One copy a day, made with VACUUM INTO so it is complete and consistent; the newest 30 are kept.
  const backupToday = () => {
    const target = open();
    fs.mkdirSync(paths.backups, { recursive: true });
    const file = path.join(paths.backups, `studio-${todayIn(paths.timeZone)}.sqlite`);
    if (fs.existsSync(file)) return null;
    target.prepare('VACUUM INTO ?').run(file);
    for (const old of listBackups().slice(BACKUPS_KEPT)) fs.rmSync(path.join(paths.backups, old.name), { force: true });
    return file;
  };

  let started = null;
  let timer = null;
  const ready = () => {
    if (!started) {
      started = Promise.resolve().then(() => {
        open();
        let imported = 0;
        try {
          imported = importEarlier();
          if (imported) console.log(`Copied ${imported} wedding${imported === 1 ? '' : 's'} from the earlier dashboard`);
        } catch (error) {
          console.error('Copying from the earlier dashboard failed:', safeMessage(error));
        }
        try { backupToday(); } catch (error) { console.error('The daily backup failed:', safeMessage(error)); }
        if (!timer) {
          timer = setInterval(() => {
            try { backupToday(); } catch (error) { console.error('The daily backup failed:', safeMessage(error)); }
          }, 6 * 60 * 60 * 1000);
          timer.unref();
        }
        return { imported };
      }).catch((error) => {
        started = null;
        throw error;
      });
    }
    return started;
  };

  const store = {
    ready,

    async ping() {
      try {
        const target = open();
        let size = null;
        try { size = fs.statSync(paths.file).size; } catch (error) { size = null; }
        let imported = 0;
        try { imported = target.prepare('SELECT count(*) AS n FROM imports WHERE source = ?').get(EARLIER).n; } catch (error) { imported = 0; }
        const backups = listBackups();
        return {
          configured: true,
          connected: true,
          engine: 'SQLite',
          version: target.prepare('SELECT sqlite_version() AS v').get().v,
          file: paths.file,
          size,
          backups: { folder: paths.backups, kept: BACKUPS_KEPT, count: backups.length, latest: backups[0] || null },
          earlier: paths.earlier ? { file: paths.earlier, found: fs.existsSync(paths.earlier), imported } : null
        };
      } catch (error) {
        return { configured: true, connected: false, file: paths.file, error: safeMessage(error) };
      }
    },

    // A random key made once and kept here, for signing things only this server should be able to sign.
    deviceSecret: () => use((target) => {
      target.prepare('INSERT OR IGNORE INTO secrets (name, value) VALUES (?, ?)').run('device', crypto.randomBytes(32));
      return Buffer.from(target.prepare('SELECT value FROM secrets WHERE name = ?').get('device').value);
    }),

    insertInquiry: (formName, data) => use((target) => {
      const names = text(data.names || data.name, TEXT_LIMITS.names);
      const eventDate = text(data.event_date, TEXT_LIMITS.event_date);
      const fields = {};
      for (const [key, value] of Object.entries(data || {}).slice(0, 40)) {
        if (SUBMISSION_HIDDEN.has(key)) continue;
        const v = text(value, 2000);
        if (v) fields[String(key).slice(0, 60)] = v;
      }
      const result = target.prepare(`INSERT INTO inquiries
          (form_name, names, email, phone, event_date, wedding_date, location, hours, care, message, source, fields)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        text(formName, 60) || 'contact', names, text(data.email, TEXT_LIMITS.email),
        text(data.phone || data.phone_number, TEXT_LIMITS.phone), eventDate, parseWeddingDate(eventDate),
        text(data.location, TEXT_LIMITS.location), text(data.hours, TEXT_LIMITS.hours), text(data.care, TEXT_LIMITS.care),
        text(data.message, TEXT_LIMITS.message), text(data.source || data.referral, TEXT_LIMITS.source), JSON.stringify(fields)
      );
      return String(result.lastInsertRowid);
    }),

    listInquiries: ({ q = '', status = '' } = {}) => use((target) => {
      const params = [];
      const where = [];
      if (q) {
        const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const searched = ['names', 'email', 'phone', 'location', 'event_date', 'hours', 'care', 'message', 'source'];
        where.push(`(${searched.map((column) => `i.${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
        params.push(...searched.map(() => pattern));
      }
      if (status) {
        where.push('i.status = ?');
        params.push(status);
      }
      return target.prepare(`SELECT ${INQUIRY_COLUMNS},
              (SELECT count(*) FROM notes n WHERE n.inquiry_id = i.id) AS note_count
         FROM inquiries i
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY i.created_at DESC, i.id DESC
         LIMIT 500`).all(...params).map((row) => mapInquiry(row));
    }),

    getInquiry: (id) => use((target) => {
      const row = target.prepare(`SELECT ${INQUIRY_COLUMNS}, i.fields FROM inquiries i WHERE i.id = ?`).get(Number(id));
      if (!row) return null;
      const notes = target.prepare('SELECT id, created_at, body FROM notes WHERE inquiry_id = ? ORDER BY created_at DESC, id DESC').all(Number(id));
      return { inquiry: mapInquiry(row, true), notes: notes.map(mapNote) };
    }),

    createInquiry: (fields) => use(async (target) => {
      const columns = Object.keys(fields).filter((key) => WRITABLE.has(key));
      const values = columns.map((key) => (COLUMN_FOR[key] ? toCents(fields[key]) : fields[key]));
      const result = target.prepare(`INSERT INTO inquiries (form_name${columns.map((key) => `, ${quoteIdent(COLUMN_FOR[key] || key)}`).join('')})
        VALUES ('manual'${columns.map(() => ', ?').join('')})`).run(...values);
      return (await store.getInquiry(String(result.lastInsertRowid))).inquiry;
    }),

    updateInquiry: (id, fields) => use(async (target) => {
      const columns = Object.keys(fields).filter((key) => WRITABLE.has(key));
      if (columns.length) {
        const sets = columns.map((key) => `${quoteIdent(COLUMN_FOR[key] || key)} = ?`);
        const values = columns.map((key) => (COLUMN_FOR[key] ? toCents(fields[key]) : fields[key]));
        const result = target.prepare(`UPDATE inquiries SET ${sets.join(', ')}, updated_at = ${NOW} WHERE id = ?`).run(...values, Number(id));
        if (!result.changes) return null;
      }
      const found = await store.getInquiry(id);
      return found && found.inquiry;
    }),

    deleteInquiry: (id) => use((target) => target.prepare('DELETE FROM inquiries WHERE id = ?').run(Number(id)).changes > 0),

    addNote: (inquiryId, body) => use((target) => {
      const row = target.prepare(`INSERT INTO notes (inquiry_id, body)
          SELECT id, ? FROM inquiries WHERE id = ?
          RETURNING id, created_at, body`).get(body, Number(inquiryId));
      return row ? mapNote(row) : null;
    }),

    deleteNote: (id) => use((target) => target.prepare('DELETE FROM notes WHERE id = ?').run(Number(id)).changes > 0),

    stats: () => use((target) => {
      const today = todayIn(paths.timeZone);
      const year = today.slice(0, 4);
      const row = target.prepare(`SELECT
          count(*) FILTER (WHERE status = 'new') AS new,
          count(*) FILTER (WHERE status = 'replied') AS replied,
          count(*) FILTER (WHERE status = 'booked') AS booked,
          count(*) FILTER (WHERE status = 'booked' AND wedding_date >= ?) AS upcoming,
          count(*) FILTER (WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')) AS last30,
          count(*) AS total,
          COALESCE(sum(price_cents) FILTER (WHERE status = 'booked' AND substr(wedding_date, 1, 4) = ?), 0) AS agreed,
          COALESCE(sum(paid_cents) FILTER (WHERE status = 'booked' AND substr(wedding_date, 1, 4) = ?), 0) AS paid
        FROM inquiries`).get(today, year, year);
      return {
        new: row.new, replied: row.replied, booked: row.booked, upcoming: row.upcoming, last30: row.last30, total: row.total,
        year_agreed: toDollars(row.agreed), year_paid: toDollars(row.paid), year: Number(year)
      };
    }),

    calendar: (from, to) => use((target) => target.prepare(`SELECT id, names, email, wedding_date, status, location, hours
         FROM inquiries
        WHERE wedding_date BETWEEN ? AND ? AND status <> 'not_booked'
        ORDER BY wedding_date, names`).all(from, to).map((row) => ({ ...row, id: String(row.id) }))),

    legacyTables: async () => {
      const old = openEarlier();
      if (!old) return [];
      return earlierTables(old).map((name) => {
        const columns = earlierColumns(old, name);
        let rows = null;
        try { rows = Number(old.prepare(`SELECT count(*) AS n FROM ${quoteIdent(name)}`).get().n); } catch (error) { rows = null; }
        return { schema: 'main', name, rows, columns: columns.length, hidden: columns.filter((c) => c.hidden).map((c) => c.name) };
      });
    },

    legacyRows: async (schema, name, page = 0) => {
      const old = openEarlier();
      if (!old || schema !== 'main' || !earlierTables(old).includes(name)) return null;
      const columns = earlierColumns(old, name);
      const visible = columns.filter((c) => !c.hidden);
      const orderBy = ORDER_COLUMNS.map((wanted) => columns.find((c) => c.name.toLowerCase() === wanted)).find(Boolean);
      const from = quoteIdent(name);
      const total = Number(old.prepare(`SELECT count(*) AS n FROM ${from}`).get().n);
      let rows = [];
      if (visible.length) {
        rows = old.prepare(`SELECT ${visible.map((c) => quoteIdent(c.name)).join(', ')} FROM ${from}
            ${orderBy ? `ORDER BY ${quoteIdent(orderBy.name)} DESC` : ''}
            LIMIT ${PAGE_SIZE} OFFSET ?`).all(Math.max(0, page) * PAGE_SIZE)
          .map((row) => visible.map((c) => cell(row[c.name])));
      }
      return {
        schema, name, total, page, pageSize: PAGE_SIZE,
        columns: visible.map((c) => ({ name: c.name, type: c.type })),
        hidden: columns.filter((c) => c.hidden).map((c) => c.name),
        orderedBy: orderBy ? orderBy.name : null,
        rows
      };
    },

    // A complete copy of the dashboard's file to download; the caller deletes it afterwards.
    snapshot: () => use((target) => {
      const file = path.join(os.tmpdir(), `studio-download-${crypto.randomBytes(8).toString('hex')}.sqlite`);
      target.prepare('VACUUM INTO ?').run(file);
      return file;
    }),

    backupToday: () => use(() => backupToday()),

    close: async () => {
      if (timer) clearInterval(timer);
      timer = null;
      closeEarlier();
      if (db) db.close();
      db = null;
      started = null;
    }
  };
  return store;
}

module.exports = { createStore, fromEarlierWedding, safeMessage, STATUSES, TEXT_LIMITS };
