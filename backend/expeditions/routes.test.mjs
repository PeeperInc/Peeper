import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
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
  });

  assert.deepEqual(Object.keys(state), [
    'expedition',
    'map',
    'member',
    'familyMembers',
    'recentActions',
    'artifactInventory',
    'catalog',
    'permissions',
  ]);
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
  assert.match(unownedArtifact.body.error, /Artifact not owned/);

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

test('POST claim-boss-reward enforces contribution threshold and claims once', async () => {
  const { userIds } = createFamilyWithMembers(['tg-owner', 'tg-low']);
  const started = await request('POST', '/start', 'tg-owner', { idempotencyKey: 'start-claim-route' });
  const expeditionId = started.body.expedition.id;
  await request('POST', `/${expeditionId}/prepare`, 'tg-owner', {
    idempotencyKey: 'prepare-claim-owner',
    role: 'scout',
  });
  await request('POST', `/${expeditionId}/prepare`, 'tg-low', {
    idempotencyKey: 'prepare-claim-low',
    role: 'scout',
  });
  db.prepare("UPDATE family_expeditions SET status = 'boss_defeated', boss_defeated_at = 2000 WHERE id = ?").run(expeditionId);
  db.prepare('UPDATE family_expedition_members SET contribution_ap = 3 WHERE expedition_id = ? AND user_id = ?').run(expeditionId, userIds[0]);
  db.prepare('UPDATE family_expedition_members SET contribution_ap = 2 WHERE expedition_id = ? AND user_id = ?').run(expeditionId, userIds[1]);

  const rejected = await request('POST', `/${expeditionId}/claim-boss-reward`, 'tg-low', {
    idempotencyKey: 'claim-low-route',
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /3 AP/);

  const originalRandomInt = crypto.randomInt;
  crypto.randomInt = () => 999_999;
  try {
    const claimed = await request('POST', `/${expeditionId}/claim-boss-reward`, 'tg-owner', {
      idempotencyKey: 'claim-owner-route',
    });
    assert.equal(claimed.status, 200);
    assert.ok(claimed.body.member.bossRewardClaimedAt);
    assert.equal(db.prepare('SELECT coins FROM users WHERE id = ?').get(userIds[0]).coins, 570);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expedition_artifact_inventory WHERE user_id = ?').get(userIds[0]).count, 1);

    const replay = await request('POST', `/${expeditionId}/claim-boss-reward`, 'tg-owner', {
      idempotencyKey: 'claim-owner-route',
    });
    assert.equal(replay.status, 200);
    assert.equal(db.prepare('SELECT coins FROM users WHERE id = ?').get(userIds[0]).coins, 570);
  } finally {
    crypto.randomInt = originalRandomInt;
  }
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
