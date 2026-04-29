const db = require('./database');
const { liveStats } = require('./gameLogic');
const { getNextDirtyAt, shouldBecomeDirty } = require('./dirtyCycle');

const DIRTY_STATES = Object.freeze({
  CLEAN: 'clean',
  POOP: 'poop',
  SCRUBBING: 'scrubbing',
});

function ts() {
  return Math.floor(Date.now() / 1000);
}

function getPeeper(userId) {
  return db.prepare('SELECT * FROM peepers WHERE user_id = ?').get(userId);
}

function normalizeDirtyState(dirtyState) {
  if (dirtyState === DIRTY_STATES.POOP) return DIRTY_STATES.POOP;
  if (dirtyState === DIRTY_STATES.SCRUBBING) return DIRTY_STATES.SCRUBBING;
  return DIRTY_STATES.CLEAN;
}

function setDirtyState(userId, dirtyState, dirtyCycleKey = null) {
  const normalizedState = normalizeDirtyState(dirtyState);
  db.prepare(`
    UPDATE peepers
    SET dirty_state = ?, dirty_cycle_key = ?
    WHERE user_id = ?
  `).run(normalizedState, dirtyCycleKey, userId);
  return getPeeper(userId);
}

function setCleanState(userId, nowTs = ts()) {
  db.prepare(`
    UPDATE peepers
    SET dirty_state = ?, dirty_cycle_key = NULL, next_dirty_at = ?
    WHERE user_id = ?
  `).run(DIRTY_STATES.CLEAN, getNextDirtyAt(nowTs), userId);
  return getPeeper(userId);
}

function resetDirtyState(userId) {
  return setCleanState(userId);
}

function syncDirtyState(userId, nowTs = ts()) {
  let peeper = getPeeper(userId);
  if (!peeper) return null;

  const normalizedState = normalizeDirtyState(peeper.dirty_state);
  if (normalizedState !== peeper.dirty_state) {
    peeper = setDirtyState(userId, normalizedState, peeper.dirty_cycle_key ?? null);
  }

  if (!peeper.alive) return peeper;

  if (normalizedState === DIRTY_STATES.CLEAN && !(Number(peeper.next_dirty_at) > 0)) {
    peeper = setCleanState(userId, nowTs);
  }

  if (shouldBecomeDirty(peeper, nowTs)) {
    peeper = setDirtyState(userId, DIRTY_STATES.POOP, Number(peeper.next_dirty_at) || nowTs);
  }

  return peeper;
}

function serializeLivePeeper(peeper, nowTs = ts()) {
  if (!peeper) return null;
  return {
    ...peeper,
    ...liveStats(peeper, nowTs),
    server_now: nowTs,
  };
}

function applyDeath(userId, force = false) {
  const check = getPeeper(userId);
  if (!check) return;
  if (!check.alive) return;

  const secondsSinceFed = ts() - check.last_fed;
  if (!force && secondsSinceFed < 28800) {
    console.warn(`[applyDeath] BLOCKED for user ${userId}: last_fed only ${secondsSinceFed}s ago`);
    return;
  }

  db.transaction(() => {
    const equipped = [check.slot_head, check.slot_body, check.slot_hands, check.slot_fren, check.slot_face].filter(Boolean);

    db.prepare(`UPDATE peepers SET alive=0, hp=0,
      slot_head=NULL, slot_body=NULL, slot_hands=NULL, slot_fren=NULL, slot_face=NULL
      WHERE user_id=?`).run(userId);

    for (const itemId of equipped) {
      db.prepare('DELETE FROM owned_items WHERE user_id=? AND item_id=?').run(userId, itemId);
    }

    const fresh = db.prepare('SELECT coins FROM users WHERE id=?').get(userId);
    const penalty = Math.floor((fresh?.coins || 0) / 2);
    if (penalty > 0) {
      db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(penalty, userId);
    }
  })();
}

function syncPeeperRow(userId, nowTs = ts()) {
  const peeper = getPeeper(userId);
  if (!peeper) return null;

  if (peeper.alive) {
    const live = liveStats(peeper, nowTs);
    if (!live.alive) {
      applyDeath(userId, true);
      return getPeeper(userId);
    }
  }

  return syncDirtyState(userId, nowTs);
}

function syncOwnedPeeper(userId, nowTs = ts()) {
  return serializeLivePeeper(syncPeeperRow(userId, nowTs), nowTs);
}

function removePoop(userId, nowTs = ts()) {
  let peeper = syncPeeperRow(userId, nowTs);
  if (!peeper) return null;
  if (!peeper.alive) return serializeLivePeeper(peeper, nowTs);

  if (normalizeDirtyState(peeper.dirty_state) !== DIRTY_STATES.POOP) {
    return serializeLivePeeper(peeper, nowTs);
  }

  peeper = setDirtyState(userId, DIRTY_STATES.SCRUBBING, peeper.dirty_cycle_key ?? null);
  return serializeLivePeeper(peeper, nowTs);
}

function completeCleaning(userId, nowTs = ts()) {
  let peeper = syncPeeperRow(userId, nowTs);
  if (!peeper) return null;
  if (!peeper.alive) return serializeLivePeeper(peeper, nowTs);

  if (normalizeDirtyState(peeper.dirty_state) !== DIRTY_STATES.SCRUBBING) {
    return serializeLivePeeper(peeper, nowTs);
  }

  peeper = setCleanState(userId, nowTs);
  return serializeLivePeeper(peeper, nowTs);
}

function isDirty(peeper) {
  return normalizeDirtyState(peeper?.dirty_state) !== DIRTY_STATES.CLEAN;
}

module.exports = {
  DIRTY_STATES,
  ts,
  getPeeper,
  applyDeath,
  completeCleaning,
  isDirty,
  removePoop,
  resetDirtyState,
  serializeLivePeeper,
  setCleanState,
  setDirtyState,
  syncDirtyState,
  syncPeeperRow,
  syncOwnedPeeper,
};
