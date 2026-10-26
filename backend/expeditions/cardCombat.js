'use strict';

const crypto = require('node:crypto');
const { CARD_MODE, ENERGY_PER_TURN, HAND_SIZE, MAX_DECK_SIZE, CARDS, CLASS_RULES, starterDeck, enemyIntent } = require('./cardCatalog');
const { cardBossPhase } = require('./cardBalance');
const { regenerateAp, recoverHeroIfReady, updateRoom, persistUnlocks, insertAction,
  armedEffect, consumeArmedEffect, applyWearerDamageProtection } = require('./engine');
const { consumeRoomEffect, listActiveRoomEffects, ROLE_EFFECT_TYPES } = require('./roleEffects');
const { assertGlobalIdempotencyKeyUnused } = require('./minigameAttempts');
const { cardArtifactReason, cardProvisionReason } = require('./cardSupplies');

const RECOVERY_SECONDS = 30 * 60;
const parse = (text, fallback = {}) => text ? JSON.parse(text) : fallback;
const fail = message => { const error = new RangeError(message); error.statusCode = 409; throw error; };

function isCardExpedition(expedition) {
  return (expedition?.map || parse(expedition?.map_json)).combatMode === CARD_MODE;
}

function isCombat(room) {
  return room && (room.type === 'boss' || room.type === 'combat' || room.encounterType === 'combat');
}

function initialState(role) {
  return { version: 1, revision: 0, turnNumber: 0, active: false, roomKey: null,
    deck: starterDeck(role), drawPile: [], discard: [], hand: [], energy: 0,
    block: 0, retainedBlock: 0, resource: 0, dodge: false, weaken: 0, counter: 0, echo: false, faithUsed: false,
    claimedRooms: [], initialized: false, lastEvent: null };
}

function loadState(db, expeditionId, userId, role) {
  return parse(db.prepare(`SELECT state_json FROM family_expedition_card_states
    WHERE expedition_id = ? AND user_id = ?`).get(expeditionId, userId)?.state_json, initialState(role));
}

function saveState(db, expeditionId, userId, state, now) {
  db.prepare(`INSERT INTO family_expedition_card_states (expedition_id, user_id, state_json, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(expedition_id, user_id) DO UPDATE SET state_json = excluded.state_json,
    updated_at = excluded.updated_at`).run(expeditionId, userId, JSON.stringify(state), now);
}

function roomsFor(db, expeditionId) {
  return db.prepare('SELECT * FROM family_expedition_rooms WHERE expedition_id = ?').all(expeditionId)
    .map(row => ({ ...parse(row.payload_json), id: row.id, key: row.room_key, type: row.room_type,
      state: row.state, progress: row.progress, progressTarget: row.progress_target,
      support: row.support, unlockedAt: row.unlocked_at, clearedAt: row.cleared_at }));
}

function pendingReward(db, expeditionId, userId, state, role) {
  const room = db.prepare(`SELECT r.id, r.room_key, r.payload_json FROM family_expedition_rooms r
    WHERE r.expedition_id = ? AND r.state = 'cleared' AND r.room_type IN ('combat','boss')
      AND EXISTS (SELECT 1 FROM family_expedition_actions a WHERE a.room_id = r.id
        AND a.user_id = ? AND a.action_type IN ('card_draw','card_play')) ORDER BY r.id`)
    .all(expeditionId, userId).find(candidate => !state.claimedRooms.includes(candidate.room_key));
  if (!room) return null;
  return { roomKey: room.room_key, roomName: parse(room.payload_json).name || 'Cleared room',
    cards: state.deck.length >= MAX_DECK_SIZE ? [] : Object.values(CARDS).filter(card => card.role === role && card.reward) };
}

function enemyResponsePlan(room, state, userId) {
  const intent = room?.state === 'unlocked' ? enemyIntent(room, state.turnNumber) : null;
  const baseDamage = intent?.damage || 0;
  const weakened = Math.min(baseDamage, state.weaken || 0);
  let incoming = Math.max(0, baseDamage - weakened);
  let reason = !intent ? 'enemy_defeated' : weakened && !incoming ? 'weakened' : 'unprotected';
  if (incoming > 0 && state.dodge) { incoming = 0; reason = 'dodge'; }
  const ward = room?.cardSupport?.ward;
  const allyWardUsed = incoming > state.block && ward?.charges > 0 && ward.owner !== userId;
  if (allyWardUsed) { incoming = 0; reason = 'ally_ward'; }
  const blocked = Math.min(incoming, state.block);
  const damage = Math.max(0, incoming - blocked);
  if (blocked && !damage) reason = 'block';
  return { intent, baseDamage, weakened, incoming, blocked, damage, allyWardUsed, reason };
}

