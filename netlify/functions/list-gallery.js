const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

// Lists objects in a Cloudflare R2 bucket for a given client slug and returns
// public CDN URLs grouped by category. The R2 bucket is expected to be exposed
// via a public custom domain (R2_PUBLIC_DOMAIN); this function only performs
// the LIST operation, image bytes are served directly to the browser.
//
// Required env vars:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//   R2_BUCKET_NAME, R2_PUBLIC_DOMAIN

const SLUG_RE = /^[a-z0-9-]{6,64}$/;
const CATEGORIES = ['engagement', 'wedding'];
const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|heic)$/i;

let s3Client;
function getClient() {
  if (s3Client) return s3Client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 credentials');
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
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: token
    }));
    if (res.Contents) objects.push(...res.Contents);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function readManifest(client, bucket, key) {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await res.Body.transformToString();
    const parsed = JSON.parse(text);
    return {
      name: typeof parsed.name === 'string' ? parsed.name : null,
      date: typeof parsed.date === 'string' ? parsed.date : null,
      message: typeof parsed.message === 'string' ? parsed.message : null
    };
  } catch (err) {
    return null;
  }
}

exports.handler = async (event) => {
  const slug = (event.queryStringParameters && event.queryStringParameters.c) || '';
  if (!SLUG_RE.test(slug)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid gallery code' }) };
  }

  const bucket = process.env.R2_BUCKET_NAME;
  const publicDomain = process.env.R2_PUBLIC_DOMAIN;
  if (!bucket || !publicDomain) {
    console.error('Missing R2_BUCKET_NAME or R2_PUBLIC_DOMAIN');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  let client;
  try {
    client = getClient();
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  let objects;
  try {
    objects = await listAll(client, bucket, `${slug}/`);
  } catch (err) {
    console.error('R2 list failed', err);
    return { statusCode: 502, body: JSON.stringify({ error: 'Storage unavailable' }) };
  }

  if (!objects.length) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Gallery not found' }) };
  }

  const result = { name: null, date: null, message: null };
  for (const cat of CATEGORIES) result[cat] = [];

  let manifestKey = null;
  for (const obj of objects) {
    const key = obj.Key;
    if (!key || key.endsWith('/')) continue;
    const rel = key.slice(slug.length + 1);
    if (rel === 'manifest.json') {
      manifestKey = key;
      continue;
    }
    const slashIdx = rel.indexOf('/');
    if (slashIdx === -1) continue;
    const category = rel.slice(0, slashIdx);
    if (!CATEGORIES.includes(category)) continue;
    const filename = rel.slice(slashIdx + 1);
    if (!filename || filename.includes('/')) continue;
    if (!IMAGE_RE.test(filename)) continue;
    const encodedKey = encodeURI(key);
    result[category].push({
      key,
      name: filename,
      url: `https://${publicDomain}/${encodedKey}`,
      downloadUrl: `/cdn/${encodedKey}`,
      size: obj.Size || 0
    });
  }

  for (const cat of CATEGORIES) {
    result[cat].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  if (manifestKey) {
    const manifest = await readManifest(client, bucket, manifestKey);
    if (manifest) Object.assign(result, manifest);
  }

  const totalImages = CATEGORIES.reduce((n, c) => n + result[c].length, 0);
  if (totalImages === 0) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Gallery not found' }) };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300'
    },
    body: JSON.stringify(result)
  };
};
