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
      return { Contents: Object.keys(files).map((Key) => ({ Key, Size: 1 })) };
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
