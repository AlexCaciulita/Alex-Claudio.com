// Packages from the pricing guide, priced on the server. The price list is the JSON block in guide/index.html,
// read once, so the page and the server always use the same numbers and a browser can't set its own total.
const fs = require('node:fs');
const path = require('node:path');

const PAGE = path.join(__dirname, '..', 'guide', 'index.html');
const WORDS = { 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve' };
const ALBUMS = { 10: '10 × 10 in leather album', 12: '12 × 12 in leather album' };
// A couple's guide link carries 18 random bytes, written as 24 URL-safe characters.
const GUIDE_CODE = /^[A-Za-z0-9_-]{24}$/;

let cached = null;
function priceList() {
  if (!cached) {
    const block = /<script type="application\/json" id="guide-prices">([\s\S]*?)<\/script>/.exec(fs.readFileSync(PAGE, 'utf8'));
    if (!block) throw new Error('guide/index.html has no price list');
    cached = JSON.parse(block[1]);
  }
  return cached;
}

const money = (n) => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US');

// What the couple chose, checked. Anything unexpected is refused, never guessed at.
function readChoice(body) {
  const P = priceList();
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const hours = Number(b.hours);
  if (!Number.isInteger(hours) || hours < P.baseHours || hours > P.maxHours) return { error: 'Choose between six and twelve hours.' };
  const album = b.album === undefined || b.album === null ? '' : String(b.album);
  if (album && !Object.prototype.hasOwnProperty.call(P.albums, album)) return { error: 'That album isn’t one of the choices.' };
  for (const key of ['session', 'second']) {
    if (b[key] !== undefined && typeof b[key] !== 'boolean') return { error: 'Something in the package wasn’t understood.' };
  }
  const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 1500) : '';
  const window = typeof b.window === 'string' && /^[0-9a-z: ]{3,40}$/i.test(b.window.trim()) ? b.window.trim() : '';
  return { choice: { hours, session: b.session === true, album, second: b.second === true, notes, window } };
}

// The same lines and total the guide's package sheet shows.
function pricePackage(choice) {
  const P = priceList();
  const lines = [{ name: `Wedding day, ${choice.hours} hours`, price: P.base + (choice.hours - P.baseHours) * P.perHour }];
  // A second photographer is an addition from eight hours; the collections are priced without one.
  const second = choice.hours >= P.secondFromHours && choice.second;
  if (second) lines.push({ name: 'Second photographer', price: P.secondPhotographer });
  if (choice.session) lines.push({ name: 'Engagement session', price: P.session });
  if (choice.album) lines.push({ name: ALBUMS[choice.album], price: P.albums[choice.album] });
  const total = lines.reduce((sum, line) => sum + line.price, 0);
  const match = Object.values(P.collections).find((c) => c.hours === choice.hours && c.session === choice.session
    && c.album === choice.album && second === Boolean(c.second));
  const collection = match ? match.name : '';
  const summary = [
    ...lines.map((line) => `${line.name}: ${line.price ? money(line.price) : 'included'}`),
    `Estimated total: ${money(total)}${collection ? ` (the ${collection} collection)` : ''}`,
    ...(choice.window ? [`Coverage window: ${choice.window}`] : []),
    ...(choice.notes ? ['', `Anything else: ${choice.notes}`] : [])
  ].join('\n');
  return { lines, total, collection, hoursText: `${WORDS[choice.hours]} hours`, summary };
}

module.exports = { GUIDE_CODE, money, priceList, pricePackage, readChoice };
