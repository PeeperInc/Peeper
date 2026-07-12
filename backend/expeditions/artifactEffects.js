'use strict';

const { ARTIFACTS } = require('./catalog');

const ALLOWED_EFFECT_KINDS = Object.freeze([
  'minigame_time',
  'combat_damage_bonus',
  'minigame_time_once',
  'prevent_personal_damage',
  'combat_roll_floor',
  'room_progress',
  'heal_self',
  'minigame_auto_success',
  'combat_advantage',
  'role_recharge_threshold',
  'boss_damage_bonus',
  'place_room_shield',
  'place_room_retry',
  'restore_role_charge',
  'revive_self',
  'restore_ap',
  'prevent_knockout',
  'critical_heal',
  'scout_choice',
  'coin_multiplier',
  'multi_combat_advantage',
  'critical_threshold',
]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function roomIsCurrent(state) {
  return Boolean(state.roomKey) && !['hidden', 'locked', 'cleared'].includes(state.roomState);
}

const ACTIVE_EFFECT_HANDLERS = Object.freeze({
  minigame_time_once(state, effect) {
    if (!roomIsCurrent(state) || !state.hasMinigame || state.minigameTimeBonus) return false;
    state.minigameTimeBonus = effect.seconds;
    return true;
  },
  combat_roll_floor(state, effect) {
    if (!roomIsCurrent(state) || !state.combat || state.combatRollFloor) return false;
    state.combatRollFloor = effect.floor;
    return true;
  },
  prevent_personal_damage(state, effect) {
    if (!roomIsCurrent(state) || state.personalDamageShield) return false;
    state.personalDamageShield = effect.uses;
    return true;
  },
  room_progress(state, effect) {
    if (!roomIsCurrent(state) || state.roomType === 'boss') return false;
    if ((state.roomProgress ?? 0) >= (state.roomProgressTarget ?? 0)) return false;
    state.roomProgress = Math.min(state.roomProgressTarget, state.roomProgress + effect.amount);
    return true;
  },
  heal_self(state, effect) {
    if (!roomIsCurrent(state) || state.heroHp <= 0 || state.heroHp >= state.maxHeroHp) return false;
    state.heroHp = Math.min(state.maxHeroHp, state.heroHp + effect.amount);
    return true;
  },
  minigame_auto_success(state) {
    if (!roomIsCurrent(state) || !state.hasMinigame || state.combat || state.minigameAutoSuccess) return false;
    state.minigameAutoSuccess = true;
    return true;
  },
  combat_advantage(state, effect) {
    if (!roomIsCurrent(state) || !state.combat) return false;
    state.combatAdvantageUses = (state.combatAdvantageUses || 0) + (effect.uses || 1);
    return true;
  },
  place_room_shield(state) {
    if (!roomIsCurrent(state) || state.roomShield) return false;
    state.placeRoomShield = true;
    return true;
  },
  place_room_retry(state) {
    if (!roomIsCurrent(state) || state.roomRetry) return false;
    state.placeRoomRetry = true;
    return true;
  },
  restore_role_charge(state) {
    if (!roomIsCurrent(state) || (state.roleCharge ?? 0) >= 1) return false;
    state.roleCharge = 1;
    state.roleChargeProgress = 0;
    state.roleChargeReadyAt = 0;
    return true;
  },
  revive_self(state, effect) {
    if (!roomIsCurrent(state) || state.heroHp > 0 || !state.heroRecoverAt) return false;
    state.heroHp = effect.hp;
    state.heroRecoverAt = null;
    return true;
  },
  restore_ap(state, effect) {
    if (!roomIsCurrent(state) || state.ap >= state.maxAp) return false;
    state.ap = Math.min(state.maxAp, state.ap + effect.amount);
    return true;
  },
  scout_choice(state) {
    if (!roomIsCurrent(state) || state.bonusArtifactRoll) return false;
    state.bonusArtifactRoll = 1;
    return true;
  },
  multi_combat_advantage(state, effect) {
    if (!roomIsCurrent(state) || !state.combat) return false;
    state.combatAdvantageUses = (state.combatAdvantageUses || 0) + effect.uses;
    return true;
  },
});

function applyActiveArtifact({ artifactId, state = {} } = {}) {
  const artifact = ARTIFACTS[artifactId];
  if (!artifact) throw new RangeError(`Unknown artifact: ${artifactId}`);
  if (artifact.useType !== 'active') throw new RangeError(`Artifact is not active: ${artifactId}`);
  const nextState = clone(state);
  const handler = ACTIVE_EFFECT_HANDLERS[artifact.effect.kind];
  const applied = Boolean(handler?.(nextState, artifact.effect));
  return {
    applied,
    state: applied ? nextState : clone(state),
    visualEvent: applied ? { type: 'artifact_used', artifactId, effectKind: artifact.effect.kind } : null,
  };
}

function equippedPassiveIds(loadout) {
  return new Set((loadout || [])
    .map(slot => slot?.artifactId)
    .filter(artifactId => ARTIFACTS[artifactId]?.useType === 'expedition_passive'));
}

function triggerUsed(history, artifactId) {
  return (history || []).some(entry => entry.artifactId === artifactId && entry.scope === 'expedition');
}

function recordTrigger(state, artifactId) {
  state.triggerHistory ||= [];
  state.triggerHistory.push({ artifactId, scope: 'expedition', key: String(state.expeditionId ?? 'current'), count: 1 });
}

function applyPassiveArtifactEffects(context = {}) {
  const state = clone(context);
  if (state.artifactsDisabled) return state;
  const equipped = equippedPassiveIds(state.loadout);

  if (state.phase === 'minigame_setup' && equipped.has('old_torch')) {
    state.timeLimitMs = Math.round(state.timeLimitMs * ARTIFACTS.old_torch.effect.multiplier);
    state.successWindowMultiplier = (state.successWindowMultiplier || 1)
      * ARTIFACTS.old_torch.effect.multiplier;
  }
  if (state.phase === 'role_recharge' && equipped.has('family_banner')) {
    state.roleRechargeThreshold = ARTIFACTS.family_banner.effect.threshold;
  }
  if (state.phase === 'room_reward' && equipped.has('mimic_tooth')) {
    state.coins = Math.floor(state.coins * ARTIFACTS.mimic_tooth.effect.multiplier);
  }
  if (state.phase === 'combat_roll') {
    if (equipped.has('crown_of_twenty') && state.rawRoll === 19) {
      state.critical = true;
      state.progress = Math.max(state.progress || 0, 3);
    }
    if (equipped.has('bent_sword') && state.roomType !== 'boss'
      && state.combatRoll >= 16 && state.combatRoll <= 19) {
      state.progress = (state.progress || 0) + 1;
    }
    for (const artifactId of ['rootcutters_axe', 'root_kings_signet']) {
      const effect = ARTIFACTS[artifactId].effect;
      if (equipped.has(artifactId) && state.roomType === 'boss' && state.combatRoll >= effect.minRoll) {
        state.progress = (state.progress || 0) + effect.amount;
      }
    }
    if (equipped.has('emerald_heart') && state.rawRoll === 20 && state.heroHp > 0) {
      state.heroHp = Math.min(state.maxHeroHp || 3, state.heroHp + ARTIFACTS.emerald_heart.effect.amount);
    }
  }
  if (state.phase === 'personal_damage' && state.damage > 0) {
    if (state.damageSource === 'combat' && equipped.has('rabbit_foot')
      && !triggerUsed(state.triggerHistory, 'rabbit_foot')) {
      state.damage = 0;
      state.preventedByArtifactId = 'rabbit_foot';
      recordTrigger(state, 'rabbit_foot');
    } else if (equipped.has('last_stand_banner')
      && !triggerUsed(state.triggerHistory, 'last_stand_banner')
      && state.damage >= state.heroHp) {
      state.damage = Math.max(0, state.heroHp - 1);
      state.preventedByArtifactId = 'last_stand_banner';
      recordTrigger(state, 'last_stand_banner');
    }
  }
  return state;
}

// Task 1-4 orchestration still passes through these lifecycle points. Keeping
// them inert preserves that data flow without retaining any legacy handlers.
function applyArtifactEffects(context = {}) {
  return {
    ...clone(context),
    loadout: clone(context.loadout || []),
    triggerHistory: clone(context.triggerHistory || []),
    triggered: [],
    events: clone(context.events || []),
    modifier: context.modifier || 0,
    rawRoll: context.rawRoll ?? 0,
    progress: context.progress || 0,
    coins: context.coins || 0,
    coinMultiplier: context.coinMultiplier || 1,
    artifactRolls: context.artifactRolls || 0,
    assist: context.assist || 0,
  };
}

module.exports = {
  ACTIVE_EFFECT_HANDLERS,
  ALLOWED_EFFECT_KINDS,
  applyActiveArtifact,
  applyArtifactEffects,
  applyPassiveArtifactEffects,
};
