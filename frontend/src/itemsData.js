/**
 * itemsData.js — frontend item catalog
 *
 * CLOTHING items are now fully managed via the Admin panel (stored in DB).
 * This file fetches them from the API at runtime.
 * GIFT items remain static here.
 */

// Clothing items are loaded dynamically from /api/shop/items
// See AppContext and ShopScreen for usage
export const CLOTHING_ITEMS = [];  // populated at runtime from API

export const GIFT_ITEMS = [
  { id: 'gift_flower',   name: 'Wildflower',    price: 20,  emoji: '🌸' },
  { id: 'gift_heart',    name: 'Heart',          price: 30,  emoji: '💝' },
  { id: 'gift_star',     name: 'Shooting Star',  price: 40,  emoji: '⭐' },
  { id: 'gift_mushroom', name: 'Lucky Mushroom', price: 50,  emoji: '🍄' },
  { id: 'gift_cake',     name: 'Birthday Cake',  price: 60,  emoji: '🎂' },
  { id: 'gift_rainbow',  name: 'Rainbow',        price: 80,  emoji: '🌈' },
  { id: 'gift_diamond',  name: 'Diamond',        price: 100, emoji: '💎' },
  { id: 'gift_crown',    name: 'Royal Crown',    price: 200, emoji: '👑' },
];
