const { google } = require('googleapis');

// Append each Netlify form submission to a Google Sheet (Excel export-ready).
// Expected env vars (set in Netlify UI or netlify.toml context env):
// - GOOGLE_SHEET_ID: target spreadsheet ID
// - GOOGLE_SERVICE_ACCOUNT_EMAIL: service account email
// - GOOGLE_SERVICE_ACCOUNT_KEY: service account private key (use \n for newlines)
// - GOOGLE_SHEET_RANGE (optional): range/tab to append to, defaults to "Leads!A:F"

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let payload;
  try {
    const body = JSON.parse(event.body || '{}');
    payload = body.payload || body; // Netlify wraps payload under .payload
  } catch (err) {
    console.error('Failed to parse body', err);
    return { statusCode: 400, body: 'Invalid payload' };
  }

  const submission = payload || {};
  const data = submission.data || {};
  const formName = submission.form_name || 'unknown-form';

  const row = [
    new Date().toISOString(),
    formName,
    data.name || data.names || '',
    data.email || '',
    data.phone || data.phone_number || '',
    data.source || data.referral || ''
  ];

  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const range = process.env.GOOGLE_SHEET_RANGE || 'Leads!A:F';

    if (!sheetId || !clientEmail || !privateKeyRaw) {
      console.error('Missing Google Sheets env vars');
      return { statusCode: 500, body: 'Missing Google Sheets configuration' };
    }

    const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

    const jwt = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth: jwt });

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });

    console.log('Appended row', row);
    return { statusCode: 200, body: 'Saved to sheet' };
  } catch (err) {
    console.error('Sheets append failed', err);
    return { statusCode: 500, body: 'Failed to save lead' };
  }
};
