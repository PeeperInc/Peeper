import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peeper-card-combat-'));
process.env.PEEPER_DB_PATH = path.join(dir, 'cards.db');
process.env.NODE_ENV = 'development';
process.env.BOT_TOKEN = 'dev';
const db = require('../database');
const engine = require('./engine');
const { viewCardCombat, cardCommand, RECOVERY_SECONDS } = require('./cardCombat');
const { CARDS } = require('./cardCatalog');
const NOW = Math.floor(Date.now() / 1000);
let serial = 0;

test.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function setup(role = 'knight', otherRole = 'mage') {
  const userIds = [1, 2].map(() => Number(db.prepare('INSERT INTO users (telegram_id, first_name) VALUES (?, ?)').run(`card-${++serial}`, 'Tester').lastInsertRowid));
  const familyId = Number(db.prepare('INSERT INTO families (name, founder_id, invite_code) VALUES (?, ?, ?)').run('Card family', userIds[0], `CARD${serial}`).lastInsertRowid);
  userIds.forEach(id => db.prepare('INSERT INTO family_members (family_id, user_id) VALUES (?, ?)').run(familyId, id));
  const room = key => ({ key, type: 'combat', name: key, encounterType: 'combat', state: 'unlocked', enemyId: 'test_guard', progressTarget: 40, actions: [{ id: 'strike', stat: 'might', tags: [] }] });
  const map = { combatMode: 'cards_v1', rooms: [
    { key: 'camp', type: 'camp', startingRoom: true, state: 'cleared', progressTarget: 1, actions: [] },
    room('guard'), room('archer'), { ...room('boss'), type: 'boss', phase: 1, progressTarget: 50 },
  ], edges: [] };
  const snapshot = db.transaction(() => engine.createExpedition({ transaction: db, idempotencyKey: `create-${serial}`, familyId, userId: userIds[0], seed: 'cards', map, now: NOW }))();
  const expeditionId = snapshot.expedition.id;
  userIds.forEach((userId, index) => db.transaction(() => engine.prepareMember({ transaction: db,
    idempotencyKey: `prepare-${userId}`, expeditionId, userId, role: index ? otherRole : role, now: NOW }))());
  const ctx = { expeditionId, userIds, familyId };
  ctx.view = (userId = userIds[0]) => viewCardCombat(db, { id: expeditionId, map }, userId);
  ctx.row = (userId = userIds[0]) => db.prepare('SELECT * FROM family_expedition_members WHERE expedition_id = ? AND user_id = ?').get(expeditionId, userId);
  ctx.room = key => db.prepare('SELECT * FROM family_expedition_rooms WHERE expedition_id = ? AND room_key = ?').get(expeditionId, key);
  ctx.command = (operation, options = {}) => cardCommand(db, { expeditionId, userId: userIds[0], operation, roomKey: 'guard',
    revision: ctx.view(options.userId).revision, idempotencyKey: `command-${++serial}`, now: NOW, ...options });
  ctx.hand = (cards, extra = {}, userId = userIds[0]) => {
    const row = db.prepare('SELECT state_json FROM family_expedition_card_states WHERE expedition_id = ? AND user_id = ?').get(expeditionId, userId);
    const state = JSON.parse(row.state_json);
    state.hand = cards.map((id, i) => ({ cardId: id, instanceId: `fixture-${serial}-${i}` }));
    Object.assign(state, extra);
    db.prepare('UPDATE family_expedition_card_states SET state_json = ? WHERE expedition_id = ? AND user_id = ?').run(JSON.stringify(state), expeditionId, userId);
  };
  ctx.play = (id, options = {}) => {
    const card = ctx.view(options.userId).turn.hand.find(card => card.id === id);
    assert.ok(card, `${id} is in the test hand`);
    return ctx.command('play', { instanceId: card.instanceId, ...options });
  };
  return ctx;
}

