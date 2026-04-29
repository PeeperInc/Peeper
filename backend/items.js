/**
 * Items are now stored in the `shop_items` DB table.
 * This file only defines GIFT_ITEMS (still static) and helper functions.
 * Clothing/accessory items are fully managed via Admin panel.
 */
const db = require('./database');

const GIFT_ITEMS = [
  { id: 'gift_flower',   name: 'Wildflower',    price: 20,  emoji: '🌸' },
  { id: 'gift_heart',    name: 'Heart',          price: 30,  emoji: '💝' },
  { id: 'gift_star',     name: 'Shooting Star',  price: 40,  emoji: '⭐' },
  { id: 'gift_mushroom', name: 'Lucky Mushroom', price: 50,  emoji: '🍄' },
  { id: 'gift_cake',     name: 'Birthday Cake',  price: 60,  emoji: '🎂' },
  { id: 'gift_rainbow',  name: 'Rainbow',        price: 80,  emoji: '🌈' },
  { id: 'gift_diamond',  name: 'Diamond',        price: 100, emoji: '💎' },
  { id: 'gift_crown',    name: 'Royal Crown',    price: 200, emoji: '👑' },
];

/** Get all shop items from DB */
function getShopItems() {
  return db.prepare('SELECT * FROM shop_items ORDER BY slot, price').all();
}

/** Get free item IDs from DB */
function getFreeItemIds() {
  return db.prepare('SELECT item_id FROM shop_items WHERE is_free = 1').all().map(r => r.item_id);
}

/** Get item by ID (checks DB first, then gifts) */
function getItemById(id) {
  const dbItem = db.prepare('SELECT * FROM shop_items WHERE item_id = ?').get(id);
  if (dbItem) return dbItem;
  return GIFT_ITEMS.find(g => g.id === id) || null;
}

/** Get gift catalog from DB */
function getGiftCatalog() {
  return db.prepare('SELECT * FROM gift_catalog ORDER BY price').all();
}

/** Get gift by ID — checks DB catalog first, then legacy GIFT_ITEMS */
function getGiftById(id) {
  const dbGift = db.prepare('SELECT * FROM gift_catalog WHERE item_id = ?').get(id);
  if (dbGift) return { ...dbGift, id: dbGift.item_id };
  return GIFT_ITEMS.find(g => g.id === id) || null;
}

// Keep FREE_ITEM_IDS as a function for compat
const FREE_ITEM_IDS = [];   // legacy — now fetched from DB dynamically

module.exports = { GIFT_ITEMS, FREE_ITEM_IDS, getShopItems, getFreeItemIds, getItemById, getGiftCatalog, getGiftById };
