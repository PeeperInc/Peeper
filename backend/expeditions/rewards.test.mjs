import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const {
  createPendingRewards,
  claimPendingReward,
  listPendingRewards,
  backfillLegacyRewards,
} = require('./rewards.js');

function rewardDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE family_expeditions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL,
      theme_id TEXT NOT NULL,
      seed TEXT NOT NULL,
      status TEXT NOT NULL,
      map_json TEXT NOT NULL DEFAULT '{}',
      shared_buffs_json TEXT NOT NULL DEFAULT '{}',
      started_by INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      boss_defeated_at INTEGER,
      finished_at INTEGER
    );

    CREATE TABLE family_expedition_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expedition_id INTEGER NOT NULL,
      room_key TEXT NOT NULL,
      room_type TEXT NOT NULL,
      state TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      progress_target INTEGER NOT NULL DEFAULT 0,
      support INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      unlocked_at INTEGER,
      cleared_at INTEGER,
      UNIQUE(expedition_id, room_key)
    );

    CREATE TABLE family_expedition_members (
      expedition_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'scout',
      ap INTEGER NOT NULL DEFAULT 5,
      ap_regen_day INTEGER NOT NULL DEFAULT 0,
      ap_regen_at INTEGER NOT NULL DEFAULT 0,
      hero_hp INTEGER NOT NULL DEFAULT 3,
      hero_recover_at INTEGER,
      role_ability_day INTEGER NOT NULL DEFAULT 0,
      role_ability_used INTEGER NOT NULL DEFAULT 0,
      role_charge INTEGER NOT NULL DEFAULT 1,
      role_charge_progress INTEGER NOT NULL DEFAULT 0,
      provision_id TEXT,
      provision_state_json TEXT NOT NULL DEFAULT '{}',
      loadout_json TEXT NOT NULL DEFAULT '[]',
      debuff_json TEXT NOT NULL DEFAULT '{}',
      contribution_ap INTEGER NOT NULL DEFAULT 0,
      contribution_progress INTEGER NOT NULL DEFAULT 0,
      room_coins_earned INTEGER NOT NULL DEFAULT 0,
      prepared_at INTEGER NOT NULL DEFAULT 0,
      boss_reward_claimed_at INTEGER,
      PRIMARY KEY(expedition_id, user_id)
    );

    CREATE TABLE expedition_artifact_inventory (
      user_id INTEGER NOT NULL,
      artifact_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      charges INTEGER NOT NULL DEFAULT 0,
      first_acquired_at INTEGER NOT NULL,
      last_acquired_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, artifact_id)
    );

    CREATE TABLE family_expedition_pending_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expedition_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      claimed_at INTEGER,
      UNIQUE(expedition_id, user_id)
    );
  `);
  return db;
}

function addUser(db, userId, coins = 0) {
  db.prepare('INSERT INTO users (id, coins) VALUES (?, ?)').run(userId, coins);
}

function createFinishedExpedition(db, {
  familyId = 1,
  title = 'The Root King',
  finishedAt = 10_000,
  rooms = [
    { key: 'camp_0', type: 'camp', state: 'cleared', loot: { coins: { min: 2, max: 2 }, artifactRolls: 0 } },
    { key: 'vault_1', type: 'treasure', state: 'cleared', loot: { coins: { min: 10, max: 10 }, artifactRolls: 1 } },
    { key: 'boss_1', type: 'boss', state: 'cleared', loot: { coins: { min: 0, max: 0 }, artifactRolls: 0 } },
  ],
  members = [],
} = {}) {
  const expeditionId = Number(db.prepare(`
    INSERT INTO family_expeditions (
      family_id, theme_id, seed, status, map_json, started_by, started_at, boss_defeated_at, finished_at
    ) VALUES (?, 'root_king', ?, 'finished', ?, 1, ?, ?, ?)
  `).run(
    familyId,
    `expedition-${familyId}-${finishedAt}`,
    JSON.stringify({ title, rooms: rooms.map(room => ({ key: room.key, name: room.name || room.key })) }),
    finishedAt - 1_000,
    finishedAt - 10,
    finishedAt,
  ).lastInsertRowid);

  for (const room of rooms) {
    db.prepare(`
      INSERT INTO family_expedition_rooms (
        expedition_id, room_key, room_type, state, progress, progress_target, payload_json, cleared_at
      ) VALUES (?, ?, ?, ?, 1, 1, ?, ?)
    `).run(
      expeditionId,
      room.key,
      room.type,
      room.state,
      JSON.stringify({
        key: room.key,
        name: room.name || room.key,
        type: room.type,
        loot: room.loot,
      }),
      room.state === 'cleared' ? finishedAt - 100 : null,
    );
  }

  for (const member of members) {
    db.prepare(`
      INSERT INTO family_expedition_members (
        expedition_id, user_id, contribution_ap, contribution_progress, loadout_json, prepared_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      expeditionId,
      member.userId,
      member.contributionAp ?? 0,
      member.contributionProgress ?? 0,
      JSON.stringify({ slots: member.loadout || [], triggerHistory: [] }),
      finishedAt - 900,
    );
  }

  return expeditionId;
}

