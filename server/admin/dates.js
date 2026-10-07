// Turns what couples write ("June 12, 2027", "6/12/2027", "12 June 2027") into a calendar date.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function isoDate(year, month, day) {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isValidIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return Boolean(match && isoDate(+match[1], +match[2], +match[3]) === value);
}

function monthNumber(word) {
  if (word.length < 3) return 0;
  const index = MONTHS.findIndex((name) => name.startsWith(word));
  return index + 1;
}

function parseWeddingDate(text) {
  const s = String(text || '').trim().toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.? /, '');
  if (!s || s.length > 60) return null;
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return isoDate(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) return isoDate(+m[3], +m[1], +m[2]);
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) return isoDate(+m[3], +m[2], +m[1]);
  if ((m = /^([a-z]+)\.? (\d{1,2}) (\d{4})$/.exec(s)) && monthNumber(m[1])) return isoDate(+m[3], monthNumber(m[1]), +m[2]);
  if ((m = /^(\d{1,2}) ([a-z]+)\.? (\d{4})$/.exec(s)) && monthNumber(m[2])) return isoDate(+m[3], monthNumber(m[2]), +m[1]);
  return null;
}

module.exports = { parseWeddingDate, isValidIsoDate };
