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
const { CARDS, CLASS_RULES, starterDeck } = require('./cardCatalog');
const { CARD_BOSS_PHASE_HP } = require('./cardBalance');
const { CARD_ARTIFACTS, CARD_PROVISIONS } = require('./cardSupplies');
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

function supplies(c, { food, relics = [], hp = 3, ap = 5 } = {}) {
  db.prepare(`UPDATE family_expedition_members SET provision_id=?, provision_state_json=?, loadout_json=?, hero_hp=?, ap=?
    WHERE expedition_id=? AND user_id=?`).run(food || null, JSON.stringify(food ? { available:true, used:false } : {}),
    JSON.stringify({ slots:relics.map(artifactId=>({artifactId})), triggerHistory:[] }),hp,ap,c.expeditionId,c.userIds[0]);
  c.eat = (options={}) => db.transaction(()=>engine.useProvisionForMember({transaction:db,expeditionId:c.expeditionId,
    userId:c.userIds[0],roomKey:'guard',now:NOW,idempotencyKey:`meal-${++serial}`,...options}))();
  c.relic = (artifactId,options={}) => db.transaction(()=>engine.useArtifactForMember({transaction:db,expeditionId:c.expeditionId,
    userId:c.userIds[0],roomKey:'guard',artifactId,now:NOW,idempotencyKey:`relic-${++serial}`,...options}))();
}

function makeTrial(c) {
  const row=c.room('archer'); const payload=JSON.parse(row.payload_json);
  Object.assign(payload,{type:'treasure',encounterType:'treasure',miniGame:{kind:'timing_window'}});
  db.prepare("UPDATE family_expedition_rooms SET room_type='treasure', progress_target=4, payload_json=? WHERE id=?")
    .run(JSON.stringify(payload),row.id);
}

test('card preparation covers every existing inventory ID with current descriptions and explicit scope',()=>{
  const {ARTIFACTS,PROVISIONS}=require('./catalog');
  assert.deepEqual(Object.keys(CARD_ARTIFACTS),Object.keys(ARTIFACTS));
  assert.deepEqual(Object.keys(CARD_PROVISIONS),Object.keys(PROVISIONS));
  for(const item of Object.values(CARD_ARTIFACTS)) {
    assert.ok(item.category); assert.ok(item.useHint);
    assert.doesNotMatch(item.displayEffect,/natural 20|cooldown|d6|rolls 16|class ability/i);
  }
});

test('carrot restores two AP with a cap, safely replays, and never counts restored AP as contribution',()=>{
  const c=setup();supplies(c,{food:'carrot_rations',ap:0});
  const key=`carrot-${serial}`;c.eat({idempotencyKey:key});c.eat({idempotencyKey:key});
  assert.equal(c.row().ap,2);assert.equal(c.row().contribution_ap,0);
  assert.throws(()=>c.eat(),/already used/);
  const capped=setup();supplies(capped,{food:'carrot_rations',ap:4});capped.eat();assert.equal(capped.row().ap,5);
  const full=setup();supplies(full,{food:'carrot_rations'});assert.throws(()=>full.eat(),/already full/);
  assert.equal(JSON.parse(full.row().provision_state_json).available,true);
});

test('soup fully heals mid-hand, invalidates stale card actions, and cannot revive',()=>{
  const c=setup();supplies(c,{food:'tomato_soup',hp:1});c.command('draw');c.hand(['strike']);
  const before=c.view();c.eat();assert.equal(c.row().hero_hp,3);assert.equal(c.view().revision,before.revision+1);
  assert.throws(()=>c.command('play',{instanceId:before.turn.hand[0].instanceId,revision:before.revision}),/hand changed/);
  assert.equal(c.row().ap,4);
  const ko=setup();supplies(ko,{food:'tomato_soup',hp:0});
  db.prepare('UPDATE family_expedition_members SET hero_recover_at=? WHERE expedition_id=? AND user_id=?').run(NOW+600,ko.expeditionId,ko.userIds[0]);
  assert.throws(()=>ko.eat(),/recover|knocked/i);assert.equal(JSON.parse(ko.row().provision_state_json).available,true);
});

test('breakfast draws into the saved hand without spending AP, respects eight-card cap and survives reconnect',()=>{
  const c=setup();supplies(c,{food:'lucky_breakfast'});assert.throws(()=>c.eat(),/Draw a hand/);
  c.command('draw');c.hand(['strike',...Array(6).fill('guard')],{drawPile:['shield_throw','bulwark'],discard:[]});
  const previous=c.view().turn.hand.map(card=>card.instanceId);c.eat();const view=c.view();
  assert.equal(view.turn.hand.length,8);assert.deepEqual(view.turn.hand.slice(0,7).map(card=>card.instanceId),previous);
  assert.equal(c.row().ap,4);assert.deepEqual(c.view().turn,view.turn);
  const full=setup();supplies(full,{food:'lucky_breakfast'});full.command('draw');full.hand(Array(8).fill('strike'));
  assert.throws(()=>full.eat(),/full/);assert.equal(JSON.parse(full.row().provision_state_json).available,true);
});

test('milk adds energy for any class without restoring obsolete role charges, and rejects full energy',()=>{
  for(const role of Object.keys(CLASS_RULES)) {
    const c=setup(role);supplies(c,{food:'warm_milk'});c.command('draw');c.eat();
    assert.equal(c.view().turn.energy,4);assert.equal(c.row().ap,4);assert.equal(c.row().role_charge,1);
  }
  const c=setup();supplies(c,{food:'warm_milk'});c.command('draw');c.hand(['strike'],{energy:6});
  assert.throws(()=>c.eat(),/full/);assert.equal(JSON.parse(c.row().provision_state_json).available,true);
});

test('potato grants block only to new hands in its own room; no immediate block or damage bonus',()=>{
  const c=setup();supplies(c,{food:'hearty_potato_meal'});c.command('draw');c.hand(['strike'],{block:0,dodge:true});
  c.eat();assert.equal(c.view().turn.block,0);c.play('strike');assert.equal(c.room('guard').progress,3);
  c.command('end');c.command('draw');assert.equal(c.view().turn.block,1);
  c.hand([],{dodge:true});c.command('end');c.command('draw',{roomKey:'archer'});assert.equal(c.view().turn.block,0);
});

