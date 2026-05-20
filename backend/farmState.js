const db = require('./database');
const { extendFridgeFoodUntil } = require('./fridgeState');

const FARM_PURCHASE_COST = 1000;
const FARM_SLOT_COUNT = 9;
const FARM_SLOT_BUILD_COSTS = Object.freeze({
  plot: 30,
  pen: 50,
});
const WATER_COOLDOWN_SECONDS = 6 * 3600;
const WATER_REDUCTION_RATIO = 0.1;
const ANIMAL_LIFETIME_SECONDS = 7 * 86400;
const MAGIC_SQUASH_PRODUCT_ID = 'magic_squash';
const MAGIC_SQUASH_CHANCE = 0.01;

const PRODUCTS = Object.freeze({
  carrot: Object.freeze({ id: 'carrot', name: 'Carrot', icon: 'carrot', category: 'vegetable', value: 1, sellPrice: 1 }),
  tomato: Object.freeze({ id: 'tomato', name: 'Tomato', icon: 'tomato', category: 'vegetable', value: 2, sellPrice: 2 }),
  potato: Object.freeze({ id: 'potato', name: 'Potato', icon: 'potato', category: 'vegetable', value: 3, sellPrice: 3 }),
  magic_squash: Object.freeze({ id: MAGIC_SQUASH_PRODUCT_ID, name: 'Magic Squash', icon: 'magic_squash', category: 'vegetable', value: 100, sellPrice: 100 }),
  egg: Object.freeze({ id: 'egg', name: 'Egg', icon: 'egg', category: 'animal', value: 2, sellPrice: 2 }),
  milk: Object.freeze({ id: 'milk', name: 'Milk', icon: 'milk', category: 'animal', value: 3, sellPrice: 8 }),
  truffle: Object.freeze({ id: 'truffle', name: 'Truffle', icon: 'truffle', category: 'animal', value: 5, sellPrice: 25 }),
});

const CROPS = Object.freeze({
  carrot: Object.freeze({ id: 'carrot', name: 'Carrot', icon: 'carrot', seedCost: 1, growSeconds: 5 * 3600, yieldProductId: 'carrot', yieldQuantity: 10 }),
  tomato: Object.freeze({ id: 'tomato', name: 'Tomato', icon: 'tomato', seedCost: 3, growSeconds: 10 * 3600, yieldProductId: 'tomato', yieldQuantity: 9 }),
  potato: Object.freeze({ id: 'potato', name: 'Potato', icon: 'potato', seedCost: 5, growSeconds: 15 * 3600, yieldProductId: 'potato', yieldQuantity: 8 }),
});

const ANIMALS = Object.freeze({
  chicken: Object.freeze({ id: 'chicken', name: 'Chicken', icon: 'chicken', buyCost: 50, feedCost: 3, intervalSeconds: 8 * 3600, productId: 'egg', yieldQuantity: 5 }),
  cow: Object.freeze({ id: 'cow', name: 'Cow', icon: 'cow', buyCost: 100, feedCost: 7, intervalSeconds: 16 * 3600, productId: 'milk', yieldQuantity: 5 }),
  pig: Object.freeze({ id: 'pig', name: 'Pig', icon: 'pig', buyCost: 150, feedCost: 10, intervalSeconds: 24 * 3600, productId: 'truffle', yieldQuantity: 3 }),
});

const FRIDGE_RECIPES = Object.freeze({
  farm_fridge_3d: Object.freeze({ type: 'farm_fridge_3d', label: '3 days', days: 3, vegetableValue: 400, animalValue: 120 }),
  farm_fridge_7d: Object.freeze({ type: 'farm_fridge_7d', label: '7 days', days: 7, vegetableValue: 900, animalValue: 350 }),
});

const FAMILY_BIG_FEAST_RECIPE = Object.freeze({
  type: 'farm_family_big_feast',
  label: 'Family Big Feast',
  vegetableValue: 750,
  animalValue: 250,
});

function ts() {
  return Math.floor(Date.now() / 1000);
}

function clampSlotIndex(slotIndex) {
  const index = Math.floor(Number(slotIndex));
  if (!Number.isInteger(index) || index < 0 || index >= FARM_SLOT_COUNT) {
    throw new Error('Invalid farm slot');
  }
  return index;
}

function normalizeQuantity(quantity) {
  const next = Math.floor(Number(quantity) || 0);
  return Math.max(0, next);
}

