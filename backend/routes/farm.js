const express = require('express');
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const { syncOwnedPeeper } = require('../peeperState');
const { getFridgeState } = require('../fridgeState');
const { isNotificationEnabled } = require('../notificationSettings');
const { incrementProfileAchievementStat } = require('../profileCustomization');
const {
  getUserFamily,
  serveFamilyBigFeast,
} = require('../familyFeastState');
const {
  FARM_PURCHASE_COST,
  FARM_SLOT_BUILD_COSTS,
  WATER_COOLDOWN_SECONDS,
  WATER_REDUCTION_RATIO,
  ANIMAL_LIFETIME_SECONDS,
  CROPS,
  ANIMALS,
  PRODUCTS,
  ts,
  clampSlotIndex,
  hasFarm,
  ensureFarmSlots,
  getFarmState,
  getFridgeRecipe,
  FAMILY_BIG_FEAST_RECIPE,
  addInventory,
  resolveCropResult,
  shouldRetireAnimalAfterCollect,
  consumeInventoryValue,
  applyFarmFridgeStock,
} = require('../farmState');

const router = express.Router();
const COIN_SYMBOL = '\u2726';
const APP_URL = 'https://peeper.frenzyradio.online';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendTelegramFamilyMessage(userId, telegramId, text) {
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'dev' || !telegramId) return;
  if (!isNotificationEnabled(userId, 'family_notifications')) return;

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: 'Open Peeper',
            web_app: { url: APP_URL },
            style: 'success',
          }]],
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (err.error_code !== 403) {
        console.warn('[farm] family feast notification failed:', err.description || resp.status);
      }
    }
  } catch (error) {
    console.warn('[farm] family feast notification error:', error.message);
  }
}

function getUser(req) {
  const telegramId = String(req.telegramUser?.id || '');
  if (!telegramId) return null;
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

function getUserOr404(req, res) {
  const user = getUser(req);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  return user;
}

function getSlot(userId, slotIndex) {
  return db.prepare(`
    SELECT *
    FROM farm_slots
    WHERE user_id = ? AND slot_index = ?
  `).get(userId, slotIndex);
}

function requireFarm(userId, res) {
  if (hasFarm(userId)) return true;
  res.status(400).json({ error: 'Buy a Farm first.' });
  return false;
}

function freshCoins(userId) {
  return db.prepare('SELECT coins FROM users WHERE id = ?').get(userId)?.coins ?? 0;
}

function farmResponse(userId, extra = {}) {
  const peeper = syncOwnedPeeper(userId);
  const family = getUserFamily(userId);
  return {
    ...extra,
    coins: freshCoins(userId),
    family: family ? { id: family.id, name: family.name } : null,
    farmState: getFarmState(userId),
    fridge: getFridgeState(peeper),
  };
}

function assertCoins(user, cost) {
  if (user.coins < cost) {
    throw new Error(`Not enough coins! Need ${cost} ${COIN_SYMBOL}`);
  }
}

function sendActionError(res, userId, error) {
  const message = error?.message || 'Farm action failed';
  return res.status(400).json({ error: message, ...farmResponse(userId) });
}

router.get('/state', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user) return;
  res.json(farmResponse(user.id));
});

router.post('/buy', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user) return;

  if (hasFarm(user.id)) {
    return res.status(400).json({ error: 'You already own a Farm.', ...farmResponse(user.id) });
  }

  try {
    assertCoins(user, FARM_PURCHASE_COST);
    const now = ts();
    db.transaction(() => {
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(FARM_PURCHASE_COST, user.id);
      db.prepare('INSERT INTO farms (user_id, purchased_at) VALUES (?, ?)').run(user.id, now);
      ensureFarmSlots(user.id);
    })();

    res.json(farmResponse(user.id, {
      message: 'Farm purchased! Build plots or pens to start producing food.',
      coinsSpent: FARM_PURCHASE_COST,
    }));
  } catch (error) {
    sendActionError(res, user.id, error);
  }
});