test('pie boosts only the first damaging card per paid hand, including across a free carry',()=>{
  const c=setup();supplies(c,{food:'magic_squash_pie'});c.command('draw');c.eat();
  c.hand(['standfast','strike','strike'],{drawPile:[],discard:[]});c.play('standfast');c.play('strike');c.play('strike');
  assert.equal(c.room('guard').progress,7);
  c.hand(['strike'],{energy:1});db.prepare("UPDATE family_expedition_rooms SET state='cleared' WHERE id=?").run(c.room('guard').id);
  c.command('retarget',{roomKey:'archer'});c.play('strike',{roomKey:'archer'});assert.equal(c.room('archer').progress,3);
  c.hand([],{dodge:true});c.command('end',{roomKey:'archer'});c.command('draw',{roomKey:'archer'});c.hand(['strike']);
  c.play('strike',{roomKey:'archer'});assert.equal(c.room('archer').progress,7);
});

test('previously eaten damage meals use current card rules instead of keeping old per-card bonuses',()=>{
  const c=setup();supplies(c,{food:'magic_squash_pie'});
  db.prepare('UPDATE family_expedition_members SET provision_state_json=? WHERE expedition_id=? AND user_id=?')
    .run(JSON.stringify({used:true,available:false,damageBonus:{amount:3,persistent:true}}),c.expeditionId,c.userIds[0]);
  c.command('draw');c.hand(['strike','strike']);c.play('strike');c.play('strike');assert.equal(c.room('guard').progress,7);
});

test('Bone Die and Loaded Die apply meaningful one-use card damage and remain usable mid-hand',()=>{
  for(const [id,expected] of [['bone_die',5],['loaded_die',6]]) {
    const c=setup();supplies(c,{relics:[id]});c.command('draw');c.hand(['strike','strike']);
    const key=`armed-${serial}`;c.relic(id,{idempotencyKey:key});c.relic(id,{idempotencyKey:key});
    c.play('strike');assert.equal(c.room('guard').progress,expected);c.play('strike');assert.equal(c.room('guard').progress,expected+3);
    assert.equal(c.row().ap,4);assert.throws(()=>c.relic(id),/not equipped/);
  }
  const c=setup();supplies(c,{relics:['fates_broken_die']});c.command('draw');c.relic('fates_broken_die');
  c.hand(['strike','strike','strike','strike'],{energy:6});for(let i=0;i<4;i++)c.play('strike');assert.equal(c.room('guard').progress,21);
});

test('Campfire recovers the chosen card at its normal cost, is replay safe, and rejects stale choices without consuming',()=>{
  const c=setup();supplies(c,{relics:['campfire_charm']});c.command('draw');c.hand(['strike'],{discard:['bulwark','shield_throw'],drawPile:[]});
  const revision=c.view().revision;const options={cardId:'bulwark',cardRevision:revision,idempotencyKey:`recover-${serial}`};
  assert.throws(()=>c.relic('campfire_charm',{...options,cardRevision:revision-1}),/hand changed/);
  assert.equal(JSON.parse(c.row().loadout_json).slots[0].artifactId,'campfire_charm');
  c.relic('campfire_charm',options);c.relic('campfire_charm',options);
  const hand=c.view().turn.hand;assert.deepEqual(hand.map(card=>card.id),['strike','bulwark']);assert.equal(hand[1].cost,2);
  assert.deepEqual(c.view().discardChoices.map(card=>card.id),['shield_throw']);c.play('bulwark');
  assert.equal(c.view().turn.energy,1);assert.equal(c.row().ap,4);
});

test('Campfire cannot be wasted before a hand, with an empty discard or a full hand',()=>{
  const c=setup();supplies(c,{relics:['campfire_charm']});assert.throws(()=>c.relic('campfire_charm'),/Draw a hand/);
  c.command('draw');c.hand(['strike'],{discard:[]});assert.throws(()=>c.relic('campfire_charm'),/discard is empty/);
  c.hand(Array(8).fill('strike'),{discard:['guard']});assert.throws(()=>c.relic('campfire_charm'),/full/);
  assert.equal(JSON.parse(c.row().loadout_json).slots[0].artifactId,'campfire_charm');
});

test('Wooden Shield updates the real response forecast mid-hand and is saved if block already stops the hit',()=>{
  const c=setup();supplies(c,{relics:['wooden_shield']});c.command('draw');c.hand([],{block:0});
  c.relic('wooden_shield');assert.equal(c.view().turn.response.damage,0);assert.equal(c.view().turn.response.reason,'relic');
  c.hand([],{block:6});c.command('end');assert.equal(JSON.parse(c.row().loadout_json).triggerHistory.length,1);
  c.command('draw');c.hand([],{block:0});c.command('end');assert.equal(c.row().hero_hp,3);
  assert.equal(JSON.parse(c.row().loadout_json).triggerHistory.length,0);
});

test('Warding Nail shields another family member, while personal Ration Box, Hourglass and Phoenix keep their recovery roles',()=>{
  const c=setup();supplies(c,{relics:['warding_nail','ration_box','hourglass_shard'],hp:1,ap:2});
  c.command('draw');c.relic('ration_box');assert.equal(c.row().hero_hp,2);c.relic('hourglass_shard');assert.equal(c.row().ap,3);
  c.relic('warding_nail');c.command('draw',{userId:c.userIds[1]});c.hand([],{block:0},c.userIds[1]);
  assert.equal(c.view(c.userIds[1]).turn.response.reason,'room_shield');c.command('end',{userId:c.userIds[1]});assert.equal(c.row(c.userIds[1]).hero_hp,3);
  const ko=setup();supplies(ko,{relics:['phoenix_feather'],hp:0});
  db.prepare('UPDATE family_expedition_members SET hero_recover_at=? WHERE expedition_id=? AND user_id=?').run(NOW+600,ko.expeditionId,ko.userIds[0]);
  ko.relic('phoenix_feather');assert.equal(ko.row().hero_hp,3);assert.equal(ko.row().hero_recover_at,null);
});

