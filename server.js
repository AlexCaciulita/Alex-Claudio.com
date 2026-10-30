const path = require('node:path');
const { Readable } = require('node:stream');
const express = require('express');
const { CATEGORIES: GALLERY_CATEGORIES, GalleryError, getGallery, getPublicOrigin } = require('./server/gallery');
const { SubmissionError, processSubmission } = require('./server/submissions');
const { createAdminRouter } = require('./server/admin');
const { createStore, safeMessage } = require('./server/admin/store');
const { createRateLimit, isBot, readTime, readView } = require('./server/analytics');

const ROOT = __dirname;
const SUBMISSION_WINDOW_MS = 15 * 60 * 1000;
const SUBMISSION_LIMIT = 10;
const VISIT_LIMIT = 300;
const VISIT_WINDOW_MS = 10 * 60 * 1000;
const GALLERY_SLUG = /^\/gallery\/([a-z0-9-]{6,64})\/?$/;
const PUBLIC_PAGES = new Set([
  '/', '/portfolio/', '/links/', '/lead/', '/blog/', '/privacy/',
  '/blog/seattle-wedding-rain-plan/',
  '/blog/how-many-hours-wedding-photography/',
  '/blog/wedding-photography-timeline/',
  '/blog/wedding-day-photography-tips/'
]);
const PRIVATE_PATHS = new Set([
  'ads',
  'design',
  'docs',
  'netlify',
  'node_modules',
  'scripts',
  'server',
  'tests',
  'tools'
]);
const PRIVATE_FILES = new Set([
  'package.json',
  'package-lock.json',
  'railway.json',
  'README.md',
  'server.js'
]);

function createSubmissionLimiter() {
  const requestsByIp = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const recent = (requestsByIp.get(ip) || []).filter((time) => now - time < SUBMISSION_WINDOW_MS);
    if (recent.length >= SUBMISSION_LIMIT) {
      return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
    }
    recent.push(now);
    requestsByIp.set(ip, recent);
    if (requestsByIp.size > 1000) {
      for (const [key, times] of requestsByIp) {
        if (times.every((time) => now - time >= SUBMISSION_WINDOW_MS)) requestsByIp.delete(key);
      }
    }
    next();
  };
}

// The page a visit is counted under: one of the public pages or a client gallery, never anything else.
function countedPath(value) {
  const pathname = String(value || '').replace(/\/index(?:\.html)?$/, '/');
  if (PUBLIC_PAGES.has(pathname) || pathname === '/AlexClaudioVentures/') return pathname;
  const gallery = GALLERY_SLUG.exec(pathname);
  return gallery ? `/gallery/${gallery[1]}` : null;
}

// What a download from /cdn was: one photo or a whole gallery's zip, and which gallery.
function downloadOf(key) {
  const [slug, second, ...rest] = key.split('/');
  if (!slug || !second) return null;
  if (!rest.length && GALLERY_CATEGORIES.some((category) => second === `${slug}-${category}.zip`)) return { kind: 'zip', slug };
  if (rest.length === 1 && GALLERY_CATEGORIES.includes(second)) return { kind: 'photo', slug };
  return null;
}

const visitorOf = (req) => ({ ip: req.ip || req.socket.remoteAddress || '', userAgent: String(req.get('user-agent') || '') });

