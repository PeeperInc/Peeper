import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peeper-expeditions-routes-'));
process.env.PEEPER_DB_PATH = path.join(tempDir, 'test.db');
process.env.NODE_ENV = 'development';
process.env.BOT_TOKEN = 'dev';

const express = require('express');
const db = require('../database.js');
const expeditionsRouter = require('../routes/expeditions.js');
const { serializeExpeditionState } = require('./serializer.js');

const app = express();
app.use(express.json());
app.use('/api/expeditions', expeditionsRouter);

const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/api/expeditions`;

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function auth(telegramId) {
  return {
    'content-type': 'application/json',
    'x-telegram-init-data': new URLSearchParams({
      user: JSON.stringify({ id: telegramId, first_name: `User ${telegramId}` }),
      auth_date: '1',
    }).toString(),
  };
}

async function request(method, url, telegramId = 'tg-owner', body = undefined) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: auth(telegramId),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

function resetDb() {
  db.exec(`
    DELETE FROM family_expedition_member_events;
    DELETE FROM family_expedition_pending_rewards;
    DELETE FROM family_expedition_history;
    DELETE FROM family_expedition_actions;
    DELETE FROM family_expedition_members;
    DELETE FROM family_expedition_rooms;
    DELETE FROM family_expeditions;
    DELETE FROM expedition_artifact_inventory;
    DELETE FROM farm_inventory;
    DELETE FROM family_members;
    DELETE FROM families;
    DELETE FROM users;
  `);
}

function createUser(telegramId, firstName = telegramId) {
  const info = db.prepare(`
    INSERT INTO users (telegram_id, first_name, username, coins)
    VALUES (?, ?, ?, 500)
  `).run(String(telegramId), firstName, `${firstName}_user`);
  return Number(info.lastInsertRowid);
}

function createFamilyWithMembers(memberTelegramIds = ['tg-owner']) {
  const userIds = memberTelegramIds.map((telegramId, index) => createUser(telegramId, `Member${index + 1}`));
  const familyId = Number(db.prepare(`
    INSERT INTO families (name, founder_id, invite_code)
    VALUES ('Expedition Family', ?, 'EXPED')
  `).run(userIds[0]).lastInsertRowid);
  for (const userId of userIds) {
    db.prepare('INSERT INTO family_members (family_id, user_id) VALUES (?, ?)').run(familyId, userId);
  }
  return { familyId, userIds };
}

test.beforeEach(() => {
  resetDb();
});

test('artifact use route applies once, replays idempotently, and rejects stale concurrent use', async () => {
  const { userIds } = createFamilyWithMembers();
  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES (?, 'tiny_shovel', 1, 0, 1, 1)
  `).run(userIds[0]);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'artifact-route-start' });
  const expeditionId = started.body.expedition.id;
  const prepared = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'artifact-route-prepare',
    role: 'scout',
    artifactIds: ['tiny_shovel'],
  });
  const room = prepared.body.map.rooms.find(candidate => (
    candidate.state === 'unlocked' && candidate.type !== 'boss'
  ));
  const url = `/${expeditionId}/rooms/${room.key}/artifacts/tiny_shovel/use`;
  const [first, replay] = await Promise.all([
    request('POST', url, 'tg-owner', { idempotencyKey: 'artifact-route-use' }),
    request('POST', url, 'tg-owner', { idempotencyKey: 'artifact-route-use' }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.deepEqual(first.body.visualEvents, replay.body.visualEvents);
  assert.equal(first.body.visualEvents[0].artifactId, 'tiny_shovel');
  const stale = await request('POST', url, 'tg-owner', { idempotencyKey: 'artifact-route-stale' });
  assert.equal(stale.status, 400);
  assert.match(stale.body.error, /not equipped/i);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM family_expedition_actions
    WHERE user_id = ? AND action_type = 'use_artifact'
  `).get(userIds[0]).count, 1);
});

test('legacy artifact migration is deterministic, merge-safe, and idempotent across restarts', () => {
  const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peeper-artifact-migration-'));
  const databasePath = path.join(migrationDir, 'migration.db');
  const initialize = () => execFileSync(process.execPath, ['-e', `
    const db = require('./backend/database.js');
    db.close();
  `], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, PEEPER_DB_PATH: databasePath },
  });
  try {
    initialize();
    const legacy = new Database(databasePath);
    legacy.prepare("INSERT INTO users (id, telegram_id) VALUES (7, 'migration-user')").run();
    legacy.prepare(`
      INSERT INTO expedition_artifact_inventory (
        user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
      ) VALUES
        (7, 'map_scrap', 2, 0, 10, 20),
        (7, 'candle_stub', 0, 0, 8, 18),
        (7, 'wooden_shield', 3, 0, 5, 30),
        (7, 'rusty_lockpick', 0, 4, 15, 25),
        (7, 'unsupported_old_item', 1, 0, 1, 1)
    `).run();
    legacy.prepare("DELETE FROM app_settings WHERE key = 'expedition_artifact_catalog_v2'").run();
    legacy.close();

    initialize();
    const migrated = new Database(databasePath);
    const first = migrated.prepare(`
      SELECT artifact_id AS artifactId, quantity, charges
      FROM expedition_artifact_inventory WHERE user_id = 7 ORDER BY artifact_id
    `).all();
    migrated.close();
    initialize();
    const reopened = new Database(databasePath);
    const second = reopened.prepare(`
      SELECT artifact_id AS artifactId, quantity, charges
      FROM expedition_artifact_inventory WHERE user_id = 7 ORDER BY artifact_id
    `).all();
    const migrationKey = reopened.prepare(`
      SELECT value FROM app_settings WHERE key = 'expedition_artifact_catalog_v2'
    `).pluck().get();
    reopened.close();
    assert.deepEqual(first, [
      { artifactId: 'rusty_lockpick', quantity: 1, charges: 0 },
      { artifactId: 'unsupported_old_item', quantity: 1, charges: 0 },
      { artifactId: 'wooden_shield', quantity: 5, charges: 0 },
    ]);
    assert.deepEqual(second, first);
    assert.equal(migrationKey, '1');
  } finally {
    fs.rmSync(migrationDir, { recursive: true, force: true });
  }
});

test('legacy artifact migration normalizes malformed copy counts and commits its marker atomically', () => {
  const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peeper-artifact-malformed-'));
  const databasePath = path.join(migrationDir, 'migration.db');
  const initialize = () => execFileSync(process.execPath, ['-e', `
    const db = require('./backend/database.js');
    db.close();
  `], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, PEEPER_DB_PATH: databasePath },
  });
  try {
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE expedition_artifact_inventory (
        user_id INTEGER NOT NULL,
        artifact_id TEXT NOT NULL,
        quantity,
        charges,
        first_acquired_at INTEGER,
        last_acquired_at INTEGER,
        PRIMARY KEY(user_id, artifact_id)
      );
      INSERT INTO expedition_artifact_inventory VALUES
        (71, 'map_scrap', 'not-a-number', 'broken', 1, 1),
        (72, 'clerics_bell', NULL, NULL, 1, 1),
        (73, 'blackroot_key', -9, -4, 1, 1),
        (74, 'eye_of_dungeon', '1e100', 0, 1, 1),
        (75, 'candle_stub', 0, 0, 1, 1);
    `);
    legacy.close();

    initialize();
    const migrated = new Database(databasePath);
    const first = migrated.prepare(`
      SELECT user_id AS userId, artifact_id AS artifactId, quantity, charges
      FROM expedition_artifact_inventory WHERE user_id BETWEEN 71 AND 75 ORDER BY user_id
    `).all();
    const marker = migrated.prepare(`
      SELECT value FROM app_settings WHERE key = 'expedition_artifact_catalog_v2'
    `).pluck().get();
    migrated.close();
    assert.deepEqual(first.map(row => ({ userId: row.userId, quantity: row.quantity, charges: row.charges })), [
      { userId: 71, quantity: 1, charges: 0 },
      { userId: 72, quantity: 1, charges: 0 },
      { userId: 73, quantity: 1, charges: 0 },
      { userId: 74, quantity: 1_000_000, charges: 0 },
    ]);
    assert.equal(first.some(row => row.userId === 75), false);
    assert.equal(first.every(row => typeof row.artifactId === 'string' && row.artifactId.length > 0), true);
    assert.equal(marker, '1');

    initialize();
    const reopened = new Database(databasePath);
    const second = reopened.prepare(`
      SELECT user_id AS userId, artifact_id AS artifactId, quantity, charges
      FROM expedition_artifact_inventory WHERE user_id BETWEEN 71 AND 75 ORDER BY user_id
    `).all();
    reopened.close();
    assert.deepEqual(second, first);
  } finally {
    fs.rmSync(migrationDir, { recursive: true, force: true });
  }
});

