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

function artifactUseEligibility({ artifactId, state = {} } = {}) {
  const artifact = ARTIFACTS[artifactId];
  if (!artifact) return { allowed: false, reason: 'This artifact no longer exists.' };
  if (artifact.useType !== 'active') {
    return { allowed: false, reason: 'This is a passive artifact. It works automatically while equipped.' };
  }
  if (!roomIsCurrent(state)) {
    return { allowed: false, reason: 'Choose a current open room before using this artifact.' };
  }
  if (state.heroHp <= 0 && artifactId !== 'phoenix_feather') {
    return { allowed: false, reason: 'Your hero is knocked out. Only a Phoenix Feather can be used during recovery.' };
  }

  const rules = {
    chalk_rune: () => !state.hasMinigame
      ? 'Chalk Rune can only be used in a mini-game room.'
      : state.minigameTimeBonus
        ? 'A Chalk Rune bonus is already waiting for the next attempt in this room.'
        : null,
    bone_die: () => !state.combat
      ? 'Bone Die can only be armed in a combat room.'
      : state.combatRollFloor
        ? 'A damage floor is already armed for this room.'
        : null,
    wooden_shield: () => !state.combat
      ? 'Wooden Shield can only be used in a combat room.'
      : state.personalDamageShield
        ? 'Your hero already has personal protection armed in this room.'
        : null,
    tiny_shovel: () => state.roomType === 'boss'
      ? 'Tiny Shovel cannot damage a boss.'
      : (state.roomProgress ?? 0) >= (state.roomProgressTarget ?? 0)
        ? 'This room no longer needs progress.'
        : null,
    ration_box: () => state.heroHp >= state.maxHeroHp
      ? 'Your hero already has full HP.'
      : null,
    rusty_lockpick: () => !state.hasMinigame || state.combat
      ? 'Rusty Lockpick can only be used in a noncombat mini-game room.'
      : state.minigameAutoSuccess
        ? 'An automatic mini-game success is already armed in this room.'
        : null,
    loaded_die: () => !state.combat ? 'Loaded Die can only be used in a combat room.' : null,
    warding_nail: () => !state.combat
      ? 'Warding Nail can only be placed in a combat room.'
      : state.roomShield
        ? 'A shared shield is already active in this room.'
        : null,
    second_chance_coin: () => !state.hasMinigame || state.combat
      ? 'Second Chance Coin can only be placed in a noncombat mini-game room.'
      : state.roomRetry
        ? 'A shared free retry is already active in this room.'
        : null,
    campfire_charm: () => (state.roleCharge ?? 0) >= 1
      ? 'Your class ability is already ready.'
      : null,
    phoenix_feather: () => state.heroHp > 0 || !state.heroRecoverAt
      ? 'Phoenix Feather can only be used while your hero is knocked out.'
      : null,
    hourglass_shard: () => state.ap >= state.maxAp ? 'Your AP is already full.' : null,
    crooked_compass: () => state.bonusArtifactRoll
      ? 'An extra artifact reward is already armed for this room.'
      : null,
    fates_broken_die: () => !state.combat
      ? "Fate's Broken Die can only be used in a combat room."
      : null,
  };
  const reason = rules[artifactId]?.() || null;
  return { allowed: !reason, reason };
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
  const eligibility = artifactUseEligibility({ artifactId, state });
  if (!eligibility.allowed) {
    return {
      applied: false,
      reason: eligibility.reason,
      state: clone(state),
      visualEvent: null,
    };
  }
  const nextState = clone(state);
  const handler = ACTIVE_EFFECT_HANDLERS[artifact.effect.kind];
  const applied = Boolean(handler?.(nextState, artifact.effect));
  return {
    applied,
    reason: applied ? null : 'This artifact cannot be activated in the current room state.',
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
    if (equipped.has('crown_of_twenty') && state.rawRoll === 20) {
      state.progress = (state.progress || 0) + ARTIFACTS.crown_of_twenty.effect.amount;
    }
    if (equipped.has('bent_sword') && state.roomType !== 'boss'
      && state.combatRoll >= 16 && state.combatRoll <= 19) {
      state.progress = (state.progress || 0) + 1;
    }
    for (const artifactId of ['rootcutters_axe', 'root_kings_signet']) {
      const effect = ARTIFACTS[artifactId].effect;
      if (equipped.has(artifactId) && state.roomType === 'boss'
        && state.combatHit !== false && state.combatRoll >= effect.minRoll) {
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
  artifactUseEligibility,
  applyActiveArtifact,
  applyArtifactEffects,
  applyPassiveArtifactEffects,
};
