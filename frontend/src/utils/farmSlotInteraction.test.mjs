import test from 'node:test';
import assert from 'node:assert/strict';

test('keeps the popover only when the updated slot has an immediate action', async () => {
  const { FARM_RETIREMENT_LOCK_MS, getFarmSlotPostAction } = await import('./farmSlotInteraction.mjs');

  assert.equal(FARM_RETIREMENT_LOCK_MS, 1500);

  assert.deepEqual(
    getFarmSlotPostAction(
      { index: 0, state: 'plot_empty' },
      { index: 0, state: 'crop_growing', canWater: true },
    ),
    { keepOpen: true, retirementTransition: false },
  );
  assert.deepEqual(
    getFarmSlotPostAction(
      { index: 0, state: 'crop_growing', canWater: true },
      { index: 0, state: 'crop_growing', canWater: false },
    ),
    { keepOpen: false, retirementTransition: false },
  );
  assert.deepEqual(
    getFarmSlotPostAction(
      { index: 1, state: 'animal_hungry' },
      { index: 1, state: 'animal_producing' },
    ),
    { keepOpen: false, retirementTransition: false },
  );
  assert.deepEqual(
    getFarmSlotPostAction(
      { index: 1, state: 'animal_ready', lifeRemainingSeconds: 0 },
      { index: 1, state: 'pen_empty' },
    ),
    { keepOpen: false, retirementTransition: true },
  );
  assert.equal(
    getFarmSlotPostAction(
      { index: 1, state: 'animal_ready', lifeRemainingSeconds: 1 },
      { index: 1, state: 'pen_empty' },
    ).retirementTransition,
    true,
  );
});

test('keeps build, planting, feeding, and collection choices available', async () => {
  const { getFarmSlotPostAction } = await import('./farmSlotInteraction.mjs');

  for (const state of ['unbuilt', 'plot_empty', 'pen_empty', 'crop_ready', 'animal_ready', 'animal_hungry']) {
    assert.equal(
      getFarmSlotPostAction(null, { index: 0, state }).keepOpen,
      true,
      `${state} should remain interactive`,
    );
  }
});
