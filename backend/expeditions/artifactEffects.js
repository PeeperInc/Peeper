'use strict';

const { ARTIFACTS } = require('./catalog');

const CORE_HOOKS = Object.freeze([
  'before_roll',
  'after_roll',
  'before_progress',
  'after_progress',
  'before_loot',
  'room_reveal',
]);

const ARTIFACT_HOOKS = Object.freeze([
  ...CORE_HOOKS,
  'before_assist',
  'after_assist',
  'before_debuff',
  'before_complication',
  'failed_attempt',
]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function includesEvery(actual = [], expected = []) {
  return expected.every(value => actual.includes(value));
}

function matchesContext(state, config) {
  if (config.stats && !config.stats.includes(state.stat)) return false;
  if (config.roomTypes && !config.roomTypes.includes(state.roomType)) return false;
  if (config.excludeRoomTypes?.includes(state.roomType)) return false;
  if (config.roomTags && !includesEvery(state.roomTags, config.roomTags)) return false;
  if (config.requiredRoomTags && !includesEvery(state.roomTags, config.requiredRoomTags)) return false;
  if (config.actionTags && !includesEvery(state.actionTags, config.actionTags)) return false;
  if (config.modifierTags && !includesEvery(state.modifierTags, config.modifierTags)) return false;
  if (config.rawRolls && !config.rawRolls.includes(state.rawRoll)) return false;
  if (config.minimumModifiedRoll !== undefined && state.modifiedRoll < config.minimumModifiedRoll) return false;
  if (config.criticalOnly && !state.critical) return false;
  if (config.whenProgressBelow !== undefined && state.progress >= config.whenProgressBelow) return false;
  if (config.debuffTypes && !config.debuffTypes.includes(state.debuff?.type)) return false;
  if (config.sourceTags && !includesEvery(state.roomTags, config.sourceTags)) return false;
  return true;
}

function scopeKey(state, scope) {
  if (scope === 'day') return String(state.dayKey ?? 'unknown');
  if (scope === 'boss_phase') return `${state.expeditionId ?? 'unknown'}:${state.bossPhase ?? 'unknown'}`;
  if (scope === 'expedition') return String(state.expeditionId ?? 'unknown');
  return String(state.phase);
}

function historyCount(state, artifactId, scope, key) {
  return state.triggerHistory
    .filter(entry => entry.artifactId === artifactId && entry.scope === scope && entry.key === key)
    .reduce((total, entry) => total + (entry.count || 1), 0);
}

function withinLimit(state, artifactId, limit) {
  if (!limit) return true;
  const key = scopeKey(state, limit.scope);
  return historyCount(state, artifactId, limit.scope, key) < limit.count;
}

function recordTrigger(state, artifactId, limit) {
  const scope = limit?.scope || 'trigger';
  const key = scopeKey(state, scope);
  const existing = state.triggerHistory.find(entry =>
    entry.artifactId === artifactId && entry.scope === scope && entry.key === key);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
  } else {
    state.triggerHistory.push({ artifactId, scope, key, count: 1 });
  }
}

function randomPass(state, chance = 1) {
  return chance >= 1 || state.rng() < chance;
}

function randomInteger(state, min, max) {
  return min + Math.floor(state.rng() * (max - min + 1));
}

function addEvent(state, type, payload = {}) {
  state.events.push({ type, ...payload });
  return true;
}