test('serializer returns stable camelCase state and redacts hidden/private fields', () => {
  const state = serializeExpeditionState({
    userId: 1,
    snapshot: {
      expedition: {
        id: 10,
        familyId: 20,
        themeId: 'root_king',
        seed: 'server-only-seed',
        status: 'active',
        startedBy: 1,
        startedAt: 100,
        map: {
          rooms: [
            { key: 'camp_0', type: 'camp', depth: 0 },
            { key: 'vault_1', type: 'treasure', depth: 1, loot: { coins: { min: 10, max: 20 } } },
          ],
          edges: [{ from: 'camp_0', to: 'vault_1' }],
        },
      },
      rooms: [
        {
          id: 1,
          key: 'camp_0',
          type: 'camp',
          state: 'unlocked',
          progress: 0,
          progressTarget: 1,
          support: 0,
          actions: [{ id: 'tend_campfire', stat: 'spirit', modifier: 0 }],
          loot: { coins: { min: 1, max: 2 } },
        },
        {
          id: 2,
          key: 'vault_1',
          type: 'treasure',
          state: 'hidden',
          progress: 0,
          progressTarget: 4,
          support: 0,
          name: 'Secret Vault',
          actions: [{ id: 'pick_vault', stat: 'agility', modifier: 2 }],
          loot: { artifactRolls: 1 },
          futureLoot: ['legendary'],
          rngSeed: 'reward-seed',
        },
      ],
      members: [
        { userId: 1, role: 'scout', ap: 2, loadout: [{ artifactId: 'bent_sword' }] },
        { userId: 2, role: 'mage', ap: 3, loadout: [{ artifactId: 'chalk_rune' }] },
      ],
      actions: [
        {
          id: 5,
          idempotencyKey: 'hidden-key',
          actionType: 'attempt',
          userId: 1,
          rawRoll: 20,
          loot: { artifactRolls: 1, rewardSeed: 'do-not-leak' },
          createdAt: 123,
        },
      ],
    },
    familyMembers: [
      { userId: 1, firstName: 'Owner', username: 'owner', telegramId: 'tg-owner' },
      { userId: 2, firstName: 'Other', username: 'other', telegram_id: 'tg-other' },
    ],
    artifactInventory: [
      { userId: 1, artifactId: 'bent_sword', quantity: 1, charges: 0 },
    ],
    pendingRewards: [
      {
        id: 90,
        expeditionId: 7,
        userId: 2,
        payload: { totalCoins: 999, rewardSeed: 'other-hidden' },
        createdAt: 444,
        claimedAt: null,
      },
      {
        id: 91,
        expeditionId: 8,
        userId: 1,
        payload: {
          contributionAp: 3,
          roomCoins: 24,
          finalCoins: 30,
          totalCoins: 54,
          artifacts: [{ artifactId: 'old_torch' }],
          expeditionTitle: 'The Root King',
          completedAt: 500,
          rewardSeed: 'pending-hidden',
        },
        createdAt: 555,
        claimedAt: null,
      },
    ],
  });

  assert.deepEqual(Object.keys(state), [
    'expedition',
    'map',
    'member',
    'familyMembers',
    'recentActions',
    'personalEvents',
    'artifactInventory',
    'pendingRewards',
    'pendingRewardCount',
    'currentMinigameAttempt',
    'catalog',
    'permissions',
  ]);
  assert.equal(state.currentMinigameAttempt, null);
  assert.equal(state.expedition.seed, undefined);
  assert.deepEqual(state.map.edges, [{ from: 'camp_0', to: 'vault_1' }]);
  assert.equal(state.map.rooms.find(room => room.key === 'camp_0').actions.length, 1);
  const hidden = state.map.rooms.find(room => room.key === 'vault_1');
  assert.deepEqual(hidden, {
    key: 'vault_1',
    type: 'treasure',
    state: 'hidden',
    progress: 0,
    progressTarget: 4,
    support: 0,
    depth: 1,
  });
  assert.equal(JSON.stringify(state).includes('telegram'), false);
  assert.equal(JSON.stringify(state).includes('reward-seed'), false);
  assert.equal(JSON.stringify(state).includes('futureLoot'), false);
  assert.equal(JSON.stringify(state).includes('hidden-key'), false);
  assert.deepEqual(state.artifactInventory, [
    { artifactId: 'bent_sword', quantity: 1, charges: 0 },
  ]);
  assert.equal(state.catalog.artifacts.length, 24);
  assert.deepEqual(
    state.catalog.artifacts.find(artifact => artifact.id === 'old_torch'),
    {
      id: 'old_torch',
      name: 'Old Torch',
      rarity: 'common',
      useType: 'expedition_passive',
      displayEffect: '+10% minigame limits and timing windows',
    },
  );
  assert.deepEqual(state.pendingRewards, [
    {
      id: 91,
      expeditionId: 8,
      payload: {
        contributionAp: 3,
        roomCoins: 24,
        finalCoins: 30,
        totalCoins: 54,
        artifacts: [{ artifactId: 'old_torch' }],
        expeditionTitle: 'The Root King',
        completedAt: 500,
      },
      createdAt: 555,
    },
  ]);
  assert.equal(state.pendingRewardCount, 1);
});

test('GET /current returns empty expedition state when the user has no family', async () => {
  createUser('tg-owner', 'Solo');

  const response = await request('GET', '/current');

  assert.equal(response.status, 200);
  assert.equal(response.body.expedition, null);
  assert.deepEqual(response.body.map, { rooms: [], edges: [] });
  assert.deepEqual(response.body.familyMembers, []);
  assert.equal(response.body.permissions.canStart, false);
});

test('GET /current returns AP regenerated while the player was offline', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-ap-regen' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-ap-regen',
    role: 'scout',
  });
  const oneWeekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  db.prepare(`
    UPDATE family_expedition_members
    SET ap = 0, ap_regen_at = ?
    WHERE expedition_id = ? AND user_id = ?
  `).run(oneWeekAgo, expeditionId, userIds[0]);

  const response = await request('GET', '/current', 'tg-owner');

  assert.equal(response.status, 200);
  assert.equal(response.body.member.ap, 5);
});

