import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DIRTY_CYCLE_SECONDS,
  EXISTING_DIRTY_MIN_SECONDS,
  EXISTING_DIRTY_MAX_SECONDS,
  getNextDirtyAt,
  getRandomInitialDirtyAt,
  shouldBecomeDirty,
} = require('./dirtyCycle.js');

test('new clean cycle is scheduled 24 hours from now', () => {
  const now = 1_000_000;
  assert.equal(getNextDirtyAt(now), now + DIRTY_CYCLE_SECONDS);
});

test('existing clean migration randomizes between 1 and 24 hours', () => {
  const now = 1_000_000;

  assert.equal(getRandomInitialDirtyAt(now, () => 0), now + EXISTING_DIRTY_MIN_SECONDS);
  assert.equal(getRandomInitialDirtyAt(now, () => 0.999999), now + EXISTING_DIRTY_MAX_SECONDS);
});

test('clean alive peeper becomes dirty when next_dirty_at has passed', () => {
  assert.equal(shouldBecomeDirty({
    alive: 1,
    dirty_state: 'clean',
    next_dirty_at: 999,
    hunger: 100,
  }, 1000), true);
});

test('hunger zero does not make clean peeper dirty before timer', () => {
  assert.equal(shouldBecomeDirty({
    alive: 1,
    dirty_state: 'clean',
    next_dirty_at: 2000,
    hunger: 0,
  }, 1000), false);
});

test('dirty timer ignores dead or already dirty peepers', () => {
  assert.equal(shouldBecomeDirty({ alive: 0, dirty_state: 'clean', next_dirty_at: 1 }, 1000), false);
  assert.equal(shouldBecomeDirty({ alive: 1, dirty_state: 'poop', next_dirty_at: 1 }, 1000), false);
  assert.equal(shouldBecomeDirty({ alive: 1, dirty_state: 'scrubbing', next_dirty_at: 1 }, 1000), false);
});