const EFFECT_HANDLERS = Object.freeze({
  roll_bonus(state, config) {
    state.modifier += config.amount;
    return true;
  },
  assist_bonus(state, config) {
    state.assist += config.amount;
    return true;
  },
  reroll(state, config) {
    const nextRoll = state.rolls.shift() ?? randomInteger(state, 1, 20);
    state.rawRoll = config.keep === 'higher' ? Math.max(state.rawRoll, nextRoll) : nextRoll;
    return addEvent(state, 'reroll', { roll: nextRoll });
  },
  reveal_room_hint(state, config) {
    state.revealHints += config.count;
    return true;
  },
  camp_effect_bonus(state, config) {
    state.campEffectBonus += config.amount;
    return true;
  },
  ignore_modifier(state, config) {
    state.ignoredModifierTags.push(...config.modifierTags);
    return true;
  },
  reduce_debuff(state, config) {
    if (!state.debuff) return false;
    state.debuff.amount = Math.max(0, (state.debuff.amount || 0) - config.amount);
    return true;
  },
  store_shrine_buff(state, config) {
    if (!state.shrineBuff) return false;
    state.storedBuff = { ...clone(state.shrineBuff), reusable: Boolean(config.reusable) };
    return true;
  },
  helper_bonus(state, config) {
    state.modifier += Math.min(config.maximum, state.helpers * config.amountPerHelper);
    return true;
  },
  reflect_debuff(state) {
    if (!state.debuff) return false;
    state.reflectedDebuff = clone(state.debuff);
    state.debuff = null;
    return true;
  },
  reveal_adjacent_room(state, config) {
    const room = state.adjacentRooms.find(candidate =>
      candidate.state === 'hidden' && (!config.optionalOnly || candidate.optional));
    if (!room) return false;
    state.revealedRoomKeys.push(room.key);
    return true;
  },
  bonus_coins(state, config) {
    if (!randomPass(state, config.chance)) return false;
    state.coins += randomInteger(state, config.coins.min, config.coins.max);
    return true;
  },
  prevent_debuff(state) {
    if (!state.debuff) return false;
    state.debuff = null;
    state.debuffPrevented = true;
    return true;
  },
  copy_support(state, config) {
    if (state.support <= 0) return false;
    state.modifier += config.amount;
    return true;
  },
  restore_role_ability(state) {
    if (!state.roleAbilityUsed) return false;
    state.roleAbilityRestored = true;
    return true;
  },
  identify_mimic(state) {
    if (!state.roomTags.includes('mimic')) return false;
    state.mimicIdentified = true;
    return true;
  },
  prevent_complication(state) {
    if (!state.complication) return false;
    state.complication = null;
    state.complicationPrevented = true;
    return true;
  },
  raise_raw_roll(state, config) {
    if (state.rawRoll >= config.below) return false;
    state.rawRoll = config.value;
    return true;
  },
  multiply_coins(state, config) {
    if (!randomPass(state, config.chance)) return false;
    state.coinMultiplier *= config.multiplier;
    return true;
  },
  recover_ap(state, config) {
    state.apRecovered += config.amount;
    return true;
  },
  clear_debuff(state) {
    if (!state.debuff) return false;
    state.debuff = null;
    return true;
  },
  open_hidden_branch(state) {
    const branch = state.hiddenBranches.find(candidate => candidate.state === 'hidden');
    if (!branch) return false;
    state.openedBranchKeys.push(branch.key);
    return true;
  },
  add_room_progress(state, config) {
    state.progress += config.amount;
    return true;
  },
  minimum_progress(state, config) {
    state.progress = Math.max(state.progress, config.minimum);
    return true;
  },
  success_streak_loot(state, config) {
    if (state.successStreak < config.successesRequired || !randomPass(state, config.chance)) return false;
    state.artifactRolls += 1;
    if (!state.success) state.successStreak = 0;
    return true;
  },
  grant_personal_roll_buff(state, config) {
    state.personalRollBuff = { amount: config.amount, uses: config.uses };
    return true;
  },
  reveal_all_optional_rooms(state) {
    const roomKeys = state.optionalRooms
      .filter(room => room.state === 'hidden')
      .map(room => room.key);
    if (roomKeys.length === 0) return false;
    state.revealedRoomKeys.push(...roomKeys);
    return true;
  },
  critical_threshold(state, config) {
    state.criticalThreshold = Math.min(state.criticalThreshold, config.minimumRawRoll);
    state.critical = state.critical || state.rawRoll >= state.criticalThreshold;
    return true;
  },
  phase_progress_bonus(state, config) {
    state.progress += config.amount;
    return true;
  },
  choose_roll(state, config) {
    const candidates = state.rolls.splice(0, config.rolls);
    while (candidates.length < config.rolls) candidates.push(randomInteger(state, 1, 20));
    state.rawRoll = config.choose === 'higher' ? Math.max(...candidates) : candidates[0];
    return addEvent(state, 'choose_roll', { rolls: candidates });
  },
  clear_room(state) {
    state.clearRoom = true;
    return true;
  },
});