test('POST /start requires current family membership and enforces one unfinished expedition per family', async () => {
  createUser('tg-owner', 'Solo');
  assert.equal((await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-no-family' })).status, 403);

  resetDb();
  createFamilyWithMembers(['tg-owner', 'tg-sibling']);
  const first = await request('POST', '/start', 'tg-sibling', { idempotencyKey: 'start-one' });
  assert.equal(first.status, 200);
  assert.equal(first.body.expedition.status, 'active');
  assert.ok(first.body.expedition.id);

  const duplicateActive = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-two' });
  assert.equal(duplicateActive.status, 409);
  assert.equal(duplicateActive.body.error, 'Family already has an unfinished expedition');
});

test('mutations require idempotencyKey and prepare delegates role and artifact ownership validation to the engine', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-prepare' });
  const expeditionId = started.body.expedition.id;

  const missingKey = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', { role: 'scout' });
  assert.equal(missingKey.status, 400);
  assert.equal(missingKey.body.error, 'idempotencyKey is required');

  const invalidRole = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-invalid-role',
    role: 'dragon',
  });
  assert.equal(invalidRole.status, 400);
  assert.match(invalidRole.body.error, /Unknown role/);

  const unownedArtifact = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-unowned-artifact',
    role: 'scout',
    artifactIds: ['bent_sword'],
  });
  assert.equal(unownedArtifact.status, 400);
  assert.match(unownedArtifact.body.error, /not enough copies of artifact/);

  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES (?, 'bent_sword', 1, 0, 1000, 1000)
  `).run(userIds[0]);
  const prepared = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-owned-artifact',
    role: 'scout',
    artifactIds: ['bent_sword'],
  });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.member.role, 'scout');
  assert.equal(prepared.body.member.loadout[0].artifactId, 'bent_sword');
});

test('mutation routes reject non-string, blank, and oversized idempotency keys', async () => {
  createFamilyWithMembers(['tg-owner']);
  for (const idempotencyKey of [123, {}, '   ', 'x'.repeat(129)]) {
    const response = await request('POST', '/start', 'tg-owner', { idempotencyKey });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /idempotencyKey.*string|idempotencyKey.*128|idempotencyKey.*required/i);
  }
});

test('duplicate room attempt returns the same state without spending AP twice', async () => {
  createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-attempt' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-attempt',
    role: 'scout',
  });
  const camp = started.body.map.rooms.find(room => room.type === 'camp');
  const actionId = camp.actions[0].id;

  const first = await request('POST', `/${expeditionId}/rooms/${camp.key}/attempt`, 'tg-owner', {
    idempotencyKey: 'attempt-camp-once',
    actionId,
    roll: 20,
  });
  assert.equal(first.status, 200);
  const apAfterFirst = first.body.member.ap;

  const replay = await request('POST', `/${expeditionId}/rooms/${camp.key}/attempt`, 'tg-owner', {
    idempotencyKey: 'attempt-camp-once',
    actionId,
    roll: 20,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.member.ap, apAfterFirst);
  assert.equal(replay.body.recentActions.filter(action => action.actionType === 'attempt').length, 1);
});

test('POST room attempt ignores forced client rolls and uses server rolls for idempotent replay', async () => {
  createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-secure-roll' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-secure-roll',
    role: 'scout',
  });
  const camp = started.body.map.rooms.find(room => room.type === 'camp');
  const actionId = camp.actions[0].id;
  const originalRandomInt = crypto.randomInt;
  crypto.randomInt = () => 6;
  try {
    const first = await request('POST', `/${expeditionId}/rooms/${camp.key}/attempt`, 'tg-owner', {
      idempotencyKey: 'attempt-secure-roll',
      actionId,
      roll: 20,
      reroll: 20,
    });
    assert.equal(first.status, 200);
    const attempt = first.body.recentActions.find(action => action.actionType === 'attempt');
    assert.equal(attempt.rawRoll, 7);

    const replay = await request('POST', `/${expeditionId}/rooms/${camp.key}/attempt`, 'tg-owner', {
      idempotencyKey: 'attempt-secure-roll',
      actionId,
      roll: 20,
      reroll: 20,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.recentActions.filter(action => action.actionType === 'attempt').length, 1);
    assert.equal(replay.body.recentActions.find(action => action.actionType === 'attempt').rawRoll, 7);
  } finally {
    crypto.randomInt = originalRandomInt;
  }
});

test('POST prepare rejects changing an already prepared member while allowing exact idempotent replay', async () => {
  createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-reprepare' });
  const expeditionId = started.body.expedition.id;

  const first = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-reprepare-original',
    role: 'scout',
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.member.role, 'scout');

  const replay = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-reprepare-original',
    role: 'scout',
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.member.role, 'scout');

  const changed = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-reprepare-changed',
    role: 'mage',
  });
  assert.equal(changed.status, 409);
  assert.match(changed.body.error, /already prepared/i);
});

test('POST prepare consumes selected farm provision recipe', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-provision-route' });
  const expeditionId = started.body.expedition.id;
  db.prepare(`
    INSERT INTO farm_inventory (user_id, product_id, quantity, updated_at)
    VALUES (?, 'carrot', 20, 1000)
  `).run(userIds[0]);

  const prepared = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-route-provision',
    role: 'scout',
    provisionId: 'carrot_rations',
  });

  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.member.provisionId, 'carrot_rations');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM farm_inventory WHERE user_id = ? AND product_id = 'carrot'").get(userIds[0]).count, 0);

  const replay = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-route-provision',
    role: 'scout',
    provisionId: 'carrot_rations',
  });
  assert.equal(replay.status, 200);
});

test('prepared provisions are manually consumed once from the current room', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-manual-provision' });
  const expeditionId = started.body.expedition.id;
  db.prepare(`INSERT INTO farm_inventory (user_id, product_id, quantity, updated_at) VALUES (?, 'carrot', 20, 1000)`).run(userIds[0]);
  const prepared = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-manual-provision', role: 'scout', provisionId: 'carrot_rations',
  });
  const room = prepared.body.map.rooms.find(candidate => candidate.state === 'unlocked');
  db.prepare('UPDATE family_expedition_members SET ap = 4 WHERE expedition_id = ? AND user_id = ?').run(expeditionId, userIds[0]);

  const used = await request('POST', `/${expeditionId}/rooms/${room.key}/provision/use`, 'tg-owner', {
    idempotencyKey: 'use-manual-provision',
  });
  assert.equal(used.status, 200);
  assert.equal(used.body.member.ap, 5);
  assert.equal(used.body.member.provisionState.used, true);
  const repeated = await request('POST', `/${expeditionId}/rooms/${room.key}/provision/use`, 'tg-owner', {
    idempotencyKey: 'use-manual-provision-again',
  });
  assert.equal(repeated.status, 400);
  assert.match(repeated.body.error, /already used/i);
});

test('legacy room attempts cannot activate daily role powers and legacy reveal is gone', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-no-legacy-role' });
  const expeditionId = started.body.expedition.id;
  const prepared = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-no-legacy-role',
    role: 'scout',
  });
  const source = prepared.body.map.rooms.find(room => room.state === 'unlocked' && room.actions?.length);
  assert.ok(source);

  const attempted = await request(
    'POST',
    `/${expeditionId}/rooms/${source.key}/attempt`,
    'tg-owner',
    {
      idempotencyKey: 'attempt-no-legacy-role',
      actionId: source.actions[0].id,
      useRoleAbility: true,
    },
  );
  assert.equal(attempted.status, 200);
  assert.equal(attempted.body.member.roleAbilityUsed, false);
  assert.equal(
    attempted.body.visualEvents.some(event => ['room_revealed', 'role_reroll', 'shared_blessing_added'].includes(event.type)),
    false,
  );
  assert.equal(
    db.prepare(`
      SELECT role_ability_used FROM family_expedition_members
      WHERE expedition_id = ? AND user_id = ?
    `).pluck().get(expeditionId, userIds[0]),
    0,
  );
  assert.equal(attempted.body.member.roleCharge, 1);
  const storedIntent = JSON.parse(db.prepare(`
    SELECT modifier_json FROM family_expedition_actions
    WHERE idempotency_key = 'attempt-no-legacy-role'
  `).pluck().get()).intent;
  assert.equal(Object.hasOwn(storedIntent, 'useRoleAbility'), false);

  const reveal = await request(
    'POST',
    `/${expeditionId}/rooms/${source.key}/reveal`,
    'tg-owner',
    { idempotencyKey: 'legacy-reveal-gone', fromRoomKey: source.key },
  );
  assert.equal(reveal.status, 410);
  assert.match(reveal.body.error, /role-ability|update/i);
});

test('role ability endpoint queues stackable ally shields idempotently', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner', 'tg-sibling']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-role-effects' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-role-owner',
    role: 'knight',
  });
  const siblingPrepared = await request('POST', `/${expeditionId}/prepare`, 'tg-sibling', {
    idempotencyKey: 'prepare-role-sibling',
    role: 'knight',
  });
  const room = siblingPrepared.body.map.rooms.find(candidate => candidate.state === 'unlocked');

  const placed = await request(
    'POST',
    `/${expeditionId}/rooms/${room.key}/role-ability`,
    'tg-owner',
    { idempotencyKey: 'place-knight-shield' },
  );
  assert.equal(placed.status, 200);
  assert.equal(placed.body.member.roleCharge, 0);
  assert.equal(placed.body.visualEvents[0].type, 'knight_shield_placed');
  const effect = placed.body.expedition.sharedBuffs.teamAbilities.knight[0];
  assert.deepEqual(effect.placedBy, {
    userId: userIds[0],
    firstName: 'Member1',
    username: 'Member1_user',
  });

  const replay = await request(
    'POST',
    `/${expeditionId}/rooms/${room.key}/role-ability`,
    'tg-owner',
    { idempotencyKey: 'place-knight-shield' },
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.body.expedition.sharedBuffs.teamAbilities.knight.length, 1);

  const duplicate = await request(
    'POST',
    `/${expeditionId}/rooms/${room.key}/role-ability`,
    'tg-sibling',
    { idempotencyKey: 'duplicate-knight-shield' },
  );
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.expedition.sharedBuffs.teamAbilities.knight.length, 2);
  assert.equal(
    db.prepare(`
      SELECT role_charge FROM family_expedition_members
      WHERE expedition_id = ? AND user_id = ?
    `).pluck().get(expeditionId, userIds[1]),
    0,
  );
});

test('Cleric role ability exposes only a family-safe summary and each viewer own pending event', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner', 'tg-sibling']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-cleric-prayer' });
  const expeditionId = started.body.expedition.id;
  const prepared = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-cleric',
    role: 'cleric',
  });
  await request('POST', `/${expeditionId}/prepare`, 'tg-sibling', {
    idempotencyKey: 'prepare-wounded',
    role: 'mage',
  });
  db.prepare(`
    UPDATE family_expedition_members SET hero_hp = 2
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userIds[1]);
  const room = prepared.body.map.rooms.find(candidate => candidate.state === 'unlocked');

  const response = await request(
    'POST',
    `/${expeditionId}/rooms/${room.key}/role-ability`,
    'tg-owner',
    { idempotencyKey: 'cleric-prayer' },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.member.roleCharge, 0);
  assert.deepEqual(response.body.visualEvents, [{
    type: 'cleric_prayer',
    placedBy: {
      userId: userIds[0],
      firstName: 'Member1',
      username: 'Member1_user',
    },
    healedCount: 1,
    recoveryReducedCount: 0,
  }]);
  assert.equal(JSON.stringify(response.body.recentActions).includes('heroHp'), false);
  assert.equal(JSON.stringify(response.body.visualEvents).includes('heroHp'), false);
  assert.deepEqual(response.body.personalEvents, []);
  assert.equal(
    db.prepare(`
      SELECT hero_hp FROM family_expedition_members
      WHERE expedition_id = ? AND user_id = ?
    `).pluck().get(expeditionId, userIds[1]),
    3,
  );
  assert.equal(
    db.prepare(`
      SELECT COUNT(*) FROM family_expedition_member_events
      WHERE expedition_id = ? AND user_id = ? AND event_type = 'cleric_heal'
    `).pluck().get(expeditionId, userIds[1]),
    1,
  );

  const siblingState = await request('GET', '/current', 'tg-sibling');
  assert.equal(siblingState.status, 200);
  assert.equal(siblingState.body.personalEvents.length, 1);
  assert.equal(siblingState.body.personalEvents[0].type, 'cleric_heal');
  assert.equal(siblingState.body.personalEvents[0].heroHp, 3);
  assert.equal(siblingState.body.personalEvents[0].userId, undefined);

  const clericState = await request('GET', '/current', 'tg-owner');
  assert.equal(clericState.status, 200);
  assert.deepEqual(clericState.body.personalEvents, []);
  assert.equal(JSON.stringify(clericState.body.recentActions).includes('heroHp'), false);
});

