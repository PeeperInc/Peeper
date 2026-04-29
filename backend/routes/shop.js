const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { validateTelegramInit } = require('../auth');
const { GIFT_ITEMS, getShopItems } = require('../items');

function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(req.telegramUser.id));
}

/** GET /api/shop/items */
router.get('/items', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const ownedSet = new Set(
    db.prepare('SELECT item_id FROM owned_items WHERE user_id = ?')
      .all(user.id).map(r => r.item_id)
  );

  const clothing = getShopItems().map(item => ({
    ...item,
    owned: item.is_free || ownedSet.has(item.item_id),
  }));

  res.json({ clothing, gifts: GIFT_ITEMS, coins: user.coins });
});

/** POST /api/shop/buy  body: { itemId } */
router.post('/buy', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId required' });

  const item = db.prepare('SELECT * FROM shop_items WHERE item_id = ?').get(itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.is_free) return res.status(400).json({ error: 'This item is free — you already own it!' });

  const alreadyOwned = db.prepare('SELECT id FROM owned_items WHERE user_id = ? AND item_id = ?').get(user.id, itemId);
  if (alreadyOwned) return res.status(400).json({ error: 'You already own this item!' });

  if (user.coins < item.price) {
    return res.status(400).json({ error: `Not enough coins! Need ${item.price}, you have ${user.coins}` });
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(item.price, user.id);
    db.prepare('INSERT INTO owned_items (user_id, item_id) VALUES (?, ?)').run(user.id, item.item_id);
  })();

  const updatedUser = db.prepare('SELECT coins FROM users WHERE id = ?').get(user.id);
  res.json({ message: `You bought: ${item.name}!`, item, coins: updatedUser.coins });
});

module.exports = router;
