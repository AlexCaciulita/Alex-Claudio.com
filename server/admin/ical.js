// The studio calendar as an iCalendar feed, so a phone can subscribe to it: booked weddings as all-day
// events, and open tasks on their due dates.
const { STAGE_LABELS, addDays } = require('./work');

const escapeText = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const day = (iso) => iso.replace(/-/g, '');
const stamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Lines longer than 75 octets are folded: a line break and a space, never splitting a character.
function fold(line) {
  const out = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char);
    if (size + bytes > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  out.push(current);
  return out.join('\r\n ');
}

function calendarFeed({ weddings, tasks }, origin) {
  const now = stamp();
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Alex Claudio//Studio//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Alex Claudio \u00b7 Weddings', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'
  ];
  for (const wedding of weddings) {
    const details = [STAGE_LABELS[wedding.stage] || wedding.stage, wedding.hours].filter(Boolean).join(' \u00b7 ');
    lines.push('BEGIN:VEVENT', `UID:wedding-${wedding.id}@alex-claudio.com`, `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${day(wedding.wedding_date)}`, `DTEND;VALUE=DATE:${day(addDays(wedding.wedding_date, 1))}`,
      `SUMMARY:${escapeText(`Wedding: ${wedding.names}`)}`,
      ...(wedding.location ? [`LOCATION:${escapeText(wedding.location)}`] : []),
      `DESCRIPTION:${escapeText(`${details}\n${origin}/admin#board`)}`,
      'TRANSP:OPAQUE', 'END:VEVENT');
  }
  for (const task of tasks) {
    lines.push('BEGIN:VEVENT', `UID:task-${task.id}@alex-claudio.com`, `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${day(task.due_date)}`, `DTEND;VALUE=DATE:${day(addDays(task.due_date, 1))}`,
      `SUMMARY:${escapeText(`To do: ${task.title}${task.names ? ` (${task.names})` : ''}`)}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

module.exports = { calendarFeed, escapeText, fold };
