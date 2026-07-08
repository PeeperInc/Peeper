import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  THEME_ID,
  AP_REGEN_SECONDS,
  DAILY_AP,
  MAX_AP,
  ROLES,
  PROVISIONS,
  ARTIFACTS,
  ROOM_TEMPLATES,
  PROGRESS_BANDS,
  RARITY_WEIGHTS,
} = require('./catalog.js');

const VALID_STATS = new Set(['might', 'agility', 'arcana', 'spirit']);
const VALID_RARITIES = new Set(['common', 'rare', 'epic', 'legendary']);
const VALID_USE_TYPES = new Set(['active', 'expedition_passive']);
const REQUIRED_ROOM_TYPES = [
  'combat',
  'trap',
  'arcane',
  'exploration',
  'treasure',
  'shrine',
  'camp',
  'mystery',
  'boss',
];

test('root king catalog exposes the approved constants and role rules', () => {
  assert.equal(THEME_ID, 'root_king');
  assert.equal(DAILY_AP, 5);
  assert.equal(MAX_AP, 5);
  assert.equal(AP_REGEN_SECONDS, 3 * 60 * 60);
  assert.deepEqual(ROLES, {
    knight: { stat: 'might', bonus: 3, ability: 'shield_wall' },
    scout: { stat: 'agility', bonus: 3, ability: 'reveal_room' },
    mage: { stat: 'arcana', bonus: 3, ability: 'reroll' },
    cleric: { stat: 'spirit', bonus: 3, ability: 'blessing' },
  });
});

test('provisions contain the seven exact farm recipes and structured effects', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(PROVISIONS).map(([id, provision]) => [id, {
      ingredient: provision.recipe.productId,
      quantity: provision.recipe.quantity,
      effect: provision.effect,
    }])),
    {
      carrot_rations: {
        ingredient: 'carrot',
        quantity: 20,
        effect: { type: 'grant_ap', config: { amount: 1, timing: 'after_preparation' } },
      },
      tomato_soup: {
        ingredient: 'tomato',
        quantity: 12,
        effect: { type: 'prevent_debuff', config: { uses: 1 } },
      },
      hearty_potato_meal: {
        ingredient: 'potato',
        quantity: 10,
        effect: { type: 'minimum_progress', config: { uses: 1, from: 0, to: 1 } },
      },
      lucky_breakfast: {
        ingredient: 'egg',
        quantity: 10,
        effect: { type: 'roll_bonus', config: { uses: 1, amount: 2 } },
      },
      warm_milk: {
        ingredient: 'milk',
        quantity: 8,
        effect: { type: 'restore_role_ability', config: { uses: 1, roomType: 'camp' } },
      },
      truffle_treat: {
        ingredient: 'truffle',
        quantity: 3,
        effect: { type: 'upgrade_loot_rarity', config: { uses: 1, tiers: 1 } },
      },
      magic_squash_pie: {
        ingredient: 'magic_squash',
        quantity: 1,
        effect: { type: 'raise_modified_roll', config: { uses: 1, below: 10, value: 10 } },
      },
    },
  );
});

test('all curated artifacts have unique IDs and explicit current-system effects', () => {
  const entries = Object.entries(ARTIFACTS);
  assert.equal(entries.length, 24);
  assert.equal(new Set(entries.map(([id]) => id)).size, 24);

  for (const [id, artifact] of entries) {
    assert.equal(artifact.id, id);
    assert.equal(typeof artifact.name, 'string');
    assert.ok(artifact.name.length > 0);
    assert.ok(VALID_RARITIES.has(artifact.rarity), `${id} has invalid rarity`);
    assert.equal(typeof artifact.displayEffect, 'string');
    assert.ok(VALID_USE_TYPES.has(artifact.useType), `${id} has invalid use type`);
    assert.equal(typeof artifact.effect.kind, 'string');
    assert.ok(artifact.effect.kind.length > 0);
    assert.equal(Object.hasOwn(artifact.effect, 'trigger'), false);
    assert.equal(Object.hasOwn(artifact.effect, 'roomTags'), false);
  }
});

