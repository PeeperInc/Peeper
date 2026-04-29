import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { serializeFamilyMemberStats } = require('./familyMemberStats.js');

test('family member stats respect active fridge stock', () => {
  const now = 1_000_000;
  const member = {
    id: 1,
    alive: 1,
    hp: 40,
    last_fed: now - 20 * 86400,
    last_played: now,
    fridge_food_until: now + 3600,
  };

  const serialized = serializeFamilyMemberStats(member, now);

  assert.equal(serialized.liveHunger, 100);
  assert.equal(serialized.liveAlive, true);
});

test('family member stats start hunger drain from fridge expiry', () => {
  const now = 1_000_000;
  const expiredAt = now - 4 * 3600;
  const member = {
    id: 1,
    alive: 1,
    hp: 100,
    last_fed: now - 20 * 86400,
    last_played: now,
    fridge_food_until: expiredAt,
  };

  const serialized = serializeFamilyMemberStats(member, now);

  assert.equal(serialized.liveHunger, 50);
  assert.equal(serialized.liveAlive, true);
});
