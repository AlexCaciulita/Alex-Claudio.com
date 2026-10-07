// Storage for the studio dashboard.
// The dashboard keeps its own tables in a separate "dashboard" schema, so they never collide with
// whatever an earlier dashboard left in the same database. Older tables are only ever read.
const crypto = require('node:crypto');
const { parseWeddingDate } = require('./dates');

const STATUSES = ['new', 'replied', 'booked', 'not_booked'];
const TEXT_LIMITS = { names: 300, email: 300, phone: 100, event_date: 200, location: 300, hours: 100, care: 1000, message: 5000, source: 300 };
const SUBMISSION_HIDDEN = new Set(['company', 'form-name', 'bot-field']);
const HIDDEN_COLUMN = /password|passwd|passcode|pwd|(^|_)pass($|_)|hash|digest|secret|token|salt|api_?key|private_?key|credential|(^|_)(otp|totp|mfa)($|_)|session_?(id|key|token|data)|^(sid|sess)$|cookie|cvv|cvc|card_?num/i;
const ORDER_COLUMNS = ['created_at', 'createdat', 'created', 'submitted_at', 'inserted_at', 'received_at', 'inserted', 'timestamp', 'date', 'updated_at'];
const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'dashboard'];
const PAGE_SIZE = 50;
const INQUIRY_COLUMNS = 'i.id, i.created_at, i.updated_at, i.form_name, i.names, i.email, i.phone, i.event_date, i.wedding_date, i.location, i.hours, i.care, i.message, i.source, i.status, i.price, i.paid';

