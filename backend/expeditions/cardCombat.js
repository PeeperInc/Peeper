'use strict';

const crypto = require('node:crypto');
const { CARD_MODE, ENERGY_PER_TURN, HAND_SIZE, MAX_DECK_SIZE, CARDS, CLASS_RULES, starterDeck, enemyIntent } = require('./cardCatalog');
const { ROOM_TEMPLATES } = require('./catalog');
const { regenerateAp, recoverHeroIfReady, updateRoom, persistUnlocks, insertAction,
  armedEffect, consumeArmedEffect, applyWearerDamageProtection } = require('./engine');
const { consumeRoomEffect, ROLE_EFFECT_TYPES } = require('./roleEffects');
const { assertGlobalIdempotencyKeyUnused } = require('./minigameAttempts');

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
    block: 0, retainedBlock: 0, resource: 0, dodge: false, weaken: 0,
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

function viewCardCombat(db, expedition, userId) {
  if (!isCardExpedition(expedition)) return null;
  const expeditionId = expedition.id;
  const member = db.prepare('SELECT * FROM family_expedition_members WHERE expedition_id = ? AND user_id = ?').get(expeditionId, userId);
  if (!member) return { enabled: true, classes: CLASS_RULES, turn: null };
  const state = loadState(db, expeditionId, userId, member.role);
  const rooms = roomsFor(db, expeditionId);
  const target = rooms.find(room => room.key === state.roomKey);
  const visibleRooms = rooms.filter(room => room.state === 'unlocked' && isCombat(room));
  return {
    enabled: true, revision: state.revision, role: member.role, class: CLASS_RULES[member.role],
    classes: CLASS_RULES, energyPerTurn: ENERGY_PER_TURN, handSize: HAND_SIZE, maxDeckSize: MAX_DECK_SIZE,
    deckSize: state.deck.length, drawCount: state.drawPile.length, discardCount: state.discard.length,
    hero: db.prepare('SELECT slot_head, slot_body, slot_hands, slot_fren, slot_face FROM peepers WHERE user_id = ?').get(userId) || { alive: true },
    deck: [...new Set(state.deck)].map(id => ({ ...CARDS[id], copies: state.deck.filter(cardId => cardId === id).length })),
    resource: state.resource, turnNumber: state.turnNumber, lastEvent: state.lastEvent,
    intents: Object.fromEntries(visibleRooms.map(room => [room.key, enemyIntent(room, state.active ? state.turnNumber : state.turnNumber + 1)])),
    supports: Object.fromEntries(visibleRooms.map(room => [room.key, room.cardSupport || {}])),
    reward: pendingReward(db, expeditionId, userId, state, member.role),
    turn: state.active ? { number: state.turnNumber, roomKey: state.roomKey, energy: state.energy,
      block: state.block, dodge: state.dodge, weaken: state.weaken, resource: state.resource,
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
      const phase = ROOM_TEMPLATES.boss.find(template => template.phase === Number(room.phase || 1) + 1);
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
      state.attacks = 0;
      state.dodge = false; state.weaken = 0;
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
          if (card.effect === 'mend' && (state.resource < 2 || hp >= 3)) throw new RangeError('Mend needs 2 light and a wounded hero');
          const previousBlock = state.block;
          let damage = card.damage || 0;
          state.energy -= card.cost;
          state.block = Math.min(6, state.block + (card.block || 0));
          state.resource = Math.min(8, state.resource + (card.heat || 0) + (card.light || 0));
          if (card.effect === 'bash') { damage += previousBlock * 3; state.block = 0; }
          if (card.effect === 'retain') state.retainedBlock = 1;
          if (card.effect === 'combo' || card.effect === 'dodge') state.resource = Math.min(6, state.resource + 1);
          if (card.effect === 'dodge') state.dodge = true;
          if (card.effect === 'finisher') { damage += state.resource * 3; state.resource = 0; }
          if (card.effect === 'vent') { state.resource = Math.max(0, state.resource - 3); state.energy = Math.min(6, state.energy + 1); }
          if (card.effect === 'discharge' || card.effect === 'judgement') { damage += state.resource * 2; state.resource = 0; }
          if (card.effect === 'mend') { state.resource -= 2; hp = Math.min(3, hp + 1); }
          if (card.effect === 'weaken') state.weaken = 1;
          const support = room.cardSupport ||= {};
          if (card.effect === 'ward') support.ward = { owner: userId, charges: 1 };
          if (card.effect === 'expose') support.expose = 2;
          if (damage > 0) {
            if (!artifactsDisabled) {
              const floor = armedEffect(artifactMember, 'combat_roll_floor', room.key);
              if (floor) { damage = Math.max(3, damage); consumeArmedEffect(artifactMember, floor); }
              const boost = armedEffect(artifactMember, 'combat_advantage', room.key) || armedEffect(artifactMember, 'multi_combat_advantage', room.key);
              if (boost) { damage++; consumeArmedEffect(artifactMember, boost); }
              if (!state.attacks && equipped.has(room.type === 'boss' ? 'rootcutters_axe' : 'bent_sword')) damage++;
              if (room.type === 'boss' && equipped.has('root_kings_signet')) damage++;
              if (state.hand.length === 1) {
                if (equipped.has('crown_of_twenty')) damage += 2;
                if (equipped.has('emerald_heart')) hp = Math.min(3, hp + 1);
              }
            }
            state.attacks = (state.attacks || 0) + 1;
            if (support.expose > 0) { damage += 2; support.expose--; }
            const provision = parse(row.provision_state_json);
            const bonus = provision.damageBonus;
            if (bonus && (!bonus.roomKey || bonus.roomKey === room.key) && (bonus.persistent || bonus.roomKey || bonus.uses > 0)) {
              damage += Math.max(0, Number(bonus.amount || 0));
              if (!bonus.persistent && !bonus.roomKey && bonus.uses > 0) {
                bonus.uses--; db.prepare('UPDATE family_expedition_members SET provision_state_json = ? WHERE expedition_id = ? AND user_id = ?')
                  .run(JSON.stringify(provision), expeditionId, userId);
              }
            }
            damage = roomDamage(db, expedition, room, damage, now);
            db.prepare(`UPDATE family_expedition_members SET contribution_progress = contribution_progress + ?
              WHERE expedition_id = ? AND user_id = ?`).run(damage, expeditionId, userId);
          } else updateRoom(db, expeditionId, room);
          state.discard.push(state.hand[index].cardId); state.hand.splice(index, 1);
          events.push({ type: 'card_play', cardId: card.id, name: card.name, damage,
            block: state.block, healed: card.effect === 'mend' ? 1 : 0, roomCleared: room.state === 'cleared' });
        } else if (operation === 'end') {
          const intent = room.state === 'unlocked' ? enemyIntent(room, state.turnNumber) : null;
          let incoming = intent ? Math.max(0, intent.damage - state.weaken) : 0;
          if (state.dodge) incoming = 0;
          const ward = room.cardSupport?.ward;
          if (incoming > state.block && ward?.charges > 0 && ward.owner !== userId) {
            incoming = 0; delete room.cardSupport.ward;
            events.push({ type: 'card_ally_ward', owner: ward.owner });
          }
          let damage = Math.max(0, incoming - state.block);
          if (damage > 0) {
            const shield = consumeRoomEffect(db, { expeditionId, roomId: room.id, effectType: ROLE_EFFECT_TYPES.knight, now });
            if (shield) { damage = 0; events.push(shield.event); }
          }
          artifactMember.heroHp = hp;
          damage = applyWearerDamageProtection({ member: artifactMember, expeditionId, roomKey: room.key,
            damage, damageSource: 'combat', events, artifactsDisabled });
          hp = Math.max(0, hp - damage);
          if (damage > 0 && intent.kind === 'drain') { room.progress = Math.max(0, room.progress - 2); updateRoom(db, expeditionId, room); }
          else if (ward?.charges > 0 && ward.owner !== userId && incoming === 0 && !state.dodge) updateRoom(db, expeditionId, room);
          const overheated = row.role === 'mage' && state.resource >= 4;
          if (overheated) hp = Math.max(0, hp - 1);
          if (row.role === 'mage') state.resource = Math.max(0, state.resource - 1);
          if (hp <= 0) recoverAt = now + RECOVERY_SECONDS;
          const blocked = Math.min(incoming, state.block);
          state.discard.push(...state.hand.map(card => card.cardId)); state.hand = [];
          state.active = false; state.energy = 0; state.block = 0;
          events.push({ type: 'card_end', damage, blocked, overheated });
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
      progressAwarded: events.find(event => event.type === 'card_play')?.damage || 0, now });
    return { events };
  }).immediate();
}

function assertNoCardTurn(db, expeditionId, userId) {
  const row = db.prepare('SELECT state_json FROM family_expedition_card_states WHERE expedition_id = ? AND user_id = ?').get(expeditionId, userId);
  if (row && parse(row.state_json).active) throw new RangeError('Finish your saved card turn first');
}

module.exports = { viewCardCombat, cardCommand, isCardExpedition, isCombat, assertNoCardTurn, RECOVERY_SECONDS };
