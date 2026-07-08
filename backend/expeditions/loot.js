'use strict';

const { ARTIFACTS, RARITY_WEIGHTS } = require('./catalog');

const LOOT_TABLES = Object.freeze({
  base: RARITY_WEIGHTS,
  elite: Object.freeze({ common: 45, rare: 35, epic: 15, legendary: 5 }),
  boss: Object.freeze({ common: 20, rare: 35, epic: 30, legendary: 15 }),
});

function assertRng(rng) {
  if (typeof rng !== 'function') throw new TypeError('rng must be a function');
}

function rollArtifactRarity(rng, table = LOOT_TABLES.base) {
  assertRng(rng);
  const value = rng() * 100;
  if (value < table.legendary) return 'legendary';
  if (value < table.legendary + table.epic) return 'epic';
  if (value < table.legendary + table.epic + table.rare) return 'rare';
  return 'common';
}

function artifactsForRarity(rarity) {
  return Object.values(ARTIFACTS).filter(artifact => artifact.rarity === rarity);
}

function selectArtifactByRarity(rarity, rng) {
  assertRng(rng);
  const candidates = artifactsForRarity(rarity);
  if (candidates.length === 0) throw new RangeError(`No artifacts configured for rarity: ${rarity}`);
  return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))].id;
}

function rollCoins(range, rng) {
  assertRng(rng);
  if (!range || !Number.isInteger(range.min) || !Number.isInteger(range.max) || range.max < range.min) {
    throw new TypeError('coin range must contain integer min and max values');
  }
  return range.min + Math.min(range.max - range.min, Math.floor(rng() * (range.max - range.min + 1)));
}

function rollPersonalLoot({
  coinRange = { min: 0, max: 0 },
  artifactRolls = 0,
  table = LOOT_TABLES.base,
  rng,
}) {
  assertRng(rng);
  const coins = rollCoins(coinRange, rng);
  const artifacts = [];
  for (let index = 0; index < artifactRolls; index += 1) {
    artifacts.push(selectArtifactByRarity(rollArtifactRarity(rng, table), rng));
  }
  return { coins, artifacts };
}

function resolveArtifactGrant({ artifactId, inventory = [], rng = () => 0 }) {
  const artifact = ARTIFACTS[artifactId];
  if (!artifact) throw new RangeError(`Unknown artifact: ${artifactId}`);
  assertRng(rng);

  return {
    kind: 'artifact',
    artifactId: artifact.id,
    rarity: artifact.rarity,
    addedQuantity: 1,
    addedCharges: 0,
  };
}

function readInventory(db, userId) {
  return db.prepare(`
    SELECT artifact_id AS artifactId, quantity, charges
    FROM expedition_artifact_inventory
    WHERE user_id = ?
  `).all(userId);
}

function grantArtifact({ transaction, userId, artifactId, rng = () => 0, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!transaction || typeof transaction.prepare !== 'function' || transaction.inTransaction !== true) {
    throw new TypeError('grantArtifact requires an active caller transaction');
  }
  const grant = resolveArtifactGrant({
    artifactId,
    inventory: readInventory(transaction, userId),
    rng,
  });
  if (grant.kind === 'coins') return grant;

  transaction.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, artifact_id) DO UPDATE SET
      quantity = quantity + excluded.quantity,
      charges = charges + excluded.charges,
      last_acquired_at = excluded.last_acquired_at
  `).run(
    userId,
    grant.artifactId,
    grant.addedQuantity,
    grant.addedCharges,
    now,
    now,
  );
  return grant;
}

module.exports = {
  LOOT_TABLES,
  artifactsForRarity,
  grantArtifact,
  resolveArtifactGrant,
  rollArtifactRarity,
  rollCoins,
  rollPersonalLoot,
  selectArtifactByRarity,
};
