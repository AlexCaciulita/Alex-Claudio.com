const path = require('node:path');
const { Readable } = require('node:stream');
const express = require('express');
const { GalleryError, getGallery, getPublicOrigin } = require('./server/gallery');
const { SubmissionError, processSubmission } = require('./server/submissions');

const ROOT = __dirname;
const SUBMISSION_WINDOW_MS = 15 * 60 * 1000;
const SUBMISSION_LIMIT = 10;
const PUBLIC_PAGES = new Set([
  '/', '/portfolio/', '/pricing/', '/links/', '/lead/', '/blog/',
  '/blog/seattle-wedding-rain-plan/',
  '/blog/how-many-hours-wedding-photography/',
  '/blog/wedding-photography-timeline/'
]);
const PRIVATE_PATHS = new Set([
  'ads',
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

function safeDownloadName(key) {
  return path.basename(key).replace(/["\r\n]/g, '_') || 'download';
}

function createApp() {
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
      if (String(req.body.company || '').trim()) {
        return res.status(200).json({ ok: true });
      }
      const formName = String(req.body['form-name'] || '');
      try {
        await processSubmission(formName, req.body);
        res.status(200).json({ ok: true });
      } catch (error) {
        if (!(error instanceof SubmissionError)) console.error('Submission failed:', error);
        res.status(error.status || 500).json({ error: error.message || 'Unexpected error' });
      }
    }
  );

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
      if (req.method === 'HEAD' || !upstream.body) return res.end();
      Readable.fromWeb(upstream.body).pipe(res);
    } catch (error) {
      if (error.name !== 'AbortError') console.error('CDN proxy failed:', error);
      if (!res.headersSent) res.status(502).json({ error: 'Download unavailable' });
    }
  });

  app.use('/investment', (req, res) => res.redirect(301, '/'));

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
  createApp().listen(port, '0.0.0.0', () => {
    console.log(`Alex Claudio site listening on port ${port}`);
  });
}

module.exports = { createApp };
