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

// Signs and sends a PUT request to Yandex Object Storage (S3-compatible, AWS SigV4).
async function putObject({ bucket, key, body, accessKeyId, secretKey }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = `/${bucket}/${key}`;
  const payloadHash = sha256Hex(body);

  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${YC_HOST}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${YC_REGION}/${YC_SERVICE}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, YC_REGION);
  const kService = hmac(kRegion, YC_SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`https://${YC_HOST}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
    body,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const {
    name, phone, email, service, comment,
    consent_pdn, consent_service, consent_ads,
  } = req.body || {};

  if (!name || !phone || !email) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const accessKeyId = process.env.YC_ACCESS_KEY_ID;
  const secretKey = process.env.YC_SECRET_KEY;
  const bucket = process.env.YC_BUCKET || 'users.albinamakeup.ru';

  if (!accessKeyId || !secretKey) {
    res.status(500).json({ error: 'Yandex Object Storage not configured' });
    return;
  }

  const submittedAt = new Date().toISOString();
  const leadId = `${submittedAt.replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
  const key = `leads/${leadId}.json`;

  const body = JSON.stringify({
    name,
    phone,
    email,
    service: service || null,
    message: comment || null,
    consent_pdn: !!consent_pdn,
    consent_service: !!consent_service,
    consent_ads: !!consent_ads,
    submitted_at: submittedAt,
  });

  try {
    const putRes = await putObject({ bucket, key, body, accessKeyId, secretKey });
    if (!putRes.ok) {
      res.status(502).json({ error: 'Yandex Object Storage write failed' });
      return;
    }
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
    return;
  }

  // Best-effort Telegram notification — optional, does not block success
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChatId) {
    // Normalize the phone number into a Telegram "chat by phone" link (t.me/+<digits>)
    let digits = String(phone).replace(/[^\d]/g, '');
    if (digits.length === 11 && digits.startsWith('8')) {
      digits = '7' + digits.slice(1);
    }
    const telegramLink = digits.length >= 10 ? `https://t.me/+${digits}` : null;

    const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const lines = [
      '<b>Новая заявка с сайта khisamova_albina</b>',
      `Имя: ${escapeHtml(name)}`,
      `Телефон: ${escapeHtml(phone)}`,
      `Email: ${escapeHtml(email)}`,
      service ? `Услуга: ${escapeHtml(service)}` : null,
      comment ? `Комментарий: ${escapeHtml(comment)}` : null,
      telegramLink ? `\n<a href="${telegramLink}">Написать в Telegram →</a>` : null,
    ].filter(Boolean);

    try {
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChatId, text: lines.join('\n'), parse_mode: 'HTML' }),
      });
    } catch (e) {
      // Storage write already succeeded — Telegram is just a notification, safe to ignore failures
    }
  }

  res.status(200).json({ ok: true });
}
