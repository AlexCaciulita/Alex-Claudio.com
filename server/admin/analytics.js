// Visit counts for the studio dashboard, kept in the dashboard's own SQLite file.
// A visitor is a keyed hash of the IP address and browser, and the key changes every day and is then
// deleted, so the same person can't be followed from one day to the next or traced back to an address.
const crypto = require('node:crypto');

const VISIT_GAP_MS = 30 * 60 * 1000;
const TIME_UPDATE_MS = 6 * 60 * 60 * 1000;
const KEEP_DAYS = 395;
const RANGES = { today: 1, '7d': 7, '30d': 30, '90d': 90, '12m': 365 };
const BREAKDOWNS = { countries: 'country', timezones: 'timezone', devices: 'device', browsers: 'browser', systems: 'os' };

const ANALYTICS_MIGRATION = `
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor TEXT NOT NULL,
  day TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  landing TEXT NOT NULL,
  source TEXT NOT NULL,
  referrer TEXT NOT NULL DEFAULT '',
  medium TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  browser TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS visits_day_idx ON visits (day);
CREATE INDEX IF NOT EXISTS visits_visitor_idx ON visits (visitor, last_at);
CREATE TABLE IF NOT EXISTS views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL UNIQUE,
  day TEXT NOT NULL,
  at TEXT NOT NULL,
  path TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS views_day_idx ON views (day);
CREATE INDEX IF NOT EXISTS views_visit_idx ON views (visit_id);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER REFERENCES visits(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('inquiry', 'photo', 'zip')),
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS actions_day_idx ON actions (day, kind);
CREATE INDEX IF NOT EXISTS actions_visit_idx ON actions (visit_id);
CREATE TABLE IF NOT EXISTS visitor_keys (
  day TEXT PRIMARY KEY,
  value BLOB NOT NULL
);
`;

