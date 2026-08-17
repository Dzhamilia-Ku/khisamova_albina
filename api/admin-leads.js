import crypto from 'crypto';

const YC_REGION = 'ru-central1';
const YC_SERVICE = 's3';
const YC_HOST = 'storage.yandexcloud.net';

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function verifySession(req) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  const cookie = req.cookies && req.cookies.admin_session;
  if (!cookie || !secret) return false;
  const dotIndex = cookie.indexOf('.');
  if (dotIndex === -1) return false;
  const expiresStr = cookie.slice(0, dotIndex);
  const sig = cookie.slice(dotIndex + 1);
  const expected = crypto.createHmac('sha256', secret).update(expiresStr).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const expires = parseInt(expiresStr, 10);
  return Number.isFinite(expires) && Date.now() / 1000 < expires;
}

// Signs and sends a request to Yandex Object Storage (S3-compatible, AWS SigV4).
async function signedRequest({ method, bucket, path, query, body, accessKeyId, secretKey }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = `/${bucket}${path}`;
  const payloadHash = sha256Hex(body || '');
  const canonicalHeaders = `host:${YC_HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalQuery = (query || [])
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${YC_REGION}/${YC_SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, YC_REGION);
  const kService = hmac(kRegion, YC_SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `https://${YC_HOST}${canonicalUri}${canonicalQuery ? '?' + canonicalQuery : ''}`;
  return fetch(url, {
    method,
    headers: { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, Authorization: authorization },
    body: method === 'GET' || method === 'DELETE' ? undefined : body,
  });
}

async function listLeadKeys({ bucket, accessKeyId, secretKey }) {
  let keys = [];
  let continuationToken = null;
  do {
    const query = [['list-type', '2'], ['prefix', 'leads/'], ['max-keys', '1000']];
    if (continuationToken) query.push(['continuation-token', continuationToken]);
    const listRes = await signedRequest({ method: 'GET', bucket, path: '/', query, accessKeyId, secretKey });
    const text = await listRes.text();
    keys = keys.concat([...text.matchAll(/<Key>(.*?)<\/Key>/g)].map((m) => m[1]));
    const isTruncated = /<IsTruncated>true<\/IsTruncated>/.test(text);
    const tokenMatch = text.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);
    continuationToken = isTruncated && tokenMatch ? tokenMatch[1] : null;
  } while (continuationToken);
  return keys;
}

export default async function handler(req, res) {
  if (!verifySession(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const accessKeyId = process.env.YC_ACCESS_KEY_ID;
  const secretKey = process.env.YC_SECRET_KEY;
  const bucket = process.env.YC_BUCKET || 'users.albinamakeup.ru';

  if (req.method === 'GET') {
    const keys = await listLeadKeys({ bucket, accessKeyId, secretKey });
    const leads = await Promise.all(
      keys.map(async (key) => {
        try {
          const objRes = await signedRequest({ method: 'GET', bucket, path: '/' + key, accessKeyId, secretKey });
          if (!objRes.ok) return null;
          const json = await objRes.json();
          return { key, ...json };
        } catch (e) {
          return null;
        }
      })
    );
    const valid = leads.filter(Boolean).sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')));
    res.status(200).json({ leads: valid });
    return;
  }

  if (req.method === 'DELETE') {
    const { keys } = req.body || {};
    if (!Array.isArray(keys) || keys.length === 0) {
      res.status(400).json({ error: 'No keys provided' });
      return;
    }
    const safeKeys = keys.filter((k) => typeof k === 'string' && k.startsWith('leads/'));
    const results = await Promise.all(
      safeKeys.map(async (key) => {
        const delRes = await signedRequest({ method: 'DELETE', bucket, path: '/' + key, accessKeyId, secretKey });
        return { key, ok: delRes.ok };
      })
    );
    res.status(200).json({ results });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