// Reads the same response plan used by End Turn. All simulated protection uses
// cloned objects; opening the screen never spends a ward, relic or poison tick.
function previewEnemyResponse(db, expeditionId, target, state, member) {
  const room = target ? JSON.parse(JSON.stringify(target)) : null;
  let poisonDamage = 0;
  if (room?.state === 'unlocked' && room.cardSupport?.poison?.[member.user_id] > 0) {
    poisonDamage = Math.min(room.cardSupport.poisonPower?.[member.user_id] || 2, room.progressTarget - room.progress);
    if (poisonDamage >= room.progressTarget - room.progress) {
      if (room.type === 'boss' && Number(room.phase || 1) < 3) {
        const phase = cardBossPhase(Number(room.phase || 1) + 1);
        room.phase = phase.phase; room.progressTarget = phase.progressTarget;
        room.attackTarget = phase.attackTarget; room.name = phase.name;
        room.progress = 0; room.cardSupport = {};
      } else room.state = 'cleared';
    }
  }
  const plan = enemyResponsePlan(room, state, member.user_id);
  let damage = plan.damage;
  let reason = plan.reason;
  if (damage > 0 && listActiveRoomEffects(db, { expeditionId, roomId: room.id }).some(effect => effect.effectType === ROLE_EFFECT_TYPES.knight)) {
    damage = 0; reason = 'room_shield';
  }
  const events = [];
  const loadout = parse(member.loadout_json, []);
  const artifactMember = { heroHp: recoverHeroIfReady({heroHp:member.hero_hp,heroRecoverAt:member.hero_recover_at},Math.floor(Date.now()/1000)).heroHp,
    loadout: Array.isArray(loadout) ? loadout : loadout.slots || [], triggerHistory: Array.isArray(loadout) ? [] : loadout.triggerHistory || [] };
  const beforeArtifact = damage;
  damage = applyWearerDamageProtection({member:artifactMember,expeditionId,roomKey:room?.key,damage,
    damageSource:'combat',events,artifactsDisabled:Boolean(state.artifactsDisabled)});
  if (damage < beforeArtifact) reason = 'relic';
  const overheatDamage = member.role === 'mage' && state.resource >= 4 ? 1 : 0;
  return { damage, totalDamage:damage + overheatDamage, overheatDamage, reason, baseDamage:plan.baseDamage,
    weakened:plan.weakened, blocked:plan.blocked, poisonDamage, intent:plan.intent };
}