router.post('/slots/:index/build', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user || !requireFarm(user.id, res)) return;

  try {
    const slotIndex = clampSlotIndex(req.params.index);
    const type = String(req.body.type || '').trim().toLowerCase();
    const rebuild = Boolean(req.body.rebuild);
    const cost = FARM_SLOT_BUILD_COSTS[type];
    if (!cost) throw new Error('Choose Plot or Pen.');
    assertCoins(user, cost);

    const now = ts();
    db.transaction(() => {
      ensureFarmSlots(user.id);
      const slot = getSlot(user.id, slotIndex);
      if (slot?.slot_type && !rebuild) {
        throw new Error('Use Rebuild mode to replace an existing slot.');
      }
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(cost, user.id);
      db.prepare(`
        UPDATE farm_slots
        SET slot_type = ?,
            crop_type = NULL,
            crop_result_product_id = NULL,
            planted_at = NULL,
            grow_seconds = NULL,
            water_available_at = NULL,
            animal_type = NULL,
            animal_bought_at = NULL,
            animal_ready_at = NULL,
            animal_expires_at = NULL,
            updated_at = ?
        WHERE user_id = ? AND slot_index = ?
      `).run(type, now, user.id, slotIndex);
    })();

    res.json(farmResponse(user.id, {
      message: `${type === 'plot' ? 'Plot' : 'Pen'} ${rebuild ? 'rebuilt' : 'built'}.`,
      coinsSpent: cost,
    }));
  } catch (error) {
    sendActionError(res, user.id, error);
  }
});

router.post('/slots/:index/plant', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user || !requireFarm(user.id, res)) return;

  try {
    const slotIndex = clampSlotIndex(req.params.index);
    const cropType = String(req.body.cropType || '').trim().toLowerCase();
    const crop = CROPS[cropType];
    if (!crop) throw new Error('Unknown crop.');
    assertCoins(user, crop.seedCost);

    const slot = getSlot(user.id, slotIndex);
    if (!slot || slot.slot_type !== 'plot') throw new Error('Build a plot here first.');
    if (slot.crop_type) throw new Error('This plot is already planted.');

    const now = ts();
    db.transaction(() => {
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(crop.seedCost, user.id);
      db.prepare(`
        UPDATE farm_slots
        SET crop_type = ?,
            crop_result_product_id = NULL,
            planted_at = ?,
            grow_seconds = ?,
            water_available_at = ?,
            updated_at = ?
        WHERE user_id = ? AND slot_index = ?
      `).run(crop.id, now, crop.growSeconds, now, now, user.id, slotIndex);
    })();

    res.json(farmResponse(user.id, {
      message: `${crop.name} planted.`,
      coinsSpent: crop.seedCost,
    }));
  } catch (error) {
    sendActionError(res, user.id, error);
  }
});

router.post('/slots/:index/water', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user || !requireFarm(user.id, res)) return;

  try {
    const slotIndex = clampSlotIndex(req.params.index);
    const slot = getSlot(user.id, slotIndex);
    if (!slot || slot.slot_type !== 'plot' || !slot.crop_type) throw new Error('Plant a crop first.');

    const now = ts();
    const readyAt = Number(slot.planted_at || 0) + Number(slot.grow_seconds || 0);
    const remaining = Math.max(0, readyAt - now);
    if (remaining <= 0) throw new Error('This crop is ready to harvest.');
    if (slot.water_available_at && slot.water_available_at > now) throw new Error('Watering is still cooling down.');

    const newRemaining = Math.max(60, Math.floor(remaining * (1 - WATER_REDUCTION_RATIO)));
    const newReadyAt = now + newRemaining;
    const newGrowSeconds = Math.max(0, newReadyAt - Number(slot.planted_at || now));

    db.prepare(`
      UPDATE farm_slots
      SET grow_seconds = ?,
          water_available_at = ?,
          updated_at = ?
      WHERE user_id = ? AND slot_index = ?
    `).run(newGrowSeconds, now + WATER_COOLDOWN_SECONDS, now, user.id, slotIndex);

    res.json(farmResponse(user.id, { message: 'Crop watered. Growth sped up by 10%.' }));
  } catch (error) {
    sendActionError(res, user.id, error);
  }
});

router.post('/slots/:index/harvest', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user || !requireFarm(user.id, res)) return;

  try {
    const slotIndex = clampSlotIndex(req.params.index);
    const slot = getSlot(user.id, slotIndex);
    if (!slot || slot.slot_type !== 'plot' || !slot.crop_type) throw new Error('No crop to harvest.');
    const crop = CROPS[slot.crop_type];
    if (!crop) throw new Error('Unknown crop.');

    const now = ts();
    const readyAt = Number(slot.planted_at || 0) + Number(slot.grow_seconds || 0);
    if (readyAt > now) throw new Error('This crop is still growing.');

    const resultProductId = resolveCropResult(slot, now) || crop.yieldProductId;
    const harvestQuantity = resultProductId === crop.yieldProductId ? crop.yieldQuantity : 1;

    db.transaction(() => {
      addInventory(user.id, resultProductId, harvestQuantity, now);
      db.prepare(`
        UPDATE farm_slots
        SET crop_type = NULL,
            crop_result_product_id = NULL,
            planted_at = NULL,
            grow_seconds = NULL,
            water_available_at = NULL,
            updated_at = ?
        WHERE user_id = ? AND slot_index = ?
      `).run(now, user.id, slotIndex);
    })();

    const product = PRODUCTS[resultProductId];
    res.json(farmResponse(user.id, {
      message: `Harvested ${harvestQuantity} ${product?.name || resultProductId}.`,
    }));
  } catch (error) {
    sendActionError(res, user.id, error);
  }
});