test('trial relics are scoped to trials and shovel cannot bypass card combat or a running trial',()=>{
  const c=setup();supplies(c,{relics:['tiny_shovel','chalk_rune','rusty_lockpick']});makeTrial(c);
  assert.throws(()=>c.relic('tiny_shovel'),/noncombat trials/);assert.equal(c.room('guard').progress,0);
  c.relic('tiny_shovel',{roomKey:'archer'});assert.equal(c.room('archer').progress,2);
  c.relic('chalk_rune',{roomKey:'archer'});c.relic('rusty_lockpick',{roomKey:'archer'});
  const history=JSON.parse(c.row().loadout_json).triggerHistory;
  assert.ok(history.some(entry=>entry.effectKind==='minigame_time_once'));
  assert.ok(history.some(entry=>entry.effectKind==='minigame_auto_success'));
  const trialOptions=ctx=>({transaction:db,expeditionId:ctx.expeditionId,userId:ctx.userIds[0],roomKey:'archer',now:NOW,idempotencyKey:`trial-${++serial}`});
  const started=db.transaction(()=>engine.startMinigameAttempt(trialOptions(c)))();
  assert.equal(started.attempt.expiresAt-started.attempt.startedAt,15);
  const finished=db.transaction(()=>engine.finishMinigameAttempt({...trialOptions(c),attemptToken:started.attempt.attemptToken,result:{success:false},now:NOW+1}))();
  assert.equal(finished.success,true);assert.equal(c.room('archer').progress,3);assert.equal(c.row().ap,4);
  const retry=setup();supplies(retry,{relics:['second_chance_coin','old_torch','tiny_shovel']});makeTrial(retry);retry.relic('second_chance_coin',{roomKey:'archer'});
  assert.equal(db.prepare("SELECT remaining_uses FROM family_expedition_room_effects WHERE expedition_id=? AND effect_type='bend_fate'").get(retry.expeditionId).remaining_uses,1);
  const torchStart=db.transaction(()=>engine.startMinigameAttempt(trialOptions(retry)))();
  assert.equal(torchStart.attempt.expiresAt-torchStart.attempt.startedAt,13);
  assert.throws(()=>retry.relic('tiny_shovel',{roomKey:'archer'}),/Finish your current trial/);
  const failed=db.transaction(()=>engine.finishMinigameAttempt({...trialOptions(retry),attemptToken:torchStart.attempt.attemptToken,result:{success:false},now:NOW+1}))();
  assert.equal(failed.success,false);assert.equal(failed.attempt.retry,true);assert.equal(retry.row().ap,4);
});

test('passive weapon bonuses distinguish normal and boss rooms; banner stacks with retained block but duplicate copies do not',()=>{
  const c=setup();supplies(c,{relics:['bent_sword','family_banner','family_banner']});c.command('draw');assert.equal(c.view().turn.block,1);
  c.hand(['strike','strike']);c.play('strike');c.play('strike');assert.equal(c.room('guard').progress,7);
  const boss=setup();supplies(boss,{relics:['rootcutters_axe','root_kings_signet']});boss.command('draw',{roomKey:'boss'});boss.hand(['strike','strike']);
  boss.play('strike',{roomKey:'boss'});boss.play('strike',{roomKey:'boss'});assert.equal(boss.room('boss').progress,10);
});

test('last-card relics trigger once per paid hand even when a card is recovered, and refresh next hand',()=>{
  const c=setup();supplies(c,{relics:['emerald_heart','crown_of_twenty','campfire_charm'],hp:1});c.command('draw');c.hand(['strike'],{discard:[],drawPile:[]});
  assert.deepEqual(c.view().turn.finisherBonus,{heal:1,damage:2});c.play('strike');assert.equal(c.row().hero_hp,2);assert.equal(c.room('guard').progress,5);
  c.relic('campfire_charm',{cardId:'strike',cardRevision:c.view().revision});c.play('strike');
  assert.equal(c.row().hero_hp,2);assert.equal(c.room('guard').progress,8);
  c.hand([],{block:6});c.command('end');c.command('draw');c.hand(['strike']);c.play('strike');
  assert.equal(c.row().hero_hp,3);assert.equal(c.room('guard').progress,13);
  const full=setup();supplies(full,{relics:['emerald_heart'],hp:3});full.command('draw');full.hand(['strike']);
  assert.equal(full.view().turn.finisherBonus.heal,0);full.play('strike');
  const saved=JSON.parse(db.prepare('SELECT state_json FROM family_expedition_card_states WHERE expedition_id=? AND user_id=?').get(full.expeditionId,full.userIds[0]).state_json);
  assert.equal(saved.heartUsed,false);
});

test('Last Stand prevents the first lethal enemy response but cannot repeatedly prevent knockout',()=>{
  const c=setup();supplies(c,{relics:['last_stand_banner'],hp:1});c.command('draw');c.hand([],{block:0});
  assert.equal(c.view().turn.response.damage,0);c.command('end');assert.equal(c.row().hero_hp,1);
  c.command('draw');c.hand([],{block:0});c.command('end');assert.equal(c.row().hero_hp,0);
});

test('supplies cannot escape a saved hand into another room and cursed relics are not consumed',()=>{
  const c=setup();supplies(c,{food:'warm_milk',relics:['loaded_die']});c.command('draw');
  assert.throws(()=>c.eat({roomKey:'archer'}),/saved hand/);assert.throws(()=>c.relic('loaded_die',{roomKey:'archer'}),/saved hand/);
  c.hand(['strike'],{artifactsDisabled:true});assert.throws(()=>c.relic('loaded_die'),/curse/);
  assert.equal(JSON.parse(c.row().loadout_json).slots[0].artifactId,'loaded_die');
});

