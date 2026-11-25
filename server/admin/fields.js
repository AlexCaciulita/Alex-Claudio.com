// What the dashboard (and the assistant) may change on an inquiry or a task, checked the same way for both.
const { STATUSES, TEXT_LIMITS } = require('./store');
const { STAGES, fromStage, cleanTags, TAG_LIMIT, TASK_TITLE_LENGTH } = require('./work');
const { isValidIsoDate } = require('./dates');

const ID = /^\d{1,18}$/;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const EDITABLE = {
  names: 'text', email: 'text', phone: 'text', event_date: 'text', wedding_date: 'date', location: 'text',
  hours: 'text', care: 'text', message: 'text', source: 'text', status: 'status', stage: 'stage', tags: 'tags', price: 'money', paid: 'money'
};

function cleanFields(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid request.' };
  const fields = {};
  for (const [key, kind] of Object.entries(EDITABLE)) {
    if (!has(body, key)) continue;
    const value = body[key];
    if (kind === 'text') {
      if (value !== null && typeof value !== 'string') return { error: `${key} must be text.` };
      fields[key] = String(value || '').trim().slice(0, TEXT_LIMITS[key]);
    } else if (kind === 'date') {
      if (value === null || value === '') fields[key] = null;
      else if (isValidIsoDate(value)) fields[key] = value;
      else return { error: 'Use a real calendar date for the wedding.' };
    } else if (kind === 'status') {
      if (!STATUSES.includes(value)) return { error: 'Unknown status.' };
      fields[key] = value;
    } else if (kind === 'stage') {
      if (!STAGES.includes(value)) return { error: 'Unknown stage.' };
      Object.assign(fields, fromStage(value));
    } else if (kind === 'tags') {
      if (!Array.isArray(value) || value.length > TAG_LIMIT * 2 || value.some((tag) => typeof tag !== 'string')) return { error: 'Tags must be a list of words.' };
      fields.tags = JSON.stringify(cleanTags(value));
    } else if (kind === 'money') {
      if (value === null || value === '') fields[key] = null;
      else {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return { error: 'Amounts must be between 0 and 10,000,000.' };
        fields[key] = Math.round(amount * 100) / 100;
      }
    }
  }
  // A status other than booked has no progress; a stage, when given, already set both.
  if (fields.status && fields.status !== 'booked' && !has(fields, 'progress')) fields.progress = null;
  return { fields };
}

// A task as sent from the dashboard: a title, an optional due date, and for a change, done or not.
function cleanTask(body, creating) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid request.' };
  const task = {};
  if (has(body, 'title') || creating) {
    const title = typeof body.title === 'string' ? body.title.replace(/\s+/g, ' ').trim().slice(0, TASK_TITLE_LENGTH) : '';
    if (!title) return { error: 'Give the task a name.' };
    task.title = title;
  }
  if (has(body, 'due_date')) {
    if (body.due_date === null || body.due_date === '') task.due_date = null;
    else if (isValidIsoDate(body.due_date)) task.due_date = body.due_date;
    else return { error: 'Use a real calendar date.' };
  }
  if (has(body, 'done')) task.done = Boolean(body.done);
  if (creating && has(body, 'inquiry_id') && body.inquiry_id !== null) {
    if (!ID.test(String(body.inquiry_id))) return { error: 'Unknown couple.' };
    task.inquiry_id = String(body.inquiry_id);
  }
  return { task };
}

module.exports = { cleanFields, cleanTask, EDITABLE, ID };