function viewCardCombat(db, expedition, userId) {
  if (!isCardExpedition(expedition)) return null;
  const expeditionId = expedition.id;
  const member = db.prepare('SELECT * FROM family_expedition_members WHERE expedition_id = ? AND user_id = ?').get(expeditionId, userId);
  if (!member) return { enabled: true, classes: CLASS_RULES, turn: null };
  const state = loadState(db, expeditionId, userId, member.role);
  const rooms = roomsFor(db, expeditionId);
  const target = rooms.find(room => room.key === state.roomKey);
  const visibleRooms = rooms.filter(room => room.state === 'unlocked' && isCombat(room));
  const loaded = parse(member.loadout_json, []);
  const supplyMember = { heroHp: recoverHeroIfReady({ heroHp: member.hero_hp, heroRecoverAt: member.hero_recover_at }, Math.floor(Date.now()/1000)).heroHp,
    heroRecoverAt: member.hero_recover_at, ...regenerateAp({ap:member.ap,apRegenAt:member.ap_regen_at,apRegenDay:member.ap_regen_day},Math.floor(Date.now()/1000)),
    provisionId: member.provision_id, provisionState: parse(member.provision_state_json), debuff: parse(member.debuff_json),
    loadout: Array.isArray(loaded) ? loaded : loaded.slots || [], triggerHistory: Array.isArray(loaded) ? [] : loaded.triggerHistory || [] };
  const equipped = new Set(supplyMember.loadout.map(slot => slot?.artifactId).filter(Boolean));
  const openAttempt = db.prepare(`SELECT 1 FROM family_expedition_minigame_attempts WHERE expedition_id = ? AND user_id = ?
    AND status IN ('ready','active','retry') AND expires_at > ?`).get(expeditionId, userId, Math.floor(Date.now()/1000));
  const supplies = Object.fromEntries(rooms.filter(room => room.state === 'unlocked').map(room => {
    const context = { member:supplyMember, room, cardState:state, openAttempt,
      roomEffects:listActiveRoomEffects(db,{expeditionId,roomId:room.id}) };
    return [room.key, { provisionReason:cardProvisionReason(member.provision_id,context),
      artifactReasons:Object.fromEntries([...equipped].map(id=>[id,cardArtifactReason(id,context)])) }];
  }));
  const meal = supplyMember.provisionState;
  const mealActive = meal.used;
  const potatoRoom = meal.blockPerHand?.roomKey || meal.roomKey;
  const bonuses = Object.fromEntries(visibleRooms.map(room => [room.key, [
    equipped.has('family_banner') && !state.artifactsDisabled ? 'Banner: +1 block / hand' : '',
    mealActive && member.provision_id === 'hearty_potato_meal' && potatoRoom === room.key ? 'Meal: +1 block / new hand' : '',
    mealActive && member.provision_id === 'magic_squash_pie' ? 'Pie: +1 first hit / hand' : '',
    ...supplyMember.triggerHistory.filter(entry => entry.scope === 'armed' && entry.roomKey === room.key && entry.remainingUses > 0)
      .map(entry => entry.effectKind === 'combat_roll_floor' ? 'Next hit: minimum 5'
        : ['combat_advantage','multi_combat_advantage'].includes(entry.effectKind) ? `+${entry.amount ?? 3} damage ×${entry.remainingUses}`
          : entry.effectKind === 'prevent_personal_damage' ? 'Personal shield' : ''),
  ].filter(Boolean)]));
  return {
    enabled: true, revision: state.revision, role: member.role, class: CLASS_RULES[member.role],
    classes: CLASS_RULES, energyPerTurn: ENERGY_PER_TURN, handSize: HAND_SIZE, maxDeckSize: MAX_DECK_SIZE,
    deckSize: state.deck.length, drawCount: state.drawPile.length, discardCount: state.discard.length,
    hero: db.prepare('SELECT slot_head, slot_body, slot_hands, slot_fren, slot_face FROM peepers WHERE user_id = ?').get(userId) || { alive: true },
    deck: [...new Set(state.deck)].map(id => ({ ...CARDS[id], copies: state.deck.filter(cardId => cardId === id).length })),
    classCards: Object.values(CARDS).filter(card => card.role === member.role),
    resource: state.resource, turnNumber: state.turnNumber, lastEvent: state.lastEvent,
    supplies, bonuses,
    discardChoices: [...new Set(state.discard)].map(id => ({ ...CARDS[id], copies: state.discard.filter(cardId => cardId === id).length })),
    intents: Object.fromEntries(visibleRooms.map(room => [room.key, enemyIntent(room, state.active ? state.turnNumber : state.turnNumber + 1)])),
    supports: Object.fromEntries(visibleRooms.map(room => [room.key, room.cardSupport || {}])),
    reward: pendingReward(db, expeditionId, userId, state, member.role),
    turn: state.active ? { number: state.turnNumber, roomKey: state.roomKey, energy: state.energy,
      block: state.block, dodge: state.dodge, weaken: state.weaken, resource: state.resource,
      counter: state.counter || 0, echo: Boolean(state.echo),
      faithReady: member.role === 'cleric' && !state.faithUsed,
      finisherBonus: !state.artifactsDisabled && state.hand.length === 1
        ? { heal: equipped.has('emerald_heart') && !state.heartUsed && supplyMember.heroHp < 3 ? 1 : 0, damage: equipped.has('crown_of_twenty') && !state.crownUsed ? 2 : 0 } : null,
      response: previewEnemyResponse(db, expeditionId, target, state, member),
      targetCleared: target?.state === 'cleared', intent: target?.state === 'unlocked' ? enemyIntent(target, state.turnNumber) : null,
      hand: state.hand.map(card => ({ ...CARDS[card.cardId], instanceId: card.instanceId })) } : null,
  };
}