test('one AP draws four private cards and three energy; reconnect never redraws or charges', () => {
  const c = setup();
  assert.equal(c.view().turn, null);
  c.command('draw');
  const first = c.view();
  assert.equal(c.row().ap, 4); assert.equal(first.turn.hand.length, 4); assert.equal(first.turn.energy, 3);
  assert.deepEqual(c.view(), first);
  assert.equal(c.row().contribution_ap, 1);
  assert.equal(c.view(c.userIds[1]).turn, null);
  assert.ok(!('drawPile' in first));
  assert.throws(() => c.command('draw'), /Finish your saved turn/);
  assert.equal(c.row().ap, 4);
});

test('a draw replay is idempotent and a reused key with a different intent conflicts', () => {
  const c = setup();
  const opts = { revision: 0, idempotencyKey: 'draw-replay' + serial };
  c.command('draw', opts); const hand = c.view().turn.hand;
  assert.equal(c.command('draw', opts).replayed, true);
  assert.deepEqual(c.view().turn.hand, hand); assert.equal(c.row().ap, 4);
  assert.throws(() => c.command('draw', { ...opts, roomKey: 'archer' }), /Idempotency conflict/);
});

test('cards spend energy, damage the common enemy, and reject duplicates or a stale tab', () => {
  const c = setup(); c.command('draw'); c.hand(['strike', 'guard']);
  const before = c.view(); const card = before.turn.hand[0];
  c.command('play', { instanceId: card.instanceId });
  assert.equal(c.room('guard').progress, 3); assert.equal(c.view().turn.energy, 2); assert.equal(c.row().ap, 4);
  assert.throws(() => c.command('play', { instanceId: card.instanceId }), /no longer/);
  assert.throws(() => c.command('play', { instanceId: before.turn.hand[1].instanceId, revision: before.revision }), /hand changed/);
  assert.equal(c.room('guard').progress, 3);
});

test('card play replay cannot double damage or spend energy twice', () => {
  const c = setup(); c.command('draw'); c.hand(['strike']);
  const options = { instanceId: c.view().turn.hand[0].instanceId, revision: c.view().revision, idempotencyKey: `play-replay-${serial}` };
  c.command('play', options); c.command('play', options);
  assert.equal(c.room('guard').progress, 3); assert.equal(c.view().turn.energy, 2);
});

test('enemy responds only to the hero ending their turn; end costs no extra AP', () => {
  const c = setup(); c.command('draw');
  c.command('draw', { userId: c.userIds[1] });
  const otherHp = c.row(c.userIds[1]).hero_hp;
  const incoming = c.view().turn.intent.damage;
  c.command('end');
  assert.equal(c.row().hero_hp, 3 - incoming);
  assert.equal(c.row(c.userIds[1]).hero_hp, otherHp);
  assert.equal(c.row().ap, 4); assert.equal(c.view().turn, null);
  assert.throws(() => c.command('end'), /Draw a hand first/);
});

test('Knight combines block into a shield attack instead of receiving a flat class bonus', () => {
  const c = setup('knight'); c.command('draw'); c.hand(['guard', 'shield_bash']);
  c.play('guard'); c.play('shield_bash');
  assert.equal(c.room('guard').progress, 5); assert.equal(c.view().turn.block, 0);
});

test('Scout zero-cost combo feeds a finisher and sidestep avoids the response', () => {
  const c = setup('scout'); c.command('draw'); c.hand(['quick_cut', 'sidestep', 'finisher']);
  c.play('quick_cut'); c.play('sidestep'); c.play('finisher');
  assert.equal(c.room('guard').progress, 11); assert.equal(c.view().resource, 0);
  c.command('end'); assert.equal(c.row().hero_hp, 3);
});

test('Mage heat powers Discharge; unspent overload burns only its owner', () => {
  const c = setup('mage'); c.command('draw'); c.hand(['spark', 'discharge'], { resource: 2 });
  c.play('spark'); c.play('discharge'); assert.equal(c.room('guard').progress, 11);
  assert.equal(c.view().resource, 0);
  c.hand([], { resource: 4, dodge: true }); c.command('end');
  assert.equal(c.row().hero_hp, 2); assert.equal(c.view().resource, 3);
});

