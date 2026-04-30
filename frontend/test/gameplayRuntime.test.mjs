import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldPauseAppPolling,
  shouldPauseHomeRuntime,
  shouldPauseLiveStats,
} from '../src/utils/gameplayRuntime.mjs';

test('shouldPauseHomeRuntime pauses whenever the home screen is inactive or a game overlay is open', () => {
  assert.equal(shouldPauseHomeRuntime({ isActive: true, gameplayOpen: false }), false);
  assert.equal(shouldPauseHomeRuntime({ isActive: false, gameplayOpen: false }), true);
  assert.equal(shouldPauseHomeRuntime({ isActive: true, gameplayOpen: true }), true);
});

test('shouldPauseLiveStats mirrors the home runtime pause state', () => {
  assert.equal(shouldPauseLiveStats({ isActive: true, gameplayOpen: false }), false);
  assert.equal(shouldPauseLiveStats({ isActive: false, gameplayOpen: false }), true);
  assert.equal(shouldPauseLiveStats({ isActive: true, gameplayOpen: true }), true);
});

test('shouldPauseAppPolling pauses all recurring app polling while a game overlay is open', () => {
  assert.equal(shouldPauseAppPolling({ gameplayOpen: true }), true);
  assert.equal(shouldPauseAppPolling({ gameplayOpen: false }), false);
});