// "YYYY-MM-DD" where the studio is.
function localDay(timeZone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch (error) {
    return date.toISOString().slice(0, 10);
  }
}

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function analyticsMethods({ use, timeZone }) {
  let key = null;
  const visitorOf = (db, ip, userAgent, day) => {
    if (!key || key.day !== day) {
      db.prepare('DELETE FROM visitor_keys WHERE day <> ?').run(day);
      db.prepare('INSERT OR IGNORE INTO visitor_keys (day, value) VALUES (?, ?)').run(day, crypto.randomBytes(32));
      key = { day, value: Buffer.from(db.prepare('SELECT value FROM visitor_keys WHERE day = ?').get(day).value) };
    }
    return crypto.createHmac('sha256', key.value).update(`${ip}\n${userAgent}`).digest('hex').slice(0, 32);
  };
  // The visit this person is in the middle of: anything within 30 minutes of their last page.
  const currentVisit = (db, visitor, now) => db.prepare('SELECT id FROM visits WHERE visitor = ? AND last_at >= ? ORDER BY last_at DESC LIMIT 1')
    .get(visitor, new Date(now - VISIT_GAP_MS).toISOString());
  const moment = () => {
    const now = Date.now();
    const date = new Date(now);
    return { now, at: date.toISOString(), day: localDay(timeZone, date) };
  };

  return {
    // One page view. Starts a visit, or joins the one this person is already in.
    recordView: (view, { ip, userAgent }) => use((db) => {
      const { now, at, day } = moment();
      const visitor = visitorOf(db, ip, userAgent, day);
      db.exec('BEGIN IMMEDIATE');
      try {
        const open = currentVisit(db, visitor, now);
        let visitId;
        if (open) {
          visitId = open.id;
          db.prepare('UPDATE visits SET last_at = ? WHERE id = ?').run(at, visitId);
        } else {
          visitId = Number(db.prepare(`INSERT INTO visits
              (visitor, day, started_at, last_at, landing, source, referrer, medium, campaign, country, timezone, device, browser, os)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            visitor, day, at, at, view.path, view.source, view.referrer, view.medium, view.campaign,
            view.country, view.timezone, view.device, view.browser, view.os).lastInsertRowid);
        }
        db.prepare('INSERT INTO views (visit_id, page_id, day, at, path) VALUES (?, ?, ?, ?, ?) ON CONFLICT (page_id) DO NOTHING')
          .run(visitId, view.page, day, at, view.path);
        db.exec('COMMIT');
        return visitId;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }),

    // How long a page stayed in front. The page reports a running total, so the largest one counts.
    recordTime: ({ page, seconds }) => use((db) => db.prepare('UPDATE views SET seconds = max(seconds, ?) WHERE page_id = ? AND at >= ?')
      .run(seconds, page, new Date(Date.now() - TIME_UPDATE_MS).toISOString()).changes > 0),

    // An inquiry sent or a gallery download, joined to the visit it happened in when there is one.
    recordAction: (kind, detail, { ip, userAgent }) => use((db) => {
      const { now, at, day } = moment();
      const open = currentVisit(db, visitorOf(db, ip, userAgent, day), now);
      if (open) db.prepare('UPDATE visits SET last_at = ? WHERE id = ?').run(at, open.id);
      db.prepare('INSERT INTO actions (visit_id, day, at, kind, detail) VALUES (?, ?, ?, ?, ?)')
        .run(open ? open.id : null, day, at, kind, String(detail || '').slice(0, 100));
      return open ? open.id : null;
    }),

    // Visits older than 13 months go, and so does every visitor key but today's.
    pruneAnalytics: () => use((db) => {
      const today = localDay(timeZone);
      const cutoff = addDays(today, -KEEP_DAYS);
      const removed = db.prepare('DELETE FROM visits WHERE day < ?').run(cutoff).changes;
      db.prepare('DELETE FROM actions WHERE day < ?').run(cutoff);
      db.prepare('DELETE FROM visitor_keys WHERE day <> ?').run(today);
      return removed;
    }),

    analytics: (rangeKey) => use((db) => summarize(db, RANGES[rangeKey] ? rangeKey : '30d', timeZone))
  };
}

// Totals for a run of days; `until` stops the count at a moment, so today can be set against yesterday up to the same time.
function totalsFor(db, from, to, until = '9999') {
  const visits = db.prepare(`WITH per AS (
      SELECT v.id, v.visitor, count(w.id) AS pages, COALESCE(sum(w.seconds), 0) AS seconds
        FROM visits v LEFT JOIN views w ON w.visit_id = v.id
       WHERE v.day BETWEEN ? AND ? AND v.started_at <= ?
       GROUP BY v.id)
    SELECT count(*) AS visits, count(DISTINCT visitor) AS visitors, COALESCE(sum(pages), 0) AS views,
           COALESCE(sum(pages <= 1), 0) AS single, COALESCE(avg(seconds), 0) AS seconds
      FROM per`).get(from, to, until);
  const actions = db.prepare(`SELECT
      count(*) FILTER (WHERE kind = 'inquiry') AS inquiries,
      count(DISTINCT visit_id) FILTER (WHERE kind = 'inquiry') AS inquiry_visits,
      count(*) FILTER (WHERE kind = 'photo') AS photos,
      count(*) FILTER (WHERE kind = 'zip') AS zips
    FROM actions WHERE day BETWEEN ? AND ? AND at <= ?`).get(from, to, until);
  return {
    visitors: visits.visitors,
    visits: visits.visits,
    views: visits.views,
    single_page: visits.single,
    seconds_per_visit: Math.round(visits.seconds),
    inquiries: actions.inquiries,
    inquiry_visits: actions.inquiry_visits,
    photo_downloads: actions.photos,
    zip_downloads: actions.zips
  };
}

function summarize(db, rangeKey, timeZone) {
  const days = RANGES[rangeKey];
  const to = localDay(timeZone);
  const from = addDays(to, -(days - 1));
  const bucket = days === 1 ? 'hour' : days > 92 ? 'month' : 'day';
  const range = [from, to];

  // Visitors and page views per hour (today), per day, or per month (the year), with empty slots filled in.
  const series = new Map();
  const empty = (key) => ({ key, visitors: 0, visits: 0, views: 0 });
  if (bucket === 'hour') {
    const hourOf = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' });
    for (let hour = 0; hour < 24; hour += 1) series.set(String(hour).padStart(2, '0'), empty(`${to}T${String(hour).padStart(2, '0')}`));
    const slotAt = (stamp) => series.get(hourOf.format(new Date(stamp)).padStart(2, '0'));
    const seen = new Map();
    for (const row of db.prepare('SELECT visitor, started_at FROM visits WHERE day = ?').all(to)) {
      const s = slotAt(row.started_at);
      if (!s) continue;
      s.visits += 1;
      if (!seen.has(s)) seen.set(s, new Set());
      seen.get(s).add(row.visitor);
      s.visitors = seen.get(s).size;
    }
    for (const row of db.prepare('SELECT at FROM views WHERE day = ?').all(to)) {
      const s = slotAt(row.at);
      if (s) s.views += 1;
    }
  } else {
    if (bucket === 'day') for (let n = 0; n < days; n += 1) series.set(addDays(from, n), empty(addDays(from, n)));
    else for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = addDays(`${month}-28`, 7).slice(0, 7)) series.set(month, empty(month));
    const slot = (day) => series.get(bucket === 'day' ? day : day.slice(0, 7));
    for (const row of db.prepare('SELECT day, count(*) AS visits, count(DISTINCT visitor) AS visitors FROM visits WHERE day BETWEEN ? AND ? GROUP BY day').all(...range)) {
      const s = slot(row.day);
      if (s) { s.visits += row.visits; s.visitors += row.visitors; }
    }
    for (const row of db.prepare('SELECT day, count(*) AS views FROM views WHERE day BETWEEN ? AND ? GROUP BY day').all(...range)) {
      const s = slot(row.day);
      if (s) s.views += row.views;
    }
  }

  const landings = new Map(db.prepare('SELECT landing, count(*) AS n FROM visits WHERE day BETWEEN ? AND ? GROUP BY landing').all(...range).map((row) => [row.landing, row.n]));
  const pages = db.prepare(`SELECT w.path, count(*) AS views, count(DISTINCT v.visitor) AS visitors, avg(NULLIF(w.seconds, 0)) AS seconds
      FROM views w JOIN visits v ON v.id = w.visit_id
     WHERE w.day BETWEEN ? AND ?
     GROUP BY w.path ORDER BY views DESC, w.path LIMIT 50`).all(...range)
    .map((row) => ({ path: row.path, views: row.views, visitors: row.visitors, landings: landings.get(row.path) || 0, seconds: row.seconds === null ? null : Math.round(row.seconds) }));

  const sources = db.prepare(`SELECT v.source AS name, count(DISTINCT v.id) AS visits, count(DISTINCT v.visitor) AS visitors, count(DISTINCT a.visit_id) AS inquiries
      FROM visits v LEFT JOIN actions a ON a.visit_id = v.id AND a.kind = 'inquiry'
     WHERE v.day BETWEEN ? AND ?
     GROUP BY v.source ORDER BY visits DESC, name LIMIT 40`).all(...range);
  const referrers = db.prepare(`SELECT referrer AS name, count(*) AS visits FROM visits
     WHERE day BETWEEN ? AND ? AND referrer <> '' GROUP BY referrer ORDER BY visits DESC, name LIMIT 40`).all(...range);
  const campaigns = db.prepare(`SELECT campaign, source, medium, count(*) AS visits FROM visits
     WHERE day BETWEEN ? AND ? AND (campaign <> '' OR medium <> '')
     GROUP BY campaign, source, medium ORDER BY visits DESC LIMIT 30`).all(...range);
  const breakdowns = {};
  for (const [name, column] of Object.entries(BREAKDOWNS)) {
    breakdowns[name] = db.prepare(`SELECT ${column} AS name, count(*) AS visits FROM visits
       WHERE day BETWEEN ? AND ? GROUP BY ${column} ORDER BY visits DESC, name LIMIT 40`).all(...range);
  }

  // Client galleries: who opened them and what was downloaded.
  const galleries = new Map();
  const gallery = (slug) => {
    if (!galleries.has(slug)) galleries.set(slug, { slug, views: 0, visitors: 0, photos: 0, zips: 0, last_view: null, last_download: null });
    return galleries.get(slug);
  };
  for (const row of db.prepare(`SELECT substr(w.path, 10) AS slug, count(*) AS views, count(DISTINCT v.visitor) AS visitors, max(w.at) AS last_view
      FROM views w JOIN visits v ON v.id = w.visit_id
     WHERE w.day BETWEEN ? AND ? AND w.path LIKE '/gallery/_%'
     GROUP BY slug`).all(...range)) Object.assign(gallery(row.slug), row);
  for (const row of db.prepare(`SELECT detail AS slug, count(*) FILTER (WHERE kind = 'photo') AS photos, count(*) FILTER (WHERE kind = 'zip') AS zips, max(at) AS last_download
      FROM actions WHERE day BETWEEN ? AND ? AND kind IN ('photo', 'zip') AND detail <> ''
     GROUP BY detail`).all(...range)) Object.assign(gallery(row.slug), row);

  // The latest visits, page by page.
  const recent = db.prepare(`SELECT id, started_at, landing, source, referrer, country, timezone, device, browser, os
      FROM visits WHERE day BETWEEN ? AND ? ORDER BY started_at DESC, id DESC LIMIT 30`).all(...range)
    .map((row) => ({ ...row, pages: [], actions: [] }));
  if (recent.length) {
    const byId = new Map(recent.map((visit) => [visit.id, visit]));
    const marks = recent.map(() => '?').join(', ');
    for (const row of db.prepare(`SELECT visit_id, path, seconds, at FROM views WHERE visit_id IN (${marks}) ORDER BY at, id`).all(...byId.keys())) {
      byId.get(row.visit_id).pages.push({ path: row.path, seconds: row.seconds, at: row.at });
    }
    for (const row of db.prepare(`SELECT visit_id, kind, detail, at FROM actions WHERE visit_id IN (${marks}) ORDER BY at, id`).all(...byId.keys())) {
      byId.get(row.visit_id).actions.push({ kind: row.kind, detail: row.detail, at: row.at });
    }
  }

  const first = db.prepare('SELECT min(day) AS day FROM visits').get().day;
  return {
    range: { key: rangeKey, from, to, days, bucket },
    counting_since: first || null,
    totals: totalsFor(db, from, to),
    previous: bucket === 'hour'
      ? totalsFor(db, addDays(from, -1), addDays(from, -1), new Date(Date.now() - 86400000).toISOString())
      : totalsFor(db, addDays(from, -days), addDays(from, -1)),
    series: [...series.values()],
    pages,
    sources,
    referrers,
    campaigns,
    ...breakdowns,
    galleries: [...galleries.values()].sort((a, b) => b.views - a.views || b.photos + b.zips - (a.photos + a.zips) || a.slug.localeCompare(b.slug)),
    recent: recent.map(({ id, ...visit }) => visit)
  };
}

module.exports = { ANALYTICS_MIGRATION, RANGES, analyticsMethods, localDay };
