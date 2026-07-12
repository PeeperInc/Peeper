import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ARTIFACTS } = require('./catalog.js');
const {
  ALLOWED_EFFECT_KINDS,
  applyActiveArtifact,
  applyPassiveArtifactEffects,
} = require('./artifactEffects.js');

const EXPECTED_KINDS = [
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
];

const ACTIVE_CONTEXTS = {
  chalk_rune: { roomKey: 'room-a', roomState: 'unlocked', hasMinigame: true },
  bone_die: { roomKey: 'room-a', roomState: 'unlocked', combat: true },
  wooden_shield: { roomKey: 'room-a', roomState: 'unlocked' },
  tiny_shovel: { roomKey: 'room-a', roomState: 'unlocked', roomType: 'trap', roomProgress: 1, roomProgressTarget: 5 },
  ration_box: { roomKey: 'room-a', roomState: 'unlocked', heroHp: 2, maxHeroHp: 3 },
  rusty_lockpick: { roomKey: 'room-a', roomState: 'unlocked', hasMinigame: true, combat: false },
  loaded_die: { roomKey: 'room-a', roomState: 'unlocked', combat: true },
  warding_nail: { roomKey: 'room-a', roomState: 'unlocked' },
  second_chance_coin: { roomKey: 'room-a', roomState: 'unlocked' },
  campfire_charm: { roomKey: 'room-a', roomState: 'unlocked', roleCharge: 0 },
  phoenix_feather: { roomKey: 'room-a', roomState: 'unlocked', heroHp: 0, heroRecoverAt: 999 },
  hourglass_shard: { roomKey: 'room-a', roomState: 'unlocked', ap: 2, maxAp: 5 },
  crooked_compass: { roomKey: 'room-a', roomState: 'unlocked', scoutChoices: ['room-b', 'room-c'] },
  fates_broken_die: { roomKey: 'room-a', roomState: 'unlocked', combat: true },
};

test('effect dispatch exposes only the current-system kinds', () => {
  assert.deepEqual([...ALLOWED_EFFECT_KINDS].sort(), [...EXPECTED_KINDS].sort());
  assert.deepEqual(
    [...new Set(Object.values(ARTIFACTS).map(({ effect }) => effect.kind))].sort(),
    [...EXPECTED_KINDS].sort(),
  );
});

test('every active artifact applies to its valid current-system context', () => {
  const expected = {
    chalk_rune: ['minigameTimeBonus', 3],
    bone_die: ['combatRollFloor', 10],
    wooden_shield: ['personalDamageShield', 1],
    tiny_shovel: ['roomProgress', 3],
    ration_box: ['heroHp', 3],
    rusty_lockpick: ['minigameAutoSuccess', true],
    loaded_die: ['combatAdvantageUses', 1],
    warding_nail: ['placeRoomShield', true],
    second_chance_coin: ['placeRoomRetry', true],
    campfire_charm: ['roleCharge', 1],
    phoenix_feather: ['heroHp', 3],
    hourglass_shard: ['ap', 4],
    crooked_compass: ['bonusArtifactRoll', 1],
    fates_broken_die: ['combatAdvantageUses', 3],
  };

  for (const [artifactId, state] of Object.entries(ACTIVE_CONTEXTS)) {
    const result = applyActiveArtifact({ artifactId, state });
    const [property, value] = expected[artifactId];
    assert.equal(result.applied, true, artifactId);
    assert.equal(result.state[property], value, artifactId);
    assert.equal(result.visualEvent.type, 'artifact_used', artifactId);
    assert.equal(result.visualEvent.artifactId, artifactId, artifactId);
    if (artifactId === 'phoenix_feather') assert.equal(result.state.heroRecoverAt, null);
  }
});

test('every active artifact rejects an inapplicable use without mutating state', () => {
  const invalid = {
    chalk_rune: { roomState: 'cleared', hasMinigame: true },
    bone_die: { roomState: 'unlocked', combat: false },
    wooden_shield: { roomState: 'cleared' },
    tiny_shovel: { roomState: 'unlocked', roomType: 'boss', roomProgress: 1, roomProgressTarget: 5 },
    ration_box: { roomState: 'unlocked', heroHp: 3, maxHeroHp: 3 },
    rusty_lockpick: { roomState: 'unlocked', hasMinigame: true, combat: true },
    loaded_die: { roomState: 'unlocked', combat: false },
    warding_nail: { roomState: 'unlocked', roomShield: true },
    second_chance_coin: { roomState: 'unlocked', roomRetry: true },
    campfire_charm: { roomState: 'unlocked', roleCharge: 1 },
    phoenix_feather: { roomState: 'unlocked', heroHp: 1, heroRecoverAt: null },
    hourglass_shard: { roomState: 'unlocked', ap: 5, maxAp: 5 },
    crooked_compass: { roomState: 'unlocked', scoutChoices: ['room-b'] },
    fates_broken_die: { roomState: 'unlocked', combat: false },
  };

  for (const [artifactId, state] of Object.entries(invalid)) {
    const result = applyActiveArtifact({ artifactId, state });
    assert.equal(result.applied, false, artifactId);
    assert.deepEqual(result.state, state, artifactId);
    assert.equal(result.visualEvent, null, artifactId);
  }
});

