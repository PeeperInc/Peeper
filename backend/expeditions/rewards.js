'use strict';

const { ARTIFACTS } = require('./catalog');
const { applyPassiveArtifactEffects } = require('./artifactEffects');
const {
  LOOT_TABLES,
  grantArtifact,
  rollCoins,
  rollPersonalLoot,
} = require('./loot');

const FINAL_COIN_RANGE = Object.freeze({ min: 18, max: 30 });
const CONTRIBUTION_COIN_STEP = 4;
const DUPLICATE_SUBSTITUTION_COINS = Object.freeze({
  common: 5,
  rare: 10,
  epic: 18,
  legendary: 30,
});

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function parseJson(text, fallback) {
  if (!text) return clone(fallback);
  try {
    return JSON.parse(text);
  } catch {
    return clone(fallback);
  }
}

function stringifyJson(value) {
  return JSON.stringify(value ?? {});
}

function parseClaimableRewardPayload(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new RangeError('Invalid reward payload');
  }

  const isNonNegativeInteger = value => Number.isInteger(value) && value >= 0;
  const validArtifacts = Array.isArray(payload?.artifacts)
    && payload.artifacts.every(artifact => {
      if (!artifact || typeof artifact !== 'object' || !ARTIFACTS[artifact.artifactId]) return false;
      if (artifact.duplicate === true) {
        return artifact.coins === duplicateSubstitutionCoins(artifact.artifactId);
      }
      return artifact.duplicate === undefined && artifact.coins === undefined;
    });
  const valid = payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && isNonNegativeInteger(payload.contributionAp)
    && isNonNegativeInteger(payload.roomCoins)
    && isNonNegativeInteger(payload.finalCoins)
    && isNonNegativeInteger(payload.totalCoins)
    && payload.totalCoins === payload.roomCoins + payload.finalCoins
    && validArtifacts
    && typeof payload.expeditionTitle === 'string'
    && payload.expeditionTitle.length > 0
    && Number.isInteger(payload.completedAt)
    && payload.completedAt > 0;

  if (!valid) throw new RangeError('Invalid reward payload');
  return payload;
}

function assertDb(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('A SQLite transaction or database handle is required');
  }
}

function assertTransaction(db) {
  assertDb(db);
  if (db.inTransaction !== true) {
    throw new TypeError('reward mutations require an active caller transaction');
  }
}

function unixSeconds(value = Date.now()) {
  const time = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(time)) throw new TypeError('A valid timestamp is required');
  return Math.floor(Math.abs(time) > 1_000_000_000_000 ? time / 1000 : time);
}

function tableExists(db, tableName) {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(tableName));
}

function normalizeLoadout(text) {
  const parsed = parseJson(text, []);
  const slots = Array.isArray(parsed) ? parsed : parsed?.slots || parsed?.loadout || [];
  return Array.isArray(slots) ? slots.filter(Boolean) : [];
}

function rowToExpedition(row) {
  if (!row) return null;
  return {
    id: row.id,
    familyId: row.family_id,
    themeId: row.theme_id,
    status: row.status,
    map: parseJson(row.map_json, {}),
    startedAt: row.started_at,
    bossDefeatedAt: row.boss_defeated_at,
    finishedAt: row.finished_at,
  };
}

function rowToRoom(row) {
  const payload = parseJson(row.payload_json, {});
  return {
    ...payload,
    id: row.id,
    key: row.room_key,
    type: row.room_type,
    state: row.state,
    progress: row.progress,
    progressTarget: row.progress_target,
    clearedAt: row.cleared_at,
  };
}

function rowToMember(row) {
  return {
    expeditionId: row.expedition_id,
    userId: row.user_id,
    contributionAp: Math.max(0, Math.floor(Number(row.contribution_ap || 0))),
    contributionProgress: Math.max(0, Math.floor(Number(row.contribution_progress || 0))),
    loadout: normalizeLoadout(row.loadout_json),
  };
}

function rowToReward(row) {
  if (!row) return null;
  return {
    id: row.id,
    expeditionId: row.expedition_id,
    userId: row.user_id,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
  };
}

function readExpedition(db, expeditionId) {
  return rowToExpedition(db.prepare(`
    SELECT * FROM family_expeditions WHERE id = ?
  `).get(expeditionId));
}

function readRooms(db, expeditionId) {
  return db.prepare(`
    SELECT * FROM family_expedition_rooms WHERE expedition_id = ? ORDER BY id
  `).all(expeditionId).map(rowToRoom);
}

function readMembers(db, expeditionId) {
  return db.prepare(`
    SELECT * FROM family_expedition_members WHERE expedition_id = ? ORDER BY user_id
  `).all(expeditionId).map(rowToMember);
}

function readInventoryIds(db, userId) {
  return new Set(db.prepare(`
    SELECT artifact_id AS artifactId
    FROM expedition_artifact_inventory
    WHERE user_id = ? AND quantity > 0
  `).all(userId).map(row => row.artifactId));
}

