import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ARTIFACTS } = require('./catalog.js');

const SIX_PHASES = [
  'before_roll',
  'after_roll',
  'before_progress',
  'after_progress',
  'before_loot',
  'room_reveal',
];

const ARTIFACT_EXPECTATIONS = {
  old_torch: ['before_roll', 'modifier', 1],
  bent_sword: ['before_roll', 'modifier', 1],
  chalk_rune: ['before_roll', 'modifier', 2, 'removed'],
  rabbit_foot: ['before_roll', 'modifier', 1],
  rusty_buckle: ['before_progress', 'assist', 1],
  bone_die: ['after_roll', 'rawRoll', 4],
  map_scrap: ['room_reveal', 'revealHints', 1, 'removed'],
  cracked_compass: ['before_roll', 'modifier', 1],
  ration_box: ['after_progress', 'campEffectBonus', 1],
  grave_salt: ['before_roll', 'modifier', 2, 'removed'],
  copper_bell: ['before_roll', 'modifier', 1],
  worn_gloves: ['before_roll', 'modifier', 1],
  moss_amulet: ['before_roll', 'modifier', 2, 'removed'],
  candle_stub: ['before_roll', 'ignoredModifierTags.0', 'darkness'],
  lucky_button: ['after_roll', 'modifier', 1],
  tiny_shovel: ['before_roll', 'modifier', 1],
  wooden_shield: ['before_progress', 'debuff.amount', 1],
  crow_feather: ['before_roll', 'modifier', 1],
  empty_vial: ['after_progress', 'storedBuff.reusable', false],
  rope_knot: ['before_roll', 'modifier', 1],
  rusty_lockpick: ['before_roll', 'modifier', 4, 'charge:2'],
  clerics_bell: ['before_roll', 'modifier', 3],
  loaded_die: ['after_roll', 'rawRoll', 4],
  family_banner: ['before_roll', 'modifier', 3],
  rootcutters_axe: ['before_roll', 'modifier', 3],
  mirror_shard: ['before_progress', 'reflectedDebuff.type', 'cursed', 'charge:0'],
  silver_lantern: ['before_roll', 'modifier', 2],
  mapmakers_lens: ['room_reveal', 'revealedRoomKeys.0', 'optional-1'],
  goblin_coin: ['before_loot', 'coins', 3],
  thornward_ring: ['before_progress', 'debuffPrevented', true],
  echo_flute: ['before_roll', 'modifier', 2, 'charge:0'],
  campfire_charm: ['after_progress', 'roleAbilityRestored', true],
  mimic_whistle: ['room_reveal', 'mimicIdentified', true, 'charge:0'],
  warding_nail: ['before_progress', 'complicationPrevented', true, 'charge:0'],
  second_chance_coin: ['after_roll', 'rawRoll', 5, 'charge:0'],
  scouts_monocle: ['before_roll', 'modifier', 2],
  mimic_tooth: ['before_loot', 'coinMultiplier', 2],
  hourglass_shard: ['after_roll', null, null, 'deferred'],
  phoenix_feather: ['before_roll', 'debuff', null, 'removed'],
  crooked_compass: ['room_reveal', 'openedBranchKeys.0', 'hidden-1'],
  blackroot_key: ['before_progress', 'progress', 3, 'removed'],
  moonlit_d20: ['before_roll', 'modifier', 3],
  last_stand_banner: ['before_progress', 'progress', 1],
  witch_bottle: ['after_progress', 'storedBuff.reusable', true],
  gravekeepers_crown: ['before_roll', 'modifier', 4],
  hungry_satchel: ['before_loot', 'artifactRolls', 1],
  emerald_heart: ['after_roll', null, null, 'deferred'],
  chain_of_favors: ['after_progress', 'personalRollBuff.amount', 1],
  eye_of_dungeon: ['room_reveal', 'revealedRoomKeys.0', 'optional-1'],
  crown_of_twenty: ['after_roll', 'criticalThreshold', 19],
  endless_candle: ['before_roll', 'modifier', 5],
  root_kings_signet: ['before_progress', 'progress', 3],
  fates_broken_die: ['after_roll', 'rawRoll', 17],
  door_without_key: ['before_progress', 'clearRoom', true, 'removed'],
};

function loadEffects() {
  return require('./artifactEffects.js');
}

function getPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function validContext(artifactId) {
  const artifact = ARTIFACTS[artifactId];
  const config = artifact.effect.config;
  const [phase] = ARTIFACT_EXPECTATIONS[artifactId];
  const roomType = config.roomTypes?.[0]
    || (config.excludeRoomTypes?.includes('boss') ? 'arcane' : 'boss');
  const roomTags = [
    ...(config.roomTags || []),
    ...(config.requiredRoomTags || []),
    ...(config.sourceTags || []),
  ];
  if (artifact.effect.type === 'identify_mimic') roomTags.push('mimic');

  return {
    phase,
    actionType: ['assist_bonus', 'grant_personal_roll_buff'].includes(artifact.effect.type)
      ? 'assist'
      : 'attempt',
    stat: config.stats?.[0] || 'agility',
    rawRoll: config.rawRolls?.[0] ?? (config.below ?? 10) - 1,
    modifiedRoll: Math.max(config.minimumModifiedRoll || 18, 20),
    progress: 0,
    roomType,
    roomTags,
    actionTags: config.actionTags || [],
    modifierTags: config.modifierTags || [],
    debuff: { type: config.debuffTypes?.[0] || 'cursed', amount: 2 },
    complication: { type: 'frightened' },
    helpers: 4,
    support: 2,
    critical: true,
    successStreak: config.successesRequired || 3,
    success: true,
    roleAbilityUsed: true,
    shrineBuff: { type: 'shared_roll_bonus', amount: 2 },
    adjacentRooms: [{ key: 'optional-1', optional: true, state: 'hidden' }],
    optionalRooms: [{ key: 'optional-1', optional: true, state: 'hidden' }],
    hiddenBranches: [{ key: 'hidden-1', state: 'hidden' }],
    rolls: [4, 17],
    rng: () => 0,
    dayKey: 123,
    expeditionId: 9,
    bossPhase: 2,
    loadout: [{
      artifactId,
      charges: artifact.behavior.initialCharges ?? 0,
      quantity: artifact.behavior.type === 'consumable' ? 1 : 0,
    }],
    triggerHistory: [],
  };
}

test('public artifact dispatch exposes exactly the six Task 4 phases', () => {
  const { ARTIFACT_HOOKS, CORE_HOOKS, EFFECT_HANDLERS, applyArtifactEffects } = loadEffects();
  assert.deepEqual(ARTIFACT_HOOKS, SIX_PHASES);
  assert.deepEqual(CORE_HOOKS, SIX_PHASES);
  for (const phase of ['before_assist', 'after_assist', 'before_debuff', 'before_complication', 'failed_attempt']) {
    assert.throws(() => applyArtifactEffects({ phase, loadout: [] }), /valid artifact effect phase/);
  }
  assert.equal(Object.hasOwn(EFFECT_HANDLERS, 'recover_ap'), false);
});

test('AP recovery artifacts are deferred without mutating or reporting AP recovery', () => {
  const { applyArtifactEffects } = loadEffects();
  for (const artifactId of ['hourglass_shard', 'emerald_heart']) {
    const result = applyArtifactEffects({
      ...validContext(artifactId),
      ap: 2,
      apRecovered: 99,
    });
    assert.equal(result.ap, 2, artifactId);
    assert.equal(Object.hasOwn(result, 'apRecovered'), false, artifactId);
    assert.deepEqual(result.triggered, [], artifactId);
  }
});

test('cursed drawback remains declarative for later failed-attempt orchestration', () => {
  const { applyArtifactEffects } = loadEffects();
  assert.deepEqual(ARTIFACTS.hungry_satchel.effect.config.drawback, {
    type: 'reset_streak',
    trigger: 'failed_attempt',
  });
  assert.throws(
    () => applyArtifactEffects({ phase: 'failed_attempt', loadout: [{ artifactId: 'hungry_satchel' }] }),
    /valid artifact effect phase/,
  );
});

test('all 54 artifact IDs have explicit declared outcome expectations', () => {
  const { applyArtifactEffects } = loadEffects();
  assert.deepEqual(Object.keys(ARTIFACT_EXPECTATIONS).sort(), Object.keys(ARTIFACTS).sort());

  for (const [artifactId, [, path, expected, lifecycle]] of Object.entries(ARTIFACT_EXPECTATIONS)) {
    const result = applyArtifactEffects(validContext(artifactId));
    if (lifecycle === 'deferred') {
      assert.deepEqual(result.triggered, [], `${artifactId} must be deferred to engine orchestration`);
      assert.equal(Object.hasOwn(result, 'apRecovered'), false, artifactId);
      assert.notEqual(result.loadout[0], null, artifactId);
      continue;
    }
    assert.equal(getPath(result, path), expected, artifactId);
    assert.deepEqual(result.triggered, [artifactId], artifactId);
    assert.equal(result.triggerHistory.at(-1).artifactId, artifactId, artifactId);
    if (lifecycle === 'removed') assert.equal(result.loadout[0], null, artifactId);
    if (lifecycle?.startsWith('charge:')) {
      assert.equal(result.loadout[0].charges, Number(lifecycle.split(':')[1]), artifactId);
    }
  }
});

