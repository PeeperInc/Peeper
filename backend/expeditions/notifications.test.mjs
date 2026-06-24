import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tempDirectory = mkdtempSync(path.join(tmpdir(), 'peeper-expedition-notifications-'));
process.env.PEEPER_DB_PATH = path.join(tempDirectory, 'peeper.test.db');
const notifier = require('../notifier.js');
const db = require('../database.js');
delete process.env.PEEPER_DB_PATH;

const NOW = 1_800_000_000;

after(() => {
  db.close();
  rmSync(tempDirectory, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM notifications_sent;
    DELETE FROM user_notification_settings;
    DELETE FROM family_expedition_history;
    DELETE FROM family_expedition_actions;
    DELETE FROM family_expedition_members;
    DELETE FROM family_expedition_rooms;
    DELETE FROM family_expeditions;
    DELETE FROM family_members;
    DELETE FROM families;
    DELETE FROM peepers;
    DELETE FROM users;
  `);
});

function createUser(telegramId, firstName = telegramId) {
  return Number(db.prepare(`
    INSERT INTO users (telegram_id, first_name, username, coins)
    VALUES (?, ?, ?, 500)
  `).run(String(telegramId), firstName, `${firstName}_user`).lastInsertRowid);
}

function createFamilyWithUsers(userIds) {
  const familyId = Number(db.prepare(`
    INSERT INTO families (name, founder_id, invite_code)
    VALUES ('Raven House', ?, ?)
  `).run(userIds[0], `RAVEN${userIds[0]}`).lastInsertRowid);

  for (const userId of userIds) {
    db.prepare('INSERT INTO family_members (family_id, user_id) VALUES (?, ?)').run(familyId, userId);
  }
  return familyId;
}

function createExpedition({ familyId, status = 'active', finishedAt = null, bossDefeatedAt = null }) {
  return Number(db.prepare(`
    INSERT INTO family_expeditions (
      family_id, theme_id, seed, status, map_json, started_by, started_at, boss_defeated_at, finished_at
    ) VALUES (?, 'root_king', 'seed', ?, '{}', ?, ?, ?, ?)
  `).run(familyId, status, familyId, NOW - 3600, bossDefeatedAt, finishedAt).lastInsertRowid);
}

function addBossRoom(expeditionId, state = 'locked') {
  db.prepare(`
    INSERT INTO family_expedition_rooms (
      expedition_id, room_key, room_type, state, progress_target
    ) VALUES (?, 'boss_1', 'boss', ?, 8)
  `).run(expeditionId, state);
}

function prepareMember(expeditionId, userId, overrides = {}) {
  const {
    ap = 3,
    bossRewardClaimedAt = null,
  } = overrides;

  db.prepare(`
    INSERT INTO family_expedition_members (
      expedition_id, user_id, role, ap, ap_regen_day, role_ability_day, prepared_at, boss_reward_claimed_at
    ) VALUES (?, ?, 'scout', ?, 20628, 20628, ?, ?)
  `).run(expeditionId, userId, ap, NOW - 1800, bossRewardClaimedAt);
}

async function collectNotifications(now = NOW) {
  const sent = [];
  await notifier.checkExpeditionNotifications({
    now,
    send: async (telegramId, text) => sent.push({ telegramId, text }),
  });
  return sent;
}

function wasSent(userId, type) {
  return Boolean(db.prepare(`
    SELECT 1 FROM notifications_sent WHERE user_id = ? AND type = ?
  `).get(userId, type));
}

test('expedition notifications respect the expedition_notifications setting', async () => {
  const userId = createUser('tg-disabled', 'Mira');
  const familyId = createFamilyWithUsers([userId]);
  const expeditionId = createExpedition({ familyId });
  addBossRoom(expeditionId, 'unlocked');
  prepareMember(expeditionId, userId, { ap: 6 });
  db.prepare(`
    INSERT INTO user_notification_settings (user_id, expedition_notifications)
    VALUES (?, 0)
  `).run(userId);

  const sent = await collectNotifications();

  assert.equal(sent.length, 0);
  assert.equal(wasSent(userId, 'expedition_ap_full'), false);
  assert.equal(wasSent(userId, 'expedition_boss_ready'), false);
});

test('AP full notification is one-shot until AP drops below six', async () => {
  const userId = createUser('tg-ap', 'Nyx');
  const familyId = createFamilyWithUsers([userId]);
  const expeditionId = createExpedition({ familyId });
  prepareMember(expeditionId, userId, { ap: 6 });

  assert.equal((await collectNotifications()).length, 1);
  assert.equal(wasSent(userId, 'expedition_ap_full'), true);
  assert.equal((await collectNotifications()).length, 0);

  db.prepare(`
    UPDATE family_expedition_members SET ap = 5
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userId);
  assert.equal((await collectNotifications()).length, 0);
  assert.equal(wasSent(userId, 'expedition_ap_full'), false);

  db.prepare(`
    UPDATE family_expedition_members SET ap = 6
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userId);
  assert.equal((await collectNotifications()).length, 1);
});

test('boss ready notification sends to prepared members when the boss room is unlocked', async () => {
  const userId = createUser('tg-boss', 'Rook');
  const familyId = createFamilyWithUsers([userId]);
  const expeditionId = createExpedition({ familyId });
  addBossRoom(expeditionId, 'unlocked');
  prepareMember(expeditionId, userId);

  const sent = await collectNotifications();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].telegramId, 'tg-boss');
  assert.match(sent[0].text, /boss/i);
  assert.equal(wasSent(userId, 'expedition_boss_ready'), true);
  assert.equal((await collectNotifications()).length, 0);

  db.prepare(`
    UPDATE family_expedition_rooms SET state = 'locked'
    WHERE expedition_id = ? AND room_key = 'boss_1'
  `).run(expeditionId);
  assert.equal((await collectNotifications()).length, 0);
  assert.equal(wasSent(userId, 'expedition_boss_ready'), false);
});

test('boss reward notification sends after victory until claimed', async () => {
  const userId = createUser('tg-reward', 'Vesper');
  const familyId = createFamilyWithUsers([userId]);
  const expeditionId = createExpedition({ familyId, status: 'boss_defeated', bossDefeatedAt: NOW - 60 });
  addBossRoom(expeditionId, 'cleared');
  prepareMember(expeditionId, userId, { bossRewardClaimedAt: null });

  const sent = await collectNotifications();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /reward/i);
  assert.equal(wasSent(userId, 'expedition_boss_reward'), true);
  assert.equal((await collectNotifications()).length, 0);

  db.prepare(`
    UPDATE family_expedition_members SET boss_reward_claimed_at = ?
    WHERE expedition_id = ? AND user_id = ?
  `).run(NOW, expeditionId, userId);
  assert.equal((await collectNotifications()).length, 0);
  assert.equal(wasSent(userId, 'expedition_boss_reward'), false);
});

test('finished notification sends only for recent completed expeditions and resets after the recent window', async () => {
  const userId = createUser('tg-finished', 'Selene');
  const familyId = createFamilyWithUsers([userId]);
  const expeditionId = createExpedition({ familyId, status: 'finished', finishedAt: NOW - 60 });
  prepareMember(expeditionId, userId);

  const sent = await collectNotifications();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /finished/i);
  assert.equal(wasSent(userId, 'expedition_finished'), true);
  assert.equal((await collectNotifications()).length, 0);

  assert.equal((await collectNotifications(NOW + 25 * 3600)).length, 0);
  assert.equal(wasSent(userId, 'expedition_finished'), false);

  db.prepare(`
    UPDATE family_expeditions SET finished_at = ?
    WHERE id = ?
  `).run(NOW + 25 * 3600 - 60, expeditionId);
  assert.equal((await collectNotifications(NOW + 25 * 3600)).length, 1);
});