function shuffle(cards, randomInt = crypto.randomInt) {
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function deal(state, count, randomInt) {
  for (let i = 0; i < count && state.hand.length < 8; i++) {
    if (!state.drawPile.length && state.discard.length) {
      state.drawPile = shuffle(state.discard, randomInt); state.discard = [];
    }
    if (!state.drawPile.length) break;
    state.hand.push({ cardId: state.drawPile.pop(), instanceId: crypto.randomUUID() });
  }
}

function roomDamage(db, expedition, room, damage, now) {
  const applied = Math.max(0, Math.min(room.progressTarget - room.progress, damage));
  room.progress += applied;
  if (room.progress >= room.progressTarget) {
    if (room.type === 'boss' && Number(room.phase || 1) < 3) {
      const phase = cardBossPhase(Number(room.phase || 1) + 1);
      room.phase = phase.phase; room.progress = 0; room.progressTarget = phase.progressTarget;
      room.attackTarget = phase.attackTarget; room.name = phase.name; room.cardSupport = {};
    } else {
      room.state = 'cleared'; room.clearedAt = now; room.cardSupport = {};
      if (room.type === 'boss') {
        room.bossDefeated = true;
        db.prepare(`UPDATE family_expeditions SET status = 'boss_defeated', boss_defeated_at = ? WHERE id = ?`).run(now, expedition.id);
      }
    }
  }
  updateRoom(db, expedition.id, room);
  if (room.state === 'cleared') persistUnlocks(db, expedition.id, parse(expedition.map_json), room.key, now);
  return applied;
}

// All commands are one SQLite transaction. Requests carry both an idempotency key
// and an expected revision: retries are safe and stale browser tabs cannot play a
// different card or draw another hand after their view has been superseded.
function cardCommand(db, { expeditionId, userId, operation, roomKey = null, instanceId = null,
  cardId = null, revision, idempotencyKey, now = Math.floor(Date.now() / 1000), randomInt = crypto.randomInt }) {
  return db.transaction(() => {
    if (!['draw', 'play', 'end', 'retarget', 'reward'].includes(operation)) throw new RangeError('Unknown card command');
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 128) throw new RangeError('A request key is required');
    const expedition = db.prepare('SELECT * FROM family_expeditions WHERE id = ?').get(expeditionId);
    if (!expedition || !isCardExpedition(expedition)) throw new RangeError('This expedition uses dice combat');
    if (!db.prepare('SELECT 1 FROM family_members WHERE family_id = ? AND user_id = ?').get(expedition.family_id, userId)) throw new RangeError('Not a current family member');
    const intent = { expeditionId, operation, roomKey, instanceId, cardId, revision };
    const replay = db.prepare('SELECT * FROM family_expedition_actions WHERE user_id = ? AND idempotency_key = ?').get(userId, idempotencyKey);
    if (replay) {
      const previous = parse(replay.modifier_json);
      if (replay.action_type !== `card_${operation}` || JSON.stringify(previous.cardIntent) !== JSON.stringify(intent)) fail('Idempotency conflict');
      return { replayed: true, events: previous.events || [] };
    }
    assertGlobalIdempotencyKeyUnused(db, { userId, idempotencyKey });
    if (expedition.status === 'finished') throw new RangeError('Expedition is finished');
    const row = db.prepare('SELECT * FROM family_expedition_members WHERE expedition_id = ? AND user_id = ?').get(expeditionId, userId);
    if (!row) throw new RangeError('Choose a class first');
    const state = loadState(db, expeditionId, userId, row.role);
    if (!Number.isInteger(revision) || state.revision !== revision) fail('The hand changed. Refresh and try again.');
    const rooms = roomsFor(db, expeditionId);
    let room = rooms.find(candidate => candidate.key === (roomKey || state.roomKey));
    const events = [];
    const recovered = recoverHeroIfReady({ heroHp: row.hero_hp, heroRecoverAt: row.hero_recover_at }, now);
    let hp = recovered.heroHp;
    let recoverAt = recovered.heroRecoverAt;
    const loaded = parse(row.loadout_json, []);
    const loadout = Array.isArray(loaded) ? { slots: loaded, triggerHistory: [] } : loaded;
    const artifactMember = { heroHp: hp, loadout: loadout.slots || [], triggerHistory: loadout.triggerHistory || [] };
    const equipped = new Set(artifactMember.loadout.map(slot => slot?.artifactId).filter(Boolean));
    const artifactsDisabled = state.active ? Boolean(state.artifactsDisabled) : parse(row.debuff_json).type === 'cursed';
    const needsHero = ['draw', 'play', 'retarget'].includes(operation);
    if (needsHero && (hp <= 0 || Number(recoverAt || 0) > now)) throw new RangeError('Your hero is recovering');
    const assertTarget = () => {
      if (!room || room.state !== 'unlocked' || !isCombat(room)) fail('Choose an open enemy. The previous enemy may already be defeated.');
    };
    if (operation === 'draw') {
      if (state.active) fail('Finish your saved turn before drawing another hand');
      assertTarget();
      if (expedition.status !== 'active') fail('The boss has already fallen');
      const openAttempt = db.prepare(`SELECT 1 FROM family_expedition_minigame_attempts
        WHERE expedition_id = ? AND user_id = ? AND status IN ('ready','active','retry') AND expires_at > ?`).get(expeditionId, userId, now);
      if (openAttempt) fail('Finish your room challenge first');
      const ap = regenerateAp({ ap: row.ap, apRegenAt: row.ap_regen_at, apRegenDay: row.ap_regen_day }, now);
      if (ap.ap < 1) throw new RangeError('Not enough AP for a new hand');
      if (!state.initialized) { state.drawPile = shuffle(state.deck, randomInt); state.initialized = true; }
      state.active = true; state.roomKey = room.key; state.turnNumber++;
      state.energy = ENERGY_PER_TURN; state.block = state.retainedBlock; state.retainedBlock = 0;
      if (!artifactsDisabled && equipped.has('family_banner')) state.block++;
      const provision = parse(row.provision_state_json);
      if (row.provision_id === 'hearty_potato_meal' && provision.used && (provision.blockPerHand?.roomKey || provision.roomKey) === room.key) state.block++;
      state.block = Math.min(6, state.block);
      state.attacks = 0;
      state.heartUsed = false; state.crownUsed = false;
      state.dodge = false; state.weaken = 0; state.counter = 0; state.echo = false; state.faithUsed = false;
      state.artifactsDisabled = artifactsDisabled;
      db.prepare("UPDATE family_expedition_members SET debuff_json = '{}' WHERE expedition_id = ? AND user_id = ?").run(expeditionId, userId);
      if (row.role === 'scout') state.resource = 0;
      deal(state, HAND_SIZE, randomInt);
      db.prepare(`UPDATE family_expedition_members SET ap = ?, ap_regen_at = ?, ap_regen_day = ?,
        contribution_ap = contribution_ap + 1 WHERE expedition_id = ? AND user_id = ?`)
        .run(ap.ap - 1, ap.apRegenAt, ap.apRegenDay, expeditionId, userId);
      events.push({ type: 'card_draw', amount: state.hand.length });
    } else if (operation === 'reward') {
      const reward = pendingReward(db, expeditionId, userId, state, row.role);
      if (!reward || reward.roomKey !== roomKey) fail('This room reward was already chosen');
      room = rooms.find(candidate => candidate.key === reward.roomKey);
      if (cardId !== 'skip') {
        if (!reward.cards.some(card => card.id === cardId)) throw new RangeError('Choose one of the offered cards');
        state.deck.push(cardId);
        // Rewards join the discard pile; they never replace a paid hand or expose
        // future draw order. An uninitialized deck is shuffled at its first draw.
        if (state.initialized) state.discard.push(cardId);
      }
      state.claimedRooms.push(reward.roomKey);
      events.push({ type: 'card_reward', cardId });
    } else {
      if (!state.active) fail('Draw a hand first');
      const oldTarget = rooms.find(candidate => candidate.key === state.roomKey);
      if (operation === 'retarget') {
        if (oldTarget && oldTarget.state !== 'cleared') fail('Finish the turn against your current enemy first');
        assertTarget(); state.roomKey = room.key;
        events.push({ type: 'card_retarget' });
      } else {
        if (roomKey && roomKey !== state.roomKey) fail('This hand belongs to another enemy');
        room = oldTarget;
        if (!room) throw new RangeError('Enemy not found');
        if (operation === 'play') {
          assertTarget();
          const index = state.hand.findIndex(card => card.instanceId === instanceId);
          if (index < 0) fail('That card is no longer in your hand');
          const card = CARDS[state.hand[index].cardId];
          if (card.cost > state.energy) throw new RangeError('Not enough energy for that card');
          if (card.effect === 'mend' && state.resource < (card.lightCost ?? 2)) throw new RangeError(`${card.name} needs ${card.lightCost ?? 2} light`);
          if (card.effect === 'mend' && hp >= 3 && !card.block) throw new RangeError(`${card.name} needs a wounded hero`);
          if (card.effect === 'holy_fire' && state.resource < 2) throw new RangeError('Holy Fire needs 2 light');
          if (card.effect === 'prepare' && state.resource < 1) throw new RangeError('Preparation needs 1 combo');
          if (card.effect === 'venom_finisher' && state.resource < card.comboCost) throw new RangeError('Venom Finish needs 1 combo');
          if (card.effect === 'offering' && hp < 2) throw new RangeError('Offering needs at least 2 HP');
          const previousBlock = state.block;
          const previousResource = state.resource;
          const previousHp = hp;
          let damage = card.damage || 0;
          let draw = card.draw || 0;
          let comboSpent = 0;
          state.energy -= card.cost;
          state.block = Math.min(6, state.block + (card.block || 0));
          state.resource = Math.min(8, state.resource + (card.heat || 0) + (card.light || 0));
          // Faith belongs to this paid hand: a reconnect, free retarget or second
          // light card cannot grant another block. Refresh only on a new draw.
          const faithTriggered = row.role === 'cleric' && card.light > 0 && !state.faithUsed;
          if (faithTriggered) { state.block = Math.min(6, state.block + 1); state.faithUsed = true; }
          if (card.effect === 'bash') { damage += previousBlock * 3; state.block = 0; }
          if (card.effect === 'retain') state.retainedBlock = Math.max(state.retainedBlock, card.retain || 1);
          if (card.effect === 'combo' || card.effect === 'dodge') state.resource = Math.min(6, state.resource + 1);
          if (card.effect === 'dodge') state.dodge = true;
          if (card.effect === 'vanish') state.dodge = true;
          if (card.combo) state.resource = Math.min(6, state.resource + card.combo);
          if (card.effect === 'finisher') { damage += state.resource * 3; state.resource = 0; }
          if (card.effect === 'venom_finisher') { comboSpent = Math.min(card.comboSpendMax, state.resource); state.resource -= comboSpent; }
          if (card.effect === 'vent') { state.resource = Math.max(0, state.resource - 3); state.energy = Math.min(6, state.energy + 1); }
          if (card.effect === 'discharge' || card.effect === 'judgement') { damage += state.resource * 2; state.resource = 0; }
          if (card.effect === 'mend') { state.resource -= card.lightCost ?? 2; hp = Math.min(3, hp + (card.heal || 1)); }
          if (card.effect === 'holy_fire') state.resource -= 2;
          if (card.effect === 'prepare') state.resource--;
          if (card.effect === 'flurry') { damage += previousResource; state.resource = Math.min(6, state.resource + 1); }
          if (card.effect === 'shield_throw') damage += previousBlock * 2;
          if (card.effect === 'standfast' && previousBlock > 0) draw++;
          if (card.effect === 'counter') state.counter = Math.min(12, (state.counter || 0) + 4);
          if (card.effect === 'frost') state.resource = Math.max(0, state.resource - 2);
          if (card.effect === 'cool_all') state.resource = 0;
          if (card.effect === 'inferno') damage += previousResource * 2;
          if (card.effect === 'offering') { hp--; state.energy = Math.min(6, state.energy + 1); }
          if (card.effect === 'weaken' || card.weaken) state.weaken = Math.max(state.weaken, card.weaken || 1);
          const support = room.cardSupport ||= {};
          if (card.effect === 'ward') support.ward = { owner: userId, charges: 1 };
          if (card.effect === 'expose') support.expose = 2;
          if (card.effect === 'poison' || card.effect === 'venom_finisher') {
            support.poison ||= {}; support.poisonPower ||= {};
            // Reapplying venom refreshes its duration and keeps the stronger
            // dose. Ticks and strength belong to the attacking Scout only.
            const previousPower = support.poison[userId] > 0 ? support.poisonPower[userId] || 2 : 0;
            support.poison[userId] = 3;
            support.poisonPower[userId] = Math.max(previousPower, card.effect === 'poison' ? 2 : 1 + comboSpent);
          }
          if (card.effect === 'beacon') support.beacon = 2;
          if (card.effect === 'echo') state.echo = true;
          if (damage > 0) {
            if (state.echo) { damage *= 2; state.echo = false; }
            if (!artifactsDisabled) {
              const floor = armedEffect(artifactMember, 'combat_roll_floor', room.key);
              if (floor) { damage = Math.max(floor.floor ?? 5, damage); consumeArmedEffect(artifactMember, floor); }
              const boost = armedEffect(artifactMember, 'combat_advantage', room.key) || armedEffect(artifactMember, 'multi_combat_advantage', room.key);
              if (boost) { damage += boost.amount ?? 3; consumeArmedEffect(artifactMember, boost); }
              if (!state.attacks && equipped.has(room.type === 'boss' ? 'rootcutters_axe' : 'bent_sword')) damage += room.type === 'boss' ? 2 : 1;
              if (room.type === 'boss' && equipped.has('root_kings_signet')) damage++;
              if (state.hand.length === 1) {
                if (equipped.has('crown_of_twenty') && !state.crownUsed) { damage += 2; state.crownUsed = true; }
                if (equipped.has('emerald_heart') && !state.heartUsed && hp < 3) { hp = Math.min(3, hp + 1); state.heartUsed = true; }
              }
            }
            const firstAttack = !state.attacks;
            state.attacks = (state.attacks || 0) + 1;
            if (support.expose > 0) { damage += 2; support.expose--; }
            if (support.beacon > 0 && hp < 3) { hp++; support.beacon--; }
            const provision = parse(row.provision_state_json);
            // Interpret previously eaten meals through current card rules too;
            // old dice-shaped +2/+3-per-card bonuses must not survive a reload.
            if (firstAttack && row.provision_id === 'magic_squash_pie' && provision.used) damage += 1;
            damage = roomDamage(db, expedition, room, damage, now);
            db.prepare(`UPDATE family_expedition_members SET contribution_progress = contribution_progress + ?
              WHERE expedition_id = ? AND user_id = ?`).run(damage, expeditionId, userId);
          } else updateRoom(db, expeditionId, room);
          state.discard.push(state.hand[index].cardId); state.hand.splice(index, 1);
          const handBeforeDraw = state.hand.length;
          if (draw) deal(state, draw, randomInt);
          events.push({ type: 'card_play', cardId: card.id, name: card.name, damage,
            kind: card.kind, role: card.role || row.role, effect: card.effect || card.kind,
            block: state.block, healed: Math.max(0, hp - previousHp), selfDamage: Math.max(0, previousHp - hp),
            faithTriggered, drawn: state.hand.length - handBeforeDraw, roomCleared: room.state === 'cleared' });
          if (card.effect === 'venom_finisher' || card.effect === 'poison') Object.assign(events.at(-1), {
            comboSpent, poisonTurns: room.cardSupport?.poison?.[userId] || 0,
            poisonPower: room.cardSupport?.poison?.[userId] > 0 ? room.cardSupport.poisonPower?.[userId] || 2 : 0,
          });
        } else if (operation === 'end') {
          // Venom advances only with its owner's paid turns, never when an ally
          // acts or while the player is offline. A killing tick stops the response.
          let poisonDamage = 0;
          if (room.state === 'unlocked' && room.cardSupport?.poison?.[userId] > 0) {
            const poisonPower = room.cardSupport.poisonPower?.[userId] || 2;
            room.cardSupport.poison[userId]--;
            if (!room.cardSupport.poison[userId]) {
              delete room.cardSupport.poison[userId];
              if (room.cardSupport.poisonPower) delete room.cardSupport.poisonPower[userId];
            }
            poisonDamage = roomDamage(db, expedition, room, poisonPower, now);
          }
          const response = enemyResponsePlan(room, state, userId);
          const { intent, incoming } = response;
          let responseReason = response.reason;
          const ward = room.cardSupport?.ward;
          if (response.allyWardUsed) {
            delete room.cardSupport.ward;
            events.push({ type: 'card_ally_ward', owner: ward.owner });
          }
          let damage = response.damage;
          if (damage > 0) {
            const shield = consumeRoomEffect(db, { expeditionId, roomId: room.id, effectType: ROLE_EFFECT_TYPES.knight, now });
            if (shield) { damage = 0; responseReason = 'room_shield'; events.push(shield.event); }
          }
          artifactMember.heroHp = hp;
          const beforeArtifact = damage;
          damage = applyWearerDamageProtection({ member: artifactMember, expeditionId, roomKey: room.key,
            damage, damageSource: 'combat', events, artifactsDisabled });
          if (damage < beforeArtifact) responseReason = 'relic';
          hp = Math.max(0, hp - damage);
          if (damage > 0 && intent.kind === 'drain') { room.progress = Math.max(0, room.progress - 2); updateRoom(db, expeditionId, room); }
          else if (ward?.charges > 0 && ward.owner !== userId && incoming === 0 && !state.dodge) updateRoom(db, expeditionId, room);
          const overheated = row.role === 'mage' && state.resource >= 4;
          if (overheated) hp = Math.max(0, hp - 1);
          if (row.role === 'mage') state.resource = Math.max(0, state.resource - 1);
          if (hp <= 0) recoverAt = now + RECOVERY_SECONDS;
          const blocked = Math.min(incoming, state.block);
          let counterDamage = 0;
          if (room.state === 'unlocked' && incoming > 0 && blocked >= incoming && state.counter > 0) {
            counterDamage = roomDamage(db, expedition, room, state.counter, now);
          }
          if (poisonDamage + counterDamage > 0) db.prepare(`UPDATE family_expedition_members
            SET contribution_progress = contribution_progress + ? WHERE expedition_id = ? AND user_id = ?`)
            .run(poisonDamage + counterDamage, expeditionId, userId);
          state.discard.push(...state.hand.map(card => card.cardId)); state.hand = [];
          state.active = false; state.energy = 0; state.block = 0;
          state.counter = 0; state.echo = false;
          events.push({ type: 'card_end', damage, blocked, overheated, poisonDamage, counterDamage, responseReason });
        }
      }
    }
    db.prepare('UPDATE family_expedition_members SET hero_hp = ?, hero_recover_at = ? WHERE expedition_id = ? AND user_id = ?')
      .run(hp, recoverAt || null, expeditionId, userId);
    db.prepare('UPDATE family_expedition_members SET loadout_json = ? WHERE expedition_id = ? AND user_id = ?')
      .run(JSON.stringify({ slots: artifactMember.loadout, triggerHistory: artifactMember.triggerHistory }), expeditionId, userId);
    state.revision++; state.lastEvent = { revision: state.revision, ...events.at(-1) };
    saveState(db, expeditionId, userId, state, now);
    insertAction(db, { idempotencyKey, expeditionId, roomId: room.id, userId,
      actionType: `card_${operation}`, modifiers: { cardIntent: intent, events },
      progressAwarded: events.reduce((sum, event) => sum + (event.type === 'card_play' ? event.damage : (event.poisonDamage || 0) + (event.counterDamage || 0)), 0), now });
    return { events };
  }).immediate();
}