router.post('/slots/:index/buy-animal', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user || !requireFarm(user.id, res)) return;

  try {
    const slotIndex = clampSlotIndex(req.params.index);
    const animalType = String(req.body.animalType || '').trim().toLowerCase();
    const animal = ANIMALS[animalType];
    if (!animal) throw new Error('Unknown animal.');
    assertCoins(user, animal.buyCost);

    const slot = getSlot(user.id, slotIndex);
    if (!slot || slot.slot_type !== 'pen') throw new Error('Build a pen here first.');
    if (slot.animal_type) throw new Error('This pen already has an animal.');

    const now = ts();
    db.transaction(() => {
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(animal.buyCost, user.id);
      db.prepare(`
        UPDATE farm_slots
        SET animal_type = ?,
            animal_bought_at = ?,
            animal_ready_at = NULL,
            animal_expires_at = ?,
            updated_at = ?
        WHERE user_id = ? AND slot_index = ?
      `).run(animal.id, now, now + ANIMAL_LIFETIME_SECONDS, now, user.id, slotIndex);
    })();

    res.json(farmResponse(user.id, {
      message: `${animal.name} moved into the pen.`,
      coinsSpent: animal.buyCost,
    }));
  } catch (error) {
    sendActionError(res, user.id, error);
  }
});

router.post('/slots/:index/feed-animal', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user || !requireFarm(user.id, res)) return;

  try {
    const slotIndex = clampSlotIndex(req.params.index);
    const method = String(req.body.method || 'coins').trim().toLowerCase();
    if (method !== 'coins') throw new Error('Animals can only be fed with coins.');
    const slot = getSlot(user.id, slotIndex);
    if (!slot || slot.slot_type !== 'pen' || !slot.animal_type) throw new Error('No animal to feed.');

    const animal = ANIMALS[slot.animal_type];
    if (!animal) throw new Error('Unknown animal.');
    const now = ts();
    if (slot.animal_expires_at && slot.animal_expires_at <= now) throw new Error('This animal has retired.');
    if (slot.animal_ready_at) throw new Error('Collect the current product first.');

    db.transaction(() => {
      assertCoins(user, animal.feedCost);
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(animal.feedCost, user.id);
      db.prepare(`
        UPDATE farm_slots
        SET animal_ready_at = ?,
            updated_at = ?
        WHERE user_id = ? AND slot_index = ?
      `).run(now + animal.intervalSeconds, now, user.id, slotIndex);
    })();

    res.json(farmResponse(user.id, {
      message: `${animal.name} fed. Product will be ready later.`,
      coinsSpent: animal.feedCost,
    }));
  } catch (error) {
    sendActionError(res, user.id, error);
  }
});

router.post('/slots/:index/collect-animal', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user || !requireFarm(user.id, res)) return;

  try {
    const slotIndex = clampSlotIndex(req.params.index);
    const slot = getSlot(user.id, slotIndex);
    if (!slot || slot.slot_type !== 'pen' || !slot.animal_type) throw new Error('No animal product to collect.');

    const animal = ANIMALS[slot.animal_type];
    if (!animal) throw new Error('Unknown animal.');
    const now = ts();
    if (!slot.animal_ready_at || slot.animal_ready_at > now) throw new Error('Product is not ready yet.');

    db.transaction(() => {
      addInventory(user.id, animal.productId, animal.yieldQuantity, now);
      if (shouldRetireAnimalAfterCollect(slot, now)) {
        db.prepare(`
          UPDATE farm_slots
          SET animal_type = NULL,
              animal_bought_at = NULL,
              animal_ready_at = NULL,
              animal_expires_at = NULL,
              updated_at = ?
          WHERE user_id = ? AND slot_index = ?
        `).run(now, user.id, slotIndex);
      } else {
        db.prepare(`
          UPDATE farm_slots
          SET animal_ready_at = NULL,
              updated_at = ?
          WHERE user_id = ? AND slot_index = ?
        `).run(now, user.id, slotIndex);
      }
    })();

    const product = PRODUCTS[animal.productId];
    res.json(farmResponse(user.id, {
      message: `Collected ${animal.yieldQuantity} ${product?.name || animal.productId}.`,
    }));
  } catch (error) {
    sendActionError(res, user.id, error);
  }
});