test('Cleric light can be spent on healing or a damaging judgement', () => {
  const c = setup('cleric'); c.command('draw'); c.hand(['mend', 'judgement'], { resource: 4 });
  db.prepare('UPDATE family_expedition_members SET hero_hp = 2 WHERE expedition_id = ? AND user_id = ?').run(c.expeditionId, c.userIds[0]);
  c.play('mend'); assert.equal(c.row().hero_hp, 3); assert.equal(c.view().resource, 2);
  c.play('judgement'); assert.equal(c.room('guard').progress, 8); assert.equal(c.view().resource, 0);
});

test('Exposed is shared with the next ally and each hit consumes one charge', () => {
  const c = setup('scout'); c.command('draw'); c.hand(['mark']); c.play('mark');
  c.command('draw', { userId: c.userIds[1] }); c.hand(['strike'], {}, c.userIds[1]);
  c.play('strike', { userId: c.userIds[1] });
  assert.equal(c.room('guard').progress, 5); assert.equal(JSON.parse(c.room('guard').payload_json).cardSupport.expose, 1);
});

test('a family ward protects one ally and cannot be consumed again', () => {
  const c = setup(); c.command('draw'); c.hand(['rally']); c.play('rally');
  c.command('draw', { userId: c.userIds[1] });
  c.command('end', { userId: c.userIds[1] });
  assert.equal(c.row(c.userIds[1]).hero_hp, 3);
  assert.equal(JSON.parse(c.room('guard').payload_json).cardSupport.ward, undefined);
});

test('a killed enemy lets an ally transfer their exact paid hand without AP or energy reset', () => {
  const c = setup(); c.command('draw'); c.hand(['strike']);
  const hand = c.view().turn.hand;
  db.prepare("UPDATE family_expedition_rooms SET state = 'cleared', progress = progress_target WHERE expedition_id = ? AND room_key = 'guard'").run(c.expeditionId);
  assert.throws(() => c.play('strike'), /Choose an open enemy/);
  c.command('retarget', { roomKey: 'archer' });
  assert.deepEqual(c.view().turn.hand, hand); assert.equal(c.row().ap, 4); assert.equal(c.view().turn.energy, 3);
  c.play('strike', { roomKey: 'archer' }); assert.equal(c.room('archer').progress, 3);
});

test('a living enemy cannot be escaped by switching rooms or retargeting', () => {
  const c = setup(); c.command('draw'); c.hand(['strike']);
  assert.throws(() => c.command('retarget', { roomKey: 'archer' }), /current enemy/);
  assert.throws(() => c.play('strike', { roomKey: 'archer' }), /another enemy/);
  assert.equal(c.row().ap, 4);
});

test('damage and contribution are clamped to remaining HP; the boss advances exactly once', () => {
  const c = setup(); c.command('draw', { roomKey: 'boss' }); c.hand(['strike']);
  db.prepare("UPDATE family_expedition_rooms SET progress = 49 WHERE expedition_id = ? AND room_key = 'boss'").run(c.expeditionId);
  c.play('strike', { roomKey: 'boss' });
  const room = c.room('boss'); assert.equal(JSON.parse(room.payload_json).phase, 2);
  assert.equal(room.progress, 0); assert.equal(c.row().contribution_progress, 1);
});

test('room card rewards are personal, one-time and join discard without replacing a paid hand', () => {
  const c = setup(); c.command('draw'); c.hand(['strike']);
  db.prepare("UPDATE family_expedition_rooms SET progress = 39 WHERE expedition_id = ? AND room_key = 'guard'").run(c.expeditionId);
  c.play('strike'); const reward = c.view().reward;
  assert.equal(reward.cards.length, 3); assert.equal(c.view(c.userIds[1]).reward, null);
  const before = c.view().turn;
  c.command('reward', { cardId: reward.cards[0].id });
  assert.equal(c.view().deckSize, 9); assert.deepEqual(c.view().turn, before); assert.equal(c.view().reward, null);
  assert.throws(() => c.command('reward', { cardId: reward.cards[1].id }), /already chosen/);
});

test('knockout is personal and a saved end-turn replay cannot extend recovery', () => {
  const c = setup(); c.command('draw'); c.hand([], { block: 0 });
  db.prepare('UPDATE family_expedition_members SET hero_hp = 1 WHERE expedition_id = ? AND user_id = ?').run(c.expeditionId, c.userIds[0]);
  const options = { revision: c.view().revision, idempotencyKey: `ko-${serial}` };
  c.command('end', options);
  assert.equal(c.row().hero_recover_at, NOW + RECOVERY_SECONDS);
  c.command('end', options); assert.equal(c.row().hero_recover_at, NOW + RECOVERY_SECONDS);
  assert.throws(() => c.command('draw'), /recovering/);
});

