const FRIDGE_PURCHASE_COST = 500;
const FRIDGE_PLANS = Object.freeze({
  fridge_stock_3d: Object.freeze({ type: 'fridge_stock_3d', days: 3, cost: 150 }),
  fridge_stock_7d: Object.freeze({ type: 'fridge_stock_7d', days: 7, cost: 500 }),
});

function ts() {
  return Math.floor(Date.now() / 1000);
}

function normalizeUnix(value) {
  const next = Math.floor(Number(value) || 0);
  return next > 0 ? next : null;
}

function getFridgeState(peeper, nowTs = ts()) {
  const owned = Boolean(Number(peeper?.fridge_owned) || 0);
  const foodUntil = normalizeUnix(peeper?.fridge_food_until);
  const purchasedAt = normalizeUnix(peeper?.fridge_purchased_at);
  const remainingSeconds = owned && foodUntil
    ? Math.max(0, foodUntil - nowTs)
    : 0;

  return {
    owned,
    active: remainingSeconds > 0,
    foodUntil,
    remainingSeconds,
    purchasedAt,
    purchaseCost: FRIDGE_PURCHASE_COST,
    plans: Object.values(FRIDGE_PLANS).map((plan) => ({ ...plan })),
  };
}

function getFridgePlan(type) {
  return FRIDGE_PLANS[type] || null;
}

function extendFridgeFoodUntil(currentFoodUntil, days, nowTs = ts()) {
  const base = Math.max(nowTs, Math.floor(Number(currentFoodUntil) || 0));
  return base + Math.max(0, Math.floor(Number(days) || 0)) * 86400;
}

module.exports = {
  FRIDGE_PURCHASE_COST,
  FRIDGE_PLANS,
  getFridgePlan,
  getFridgeState,
  extendFridgeFoodUntil,
};
