import test from 'node:test';
import assert from 'node:assert/strict';

import blackjackHandUtilsModule from './blackjackHandUtils.js';

const { comparePvpHands } = blackjackHandUtilsModule;
const { compareDealerHands } = blackjackHandUtilsModule;

test('pvp equal totals split even when only one hand is flagged as blackjack', () => {
  const comparison = comparePvpHands(
    { total: 21, bust: false, blackjack: true },
    { total: 21, bust: false, blackjack: false },
  );

  assert.equal(comparison, 0);
});

test('pvp equal non-blackjack totals still split', () => {
  const comparison = comparePvpHands(
    { total: 19, bust: false, blackjack: false },
    { total: 19, bust: false, blackjack: false },
  );

  assert.equal(comparison, 0);
});

test('pvp higher live total still wins', () => {
  const comparison = comparePvpHands(
    { total: 21, bust: false, blackjack: false },
    { total: 20, bust: false, blackjack: false },
  );

  assert.equal(comparison, 1);
});

test('dealer rules still treat natural blackjack as stronger than non-natural 21', () => {
  const comparison = compareDealerHands(
    { total: 21, bust: false, blackjack: true },
    { total: 21, bust: false, blackjack: false },
  );

  assert.equal(comparison, 1);
});

test('dealer rules still let higher live total beat lower total', () => {
  const comparison = compareDealerHands(
    { total: 20, bust: false, blackjack: false },
    { total: 19, bust: false, blackjack: false },
  );

  assert.equal(comparison, 1);
});