test('member event acknowledgement validates ids, stays user-scoped, and is replay-safe', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner', 'tg-sibling']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-event-ack' });
  const expeditionId = started.body.expedition.id;
  const ownEventId = Number(db.prepare(`
    INSERT INTO family_expedition_member_events (
      expedition_id, user_id, event_type, payload_json, created_at
    ) VALUES (?, ?, 'cleric_heal', ?, 1000)
  `).run(expeditionId, userIds[0], JSON.stringify({
    type: 'cleric_heal',
    userId: userIds[0],
    targetUserId: userIds[0],
    heroHp: 3,
    privateState: { token: 'hidden' },
  })).lastInsertRowid);
  const foreignEventId = Number(db.prepare(`
    INSERT INTO family_expedition_member_events (
      expedition_id, user_id, event_type, payload_json, created_at
    ) VALUES (?, ?, 'cleric_heal', '{"heroHp":2}', 1001)
  `).run(expeditionId, userIds[1]).lastInsertRowid);

  const current = await request('GET', '/current', 'tg-owner');
  assert.equal(current.status, 200);
  assert.deepEqual(current.body.personalEvents, [{
    id: ownEventId,
    type: 'cleric_heal',
    heroHp: 3,
    createdAt: 1000,
  }]);
  assert.equal(JSON.stringify(current.body).includes('targetUserId'), false);
  assert.equal(JSON.stringify(current.body).includes('privateState'), false);

  db.prepare('DELETE FROM family_members WHERE user_id = ?').run(userIds[0]);
  const offlineCurrent = await request('GET', '/current', 'tg-owner');
  assert.equal(offlineCurrent.status, 200);
  assert.equal(offlineCurrent.body.expedition, null);
  assert.deepEqual(offlineCurrent.body.personalEvents, current.body.personalEvents);

  for (const eventIds of [[], [0], ['1'], [ownEventId, ownEventId]]) {
    const invalid = await request('POST', '/events/ack', 'tg-owner', {
      idempotencyKey: `invalid-event-ack-${JSON.stringify(eventIds)}`,
      eventIds,
    });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.error, /eventIds/i);
  }

  const acknowledged = await request('POST', '/events/ack', 'tg-owner', {
    idempotencyKey: 'event-ack-once',
    eventIds: [ownEventId, foreignEventId],
  });
  assert.equal(acknowledged.status, 200);
  assert.deepEqual(acknowledged.body.acknowledgedEventIds, [ownEventId]);
  assert.deepEqual(acknowledged.body.personalEvents, []);

  const replay = await request('POST', '/events/ack', 'tg-owner', {
    idempotencyKey: 'event-ack-once',
    eventIds: [ownEventId, foreignEventId],
  });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body.acknowledgedEventIds, [ownEventId]);
  assert.equal(
    db.prepare('SELECT acknowledged_at FROM family_expedition_member_events WHERE id = ?').pluck().get(foreignEventId),
    null,
  );
});

test('Mage links the next ally attack and Knight blocks then retaliates for the next ally', async () => {
  createFamilyWithMembers(['tg-owner', 'tg-mage', 'tg-actor']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-combat-effects' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-combat-knight',
    role: 'knight',
  });
  await request('POST', `/${expeditionId}/prepare`, 'tg-mage', {
    idempotencyKey: 'prepare-combat-mage',
    role: 'mage',
  });
  await request('POST', `/${expeditionId}/prepare`, 'tg-actor', {
    idempotencyKey: 'prepare-combat-actor',
    role: 'scout',
  });
  const combatRow = db.prepare(`
    SELECT id, room_key AS roomKey
    FROM family_expedition_rooms
    WHERE expedition_id = ?
      AND (room_type = 'boss' OR json_extract(payload_json, '$.encounterType') = 'combat')
    ORDER BY id
    LIMIT 1
  `).get(expeditionId);
  assert.ok(combatRow);
  const combatPayload = JSON.parse(db.prepare(`
    SELECT payload_json FROM family_expedition_rooms WHERE id = ?
  `).pluck().get(combatRow.id));
  combatPayload.actions = [{ id: 'test_strike', stat: 'spirit', modifier: 0, tags: ['combat'] }];
  combatPayload.weakRoles = [];
  db.prepare(`
    UPDATE family_expedition_rooms SET state = 'unlocked', payload_json = ?
    WHERE expedition_id = ? AND id = ?
  `).run(JSON.stringify(combatPayload), expeditionId, combatRow.id);

  assert.equal((await request(
    'POST', `/${expeditionId}/rooms/${combatRow.roomKey}/role-ability`, 'tg-owner',
    { idempotencyKey: 'combat-shield' },
  )).status, 200);
  assert.equal((await request(
    'POST', `/${expeditionId}/rooms/${combatRow.roomKey}/role-ability`, 'tg-mage',
    { idempotencyKey: 'combat-fate' },
  )).status, 200);

  const originalRandomInt = crypto.randomInt;
  try {
    crypto.randomInt = max => max === 6 ? 0 : 10;
    const advantaged = await request(
      'POST', `/${expeditionId}/rooms/${combatRow.roomKey}/attempt`, 'tg-actor',
      { idempotencyKey: 'combat-mage-roll', actionId: 'test_strike' },
    );
    assert.equal(advantaged.status, 200);
    assert.equal(advantaged.body.visualEvents.some(event => event.type === 'mage_boost_consumed' && event.attackBonus === 3), true);
    assert.equal(advantaged.body.recentActions.at(-1).modifiers.parts.some(part => part.source === 'mage:arcane_link' && part.amount === 2), true);
    assert.equal(advantaged.body.expedition.sharedBuffs.teamAbilities.mage.length, 0);

    crypto.randomInt = () => 0;
    const blocked = await request(
      'POST', `/${expeditionId}/rooms/${combatRow.roomKey}/attempt`, 'tg-actor',
      { idempotencyKey: 'combat-shield-block', actionId: 'test_strike' },
    );
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.visualEvents.some(event => event.type === 'shield_blocked'), true);
    assert.equal(blocked.body.member.heroHp, 3);
    assert.equal(blocked.body.visualEvents.some(event => event.type === 'shield_blocked' && event.retaliationDamage === 3), true);
    assert.equal(blocked.body.expedition.sharedBuffs.teamAbilities.knight.length, 0);
    const unshielded = await request(
      'POST', `/${expeditionId}/rooms/${combatRow.roomKey}/attempt`, 'tg-actor',
      { idempotencyKey: 'combat-after-shield', actionId: 'test_strike' },
    );
    assert.equal(unshielded.status, 200);
    assert.equal(unshielded.body.member.heroHp, 2);
  } finally {
    crypto.randomInt = originalRandomInt;
  }
});

