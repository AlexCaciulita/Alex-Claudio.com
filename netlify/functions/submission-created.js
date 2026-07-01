const { google } = require('googleapis');

// Runs on every Netlify Form submission (contact + lead forms).
// It does two independent things, and one failing never blocks the other:
//   1. Emails the inquiry to you via Resend  (so you receive leads directly)
//   2. Appends the inquiry to a Google Sheet  (Excel-ready archive)
//
// Required env vars for EMAIL (set in Netlify → Site settings → Environment variables):
//   - RESEND_API_KEY:     your Resend API key (secret — never commit it)
// Optional:
//   - CONTACT_TO_EMAIL:   where to receive inquiries. Defaults to contact@alex-claudio.com.
//   - CONTACT_FROM_EMAIL: sender shown in your inbox. Defaults to Resend's shared
//                         "onboarding@resend.dev" so it works before you verify a domain.
//                         After verifying alex-claudio.com in Resend, set this to
//                         e.g. "Alex Claudio <contact@alex-claudio.com>".
//
// Optional env vars for the Google Sheet archive (unchanged from before):
//   - GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY
//   - GOOGLE_SHEET_RANGE (optional, defaults to "Leads!A:F")

// Fields we never want to surface in the email body.
const HIDDEN_FIELDS = new Set(['company', 'form-name', 'bot-field']);

// Friendlier labels for known field keys; anything else falls back to the raw key.
const FIELD_LABELS = {
  names: 'Name',
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  phone_number: 'Phone',
  event_date: 'Event date',
  location: 'Venue / location',
  budget: 'Estimated budget',
  message: 'Message',
  source: 'How they found you',
  referral: 'How they found you'
};

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function sendResendEmail(formName, data) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO_EMAIL || 'contact@alex-claudio.com';
  const from = process.env.CONTACT_FROM_EMAIL || 'Alex Claudio Site <onboarding@resend.dev>';

  if (!apiKey) {
    console.warn('Skipping email: RESEND_API_KEY not set');
    return;
  }

  // Build a list of the submitted fields, skipping empties and hidden fields.
  const entries = Object.entries(data).filter(
    ([key, value]) => !HIDDEN_FIELDS.has(key) && value !== '' && value != null
  );

  const rowsHtml = entries
    .map(([key, value]) => {
      const label = FIELD_LABELS[key] || key;
      return `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap;">${escapeHtml(
        label
      )}</td><td style="padding:6px 0;">${escapeHtml(value).replace(/\n/g, '<br>')}</td></tr>`;
    })
    .join('');

  const textBody = entries
    .map(([key, value]) => `${FIELD_LABELS[key] || key}: ${value}`)
    .join('\n');

  const who = data.names || data.name || data.email || 'someone';
  const subject = `New ${formName} inquiry — ${who}`;

  const body = {
    from,
    to: [to],
    subject,
    text: textBody || 'New submission (no fields).',
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;">
      <p style="margin:0 0 16px;">New <strong>${escapeHtml(formName)}</strong> submission from your website:</p>
      <table style="border-collapse:collapse;">${rowsHtml}</table>
    </div>`
  };

  // Let you reply straight to the inquirer from your inbox.
  if (data.email) body.reply_to = data.email;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend API ${res.status}: ${detail}`);
  }
  console.log('Inquiry email sent to', to);
}

async function appendToSheet(formName, data) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const range = process.env.GOOGLE_SHEET_RANGE || 'Leads!A:F';

  if (!sheetId || !clientEmail || !privateKeyRaw) {
    console.warn('Skipping Google Sheet: Sheets env vars not set');
    return;
  }

  const row = [
    new Date().toISOString(),
    formName,
    data.name || data.names || '',
    data.email || '',
    data.phone || data.phone_number || '',
    data.source || data.referral || ''
  ];

  const jwt = new google.auth.JWT({
    email: clientEmail,
    key: privateKeyRaw.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const sheets = google.sheets({ version: 'v4', auth: jwt });
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });
  console.log('Appended row to sheet', row);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let submission;
  try {
    const body = JSON.parse(event.body || '{}');
    submission = body.payload || body; // Netlify wraps the submission under .payload
  } catch (err) {
    console.error('Failed to parse body', err);
    return { statusCode: 400, body: 'Invalid payload' };
  }

  const data = (submission && submission.data) || {};
  const formName = (submission && submission.form_name) || 'unknown-form';

  // Run both independently; capture (don't throw) so one failure can't block the other.
  const results = await Promise.allSettled([
    sendResendEmail(formName, data),
    appendToSheet(formName, data)
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(i === 0 ? 'Email failed:' : 'Sheet append failed:', r.reason);
    }
  });

  // Always 200 so Netlify doesn't retry endlessly; failures are logged above.
  return { statusCode: 200, body: 'Processed' };
};
