import test from 'node:test';
import assert from 'node:assert/strict';

import { generateCityWindowLayout } from '../src/games/flappyScene.mjs';

function createSequenceRng(values) {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1] ?? 0;
    index += 1;
    return value;
  };
}

test('generateCityWindowLayout returns stable window coordinates for each building', () => {
  const buildings = [
    { w: 24, h: 36 },
    { w: 40, h: 54 },
  ];

  const layout = generateCityWindowLayout(buildings, createSequenceRng([0.9, 0.2, 0.6, 0.4, 0.95, 0.1]));

  assert.equal(layout.length, 2);
  assert.deepEqual(layout[0], [
    { x: 4, y: 6, w: 4.32, h: 4.32 },
    { x: 4, y: 15.32, w: 4.32, h: 4.32 },
    { x: 12.32, y: 15.32, w: 4.32, h: 4.32 },
    { x: 4, y: 24.64, w: 4.32, h: 4.32 },
  ]);
  assert.ok(Array.isArray(layout[1]));
  assert.ok(layout.flat().every((windowRect) => windowRect.x >= 4 && windowRect.y >= 6));
});

test('generateCityWindowLayout is deterministic for the same rng stream', () => {
  const buildings = [{ w: 55, h: 80 }];
  const values = [0.12, 0.76, 0.44, 0.91, 0.08, 0.33, 0.67, 0.22];

  const first = generateCityWindowLayout(buildings, createSequenceRng(values));
  const second = generateCityWindowLayout(buildings, createSequenceRng(values));

  assert.deepEqual(first, second);
});
