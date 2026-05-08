import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const farm = require('./farmState.js');

test('farm v1 balance keeps fast crops more profitable than slow crops', () => {
  assert.equal(farm.FARM_PURCHASE_COST, 1000);
  assert.equal(farm.FARM_SLOT_COUNT, 9);
  assert.equal(farm.CROPS.carrot.seedCost, 1);
  assert.equal(farm.CROPS.tomato.seedCost, 3);
  assert.equal(farm.CROPS.potato.seedCost, 5);
  assert.equal(farm.CROPS.carrot.growSeconds, 5 * 3600);
  assert.equal(farm.CROPS.tomato.growSeconds, 10 * 3600);
  assert.equal(farm.CROPS.potato.growSeconds, 15 * 3600);

  const profitPerDay = (crop) => {
    const product = farm.PRODUCTS[crop.yieldProductId];
    const gross = crop.yieldQuantity * product.sellPrice;
    return (gross - crop.seedCost) * (86400 / crop.growSeconds);
  };

  assert.equal(profitPerDay(farm.CROPS.carrot) > profitPerDay(farm.CROPS.tomato), true);
  assert.equal(profitPerDay(farm.CROPS.tomato) > profitPerDay(farm.CROPS.potato), true);
});

test('farm fridge recipes always require vegetables and animal products', () => {
  assert.deepEqual(farm.FRIDGE_RECIPES.farm_fridge_3d, {
    type: 'farm_fridge_3d',
    label: '3 days',
    days: 3,
    vegetableValue: 400,
    animalValue: 120,
  });

  assert.deepEqual(farm.FRIDGE_RECIPES.farm_fridge_7d, {
    type: 'farm_fridge_7d',
    label: '7 days',
    days: 7,
    vegetableValue: 900,
    animalValue: 350,
  });
});

test('farm summary reports no pending actions before farm purchase', () => {
  const summary = farm.getFarmSummary(-999_999);

  assert.equal(summary.owned, false);
  assert.equal(summary.hasAction, false);
  assert.equal(summary.actionCount, 0);
});

test('farm animals separate fridge value from coin profit roles', () => {
  assert.equal(farm.ANIMALS.chicken.productId, 'egg');
  assert.equal(farm.ANIMALS.cow.productId, 'milk');
  assert.equal(farm.ANIMALS.pig.productId, 'truffle');
  assert.equal(farm.ANIMALS.chicken.feedCost, 3);
  assert.equal(farm.ANIMALS.cow.feedCost, 7);
  assert.equal(farm.ANIMALS.pig.feedCost, 10);

  assert.equal(farm.PRODUCTS.egg.value, 2);
  assert.equal(farm.PRODUCTS.egg.sellPrice, 2);
  assert.equal(farm.PRODUCTS.truffle.value, 5);
  assert.equal(farm.PRODUCTS.truffle.sellPrice, 25);
  assert.equal(farm.PRODUCTS.truffle.sellPrice / farm.PRODUCTS.truffle.value > farm.PRODUCTS.egg.sellPrice / farm.PRODUCTS.egg.value, true);
});