router.post('/inventory/sell', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user || !requireFarm(user.id, res)) return;

  try {
    const productId = String(req.body.productId || '').trim().toLowerCase();
    const product = PRODUCTS[productId];
    if (!product) throw new Error('Unknown product.');
    const quantity = Math.max(1, Math.floor(Number(req.body.quantity) || 0));
    const row = db.prepare(`
      SELECT quantity
      FROM farm_inventory
      WHERE user_id = ? AND product_id = ?
    `).get(user.id, productId);
    if (!row || row.quantity < quantity) throw new Error(`Not enough ${product.name}.`);

    const coinsEarned = quantity * product.sellPrice;
    const now = ts();
    db.transaction(() => {
      db.prepare(`
        UPDATE farm_inventory
        SET quantity = quantity - ?, updated_at = ?
        WHERE user_id = ? AND product_id = ?
      `).run(quantity, now, user.id, productId);
      db.prepare('DELETE FROM farm_inventory WHERE user_id = ? AND quantity <= 0').run(user.id);
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(coinsEarned, user.id);
    })();

    res.json(farmResponse(user.id, {
      message: `Sold ${quantity} ${product.name} for ${coinsEarned} ${COIN_SYMBOL}.`,
      coinsEarned,
    }));
  } catch (error) {
    sendActionError(res, user.id, error);
  }
});

router.post('/inventory/stock-fridge', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user || !requireFarm(user.id, res)) return;

  try {
    const recipeType = String(req.body.recipeType || '').trim();
    const recipe = getFridgeRecipe(recipeType);
    if (!recipe) throw new Error('Unknown fridge recipe.');

    const peeper = syncOwnedPeeper(user.id);
    if (!peeper) throw new Error('Peeper not found.');
    if (Number(peeper.fridge_owned) !== 1) throw new Error('Buy Fridge first.');
    const now = ts();
    if (Number(peeper.fridge_food_until || 0) > now) {
      throw new Error('Fridge is already stocked. Add Farm stock after it runs out.');
    }

    let foodUntil = null;
    db.transaction(() => {
      foodUntil = applyFarmFridgeStock(user.id, peeper, recipe, now);
    })();

    res.json(farmResponse(user.id, {
      message: `Fridge stocked from Farm for ${recipe.days} days.`,
      foodUntil,
    }));
  } catch (error) {
    sendActionError(res, user.id, error);
  }
});

router.post('/inventory/family-big-feast', validateTelegramInit, (req, res) => {
  const user = getUserOr404(req, res);
  if (!user || !requireFarm(user.id, res)) return;

  const family = getUserFamily(user.id);
  if (!family) {
    return res.status(400).json({
      error: 'Join or create a family first.',
      ...farmResponse(user.id),
    });
  }

  const now = ts();
  let result = null;
  try {
    result = serveFamilyBigFeast({
      family,
      feasterUserId: user.id,
      nowTs: now,
      coinCost: 0,
      recordCooldown: false,
      beforeServe: () => {
        consumeInventoryValue(user.id, 'vegetable', FAMILY_BIG_FEAST_RECIPE.vegetableValue, now);
        consumeInventoryValue(user.id, 'animal', FAMILY_BIG_FEAST_RECIPE.animalValue, now);
        incrementProfileAchievementStat(user.id, 'farm_big_feasts_served');
      },
    });
  } catch (error) {
    return sendActionError(res, user.id, error);
  }

  const feastMessage = [
    '<b>FAMILY BIG FEAST!</b>',
    '',
    `<b>${escapeHtml(user.first_name || 'A family member')}</b> just served a farm-grown feast for the whole <b>${escapeHtml(family.name)}</b> family.`,
    '',
    'Your Peeper is now fed to <b>100%</b> hunger.',
  ].join('\n');
  for (const member of result.memberRows) {
    if (!result.fedMemberIds.includes(member.user_id) || member.user_id === user.id) continue;
    void sendTelegramFamilyMessage(member.user_id, member.telegram_id, feastMessage);
  }

  return res.json(farmResponse(user.id, {
    message: `Family Big Feast served! ${result.fedCount} family member${result.fedCount === 1 ? '' : 's'} fed to 100%.`,
    familyFeast: {
      consumedVegetableValue: FAMILY_BIG_FEAST_RECIPE.vegetableValue,
      consumedAnimalValue: FAMILY_BIG_FEAST_RECIPE.animalValue,
      fedCount: result.fedCount,
    },
  }));
});

module.exports = router;
