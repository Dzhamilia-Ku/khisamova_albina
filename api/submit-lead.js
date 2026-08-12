export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { name, phone, email, service, comment } = req.body || {};

  if (!name || !phone || !email) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    res.status(500).json({ error: 'Telegram not configured' });
    return;
  }

  const text = [
    'Новая заявка с сайта khisamova_albina',
    `Имя: ${name}`,
    `Телефон: ${phone}`,
    `Email: ${email}`,
    service ? `Услуга: ${service}` : null,
    comment ? `Комментарий: ${comment}` : null,
  ].filter(Boolean).join('\n');

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!tgRes.ok) {
      res.status(502).json({ error: 'Telegram send failed' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
}