function inTx(db, fn) {
  return db.transaction(fn)();
}

test('zero contribution creates no pending reward and exports only the public helpers', () => {
  assert.deepEqual(Object.keys(require('./rewards.js')).sort(), [
    'backfillLegacyRewards',
    'claimPendingReward',
    'createPendingRewards',
    'listPendingRewards',
  ]);
  const db = rewardDb();
  addUser(db, 10);
  const expeditionId = createFinishedExpedition(db, {
    members: [{ userId: 10, contributionAp: 0 }],
  });

  const created = inTx(db, () => createPendingRewards(db, { expeditionId, now: 11_000, rng: () => 0 }));

  assert.deepEqual(created, []);
  assert.deepEqual(listPendingRewards(db, { userId: 10 }), []);
  db.close();
});

test('higher contribution never yields fewer coins under identical expedition inputs', () => {
  const db = rewardDb();
  addUser(db, 10);
  addUser(db, 11);
  const expeditionId = createFinishedExpedition(db, {
    members: [
      { userId: 10, contributionAp: 1 },
      { userId: 11, contributionAp: 4 },
    ],
  });

  const created = inTx(db, () => createPendingRewards(db, { expeditionId, now: 11_000, rng: () => 0 }));
  const low = created.find(reward => reward.userId === 10).payload;
  const high = created.find(reward => reward.userId === 11).payload;

  assert.equal(low.contributionAp, 1);
  assert.equal(high.contributionAp, 4);
  assert.ok(high.roomCoins >= low.roomCoins);
  assert.ok(high.finalCoins >= low.finalCoins);
  assert.ok(high.totalCoins >= low.totalCoins);
  assert.equal(high.expeditionTitle, 'The Root King');
  assert.equal(high.completedAt, 10_000);
  db.close();
});

test('duplicate substitutions do not let lower contribution earn more total coins', () => {
  const db = rewardDb();
  addUser(db, 10);
  addUser(db, 11);
  const expeditionId = createFinishedExpedition(db, {
    rooms: [
      { key: 'vault_1', type: 'treasure', state: 'cleared', loot: { coins: { min: 0, max: 0 }, artifactRolls: 1 } },
    ],
    members: [
      { userId: 10, contributionAp: 1, loadout: [{ artifactId: 'old_torch' }] },
      { userId: 11, contributionAp: 2 },
    ],
  });
  const rolls = [
    0, // room coins
    0, // final coin base
    0, 0.99, 0, // low contributor duplicate old_torch
    0, 0.99, 0, // high contributor non-duplicate old_torch
  ];

  const created = inTx(db, () => createPendingRewards(db, {
    expeditionId,
    now: 11_000,
    rng: () => rolls.shift() ?? 0,
  }));
  const low = created.find(reward => reward.userId === 10).payload;
  const high = created.find(reward => reward.userId === 11).payload;

  assert.deepEqual(low.artifacts, [{
    artifactId: 'old_torch',
    duplicate: true,
    coins: 10,
  }]);
  assert.deepEqual(high.artifacts, [{ artifactId: 'old_torch' }]);
  assert.equal(low.contributionAp, 1);
  assert.equal(high.contributionAp, 2);
  assert.ok(
    high.totalCoins >= low.totalCoins,
    `expected high contribution totalCoins ${high.totalCoins} >= low contribution totalCoins ${low.totalCoins}`,
  );
  db.close();
});