test('Crooked Compass arms an extra artifact reward for any class', () => {
  const result = applyActiveArtifact({
    artifactId: 'crooked_compass',
    state: { roomKey: 'room-a', roomState: 'unlocked', role: 'scout', roleCharge: 0 },
  });
  assert.equal(result.applied, true);
  assert.equal(result.state.bonusArtifactRoll, 1);
  assert.equal(result.state.roleCharge, 0);
});

test('active dispatch rejects passive and unknown artifacts', () => {
  assert.throws(() => applyActiveArtifact({ artifactId: 'old_torch', state: {} }), /not active/);
  assert.throws(() => applyActiveArtifact({ artifactId: 'removed_legacy_item', state: {} }), /Unknown artifact/);
});

test('passives apply for the whole expedition and preserve equipped slots', () => {
  const loadout = [
    { artifactId: 'old_torch' },
    { artifactId: 'family_banner' },
    { artifactId: 'mimic_tooth' },
  ];
  const minigame = applyPassiveArtifactEffects({
    phase: 'minigame_setup',
    loadout,
    timeLimitMs: 10000,
    successWindowMultiplier: 1,
  });
  const recharge = applyPassiveArtifactEffects({ phase: 'role_recharge', loadout, roleRechargeThreshold: 3 });
  const reward = applyPassiveArtifactEffects({ phase: 'room_reward', loadout, coins: 7 });

  assert.equal(minigame.timeLimitMs, 11000);
  assert.equal(minigame.successWindowMultiplier, 1.1);
  assert.equal(recharge.roleRechargeThreshold, 2);
  assert.equal(reward.coins, 10);
  assert.deepEqual(minigame.loadout, loadout);
  assert.deepEqual(recharge.loadout, loadout);
  assert.deepEqual(reward.loadout, loadout);
});

test('Crown upgrades a natural 19 combat outcome without triggering Emerald Heart healing', () => {
  const loadout = [
    { artifactId: 'crown_of_twenty' },
    { artifactId: 'emerald_heart' },
  ];
  const combat = applyPassiveArtifactEffects({
    phase: 'combat_roll',
    loadout,
    roomType: 'combat',
    rawRoll: 19,
    combatRoll: 19,
    progress: 2,
    heroHp: 2,
    maxHeroHp: 3,
  });
  assert.equal(combat.critical, true);
  assert.equal(combat.progress, 3);
  assert.equal(combat.heroHp, 2);

  const naturalTwenty = applyPassiveArtifactEffects({
    phase: 'combat_roll',
    loadout,
    roomType: 'combat',
    rawRoll: 20,
    combatRoll: 20,
    critical: true,
    progress: 3,
    heroHp: 2,
    maxHeroHp: 3,
  });
  assert.equal(naturalTwenty.heroHp, 3);
});

test('combat passives implement one-time protection rules', () => {
  const protectedOnce = applyPassiveArtifactEffects({
    phase: 'personal_damage',
    loadout: [{ artifactId: 'rabbit_foot' }, { artifactId: 'last_stand_banner' }],
    damageSource: 'combat',
    damage: 1,
    heroHp: 3,
    triggerHistory: [],
  });
  assert.equal(protectedOnce.damage, 0);
  assert.equal(protectedOnce.triggerHistory.length, 1);

  const lethal = applyPassiveArtifactEffects({
    phase: 'personal_damage',
    loadout: [{ artifactId: 'rabbit_foot' }, { artifactId: 'last_stand_banner' }],
    damageSource: 'combat',
    damage: 3,
    heroHp: 3,
    triggerHistory: protectedOnce.triggerHistory,
  });
  assert.equal(lethal.damage, 2);
  assert.equal(lethal.triggerHistory.length, 2);
});

test('boss bonus passives use their distinct success thresholds', () => {
  const lowSuccess = applyPassiveArtifactEffects({
    phase: 'combat_roll',
    loadout: [{ artifactId: 'rootcutters_axe' }, { artifactId: 'root_kings_signet' }],
    roomType: 'boss',
    rawRoll: 10,
    combatRoll: 10,
    progress: 1,
  });
  const highSuccess = applyPassiveArtifactEffects({
    phase: 'combat_roll',
    loadout: [{ artifactId: 'rootcutters_axe' }, { artifactId: 'root_kings_signet' }],
    roomType: 'boss',
    rawRoll: 16,
    combatRoll: 16,
    progress: 2,
  });
  assert.equal(lowSuccess.progress, 2);
  assert.equal(highSuccess.progress, 4);
});

test('unsupported legacy loadout entries safely no-op', () => {
  const context = { phase: 'room_reward', loadout: [{ artifactId: 'removed_legacy_item' }], coins: 5 };
  assert.deepEqual(applyPassiveArtifactEffects(context), context);
});
