import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ARTIFACTS } = require('./catalog.js');

function loadEffects() {
  return require('./artifactEffects.js');
}

function validContext(artifactId) {
  const artifact = ARTIFACTS[artifactId];
  const config = artifact.effect.config;
  const roomType = config.roomTypes?.[0]
    || (config.excludeRoomTypes?.includes('boss') ? 'arcane' : 'boss');
  const roomTags = [
    ...(config.roomTags || []),
    ...(config.requiredRoomTags || []),
    ...(config.sourceTags || []),
  ];
  if (artifact.effect.type === 'identify_mimic') roomTags.push('mimic');

  return {
    phase: artifact.effect.trigger,
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

test('only equipped artifacts modify a roll and triggered charges are consumed', () => {
  const { applyArtifactEffects } = loadEffects();
  const result = applyArtifactEffects({
    phase: 'before_roll',
    stat: 'agility',
    rawRoll: 12,
    roomType: 'treasure',
    roomTags: [],
    actionTags: ['lock'],
    loadout: [{ artifactId: 'rusty_lockpick', charges: 2 }],
    inventoryOnly: ['endless_candle'],
  });

  assert.equal(result.modifier, 4);
  assert.equal(result.loadout[0].charges, 1);
  assert.deepEqual(result.triggered, ['rusty_lockpick']);
});

test('every catalog artifact executes in a valid structured context', () => {
  const { applyArtifactEffects, EFFECT_HANDLERS } = loadEffects();
  assert.equal(Object.keys(ARTIFACTS).length, 54);

  for (const artifact of Object.values(ARTIFACTS)) {
    assert.equal(typeof EFFECT_HANDLERS[artifact.effect.type], 'function', artifact.id);
    const result = applyArtifactEffects(validContext(artifact.id));
    assert.deepEqual(result.triggered, [artifact.id], artifact.id);
    assert.equal(result.triggerHistory.at(-1).artifactId, artifact.id, artifact.id);
  }
});

test('every artifact deliberately no-ops outside its declared hook', () => {
  const { applyArtifactEffects } = loadEffects();
  for (const artifact of Object.values(ARTIFACTS)) {
    const context = validContext(artifact.id);
    context.phase = context.phase === 'before_roll' ? 'after_roll' : 'before_roll';
    const result = applyArtifactEffects(context);
    assert.deepEqual(result.triggered, [], artifact.id);
    assert.deepEqual(result.loadout, context.loadout, artifact.id);
  }
});

test('conditions are conjunctive and nonmatching slots keep their charges', () => {
  const { applyArtifactEffects } = loadEffects();
  const result = applyArtifactEffects({
    ...validContext('moss_amulet'),
    roomTags: [],
  });
  assert.equal(result.modifier, 0);
  assert.deepEqual(result.triggered, []);
  assert.equal(result.loadout[0].quantity, 1);
});

test('day, expedition, and boss-phase limits use serializable trigger history', () => {
  const { applyArtifactEffects } = loadEffects();
  for (const [artifactId, changedKey, unchangedKey] of [
    ['moonlit_d20', 'dayKey', 'expeditionId'],
    ['rabbit_foot', 'expeditionId', 'dayKey'],
    ['root_kings_signet', 'bossPhase', 'dayKey'],
  ]) {
    const firstContext = validContext(artifactId);
    const first = applyArtifactEffects(firstContext);
    const sameScope = applyArtifactEffects({ ...firstContext, triggerHistory: first.triggerHistory });
    assert.deepEqual(sameScope.triggered, [], artifactId);

    const nextContext = { ...firstContext, triggerHistory: first.triggerHistory };
    nextContext[changedKey] += 1;
    nextContext[unchangedKey] += 100;
    const next = applyArtifactEffects(nextContext);
    assert.deepEqual(next.triggered, [artifactId], artifactId);
  }
});

test('consumables exhaust their slot and charged artifacts stop at zero', () => {
  const { applyArtifactEffects } = loadEffects();
  const consumed = applyArtifactEffects(validContext('chalk_rune'));
  assert.equal(consumed.loadout[0].quantity, 0);
  assert.equal(consumed.loadout[0].exhausted, true);

  const chargedContext = validContext('rusty_lockpick');
  chargedContext.loadout[0].charges = 1;
  const charged = applyArtifactEffects(chargedContext);
  assert.equal(charged.loadout[0].charges, 0);
  assert.equal(charged.loadout[0].exhausted, true);
  assert.deepEqual(applyArtifactEffects({ ...chargedContext, loadout: charged.loadout }).triggered, []);
});

test('cursed debuff disables equipped artifacts for the action', () => {
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

test('cursed artifact drawback resets its streak on a failed attempt hook', () => {
  const { applyArtifactEffects, ARTIFACT_HOOKS } = loadEffects();
  const context = validContext('hungry_satchel');
  context.phase = 'failed_attempt';
  context.success = false;
  context.successStreak = 4;
  const result = applyArtifactEffects(context);

  assert.ok(ARTIFACT_HOOKS.includes('failed_attempt'));
  assert.equal(result.successStreak, 0);
  assert.deepEqual(result.triggered, ['hungry_satchel']);
});