function assertNoCardTurn(db, expeditionId, userId) {
  const row = db.prepare('SELECT state_json FROM family_expedition_card_states WHERE expedition_id = ? AND user_id = ?').get(expeditionId, userId);
  if (row && parse(row.state_json).active) throw new RangeError('Finish your saved card turn first');
}

function applyCardSupply(db, { expeditionId, userId, role, roomKey, kind, cardId, revision, now }) {
  if (!db.inTransaction) throw new TypeError('Supply changes require a caller transaction');
  const state = loadState(db, expeditionId, userId, role);
  if (state.active && state.roomKey !== roomKey) fail('Use supplies in the room of your saved hand');
  let detail = '';
  if (kind === 'lucky_breakfast') {
    if (!state.active || state.hand.length >= 8) fail('Draw a hand with room for more cards first');
    const before = state.hand.length;
    deal(state, 2, crypto.randomInt);
    if (state.hand.length === before) fail('No cards are available to draw');
    detail = `Drew ${state.hand.length-before} cards`;
  }
  if (kind === 'warm_milk') {
    if (!state.active || state.energy >= 6) fail('Draw a hand with fewer than 6 energy first');
    state.energy++; detail = '+1 energy';
  }
  if (kind === 'campfire_charm') {
    if (!state.active || state.hand.length >= 8) fail('Draw a hand with room for a card first');
    if (!Number.isInteger(revision) || state.revision !== revision) fail('The hand changed. Choose a discarded card again.');
    const index = state.discard.indexOf(cardId);
    if (index < 0 || !CARDS[cardId]) fail('Choose a card from your current discard');
    state.discard.splice(index, 1);
    state.hand.push({ cardId, instanceId:crypto.randomUUID() });
    detail = `Recovered ${CARDS[cardId].name}`;
  }
  state.revision++;
  state.lastEvent = { type:'card_supply', revision:state.revision, supplyId:kind, detail };
  saveState(db, expeditionId, userId, state, now);
}

module.exports = { viewCardCombat, cardCommand, isCardExpedition, isCombat, assertNoCardTurn, RECOVERY_SECONDS,
  readCardSupplyState:loadState, applyCardSupply };