test('every artifact deliberately no-ops outside its mapped supported phase', () => {
  const { applyArtifactEffects } = loadEffects();
  for (const artifactId of Object.keys(ARTIFACT_EXPECTATIONS)) {
    const context = validContext(artifactId);
    context.phase = context.phase === 'before_roll' ? 'after_roll' : 'before_roll';
    const result = applyArtifactEffects(context);
    assert.deepEqual(result.triggered, [], artifactId);
    assert.deepEqual(result.loadout, context.loadout, artifactId);
  }
});

test('every configured condition rejects a nonmatching context without consuming its slot', () => {
  const { applyArtifactEffects } = loadEffects();
  const conditionalIds = Object.values(ARTIFACTS)
    .filter(({ effect: { config } }) => [
      'stats', 'roomTypes', 'roomTags', 'requiredRoomTags', 'actionTags', 'modifierTags',
      'rawRolls', 'minimumModifiedRoll', 'criticalOnly', 'debuffTypes', 'sourceTags',
    ].some(key => Object.hasOwn(config, key)))
    .map(artifact => artifact.id)
    .filter(id => !['hourglass_shard', 'emerald_heart'].includes(id));

  for (const artifactId of conditionalIds) {
    const artifact = ARTIFACTS[artifactId];
    const context = validContext(artifactId);
    const config = artifact.effect.config;
    if (config.stats) context.stat = 'not-a-stat';
    else if (config.roomTypes || config.excludeRoomTypes) context.roomType = config.excludeRoomTypes?.[0] || 'not-a-room';
    else if (config.roomTags || config.requiredRoomTags || config.sourceTags) context.roomTags = [];
    else if (config.actionTags) context.actionTags = [];
    else if (config.modifierTags) context.modifierTags = [];
    else if (config.rawRolls) context.rawRoll = 20;
    else if (config.minimumModifiedRoll) context.modifiedRoll = config.minimumModifiedRoll - 1;
    else if (config.criticalOnly) context.critical = false;
    else if (config.debuffTypes) context.debuff.type = 'not-a-debuff';
    const result = applyArtifactEffects(context);
    assert.deepEqual(result.triggered, [], artifactId);
    assert.deepEqual(result.loadout, context.loadout, artifactId);
  }
});

test('every executable scoped limit blocks repeat use in the same scope', () => {
  const { applyArtifactEffects } = loadEffects();
  const limitedIds = Object.values(ARTIFACTS)
    .filter(artifact => artifact.effect.config.limit)
    .map(artifact => artifact.id)
    .filter(id => !['emerald_heart'].includes(id));

  for (const artifactId of limitedIds) {
    const context = validContext(artifactId);
    const first = applyArtifactEffects(context);
    assert.deepEqual(first.triggered, [artifactId], artifactId);
    const repeated = applyArtifactEffects({ ...context, triggerHistory: first.triggerHistory });
    assert.deepEqual(repeated.triggered, [], artifactId);
  }
});

test('only equipped artifacts work and charged artifacts stop at zero', () => {
  const { applyArtifactEffects } = loadEffects();
  const result = applyArtifactEffects({
    ...validContext('rusty_lockpick'),
    loadout: [{ artifactId: 'rusty_lockpick', charges: 1 }],
    inventoryOnly: ['endless_candle'],
  });
  assert.equal(result.modifier, 4);
  assert.equal(result.loadout[0].charges, 0);
  assert.equal(result.loadout[0].exhausted, true);
  assert.deepEqual(applyArtifactEffects({ ...validContext('rusty_lockpick'), loadout: result.loadout }).triggered, []);
});

test('cursed debuff disables equipped artifacts while preserving serializable state', () => {
  const { applyArtifactEffects } = loadEffects();
  const result = applyArtifactEffects({
    ...validContext('endless_candle'),
    artifactsDisabled: true,
  });
  assert.equal(result.modifier, 0);
  assert.deepEqual(result.triggered, []);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(Object.hasOwn(result, 'rng'), false);
});
