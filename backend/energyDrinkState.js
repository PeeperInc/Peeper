const db = require('./database');
const { calcEnergy } = require('./gameLogic');
const { syncOwnedPeeper } = require('./peeperState');

const ENERGY_DRINK_COST = 10;
const ENERGY_DRINK_DAILY_LIMIT = 3;
const ENERGY_DRINK_ENERGY_THRESHOLD = 1;

function ts() {
  return Math.floor(Date.now() / 1000);
}

function getEnergyDrinkDayKey(nowTs = ts()) {
  return Math.floor(nowTs / 86400);
}

function getEnergyDrinkUsage(userId, dayKey = getEnergyDrinkDayKey()) {
  const row = db.prepare(`
    SELECT used_count
    FROM energy_drink_usage
    WHERE user_id = ? AND day_key = ?
  `).get(userId, dayKey);

  return Math.max(0, Number(row?.used_count || 0));
}

function getEnergyDrinkState(userId, peeper = null, nowTs = ts()) {
  const livePeeper = peeper || syncOwnedPeeper(userId, nowTs);
  const energy = calcEnergy(livePeeper?.fun ?? 100);
  const dayKey = getEnergyDrinkDayKey(nowTs);
  const usedToday = getEnergyDrinkUsage(userId, dayKey);
  const remainingToday = Math.max(0, ENERGY_DRINK_DAILY_LIMIT - usedToday);
  const available = energy <= ENERGY_DRINK_ENERGY_THRESHOLD && remainingToday > 0;

  return {
    cost: ENERGY_DRINK_COST,
    dailyLimit: ENERGY_DRINK_DAILY_LIMIT,
    energyThreshold: ENERGY_DRINK_ENERGY_THRESHOLD,
    usedToday,
    remainingToday,
    available,
  };
}

module.exports = {
  ENERGY_DRINK_COST,
  ENERGY_DRINK_DAILY_LIMIT,
  ENERGY_DRINK_ENERGY_THRESHOLD,
  getEnergyDrinkDayKey,
  getEnergyDrinkUsage,
  getEnergyDrinkState,
};
