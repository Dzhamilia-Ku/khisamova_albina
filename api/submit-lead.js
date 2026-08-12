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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: 'Supabase not configured' });
    return;
  }

  try {
    const dbRes = await fetch(`${supabaseUrl}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        name,
        phone,
        email,
        service: service || null,
        message: comment || null,
        consent_pdn: !!consent_pdn,
        consent_service: !!consent_service,
        consent_ads: !!consent_ads,
      }),
    });

    if (!dbRes.ok) {
      res.status(502).json({ error: 'Supabase insert failed' });
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
      // Supabase already has the lead — Telegram is just a notification, safe to ignore failures
    }
  }

  res.status(200).json({ ok: true });
}