function safeDownloadName(key) {
  return path.basename(key).replace(/["\r\n]/g, '_') || 'download';
}

// options.env and options.store let tests run the site with their own settings and a stand-in database.
function createApp(options = {}) {
  const env = options.env || process.env;
  const store = Object.prototype.hasOwnProperty.call(options, 'store') ? options.store : createStore(env);
  const saveInquiry = store
    ? (formName, data) => store.insertInquiry(formName, data).catch((error) => { throw new Error(safeMessage(error)); })
    : null;
  // Inquiries and downloads are counted on the side; a failure here never touches the answer.
  const count = (kind, detail, req) => {
    if (!store || isBot(String(req.get('user-agent') || ''))) return;
    const visitor = visitorOf(req);
    Promise.resolve()
      .then(() => store.recordAction(kind, detail, visitor))
      .catch((error) => console.error('Counting a visit failed:', safeMessage(error)));
  };
  const visitAllowed = createRateLimit(VISIT_LIMIT, VISIT_WINDOW_MS);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

  app.get('/api/gallery', async (req, res) => {
    try {
      const gallery = await getGallery(String(req.query.c || ''));
      res.set('Cache-Control', 'public, max-age=300');
      res.json(gallery);
    } catch (error) {
      if (!(error instanceof GalleryError)) console.error('Gallery request failed:', error);
      res.status(error.status || 500).json({ error: error.message || 'Unexpected error' });
    }
  });

  app.post(
    '/api/submissions',
    createSubmissionLimiter(),
    express.urlencoded({ extended: false, limit: '64kb' }),
    express.json({ limit: '64kb' }),
    async (req, res) => {
      const body = req.body || {};
      if (String(body.company || '').trim()) {
        return res.status(200).json({ ok: true });
      }
      const formName = String(body['form-name'] || '');
      try {
        await processSubmission(formName, body, { save: saveInquiry });
        count('inquiry', formName, req);
        res.status(200).json({ ok: true });
      } catch (error) {
        if (!(error instanceof SubmissionError)) console.error('Submission failed:', error);
        res.status(error.status || 500).json({ error: error.message || 'Unexpected error' });
      }
    }
  );

  // Visit counts for the studio dashboard. Each page's script sends one view, then how long the page stayed
  // in front. The answer is always empty, so nothing about the counting can be learned from it.
  app.post('/api/visit', express.text({ type: () => true, limit: '4kb' }), async (req, res) => {
    res.status(204).end();
    const { ip, userAgent } = visitorOf(req);
    const site = String(req.get('sec-fetch-site') || '').toLowerCase();
    if (!store || isBot(userAgent) || (site && site !== 'same-origin') || !visitAllowed(ip || 'unknown')) return;
    let body;
    try { body = JSON.parse(typeof req.body === 'string' ? req.body : ''); } catch (error) { return; }
    try {
      const time = readTime(body);
      if (time) {
        await store.recordTime(time);
        return;
      }
      const view = readView(body, userAgent);
      const pathname = view && countedPath(view.path);
      if (pathname) await store.recordView({ ...view, path: pathname }, { ip, userAgent });
    } catch (error) {
      console.error('Counting a visit failed:', safeMessage(error));
    }
  });

  app.use('/cdn', async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      return res.status(405).set('Allow', 'GET, HEAD').end();
    }
    const publicOrigin = getPublicOrigin();
    if (!publicOrigin) return res.status(500).json({ error: 'Server misconfigured' });

    const encodedKey = new URL(req.originalUrl, 'http://localhost').pathname.replace(/^\/cdn\/?/, '');
    let key;
    try {
      key = decodeURIComponent(encodedKey);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid download path' });
    }
    if (!key || key.split('/').includes('..')) {
      return res.status(400).json({ error: 'Invalid download path' });
    }

    const controller = new AbortController();
    res.on('close', () => controller.abort());
    try {
      const headers = {};
      if (req.headers.range) headers.Range = req.headers.range;
      const upstream = await fetch(`${publicOrigin}/${encodedKey}`, {
        method: req.method,
        headers,
        signal: controller.signal
      });
      res.status(upstream.status);
      for (const name of ['accept-ranges', 'cache-control', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
        const value = upstream.headers.get(name);
        if (value) res.set(name, value);
      }
      res.set('Content-Disposition', `attachment; filename="${safeDownloadName(key)}"`);
      const download = downloadOf(key);
      if (download && req.method === 'GET' && upstream.ok && (!req.headers.range || /^bytes=0-/.test(req.headers.range))) {
        count(download.kind, download.slug, req);
      }
      if (req.method === 'HEAD' || !upstream.body) return res.end();
      Readable.fromWeb(upstream.body).pipe(res);
    } catch (error) {
      if (error.name !== 'AbortError') console.error('CDN proxy failed:', error);
      if (!res.headersSent) res.status(502).json({ error: 'Download unavailable' });
    }
  });

  app.use('/investment', (req, res) => res.redirect(301, '/'));

  // Pricing now lives on the homepage.
  app.use('/pricing', (req, res) => {
    const queryAt = req.originalUrl.indexOf('?');
    res.redirect(301, `/${queryAt < 0 ? '' : req.originalUrl.slice(queryAt)}#collections`);
  });

  // Short Instagram bio link: alex-claudio.com/ig -> inquiry form, tagged for attribution.
  app.get('/ig', (req, res) => res.redirect(302, '/?utm_source=instagram&utm_medium=social&utm_campaign=bio#contact'));

  // Client galleries shared as /gallery/<code>; the page reads the code from its own path.
  app.get(GALLERY_SLUG, (req, res) => {
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    res.sendFile(path.join(ROOT, 'gallery', 'index.html'));
  });

  app.use((req, res, next) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.originalUrl, 'http://localhost').pathname);
    } catch (error) {
      return res.status(400).type('text').send('Invalid path');
    }
    const segments = pathname.split('/').filter(Boolean);
    if (PRIVATE_PATHS.has(segments[0]) || PRIVATE_FILES.has(segments[0])) {
      return res.status(404).type('text').send('Not found');
    }
    next();
  });

  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    const queryAt = req.originalUrl.indexOf('?');
    const pathname = queryAt < 0 ? req.originalUrl : req.originalUrl.slice(0, queryAt);
    const query = queryAt < 0 ? '' : req.originalUrl.slice(queryAt);
    const candidate = pathname.replace(/\/index(?:\.html)?$/, '/');
    const canonicalPath = PUBLIC_PAGES.has(candidate) ? candidate
      : PUBLIC_PAGES.has(`${candidate}/`) ? `${candidate}/` : pathname;
    if (req.hostname === 'www.alex-claudio.com') {
      return res.redirect(301, `https://alex-claudio.com${canonicalPath}${query}`);
    }
    if (canonicalPath !== pathname) return res.redirect(301, `${canonicalPath}${query}`);
    next();
  });

  // The private studio dashboard: sign-in, inquiries, calendar and older records.
  app.use('/admin', createAdminRouter({ store, env }));

  app.use(express.static(ROOT, {
    dotfiles: 'ignore',
    extensions: ['html'],
    index: 'index.html',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html') || ['robots.txt', 'sitemap.xml'].includes(path.basename(filePath))) {
        res.set('Cache-Control', 'public, max-age=0, must-revalidate');
      } else {
        res.set('Cache-Control', 'public, max-age=604800');
      }
    }
  }));

  app.use((req, res) => res.status(404).type('text').send('Not found'));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const store = createStore(process.env);
  createApp({ store }).listen(port, '0.0.0.0', () => {
    console.log(`Alex Claudio site listening on port ${port}`);
  });
  if (store) {
    store.ready()
      .then(() => console.log('Studio database ready'))
      .catch((error) => console.error('Studio database is not ready yet:', safeMessage(error)));
  }
}

module.exports = { createApp };