function createEffectState(context) {
  return {
    ...clone(context),
    phase: context.phase,
    loadout: clone(context.loadout || []),
    triggerHistory: clone(context.triggerHistory || []),
    triggered: [],
    events: clone(context.events || []),
    modifier: context.modifier || 0,
    rawRoll: context.rawRoll ?? 0,
    modifiedRoll: context.modifiedRoll ?? context.rawRoll ?? 0,
    progress: context.progress || 0,
    coins: context.coins || 0,
    coinMultiplier: context.coinMultiplier || 1,
    artifactRolls: context.artifactRolls || 0,
    apRecovered: context.apRecovered || 0,
    assist: context.assist || 0,
    helpers: context.helpers || 0,
    support: context.support || 0,
    successStreak: context.successStreak || 0,
    roomTags: clone(context.roomTags || []),
    actionTags: clone(context.actionTags || []),
    modifierTags: clone(context.modifierTags || []),
    ignoredModifierTags: clone(context.ignoredModifierTags || []),
    rolls: clone(context.rolls || []),
    adjacentRooms: clone(context.adjacentRooms || []),
    optionalRooms: clone(context.optionalRooms || []),
    hiddenBranches: clone(context.hiddenBranches || []),
    revealedRoomKeys: clone(context.revealedRoomKeys || []),
    openedBranchKeys: clone(context.openedBranchKeys || []),
    revealHints: context.revealHints || 0,
    campEffectBonus: context.campEffectBonus || 0,
    criticalThreshold: context.criticalThreshold || 20,
    rng: typeof context.rng === 'function' ? context.rng : () => 0,
  };
}

function slotCanTrigger(slot, behavior) {
  if (slot.exhausted) return false;
  if (behavior.type === 'charged') return (slot.charges ?? behavior.initialCharges ?? 0) > 0;
  if (behavior.type === 'consumable') return (slot.quantity ?? 1) > 0;
  return true;
}

function consumeSlot(slot, behavior) {
  if (!behavior.consumeOnTrigger) return;
  if (behavior.type === 'charged') {
    slot.charges = Math.max(0, (slot.charges ?? behavior.initialCharges ?? 0) - 1);
    slot.exhausted = slot.charges === 0;
  } else if (behavior.type === 'consumable') {
    slot.quantity = Math.max(0, (slot.quantity ?? 1) - 1);
    slot.exhausted = slot.quantity === 0;
  }
}

function finalizeState(state) {
  delete state.rng;
  return state;
}

function applyArtifactEffects(context) {
  if (!context || !ARTIFACT_HOOKS.includes(context.phase)) {
    throw new TypeError('A valid artifact effect phase is required');
  }
  const state = createEffectState(context);
  if (context.artifactsDisabled) return finalizeState(state);

  for (const slot of state.loadout) {
    const artifact = ARTIFACTS[slot.artifactId];
    if (!artifact) continue;
    const drawback = artifact.effect.config?.drawback;
    if (drawback?.trigger === state.phase) {
      if (drawback.type === 'reset_streak') state.successStreak = 0;
      state.triggered.push(artifact.id);
      recordTrigger(state, artifact.id);
      continue;
    }
    if (artifact.effect.trigger !== state.phase) continue;
    if (!slotCanTrigger(slot, artifact.behavior)) continue;
    const { config = {} } = artifact.effect;
    if (!matchesContext(state, config)) continue;
    if (!withinLimit(state, artifact.id, config.limit)) continue;
    const handler = EFFECT_HANDLERS[artifact.effect.type];
    if (!handler || !handler(state, config, slot)) continue;

    state.triggered.push(artifact.id);
    recordTrigger(state, artifact.id, config.limit);
    consumeSlot(slot, artifact.behavior);
  }

  return finalizeState(state);
}

module.exports = {
  ARTIFACT_HOOKS,
  CORE_HOOKS,
  EFFECT_HANDLERS,
  applyArtifactEffects,
  createEffectState,
};
