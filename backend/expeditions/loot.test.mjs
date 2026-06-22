import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { ARTIFACTS } = require('./catalog.js');

function loadLoot() {
  return require('./loot.js');
}

function inventoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE expedition_artifact_inventory (
      user_id INTEGER NOT NULL,
      artifact_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      charges INTEGER NOT NULL DEFAULT 0,
      first_acquired_at INTEGER NOT NULL,
      last_acquired_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, artifact_id)
    )
  `);
  return db;
}

test('base rarity uses exact 65/25/8/2 boundaries', () => {
  const { rollArtifactRarity } = loadLoot();
  const cases = [
    [0, 'legendary'],
    [0.019999, 'legendary'],
    [0.02, 'epic'],
    [0.099999, 'epic'],
    [0.10, 'rare'],
    [0.349999, 'rare'],
    [0.35, 'common'],
    [0.999999, 'common'],
  ];
  for (const [value, rarity] of cases) {
    assert.equal(rollArtifactRarity(() => value), rarity, String(value));
  }
});

test('elite and boss rarity tables are normalized improvements over base', () => {
  const { LOOT_TABLES } = loadLoot();
  for (const table of Object.values(LOOT_TABLES)) {
    assert.equal(Object.values(table).reduce((sum, value) => sum + value, 0), 100);
  }
  assert.ok(LOOT_TABLES.elite.epic > LOOT_TABLES.base.epic);
  assert.ok(LOOT_TABLES.boss.legendary > LOOT_TABLES.elite.legendary);
  assert.ok(LOOT_TABLES.elite.common < LOOT_TABLES.base.common);
});

test('coin and personal artifact rewards use only the injected RNG', () => {
  const { rollCoins, rollPersonalLoot } = loadLoot();
  assert.equal(rollCoins({ min: 3, max: 7 }, () => 0), 3);
  assert.equal(rollCoins({ min: 3, max: 7 }, () => 0.999999), 7);
  const values = [0, 0.999999, 0.999999];
  const reward = rollPersonalLoot({
    coinRange: { min: 5, max: 10 },
    artifactRolls: 1,
    rng: () => values.shift(),
  });
  assert.equal(reward.coins, 5);
  assert.equal(reward.artifacts.length, 1);
  assert.equal(ARTIFACTS[reward.artifacts[0]].rarity, 'common');
});

test('permanent duplicate rerolls among missing same-rarity artifacts', () => {
  const { resolveArtifactGrant } = loadLoot();
  const inventory = [{ artifactId: 'old_torch', quantity: 1, charges: 0 }];
  const result = resolveArtifactGrant({
    artifactId: 'old_torch',
    inventory,
    rng: () => 0,
  });
  assert.notEqual(result.artifactId, 'old_torch');
  assert.equal(ARTIFACTS[result.artifactId].rarity, 'common');
  assert.equal(result.kind, 'artifact');
});

test('permanent duplicate becomes rarity-scaled coins when rarity is complete', () => {
  const { resolveArtifactGrant, DUPLICATE_COIN_SUBSTITUTE } = loadLoot();
  const inventory = Object.values(ARTIFACTS)
    .filter(item => item.rarity === 'legendary')
    .map(item => ({ artifactId: item.id, quantity: 1, charges: 0 }));
  const result = resolveArtifactGrant({ artifactId: 'endless_candle', inventory, rng: () => 0 });
  assert.deepEqual(result, {
    kind: 'coins',
    coins: DUPLICATE_COIN_SUBSTITUTE.legendary,
    duplicateArtifactId: 'endless_candle',
    rarity: 'legendary',
  });
});

test('permanent duplicate reroll includes missing charged and consumable items', () => {
  const { resolveArtifactGrant } = loadLoot();
  const common = Object.values(ARTIFACTS).filter(item => item.rarity === 'common');
  const missingId = 'chalk_rune';
  const inventory = common
    .filter(item => item.id !== missingId)
    .map(item => ({ artifactId: item.id, quantity: 1, charges: 1 }));
  const result = resolveArtifactGrant({ artifactId: 'old_torch', inventory, rng: () => 0 });
  assert.equal(result.artifactId, missingId);
  assert.equal(result.addedQuantity, 1);
});

test('charged and consumable duplicates stack with catalog semantics', () => {
  const { resolveArtifactGrant } = loadLoot();
  const charged = resolveArtifactGrant({ artifactId: 'rusty_lockpick', inventory: [] });
  assert.equal(charged.addedCharges, ARTIFACTS.rusty_lockpick.behavior.initialCharges);
  assert.equal(charged.addedQuantity, 0);

  const consumable = resolveArtifactGrant({ artifactId: 'chalk_rune', inventory: [] });
  assert.equal(consumable.addedQuantity, 1);
  assert.equal(consumable.addedCharges, 0);

  const permanent = resolveArtifactGrant({ artifactId: 'old_torch', inventory: [] });
  assert.equal(permanent.addedQuantity, 1);

  const cursed = resolveArtifactGrant({ artifactId: 'hungry_satchel', inventory: [] });
  assert.equal(cursed.addedQuantity, 1);
});

test('database grant accepts a caller transaction and does not import the real database', () => {
  const { grantArtifact } = loadLoot();
  const db = inventoryDb();
  const grantInTransaction = db.transaction(() => {
    grantArtifact({ db, userId: 7, artifactId: 'rusty_lockpick', now: 100 });
    grantArtifact({ db, userId: 7, artifactId: 'rusty_lockpick', now: 200 });
  });
  grantInTransaction();

  const row = db.prepare('SELECT * FROM expedition_artifact_inventory WHERE user_id = 7').get();
  assert.equal(row.artifact_id, 'rusty_lockpick');
  assert.equal(row.quantity, 0);
  assert.equal(row.charges, 6);
  assert.equal(row.first_acquired_at, 100);
  assert.equal(row.last_acquired_at, 200);
  db.close();
});

test('grant rolls back with the caller transaction', () => {
  const { grantArtifact } = loadLoot();
  const db = inventoryDb();
  const transaction = db.transaction(() => {
    grantArtifact({ db, userId: 8, artifactId: 'chalk_rune', now: 100 });
    throw new Error('rollback');
  });
  assert.throws(transaction, /rollback/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expedition_artifact_inventory').get().count, 0);
  db.close();
});