test('pending payload generation is immutable and idempotent', () => {
  const db = rewardDb();
  addUser(db, 10);
  const expeditionId = createFinishedExpedition(db, {
    members: [{ userId: 10, contributionAp: 3, loadout: [{ artifactId: 'mimic_tooth' }] }],
  });

  const first = inTx(db, () => createPendingRewards(db, { expeditionId, now: 11_000, rng: () => 0 }));
  const firstPayload = first[0].payload;
  const second = inTx(db, () => createPendingRewards(db, { expeditionId, now: 12_000, rng: () => 0.99 }));
  const stored = listPendingRewards(db, { userId: 10 })[0];

  assert.deepEqual(second[0].payload, firstPayload);
  assert.deepEqual(stored.payload, firstPayload);
  assert.equal(stored.createdAt, 11_000);
  assert.equal(stored.payload.roomCoins, 36);
  assert.equal(stored.payload.totalCoins, stored.payload.roomCoins + stored.payload.finalCoins);
  db.close();
});

test('multiple expeditions accumulate pending rewards and backfill skips existing rows', () => {
  const db = rewardDb();
  addUser(db, 10);
  const firstId = createFinishedExpedition(db, {
    title: 'First Clear',
    finishedAt: 10_000,
    members: [{ userId: 10, contributionAp: 1 }],
  });
  const secondId = createFinishedExpedition(db, {
    title: 'Second Clear',
    finishedAt: 20_000,
    members: [{ userId: 10, contributionAp: 2 }],
  });
  inTx(db, () => createPendingRewards(db, { expeditionId: firstId, now: 11_000, rng: () => 0 }));

  const backfilled = inTx(db, () => backfillLegacyRewards(db, { now: 21_000, rng: () => 0 }));
  const pending = listPendingRewards(db, { userId: 10 });

  assert.equal(backfilled.some(reward => reward.expeditionId === secondId), true);
  assert.equal(pending.length, 2);
  assert.deepEqual(pending.map(reward => reward.payload.expeditionTitle), ['Second Clear', 'First Clear']);
  db.close();
});

