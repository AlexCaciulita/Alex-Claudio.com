import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getGallery } = require('../server/gallery');

const R2_ENV = {
  R2_ACCOUNT_ID: 'account',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'galleries',
  R2_PUBLIC_DOMAIN: 'photos.example.com'
};

// Serves a fake bucket: keys map to file contents (only manifest.json is ever read).
function useBucket(t, files) {
  const saved = Object.fromEntries(Object.keys(R2_ENV).map((name) => [name, process.env[name]]));
  Object.assign(process.env, R2_ENV);
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  t.mock.method(S3Client.prototype, 'send', async (command) => {
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix || '';
      return { Contents: Object.keys(files).filter((Key) => Key.startsWith(prefix)).map((Key) => ({ Key, Size: 1 })) };
    }
    if (command instanceof GetObjectCommand) {
      return { Body: { transformToString: async () => files[command.input.Key] } };
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
}

test('gallery API passes the hero crop position through from the manifest', async (t) => {
  useBucket(t, {
    'jessica-kyle/engagement/90.jpg': '',
    'jessica-kyle/manifest.json': JSON.stringify({ name: 'Jessica & Kyle', hero: 'engagement/90.jpg', heroPosition: '50% 100%' })
  });
  const gallery = await getGallery('jessica-kyle');
  assert.equal(gallery.hero, 'https://photos.example.com/jessica-kyle/engagement/90.jpg');
  assert.equal(gallery.heroPosition, '50% 100%');
});

test('gallery API drops a hero position that is not two percentages', async (t) => {
  useBucket(t, {
    'renee-alan/wedding/622.jpg': '',
    'renee-alan/manifest.json': JSON.stringify({ name: 'Renee & Alan', heroPosition: 'center; background: red' })
  });
  const gallery = await getGallery('renee-alan');
  assert.equal(gallery.heroPosition, null);
});

test('gallery API serves a session category and the manifest\'s section labels', async (t) => {
  useBucket(t, {
    'nitu-lucache/session/Fall Session - 2026-2.jpg': '',
    'nitu-lucache/session/Fall Session - 2026-10.jpg': '',
    'nitu-lucache/nitu-lucache-session.zip': '',
    'nitu-lucache/manifest.json': JSON.stringify({
      name: 'Nitu-Lucache',
      labels: { session: ' Fall Mini Session ', wedding: 42, portraits: 'Not a category' }
    })
  });
  const gallery = await getGallery('nitu-lucache');
  assert.deepEqual(gallery.session.map((photo) => photo.name), ['Fall Session - 2026-2.jpg', 'Fall Session - 2026-10.jpg']);
  assert.deepEqual(gallery.wedding, []);
  assert.deepEqual(gallery.labels, { session: 'Fall Mini Session' });
  assert.equal(gallery.zips.session.url, '/cdn/nitu-lucache/nitu-lucache-session.zip');
});

test('a gallery whose manifest sets photosFrom shows that gallery\'s photos under its own name', async (t) => {
  useBucket(t, {
    'nitu-lucache/session/Fall Session - 2026-2.jpg': '',
    'nitu-lucache/session/Fall Session - 2026-18.jpg': '',
    'nitu-lucache/dimensions.json': JSON.stringify({ 'Fall Session - 2026-2.jpg': [4000, 6000] }),
    'nitu-lucache/nitu-lucache-session.zip': '',
    'nitu-lucache/manifest.json': JSON.stringify({ name: 'Nitu-Lucache' }),
    'ditu-lucache/manifest.json': JSON.stringify({
      name: 'Ditu-Lucache',
      photosFrom: 'nitu-lucache',
      hero: 'session/Fall Session - 2026-18.jpg',
      labels: { session: 'Fall Mini Session' }
    })
  });
  const gallery = await getGallery('ditu-lucache');
  assert.equal(gallery.name, 'Ditu-Lucache');
  assert.deepEqual(gallery.session.map((photo) => photo.key), [
    'nitu-lucache/session/Fall Session - 2026-2.jpg',
    'nitu-lucache/session/Fall Session - 2026-18.jpg'
  ]);
  assert.equal(gallery.session[0].w, 4000);
  assert.equal(gallery.hero, 'https://photos.example.com/nitu-lucache/session/Fall%20Session%20-%202026-18.jpg');
  assert.equal(gallery.zips.session.url, '/cdn/nitu-lucache/nitu-lucache-session.zip');
  assert.deepEqual(gallery.labels, { session: 'Fall Mini Session' });

  // The original URL keeps working with its own manifest.
  assert.equal((await getGallery('nitu-lucache')).name, 'Nitu-Lucache');
});
