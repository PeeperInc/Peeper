const db = require('./database');
const { liveStats, FOOD_TYPES, HUNGER_DRAIN } = require('./gameLogic');
const { syncPeeperRow, ts } = require('./peeperState');
const { grantFridgeHomeDecor } = require('./homeState');
const { FRIDGE_PURCHASE_COST, getFridgePlan, extendFridgeFoodUntil } = require('./fridgeState');

const isCareAction = (type) => Object.hasOwn(FOOD_TYPES, type) || type === 'fridge_buy' || Boolean(getFridgePlan(type));
const failure = (statusCode, error, includeState = false) => ({ statusCode, error, includeState });

// Shared by the Mini App and Telegram widgets. Expected failures are returned so
// syncPeeperRow can persist a death even when the requested action is rejected.
const performCareAction = db.transaction((userId, type) => {
  if (!isCareAction(type)) return failure(400, 'Invalid food type');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return failure(404, 'User not found');
  const peeper = syncPeeperRow(userId);
  if (!peeper) return failure(404, 'Peeper not found');
  if (!peeper.alive) return failure(400, 'Your Peeper has passed away 😢');
  const live = liveStats(peeper);
  const now = ts();

  if (type === 'fridge_buy') {
    if (Number(peeper.fridge_owned) === 1) return failure(400, 'You already own a Fridge.', true);
    if (user.coins < FRIDGE_PURCHASE_COST) return failure(400, `Not enough coins! Need ${FRIDGE_PURCHASE_COST} ✦`, true);
    db.prepare('UPDATE peepers SET fridge_owned = 1, fridge_purchased_at = ? WHERE user_id = ?').run(now, userId);
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(FRIDGE_PURCHASE_COST, userId);
    grantFridgeHomeDecor(userId);
    return { message: `Fridge purchased! Stock it with food to keep ${peeper.name || 'Peeper'} full while you are away.`, coinsSpent: FRIDGE_PURCHASE_COST };
  }

  const plan = getFridgePlan(type);
  if (plan) {
    if (Number(peeper.fridge_owned) !== 1) return failure(400, 'Buy a Fridge first.', true);
    if (user.coins < plan.cost) return failure(400, `Not enough coins! Need ${plan.cost} ✦`, true);
    const foodUntil = extendFridgeFoodUntil(peeper.fridge_food_until, plan.days, now);
    db.prepare('UPDATE peepers SET hp = ?, last_fed = ?, fridge_food_until = ? WHERE user_id = ?').run(live.hp, now, foodUntil, userId);
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(plan.cost, userId);
    return { message: `Fridge stocked for ${plan.days} days.`, coinsSpent: plan.cost };
  }

  const food = FOOD_TYPES[type];
  if (live.hunger > 70) return failure(400, `${peeper.name || 'Peeper'} is not hungry yet! (${Math.round(live.hunger)}%)`);
  if (user.coins < food.cost) return failure(400, `Not enough coins! Need ${food.cost} ✦`);
  const hunger = Math.min(100, live.hunger + food.hunger);
  const lastFed = now - Math.round(HUNGER_DRAIN * (1 - hunger / 100));
  db.prepare('UPDATE peepers SET hp = ?, last_fed = ? WHERE user_id = ?').run(live.hp, lastFed, userId);
  db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(food.cost, userId);
  return { message: `${food.emoji} Yum! ${peeper.name || 'Peeper'} enjoyed the ${food.label}!`, coinsSpent: food.cost };
});

module.exports = { isCareAction, performCareAction };