test('persisted mini-game routes spend AP at start, isolate tokens, and retire the legacy endpoint', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner', 'tg-sibling']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-route-minigame' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-route-minigame-owner',
    role: 'scout',
  });
  await request('POST', `/${expeditionId}/prepare`, 'tg-sibling', {
    idempotencyKey: 'prepare-route-minigame-sibling',
    role: 'mage',
  });
  const eventRow = db.prepare(`
    SELECT id, room_key AS roomKey, payload_json AS payloadJson
    FROM family_expedition_rooms
    WHERE expedition_id = ?
      AND room_type NOT IN ('camp', 'combat', 'boss')
      AND json_extract(payload_json, '$.miniGame.kind') IS NOT NULL
    ORDER BY id LIMIT 1
  `).get(expeditionId);
  assert.ok(eventRow);
  const eventPayload = JSON.parse(eventRow.payloadJson);
  eventPayload.miniGame = { kind: 'focus_hold' };
  db.prepare("UPDATE family_expedition_rooms SET state = 'unlocked', payload_json = ? WHERE id = ?")
    .run(JSON.stringify(eventPayload), eventRow.id);

  const legacy = await request(
    'POST',
    `/${expeditionId}/rooms/${eventRow.roomKey}/event-minigame`,
    'tg-owner',
    { idempotencyKey: 'legacy-minigame', score: 100 },
  );
  assert.equal(legacy.status, 410);
  assert.equal(legacy.body.error, 'Mini-game client update required');

  const attemptStart = await request(
    'POST',
    `/${expeditionId}/rooms/${eventRow.roomKey}/minigame/start`,
    'tg-owner',
    { idempotencyKey: 'route-minigame-start' },
  );
  assert.equal(attemptStart.status, 200);
  assert.deepEqual(Object.keys(attemptStart.body.attempt).sort(), [
    'attemptToken',
    'expiresAt',
    'gameType',
    'retry',
    'seed',
    'startedAt',
  ]);
  assert.equal(attemptStart.body.member.ap, 4);
  assert.deepEqual(attemptStart.body.currentMinigameAttempt, {
    roomKey: eventRow.roomKey,
    attempt: attemptStart.body.attempt,
  });

  const resumedCurrent = await request('GET', '/current', 'tg-owner');
  assert.equal(resumedCurrent.status, 200);
  assert.deepEqual(resumedCurrent.body.currentMinigameAttempt, attemptStart.body.currentMinigameAttempt);
  const siblingCurrent = await request('GET', '/current', 'tg-sibling');
  assert.equal(siblingCurrent.body.currentMinigameAttempt, null);

  const immediateStartReplay = await request(
    'POST',
    `/${expeditionId}/rooms/${eventRow.roomKey}/minigame/start`,
    'tg-owner',
    { idempotencyKey: 'route-minigame-start' },
  );
  assert.equal(immediateStartReplay.status, 200);
  assert.deepEqual(immediateStartReplay.body, attemptStart.body);

  const combatRoom = db.prepare(`
    SELECT room_key AS roomKey, payload_json AS payloadJson
    FROM family_expedition_rooms
    WHERE expedition_id = ? AND room_type = 'combat'
    ORDER BY id LIMIT 1
  `).get(expeditionId);
  db.prepare("UPDATE family_expedition_rooms SET state = 'unlocked' WHERE expedition_id = ? AND room_key = ?")
    .run(expeditionId, combatRoom.roomKey);
  const combatAction = JSON.parse(combatRoom.payloadJson).actions[0].id;
  const crossActionReuse = await request(
    'POST', `/${expeditionId}/rooms/${combatRoom.roomKey}/attempt`, 'tg-owner',
    { idempotencyKey: 'route-minigame-start', actionId: combatAction },
  );
  assert.equal(crossActionReuse.status, 409);
  assert.match(crossActionReuse.body.error, /idempotency conflict/i);
  assert.equal(db.prepare(`
    SELECT ap FROM family_expedition_members WHERE expedition_id = ? AND user_id = ?
  `).pluck().get(expeditionId, userIds[0]), 4);

  const stolen = await request(
    'POST',
    `/${expeditionId}/rooms/${eventRow.roomKey}/minigame/${attemptStart.body.attempt.attemptToken}/finish`,
    'tg-sibling',
    {
      idempotencyKey: 'route-minigame-steal',
      result: { success: true, score: 100, seed: attemptStart.body.attempt.seed },
    },
  );
  assert.equal(stolen.status, 400);
  assert.match(stolen.body.error, /attempt not found/i);

  const finish = await request(
    'POST',
    `/${expeditionId}/rooms/${eventRow.roomKey}/minigame/${attemptStart.body.attempt.attemptToken}/finish`,
    'tg-owner',
    {
      idempotencyKey: 'route-minigame-finish',
      result: { success: true, score: 100, seed: attemptStart.body.attempt.seed },
    },
  );
  assert.equal(finish.status, 200);
  assert.deepEqual(Object.keys(finish.body.attempt).sort(), [
    'attemptToken',
    'expiresAt',
    'gameType',
    'retry',
    'seed',
    'startedAt',
  ]);
  assert.equal(finish.body.state, 'succeeded');
  assert.equal(finish.body.success, true);
  assert.equal(finish.body.member.ap, 4);

  db.prepare(`
    UPDATE family_expedition_members SET ap = 0, hero_hp = 1
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userIds[0]);

  const replay = await request(
    'POST',
    `/${expeditionId}/rooms/${eventRow.roomKey}/minigame/${attemptStart.body.attempt.attemptToken}/finish`,
    'tg-owner',
    {
      idempotencyKey: 'route-minigame-finish',
      result: { success: true, score: 100, seed: attemptStart.body.attempt.seed },
    },
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, finish.body);

  const delayedStartReplay = await request(
    'POST',
    `/${expeditionId}/rooms/${eventRow.roomKey}/minigame/start`,
    'tg-owner',
    { idempotencyKey: 'route-minigame-start' },
  );
  assert.equal(delayedStartReplay.status, 200);
  assert.deepEqual(delayedStartReplay.body, attemptStart.body);
});

test('paid mini-game attempts close safely after another member clears and finishes the expedition', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner', 'tg-sibling']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-concurrent-event' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-concurrent-owner',
    role: 'scout',
  });
  await request('POST', `/${expeditionId}/prepare`, 'tg-sibling', {
    idempotencyKey: 'prepare-concurrent-sibling',
    role: 'mage',
  });
  const room = db.prepare(`
    SELECT id, room_key AS roomKey, payload_json AS payloadJson
    FROM family_expedition_rooms
    WHERE expedition_id = ? AND room_type NOT IN ('camp', 'combat', 'boss')
    ORDER BY id LIMIT 1
  `).get(expeditionId);
  const payload = JSON.parse(room.payloadJson);
  payload.miniGame = { kind: 'focus_hold' };
  payload.loot = { coins: { min: 12, max: 12 }, artifactRolls: 0 };
  db.prepare(`
    UPDATE family_expedition_rooms
    SET state = 'unlocked', progress = 0, progress_target = 1, payload_json = ?
    WHERE id = ?
  `).run(JSON.stringify(payload), room.id);
  const cleanupRoomId = Number(db.prepare(`
    INSERT INTO family_expedition_rooms (
      expedition_id, room_key, room_type, state, progress_target, payload_json, unlocked_at
    ) VALUES (?, 'cleanup-event', 'event', 'unlocked', 1, ?, strftime('%s','now'))
  `).run(expeditionId, JSON.stringify(payload)).lastInsertRowid);

  const ownerStart = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'concurrent-owner-start' },
  );
  const siblingStart = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-sibling',
    { idempotencyKey: 'concurrent-sibling-start' },
  );
  const siblingCleanupStart = await request(
    'POST', `/${expeditionId}/rooms/cleanup-event/minigame/start`, 'tg-sibling',
    { idempotencyKey: 'concurrent-sibling-cleanup-start' },
  );
  assert.equal(ownerStart.status, 200);
  assert.equal(siblingStart.status, 200);
  assert.equal(siblingCleanupStart.status, 200);

  const ownerFinish = await request(
    'POST',
    `/${expeditionId}/rooms/${room.roomKey}/minigame/${ownerStart.body.attempt.attemptToken}/finish`,
    'tg-owner',
    { idempotencyKey: 'concurrent-owner-finish', result: { success: true, score: 100 } },
  );
  assert.equal(ownerFinish.status, 200);
  assert.equal(ownerFinish.body.state, 'succeeded');
  db.prepare(`
    UPDATE family_expedition_rooms
    SET state = 'cleared', progress = progress_target, cleared_at = strftime('%s','now')
    WHERE expedition_id = ? AND room_type = 'boss'
  `).run(expeditionId);
  const expeditionFinish = await request('POST', `/${expeditionId}/finish`, 'tg-owner', {
    idempotencyKey: 'finish-concurrent-expedition',
  });
  assert.equal(expeditionFinish.status, 200);
  assert.equal(expeditionFinish.body.expedition.status, 'finished');
  const ownerCoins = db.prepare('SELECT coins FROM users WHERE id = ?').pluck().get(userIds[0]);
  const siblingCoinsBefore = db.prepare('SELECT coins FROM users WHERE id = ?').pluck().get(userIds[1]);

  const siblingFinish = await request(
    'POST',
    `/${expeditionId}/rooms/${room.roomKey}/minigame/${siblingStart.body.attempt.attemptToken}/finish`,
    'tg-sibling',
    { idempotencyKey: 'concurrent-sibling-finish', result: { success: true, score: 100 } },
  );
  assert.equal(siblingFinish.status, 200);
  assert.equal(siblingFinish.body.state, 'superseded');
  assert.equal(siblingFinish.body.success, true);
  assert.equal(siblingFinish.body.progressAwarded, 0);
  assert.deepEqual(siblingFinish.body.loot, {});
  assert.equal(siblingFinish.body.visualEvents[0].type, 'event_minigame_already_cleared');
  assert.equal(db.prepare(`
    SELECT status FROM family_expedition_minigame_attempts WHERE attempt_token = ?
  `).pluck().get(siblingStart.body.attempt.attemptToken), 'superseded');
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = ?').pluck().get(userIds[0]), ownerCoins);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = ?').pluck().get(userIds[1]), siblingCoinsBefore);
  assert.equal(db.prepare('SELECT progress FROM family_expedition_rooms WHERE id = ?').pluck().get(room.id), 1);

  const replay = await request(
    'POST',
    `/${expeditionId}/rooms/${room.roomKey}/minigame/${siblingStart.body.attempt.attemptToken}/finish`,
    'tg-sibling',
    { idempotencyKey: 'concurrent-sibling-finish', result: { success: true, score: 100 } },
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, siblingFinish.body);
  db.prepare(`
    UPDATE family_expedition_minigame_attempts
    SET expires_at = strftime('%s','now') - 1
    WHERE attempt_token = ?
  `).run(siblingCleanupStart.body.attempt.attemptToken);
  const rejectedNewStart = await request(
    'POST', `/${expeditionId}/rooms/cleanup-event/minigame/start`, 'tg-sibling',
    { idempotencyKey: 'post-finish-new-start' },
  );
  assert.equal(rejectedNewStart.status, 400);
  assert.equal(rejectedNewStart.body.error, 'expedition is finished');
  assert.equal(db.prepare(`
    SELECT status FROM family_expedition_minigame_attempts WHERE attempt_token = ?
  `).pluck().get(siblingCleanupStart.body.attempt.attemptToken), 'superseded');
  assert.equal(db.prepare(`
    SELECT COUNT(*) FROM family_expedition_minigame_attempts
    WHERE user_id = ? AND status IN ('ready', 'active', 'retry')
  `).pluck().get(userIds[1]), 0);
  assert.equal(db.prepare(`
    SELECT hero_hp FROM family_expedition_members WHERE expedition_id = ? AND user_id = ?
  `).pluck().get(expeditionId, userIds[1]), 3);
  assert.equal(db.prepare(`
    SELECT COUNT(*) FROM family_expedition_history WHERE expedition_id = ?
  `).pluck().get(expeditionId), 1);
  assert.equal(db.prepare(`
    SELECT COUNT(*) FROM family_expedition_actions
    WHERE expedition_id = ? AND action_type = 'finish_expedition'
  `).pluck().get(expeditionId), 1);
  assert.equal(db.prepare(`
    SELECT COUNT(*) FROM family_expedition_actions
    WHERE expedition_id = ? AND room_id = ? AND action_type = 'event_minigame'
  `).pluck().get(expeditionId, room.id), 1);
  assert.equal(db.prepare(`
    SELECT progress FROM family_expedition_rooms WHERE id = ?
  `).pluck().get(cleanupRoomId), 0);
});

test('stale mini-game timeout commits even when replacement start is rejected', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-timeout-commit' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-timeout-commit',
    role: 'scout',
  });
  const room = db.prepare(`
    SELECT id, room_key AS roomKey, payload_json AS payloadJson
    FROM family_expedition_rooms
    WHERE expedition_id = ? AND room_type NOT IN ('camp', 'combat', 'boss')
    ORDER BY id LIMIT 1
  `).get(expeditionId);
  const payload = JSON.parse(room.payloadJson);
  payload.miniGame = { kind: 'focus_hold' };
  db.prepare("UPDATE family_expedition_rooms SET state = 'unlocked', payload_json = ? WHERE id = ?")
    .run(JSON.stringify(payload), room.id);

  const first = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-expiring-attempt' },
  );
  assert.equal(first.status, 200);
  db.prepare(`
    UPDATE family_expedition_minigame_attempts SET expires_at = ?
    WHERE attempt_token = ?
  `).run(Math.floor(Date.now() / 1000) - 1, first.body.attempt.attemptToken);
  db.prepare(`
    UPDATE family_expedition_members SET ap = 0, hero_hp = 2, hero_recover_at = NULL
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userIds[0]);

  const replacement = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-after-expired-attempt' },
  );
  assert.equal(replacement.status, 400);
  assert.match(replacement.body.error, /enough AP/i);
  assert.equal(db.prepare(`
    SELECT status FROM family_expedition_minigame_attempts WHERE attempt_token = ?
  `).pluck().get(first.body.attempt.attemptToken), 'expired');
  const member = db.prepare(`
    SELECT hero_hp AS heroHp, hero_recover_at AS heroRecoverAt
    FROM family_expedition_members WHERE expedition_id = ? AND user_id = ?
  `).get(expeditionId, userIds[0]);
  assert.equal(member.heroHp, 2);
  assert.equal(member.heroRecoverAt, null);
});