const MIGRATION = `
CREATE SCHEMA IF NOT EXISTS dashboard;
CREATE TABLE IF NOT EXISTS dashboard.inquiries (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  form_name TEXT NOT NULL DEFAULT 'manual',
  names TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  wedding_date DATE,
  location TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT '',
  care TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'replied', 'booked', 'not_booked')),
  price NUMERIC(12, 2) CHECK (price >= 0),
  paid NUMERIC(12, 2) CHECK (paid >= 0),
  fields JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS inquiries_created_idx ON dashboard.inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS inquiries_wedding_idx ON dashboard.inquiries (wedding_date);
CREATE TABLE IF NOT EXISTS dashboard.notes (
  id BIGSERIAL PRIMARY KEY,
  inquiry_id BIGINT NOT NULL REFERENCES dashboard.inquiries(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_inquiry_idx ON dashboard.notes (inquiry_id, created_at);
CREATE TABLE IF NOT EXISTS dashboard.secrets (
  name TEXT PRIMARY KEY,
  value BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

function safeMessage(error) {
  const text = String((error && error.message) || error || 'Unknown error')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[connection string]');
  return `${error && error.code ? `${error.code}: ` : ''}${text}`.slice(0, 300);
}

function text(value, max) {
  if (value === null || value === undefined) return '';
  const joined = Array.isArray(value) ? value.join(', ') : String(value);
  return joined.trim().slice(0, max);
}

function connectionConfig(env) {
  const url = env.DATABASE_URL || env.DATABASE_PRIVATE_URL || '';
  if (url) return { connectionString: url };
  if (env.PGHOST) {
    return { host: env.PGHOST, port: env.PGPORT ? Number(env.PGPORT) : undefined, user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE };
  }
  return null;
}

function mapInquiry(row) {
  if (!row) return null;
  return {
    ...row,
    id: String(row.id),
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    paid: row.paid === null || row.paid === undefined ? null : Number(row.paid),
    note_count: row.note_count === undefined ? undefined : Number(row.note_count)
  };
}

function cell(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '[binary data]';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 2000);
  if (typeof value === 'string') return value.slice(0, 2000);
  return value;
}

function createStore(env = process.env, pgModule) {
  const config = connectionConfig(env);
  if (!config) return null;
  const pg = pgModule || require('pg');
  // DATE columns stay as plain "YYYY-MM-DD" strings, so no timezone can shift a wedding by a day.
  pg.types.setTypeParser(1082, (value) => value);
  let pool;
  try {
    pool = new pg.Pool({
      ...config,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
      query_timeout: 15000,
      application_name: 'alex-claudio-site'
    });
  } catch (error) {
    console.error('The database settings could not be read:', safeMessage(error));
    return null;
  }
  pool.on('error', (error) => console.error('Database connection error:', safeMessage(error)));

  // A connection string that can't be parsed throws inside pool.query; starting from a resolved
  // promise turns that into a rejection, so a bad DATABASE_URL never takes the website down.
  let migrated = null;
  const ready = () => {
    if (!migrated) {
      migrated = Promise.resolve()
        .then(() => pool.query(MIGRATION))
        .catch((error) => { migrated = null; throw error; });
    }
    return migrated;
  };
  const query = async (sql, params) => { await ready(); return pool.query(sql, params); };

  async function legacyTableNames() {
    const { rows } = await pool.query(
      `SELECT table_schema AS schema, table_name AS name
         FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema <> ALL($1::text[])
          AND table_schema NOT LIKE 'pg\\_%'
        ORDER BY table_schema, table_name
        LIMIT 200`,
      [SYSTEM_SCHEMAS]
    );
    return rows;
  }

  async function legacyColumns(schema, name) {
    const { rows } = await pool.query(
      `SELECT column_name AS name, data_type AS type
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
      [schema, name]
    );
    return rows.map((column) => ({ ...column, hidden: HIDDEN_COLUMN.test(column.name) }));
  }

  return {
    ready,

    async ping() {
      try {
        const { rows } = await pool.query("SELECT current_database() AS database, current_setting('server_version') AS version");
        return { configured: true, connected: true, database: rows[0].database, version: rows[0].version };
      } catch (error) {
        return { configured: true, connected: false, error: safeMessage(error) };
      }
    },

    // A random key made once and kept here, for signing things only this server should be able to sign.
    async deviceSecret() {
      await query("INSERT INTO dashboard.secrets (name, value) VALUES ('device', $1) ON CONFLICT (name) DO NOTHING", [crypto.randomBytes(32)]);
      const { rows } = await query("SELECT value FROM dashboard.secrets WHERE name = 'device'");
      return rows[0].value;
    },

    async insertInquiry(formName, data) {
      const names = text(data.names || data.name, TEXT_LIMITS.names);
      const eventDate = text(data.event_date, TEXT_LIMITS.event_date);
      const fields = {};
      for (const [key, value] of Object.entries(data || {}).slice(0, 40)) {
        if (SUBMISSION_HIDDEN.has(key)) continue;
        const v = text(value, 2000);
        if (v) fields[String(key).slice(0, 60)] = v;
      }
      const { rows } = await query(
        `INSERT INTO dashboard.inquiries
           (form_name, names, email, phone, event_date, wedding_date, location, hours, care, message, source, fields)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          text(formName, 60) || 'contact', names, text(data.email, TEXT_LIMITS.email),
          text(data.phone || data.phone_number, TEXT_LIMITS.phone), eventDate, parseWeddingDate(eventDate),
          text(data.location, TEXT_LIMITS.location), text(data.hours, TEXT_LIMITS.hours), text(data.care, TEXT_LIMITS.care),
          text(data.message, TEXT_LIMITS.message), text(data.source || data.referral, TEXT_LIMITS.source), JSON.stringify(fields)
        ]
      );
      return String(rows[0].id);
    },

    async listInquiries({ q = '', status = '' } = {}) {
      const params = [];
      const where = [];
      if (q) {
        params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        const p = `$${params.length}`;
        where.push(`(i.names ILIKE ${p} OR i.email ILIKE ${p} OR i.phone ILIKE ${p} OR i.location ILIKE ${p} OR i.event_date ILIKE ${p} OR i.care ILIKE ${p} OR i.message ILIKE ${p} OR i.source ILIKE ${p})`);
      }
      if (status) {
        params.push(status);
        where.push(`i.status = $${params.length}`);
      }
      const { rows } = await query(
        `SELECT ${INQUIRY_COLUMNS},
                (SELECT count(*) FROM dashboard.notes n WHERE n.inquiry_id = i.id) AS note_count
           FROM dashboard.inquiries i
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY i.created_at DESC
          LIMIT 500`,
        params
      );
      return rows.map(mapInquiry);
    },

    async getInquiry(id) {
      const { rows } = await query(`SELECT ${INQUIRY_COLUMNS}, i.fields FROM dashboard.inquiries i WHERE i.id = $1`, [id]);
      if (!rows.length) return null;
      const notes = await query('SELECT id, created_at, body FROM dashboard.notes WHERE inquiry_id = $1 ORDER BY created_at DESC, id DESC', [id]);
      return { inquiry: mapInquiry(rows[0]), notes: notes.rows.map((note) => ({ ...note, id: String(note.id) })) };
    },

    async createInquiry(fields) {
      const columns = Object.keys(fields);
      const values = columns.map((column) => fields[column]);
      const { rows } = await query(
        `INSERT INTO dashboard.inquiries (form_name${columns.map((c) => `, ${quoteIdent(c)}`).join('')})
         VALUES ('manual'${columns.map((_, n) => `, $${n + 1}`).join('')})
         RETURNING id`,
        values
      );
      return (await this.getInquiry(String(rows[0].id))).inquiry;
    },

    async updateInquiry(id, fields) {
      const columns = Object.keys(fields);
      if (!columns.length) {
        const found = await this.getInquiry(id);
        return found && found.inquiry;
      }
      const sets = columns.map((column, n) => `${quoteIdent(column)} = $${n + 2}`);
      const { rowCount } = await query(
        `UPDATE dashboard.inquiries SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        [id, ...columns.map((column) => fields[column])]
      );
      if (!rowCount) return null;
      return (await this.getInquiry(id)).inquiry;
    },

    async deleteInquiry(id) {
      const { rowCount } = await query('DELETE FROM dashboard.inquiries WHERE id = $1', [id]);
      return rowCount > 0;
    },

    async addNote(inquiryId, body) {
      const { rows } = await query(
        `INSERT INTO dashboard.notes (inquiry_id, body)
         SELECT id, $2 FROM dashboard.inquiries WHERE id = $1
         RETURNING id, created_at, body`,
        [inquiryId, body]
      );
      return rows.length ? { ...rows[0], id: String(rows[0].id) } : null;
    },

    async deleteNote(id) {
      const { rowCount } = await query('DELETE FROM dashboard.notes WHERE id = $1', [id]);
      return rowCount > 0;
    },

    async stats() {
      const { rows } = await query(
        `SELECT count(*) FILTER (WHERE status = 'new')::int AS new,
                count(*) FILTER (WHERE status = 'replied')::int AS replied,
                count(*) FILTER (WHERE status = 'booked')::int AS booked,
                count(*) FILTER (WHERE status = 'booked' AND wedding_date >= CURRENT_DATE)::int AS upcoming,
                count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS last30,
                count(*)::int AS total,
                COALESCE(sum(price) FILTER (WHERE status = 'booked' AND date_part('year', wedding_date) = date_part('year', CURRENT_DATE)), 0)::float8 AS year_agreed,
                COALESCE(sum(paid) FILTER (WHERE status = 'booked' AND date_part('year', wedding_date) = date_part('year', CURRENT_DATE)), 0)::float8 AS year_paid,
                date_part('year', CURRENT_DATE)::int AS year
           FROM dashboard.inquiries`
      );
      return rows[0];
    },

    async calendar(from, to) {
      const { rows } = await query(
        `SELECT id, names, email, wedding_date, status, location, hours
           FROM dashboard.inquiries
          WHERE wedding_date BETWEEN $1 AND $2 AND status <> 'not_booked'
          ORDER BY wedding_date, names`,
        [from, to]
      );
      return rows.map((row) => ({ ...row, id: String(row.id) }));
    },

    async legacyTables() {
      const tables = [];
      for (const table of await legacyTableNames()) {
        const columns = await legacyColumns(table.schema, table.name);
        let rows = null;
        try {
          const result = await pool.query(`SELECT count(*)::bigint AS n FROM ${quoteIdent(table.schema)}.${quoteIdent(table.name)}`);
          rows = Number(result.rows[0].n);
        } catch (error) {
          rows = null;
        }
        tables.push({ ...table, rows, columns: columns.length, hidden: columns.filter((c) => c.hidden).map((c) => c.name) });
      }
      return tables;
    },

    async legacyRows(schema, name, page = 0) {
      const known = (await legacyTableNames()).some((t) => t.schema === schema && t.name === name);
      if (!known) return null;
      const columns = await legacyColumns(schema, name);
      const visible = columns.filter((c) => !c.hidden);
      const orderBy = ORDER_COLUMNS
        .map((wanted) => columns.find((c) => c.name.toLowerCase() === wanted && /date|time/.test(c.type)))
        .find(Boolean);
      const from = `${quoteIdent(schema)}.${quoteIdent(name)}`;
      const total = Number((await pool.query(`SELECT count(*)::bigint AS n FROM ${from}`)).rows[0].n);
      let rows = [];
      if (visible.length) {
        const result = await pool.query(
          `SELECT ${visible.map((c) => quoteIdent(c.name)).join(', ')} FROM ${from}
           ${orderBy ? `ORDER BY ${quoteIdent(orderBy.name)} DESC NULLS LAST` : ''}
           LIMIT ${PAGE_SIZE} OFFSET $1`,
          [Math.max(0, page) * PAGE_SIZE]
        );
        rows = result.rows.map((row) => visible.map((c) => cell(row[c.name])));
      }
      return {
        schema, name, total, page, pageSize: PAGE_SIZE,
        columns: visible.map((c) => ({ name: c.name, type: c.type })),
        hidden: columns.filter((c) => c.hidden).map((c) => c.name),
        orderedBy: orderBy ? orderBy.name : null,
        rows
      };
    },

    close: () => pool.end()
  };
}

module.exports = { createStore, safeMessage, STATUSES, TEXT_LIMITS };
