import crypto from 'crypto';

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export default async function handler(req, res) {
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!adminPassword || !secret) {
    res.status(500).json({ error: 'Admin auth not configured' });
    return;
  }

  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length === 0) {
    res.status(400).json({ error: 'Missing password' });
    return;
  }

  const a = Buffer.from(password);
  const b = Buffer.from(adminPassword);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  const token = `${expires}.${sign(String(expires), secret)}`;
  res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24}`);
  res.status(200).json({ ok: true });
}
