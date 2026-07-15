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

test('all curated active and passive artifacts stack as whole copies', () => {
  const { resolveArtifactGrant } = loadLoot();
  for (const artifact of Object.values(ARTIFACTS)) {
    const result = resolveArtifactGrant({
      artifactId: artifact.id,
      inventory: [{ artifactId: artifact.id, quantity: 2, charges: 99 }],
    });
    assert.equal(result.kind, 'artifact', artifact.id);
    assert.equal(result.artifactId, artifact.id, artifact.id);
    assert.equal(result.addedQuantity, 1, artifact.id);
    assert.equal(result.addedCharges, 0, artifact.id);
  }
});

test('every rarity pool contains only curated catalog IDs', () => {
  const { artifactsForRarity } = loadLoot();
  const emitted = ['common', 'rare', 'epic', 'legendary']
    .flatMap(rarity => artifactsForRarity(rarity).map(artifact => artifact.id));
  assert.deepEqual(new Set(emitted), new Set(Object.keys(ARTIFACTS)));
  assert.equal(emitted.includes('endless_candle'), false);
});

test('artifact grant rejects absent and nontransactional write callers', () => {
  const { grantArtifact } = loadLoot();
  const db = inventoryDb();
  assert.throws(() => grantArtifact(), /active caller transaction/);
  assert.throws(
    () => grantArtifact({ userId: 7, artifactId: 'rusty_lockpick' }),
    /active caller transaction/,
  );
  assert.throws(
    () => grantArtifact({ transaction: db, userId: 7, artifactId: 'rusty_lockpick' }),
    /active caller transaction/,
  );
  assert.throws(
    () => grantArtifact({ db, userId: 7, artifactId: 'rusty_lockpick' }),
    /active caller transaction/,
  );
  db.close();
});

test('database grant accepts only an active caller transaction', () => {
  const { grantArtifact } = loadLoot();
  const db = inventoryDb();
  const grantInTransaction = db.transaction(() => {
    grantArtifact({ transaction: db, userId: 7, artifactId: 'rusty_lockpick', now: 100 });
    grantArtifact({ transaction: db, userId: 7, artifactId: 'rusty_lockpick', now: 200 });
  });
  grantInTransaction();

  const row = db.prepare('SELECT * FROM expedition_artifact_inventory WHERE user_id = 7').get();
  assert.equal(row.artifact_id, 'rusty_lockpick');
  assert.equal(row.quantity, 2);
  assert.equal(row.charges, 0);
  assert.equal(row.first_acquired_at, 100);
  assert.equal(row.last_acquired_at, 200);
  db.close();
});

test('grant rolls back with the caller transaction', () => {
  const { grantArtifact } = loadLoot();
  const db = inventoryDb();
  const transaction = db.transaction(() => {
    grantArtifact({ transaction: db, userId: 8, artifactId: 'chalk_rune', now: 100 });
    throw new Error('rollback');
  });
  assert.throws(transaction, /rollback/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expedition_artifact_inventory').get().count, 0);
  db.close();
});
