// Contracts: Alex fills in the agreement for a couple, signs it once, and sends the couple a private
// link where they read it and sign. The signed words are fingerprinted (SHA-256) and kept with who
// signed, when, and from where, so the record shows exactly what was agreed.
const crypto = require('node:crypto');
const ContractDoc = require('../../contract/contract-doc');
const { logActivity } = require('./work');
const { localDay } = require('./analytics');

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const SIGNATURE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const SIGNATURE_MAX = 400000;

const CONTRACTS_MIGRATION = `
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  fields TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed')),
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW}),
  sent_at TEXT,
  viewed_at TEXT,
  photographer_signature TEXT,
  photographer_signed_at TEXT,
  client_signature TEXT,
  client_signed_name TEXT,
  client_signed_at TEXT,
  client_ip TEXT,
  client_agent TEXT,
  document_text TEXT,
  document_hash TEXT
);
CREATE INDEX IF NOT EXISTS contracts_inquiry_idx ON contracts (inquiry_id, id);
`;

const migrateContracts = (db) => db.exec(CONTRACTS_MIGRATION);

// A drawn signature: a PNG image as a data address, not too large, and really a PNG.
function validSignature(value) {
  if (typeof value !== 'string' || value.length > SIGNATURE_MAX || !SIGNATURE.test(value)) return false;
  const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
  return bytes.length > 100 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

const hours = (text) => {
  const match = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b)/i.exec(String(text || ''));
  return match ? Number(match[1]) : null;
};

// A new agreement starts from what the dashboard knows about the couple.
function prefill(inquiry) {
  const values = ContractDoc.defaults();
  values.client_name = inquiry.names || '';
  values.client_email = inquiry.email || '';
  values.client_phone = inquiry.phone || '';
  values.event_date = inquiry.wedding_date || '';
  values.event_locations = inquiry.location || '';
  const price = inquiry.price_cents ? inquiry.price_cents / 100 : 0;
  values.package_price = price;
  // Alex's retainer is 30% of the price.
  values.retainer = price ? Math.round(price * 0.3 * 100) / 100 : 0;
  const coverage = hours(inquiry.hours);
  if (coverage) values.coverage_hours = coverage;
  if (/second photographer/i.test(inquiry.fields || '')) values.photographers = 2;
  if (/engagement session/i.test(inquiry.fields || '')) values.engagement_session = 'Yes';
  return ContractDoc.clean(values);
}

const mapContract = (row, { withSignatures = true, withAudit = true } = {}) => ({
  id: String(row.id),
  inquiry_id: String(row.inquiry_id),
  token: row.token,
  status: row.status,
  fields: ContractDoc.clean(JSON.parse(row.fields || '{}')),
  created_at: row.created_at,
  updated_at: row.updated_at,
  sent_at: row.sent_at || null,
  viewed_at: row.viewed_at || null,
  photographer: { signed_at: row.photographer_signed_at || null, signature: withSignatures ? row.photographer_signature || null : undefined },
  client: {
    signed_at: row.client_signed_at || null,
    name: row.client_signed_name || null,
    signature: withSignatures ? row.client_signature || null : undefined,
    ...(withAudit ? { ip: row.client_ip || null, agent: row.client_agent || null } : {})
  },
  document_hash: row.document_hash || null
});

// Once a couple signs, the payments in the contract become the payment schedule (unless one was made
// already): the retainer due now and the balance the contract's number of days before the event.
function scheduleFromContract(db, inquiryId, fields) {
  if (db.prepare('SELECT count(*) AS n FROM payments WHERE inquiry_id = ?').get(Number(inquiryId)).n) return;
  const w = ContractDoc.words(fields);
  const cents = (money) => Math.round(Number(String(money).replace(/[$,]/g, '')) * 100);
  const total = cents(w.total);
  const retainer = cents(w.retainer);
  if (!total) return;
  const today = localDay(process.env.STUDIO_TIMEZONE || 'America/Los_Angeles');
  let balanceDue = null;
  if (fields.event_date) {
    const [y, m, d] = fields.event_date.split('-').map(Number);
    balanceDue = new Date(Date.UTC(y, m - 1, d - (Number(fields.balance_days) || 0))).toISOString().slice(0, 10);
    if (balanceDue < today) balanceDue = today;
  }
  const insert = db.prepare('INSERT INTO payments (inquiry_id, label, amount_cents, due_date) VALUES (?, ?, ?, ?)');
  if (retainer) insert.run(Number(inquiryId), 'Retainer', retainer, today);
  if (total - retainer > 0) insert.run(Number(inquiryId), 'Balance', total - retainer, balanceDue);
  const couple = db.prepare('SELECT price_cents FROM inquiries WHERE id = ?').get(Number(inquiryId));
  if (couple && couple.price_cents === null) db.prepare('UPDATE inquiries SET price_cents = ? WHERE id = ?').run(total, Number(inquiryId));
  logActivity(db, { inquiryId, actor: 'website', kind: 'payment', summary: `Made the payment schedule from the signed contract: ${w.retainer} retainer, ${w.balance} balance` });
}

