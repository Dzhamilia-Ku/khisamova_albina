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
    const text = [
      'Новая заявка с сайта khisamova_albina',
      `Имя: ${name}`,
      `Телефон: ${phone}`,
      `Email: ${email}`,
      service ? `Услуга: ${service}` : null,
      comment ? `Комментарий: ${comment}` : null,
    ].filter(Boolean).join('\n');

    try {
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChatId, text }),
      });
    } catch (e) {
      // Supabase already has the lead — Telegram is just a notification, safe to ignore failures
    }
  }

  res.status(200).json({ ok: true });
}