function expeditionTitle(expedition) {
  return expedition?.map?.title
    || expedition?.map?.name
    || (expedition?.themeId === 'root_king' ? 'The Root King' : 'Family Expedition');
}

function doubledCoinRange(range = {}) {
  const min = Math.max(0, Math.floor(Number(range.min || 0)));
  const max = Math.max(min, Math.floor(Number(range.max ?? min)));
  return { min: min * 2, max: max * 2 };
}

function clearedRewardRooms(rooms) {
  return rooms.filter(room => room.state === 'cleared' && room.type !== 'boss');
}

function rollRoomCoinPool(rooms, rng) {
  return clearedRewardRooms(rooms).reduce((total, room) => (
    total + rollCoins(doubledCoinRange(room.loot?.coins), rng)
  ), 0);
}

function roomArtifactRolls(rooms) {
  return clearedRewardRooms(rooms).reduce((total, room) => (
    total + Math.max(0, Math.floor(Number(room.loot?.artifactRolls || 0)))
  ), 0);
}

function contributionShare(total, contributionAp, totalContributionAp) {
  if (total <= 0 || contributionAp <= 0 || totalContributionAp <= 0) return 0;
  return Math.floor((total * contributionAp) / totalContributionAp);
}

function duplicateSubstitutionCoins(artifactId) {
  const rarity = ARTIFACTS[artifactId]?.rarity;
  return (DUPLICATE_SUBSTITUTION_COINS[rarity] || 0) * 2;
}

function rollArtifactPayloads({ db, userId, loadout = [], artifactRolls, rng }) {
  const inventoryIds = readInventoryIds(db, userId);
  const seen = new Set([
    ...inventoryIds,
    ...loadout.map(slot => slot?.artifactId).filter(Boolean),
  ]);
  const rolled = rollPersonalLoot({
    coinRange: { min: 0, max: 0 },
    artifactRolls,
    table: LOOT_TABLES.boss,
    rng,
  });
  const artifacts = [];
  let substitutionCoins = 0;

  for (const artifactId of rolled.artifacts) {
    if (seen.has(artifactId)) {
      const coins = duplicateSubstitutionCoins(artifactId);
      substitutionCoins += coins;
      artifacts.push({ artifactId, duplicate: true, coins });
    } else {
      seen.add(artifactId);
      artifacts.push({ artifactId });
    }
  }

  return { artifacts, substitutionCoins };
}

function buildRewardPayload({
  db,
  expedition,
  member,
  roomCoinPool,
  totalContributionAp,
  artifactRolls,
  finalCoinBase,
  rng,
}) {
  const baseRoomCoins = contributionShare(roomCoinPool, member.contributionAp, totalContributionAp);
  const passiveRoomReward = applyPassiveArtifactEffects({
    phase: 'room_reward',
    loadout: member.loadout,
    coins: baseRoomCoins,
  });
  const roomCoins = Math.max(0, Math.floor(Number(passiveRoomReward.coins || 0)));
  const artifactPayload = rollArtifactPayloads({
    db,
    userId: member.userId,
    loadout: member.loadout,
    artifactRolls,
    rng,
  });
  const contributionCoins = member.contributionAp * CONTRIBUTION_COIN_STEP;
  const finalCoins = finalCoinBase + contributionCoins + artifactPayload.substitutionCoins;
  const totalCoins = roomCoins + finalCoins;

  return {
    contributionAp: member.contributionAp,
    roomCoins,
    finalCoins,
    totalCoins,
    artifacts: artifactPayload.artifacts,
    expeditionTitle: expeditionTitle(expedition),
    completedAt: expedition.finishedAt,
  };
}

function enforceContributionCoinFloor(candidates) {
  const ordered = [...candidates].sort((left, right) => (
    left.member.contributionAp - right.member.contributionAp
      || left.member.userId - right.member.userId
  ));
  let lowerContributionFloor = 0;

  for (let index = 0; index < ordered.length;) {
    const contributionAp = ordered[index].member.contributionAp;
    const group = [];
    while (index < ordered.length && ordered[index].member.contributionAp === contributionAp) {
      group.push(ordered[index]);
      index += 1;
    }
    for (const candidate of group) {
      if (!candidate.payload || candidate.payload.totalCoins >= lowerContributionFloor) continue;
      const adjustment = lowerContributionFloor - candidate.payload.totalCoins;
      candidate.payload.finalCoins += adjustment;
      candidate.payload.totalCoins += adjustment;
    }
    lowerContributionFloor = Math.max(
      lowerContributionFloor,
      ...group.map(candidate => candidate.payload?.totalCoins || 0),
    );
  }
}

function rewardByExpeditionUser(db, expeditionId, userId) {
  return rowToReward(db.prepare(`
    SELECT * FROM family_expedition_pending_rewards
    WHERE expedition_id = ? AND user_id = ?
  `).get(expeditionId, userId));
}

