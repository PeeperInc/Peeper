import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peeper-card-balance-'));
process.env.PEEPER_DB_PATH = path.join(dir, 'balance.db');
process.env.NODE_ENV = 'development';
process.env.BOT_TOKEN = 'dev';
const db = require('../database');
const engine = require('./engine');
const { generateExpeditionMap, validateExpeditionMap } = require('./generator');
const { ROOM_TEMPLATES } = require('./catalog');
const { CARD_ENEMY_HP, CARD_BOSS_PHASE_HP, balanceCardMap } = require('./cardBalance');
let serial = 0;
const now = Math.floor(Date.now() / 1000);
test.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function setup(cardMode = true) {
  const userId = Number(db.prepare('INSERT INTO users(telegram_id,first_name)VALUES(?,?)').run(`balance-${++serial}`, 'Scout').lastInsertRowid);
  const familyId = Number(db.prepare('INSERT INTO families(name,founder_id,invite_code)VALUES(?,?,?)').run('Balance', userId, `BAL${serial}`).lastInsertRowid);
  db.prepare('INSERT INTO family_members(family_id,user_id)VALUES(?,?)').run(familyId, userId);
  const map = generateExpeditionMap(`balance:${serial}`);
  if (cardMode) map.combatMode = 'cards_v1';
  const options = { transaction: db, userId, familyId, map, now, seed: 'balance', idempotencyKey: `create-${serial}` };
  const snapshot = db.transaction(() => engine.createExpedition(options))();
  return { snapshot, userId, expeditionId: snapshot.expedition.id, map, options };
}

test('generated card encounters and Scout previews use the same HP without mutating legacy templates', () => {
  const c = setup();
  for (const room of c.snapshot.rooms) {
    if (room.type === 'combat') assert.equal(room.progressTarget, CARD_ENEMY_HP[room.enemyId]);
    if (room.type === 'boss') assert.equal(room.progressTarget, CARD_BOSS_PHASE_HP[0]);
    for (const choice of room.scoutChoices || []) {
      if (choice.room.type === 'combat') assert.equal(choice.room.progressTarget, CARD_ENEMY_HP[choice.room.enemyId]);
    }
  }
  const stored = JSON.parse(db.prepare('SELECT map_json FROM family_expeditions WHERE id=?').get(c.expeditionId).map_json);
  assert.deepEqual(stored, c.snapshot.expedition.map);
  assert.deepEqual(validateExpeditionMap(c.map), []);
  assert.equal(ROOM_TEMPLATES.combat[0].progressTarget, 34);
  assert.equal(ROOM_TEMPLATES.boss[0].progressTarget, 50);
  assert.deepEqual(balanceCardMap({ rooms: c.map.rooms }), { rooms: c.map.rooms });
});

test('updating an existing card run preserves damage, cleared rooms and boss phase; repeated reads do not rewrite rows', () => {
  const c = setup(), room = c.snapshot.rooms.find(room => room.type === 'combat');
  const cleared = c.snapshot.rooms.filter(room => room.type === 'combat')[1];
  db.prepare("UPDATE family_expedition_rooms SET state='unlocked',progress=15,progress_target=34 WHERE id=?").run(room.id);
  db.prepare("UPDATE family_expedition_rooms SET state='cleared',progress=34,progress_target=34,cleared_at=? WHERE id=?").run(now, cleared.id);
  const boss = c.snapshot.rooms.find(room => room.type === 'boss');
  const payload = JSON.parse(db.prepare('SELECT payload_json FROM family_expedition_rooms WHERE id=?').get(boss.id).payload_json);
  db.prepare('UPDATE family_expedition_rooms SET progress=7,progress_target=58,payload_json=? WHERE id=?').run(JSON.stringify({ ...payload, phase: 2 }), boss.id);
  engine.syncExpeditionRoomBalance(db, c.expeditionId);
  const rows = db.prepare('SELECT * FROM family_expedition_rooms WHERE expedition_id=? ORDER BY id').all(c.expeditionId);
  assert.equal(rows.find(row => row.id === room.id).progress, 15);
  assert.equal(rows.find(row => row.id === room.id).progress_target, CARD_ENEMY_HP[room.enemyId]);
  assert.equal(rows.find(row => row.id === cleared.id).state, 'cleared');
  assert.equal(rows.find(row => row.id === cleared.id).cleared_at, now);
  assert.equal(rows.find(row => row.id === cleared.id).progress, CARD_ENEMY_HP[cleared.enemyId]);
  assert.equal(rows.find(row => row.id === boss.id).progress_target, CARD_BOSS_PHASE_HP[1]);
  assert.equal(rows.find(row => row.id === boss.id).progress, 7);
  const before = db.prepare('SELECT total_changes() AS n').get().n;
  engine.syncExpeditionRoomBalance(db, c.expeditionId);
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before);
});

test('legacy encounters keep dice HP and completed expeditions keep their historical results', () => {
  const legacy = setup(false);
  for (const room of legacy.snapshot.rooms.filter(room => room.type === 'combat')) {
    assert.equal(room.progressTarget, ROOM_TEMPLATES.combat.find(template => template.enemyId === room.enemyId).progressTarget);
  }
  const c = setup(), room = c.snapshot.rooms.find(room => room.type === 'combat');
  db.prepare("UPDATE family_expeditions SET status='finished' WHERE id=?").run(c.expeditionId);
  db.prepare('UPDATE family_expedition_rooms SET progress=9,progress_target=34 WHERE id=?').run(room.id);
  const historical = db.transaction(() => engine.createExpedition(c.options))().rooms.find(candidate => candidate.id === room.id);
  assert.equal(historical.progressTarget, 34); assert.equal(historical.progress, 9);
});

test('choosing a combat route as Scout keeps the displayed HP when the room is installed', () => {
  const c = setup();
  db.transaction(() => engine.prepareMember({ transaction: db, expeditionId: c.expeditionId, userId: c.userId,
    role: 'scout', now, idempotencyKey: `prepare-${++serial}` }))();
  const source = c.snapshot.rooms.find(room => room.type === 'camp');
  const choice = source.scoutChoices.find(choice => choice.room.type === 'combat');
  assert.ok(choice, 'Camp offers a combat route');
  const result = db.transaction(() => engine.chooseScoutRoom({ transaction: db, expeditionId: c.expeditionId,
    userId: c.userId, fromRoomKey: source.key, choiceId: choice.id, now, idempotencyKey: `choose-${++serial}` }))();
  const selected = result.rooms.find(room => room.key === choice.targetKey);
  assert.equal(selected.enemyId, choice.room.enemyId);
  assert.equal(selected.progressTarget, choice.room.progressTarget);
  assert.equal(selected.progressTarget, CARD_ENEMY_HP[selected.enemyId]);
});
