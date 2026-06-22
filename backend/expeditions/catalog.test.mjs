import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  THEME_ID,
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
const VALID_BEHAVIORS = new Set(['permanent', 'charged', 'consumable', 'cursed']);
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
  assert.equal(DAILY_AP, 3);
  assert.equal(MAX_AP, 6);
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

test('all 54 artifacts have unique valid IDs and declarative effect behavior', () => {
  const entries = Object.entries(ARTIFACTS);
  assert.equal(entries.length, 54);
  assert.equal(new Set(entries.map(([id]) => id)).size, 54);

  for (const [id, artifact] of entries) {
    assert.equal(artifact.id, id);
    assert.equal(typeof artifact.name, 'string');
    assert.ok(artifact.name.length > 0);
    assert.ok(VALID_RARITIES.has(artifact.rarity), `${id} has invalid rarity`);
    assert.equal(typeof artifact.displayEffect, 'string');
    assert.ok(VALID_BEHAVIORS.has(artifact.behavior.type), `${id} has invalid behavior`);
    assert.equal(typeof artifact.effect.type, 'string');
    assert.ok(artifact.effect.type.length > 0);
    assert.equal(typeof artifact.effect.trigger, 'string');
    assert.ok(artifact.effect.trigger.length > 0);
    assert.equal(typeof artifact.effect.config, 'object');
    assert.notEqual(artifact.effect.config, null);
    assert.equal(Array.isArray(artifact.effect.config), false);
    assert.equal(Object.hasOwn(artifact.effect.config, 'code'), false);

    if (artifact.behavior.type === 'charged') {
      assert.ok(Number.isInteger(artifact.behavior.initialCharges));
      assert.ok(artifact.behavior.initialCharges > 0);
    }
    if (artifact.behavior.type === 'consumable') {
      assert.equal(artifact.behavior.consumeOnTrigger, true);
    }
  }
});

test('room templates author every room type and all four action stats', () => {
  assert.deepEqual(Object.keys(ROOM_TEMPLATES).sort(), [...REQUIRED_ROOM_TYPES].sort());

  const templates = Object.values(ROOM_TEMPLATES).flat();
  assert.equal(new Set(templates.map(template => template.id)).size, templates.length);
  assert.ok(templates.every(template => REQUIRED_ROOM_TYPES.includes(template.type)));
  assert.ok(templates.every(template => Number.isInteger(template.progressTarget) && template.progressTarget >= 0));
  assert.ok(templates.every(template => Array.isArray(template.actions) && template.actions.length > 0));

  const stats = new Set(templates.flatMap(template => template.actions.map(action => action.stat)));
  assert.deepEqual(stats, VALID_STATS);
  for (const action of templates.flatMap(template => template.actions)) {
    assert.ok(VALID_STATS.has(action.stat));
    assert.equal(typeof action.id, 'string');
    assert.equal(typeof action.label, 'string');
    assert.ok(['easy', 'risky', 'hard'].includes(action.difficulty));
    assert.ok(Number.isInteger(action.modifier));
    assert.ok(Array.isArray(action.tags));
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

test('frontend and backend artifact metadata remain in parity', async () => {
  const assetCatalogUrl = new URL(
    '../../frontend/src/assets/expeditions/root-king/asset-catalog.json',
    import.meta.url,
  );
  const assetCatalog = JSON.parse(await readFile(assetCatalogUrl, 'utf8'));
  const frontendArtifacts = Object.fromEntries(
    assetCatalog.artifacts.map(({ id, name, rarity, effect }) => [id, { name, rarity, effect }]),
  );
  const backendArtifacts = Object.fromEntries(
    Object.entries(ARTIFACTS).map(([id, artifact]) => [id, {
      name: artifact.name,
      rarity: artifact.rarity,
      effect: artifact.displayEffect,
    }]),
  );

  assert.deepEqual(backendArtifacts, frontendArtifacts);
  assert.equal(new Set(assetCatalog.provisions.map(provision => provision.id)).size, 7);
  assert.deepEqual(
    Object.keys(PROVISIONS).sort(),
    assetCatalog.provisions.map(provision => provision.id).sort(),
  );
});
