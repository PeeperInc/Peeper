const IMMEDIATE_ACTION_STATES = new Set([
  'unbuilt',
  'plot_empty',
  'pen_empty',
  'crop_ready',
  'animal_ready',
  'animal_hungry',
]);

export const FARM_RETIREMENT_LOCK_MS = 1500;

export function hasImmediateFarmSlotAction(slot) {
  if (!slot) return false;
  if (slot.state === 'crop_growing') return Boolean(slot.canWater);
  return IMMEDIATE_ACTION_STATES.has(slot.state);
}

export function getFarmSlotPostAction(previousSlot, updatedSlot) {
  const retirementTransition = Boolean(
    previousSlot?.state === 'animal_ready'
    && updatedSlot?.state === 'pen_empty',
  );

  return {
    keepOpen: !retirementTransition && hasImmediateFarmSlotAction(updatedSlot),
    retirementTransition,
  };
}
