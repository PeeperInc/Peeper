import test from 'node:test';
import assert from 'node:assert/strict';

import arenaEngineModule from './arenaEngine.js';

const {
  ARENA_BASE_DAMAGE,
  ARENA_HP,
  calcDamage,
  calcDamageMultiplier,
  resolveCombatRound,
  validateArenaInviteForUser,
} = arenaEngineModule;

test('arena damage matrix follows the elemental cycle', () => {
  const strongHits = [
    ['fire', 'air'],
    ['air', 'earth'],
    ['earth', 'water'],
    ['water', 'fire'],
  ];

  for (const [attack, defense] of strongHits) {
    assert.equal(calcDamageMultiplier(attack, defense), 2);
    assert.equal(calcDamage(attack, defense), ARENA_BASE_DAMAGE * 2);
  }

  const blockedHits = [
    ['fire', 'water'],
    ['air', 'fire'],
    ['earth', 'air'],
    ['water', 'earth'],
  ];

  for (const [attack, defense] of blockedHits) {
    assert.equal(calcDamageMultiplier(attack, defense), 0);
    assert.equal(calcDamage(attack, defense), 0);
  }

  const normalHits = [
    ['fire', 'fire'],
    ['air', 'air'],
    ['earth', 'earth'],
    ['water', 'water'],
  ];

  for (const [attack, defense] of normalHits) {
    assert.equal(calcDamageMultiplier(attack, defense), 1);
    assert.equal(calcDamage(attack, defense), ARENA_BASE_DAMAGE);
  }

  assert.equal(calcDamageMultiplier('fire', 'earth'), 1);
  assert.equal(calcDamage('fire', 'earth'), ARENA_BASE_DAMAGE);
});

test('arena round applies both attacks simultaneously and detects draw', () => {
  const result = resolveCombatRound({
    player1Hp: 10,
    player2Hp: 10,
    player1Attack: 'fire',
    player1Defense: 'fire',
    player2Attack: 'water',
    player2Defense: 'air',
  });

  assert.equal(result.player1DamageDealt, 40);
  assert.equal(result.player2DamageDealt, 40);
  assert.equal(result.player1HpAfter, 0);
  assert.equal(result.player2HpAfter, 0);
  assert.equal(result.result, 'draw');
  assert.equal(result.winnerSide, null);
});

test('arena round clamps hp and returns winner side', () => {
  const result = resolveCombatRound({
    player1Hp: ARENA_HP,
    player2Hp: 20,
    player1Attack: 'earth',
    player1Defense: 'fire',
    player2Attack: 'fire',
    player2Defense: 'water',
  });

  assert.equal(result.player1DamageDealt, 40);
  assert.equal(result.player2DamageDealt, 20);
  assert.equal(result.player1HpAfter, 80);
  assert.equal(result.player2HpAfter, 0);
  assert.equal(result.result, 'p1_win');
  assert.equal(result.winnerSide, 'p1');
});

test('arena armor blocks the incoming attack it beats completely', () => {
  const result = resolveCombatRound({
    player1Hp: ARENA_HP,
    player2Hp: ARENA_HP,
    player1Attack: 'fire',
    player1Defense: 'earth',
    player2Attack: 'water',
    player2Defense: 'water',
  });

  assert.equal(result.player1DamageDealt, 0);
  assert.equal(result.player2DamageDealt, 0);
  assert.equal(result.player1HpAfter, ARENA_HP);
  assert.equal(result.player2HpAfter, ARENA_HP);
  assert.equal(result.result, null);
});

test('arena invite token can only be used by the intended invitee', () => {
  assert.deepEqual(
    validateArenaInviteForUser({ status: 'pending', invitee_id: 7 }, 7),
    { ok: true },
  );

  assert.equal(
    validateArenaInviteForUser({ status: 'pending', invitee_id: 7 }, 8).error,
    'This invite belongs to another player.',
  );

  assert.equal(
    validateArenaInviteForUser({ status: 'accepted', invitee_id: 7 }, 7).error,
    'This invite is no longer active.',
  );
});
