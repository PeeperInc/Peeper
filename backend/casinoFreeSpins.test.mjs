import test from 'node:test';
import assert from 'node:assert/strict';

import casinoFreeSpinModule from './casinoFreeSpins.js';

const { resolveCasinoSpinCredits, resolveCasinoSpinUsage } = casinoFreeSpinModule;

test('free spin bypasses energy requirement and does not spend energy', () => {
  const usage = resolveCasinoSpinUsage({
    freeSpinsBefore: 1,
    currentEnergy: 0,
  });

  assert.equal(usage.hasFreeSpin, true);
  assert.equal(usage.requiresEnergy, false);
  assert.equal(usage.energyConsumed, false);
});

test('paid spin still requires and consumes energy', () => {
  const usage = resolveCasinoSpinUsage({
    freeSpinsBefore: 0,
    currentEnergy: 3,
  });

  assert.equal(usage.hasFreeSpin, false);
  assert.equal(usage.requiresEnergy, true);
  assert.equal(usage.energyConsumed, true);
});

test('double sino awards one free spin on a paid spin', () => {
  const outcome = resolveCasinoSpinCredits({
    patternKey: 'double_sino',
    freeSpinsBefore: 0,
    spinCost: 5,
  });

  assert.equal(outcome.freeSpinUsed, false);
  assert.equal(outcome.freeSpinAwarded, 1);
  assert.equal(outcome.freeSpinsAfter, 1);
  assert.equal(outcome.spinCostPaid, 5);
});

test('existing free spin is consumed before coin cost', () => {
  const outcome = resolveCasinoSpinCredits({
    patternKey: 'pair',
    freeSpinsBefore: 1,
    spinCost: 5,
  });

  assert.equal(outcome.freeSpinUsed, true);
  assert.equal(outcome.freeSpinAwarded, 0);
  assert.equal(outcome.freeSpinsAfter, 0);
  assert.equal(outcome.spinCostPaid, 0);
});

test('double sino preserves credit count when triggered from a free spin', () => {
  const outcome = resolveCasinoSpinCredits({
    patternKey: 'double_sino',
    freeSpinsBefore: 1,
    spinCost: 5,
  });

  assert.equal(outcome.freeSpinUsed, true);
  assert.equal(outcome.freeSpinAwarded, 1);
  assert.equal(outcome.freeSpinsAfter, 1);
  assert.equal(outcome.spinCostPaid, 0);
});
