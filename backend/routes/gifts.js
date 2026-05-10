const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const { GIFT_ITEMS, getGiftCatalog } = require('../items');
const { isNotificationEnabled } = require('../notificationSettings');

const APP_URL = 'https://peeper.frenzyradio.online';

function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?')
    .get(String(req.telegramUser.id));
}

// ── Send Telegram notification ─────────────────────────────────────────────
async function sendGiftNotification(recipientUserId, recipientTelegramId, senderName, giftName) {
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'dev') return;
  if (!isNotificationEnabled(recipientUserId, 'gift_notifications')) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: recipientTelegramId,
        text: `🎁 <b>You received a gift!</b>\n\n<b>${senderName}</b> sent you <b>${giftName}</b>\n\nOpen the app to see the message 👀`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: '🐸 Open Peeper',
            web_app: { url: APP_URL },
            style:   'success',
          }]],
        },
      }),
    });
  } catch (e) {
    console.warn('[gifts] notification error:', e.message);
  }
}

/** GET /api/gifts/catalog */
router.get('/catalog', validateTelegramInit, (_req, res) => {
  res.json({ gifts: getGiftCatalog() });
});

/** GET /api/gifts/search?q= */
router.get('/search', validateTelegramInit, (req, res) => {
  const selfUser = getUser(req);
  const query = (req.query.q || '').trim().replace(/^@/, '');
  if (!query || query.length < 2) return res.status(400).json({ error: 'Query too short' });

  const results = db.prepare(`
    SELECT id, username, first_name, photo_url, supporter_since, supporter_stars FROM users
    WHERE (username LIKE ? OR first_name LIKE ?) AND id != ?
    LIMIT 10
  `).all(`%${query}%`, `%${query}%`, selfUser?.id ?? 0);

  res.json({ users: results });
});

/** POST /api/gifts/send */
router.post('/send', validateTelegramInit, async (req, res) => {
  const sender = getUser(req);
  if (!sender) return res.status(404).json({ error: 'Sender not found' });

  const { recipientId, giftId, message = null, isPrivate = false } = req.body;
  if (!recipientId || !giftId) return res.status(400).json({ error: 'recipientId and giftId required' });
  if (recipientId === sender.id) return res.status(400).json({ error: "You can't gift yourself! 🐸" });

  const dbGift = db.prepare('SELECT * FROM gift_catalog WHERE item_id = ?').get(giftId);
  if (!dbGift) return res.status(404).json({ error: 'Gift not found or no longer available' });

  const recipient = db.prepare('SELECT id, username, first_name, telegram_id FROM users WHERE id = ?').get(recipientId);
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

  if (sender.coins < dbGift.price) {
    return res.status(400).json({ error: `Not enough coins! Need ${dbGift.price}, you have ${sender.coins}` });
  }

  const trimmedMsg = message ? String(message).trim().slice(0, 120) || null : null;

  db.transaction(() => {
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(dbGift.price, sender.id);
    db.prepare(`
      INSERT INTO gifts_received (recipient_id, sender_id, gift_id, gift_price, message, is_private, is_seen)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(recipient.id, sender.id, dbGift.item_id, dbGift.price, trimmedMsg, isPrivate ? 1 : 0);
  })();

  // Send Telegram notification (fire-and-forget)
  if (recipient.telegram_id) {
    sendGiftNotification(
      recipient.id,
      recipient.telegram_id,
      sender.first_name || sender.username || 'Someone',
      dbGift.name,
    );
  }

  const updatedSender = db.prepare('SELECT coins FROM users WHERE id = ?').get(sender.id);
  res.json({
    message: `You sent ${dbGift.name} to ${recipient.first_name}! 🎁`,
    gift: dbGift,
    recipient,
    coins: updatedSender.coins,
  });
});

/**
 * GET /api/gifts/received/:userId
 * New gifts (is_seen=0, owned by viewer) come first, then sorted by price DESC.
 */
router.get('/received/:userId', validateTelegramInit, (req, res) => {
  const viewer  = getUser(req);
  const userId  = parseInt(req.params.userId, 10);
  const isOwner = viewer?.id === userId;

  const gifts = db.prepare(`
    SELECT gr.id, gr.gift_id, gr.gift_price, gr.sent_at,
           gr.is_private, gr.is_seen, gr.sender_id,
           CASE WHEN gr.is_private = 0 OR ? = 1 THEN gr.message ELSE NULL END AS message,
           u.username    AS sender_username,
           u.first_name  AS sender_name,
           u.photo_url   AS sender_photo,
           u.supporter_since AS sender_supporter_since,
           u.supporter_stars AS sender_supporter_stars,
           gc.file_path  AS gift_image_url,
           gc.name       AS gift_catalog_name
    FROM gifts_received gr
    LEFT JOIN users u   ON gr.sender_id = u.id
    LEFT JOIN gift_catalog gc ON gr.gift_id = gc.item_id
    WHERE gr.recipient_id = ?
    ORDER BY
      CASE WHEN ? = 1 AND gr.is_seen = 0 THEN 0 ELSE 1 END,
      gr.gift_price DESC,
      gr.sent_at DESC
  `).all(isOwner ? 1 : 0, userId, isOwner ? 1 : 0);

  res.json({ gifts, topGifts: gifts, totalCount: gifts.length });
});

/**
 * POST /api/gifts/seen/:giftId
 * Marks a gift as seen — only the recipient can do this.
 */
router.post('/seen/:giftId', validateTelegramInit, (req, res) => {
  const viewer  = getUser(req);
  const giftId  = parseInt(req.params.giftId, 10);

  const gift = db.prepare('SELECT * FROM gifts_received WHERE id = ?').get(giftId);
  if (!gift) return res.status(404).json({ error: 'Gift not found' });
  if (gift.recipient_id !== viewer?.id) return res.status(403).json({ error: 'Not your gift' });

  db.prepare('UPDATE gifts_received SET is_seen = 1 WHERE id = ?').run(giftId);
  res.json({ ok: true });
});

module.exports = router;