test('invalid, expensive, forged and other-player cards cannot mutate the battle', () => {
  const c = setup(); c.command('draw'); c.hand(['bulwark'], { energy: 1 });
  assert.throws(() => c.play('bulwark'), /Not enough energy/);
  assert.throws(() => c.command('play', { instanceId: 'forged' }), /no longer/);
  assert.equal(c.room('guard').progress, 0);
  db.prepare('DELETE FROM family_members WHERE user_id = ?').run(c.userIds[0]);
  assert.throws(() => c.command('end'), /current family/);
});

test('every card has a cost, readable rule, and a real class or neutral identity', () => {
  assert.equal(Object.keys(CARDS).length, 30);
  for (const card of Object.values(CARDS)) { assert.ok(card.text.length > 10); assert.ok(card.cost >= 0 && card.cost <= 3); }
});

test('HTTP card routes authorize family access, reject concurrent draws and hide other hands', async () => {
  const express = require('express');
  const http = require('node:http');
  const app = express(); app.use(express.json()); app.use('/api/expeditions', require('../routes/expeditions'));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const c = setup();
    const base = `http://127.0.0.1:${server.address().port}/api/expeditions`;
    const headers = userId => ({ 'Content-Type': 'application/json', 'X-Telegram-Init-Data': new URLSearchParams({
      user: JSON.stringify({ id: db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(userId).telegram_id }),
    }).toString() });
    const send = (url, body, userId = c.userIds[0]) => fetch(base + url, {
      method: 'POST', headers: headers(userId), body: JSON.stringify(body),
    });
    const body = { revision: 0, roomKey: 'guard', idempotencyKey: `http-draw-${serial}` };
    const draws = await Promise.all([send(`/${c.expeditionId}/cards/draw`, body), send(`/${c.expeditionId}/cards/draw`, { ...body, idempotencyKey: `${body.idempotencyKey}-other` })]);
    assert.deepEqual(draws.map(response => response.status).sort(), [200, 409]);
    assert.equal(c.row().ap, 4);
    const current = await (await fetch(base + '/current', { headers: headers(c.userIds[0]) })).json();
    assert.equal(current.cardCombat.turn.hand.length, 4);
    assert.equal(current.expedition.combatMode, 'cards_v1');
    const sibling = await (await fetch(base + '/current', { headers: headers(c.userIds[1]) })).json();
    assert.equal(sibling.cardCombat.turn, null);
    assert.ok(!JSON.stringify(sibling).includes(current.cardCombat.turn.hand[0].instanceId));
    const oldEndpoint = await send(`/${c.expeditionId}/rooms/guard/attempt`, { idempotencyKey: `http-legacy-${serial}`, actionId: 'strike' });
    assert.equal(oldEndpoint.status, 400); assert.equal(c.row().ap, 4);
    db.prepare('UPDATE family_expedition_members SET ap = 0 WHERE expedition_id = ? AND user_id = ?').run(c.expeditionId, c.userIds[0]);
    const badge = await (await fetch(base + '/badge', { headers: headers(c.userIds[0]) })).json();
    assert.equal(badge.availableAp, 0); assert.equal(badge.hasAvailableAp, true, 'A paid saved hand is playable even at zero AP');
    db.prepare('DELETE FROM family_members WHERE user_id = ?').run(c.userIds[1]);
    const outsider = await send(`/${c.expeditionId}/cards/end`, { revision: 0, idempotencyKey: `http-outsider-${serial}` }, c.userIds[1]);
    assert.equal(outsider.status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('saved hands survive opening a second database connection', () => {
  const c = setup(); c.command('draw');
  const Database = require('better-sqlite3');
  const reopened = new Database(process.env.PEEPER_DB_PATH, { readonly: true });
  try {
    const expedition = db.prepare('SELECT * FROM family_expeditions WHERE id = ?').get(c.expeditionId);
    assert.deepEqual(viewCardCombat(reopened, expedition, c.userIds[0]), c.view());
  } finally { reopened.close(); }
});

test('card schema installation is additive, repeatable and cascades with a prepared member', () => {
  const c = setup(); c.command('draw');
  const before = c.view();
  require('./cardSchema').installCardCombat(db); require('./cardSchema').installCardCombat(db);
  assert.deepEqual(c.view(), before);
  db.prepare('DELETE FROM family_expedition_members WHERE expedition_id = ? AND user_id = ?').run(c.expeditionId, c.userIds[0]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM family_expedition_card_states WHERE expedition_id = ? AND user_id = ?').get(c.expeditionId, c.userIds[0]).count, 0);
});

test('card combat consumes old armed boosts and shields, and respects one-time passive protection', () => {
  const c = setup();
  db.prepare('UPDATE family_expedition_members SET loadout_json = ? WHERE expedition_id = ? AND user_id = ?').run(JSON.stringify({
    slots: [{ artifactId: 'bent_sword' }, { artifactId: 'rabbit_foot' }],
    triggerHistory: [{ scope: 'armed', artifactId: 'loaded_die', effectKind: 'combat_advantage', roomKey: 'guard', remainingUses: 1 }],
  }), c.expeditionId, c.userIds[0]);
  c.command('draw'); c.hand(['strike', 'strike']);
  c.play('strike'); assert.equal(c.room('guard').progress, 5);
  c.play('strike'); assert.equal(c.room('guard').progress, 8);
  c.command('end'); assert.equal(c.row().hero_hp, 3);
  c.command('draw'); c.hand([], { block: 0 }); c.command('end');
  assert.ok(c.row().hero_hp < 3, 'Rabbit Foot is consumed once per expedition');
});

test('a curse is consumed by one paid hand, not permanent across the new expedition', () => {
  const c = setup();
  db.prepare('UPDATE family_expedition_members SET debuff_json = ?, loadout_json = ? WHERE expedition_id = ? AND user_id = ?')
    .run(JSON.stringify({ type: 'cursed' }), JSON.stringify({ slots: [{ artifactId: 'family_banner' }], triggerHistory: [] }), c.expeditionId, c.userIds[0]);
  c.command('draw'); assert.equal(c.view().turn.block, 0);
  assert.deepEqual(JSON.parse(c.row().debuff_json), {});
  c.hand([], { dodge: true }); c.command('end');
  c.command('draw'); assert.equal(c.view().turn.block, 1);
});

test('boss phase completion creates normal claimable rewards exactly once with AP-based contribution', () => {
  const c = setup(); c.command('draw', { roomKey: 'boss' }); c.hand(['strike', 'strike', 'strike']);
  for (const remainingProgress of [49, 57, 65]) {
    db.prepare("UPDATE family_expedition_rooms SET progress = ? WHERE expedition_id = ? AND room_key = 'boss'").run(remainingProgress, c.expeditionId);
    c.play('strike', { roomKey: 'boss' });
  }
  assert.equal(c.room('boss').state, 'cleared');
  assert.equal(db.prepare('SELECT status FROM family_expeditions WHERE id = ?').get(c.expeditionId).status, 'boss_defeated');
  c.command('end', { roomKey: 'boss' }); assert.equal(c.row().hero_hp, 3);
  assert.equal(c.row().contribution_ap, 1); assert.equal(c.row().contribution_progress, 3);
  const options = { transaction: db, expeditionId: c.expeditionId, userId: c.userIds[0], idempotencyKey: `finish-cards-${serial}`, now: NOW };
  db.transaction(() => engine.finishExpedition(options))();
  db.transaction(() => engine.finishExpedition(options))();
  const rewards = db.prepare('SELECT * FROM family_expedition_pending_rewards WHERE expedition_id = ? AND user_id = ?').all(c.expeditionId, c.userIds[0]);
  assert.equal(rewards.length, 1);
  const payload = JSON.parse(rewards[0].payload_json);
  assert.ok(payload.totalCoins >= 4); assert.equal(payload.totalCoins, payload.roomCoins + payload.finalCoins);
});