test('room templates author every room type and all four action stats', () => {
  assert.deepEqual(Object.keys(ROOM_TEMPLATES).sort(), [...REQUIRED_ROOM_TYPES].sort());

  const templates = Object.values(ROOM_TEMPLATES).flat();
  assert.equal(new Set(templates.map(template => template.id)).size, templates.length);
  assert.ok(templates.every(template => REQUIRED_ROOM_TYPES.includes(template.type)));
  assert.ok(templates.every(template => Array.isArray(template.actions) && template.actions.length > 0));

  const stats = new Set(templates.flatMap(template => template.actions.map(action => action.stat)));
  assert.deepEqual(stats, VALID_STATS);
  for (const template of templates) {
    for (const action of template.actions) {
      assert.ok(VALID_STATS.has(action.stat));
      assert.equal(typeof action.id, 'string');
      assert.equal(typeof action.label, 'string');
      assert.ok(['easy', 'risky', 'hard'].includes(action.difficulty));
      assert.ok(Number.isInteger(action.modifier));
      assert.ok(Array.isArray(action.tags));
      assert.ok(Number.isInteger(action.progressTarget));
      assert.ok(action.progressTarget > 0);
      assert.equal(action.progressTarget, template.progressTarget);
    }
    assert.ok(Number.isInteger(template.progressTarget));
    assert.ok(template.progressTarget > 0);
  }
});

test('progress bands and base rarity weights match the approved rules', () => {
  assert.deepEqual(PROGRESS_BANDS, [
    { max: 5, progress: 0 },
    { max: 10, progress: 1 },
    { max: 15, progress: 2 },
    { max: 19, progress: 3 },
    { max: Infinity, progress: 5 },
  ]);
  assert.deepEqual(RARITY_WEIGHTS, { common: 65, rare: 25, epic: 8, legendary: 2 });
});

test('artifact catalog contains exactly the 24 public-test artifacts and current effect kinds', () => {
  const expected = {
    old_torch: ['common', 'expedition_passive', 'minigame_time'],
    bent_sword: ['common', 'expedition_passive', 'combat_damage_bonus'],
    chalk_rune: ['common', 'active', 'minigame_time_once'],
    rabbit_foot: ['common', 'expedition_passive', 'prevent_personal_damage'],
    bone_die: ['common', 'active', 'combat_roll_floor'],
    wooden_shield: ['common', 'active', 'prevent_personal_damage'],
    tiny_shovel: ['common', 'active', 'room_progress'],
    ration_box: ['common', 'active', 'heal_self'],
    rusty_lockpick: ['rare', 'active', 'minigame_auto_success'],
    loaded_die: ['rare', 'active', 'combat_advantage'],
    family_banner: ['rare', 'expedition_passive', 'role_recharge_threshold'],
    rootcutters_axe: ['rare', 'expedition_passive', 'boss_damage_bonus'],
    warding_nail: ['rare', 'active', 'place_room_shield'],
    second_chance_coin: ['rare', 'active', 'place_room_retry'],
    campfire_charm: ['rare', 'active', 'restore_role_charge'],
    phoenix_feather: ['epic', 'active', 'revive_self'],
    hourglass_shard: ['epic', 'active', 'restore_ap'],
    last_stand_banner: ['epic', 'expedition_passive', 'prevent_knockout'],
    emerald_heart: ['epic', 'expedition_passive', 'critical_heal'],
    crooked_compass: ['epic', 'active', 'scout_choice'],
    mimic_tooth: ['epic', 'expedition_passive', 'coin_multiplier'],
    fates_broken_die: ['legendary', 'active', 'multi_combat_advantage'],
    crown_of_twenty: ['legendary', 'expedition_passive', 'critical_threshold'],
    root_kings_signet: ['legendary', 'expedition_passive', 'boss_damage_bonus'],
  };
  const actual = Object.fromEntries(Object.values(ARTIFACTS).map(artifact => [
    artifact.id,
    [artifact.rarity, artifact.useType, artifact.effect.kind],
  ]));

  assert.deepEqual(actual, expected);
  assert.equal(Object.values(ARTIFACTS).filter(item => item.useType === 'active').length, 14);
  assert.equal(Object.values(ARTIFACTS).filter(item => item.useType === 'expedition_passive').length, 10);
});

test('frontend provision metadata remains in parity', async () => {
  const assetCatalogUrl = new URL(
    '../../frontend/src/assets/expeditions/root-king/asset-catalog.json',
    import.meta.url,
  );
  const assetCatalog = JSON.parse(await readFile(assetCatalogUrl, 'utf8'));
  assert.equal(new Set(assetCatalog.provisions.map(provision => provision.id)).size, 7);
  assert.deepEqual(
    Object.keys(PROVISIONS).sort(),
    assetCatalog.provisions.map(provision => provision.id).sort(),
  );
});
