const db = require('./database');
const { liveStats, HUNGER_DRAIN } = require('./gameLogic');
const { syncPeeperRow } = require('./peeperState');

const BIG_FEAST_COST = 100;
const BIG_FEAST_COOLDOWN = 7 * 24 * 3600;

function ts() {
  return Math.floor(Date.now() / 1000);
}

function getUserFamily(userId) {
  return db.prepare(`
    SELECT f.* FROM families f
    JOIN family_members fm ON fm.family_id = f.id
    WHERE fm.user_id = ?
  `).get(userId);
}

function getFamilyMemberRows(familyId) {
  return db.prepare(`
    SELECT u.id AS user_id, u.telegram_id, u.first_name
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    WHERE fm.family_id = ?
  `).all(familyId);
}

function getBigFeastStatus(userId, nowTs = ts()) {
  const lastUse = db.prepare(`
    SELECT used_at
    FROM family_big_feasts
    WHERE feaster_id = ?
    ORDER BY used_at DESC
    LIMIT 1
  `).get(userId);

  const availableAt = lastUse ? lastUse.used_at + BIG_FEAST_COOLDOWN : nowTs;
  const cooldownSeconds = Math.max(0, availableAt - nowTs);

  return {
    cost: BIG_FEAST_COST,
    cooldown_seconds: cooldownSeconds,
    // A ready feast has no deadline, including on clients with a slow clock.
    available_at: cooldownSeconds > 0 ? availableAt : 0,
    last_used_at: lastUse?.used_at || null,
    available: cooldownSeconds <= 0,
  };
}

function applyFullFeed(userId, nowTs = ts()) {
  const peeper = syncPeeperRow(userId, nowTs);
  if (!peeper || !peeper.alive) return false;

  const live = liveStats(peeper, nowTs);
  if (!live.alive) return false;

  db.prepare(`
    UPDATE peepers
    SET hp = ?, last_fed = ?
    WHERE user_id = ?
  `).run(live.hp, nowTs - Math.round(HUNGER_DRAIN * (1 - 1)), userId);

  return true;
}

function serveFamilyBigFeast({
  family,
  feasterUserId,
  nowTs = ts(),
  coinCost = 0,
  recordCooldown = false,
  beforeServe = null,
}) {
  const memberRows = getFamilyMemberRows(family.id);
  let fedCount = 0;
  const fedMemberIds = [];

  db.transaction(() => {
    if (beforeServe) beforeServe();

    for (const member of memberRows) {
      if (applyFullFeed(member.user_id, nowTs)) {
        fedCount += 1;
        fedMemberIds.push(member.user_id);
      }
    }

    if (fedCount <= 0) {
      throw new Error('No living family members need a Big Feast right now');
    }

    if (coinCost > 0) {
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(coinCost, feasterUserId);
    }

    if (recordCooldown) {
      db.prepare(`
        INSERT INTO family_big_feasts (family_id, feaster_id, cost, used_at)
        VALUES (?, ?, ?, ?)
      `).run(family.id, feasterUserId, coinCost, nowTs);
    }
  })();

  return { memberRows, fedCount, fedMemberIds };
}

module.exports = {
  BIG_FEAST_COST,
  BIG_FEAST_COOLDOWN,
  ts,
  getUserFamily,
  getBigFeastStatus,
  applyFullFeed,
  serveFamilyBigFeast,
};
