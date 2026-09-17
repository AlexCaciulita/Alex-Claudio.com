import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createApp } = require('../server');

async function withServer(run) {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Railway service exposes health and static pages', async () => {
  await withServer(async (origin) => {
    const health = await fetch(`${origin}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);

    const legacy = await fetch(`${origin}/investment/example`, { redirect: 'manual' });
    assert.equal(legacy.status, 301);
    assert.equal(legacy.headers.get('location'), '/');

    for (const privatePath of ['/package.json', '/server.js', '/server/gallery.js', '/tests/server.test.mjs']) {
      const response = await fetch(`${origin}${privatePath}`);
      assert.equal(response.status, 404, privatePath);
    }
  });
});

test('submission endpoint validates requests and silently accepts honeypots', async () => {
  await withServer(async (origin) => {
    const honeypot = await fetch(`${origin}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'form-name=contact&company=spam'
    });
    assert.equal(honeypot.status, 200);

    const invalid = await fetch(`${origin}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'form-name=contact&email=not-an-email'
    });
    assert.equal(invalid.status, 400);

    const unknown = await fetch(`${origin}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'form-name': 'unknown', email: 'person@example.com' })
    });
    assert.equal(unknown.status, 400);
  });
});

test('canonical redirects preserve queries and leave service endpoints alone', async () => {
  await withServer(async (origin) => {
    for (const [alias, canonical] of [
      ['/index.html', '/'], ['/index', '/'], ['/portfolio', '/portfolio/'],
      ['/pricing/index.html', '/pricing/'], ['/blog/index.html', '/blog/'],
      ['/blog/wedding-photography-timeline/index.html', '/blog/wedding-photography-timeline/']
    ]) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${origin}${alias}?utm_source=test&collection=essential`, { method, redirect: 'manual' });
        assert.equal(response.status, 301, alias);
        assert.equal(response.headers.get('location'), `${canonical}?utm_source=test&collection=essential`);
      }
      const destination = await fetch(`${origin}${canonical}`, { redirect: 'manual' });
      assert.equal(destination.status, 200, canonical);
    }
    const www = await fetch(`${origin}/blog/index.html?utm_source=test`, {
      headers: { 'X-Forwarded-Host': 'www.alex-claudio.com' }, redirect: 'manual'
    });
    assert.equal(www.status, 301);
    assert.equal(www.headers.get('location'), 'https://alex-claudio.com/blog/?utm_source=test');
    const health = await fetch(`${origin}/health`, { headers: { 'X-Forwarded-Host': 'www.alex-claudio.com' }, redirect: 'manual' });
    assert.equal(health.status, 200);
    const post = await fetch(`${origin}/api/submissions`, {
      method: 'POST', headers: { 'X-Forwarded-Host': 'www.alex-claudio.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: 'honeypot' }), redirect: 'manual'
    });
    assert.equal(post.status, 200);
    const gallery = await fetch(`${origin}/gallery/?c=client-code`, { redirect: 'manual' });
    assert.equal(gallery.status, 200);
    const missing = await fetch(`${origin}/not-a-page/index.html`, { redirect: 'manual' });
    assert.equal(missing.status, 404);
    for (const route of ['/robots.txt', '/sitemap.xml']) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    }
  });
});

test('gallery endpoint rejects malformed codes before accessing R2', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/gallery?c=bad`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid gallery code' });
  });
});

test('browser code no longer depends on Netlify endpoints or form attributes', async () => {
  const { readFile } = await import('node:fs/promises');
  const files = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../lead/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../script.js', import.meta.url), 'utf8'),
    readFile(new URL('../gallery/gallery.js', import.meta.url), 'utf8')
  ]);
  const source = files.join('\n');
  assert.doesNotMatch(source, /netlify|\.netlify\/functions/i);
  assert.match(source, /\/api\/submissions/);
  assert.match(source, /\/api\/gallery/);
});