function createPendingRewards(db, {
  expeditionId,
  now = Date.now(),
  completedAt,
  rng = () => 0,
} = {}) {
  assertTransaction(db);
  if (!tableExists(db, 'family_expedition_pending_rewards')) return [];
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
  const currentTime = unixSeconds(now);
  const expedition = readExpedition(db, expeditionId);
  if (!expedition) throw new RangeError('Expedition not found');
  const payloadCompletedAt = completedAt == null
    ? expedition.finishedAt || expedition.bossDefeatedAt || currentTime
    : unixSeconds(completedAt);
  const rewardExpedition = { ...expedition, finishedAt: payloadCompletedAt };
  const rooms = readRooms(db, expeditionId);
  const eligibleMembers = readMembers(db, expeditionId)
    .filter(member => member.contributionAp > 0);
  if (eligibleMembers.length === 0) return [];

  const totalContributionAp = eligibleMembers
    .reduce((total, member) => total + member.contributionAp, 0);
  const roomCoinPool = rollRoomCoinPool(rooms, rng);
  const finalCoinBase = rollCoins(FINAL_COIN_RANGE, rng);
  const artifactRollCount = roomArtifactRolls(rooms);
  const candidates = eligibleMembers.map(member => {
    const existing = rewardByExpeditionUser(db, expeditionId, member.userId);
    return {
      member,
      existing,
      payload: existing?.payload || buildRewardPayload({
        db,
        expedition: rewardExpedition,
        member,
        roomCoinPool,
        totalContributionAp,
        artifactRolls: artifactRollCount,
        finalCoinBase,
        rng,
      }),
    };
  });
  enforceContributionCoinFloor(candidates);

  const rewards = [];
  for (const { member, existing, payload } of candidates) {
    if (existing) {
      rewards.push(existing);
      continue;
    }
    db.prepare(`
      INSERT INTO family_expedition_pending_rewards (
        expedition_id, user_id, payload_json, created_at
      ) VALUES (?, ?, ?, ?)
    `).run(expeditionId, member.userId, stringifyJson(payload), currentTime);
    rewards.push(rewardByExpeditionUser(db, expeditionId, member.userId));
  }

  return rewards;
}

function listPendingRewards(db, { userId } = {}) {
  assertDb(db);
  if (!tableExists(db, 'family_expedition_pending_rewards')) return [];
  return db.prepare(`
    SELECT * FROM family_expedition_pending_rewards
    WHERE user_id = ? AND claimed_at IS NULL
    ORDER BY created_at DESC, id DESC
  `).all(userId).map(rowToReward);
}

function pendingRewardCount(db, userId) {
  if (!tableExists(db, 'family_expedition_pending_rewards')) return 0;
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM family_expedition_pending_rewards
    WHERE user_id = ? AND claimed_at IS NULL
  `).get(userId).count;
}

function grantPayload(db, userId, payload, now) {
  const totalCoins = Math.max(0, Math.floor(Number(payload.totalCoins || 0)));
  if (totalCoins > 0) {
    db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(totalCoins, userId);
  }
  for (const artifact of payload.artifacts || []) {
    if (!artifact?.artifactId || artifact.duplicate) continue;
    grantArtifact({
      transaction: db,
      userId,
      artifactId: artifact.artifactId,
      now,
    });
  }
}

function claimPendingReward(db, {
  rewardId,
  userId,
  now = Date.now(),
} = {}) {
  assertTransaction(db);
  if (!tableExists(db, 'family_expedition_pending_rewards')) {
    throw new RangeError('Reward not found');
  }
  const currentTime = unixSeconds(now);
  const rewardRow = db.prepare(`
    SELECT * FROM family_expedition_pending_rewards
    WHERE id = ? AND user_id = ?
  `).get(rewardId, userId);
  const reward = rowToReward(rewardRow);
  if (!reward) throw new RangeError('Reward not found');

  if (!reward.claimedAt) {
    const payload = parseClaimableRewardPayload(rewardRow.payload_json);
    grantPayload(db, userId, payload, currentTime);
    db.prepare(`
      UPDATE family_expedition_pending_rewards
      SET claimed_at = ?
      WHERE id = ? AND user_id = ? AND claimed_at IS NULL
    `).run(currentTime, rewardId, userId);
  }

  return {
    reward: rowToReward(db.prepare(`
      SELECT * FROM family_expedition_pending_rewards
      WHERE id = ? AND user_id = ?
    `).get(rewardId, userId)),
    pendingCount: pendingRewardCount(db, userId),
  };
}

function backfillLegacyRewards(db, {
  now = Date.now(),
  rng = () => 0,
} = {}) {
  assertTransaction(db);
  if (!tableExists(db, 'family_expedition_pending_rewards')) return [];
  const expeditions = db.prepare(`
    SELECT id FROM family_expeditions
    WHERE status = 'finished'
    ORDER BY finished_at ASC, id ASC
  `).all();
  return expeditions.flatMap(row => createPendingRewards(db, {
    expeditionId: row.id,
    now,
    rng,
  }));
}

module.exports = {
  createPendingRewards,
  claimPendingReward,
  listPendingRewards,
  backfillLegacyRewards,
};