test('stale mini-game timeout returns a free Mage retry instead of starting again', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-timeout-mage' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-timeout-mage',
    role: 'mage',
  });
  const room = db.prepare(`
    SELECT id, room_key AS roomKey, payload_json AS payloadJson
    FROM family_expedition_rooms
    WHERE expedition_id = ? AND room_type NOT IN ('camp', 'combat', 'boss')
    ORDER BY id LIMIT 1
  `).get(expeditionId);
  const payload = JSON.parse(room.payloadJson);
  payload.miniGame = { kind: 'focus_hold' };
  db.prepare("UPDATE family_expedition_rooms SET state = 'unlocked', payload_json = ? WHERE id = ?")
    .run(JSON.stringify(payload), room.id);
  db.prepare(`
    INSERT INTO family_expedition_room_effects (
      expedition_id, room_id, effect_type, placed_by, remaining_uses, created_at
    ) VALUES (?, ?, 'bend_fate', ?, 1, ?)
  `).run(expeditionId, room.id, userIds[0], Math.floor(Date.now() / 1000));

  const first = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-expiring-mage-attempt' },
  );
  const originalOrdinaryStartResponse = first.body;
  db.prepare(`
    UPDATE family_expedition_minigame_attempts SET expires_at = ? WHERE attempt_token = ?
  `).run(Math.floor(Date.now() / 1000) - 1, first.body.attempt.attemptToken);

  const retry = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-after-mage-timeout' },
  );
  assert.equal(retry.status, 200);
  assert.deepEqual(Object.keys(retry.body.attempt).sort(), [
    'attemptToken',
    'expiresAt',
    'gameType',
    'retry',
    'seed',
    'startedAt',
  ]);
  assert.equal(retry.body.attempt.retry, true);
  assert.equal(retry.body.attempt.attemptToken, first.body.attempt.attemptToken);
  assert.equal(retry.body.member.ap, 4);
  assert.equal(retry.body.member.heroHp, 3);
  assert.equal(retry.body.visualEvents[0].type, 'mage_retry');
  const ordinaryStartAfterRetry = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-expiring-mage-attempt' },
  );
  assert.equal(ordinaryStartAfterRetry.status, 200);
  assert.deepEqual(ordinaryStartAfterRetry.body, originalOrdinaryStartResponse);
  const originalRetryStartResponse = {
    attempt: retry.body.attempt,
    visualEvents: retry.body.visualEvents,
  };

  const exactReplay = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-after-mage-timeout' },
  );
  assert.equal(exactReplay.status, 200);
  assert.deepEqual({
    attempt: exactReplay.body.attempt,
    visualEvents: exactReplay.body.visualEvents,
  }, originalRetryStartResponse);
  assert.equal(exactReplay.body.member.ap, 4);

  const finishedRetry = await request(
    'POST',
    `/${expeditionId}/rooms/${room.roomKey}/minigame/${retry.body.attempt.attemptToken}/finish`,
    'tg-owner',
    {
      idempotencyKey: 'finish-mage-timeout-retry',
      result: { success: true, score: 100, seed: retry.body.attempt.seed },
    },
  );
  assert.equal(finishedRetry.status, 200);
  assert.equal(finishedRetry.body.state, 'succeeded');
  const ordinaryStartAfterResolution = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-expiring-mage-attempt' },
  );
  assert.equal(ordinaryStartAfterResolution.status, 200);
  assert.deepEqual(ordinaryStartAfterResolution.body, originalOrdinaryStartResponse);

  const delayedReplay = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-after-mage-timeout' },
  );
  assert.equal(delayedReplay.status, 200);
  assert.deepEqual({
    attempt: delayedReplay.body.attempt,
    visualEvents: delayedReplay.body.visualEvents,
  }, originalRetryStartResponse);

  payload.miniGame = { kind: 'root_crossing' };
  db.prepare('UPDATE family_expedition_rooms SET payload_json = ? WHERE id = ?')
    .run(JSON.stringify(payload), room.id);
  const mismatchedReplay = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-after-mage-timeout' },
  );
  assert.equal(mismatchedReplay.status, 409);
  assert.match(mismatchedReplay.body.error, /idempotency conflict/i);
});