function contractMethods({ use }) {
  const get = (db, id) => db.prepare('SELECT * FROM contracts WHERE id = ?').get(Number(id));

  return {
    contractsFor: (inquiryId) => use((db) => db.prepare('SELECT * FROM contracts WHERE inquiry_id = ? ORDER BY id DESC').all(Number(inquiryId))
      .map((row) => mapContract(row, { withSignatures: false }))),

    contract: (id) => use((db) => {
      const row = get(db, id);
      return row ? mapContract(row) : null;
    }),

    createContract: (inquiryId, actor = 'you') => use((db) => {
      const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(Number(inquiryId));
      if (!inquiry) return null;
      const row = db.prepare('INSERT INTO contracts (inquiry_id, token, version, fields) VALUES (?, ?, ?, ?) RETURNING *')
        .get(Number(inquiryId), crypto.randomBytes(24).toString('base64url'), ContractDoc.VERSION, JSON.stringify(prefill(inquiry)));
      logActivity(db, { inquiryId, actor, kind: 'contract', summary: 'Started a contract' });
      return mapContract(row);
    }),

    // Only a draft can be changed. A sent contract is taken back first; a signed one never changes.
    saveContract: (id, fields) => use((db) => {
      const row = get(db, id);
      if (!row) return null;
      if (row.status !== 'draft') return { error: row.status === 'signed' ? 'A signed contract can’t be changed.' : 'Take the contract back before changing it.' };
      db.prepare(`UPDATE contracts SET fields = ?, updated_at = ${NOW} WHERE id = ?`).run(JSON.stringify(ContractDoc.clean(fields)), Number(id));
      return mapContract(get(db, id));
    }),

    deleteContract: (id) => use((db) => {
      const row = get(db, id);
      if (!row) return null;
      if (row.status === 'signed') return { error: 'A signed contract is kept for the record.' };
      db.prepare('DELETE FROM contracts WHERE id = ?').run(Number(id));
      logActivity(db, { inquiryId: row.inquiry_id, kind: 'contract', summary: 'Deleted an unsigned contract' });
      return { ok: true };
    }),

    photographerSignature: () => use((db) => {
      const row = db.prepare('SELECT value FROM secrets WHERE name = ?').get('photographer-signature');
      return row ? Buffer.from(row.value).toString() : null;
    }),

    setPhotographerSignature: (dataUrl) => use((db) => {
      if (!validSignature(dataUrl)) return { error: 'Draw your signature first.' };
      db.prepare('INSERT INTO secrets (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run('photographer-signature', Buffer.from(dataUrl));
      return { ok: true };
    }),

    // Alex signs with the saved signature and the couple's link starts working.
    sendContract: (id) => use((db) => {
      const row = get(db, id);
      if (!row) return null;
      if (row.status === 'signed') return { error: 'This contract is already signed.' };
      const signature = db.prepare('SELECT value FROM secrets WHERE name = ?').get('photographer-signature');
      if (!signature) return { error: 'Add your signature first.' };
      const fields = ContractDoc.clean(JSON.parse(row.fields || '{}'));
      const missing = ContractDoc.missing(fields);
      if (missing.length) return { error: `Fill in ${missing.map((key) => ContractDoc.BY_KEY[key].label.toLowerCase()).join(', ')} first.`, missing };
      db.prepare(`UPDATE contracts SET status = 'sent', sent_at = ${NOW}, photographer_signature = ?, photographer_signed_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`)
        .run(Buffer.from(signature.value).toString(), Number(id));
      logActivity(db, { inquiryId: row.inquiry_id, kind: 'contract', summary: 'Signed the contract and made its link for the couple' });
      return mapContract(get(db, id));
    }),

    // Back to a draft, so it can be changed. The couple's link stops working until it is sent again.
    takeBackContract: (id) => use((db) => {
      const row = get(db, id);
      if (!row) return null;
      if (row.status !== 'sent') return { error: row.status === 'signed' ? 'A signed contract can’t be taken back.' : 'This contract hasn’t been sent.' };
      db.prepare(`UPDATE contracts SET status = 'draft', photographer_signature = NULL, photographer_signed_at = NULL, updated_at = ${NOW} WHERE id = ?`).run(Number(id));
      logActivity(db, { inquiryId: row.inquiry_id, kind: 'contract', summary: 'Took the contract back to change it' });
      return mapContract(get(db, id));
    }),

    // What the couple's page shows. Opening it the first time is recorded.
    contractForClient: (token) => use((db) => {
      if (!TOKEN.test(String(token || ''))) return null;
      const row = db.prepare("SELECT * FROM contracts WHERE token = ? AND status IN ('sent', 'signed')").get(String(token));
      if (!row) return null;
      if (!row.viewed_at && row.status === 'sent') {
        db.prepare(`UPDATE contracts SET viewed_at = ${NOW} WHERE id = ?`).run(row.id);
        logActivity(db, { inquiryId: row.inquiry_id, actor: 'website', kind: 'contract', summary: 'Opened the contract' });
      }
      const contract = mapContract(row, { withAudit: false });
      delete contract.token;
      delete contract.inquiry_id;
      delete contract.viewed_at;
      contract.can_fill = ContractDoc.FIELDS.filter((field) => field.client && !contract.fields[field.key]).map((field) => field.key);
      return contract;
    }),

    // The couple signs. Empty address or phone may be filled in now; nothing else can change.
    signContract: (token, { name, signature, address = '', phone = '', agree, ip = '', agent = '' }) => use((db) => {
      if (!TOKEN.test(String(token || ''))) return null;
      const row = db.prepare('SELECT * FROM contracts WHERE token = ?').get(String(token));
      if (!row || row.status === 'draft') return null;
      if (row.status === 'signed') return { error: 'This contract is already signed.', status: 409 };
      const signedName = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (signedName.length < 2) return { error: 'Type your full name.' };
      if (!validSignature(signature)) return { error: 'Sign in the box first.' };
      if (agree !== true) return { error: 'Tick the box to agree to sign electronically.' };
      const fields = ContractDoc.clean(JSON.parse(row.fields || '{}'));
      if (!fields.client_address) fields.client_address = String(address || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!fields.client_phone) fields.client_phone = String(phone || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      const text = ContractDoc.text(fields);
      const hash = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
      const result = db.prepare(`UPDATE contracts SET status = 'signed', fields = ?, client_signature = ?, client_signed_name = ?, client_signed_at = ${NOW},
          client_ip = ?, client_agent = ?, document_text = ?, document_hash = ?, updated_at = ${NOW} WHERE id = ? AND status = 'sent'`)
        .run(JSON.stringify(fields), signature, signedName, String(ip).slice(0, 100), String(agent).slice(0, 300), text, hash, row.id);
      if (!result.changes) return { error: 'This contract is already signed.', status: 409 };
      logActivity(db, { inquiryId: row.inquiry_id, actor: 'website', kind: 'contract', summary: `${signedName} signed the contract` });
      scheduleFromContract(db, row.inquiry_id, fields);
      return { ok: true, document_hash: hash };
    }),

    // For the couple's page once signed: their payments, and what's needed to start a card payment.
    contractPayments: (token) => use((db) => {
      if (!TOKEN.test(String(token || ''))) return null;
      const row = db.prepare("SELECT c.inquiry_id, c.fields, i.names, i.email FROM contracts c JOIN inquiries i ON i.id = c.inquiry_id WHERE c.token = ? AND c.status = 'signed'").get(String(token));
      if (!row) return null;
      const fields = ContractDoc.clean(JSON.parse(row.fields || '{}'));
      const payments = db.prepare('SELECT id, label, amount_cents, due_date, paid_at, method FROM payments WHERE inquiry_id = ? ORDER BY due_date IS NULL, due_date, id').all(row.inquiry_id)
        .map((p) => ({ id: String(p.id), label: p.label, amount: p.amount_cents / 100, amount_cents: p.amount_cents, due_date: p.due_date, paid: Boolean(p.paid_at), paid_at: p.paid_at || null, method: p.method || null }));
      return { inquiry_id: String(row.inquiry_id), names: row.names || fields.client_name, email: row.email || fields.client_email, event_date: fields.event_date, methods: fields.payment_methods, payments };
    }),

    // Couples whose contract went out and isn't signed yet, for the Today page.
    contractsWaiting: () => use((db) => db.prepare(`SELECT c.inquiry_id, c.sent_at, c.viewed_at, i.names, i.email FROM contracts c JOIN inquiries i ON i.id = c.inquiry_id
        WHERE c.status = 'sent' ORDER BY c.sent_at`).all()
      .map((row) => ({ inquiry_id: String(row.inquiry_id), names: row.names || row.email, sent_at: row.sent_at, viewed: Boolean(row.viewed_at) })))
  };
}

module.exports = { CONTRACTS_MIGRATION, migrateContracts, contractMethods, validSignature, prefill, TOKEN };
