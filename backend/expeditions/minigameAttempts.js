'use strict';

const crypto = require('node:crypto');

const GAME_RULES = Object.freeze({
  root_crossing: Object.freeze({ durationSeconds: 15, minimumSeconds: 0 }),
  timing_window: Object.freeze({ durationSeconds: 12, minimumSeconds: 0 }),
  rune_sequence: Object.freeze({ durationSeconds: 15, minimumSeconds: 1 }),
  focus_hold: Object.freeze({ durationSeconds: 12, minimumSeconds: 0 }),
  shade_hunt: Object.freeze({ durationSeconds: 8, minimumSeconds: 0 }),
});

const GAME_ALIASES = Object.freeze({
  path_pick: 'root_crossing',
  shadow_match: 'shade_hunt',
});

const OPEN_STATUSES = new Set(['ready', 'active', 'retry']);
const FINAL_STATUSES = new Set(['succeeded', 'failed', 'expired']);
const INTERNAL_IDEMPOTENCY_PREFIX = '$internal$:';
const ALLOWED_RESULT_FIELDS = new Set([
  'success',
  'score',
  'reason',
  'seed',
  'rowsCrossed',
  'targetIndex',
  'selectedIndex',
  'sequence',
  'input',
]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseJson(text, fallback = {}) {
  if (!text) return clone(fallback);
  try {
    return JSON.parse(text);
  } catch {
    return clone(fallback);
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function normalizeGameType(value) {
  const gameType = GAME_ALIASES[value] || value;
  if (!GAME_RULES[gameType]) throw new RangeError(`Unsupported mini-game: ${value}`);
  return gameType;
}

function publicSeed({ expeditionId, roomId, userId, idempotencyKey }) {
  return crypto.createHash('sha256')
    .update(`${expeditionId}:${roomId}:${userId}:${idempotencyKey}`)
    .digest('base64url')
    .slice(0, 24);
}

function opaqueToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function attemptMetadata(row) {
  return parseJson(row.result_json, { startIntent: null, startReplays: [], finishes: [] });
}

function publicAttempt(row, extra = {}) {
  return {
    attemptToken: row.attempt_token,
    gameType: row.game_type,
    seed: row.seed,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    retry: row.status === 'retry',
    ...clone(extra),
  };
}

function globalKeyUsage(transaction, { userId, idempotencyKey }) {
  const rows = transaction.prepare(`
    SELECT * FROM family_expedition_minigame_attempts
    WHERE user_id = ?
    ORDER BY id
  `).all(userId);
  for (const row of rows) {
    const metadata = attemptMetadata(row);
    if (metadata.startIdempotencyKey === idempotencyKey) {
      return { kind: 'start', row, intent: metadata.startIntent };
    }
    const startReplay = (metadata.startReplays || [])
      .find(item => item.idempotencyKey === idempotencyKey);
    if (startReplay) return { kind: 'start', row, intent: startReplay.intent };
    const finish = (metadata.finishes || []).find(item => item.idempotencyKey === idempotencyKey);
    if (finish) return { kind: 'finish', row, intent: finish.intent, response: finish.response };
  }
  const action = transaction.prepare(`
    SELECT id FROM family_expedition_actions
    WHERE user_id = ? AND idempotency_key = ?
  `).get(userId, idempotencyKey);
  return action ? { kind: 'action' } : null;
}

function isReservedIdempotencyKey(value) {
  return String(value || '').startsWith(INTERNAL_IDEMPOTENCY_PREFIX);
}

function bindStartReplay(transaction, options) {
  const {
    expeditionId,
    roomId,
    userId,
    attemptToken,
    idempotencyKey,
  } = options;
  if (!idempotencyKey) throw new TypeError('idempotencyKey is required');
  const gameType = normalizeGameType(options.gameType);
  const intent = { expeditionId, roomId, userId, gameType };
  const row = findScopedAttempt(transaction, { expeditionId, roomId, userId, attemptToken });
  if (!row || row.status !== 'retry') throw new RangeError('mini-game retry attempt not found');

  const keyUsage = globalKeyUsage(transaction, { userId, idempotencyKey });
  if (keyUsage) {
    if (
      keyUsage.kind === 'start'
      && keyUsage.row.id === row.id
      && stableStringify(keyUsage.intent) === stableStringify(intent)
    ) {
      return publicAttempt(row);
    }
    throw new Error('idempotency conflict: start key was used with different intent');
  }

  const metadata = attemptMetadata(row);
  metadata.startReplays = [
    ...(metadata.startReplays || []),
    { idempotencyKey, intent },
  ];
  transaction.prepare(`
    UPDATE family_expedition_minigame_attempts SET result_json = ? WHERE id = ?
  `).run(JSON.stringify(metadata), row.id);
  return publicAttempt(row);
}

function assertGlobalIdempotencyKeyUnused(transaction, options) {
  if (globalKeyUsage(transaction, options)) {
    throw new Error('idempotency conflict: key was already used for another mutation');
  }
}

function findScopedAttempt(transaction, { expeditionId, roomId, userId, attemptToken }) {
  return transaction.prepare(`
    SELECT * FROM family_expedition_minigame_attempts
    WHERE expedition_id = ? AND room_id = ? AND user_id = ? AND attempt_token = ?
  `).get(expeditionId, roomId, userId, attemptToken);
}

function readOpenAttempt(transaction, { expeditionId, roomId, userId }) {
  const row = transaction.prepare(`
    SELECT * FROM family_expedition_minigame_attempts
    WHERE expedition_id = ? AND room_id = ? AND user_id = ?
      AND status IN ('ready', 'active', 'retry')
    ORDER BY id DESC LIMIT 1
  `).get(expeditionId, roomId, userId);
  return row ? publicAttempt(row) : null;
}

function startAttempt(transaction, options) {
  const {
    expeditionId,
    roomId,
    userId,
    idempotencyKey,
    now,
  } = options;
  if (!idempotencyKey) throw new TypeError('idempotencyKey is required');
  const gameType = normalizeGameType(options.gameType);
  const startIntent = { expeditionId, roomId, userId, gameType };
  const startedAt = Math.floor(Number(now));
  if (!Number.isInteger(startedAt) || startedAt < 0) throw new TypeError('valid now is required');

  const keyUsage = globalKeyUsage(transaction, { userId, idempotencyKey });
  if (keyUsage) {
    if (keyUsage.kind !== 'start' || stableStringify(keyUsage.intent) !== stableStringify(startIntent)) {
      throw new Error('idempotency conflict: start key was used with different intent');
    }
    return publicAttempt(keyUsage.row);
  }

  let openAttempt = readOpenAttempt(transaction, { expeditionId, roomId, userId });
  if (openAttempt && openAttempt.expiresAt <= startedAt && typeof options.expireOpenAttempt === 'function') {
    options.expireOpenAttempt(openAttempt);
    openAttempt = readOpenAttempt(transaction, { expeditionId, roomId, userId });
  }
  if (openAttempt) {
    throw new RangeError('mini-game attempt is already active');
  }

  if (typeof options.onStart === 'function') options.onStart({ gameType });

  const rule = GAME_RULES[gameType];
  const seed = publicSeed({ expeditionId, roomId, userId, idempotencyKey });
  const token = opaqueToken();
  transaction.prepare(`
    INSERT INTO family_expedition_minigame_attempts (
      attempt_token, expedition_id, room_id, user_id, game_type, seed, status,
      ap_spent, retry_available, started_at, expires_at, result_json
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, 0, ?, ?, ?)
  `).run(
    token,
    expeditionId,
    roomId,
    userId,
    gameType,
    seed,
    startedAt,
    startedAt + rule.durationSeconds,
    JSON.stringify({ startIdempotencyKey: idempotencyKey, startIntent, finishes: [] }),
  );
  return publicAttempt(findScopedAttempt(transaction, {
    expeditionId,
    roomId,
    userId,
    attemptToken: token,
  }));
}

function integerInRange(value, min, max, field) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${field} is outside the allowed score bounds`);
  }
  return value;
}

function shortString(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 40) throw new TypeError(`${field} is invalid`);
  return value;
}

function shortArray(value, field) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 9 || value.some(item => typeof item !== 'string' || item.length > 20)) {
    throw new TypeError(`${field} is invalid`);
  }
  return [...value];
}

function expectedShadeTarget(seed) {
  const digest = crypto.createHash('sha256').update(`shade:${seed}`).digest();
  return digest[0] % 6;
}

function expectedRuneInput(seed) {
  const symbols = ['rune', 'root', 'moon', 'skull', 'crown', 'fang', 'lantern', 'key', 'eye'];
  const digest = crypto.createHash('sha256').update(`runes:${seed}`).digest();
  const pool = [...symbols];
  const sequence = [];
  for (let index = 0; index < 3; index += 1) {
    sequence.push(pool.splice(digest[index] % pool.length, 1)[0]);
  }
  return sequence;
}

function normalizeResult(row, value, { forceTimeout = false } = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const unknown = Object.keys(input).filter(key => !ALLOWED_RESULT_FIELDS.has(key));
  if (unknown.length > 0) throw new TypeError(`result contains disallowed fields: ${unknown.join(', ')}`);
  if (input.seed !== undefined && input.seed !== row.seed) throw new RangeError('attempt seed does not match');

  const score = input.score === undefined ? undefined : integerInRange(input.score, 0, 100, 'score');
  const rowsCrossed = input.rowsCrossed === undefined
    ? undefined
    : integerInRange(input.rowsCrossed, 0, 6, 'rowsCrossed');
  const targetIndex = input.targetIndex === undefined
    ? undefined
    : integerInRange(input.targetIndex, 0, 5, 'targetIndex');
  const selectedIndex = input.selectedIndex === undefined
    ? undefined
    : integerInRange(input.selectedIndex, 0, 5, 'selectedIndex');
  const normalized = {
    success: Boolean(input.success),
    ...(score === undefined ? {} : { score }),
    ...(rowsCrossed === undefined ? {} : { rowsCrossed }),
    ...(targetIndex === undefined ? {} : { targetIndex }),
    ...(selectedIndex === undefined ? {} : { selectedIndex }),
    ...(input.reason === undefined ? {} : { reason: shortString(input.reason, 'reason') }),
    ...(input.sequence === undefined ? {} : { sequence: shortArray(input.sequence, 'sequence') }),
    ...(input.input === undefined ? {} : { input: shortArray(input.input, 'input') }),
  };

  if (forceTimeout) return { ...normalized, success: false, reason: 'timeout' };
  if (row.game_type === 'root_crossing') {
    normalized.success = normalized.success && rowsCrossed !== undefined && rowsCrossed >= 5;
  } else if (row.game_type === 'shade_hunt') {
    normalized.success = normalized.success
      && targetIndex !== undefined
      && selectedIndex !== undefined
      && targetIndex === expectedShadeTarget(row.seed)
      && selectedIndex === targetIndex;
  } else if (['timing_window', 'focus_hold'].includes(row.game_type)) {
    normalized.success = normalized.success && score !== undefined && score >= 60;
  } else if (row.game_type === 'rune_sequence') {
    normalized.success = normalized.success
      && normalized.input !== undefined
      && stableStringify(expectedRuneInput(row.seed)) === stableStringify(normalized.input);
  }
  return normalized;
}

function storeResolution(transaction, row, metadata, record, updates) {
  metadata.finishes = [...(metadata.finishes || []), record];
  transaction.prepare(`
    UPDATE family_expedition_minigame_attempts
    SET status = ?, retry_available = ?, started_at = ?, expires_at = ?,
        finished_at = ?, result_json = ?
    WHERE id = ?
  `).run(
    updates.status,
    updates.retryAvailable ? 1 : 0,
    updates.startedAt,
    updates.expiresAt,
    updates.finishedAt,
    JSON.stringify(metadata),
    row.id,
  );
}

function finishAttempt(transaction, options) {
  const {
    expeditionId,
    roomId,
    userId,
    attemptToken,
    idempotencyKey,
    now,
    consumeRetry = () => null,
    onSuccess = () => ({}),
    onFailure = () => ({}),
    forceState = null,
  } = options;
  if (!idempotencyKey) throw new TypeError('idempotencyKey is required');
  const row = findScopedAttempt(transaction, { expeditionId, roomId, userId, attemptToken });
  if (!row) throw new RangeError('mini-game attempt not found');
  const metadata = attemptMetadata(row);
  const normalizedNow = Math.floor(Number(now));
  if (!Number.isInteger(normalizedNow) || normalizedNow < 0) throw new TypeError('valid now is required');
  const timedOut = forceState === 'expired' || normalizedNow >= row.expires_at;
  const outcome = normalizeResult(row, options.result, { forceTimeout: timedOut });
  const intent = { attemptToken, outcome, forceState: forceState || null };
  const keyUsage = globalKeyUsage(transaction, { userId, idempotencyKey });
  if (keyUsage) {
    if (
      keyUsage.kind === 'finish'
      && keyUsage.row.id === row.id
      && stableStringify(keyUsage.intent) === stableStringify(intent)
    ) {
      return clone(keyUsage.response);
    }
    throw new Error('idempotency conflict: finish key was used with different intent');
  }
  if (FINAL_STATUSES.has(row.status)) throw new RangeError('mini-game attempt is already resolved');
  if (!OPEN_STATUSES.has(row.status)) throw new RangeError('mini-game attempt is not active');

  const rule = GAME_RULES[row.game_type];
  if (!timedOut && normalizedNow < row.started_at + rule.minimumSeconds) {
    throw new RangeError('mini-game result arrived too early');
  }

  let response;
  let nextStatus;
  let startedAt = row.started_at;
  let expiresAt = row.expires_at;
  let finishedAt = normalizedNow;
  if (outcome.success) {
    const awarded = clone(onSuccess({ row: clone(row), outcome: clone(outcome) }) || {});
    nextStatus = 'succeeded';
    response = {
      ...publicAttempt({ ...row, status: nextStatus }),
      retry: false,
      state: nextStatus,
      success: true,
      ...awarded,
    };
  } else if (row.status !== 'retry') {
    const retry = consumeRetry({ row: clone(row), outcome: clone(outcome) });
    if (retry) {
      nextStatus = 'retry';
      startedAt = normalizedNow;
      expiresAt = normalizedNow + rule.durationSeconds;
      finishedAt = null;
      response = {
        ...publicAttempt({
          ...row,
          status: nextStatus,
          started_at: startedAt,
          expires_at: expiresAt,
        }),
        retry: true,
        state: nextStatus,
        success: false,
        visualEvents: retry.event ? [clone(retry.event)] : [],
      };
    }
  }

  if (!response) {
    nextStatus = timedOut ? 'expired' : 'failed';
    const failure = clone(onFailure({ row: clone(row), outcome: clone(outcome) }) || {});
    response = {
      ...publicAttempt({ ...row, status: nextStatus }),
      retry: false,
      state: nextStatus,
      success: false,
      reason: outcome.reason || (timedOut ? 'timeout' : 'failed'),
      ...failure,
    };
  }

  storeResolution(transaction, row, metadata, {
    idempotencyKey,
    intent,
    response,
  }, {
    status: nextStatus,
    retryAvailable: nextStatus === 'retry',
    startedAt,
    expiresAt,
    finishedAt,
  });
  return clone(response);
}

function expireAttempt(transaction, options) {
  return finishAttempt(transaction, {
    ...options,
    result: { success: false, reason: 'timeout' },
    forceState: 'expired',
  });
}

module.exports = {
  GAME_RULES,
  INTERNAL_IDEMPOTENCY_PREFIX,
  assertGlobalIdempotencyKeyUnused,
  bindStartReplay,
  expireAttempt,
  finishAttempt,
  isReservedIdempotencyKey,
  readOpenAttempt,
  startAttempt,
};