test('client cannot reserve the internal timeout key or block stale resolution', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-internal-key-guard' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-internal-key-guard',
    role: 'scout',
  });
  const room = db.prepare(`
    SELECT id, room_key AS roomKey, payload_json AS payloadJson
    FROM family_expedition_rooms
    WHERE expedition_id = ? AND room_type NOT IN ('camp', 'combat', 'boss')
    ORDER BY id LIMIT 1
  `).get(expeditionId);
  const payload = JSON.parse(room.payloadJson);
  payload.miniGame = { kind: 'focus_hold' };
  db.prepare("UPDATE family_expedition_rooms SET state = 'unlocked', payload_json = ? WHERE id = ?")
    .run(JSON.stringify(payload), room.id);

  const first = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-before-guessed-timeout' },
  );
  assert.equal(first.status, 200);
  const guessedInternalKey = `$internal$:minigame-expire:${first.body.attempt.attemptToken}`;
  const guessed = await request(
    'POST',
    `/${expeditionId}/rooms/${room.roomKey}/minigame/${first.body.attempt.attemptToken}/finish`,
    'tg-owner',
    { idempotencyKey: guessedInternalKey, result: { success: false, score: 0 } },
  );
  assert.equal(guessed.status, 400);
  assert.match(guessed.body.error, /reserved/i);

  db.prepare(`
    UPDATE family_expedition_minigame_attempts SET expires_at = ? WHERE attempt_token = ?
  `).run(Math.floor(Date.now() / 1000) - 1, first.body.attempt.attemptToken);
  db.prepare(`
    UPDATE family_expedition_members SET ap = 0
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userIds[0]);
  const replacement = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-after-guarded-timeout' },
  );
  assert.equal(replacement.status, 400);
  assert.match(replacement.body.error, /enough AP/i);
  assert.equal(db.prepare(`
    SELECT status FROM family_expedition_minigame_attempts WHERE attempt_token = ?
  `).pluck().get(first.body.attempt.attemptToken), 'expired');
});

test('persisted mini-game routes apply Mage retry without HP damage or consuming Knight shield', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner', 'tg-helper']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-route-effects' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-route-effects-owner',
    role: 'scout',
  });
  await request('POST', `/${expeditionId}/prepare`, 'tg-helper', {
    idempotencyKey: 'prepare-route-effects-helper',
    role: 'mage',
  });
  const room = db.prepare(`
    SELECT id, room_key AS roomKey, payload_json AS payloadJson
    FROM family_expedition_rooms
    WHERE expedition_id = ? AND room_type NOT IN ('camp', 'combat', 'boss')
    ORDER BY id LIMIT 1
  `).get(expeditionId);
  assert.ok(room);
  const payload = JSON.parse(room.payloadJson);
  payload.miniGame = { kind: 'timing_window' };
  db.prepare("UPDATE family_expedition_rooms SET state = 'unlocked', payload_json = ? WHERE id = ?")
    .run(JSON.stringify(payload), room.id);
  db.prepare(`
    UPDATE family_expedition_members SET hero_hp = 1
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userIds[0]);
  db.prepare(`
    INSERT INTO family_expedition_room_effects (
      expedition_id, room_id, effect_type, placed_by, remaining_uses, created_at
    ) VALUES (?, ?, 'bend_fate', ?, 1, ?)
  `).run(expeditionId, room.id, userIds[1], Math.floor(Date.now() / 1000));

  const attempt = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-route-mage-retry' },
  );
  const retry = await request(
    'POST',
    `/${expeditionId}/rooms/${room.roomKey}/minigame/${attempt.body.attempt.attemptToken}/finish`,
    'tg-owner',
    { idempotencyKey: 'finish-route-mage-retry', result: { success: false, score: 0 } },
  );
  assert.equal(retry.status, 200);
  assert.equal(retry.body.state, 'retry');
  assert.equal(retry.body.visualEvents[0].type, 'mage_retry');
  assert.equal(retry.body.member.ap, 4);
  assert.equal(retry.body.member.heroHp, 1);

  const knockout = await request(
    'POST',
    `/${expeditionId}/rooms/${room.roomKey}/minigame/${attempt.body.attempt.attemptToken}/finish`,
    'tg-owner',
    { idempotencyKey: 'finish-route-knockout', result: { success: false, score: 0 } },
  );
  assert.equal(knockout.status, 200);
  assert.equal(knockout.body.member.heroHp, 1);
  assert.equal(knockout.body.member.heroRecoverAt, null);

  db.prepare(`
    UPDATE family_expedition_members SET hero_hp = 3, hero_recover_at = NULL
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userIds[0]);
  db.prepare(`
    INSERT INTO family_expedition_room_effects (
      expedition_id, room_id, effect_type, placed_by, remaining_uses, created_at
    ) VALUES (?, ?, 'knight_shield', ?, 1, ?)
  `).run(expeditionId, room.id, userIds[1], Math.floor(Date.now() / 1000));
  const shieldedAttempt = await request(
    'POST', `/${expeditionId}/rooms/${room.roomKey}/minigame/start`, 'tg-owner',
    { idempotencyKey: 'start-route-shielded' },
  );
  const shielded = await request(
    'POST',
    `/${expeditionId}/rooms/${room.roomKey}/minigame/${shieldedAttempt.body.attempt.attemptToken}/finish`,
    'tg-owner',
    { idempotencyKey: 'finish-route-shielded', result: { success: false, score: 0 } },
  );
  assert.equal(shielded.status, 200);
  assert.equal(shielded.body.member.heroHp, 3);
  assert.deepEqual(shielded.body.visualEvents, []);
  assert.equal(
    shielded.body.map.rooms.find(item => item.key === room.roomKey).activeEffects[0].effectType,
    'knight_shield',
  );
});

test('Scout role ability chooses once per expedition and AP spending does not recharge it', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-scout-charge' });
  const expeditionId = started.body.expedition.id;
  const prepared = await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-scout-charge',
    role: 'scout',
  });
  const source = prepared.body.map.rooms.find(room => room.state === 'unlocked' && room.scoutChoices?.length);
  assert.ok(source);
  const choice = source.scoutChoices[0];

  const chosen = await request(
    'POST', `/${expeditionId}/rooms/${source.key}/role-ability`, 'tg-owner',
    { idempotencyKey: 'choose-scout-path', choiceId: choice.id },
  );
  assert.equal(chosen.status, 200);
  assert.equal(chosen.body.member.roleCharge, 0);
  assert.equal(
    chosen.body.map.rooms.find(room => room.key === source.key).scoutChoice.choiceId,
    choice.id,
  );

  db.prepare(`
    UPDATE family_expedition_members
    SET role_charge = 1, role_charge_progress = 0
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userIds[0]);
  const duplicate = await request(
    'POST', `/${expeditionId}/rooms/${source.key}/role-ability`, 'tg-owner',
    { idempotencyKey: 'choose-scout-path-again', choiceId: source.scoutChoices[1].id },
  );
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.body.error, /already chosen/i);
  assert.equal(db.prepare(`
    SELECT role_charge FROM family_expedition_members
    WHERE expedition_id = ? AND user_id = ?
  `).pluck().get(expeditionId, userIds[0]), 1);

  db.prepare(`
    UPDATE family_expedition_members
    SET role_charge = 0, role_charge_progress = 0
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userIds[0]);
  const attempted = await request(
    'POST', `/${expeditionId}/rooms/${source.key}/attempt`, 'tg-owner',
    { idempotencyKey: 'recharge-scout-with-ap', actionId: source.actions[0].id },
  );
  assert.equal(attempted.status, 200);
  assert.equal(attempted.body.member.roleCharge, 0);
  assert.equal(attempted.body.member.roleChargeProgress, 0);
});

test('legacy boss chest endpoint is retired in favor of pending expedition rewards', async () => {
  createFamilyWithMembers(['tg-owner']);
  const response = await request('POST', '/1/claim-boss-reward', 'tg-owner', {
    idempotencyKey: 'legacy-boss-chest',
  });

  assert.equal(response.status, 410);
  assert.match(response.body.error, /claim rewards/i);
});

test('finishing creates pending rewards and a new expedition keeps them visible', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-pending-finish' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-pending-finish',
    role: 'scout',
  });
  db.prepare(`
    UPDATE family_expeditions SET status = 'boss_defeated', boss_defeated_at = 2000
    WHERE id = ?
  `).run(expeditionId);
  db.prepare(`
    UPDATE family_expedition_rooms
    SET state = 'cleared', progress = progress_target, cleared_at = 2000
    WHERE expedition_id = ?
  `).run(expeditionId);
  db.prepare(`
    UPDATE family_expedition_members SET contribution_ap = 3
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userIds[0]);

  const finished = await request('POST', `/${expeditionId}/finish`, 'tg-owner', {
    idempotencyKey: 'finish-pending-reward',
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.body.pendingRewardCount, 1);
  assert.equal(finished.body.pendingRewards.length, 1);
  assert.equal(finished.body.pendingRewards[0].payload.contributionAp, 3);
  assert.equal(finished.body.pendingRewards[0].payload.totalCoins > 0, true);

  const next = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-after-pending-finish' });
  assert.equal(next.status, 200);
  assert.equal(next.body.expedition.status, 'active');
  assert.equal(next.body.pendingRewardCount, 1);
  assert.equal(next.body.pendingRewards[0].id, finished.body.pendingRewards[0].id);
});

