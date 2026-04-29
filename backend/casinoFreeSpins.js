const DOUBLE_SINO_FREE_SPIN_AWARD = 1;

function normalizeFreeSpins(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function resolveCasinoSpinUsage({ freeSpinsBefore = 0, currentEnergy = 0 }) {
  const safeFreeSpinsBefore = normalizeFreeSpins(freeSpinsBefore);
  const safeEnergy = Math.max(0, Math.floor(Number(currentEnergy) || 0));
  const hasFreeSpin = safeFreeSpinsBefore > 0;

  return {
    hasFreeSpin,
    requiresEnergy: !hasFreeSpin,
    energyConsumed: !hasFreeSpin && safeEnergy > 0,
  };
}

function resolveCasinoSpinCredits({ patternKey, freeSpinsBefore = 0, spinCost = 0 }) {
  const safeFreeSpinsBefore = normalizeFreeSpins(freeSpinsBefore);
  const safeSpinCost = Math.max(0, Math.floor(Number(spinCost) || 0));
  const freeSpinUsed = safeFreeSpinsBefore > 0;
  const freeSpinAwarded = patternKey === 'double_sino' ? DOUBLE_SINO_FREE_SPIN_AWARD : 0;

  return {
    freeSpinUsed,
    freeSpinAwarded,
    freeSpinsAfter: safeFreeSpinsBefore - (freeSpinUsed ? 1 : 0) + freeSpinAwarded,
    spinCostPaid: freeSpinUsed ? 0 : safeSpinCost,
    jackpotContributionApplied: freeSpinUsed ? 0 : safeSpinCost > 0 ? 1 : 0,
  };
}

module.exports = {
  DOUBLE_SINO_FREE_SPIN_AWARD,
  normalizeFreeSpins,
  resolveCasinoSpinUsage,
  resolveCasinoSpinCredits,
};
