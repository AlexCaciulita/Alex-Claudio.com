const { google } = require('googleapis');

const HIDDEN_FIELDS = new Set(['company', 'form-name', 'bot-field']);
const ALLOWED_FORMS = new Set(['contact', 'wedding-show-lead']);
const FIELD_LABELS = {
  names: 'Name',
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  phone_number: 'Phone',
  event_date: 'Event date',
  location: 'Venue / location',
  budget: 'Estimated budget',
  collection: 'Collection',
  hours: 'Coverage',
  care: 'The part of the day they care about most',
  message: 'Message',
  source: 'How they found you',
  referral: 'How they found you'
};

class SubmissionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function validateSubmission(formName, data) {
  if (!ALLOWED_FORMS.has(formName)) {
    throw new SubmissionError(400, 'Unknown form');
  }
  const email = String(data.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new SubmissionError(400, 'A valid email is required');
  }
  const required = formName === 'contact'
    ? ['names', 'event_date']
    : ['name'];
  if (required.some((field) => !String(data[field] || '').trim())) {
    throw new SubmissionError(400, 'Required fields are missing');
  }
}

async function sendResendEmail(formName, data) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  const to = process.env.CONTACT_TO_EMAIL || 'contact@alex-claudio.com';
  const from = process.env.CONTACT_FROM_EMAIL || 'Alex Claudio Site <onboarding@resend.dev>';
  const entries = Object.entries(data).filter(
    ([key, value]) => !HIDDEN_FIELDS.has(key) && value !== '' && value != null
  );
  const rowsHtml = entries.map(([key, value]) => {
    const label = FIELD_LABELS[key] || key;
    return `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;">${escapeHtml(value).replace(/\n/g, '<br>')}</td></tr>`;
  }).join('');
  const text = entries.map(([key, value]) => `${FIELD_LABELS[key] || key}: ${value}`).join('\n');
  const who = data.names || data.name || data.email;
  const body = {
    from,
    to: [to],
    subject: `New ${formName} inquiry — ${who}`,
    text,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;"><p style="margin:0 0 16px;">New <strong>${escapeHtml(formName)}</strong> submission from your website:</p><table style="border-collapse:collapse;">${rowsHtml}</table></div>`
  };
  if (data.email) body.reply_to = data.email;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Resend API ${response.status}: ${await response.text()}`);
  }
  return true;
}

async function appendToSheet(formName, data) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!sheetId || !clientEmail || !privateKeyRaw) return false;

  const jwt = new google.auth.JWT({
    email: clientEmail,
    key: privateKeyRaw.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth: jwt });
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: process.env.GOOGLE_SHEET_RANGE || 'Leads!A:F',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        new Date().toISOString(),
        formName,
        data.name || data.names || '',
        data.email || '',
        data.phone || data.phone_number || '',
        data.source || data.referral || ''
      ]]
    }
  });
  return true;
}

// options.save, when given, keeps a copy of the inquiry (the studio dashboard's database).
// The inquiry counts as delivered when any one of email, Sheet or database accepted it.
async function processSubmission(formName, data, { save = null } = {}) {
  validateSubmission(formName, data);
  const tasks = [
    ['Email delivery failed:', sendResendEmail(formName, data)],
    ['Sheet append failed:', appendToSheet(formName, data)]
  ];
  if (save) tasks.push(['Saving the inquiry failed:', Promise.resolve().then(() => save(formName, data)).then(() => true)]);
  const results = await Promise.allSettled(tasks.map(([, task]) => task));

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(tasks[index][0], result.reason);
    }
  });

  const delivered = results.some((result) => result.status === 'fulfilled' && result.value === true);
  if (!delivered) {
    throw new SubmissionError(503, 'Inquiry delivery is temporarily unavailable');
  }
}

module.exports = { SubmissionError, processSubmission, validateSubmission };
