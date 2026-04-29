import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { liveStats, HUNGER_DRAIN } = require('./gameLogic.js');
const {
  FRIDGE_PURCHASE_COST,
  getFridgeState,
  extendFridgeFoodUntil,
} = require('./fridgeState.js');

test('fridge state reports active stock and purchase metadata', () => {
  const now = 1_000_000;
  const state = getFridgeState({
    fridge_owned: 1,
    fridge_food_until: now + 3600,
    fridge_purchased_at: now - 100,
  }, now);

  assert.equal(state.owned, true);
  assert.equal(state.active, true);
  assert.equal(state.remainingSeconds, 3600);
  assert.equal(state.purchaseCost, FRIDGE_PURCHASE_COST);
  assert.equal(state.plans.length, 2);
});

test('fridge food extends active stock from current expiry', () => {
  const now = 1_000_000;
  const currentExpiry = now + 2 * 86400;

  assert.equal(
    extendFridgeFoodUntil(currentExpiry, 3, now),
    currentExpiry + 3 * 86400
  );
});

test('expired fridge food extends from now', () => {
  const now = 1_000_000;
  const expired = now - 100;

  assert.equal(
    extendFridgeFoodUntil(expired, 7, now),
    now + 7 * 86400
  );
});

test('active fridge keeps hunger full and peeper alive', () => {
  const now = 1_000_000;
  const stats = liveStats({
    alive: 1,
    hp: 10,
    last_fed: now - 20 * HUNGER_DRAIN,
    last_played: now,
    fridge_food_until: now + 86400,
  }, now);

  assert.equal(stats.hunger, 100);
  assert.equal(stats.alive, true);
});

test('after fridge expires, hunger drains from fridge expiry', () => {
  const now = 1_000_000;
  const expiredAt = now - HUNGER_DRAIN / 2;
  const stats = liveStats({
    alive: 1,
    hp: 10,
    last_fed: now - 20 * HUNGER_DRAIN,
    last_played: now,
    fridge_food_until: expiredAt,
  }, now);

  assert.equal(stats.hunger, 50);
  assert.equal(stats.alive, true);
});

test('peeper does not die immediately after fridge expires with old last_fed', () => {
  const now = 1_000_000;
  const expiredAt = now - 60;
  const stats = liveStats({
    alive: 1,
    hp: 100,
    last_fed: now - 30 * 86400,
    last_played: now,
    fridge_food_until: expiredAt,
  }, now);

  assert.equal(stats.alive, true);
  assert.equal(stats.hunger > 99, true);
});
