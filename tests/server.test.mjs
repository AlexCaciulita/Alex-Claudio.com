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
