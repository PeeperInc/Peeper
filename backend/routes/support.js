const express = require('express');
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const {
  SUPPORT_STAR_AMOUNTS,
  normalizeSupportStars,
  buildSupportPayload,
} = require('../supportState');

const router = express.Router();

function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(req.telegramUser.id));
}

async function createStarsInvoiceLink({ token, userId, stars }) {
  const payload = buildSupportPayload(userId, stars);
  const response = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Support Peeper',
      description: 'Voluntary donation to help keep Peeper online.',
      payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: `${stars} Telegram Stars`, amount: stars }],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data.result) {
    throw new Error(data.description || 'Could not create Telegram Stars invoice.');
  }
  return { invoiceLink: data.result, payload };
}

router.get('/stars/options', validateTelegramInit, (_req, res) => {
  res.json({ amounts: SUPPORT_STAR_AMOUNTS });
});

router.post('/stars/invoice', validateTelegramInit, async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let stars;
  try {
    stars = normalizeSupportStars(req.body?.amount);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const token = process.env.BOT_TOKEN;
  if (!token || token === 'dev') {
    return res.status(400).json({ error: 'Telegram Stars donations work only inside the live Telegram bot.' });
  }

  try {
    const invoice = await createStarsInvoiceLink({ token, userId: user.id, stars });
    res.json({
      invoiceLink: invoice.invoiceLink,
      amount: stars,
    });
  } catch (error) {
    console.error('[support] create invoice failed:', error.message);
    res.status(502).json({ error: error.message || 'Could not create Telegram Stars invoice.' });
  }
});

module.exports = router;
