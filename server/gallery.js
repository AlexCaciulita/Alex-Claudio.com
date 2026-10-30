const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const SLUG_RE = /^[a-z0-9-]{6,64}$/;
// `session` covers everything that is not a wedding or an engagement: fall minis, family and portrait sessions.
const CATEGORIES = ['engagement', 'session', 'wedding'];
const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|heic)$/i;
const HERO_POSITION_RE = /^\d{1,3}% \d{1,3}%$/;

class GalleryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let s3Client;

function getPublicOrigin() {
  const value = process.env.R2_PUBLIC_DOMAIN;
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value.replace(/\/$/, '') : `https://${value.replace(/\/$/, '')}`;
}

function getClient() {
  if (s3Client) return s3Client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new GalleryError(500, 'Server misconfigured');
  }
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  });
  return s3Client;
}

async function listAll(client, bucket, prefix) {
  const objects = [];
  let token;
  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token
    }));
    if (response.Contents) objects.push(...response.Contents);
    token = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function readJson(client, bucket, key) {
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return JSON.parse(await response.Body.transformToString());
  } catch (error) {
    console.warn(`Unable to read optional gallery file ${key}:`, error.message);
    return null;
  }
}

async function getGallery(slug) {
  if (!SLUG_RE.test(slug)) {
    throw new GalleryError(400, 'Invalid gallery code');
  }

  const bucket = process.env.R2_BUCKET_NAME;
  const publicOrigin = getPublicOrigin();
  if (!bucket || !publicOrigin) {
    throw new GalleryError(500, 'Server misconfigured');
  }

  const list = async (prefix) => {
    try {
      return await listAll(getClient(), bucket, `${prefix}/`);
    } catch (error) {
      if (error instanceof GalleryError) throw error;
      console.error('R2 list failed:', error);
      throw new GalleryError(502, 'Storage unavailable');
    }
  };

  let objects = await list(slug);
  if (!objects.length) {
    throw new GalleryError(404, 'Gallery not found');
  }

  // The gallery's own manifest names it. With "photosFrom": "<other-slug>" it shows that gallery's photos,
  // which lets a gallery move to a corrected URL without uploading the photos again.
  const ownManifestKey = `${slug}/manifest.json`;
  const manifest = objects.some((object) => object.Key === ownManifestKey)
    ? await readJson(getClient(), bucket, ownManifestKey)
    : null;
  let source = slug;
  if (manifest && typeof manifest.photosFrom === 'string' && SLUG_RE.test(manifest.photosFrom) && manifest.photosFrom !== slug) {
    source = manifest.photosFrom;
    objects = await list(source);
  }

  const result = { name: null, date: null, message: null, hero: null, heroPosition: null, labels: {}, zips: {} };
  for (const category of CATEGORIES) result[category] = [];

  let dimensionsKey;
  for (const object of objects) {
    const key = object.Key;
    if (!key || key.endsWith('/')) continue;
    const relativeKey = key.slice(source.length + 1);
    if (relativeKey === 'manifest.json') continue;
    if (relativeKey === 'dimensions.json') {
      dimensionsKey = key;
      continue;
    }

    const zipCategory = CATEGORIES.find((category) => relativeKey === `${source}-${category}.zip`);
    if (zipCategory) {
      result.zips[zipCategory] = { url: `/cdn/${encodeURI(key)}`, size: object.Size || 0 };
      continue;
    }

    const slashIndex = relativeKey.indexOf('/');
    if (slashIndex === -1) continue;
    const category = relativeKey.slice(0, slashIndex);
    if (!CATEGORIES.includes(category)) continue;
    const filename = relativeKey.slice(slashIndex + 1);
    if (!filename || filename.includes('/') || !IMAGE_RE.test(filename)) continue;

    const encodedKey = encodeURI(key);
    result[category].push({
      key,
      name: filename,
      url: `${publicOrigin}/${encodedKey}`,
      downloadUrl: `/cdn/${encodedKey}`,
      size: object.Size || 0
    });
  }

  for (const category of CATEGORIES) {
    result[category].sort((a, b) => a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
  }

  if (manifest && typeof manifest === 'object') {
    for (const field of ['name', 'date', 'message', 'hero']) {
      result[field] = typeof manifest[field] === 'string' ? manifest[field] : null;
    }
    // CSS object-position for the hero crop, e.g. "50% 100%" to keep the bottom of the photo.
    if (typeof manifest.heroPosition === 'string' && HERO_POSITION_RE.test(manifest.heroPosition)) {
      result.heroPosition = manifest.heroPosition;
    }
    // Optional per-gallery section titles, e.g. { "session": "Fall Mini Session" }, in place of the defaults.
    if (manifest.labels && typeof manifest.labels === 'object') {
      for (const category of CATEGORIES) {
        const label = manifest.labels[category];
        if (typeof label === 'string' && label.trim()) result.labels[category] = label.trim();
      }
    }
  }

  if (dimensionsKey) {
    const dimensions = await readJson(getClient(), bucket, dimensionsKey);
    if (dimensions && typeof dimensions === 'object') {
      for (const category of CATEGORIES) {
        for (const photo of result[category]) {
          const size = dimensions[photo.name];
          if (Array.isArray(size) && size.length === 2 && size[0] > 0 && size[1] > 0) {
            [photo.w, photo.h] = size;
          }
        }
      }
    }
  }

  if (result.hero) {
    const relativeHero = result.hero.replace(/^\/+/, '');
    result.hero = IMAGE_RE.test(relativeHero) && !relativeHero.includes('..')
      ? `${publicOrigin}/${encodeURI(`${source}/${relativeHero}`)}`
      : null;
  }

  const imageCount = CATEGORIES.reduce((count, category) => count + result[category].length, 0);
  if (imageCount === 0) {
    throw new GalleryError(404, 'Gallery not found');
  }

  return result;
}

module.exports = { CATEGORIES, GalleryError, getGallery, getPublicOrigin };
