const DIRTY_CYCLE_SECONDS = 24 * 3600;
const EXISTING_DIRTY_MIN_SECONDS = 3600;
const EXISTING_DIRTY_MAX_SECONDS = 24 * 3600;

function getNextDirtyAt(nowTs) {
  return Math.floor(Number(nowTs) || 0) + DIRTY_CYCLE_SECONDS;
}

function getRandomInitialDirtyAt(nowTs, random = Math.random) {
  const base = Math.floor(Number(nowTs) || 0);
  const span = EXISTING_DIRTY_MAX_SECONDS - EXISTING_DIRTY_MIN_SECONDS;
  const offset = EXISTING_DIRTY_MIN_SECONDS + Math.floor(random() * (span + 1));
  return base + offset;
}

function shouldBecomeDirty(peeper, nowTs) {
  if (!peeper || !peeper.alive) return false;
  if ((peeper.dirty_state || 'clean') !== 'clean') return false;

  const nextDirtyAt = Math.floor(Number(peeper.next_dirty_at) || 0);
  return nextDirtyAt > 0 && Math.floor(Number(nowTs) || 0) >= nextDirtyAt;
}

module.exports = {
  DIRTY_CYCLE_SECONDS,
  EXISTING_DIRTY_MIN_SECONDS,
  EXISTING_DIRTY_MAX_SECONDS,
  getNextDirtyAt,
  getRandomInitialDirtyAt,
  shouldBecomeDirty,
};
