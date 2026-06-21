import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADRIAN_DURATION_SECONDS,
  ADRIAN_TAUMOEBA_PER_SECOND,
  createAdrianRun,
  getAdrianFlightErrorCue,
  getAdrianFlightCue,
  getAdrianReward,
  getAdrianRockyMessage,
  getAdrianTarget,
  stepAdrianRun,
} from './adrianSimulation.mjs';
import * as adrianSimulation from './adrianSimulation.mjs';

test('alignment error is centered and symmetric around the target', () => {
  assert.equal(typeof adrianSimulation.getAdrianAlignmentError, 'function');
  assert.equal(typeof adrianSimulation.isAdrianAligned, 'function');

  const target = { angle: 0.15, thrust: -0.1 };
  assert.equal(adrianSimulation.getAdrianAlignmentError(target, target), 0);
  const leftError = adrianSimulation.getAdrianAlignmentError(
    { angle: target.angle - 0.12, thrust: target.thrust },
    target,
  );
  const rightError = adrianSimulation.getAdrianAlignmentError(
    { angle: target.angle + 0.12, thrust: target.thrust },
    target,
  );
  assert.ok(Math.abs(leftError - rightError) < Number.EPSILON);
  assert.equal(
    adrianSimulation.isAdrianAligned(
      { angle: target.angle - 0.12, thrust: target.thrust },
      target,
    ),
    adrianSimulation.isAdrianAligned(
      { angle: target.angle + 0.12, thrust: target.thrust },
      target,
    ),
  );
  assert.equal(getAdrianFlightErrorCue(target, target).x, 0);
});

test('perfect tracking collects ten million Taumoeba in ten seconds', () => {
  let run = createAdrianRun();

  for (let index = 0; index < ADRIAN_DURATION_SECONDS * 20; index += 1) {
    const target = getAdrianTarget(run.elapsedSeconds);
    run = stepAdrianRun(run, target, 0.05);
  }

  assert.equal(run.finished, true);
  assert.equal(Math.round(run.taumoebaCollected), 10_000_000);
  assert.equal(getAdrianReward(run.taumoebaCollected), 10);
});

test('collection advances at one million per stable second', () => {
  let run = createAdrianRun();
  for (let index = 0; index < 10; index += 1) {
    run = stepAdrianRun(run, getAdrianTarget(run.elapsedSeconds), 0.1);
  }

  assert.equal(run.taumoebaCollected, ADRIAN_TAUMOEBA_PER_SECOND);
});

test('badly misaligned flight pauses collection and raises danger meters', () => {
  const run = stepAdrianRun(createAdrianRun(), { angle: 1, thrust: -1 }, 1);

  assert.equal(run.taumoebaCollected, 0);
  assert.ok(run.chainStrain > 0);
  assert.ok(run.heat > 0);
});

test('reward is one coin per full collected million, capped at ten', () => {
  assert.equal(getAdrianReward(999_999), 0);
  assert.equal(getAdrianReward(4_900_000), 4);
  assert.equal(getAdrianReward(8_999_999), 8);
  assert.equal(getAdrianReward(9_100_000), 10);
  assert.equal(getAdrianReward(50_000_000), 10);
});

test('flight cue maps angle and thrust to the ship scene axes', () => {
  assert.deepEqual(getAdrianFlightCue({ angle: 0.5, thrust: -0.4 }), {
    x: 0.21,
    y: 0.44,
    tilt: -0.01,
  });
});

test('flight error cue keeps the safe zone static while the ship shows course error', () => {
  assert.deepEqual(
    getAdrianFlightErrorCue(
      { angle: 0.5, thrust: -0.4 },
      { angle: 0.2, thrust: -0.1 },
    ),
    { x: 0.33, y: 0.305, tilt: -0.03 },
  );
});

test('Rocky celebrates stable flight in his clipped speaking style', () => {
  assert.equal(
    getAdrianRockyMessage({
      run: { stability: 0.9, chainStrain: 0.1, heat: 0.1 },
      control: { angle: 0, thrust: 0 },
      target: { angle: 0, thrust: 0 },
      variant: 0,
    }),
    'Amaze amaze amaze! Hold this!'
  );
});