function cloneCatalog() {
  return {
    farmCost: FARM_PURCHASE_COST,
    slotCount: FARM_SLOT_COUNT,
    slotBuildCosts: { ...FARM_SLOT_BUILD_COSTS },
    waterCooldownSeconds: WATER_COOLDOWN_SECONDS,
    crops: Object.values(CROPS).map((crop) => ({ ...crop })),
    animals: Object.values(ANIMALS).map((animal) => ({ ...animal })),
    products: Object.values(PRODUCTS).map((product) => ({ ...product })),
    fridgeRecipes: Object.values(FRIDGE_RECIPES).map((recipe) => ({ ...recipe })),
    familyBigFeastRecipe: { ...FAMILY_BIG_FEAST_RECIPE },
  };
}

function hasFarm(userId) {
  return Boolean(db.prepare('SELECT 1 FROM farms WHERE user_id = ?').get(userId));
}

function ensureFarmSlots(userId) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO farm_slots (user_id, slot_index)
    VALUES (?, ?)
  `);
  for (let index = 0; index < FARM_SLOT_COUNT; index += 1) {
    insert.run(userId, index);
  }
}

function getFarmSummary(userId) {
  const farm = db.prepare('SELECT * FROM farms WHERE user_id = ?').get(userId);
  if (!farm) {
    return {
      owned: false,
      purchasedAt: null,
      purchaseCost: FARM_PURCHASE_COST,
      builtSlots: 0,
      slotCount: FARM_SLOT_COUNT,
      hasAction: false,
      actionCount: 0,
    };
  }

  const now = ts();
  ensureFarmSlots(userId);
  syncExpiredAnimals(userId, now);
  const built = db.prepare(`
    SELECT COUNT(*) AS count
    FROM farm_slots
    WHERE user_id = ? AND slot_type IS NOT NULL
  `).get(userId)?.count || 0;
  const slots = db.prepare(`
    SELECT *
    FROM farm_slots
    WHERE user_id = ?
    ORDER BY slot_index
  `).all(userId);
  const actionCount = slots
    .map((row) => serializeSlot(row, now))
    .filter((slot) => (
      slot.state === 'plot_empty' ||
      slot.state === 'pen_empty' ||
      slot.state === 'crop_ready' ||
      slot.state === 'animal_ready' ||
      slot.state === 'animal_hungry' ||
      Boolean(slot.canWater)
    )).length;

  return {
    owned: true,
    purchasedAt: farm.purchased_at,
    purchaseCost: FARM_PURCHASE_COST,
    builtSlots: built,
    slotCount: FARM_SLOT_COUNT,
    hasAction: actionCount > 0,
    actionCount,
  };
}

function syncExpiredAnimals(userId, now = ts()) {
  db.prepare(`
    UPDATE farm_slots
    SET animal_type = NULL,
        animal_bought_at = NULL,
        animal_ready_at = NULL,
        animal_expires_at = NULL,
        updated_at = ?
    WHERE user_id = ?
      AND slot_type = 'pen'
      AND animal_type IS NOT NULL
      AND animal_expires_at IS NOT NULL
      AND animal_expires_at <= ?
  `).run(now, userId, now);
}

function rollCropResult(crop) {
  return Math.random() < MAGIC_SQUASH_CHANCE ? MAGIC_SQUASH_PRODUCT_ID : crop.yieldProductId;
}

function resolveCropResult(row, now = ts()) {
  if (!row || row.slot_type !== 'plot' || !row.crop_type) return null;
  const crop = CROPS[row.crop_type];
  if (!crop) return null;
  const plantedAt = Math.floor(Number(row.planted_at) || 0);
  const growSeconds = Math.max(0, Math.floor(Number(row.grow_seconds) || crop.growSeconds || 0));
  const readyAt = plantedAt + growSeconds;
  if (readyAt > now) return row.crop_result_product_id || null;

  if (row.crop_result_product_id && PRODUCTS[row.crop_result_product_id]) {
    return row.crop_result_product_id;
  }

  const resultProductId = rollCropResult(crop);
  db.prepare(`
    UPDATE farm_slots
    SET crop_result_product_id = ?,
        updated_at = ?
    WHERE user_id = ? AND slot_index = ?
  `).run(resultProductId, now, row.user_id, row.slot_index);
  row.crop_result_product_id = resultProductId;
  return resultProductId;
}

function syncReadyCropResults(userId, now = ts()) {
  const rows = db.prepare(`
    SELECT *
    FROM farm_slots
    WHERE user_id = ?
      AND slot_type = 'plot'
      AND crop_type IS NOT NULL
      AND crop_result_product_id IS NULL
  `).all(userId);
  for (const row of rows) {
    resolveCropResult(row, now);
  }
}

function serializeInventoryRow(row) {
  const product = PRODUCTS[row.product_id];
  if (!product) return null;
  const quantity = normalizeQuantity(row.quantity);
  return {
    ...product,
    quantity,
    totalValue: quantity * product.value,
    totalSellPrice: quantity * product.sellPrice,
  };
}

function getInventory(userId) {
  const rows = db.prepare(`
    SELECT product_id, quantity
    FROM farm_inventory
    WHERE user_id = ? AND quantity > 0
    ORDER BY product_id
  `).all(userId);

  return rows
    .map(serializeInventoryRow)
    .filter(Boolean);
}

function getInventoryValues(userId) {
  const result = { vegetable: 0, animal: 0 };
  for (const item of getInventory(userId)) {
    result[item.category] += item.totalValue;
  }
  return result;
}

function serializeSlot(row, now = ts()) {
  const slot = {
    index: row.slot_index,
    type: row.slot_type || null,
    state: row.slot_type ? 'empty' : 'unbuilt',
  };

  if (row.slot_type === 'plot') {
    if (!row.crop_type) {
      return { ...slot, state: 'plot_empty' };
    }

    const crop = CROPS[row.crop_type];
    const plantedAt = Math.floor(Number(row.planted_at) || 0);
    const growSeconds = Math.max(0, Math.floor(Number(row.grow_seconds) || crop?.growSeconds || 0));
    const readyAt = plantedAt + growSeconds;
    const remainingSeconds = Math.max(0, readyAt - now);
    const cropResultProductId = remainingSeconds <= 0 ? resolveCropResult(row, now) : null;
    const resultProduct = cropResultProductId ? PRODUCTS[cropResultProductId] : null;
    return {
      ...slot,
      state: remainingSeconds <= 0 ? 'crop_ready' : 'crop_growing',
      crop: crop ? { ...crop } : { id: row.crop_type, name: row.crop_type },
      cropResultProductId,
      cropResultProduct: resultProduct ? { ...resultProduct } : null,
      plantedAt,
      readyAt,
      remainingSeconds,
      waterAvailableAt: row.water_available_at || null,
      canWater: remainingSeconds > 0 && (!row.water_available_at || row.water_available_at <= now),
    };
  }

  if (row.slot_type === 'pen') {
    if (!row.animal_type) {
      return { ...slot, state: 'pen_empty' };
    }

    const animal = ANIMALS[row.animal_type];
    const readyAt = Math.floor(Number(row.animal_ready_at) || 0);
    const expiresAt = Math.floor(Number(row.animal_expires_at) || 0);
    const remainingSeconds = readyAt > 0 ? Math.max(0, readyAt - now) : 0;
    const lifeRemainingSeconds = expiresAt > 0 ? Math.max(0, expiresAt - now) : 0;
    return {
      ...slot,
      state: readyAt > 0
        ? (remainingSeconds <= 0 ? 'animal_ready' : 'animal_producing')
        : 'animal_hungry',
      animal: animal ? { ...animal } : { id: row.animal_type, name: row.animal_type },
      boughtAt: row.animal_bought_at || null,
      readyAt: readyAt || null,
      expiresAt: expiresAt || null,
      remainingSeconds,
      lifeRemainingSeconds,
      canFeed: readyAt <= 0,
      canCollect: readyAt > 0 && remainingSeconds <= 0,
    };
  }

  return slot;
}

function getFarmState(userId, now = ts()) {
  const farm = db.prepare('SELECT * FROM farms WHERE user_id = ?').get(userId);
  if (!farm) {
    return {
      farm: getFarmSummary(userId),
      slots: [],
      inventory: [],
      inventoryValues: { vegetable: 0, animal: 0 },
      catalog: cloneCatalog(),
    };
  }

  ensureFarmSlots(userId);
  syncExpiredAnimals(userId, now);
  syncReadyCropResults(userId, now);
  const slots = db.prepare(`
    SELECT *
    FROM farm_slots
    WHERE user_id = ?
    ORDER BY slot_index
  `).all(userId).map((row) => serializeSlot(row, now));

  return {
    farm: getFarmSummary(userId),
    slots,
    inventory: getInventory(userId),
    inventoryValues: getInventoryValues(userId),
    catalog: cloneCatalog(),
  };
}

function addInventory(userId, productId, quantity, now = ts()) {
  if (!PRODUCTS[productId]) throw new Error('Unknown farm product');
  const qty = normalizeQuantity(quantity);
  if (qty <= 0) return;
  db.prepare(`
    INSERT INTO farm_inventory (user_id, product_id, quantity, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, product_id) DO UPDATE SET
      quantity = quantity + excluded.quantity,
      updated_at = excluded.updated_at
  `).run(userId, productId, qty, now);
}

function getFarmCropReadiness(userId, now = ts()) {
  if (!hasFarm(userId)) return { plantedCount: 0, readyCount: 0, allPlantedReady: false };
  ensureFarmSlots(userId);
  syncReadyCropResults(userId, now);
  const rows = db.prepare(`
    SELECT crop_type, planted_at, grow_seconds
    FROM farm_slots
    WHERE user_id = ?
      AND slot_type = 'plot'
      AND crop_type IS NOT NULL
  `).all(userId);
  const plantedCount = rows.length;
  const readyCount = rows.filter((row) => {
    const crop = CROPS[row.crop_type];
    const plantedAt = Math.floor(Number(row.planted_at) || 0);
    const growSeconds = Math.max(0, Math.floor(Number(row.grow_seconds) || crop?.growSeconds || 0));
    return plantedAt + growSeconds <= now;
  }).length;
  return {
    plantedCount,
    readyCount,
    allPlantedReady: plantedCount > 0 && readyCount === plantedCount,
  };
}

function getConsumableProducts(category) {
  return Object.values(PRODUCTS)
    .filter((product) => product.category === category)
    .sort((a, b) => {
      const aRatio = a.sellPrice / Math.max(1, a.value);
      const bRatio = b.sellPrice / Math.max(1, b.value);
      if (aRatio !== bRatio) return aRatio - bRatio;
      if (a.value !== b.value) return a.value - b.value;
      return a.id.localeCompare(b.id);
    });
}

function consumeInventoryValue(userId, category, requiredValue, now = ts()) {
  const target = Math.max(0, Math.floor(Number(requiredValue) || 0));
  if (target <= 0) return { consumed: [], consumedValue: 0 };

  let remaining = target;
  let consumedValue = 0;
  const consumed = [];
  const update = db.prepare(`
    UPDATE farm_inventory
    SET quantity = quantity - ?, updated_at = ?
    WHERE user_id = ? AND product_id = ? AND quantity >= ?
  `);

  for (const product of getConsumableProducts(category)) {
    if (remaining <= 0) break;
    const row = db.prepare(`
      SELECT quantity
      FROM farm_inventory
      WHERE user_id = ? AND product_id = ?
    `).get(userId, product.id);
    const available = normalizeQuantity(row?.quantity);
    if (available <= 0) continue;

    const units = Math.min(available, Math.ceil(remaining / product.value));
    const value = units * product.value;
    update.run(units, now, userId, product.id, units);
    consumed.push({ productId: product.id, quantity: units, value });
    consumedValue += value;
    remaining -= value;
  }

  if (remaining > 0) {
    throw new Error(`Not enough ${category} products`);
  }

  db.prepare('DELETE FROM farm_inventory WHERE user_id = ? AND quantity <= 0').run(userId);
  return { consumed, consumedValue };
}

function getFridgeRecipe(type) {
  return FRIDGE_RECIPES[type] || null;
}

function applyFarmFridgeStock(userId, peeper, recipe, now = ts()) {
  const newFoodUntil = extendFridgeFoodUntil(peeper.fridge_food_until, recipe.days, now);
  consumeInventoryValue(userId, 'vegetable', recipe.vegetableValue, now);
  consumeInventoryValue(userId, 'animal', recipe.animalValue, now);
  db.prepare(`
    UPDATE peepers
    SET last_fed = ?,
        fridge_food_until = ?
    WHERE user_id = ?
  `).run(now, newFoodUntil, userId);
  return newFoodUntil;
}

module.exports = {
  FARM_PURCHASE_COST,
  FARM_SLOT_COUNT,
  FARM_SLOT_BUILD_COSTS,
  WATER_COOLDOWN_SECONDS,
  WATER_REDUCTION_RATIO,
  ANIMAL_LIFETIME_SECONDS,
  MAGIC_SQUASH_PRODUCT_ID,
  MAGIC_SQUASH_CHANCE,
  PRODUCTS,
  CROPS,
  ANIMALS,
  FRIDGE_RECIPES,
  FAMILY_BIG_FEAST_RECIPE,
  ts,
  clampSlotIndex,
  hasFarm,
  ensureFarmSlots,
  getFarmSummary,
  getFarmState,
  addInventory,
  getFarmCropReadiness,
  resolveCropResult,
  consumeInventoryValue,
  getInventoryValues,
  getFridgeRecipe,
  applyFarmFridgeStock,
};