test('HTTP supplies expose canonical preparation, work mid-hand, preserve private discard and replay food with a complete snapshot',async()=>{
  const express=require('express');const http=require('node:http');const app=express();app.use(express.json());app.use('/api/expeditions',require('../routes/expeditions'));
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const c=setup();supplies(c,{food:'warm_milk',relics:['bone_die','campfire_charm']});c.command('draw');c.hand(['strike'],{discard:['bulwark'],drawPile:[]});
    const base=`http://127.0.0.1:${server.address().port}/api/expeditions`;
    const headers=userId=>({'Content-Type':'application/json','X-Telegram-Init-Data':new URLSearchParams({user:JSON.stringify({id:db.prepare('SELECT telegram_id FROM users WHERE id=?').get(userId).telegram_id})}).toString()});
    const get=async userId=>(await fetch(`${base}/current`,{headers:headers(userId)})).json();
    const post=async(path,body)=>{const response=await fetch(`${base}/${c.expeditionId}/rooms/guard/${path}`,{method:'POST',headers:headers(c.userIds[0]),body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
    const first=await get(c.userIds[0]);
    assert.equal(first.catalog.provisions.warm_milk.description,CARD_PROVISIONS.warm_milk.description);
    assert.equal(first.catalog.artifacts.find(item=>item.id==='campfire_charm').effect.kind,'recover_card');
    assert.equal(first.cardCombat.supplies.guard.artifactReasons.bone_die,'');
    assert.deepEqual((await get(c.userIds[1])).cardCombat.discardChoices,[]);
    const foodBody={idempotencyKey:`http-meal-${serial}`};
    const eaten=await post('provision/use',foodBody);const replay=await post('provision/use',foodBody);
    assert.equal(eaten.status,200);assert.equal(replay.status,200);assert.equal(replay.body.expedition.id,c.expeditionId);
    assert.equal(replay.body.cardCombat.turn.energy,4);assert.equal(replay.body.member.ap,4);
    const armed=await post('artifacts/bone_die/use',{idempotencyKey:`http-bone-${serial}`});assert.equal(armed.status,200);
    const recovered=await post('artifacts/campfire_charm/use',{idempotencyKey:`http-charm-${serial}`,cardId:'bulwark',revision:armed.body.cardCombat.revision});
    assert.equal(recovered.status,200);assert.deepEqual(recovered.body.cardCombat.turn.hand.map(card=>card.id),['strike','bulwark']);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

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

test('Spending all block updates the response immediately; retained block protects only the next hand', () => {
  const c=setup('knight'); c.command('draw');
  const heavyTurn=1+((1-c.room('guard').id)%3+3)%3;
  c.hand(['bulwark','shield_bash'],{block:0,turnNumber:heavyTurn});
  c.play('bulwark'); assert.equal(c.view().turn.response.damage,0); assert.equal(c.view().turn.response.reason,'block');
  c.play('shield_bash'); assert.equal(c.view().turn.block,0); assert.equal(c.view().turn.response.damage,2);
  const forecast=c.view().turn.response; c.command('end');
  assert.equal(c.view().lastEvent.damage,forecast.damage); assert.equal(c.view().lastEvent.blocked,0); assert.equal(c.row().hero_hp,1);
  c.command('draw'); assert.equal(c.view().turn.block,2);
});

test('Shield Crash spends block but explicitly weakens the response instead of keeping a phantom shield', () => {
  for(const heavy of [false,true]) {
    const c=setup(); c.command('draw'); const turnNumber=1+(((heavy?1:0)-c.room('guard').id)%3+3)%3;
    c.hand(['guard','shield_crash'],{block:0,turnNumber}); c.play('guard'); c.play('shield_crash');
    const response=c.view().turn.response;
    assert.equal(c.view().turn.block,0); assert.equal(response.weakened,1); assert.equal(response.blocked,0);
    assert.equal(response.damage,heavy?1:0); if(!heavy) assert.equal(response.reason,'weakened');
    c.command('end'); assert.equal(c.view().lastEvent.damage,response.damage); assert.equal(c.row().hero_hp,heavy?2:3);
  }
});

test('Shield Throw keeps real block, and its forecast matches the response', () => {
  const c=setup(); c.command('draw'); const turnNumber=1+((0-c.room('guard').id)%3+3)%3;
  c.hand(['guard','shield_throw'],{block:0,turnNumber}); c.play('guard'); c.play('shield_throw');
  const response=c.view().turn.response; assert.equal(c.view().turn.block,1); assert.equal(response.reason,'block');
  c.command('end'); assert.equal(c.view().lastEvent.damage,response.damage); assert.equal(c.row().hero_hp,3);
});

test('An ally ward can still protect after block is spent; previewing never consumes it', () => {
  const c=setup('knight','cleric'); c.command('draw',{userId:c.userIds[1]}); c.hand(['sanctuary'],{},c.userIds[1]); c.play('sanctuary',{userId:c.userIds[1]});
  c.command('draw'); c.hand(['guard','shield_bash'],{block:0}); c.play('guard'); c.play('shield_bash');
  assert.equal(c.view().turn.block,0); assert.equal(c.view().turn.response.reason,'ally_ward');
  const forecast=c.view().turn.response; assert.deepEqual(c.view().turn.response,forecast);
  assert.equal(JSON.parse(c.room('guard').payload_json).cardSupport.ward.charges,1);
  c.command('end'); assert.equal(c.row().hero_hp,3); assert.equal(c.view().lastEvent.responseReason,'ally_ward');
  assert.equal(JSON.parse(c.room('guard').payload_json).cardSupport.ward,undefined);
  c.command('draw'); c.hand([],{block:0}); assert.ok(c.view().turn.response.damage>0);
});

test('Your own ward does not cover your spent block', () => {
  const c=setup(); c.command('draw'); c.hand(['rally','shield_bash']); c.play('rally'); c.play('shield_bash');
  assert.equal(c.view().turn.block,0); assert.ok(c.view().turn.response.damage>0);
  const forecast=c.view().turn.response; c.command('end'); assert.equal(c.row().hero_hp,3-forecast.damage);
});

test('Relic forecast is read-only and expires after its actual one-time protection', () => {
  const c=setup();
  db.prepare('UPDATE family_expedition_members SET loadout_json=? WHERE expedition_id=? AND user_id=?')
    .run(JSON.stringify({slots:[{artifactId:'rabbit_foot'}],triggerHistory:[]}),c.expeditionId,c.userIds[0]);
  c.command('draw'); c.hand([],{block:0}); const before=c.row().loadout_json;
  assert.equal(c.view().turn.response.reason,'relic'); assert.equal(c.view().turn.response.damage,0);
  assert.equal(c.row().loadout_json,before); c.view(); assert.equal(c.row().loadout_json,before);
  c.command('end'); assert.equal(c.row().hero_hp,3); assert.equal(c.view().lastEvent.responseReason,'relic');
  c.command('draw'); c.hand([],{block:0}); assert.ok(c.view().turn.response.damage>0);
});

test('Poison response forecast handles both a defeated enemy and a surviving next boss phase', () => {
  const c=setup('scout'); c.command('draw'); c.hand(['poisoned_blade']); c.play('poisoned_blade');
  db.prepare("UPDATE family_expedition_rooms SET progress=39 WHERE expedition_id=? AND room_key='guard'").run(c.expeditionId);
  assert.equal(c.view().turn.response.damage,0); assert.equal(c.view().turn.response.reason,'enemy_defeated');
  const before=c.room('guard').payload_json; c.view(); assert.equal(c.room('guard').payload_json,before);
  c.command('end'); assert.equal(c.row().hero_hp,3);
  const boss=setup('scout'); boss.command('draw',{roomKey:'boss'}); boss.hand(['poisoned_blade']); boss.play('poisoned_blade',{roomKey:'boss'});
  db.prepare("UPDATE family_expedition_rooms SET progress=progress_target-1 WHERE expedition_id=? AND room_key='boss'").run(boss.expeditionId);
  const forecast=boss.view().turn.response; assert.ok(Number.isFinite(forecast.damage)); assert.ok(forecast.intent);
  boss.command('end',{roomKey:'boss'}); assert.equal(boss.view().lastEvent.damage,forecast.damage);
});

test('Forecast separates enemy damage from unavoidable overheat', () => {
  const c=setup('mage'); c.command('draw'); c.hand([],{block:0,dodge:true,resource:4});
  const forecast=c.view().turn.response; assert.equal(forecast.damage,0); assert.equal(forecast.reason,'dodge');
  assert.equal(forecast.overheatDamage,1); assert.equal(forecast.totalDamage,1);
  c.command('end'); assert.equal(c.row().hero_hp,2);
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

test('Faith triggers once per paid hand, survives reconnects, and refreshes on the next draw', () => {
  const c=setup('cleric'); c.command('draw'); c.hand(['prayer','smite'],{block:0});
  assert.equal(c.view().turn.faithReady,true);
  const options={instanceId:c.view().turn.hand[0].instanceId,revision:c.view().revision,idempotencyKey:`faith-replay-${serial}`};
  c.command('play',options); assert.equal(c.view().turn.block,1); assert.equal(c.view().turn.faithReady,false);
  c.command('play',options); assert.equal(c.view().turn.block,1);
  const reconnect=c.view(); assert.deepEqual(c.view(),reconnect);
  c.play('smite'); assert.equal(c.view().turn.block,1);
  c.command('end'); c.command('draw'); assert.equal(c.view().turn.faithReady,true);
  c.hand(['prayer'],{block:0}); c.play('prayer'); assert.equal(c.view().turn.block,1);
});

test('Faith is not refreshed by carrying a paid hand to another enemy', () => {
  const c=setup('cleric'); c.command('draw'); c.hand(['prayer','smite']); c.play('prayer');
  db.prepare("UPDATE family_expedition_rooms SET state='cleared',progress=progress_target WHERE expedition_id=? AND room_key='guard'").run(c.expeditionId);
  c.command('retarget',{roomKey:'archer'}); assert.equal(c.view().turn.faithReady,false);
  c.play('smite',{roomKey:'archer'}); assert.equal(c.view().turn.block,1);
});

test('Mend restores two HP and reports the actual capped healing', () => {
  const c=setup('cleric'); c.command('draw'); c.hand(['mend','mend'],{resource:4,drawPile:['strike'],discard:[]});
  db.prepare('UPDATE family_expedition_members SET hero_hp=1 WHERE expedition_id=? AND user_id=?').run(c.expeditionId,c.userIds[0]);
  c.play('mend'); assert.equal(c.row().hero_hp,3); assert.equal(c.view().lastEvent.healed,2); assert.equal(c.view().resource,2);
  assert.throws(()=>c.play('mend'),/wounded/);
  db.prepare('UPDATE family_expedition_members SET hero_hp=2 WHERE expedition_id=? AND user_id=?').run(c.expeditionId,c.userIds[0]);
  c.play('mend'); assert.equal(c.row().hero_hp,3); assert.equal(c.view().lastEvent.healed,1); assert.equal(c.view().resource,0);
});

test('Mercy needs one light, guards even at full health, and cannot be used without light', () => {
  const c=setup('cleric'); c.command('draw'); c.hand(['mercy','mercy'],{resource:1,block:0});
  c.play('mercy'); assert.equal(c.row().hero_hp,3); assert.equal(c.view().turn.block,1);
  assert.equal(c.view().turn.energy,3); assert.equal(c.view().resource,0); assert.equal(c.view().lastEvent.healed,0);
  const before=c.view(); assert.throws(()=>c.play('mercy'),/1 light/); assert.deepEqual(c.view(),before);
});

test('Previously lethal cleric hands now survive through Sanctuary and light generation', () => {
  const c=setup('cleric'); c.command('draw');
  const forceIntent = kind => {
    const row=db.prepare('SELECT state_json FROM family_expedition_card_states WHERE expedition_id=? AND user_id=?').get(c.expeditionId,c.userIds[0]);
    const s=JSON.parse(row.state_json); while(require('./cardCatalog').enemyIntent({id:c.room('guard').id},s.turnNumber).kind!==kind) s.turnNumber++;
    db.prepare('UPDATE family_expedition_card_states SET state_json=? WHERE expedition_id=? AND user_id=?').run(JSON.stringify(s),c.expeditionId,c.userIds[0]);
  };
  db.prepare('UPDATE family_expedition_members SET hero_hp=1 WHERE expedition_id=? AND user_id=?').run(c.expeditionId,c.userIds[0]);
  c.hand(['sanctuary','prayer','holy_fire'],{resource:2}); forceIntent('heavy');
  c.play('sanctuary'); c.play('prayer'); c.play('holy_fire');
  assert.equal(c.view().turn.block,3); c.command('end'); assert.equal(c.row().hero_hp,1);
  c.command('draw'); c.hand(['radiance','holy_fire','prayer'],{resource:2}); forceIntent('strike');
  c.play('radiance'); c.play('holy_fire'); c.play('prayer');
  assert.equal(c.view().turn.block,1); c.command('end'); assert.equal(c.row().hero_hp,1);
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
  db.prepare("UPDATE family_expedition_rooms SET progress = progress_target-1 WHERE expedition_id = ? AND room_key = 'boss'").run(c.expeditionId);
  c.play('strike', { roomKey: 'boss' });
  const room = c.room('boss'); assert.equal(JSON.parse(room.payload_json).phase, 2);
  assert.equal(room.progress_target, CARD_BOSS_PHASE_HP[1]);
  assert.equal(room.progress, 0); assert.equal(c.row().contribution_progress, 1);
});

test('room card rewards are personal, one-time and join discard without replacing a paid hand', () => {
  const c = setup(); c.command('draw'); c.hand(['strike']);
  db.prepare("UPDATE family_expedition_rooms SET progress = 39 WHERE expedition_id = ? AND room_key = 'guard'").run(c.expeditionId);
  c.play('strike'); const reward = c.view().reward;
  assert.equal(reward.cards.length, 3); assert.equal(c.view(c.userIds[1]).reward, null);
  const before = c.view().turn;
  c.command('reward', { cardId: reward.cards[0].id });
  assert.equal(c.view().deckSize, 13); assert.deepEqual(c.view().turn, before); assert.equal(c.view().reward, null);
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
  assert.equal(Object.keys(CARDS).length, 42);
  for (const card of Object.values(CARDS)) { assert.ok(card.text.length > 10); assert.ok(card.cost >= 0 && card.cost <= 3); }
  for (const role of Object.keys(CLASS_RULES)) {
    const deck = starterDeck(role);
    assert.equal(deck.length, 12); assert.equal(new Set(deck).size, 12);
    assert.equal(deck.filter(id => CARDS[id].role === role).length, 10);
    assert.ok(deck.includes('strike') && deck.includes('guard'));
    assert.ok(deck.every(id => !CARDS[id].role || CARDS[id].role === role));
  }
});

test('Standfast draws only when already blocking; Shield Throw keeps its damage resource', () => {
  const c = setup(); c.command('draw');
  c.hand(['standfast','shield_throw'], {block:2, drawPile:['strike'], discard:[]});
  c.play('standfast'); assert.equal(c.view().turn.block,3);
  assert.ok(c.view().turn.hand.some(card=>card.id==='strike'));
  c.play('shield_throw'); assert.equal(c.room('guard').progress,9);
  assert.equal(c.view().turn.block,3);
  const fresh = setup(); fresh.command('draw'); fresh.hand(['standfast'], {block:0, drawPile:['strike'], discard:[]});
  fresh.play('standfast'); assert.equal(fresh.view().turn.hand.length,0);
});

test('Challenge counters only a fully blocked response and preserves reward attribution', () => {
  const c = setup(); c.command('draw'); c.hand(['challenge'], {block:2});
  c.play('challenge'); assert.equal(c.view().turn.counter,4);
  c.command('end'); assert.equal(c.room('guard').progress,4);
  assert.equal(c.row().hero_hp,3); assert.equal(c.row().contribution_progress,4);
  const exposed = setup(); exposed.command('draw'); exposed.hand(['challenge'], {block:0,weaken:0});
  exposed.play('challenge');
  // Force a heavy response deterministically through its personal turn number.
  const row = db.prepare('SELECT state_json FROM family_expedition_card_states WHERE expedition_id=? AND user_id=?').get(exposed.expeditionId,exposed.userIds[0]);
  const state = JSON.parse(row.state_json); while ((state.turnNumber-1+exposed.room('guard').id)%3!==1) state.turnNumber++;
  db.prepare('UPDATE family_expedition_card_states SET state_json=? WHERE expedition_id=? AND user_id=?').run(JSON.stringify(state),exposed.expeditionId,exposed.userIds[0]);
  exposed.command('end'); assert.equal(exposed.room('guard').progress,0); assert.equal(exposed.row().hero_hp,2);
});

test('Preparation spends combo for a bounded draw; Flurry adds combo without spending the chain', () => {
  const c=setup('scout'); c.command('draw'); c.hand(['preparation','flurry'],{resource:0,drawPile:['strike','guard'],discard:[]});
  assert.throws(()=>c.play('preparation'),/1 combo/);
  c.play('flurry'); assert.equal(c.room('guard').progress,1); assert.equal(c.view().resource,1);
  c.play('preparation'); assert.equal(c.view().resource,0); assert.equal(c.view().turn.hand.length,2);
});

test('Venom ticks on its owner only, expires after three ends and a killing tick stops the response', () => {
  const c=setup('scout'); c.command('draw'); c.hand(['poisoned_blade'],{block:6}); c.play('poisoned_blade');
  c.command('draw',{userId:c.userIds[1]}); c.hand([],{dodge:true},c.userIds[1]); c.command('end',{userId:c.userIds[1]});
  assert.equal(c.room('guard').progress,2);
  for(let i=0;i<3;i++) { if(i) c.command('draw'); c.hand([],{block:6}); c.command('end'); }
  assert.equal(c.room('guard').progress,8);
  c.command('draw'); c.hand([],{block:6}); c.command('end'); assert.equal(c.room('guard').progress,8);
  const kill=setup('scout'); kill.command('draw'); kill.hand(['poisoned_blade']); kill.play('poisoned_blade');
  db.prepare('UPDATE family_expedition_rooms SET progress=39 WHERE expedition_id=? AND room_key=?').run(kill.expeditionId,'guard');
  const hp=kill.row().hero_hp; kill.command('end'); assert.equal(kill.room('guard').state,'cleared'); assert.equal(kill.row().hero_hp,hp);
  assert.equal(kill.view().lastEvent.poisonDamage,1);
});

test('Venom Finisher replaces Ambush in the twelve-card deck and needs combo before spending anything',()=>{
  assert.equal(starterDeck('scout').length,12);assert.equal(starterDeck('scout').filter(id=>id==='ambush').length,1);
  assert.equal(CARDS.ambush.name,'Venom Finish');
  const c=setup('scout');c.command('draw');c.hand(['ambush'],{resource:0});
  const before=c.view();assert.throws(()=>c.play('ambush'),/needs 1 combo/);assert.deepEqual(c.view(),before);
  assert.equal(c.room('guard').progress,0);assert.equal(c.row().ap,4);
});

for(const combo of [1,2,5]) test(`Venom Finisher spends at most two of ${combo} combo and records its actual poison dose`,()=>{
  const c=setup('scout');c.command('draw');c.hand(['ambush'],{resource:combo,block:6});
  const before=c.view(),spent=Math.min(2,combo);
  const options={instanceId:before.turn.hand[0].instanceId,revision:before.revision,idempotencyKey:`venom-finisher-${serial}`};
  c.command('play',options);c.command('play',options);
  assert.equal(c.view().resource,combo-spent);assert.equal(c.view().turn.energy,2);assert.equal(c.room('guard').progress,3);
  assert.equal(c.view().lastEvent.comboSpent,spent);assert.equal(c.view().lastEvent.poisonPower,1+spent);
  assert.equal(c.view().lastEvent.poisonTurns,3);assert.equal(c.view().turn.response.poisonDamage,1+spent);
  const saved=c.view();assert.deepEqual(c.view(),saved);
  c.command('end');assert.equal(c.room('guard').progress,4+spent);assert.equal(c.view().lastEvent.poisonDamage,1+spent);
});

test('Scouts own their poison strength and ticks; stronger venom expires after three owner ends',()=>{
  const c=setup('scout','scout');
  c.command('draw');c.hand(['ambush'],{resource:2,block:6});c.play('ambush');
  c.command('draw',{userId:c.userIds[1]});c.hand(['ambush'],{resource:1,block:6},c.userIds[1]);c.play('ambush',{userId:c.userIds[1]});
  const support=()=>JSON.parse(c.room('guard').payload_json).cardSupport;
  assert.equal(support().poisonPower[c.userIds[0]],3);assert.equal(support().poisonPower[c.userIds[1]],2);
  c.command('end',{userId:c.userIds[1]});assert.equal(c.room('guard').progress,8);assert.equal(support().poison[c.userIds[0]],3);
  for(let i=0;i<3;i++) {if(i)c.command('draw');c.hand([],{block:6});c.command('end');}
  assert.equal(c.room('guard').progress,17);assert.equal(support().poison[c.userIds[0]],undefined);assert.equal(support().poisonPower[c.userIds[0]],undefined);
  assert.equal(support().poison[c.userIds[1]],2);
  c.command('draw');c.hand([],{block:6});c.command('end');assert.equal(c.room('guard').progress,17);
});

test('Venom Blade refreshes a stronger poison without weakening it or stacking another damage stream',()=>{
  const c=setup('scout');c.command('draw');c.hand(['ambush'],{resource:2,block:6});c.play('ambush');c.command('end');
  c.command('draw');c.hand(['poisoned_blade'],{block:6});c.play('poisoned_blade');
  const support=JSON.parse(c.room('guard').payload_json).cardSupport;
  assert.equal(support.poison[c.userIds[0]],3);assert.equal(support.poisonPower[c.userIds[0]],3);
  assert.equal(c.view().turn.response.poisonDamage,3);c.command('end');assert.equal(c.view().lastEvent.poisonDamage,3);
});

test('strong poison kills before a response, and a boss phase change clears it with a matching forecast',()=>{
  for(const boss of [false,true]) {
    const c=setup('scout'),roomKey=boss?'boss':'guard';c.command('draw',{roomKey});c.hand(['ambush'],{resource:2,block:0});c.play('ambush',{roomKey});
    db.prepare('UPDATE family_expedition_rooms SET progress=progress_target-3 WHERE id=?').run(c.room(roomKey).id);
    const forecast=c.view().turn.response;assert.equal(forecast.poisonDamage,3);
    if(!boss)assert.equal(forecast.reason,'enemy_defeated');
    const hp=c.row().hero_hp;c.command('end',{roomKey});assert.equal(c.row().hero_hp,hp-forecast.damage);
    if(boss) {const payload=JSON.parse(c.room(roomKey).payload_json);assert.equal(payload.phase,2);assert.deepEqual(payload.cardSupport,{});}
    else assert.equal(c.room(roomKey).state,'cleared');
  }
});

test('old saved poison without a strength field still deals two damage and expires normally',()=>{
  const c=setup('scout');c.command('draw');c.hand([],{block:6});
  const payload=JSON.parse(c.room('guard').payload_json);payload.cardSupport={poison:{[c.userIds[0]]:1}};
  db.prepare('UPDATE family_expedition_rooms SET payload_json=? WHERE id=?').run(JSON.stringify(payload),c.room('guard').id);
  assert.equal(c.view().turn.response.poisonDamage,2);c.command('end');assert.equal(c.room('guard').progress,2);
  assert.equal(JSON.parse(c.room('guard').payload_json).cardSupport.poison[c.userIds[0]],undefined);
});

test('Arcane Echo doubles only the next damaging card, without doubling heat, and expires at turn end', () => {
  const c=setup('mage'); c.command('draw'); c.hand(['echo','spark','spark']);
  c.play('echo'); assert.equal(c.view().turn.echo,true);
  c.play('spark'); assert.equal(c.room('guard').progress,6); assert.equal(c.view().resource,1); assert.equal(c.view().turn.echo,false);
  c.play('spark'); assert.equal(c.room('guard').progress,9);
  c.hand(['echo'],{energy:1,dodge:true}); c.play('echo'); c.command('end'); c.command('draw'); assert.equal(c.view().turn.echo,false);
});

test('Overchannel draws at most eight cards and Frost Armor cools heat while keeping its block', () => {
  const c=setup('mage'); c.command('draw'); c.hand(['overchannel','frost_armor'],{resource:3,drawPile:['strike','guard'],discard:[]});
  c.play('overchannel'); assert.equal(c.view().turn.hand.length,3); assert.equal(c.view().resource,5);
  c.play('frost_armor'); assert.equal(c.view().resource,3); assert.equal(c.view().turn.block,2);
  c.hand(['overchannel',...Array(7).fill('strike')],{drawPile:['guard','guard']}); c.play('overchannel'); assert.equal(c.view().turn.hand.length,8);
});

test('Prayer and Offering feed light, but Offering cannot kill its caster or spend anything on rejection', () => {
  const c=setup('cleric'); c.command('draw'); c.hand(['prayer','offering','holy_fire']);
  c.play('prayer'); assert.equal(c.view().resource,2);
  c.play('offering'); assert.equal(c.row().hero_hp,2); assert.equal(c.view().resource,5); assert.equal(c.view().turn.energy,4);
  c.play('holy_fire'); assert.equal(c.view().resource,3); assert.equal(c.room('guard').progress,7);
  c.hand(['offering']); db.prepare('UPDATE family_expedition_members SET hero_hp=1 WHERE expedition_id=? AND user_id=?').run(c.expeditionId,c.userIds[0]);
  const before=c.view(); assert.throws(()=>c.play('offering'),/2 HP/); assert.deepEqual(c.view(),before); assert.equal(c.row().hero_hp,1);
});

test('Beacon heals the actual family attacker and consumes exactly two shared charges', () => {
  const c=setup('cleric'); c.command('draw'); c.hand(['beacon']); c.play('beacon');
  c.command('draw',{userId:c.userIds[1]}); c.hand(['strike','strike','strike'],{},c.userIds[1]);
  db.prepare('UPDATE family_expedition_members SET hero_hp=1 WHERE expedition_id=? AND user_id=?').run(c.expeditionId,c.userIds[1]);
  c.play('strike',{userId:c.userIds[1]}); assert.equal(c.row(c.userIds[1]).hero_hp,2);
  c.play('strike',{userId:c.userIds[1]}); assert.equal(c.row(c.userIds[1]).hero_hp,3);
  db.prepare('UPDATE family_expedition_members SET hero_hp=2 WHERE expedition_id=? AND user_id=?').run(c.expeditionId,c.userIds[1]);
  c.play('strike',{userId:c.userIds[1]}); assert.equal(c.row(c.userIds[1]).hero_hp,2); assert.equal(c.row().hero_hp,3);
});

test('Beacon saves charges at full HP and spends them only on wounded attackers', () => {
  const c=setup('cleric'); c.command('draw'); c.hand(['beacon']); c.play('beacon');
  c.command('draw',{userId:c.userIds[1]}); c.hand(['strike','strike','strike'],{},c.userIds[1]);
  const charges=()=>JSON.parse(c.room('guard').payload_json).cardSupport.beacon;
  c.play('strike',{userId:c.userIds[1]}); assert.equal(c.row(c.userIds[1]).hero_hp,3); assert.equal(charges(),2);
  db.prepare('UPDATE family_expedition_members SET hero_hp=2 WHERE expedition_id=? AND user_id=?').run(c.expeditionId,c.userIds[1]);
  c.play('strike',{userId:c.userIds[1]}); assert.equal(c.row(c.userIds[1]).hero_hp,3); assert.equal(charges(),1);
  c.play('strike',{userId:c.userIds[1]}); assert.equal(charges(),1); assert.equal(c.view(c.userIds[1]).lastEvent.healed,0);
  c.hand(['strike'],{energy:1}); c.play('strike'); assert.equal(c.row().hero_hp,3); assert.equal(charges(),1);
  db.prepare('UPDATE family_expedition_members SET hero_hp=1 WHERE expedition_id=? AND user_id=?').run(c.expeditionId,c.userIds[0]);
  c.hand(['strike'],{energy:1}); c.play('strike'); assert.equal(c.row().hero_hp,2); assert.equal(charges(),0);
});

for (const card of Object.values(CARDS)) test(`${card.name} resolves legally with its class and records a finite result`, () => {
  const c=setup(card.role || 'knight'); c.command('draw');
  c.hand([card.id],{resource:3,energy:6,block:2,drawPile:['strike','guard'],discard:[]});
  db.prepare('UPDATE family_expedition_members SET hero_hp=2 WHERE expedition_id=? AND user_id=?').run(c.expeditionId,c.userIds[0]);
  c.play(card.id);
  const view=c.view(); assert.ok(view.turn.energy>=0 && view.turn.energy<=6);
  assert.ok(view.resource>=0 && view.resource<=8); assert.ok(view.turn.block>=0 && view.turn.block<=6);
  assert.ok(c.row().hero_hp>=1 && c.row().hero_hp<=3);
  assert.equal(view.lastEvent.cardId,card.id); assert.ok(Number.isFinite(view.lastEvent.damage));
  assert.ok(view.turn.hand.length<=8); assert.equal(c.row().ap,4);
});

test('Advanced cards have distinct tradeoffs: retained block, heat scaling, cooling and a drawing dodge', () => {
  const knight=setup(); knight.command('draw'); knight.hand(['bulwark'],{block:0}); knight.play('bulwark');
  assert.equal(knight.view().turn.block,3); knight.command('end'); knight.command('draw'); assert.equal(knight.view().turn.block,2);
  const mage=setup('mage'); mage.command('draw'); mage.hand(['inferno','deep_breath'],{resource:3,drawPile:['strike'],discard:[]});
  mage.play('inferno'); assert.equal(mage.room('guard').progress,12); assert.equal(mage.view().resource,5);
  mage.play('deep_breath'); assert.equal(mage.view().resource,0); assert.equal(mage.view().turn.hand.length,1);
  const scout=setup('scout'); scout.command('draw'); scout.hand(['vanish'],{resource:2,drawPile:['strike','guard'],discard:[]});
  scout.play('vanish'); assert.equal(scout.view().turn.dodge,true); assert.equal(scout.view().resource,2); assert.equal(scout.view().turn.hand.length,2);
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
  c.play('strike'); assert.equal(c.room('guard').progress, 7);
  c.play('strike'); assert.equal(c.room('guard').progress, 10);
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
  for (let phase = 1; phase <= 3; phase++) {
    assert.equal(c.room('boss').progress_target, CARD_BOSS_PHASE_HP[phase - 1]);
    db.prepare("UPDATE family_expedition_rooms SET progress = progress_target-1 WHERE expedition_id = ? AND room_key = 'boss'").run(c.expeditionId);
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