test('pending reward claim is user-scoped and does not require current family membership', async () => {
  const { familyId, userIds } = createFamilyWithMembers(['tg-owner', 'tg-other']);
  const expeditionId = Number(db.prepare(`
    INSERT INTO family_expeditions (
      family_id, theme_id, seed, status, map_json, shared_buffs_json,
      started_by, started_at, boss_defeated_at, finished_at
    ) VALUES (?, 'root_king', 'claim-without-family', 'finished', '{}', '{}', ?, 1000, 2000, 2500)
  `).run(familyId, userIds[0]).lastInsertRowid);
  const rewardId = Number(db.prepare(`
    INSERT INTO family_expedition_pending_rewards (
      expedition_id, user_id, payload_json, created_at
    ) VALUES (?, ?, ?, 3000)
  `).run(expeditionId, userIds[0], JSON.stringify({
    contributionAp: 2,
    roomCoins: 12,
    finalCoins: 30,
    totalCoins: 42,
    artifacts: [{ artifactId: 'old_torch' }],
    expeditionTitle: 'Finished Before Leaving',
    completedAt: 2500,
  })).lastInsertRowid);
  db.prepare('DELETE FROM family_members WHERE family_id = ? AND user_id = ?').run(familyId, userIds[0]);

  const wrongUser = await request('POST', `/rewards/${rewardId}/claim`, 'tg-other');
  assert.equal(wrongUser.status, 400);
  assert.match(wrongUser.body.error, /not found/i);

  const claimed = await request('POST', `/rewards/${rewardId}/claim`, 'tg-owner');
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.reward.id, rewardId);
  assert.deepEqual(claimed.body.reward.payload, {
    contributionAp: 2,
    roomCoins: 12,
    finalCoins: 30,
    totalCoins: 42,
    artifacts: [{ artifactId: 'old_torch' }],
    expeditionTitle: 'Finished Before Leaving',
    completedAt: 2500,
  });
  assert.equal(claimed.body.pendingRewardCount, 0);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = ?').pluck().get(userIds[0]), 542);

  const replay = await request('POST', `/rewards/${rewardId}/claim`, 'tg-owner');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.reward.claimedAt, claimed.body.reward.claimedAt);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = ?').pluck().get(userIds[0]), 542);
  assert.equal(db.prepare(`
    SELECT quantity FROM expedition_artifact_inventory
    WHERE user_id = ? AND artifact_id = 'old_torch'
  `).pluck().get(userIds[0]), 1);
});

test('former family members cannot mutate an expedition they helped start', async () => {
  const { familyId, userIds } = createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-former' });

  db.prepare('DELETE FROM family_members WHERE family_id = ? AND user_id = ?').run(familyId, userIds[0]);
  const rejected = await request('POST', `/${started.body.expedition.id}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-former',
    role: 'scout',
  });

  assert.equal(rejected.status, 403);
  assert.equal(rejected.body.error, 'You are not a current family member for this expedition');
});

test('cleared room attempts become HTTP 409 where possible', async () => {
  createFamilyWithMembers(['tg-owner']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-cleared' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-cleared',
    role: 'scout',
  });
  const camp = started.body.map.rooms.find(room => room.type === 'camp');
  db.prepare(`
    UPDATE family_expedition_rooms
    SET state = 'cleared', progress = progress_target, cleared_at = 2000
    WHERE expedition_id = ? AND room_key = ?
  `).run(expeditionId, camp.key);

  const response = await request('POST', `/${expeditionId}/rooms/${camp.key}/attempt`, 'tg-owner', {
    idempotencyKey: 'attempt-cleared',
    actionId: camp.actions[0].id,
    roll: 20,
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'Room already cleared');
});

test('GET /artifacts only returns the authenticated user inventory', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner', 'tg-other']);
  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES
      (?, 'bent_sword', 1, 0, 1000, 1000),
      (?, 'chalk_rune', 1, 0, 1000, 1000)
  `).run(userIds[0], userIds[1]);

  const response = await request('GET', '/artifacts', 'tg-owner');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.artifactInventory, [
    { artifactId: 'bent_sword', quantity: 1, charges: 0 },
  ]);
});

test('GET /artifacts requires current family membership', async () => {
  createUser('tg-solo', 'Solo');
  const noFamily = await request('GET', '/artifacts', 'tg-solo');
  assert.equal(noFamily.status, 403);
  assert.equal(noFamily.body.error, 'You are not in a family');

  resetDb();
  const { familyId, userIds } = createFamilyWithMembers(['tg-owner']);
  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES (?, 'bent_sword', 1, 0, 1000, 1000)
  `).run(userIds[0]);
  db.prepare('DELETE FROM family_members WHERE family_id = ? AND user_id = ?').run(familyId, userIds[0]);

  const formerMember = await request('GET', '/artifacts', 'tg-owner');
  assert.equal(formerMember.status, 403);
  assert.equal(formerMember.body.error, 'You are not in a family');
});

test('backend server registers the expedition API route', () => {
  const serverSource = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf8');
  assert.match(
    serverSource,
    /app\.use\('\/api\/expeditions', require\('\.\/routes\/expeditions'\)\);/,
  );
});