test('claiming is idempotent, user scoped, and grants the immutable payload once', () => {
  const db = rewardDb();
  addUser(db, 10, 100);
  addUser(db, 11, 100);
  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES (10, 'old_torch', 1, 0, 1, 1)
  `).run();
  const expeditionId = createFinishedExpedition(db, {
    members: [{ userId: 10, contributionAp: 3 }],
  });
  const [reward] = inTx(db, () => createPendingRewards(db, { expeditionId, now: 11_000, rng: () => 0 }));
  const beforeClaimPayload = reward.payload;

  assert.throws(() => inTx(db, () => claimPendingReward(db, {
    rewardId: reward.id,
    userId: 11,
    now: 12_000,
  })), /not found/i);

  const claimed = inTx(db, () => claimPendingReward(db, {
    rewardId: reward.id,
    userId: 10,
    now: 12_000,
  }));
  const replay = inTx(db, () => claimPendingReward(db, {
    rewardId: reward.id,
    userId: 10,
    now: 13_000,
  }));

  assert.equal(claimed.pendingCount, 0);
  assert.equal(replay.pendingCount, 0);
  assert.deepEqual(claimed.reward.payload, beforeClaimPayload);
  assert.deepEqual(replay.reward.payload, beforeClaimPayload);
  assert.equal(claimed.reward.claimedAt, 12_000);
  assert.equal(replay.reward.claimedAt, 12_000);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 10').pluck().get(), 100 + beforeClaimPayload.totalCoins);
  assert.equal(db.prepare(`
    SELECT quantity FROM expedition_artifact_inventory
    WHERE user_id = 10 AND artifact_id = ?
  `).pluck().get(beforeClaimPayload.artifacts[0].artifactId), 1);
  db.close();
});

test('malformed pending reward payload cannot be claimed or hidden', () => {
  const db = rewardDb();
  addUser(db, 10, 100);
  const expeditionId = createFinishedExpedition(db, {
    members: [{ userId: 10, contributionAp: 3 }],
  });
  const rewardId = Number(db.prepare(`
    INSERT INTO family_expedition_pending_rewards (
      expedition_id, user_id, payload_json, created_at
    ) VALUES (?, 10, ?, 11000)
  `).run(expeditionId, '{broken-json').lastInsertRowid);

  assert.throws(() => inTx(db, () => claimPendingReward(db, {
    rewardId,
    userId: 10,
    now: 12_000,
  })), /invalid reward payload/i);

  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 10').pluck().get(), 100);
  assert.equal(db.prepare(`
    SELECT claimed_at FROM family_expedition_pending_rewards WHERE id = ?
  `).pluck().get(rewardId), null);
  assert.equal(listPendingRewards(db, { userId: 10 }).length, 1);
  db.close();
});

test('duplicate artifact substitutions are doubled, awarded, and included in final totals', () => {
  const db = rewardDb();
  addUser(db, 10, 0);
  const expeditionId = createFinishedExpedition(db, {
    rooms: [
      { key: 'vault_1', type: 'treasure', state: 'cleared', loot: { coins: { min: 0, max: 0 }, artifactRolls: 1 } },
    ],
    members: [{ userId: 10, contributionAp: 3, loadout: [{ artifactId: 'old_torch' }] }],
  });
  const rolls = [0, 0, 0, 0.99, 0];
  const [reward] = inTx(db, () => createPendingRewards(db, {
    expeditionId,
    now: 11_000,
    rng: () => rolls.shift() ?? 0,
  }));

  assert.deepEqual(reward.payload.artifacts, [{
    artifactId: 'old_torch',
    duplicate: true,
    coins: 10,
  }]);
  assert.equal(reward.payload.finalCoins, 40);
  assert.equal(reward.payload.totalCoins, reward.payload.roomCoins + reward.payload.finalCoins);
  const claimed = inTx(db, () => claimPendingReward(db, {
    rewardId: reward.id,
    userId: 10,
    now: 12_000,
  }));
  assert.equal(claimed.pendingCount, 0);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 10').pluck().get(), reward.payload.totalCoins);
  db.close();
});

test('invalid artifact entries cannot be claimed or hidden', () => {
  const db = rewardDb();
  addUser(db, 10, 100);
  const expeditionId = createFinishedExpedition(db, {
    members: [{ userId: 10, contributionAp: 3 }],
  });
  const payload = {
    contributionAp: 3,
    roomCoins: 10,
    finalCoins: 20,
    totalCoins: 30,
    artifacts: [{ artifactId: 'unknown_artifact', duplicate: 'yes', coins: 999 }],
    expeditionTitle: 'Broken Vault',
    completedAt: 10_000,
  };
  const rewardId = Number(db.prepare(`
    INSERT INTO family_expedition_pending_rewards (
      expedition_id, user_id, payload_json, created_at
    ) VALUES (?, 10, ?, 11000)
  `).run(expeditionId, JSON.stringify(payload)).lastInsertRowid);

  assert.throws(() => inTx(db, () => claimPendingReward(db, {
    rewardId,
    userId: 10,
    now: 12_000,
  })), /invalid reward payload/i);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 10').pluck().get(), 100);
  assert.equal(db.prepare(`
    SELECT claimed_at FROM family_expedition_pending_rewards WHERE id = ?
  `).pluck().get(rewardId), null);
  db.close();
});
