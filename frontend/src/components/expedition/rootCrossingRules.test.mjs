import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOT_CROSSING_LANE_COUNT,
  buildRootCrossingLanes,
} from './rootCrossingRules.mjs';

function circularDistance(left, right) {
  const distance = Math.abs(left - right);
  return Math.min(distance, 100 - distance);
}

test('root crossing generates sparse deterministic lanes with fair gaps', () => {
  const first = buildRootCrossingLanes('ongoing-expedition-room');
  const replay = buildRootCrossingLanes('ongoing-expedition-room');

  assert.deepEqual(first, replay);
  assert.equal(first.length, ROOT_CROSSING_LANE_COUNT);
  assert.deepEqual(first.map(lane => lane.hazards.length), [1, 1, 1, 1, 2, 2]);

  first.forEach((lane, laneIndex) => {
    assert.ok(lane.speed >= 6.5 + laneIndex * 0.25);
    assert.ok(lane.speed < 9.5 + laneIndex * 0.25);
    lane.hazards.forEach(hazard => {
      assert.ok(hazard.width >= 16 && hazard.width < 22);
    });
    if (lane.hazards.length === 2) {
      assert.ok(circularDistance(lane.hazards[0].offset, lane.hazards[1].offset) >= 42);
    }
  });

  const leadingOffsets = first.map(lane => lane.hazards[0].offset);
  leadingOffsets.slice(1).forEach((offset, index) => {
    assert.ok(circularDistance(offset, leadingOffsets[index]) >= 10);
  });
});
