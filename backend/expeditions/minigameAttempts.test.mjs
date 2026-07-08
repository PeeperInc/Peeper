import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const {
  expireAttempt,
  finishAttempt,
  readOpenAttempt,
  startAttempt,
} = require('./minigameAttempts.js');

function attemptDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE family_expedition_minigame_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_token TEXT NOT NULL,
      expedition_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      game_type TEXT NOT NULL,
      seed TEXT NOT NULL,
      status TEXT NOT NULL,
      ap_spent INTEGER NOT NULL DEFAULT 0,
      retry_available INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      finished_at INTEGER,
      result_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE UNIQUE INDEX idx_attempt_token
      ON family_expedition_minigame_attempts(attempt_token);
    CREATE UNIQUE INDEX idx_open_attempt
      ON family_expedition_minigame_attempts(expedition_id, room_id, user_id)
      WHERE status IN ('ready', 'active', 'retry');
    CREATE TABLE family_expedition_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      UNIQUE(user_id, idempotency_key)
    );
  `);
  return db;
}

const baseStart = {
  expeditionId: 10,
  roomId: 20,
  userId: 30,
  gameType: 'root_crossing',
  idempotencyKey: 'start-1',
  now: 1_000,
};

const PUBLIC_ATTEMPT_KEYS = [
  'attemptToken',
  'expiresAt',
  'gameType',
  'retry',
  'seed',
  'startedAt',
];

test('start creates an active opaque attempt with deterministic seed and exact public shape', () => {
  const db = attemptDb();
  const first = startAttempt(db, baseStart);
  const otherDb = attemptDb();
  const second = startAttempt(otherDb, baseStart);

  assert.match(first.attemptToken, /^[A-Za-z0-9_-]{20,}$/);
  assert.equal(first.gameType, 'root_crossing');
  assert.equal(first.seed, second.seed);
  assert.equal(first.startedAt, 1_000);
  assert.equal(first.expiresAt, 1_015);
  assert.equal(first.retry, false);
  assert.deepEqual(Object.keys(first).sort(), PUBLIC_ATTEMPT_KEYS);
  assert.equal(db.prepare('SELECT ap_spent FROM family_expedition_minigame_attempts').get().ap_spent, 1);
});

test('duplicate start replays the same attempt and rejects mismatched intent', () => {
  const db = attemptDb();
  const first = startAttempt(db, baseStart);
  const replay = startAttempt(db, baseStart);
  assert.deepEqual(replay, first);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM family_expedition_minigame_attempts').get().count, 1);

  assert.throws(
    () => startAttempt(db, { ...baseStart, gameType: 'shadow_match' }),
    /idempotency conflict/i,
  );
});

test('ordinary start replay stays immutable after the attempt becomes a Mage retry', () => {
  const db = attemptDb();
  const first = startAttempt(db, baseStart);
  assert.deepEqual(startAttempt(db, baseStart), first);

  finishAttempt(db, {
    ...baseStart,
    attemptToken: first.attemptToken,
    idempotencyKey: 'finish-ordinary-into-retry',
    now: 1_004,
    result: { success: false, reason: 'collision' },
    consumeRetry: () => ({ event: { type: 'mage_retry' } }),
  });

  const delayedReplay = startAttempt(db, baseStart);
  assert.deepEqual(delayedReplay, first);
  assert.deepEqual(Object.keys(delayedReplay).sort(), PUBLIC_ATTEMPT_KEYS);
});

test('only one unresolved attempt can exist per expedition room and user', () => {
  const db = attemptDb();
  startAttempt(db, baseStart);
  assert.throws(
    () => startAttempt(db, { ...baseStart, idempotencyKey: 'start-2' }),
    /attempt is already active/i,
  );
  assert.equal(readOpenAttempt(db, baseStart)?.attemptToken.length > 0, true);
});

test('start idempotency key is global per user across rooms and action mutations', () => {
  const db = attemptDb();
  startAttempt(db, baseStart);

  assert.throws(() => startAttempt(db, {
    ...baseStart,
    roomId: 21,
  }), /idempotency conflict/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM family_expedition_minigame_attempts').get().count, 1);

  db.prepare('INSERT INTO family_expedition_actions (idempotency_key, user_id) VALUES (?, ?)')
    .run('action-key', baseStart.userId);
  assert.throws(() => startAttempt(db, {
    ...baseStart,
    roomId: 21,
    idempotencyKey: 'action-key',
  }), /idempotency conflict/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM family_expedition_minigame_attempts').get().count, 1);
});

test('finish idempotency key is global per user across attempts and action mutations', () => {
  const db = attemptDb();
  const first = startAttempt(db, baseStart);
  finishAttempt(db, {
    ...baseStart,
    attemptToken: first.attemptToken,
    idempotencyKey: 'global-finish',
    now: 1_001,
    result: { success: false, rowsCrossed: 0 },
  });
  const second = startAttempt(db, {
    ...baseStart,
    roomId: 21,
    idempotencyKey: 'second-start',
    now: 1_002,
  });

  assert.throws(() => finishAttempt(db, {
    ...baseStart,
    roomId: 21,
    attemptToken: second.attemptToken,
    idempotencyKey: 'global-finish',
    now: 1_003,
    result: { success: false, rowsCrossed: 0 },
  }), /idempotency conflict/i);

  db.prepare('INSERT INTO family_expedition_actions (idempotency_key, user_id) VALUES (?, ?)')
    .run('finish-action-key', baseStart.userId);
  assert.throws(() => finishAttempt(db, {
    ...baseStart,
    roomId: 21,
    attemptToken: second.attemptToken,
    idempotencyKey: 'finish-action-key',
    now: 1_003,
    result: { success: false, rowsCrossed: 0 },
  }), /idempotency conflict/i);
});

test('finish validates bounded game proof and resolves success once', () => {
  const db = attemptDb();
  const attempt = startAttempt(db, { ...baseStart, gameType: 'focus_hold' });
  assert.throws(() => finishAttempt(db, {
    ...baseStart,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'finish-forged',
    now: 1_002,
    result: { success: true, score: 9_999, progress: 99, loot: { artifactRolls: 99 } },
  }), /allowed fields|score/i);

  const result = finishAttempt(db, {
    ...baseStart,
    gameType: undefined,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'finish-1',
    now: 1_003,
    result: { success: true, score: 78 },
    onSuccess: () => ({ progressAwarded: 1, loot: { coins: 4 } }),
  });
  assert.equal(result.state, 'succeeded');
  assert.equal(result.success, true);
  assert.equal(result.progressAwarded, 1);
  assert.deepEqual(result.loot, { coins: 4 });
  assert.deepEqual(finishAttempt(db, {
    ...baseStart,
    gameType: undefined,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'finish-1',
    now: 1_004,
    result: { success: true, score: 78 },
  }), result);
  assert.throws(() => finishAttempt(db, {
    ...baseStart,
    gameType: undefined,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'finish-1',
    now: 1_004,
    result: { success: false, score: 0 },
  }), /idempotency conflict/i);
});

test('finish replay after its deadline returns the immutable response before timeout normalization', () => {
  const db = attemptDb();
  const attempt = startAttempt(db, { ...baseStart, gameType: 'focus_hold' });
  let successCalls = 0;
  let failureCalls = 0;
  const options = {
    ...baseStart,
    gameType: undefined,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'finish-before-deadline',
    result: { success: true, score: 78 },
    onSuccess: () => {
      successCalls += 1;
      return {
        progressAwarded: 2,
        loot: { coins: 9 },
        visualEvents: [{ type: 'event_minigame_success' }],
      };
    },
    onFailure: () => {
      failureCalls += 1;
      return { visualEvents: [{ type: 'hero_damaged' }] };
    },
  };
  const first = finishAttempt(db, { ...options, now: 1_003 });
  const replay = finishAttempt(db, { ...options, now: attempt.expiresAt + 10 });

  assert.deepEqual(replay, first);
  assert.deepEqual(Object.keys(first.attempt).sort(), PUBLIC_ATTEMPT_KEYS);
  assert.equal(successCalls, 1);
  assert.equal(failureCalls, 0);
});

test('finish envelopes keep outcome and rewards outside every exact six-field attempt', () => {
  const db = attemptDb();
  const successAttempt = startAttempt(db, { ...baseStart, gameType: 'focus_hold' });
  const success = finishAttempt(db, {
    ...baseStart,
    gameType: undefined,
    attemptToken: successAttempt.attemptToken,
    idempotencyKey: 'finish-shape-success',
    now: 1_003,
    result: { success: true, score: 80 },
    onSuccess: () => ({
      progressAwarded: 1,
      loot: { coins: 4 },
      visualEvents: [{ type: 'event_minigame_success' }],
    }),
  });
  assert.deepEqual(Object.keys(success.attempt).sort(), PUBLIC_ATTEMPT_KEYS);
  assert.equal(success.state, 'succeeded');
  assert.equal(success.success, true);
  assert.equal(success.progressAwarded, 1);
  assert.deepEqual(success.loot, { coins: 4 });
  assert.deepEqual(success.visualEvents, [{ type: 'event_minigame_success' }]);

  const replay = finishAttempt(db, {
    ...baseStart,
    gameType: undefined,
    attemptToken: successAttempt.attemptToken,
    idempotencyKey: 'finish-shape-success',
    now: 1_004,
    result: { success: true, score: 80 },
  });
  assert.deepEqual(replay, success);
  assert.deepEqual(Object.keys(replay.attempt).sort(), PUBLIC_ATTEMPT_KEYS);
});

test('failure can transition through one Mage retry without AP or damage', () => {
  const db = attemptDb();
  const attempt = startAttempt(db, baseStart);
  let damageCalls = 0;
  const retry = finishAttempt(db, {
    ...baseStart,
    gameType: undefined,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'finish-fail-1',
    now: 1_004,
    result: { success: false, reason: 'collision' },
    consumeRetry: () => ({ event: { type: 'mage_retry' } }),
    onFailure: () => { damageCalls += 1; },
  });
  assert.equal(retry.state, 'retry');
  assert.equal(retry.attempt.retry, true);
  assert.deepEqual(Object.keys(retry.attempt).sort(), PUBLIC_ATTEMPT_KEYS);
  assert.deepEqual(retry.visualEvents, [{ type: 'mage_retry' }]);
  assert.equal(damageCalls, 0);
  assert.equal(db.prepare('SELECT ap_spent FROM family_expedition_minigame_attempts').get().ap_spent, 1);

  const failed = finishAttempt(db, {
    ...baseStart,
    gameType: undefined,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'finish-fail-2',
    now: 1_008,
    result: { success: false, reason: 'collision' },
    consumeRetry: () => null,
    onFailure: () => {
      damageCalls += 1;
      return { heroHp: 2, visualEvents: [{ type: 'hero_damaged' }] };
    },
  });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.attempt.retry, false);
  assert.deepEqual(Object.keys(failed.attempt).sort(), PUBLIC_ATTEMPT_KEYS);
  assert.equal(failed.heroHp, 2);
  assert.equal(damageCalls, 1);
});

test('timeout expires as one failed attempt and replay does not duplicate damage', () => {
  const db = attemptDb();
  const attempt = startAttempt(db, baseStart);
  let damageCalls = 0;
  const expired = expireAttempt(db, {
    expeditionId: 10,
    roomId: 20,
    userId: 30,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'timeout-1',
    now: 1_016,
    onFailure: () => {
      damageCalls += 1;
      return { heroHp: 0, heroRecoverAt: 22_616 };
    },
  });
  assert.equal(expired.state, 'expired');
  assert.equal(expired.success, false);
  assert.equal(expired.heroHp, 0);
  assert.deepEqual(Object.keys(expired.attempt).sort(), PUBLIC_ATTEMPT_KEYS);
  assert.equal(damageCalls, 1);
  assert.deepEqual(expireAttempt(db, {
    expeditionId: 10,
    roomId: 20,
    userId: 30,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'timeout-1',
    now: 1_017,
  }), expired);
  assert.equal(damageCalls, 1);
});

test('deadline is exclusive and timeout consumes Mage retry with a fresh deadline', () => {
  const db = attemptDb();
  const attempt = startAttempt(db, baseStart);
  let damageCalls = 0;
  let retryCalls = 0;
  const result = finishAttempt(db, {
    ...baseStart,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'deadline-retry',
    now: attempt.expiresAt,
    result: { success: true, rowsCrossed: 5 },
    consumeRetry: () => {
      retryCalls += 1;
      return { event: { type: 'mage_retry' } };
    },
    onFailure: () => { damageCalls += 1; },
  });

  assert.equal(result.state, 'retry');
  assert.equal(result.success, false);
  assert.equal(result.attempt.retry, true);
  assert.deepEqual(Object.keys(result.attempt).sort(), PUBLIC_ATTEMPT_KEYS);
  assert.equal(result.attempt.startedAt, attempt.expiresAt);
  assert.equal(result.attempt.expiresAt, attempt.expiresAt + 15);
  assert.equal(retryCalls, 1);
  assert.equal(damageCalls, 0);
});

test('attempt tokens are owner and room scoped', () => {
  const db = attemptDb();
  const attempt = startAttempt(db, baseStart);
  assert.throws(() => finishAttempt(db, {
    expeditionId: 10,
    roomId: 20,
    userId: 31,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'steal',
    now: 1_003,
    result: { success: true, score: 100 },
  }), /attempt not found/i);
  assert.throws(() => finishAttempt(db, {
    expeditionId: 10,
    roomId: 21,
    userId: 30,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'wrong-room',
    now: 1_003,
    result: { success: true, score: 100 },
  }), /attempt not found/i);
});

test('claimed success without game-specific proof resolves as failure', () => {
  const db = attemptDb();
  const attempt = startAttempt(db, baseStart);
  const result = finishAttempt(db, {
    ...baseStart,
    gameType: undefined,
    attemptToken: attempt.attemptToken,
    idempotencyKey: 'forged-root-success',
    now: 1_001,
    result: { success: true },
  });
  assert.equal(result.state, 'failed');
  assert.equal(result.success, false);
});

test('new start expires a stale open attempt before spending another AP', () => {
  const db = attemptDb();
  const stale = startAttempt(db, baseStart);
  let expiredToken = null;
  const fresh = startAttempt(db, {
    ...baseStart,
    idempotencyKey: 'start-after-timeout',
    now: 1_015,
    expireOpenAttempt: open => {
      expiredToken = open.attemptToken;
      expireAttempt(db, {
        expeditionId: 10,
        roomId: 20,
        userId: 30,
        attemptToken: open.attemptToken,
        idempotencyKey: `expire:${open.attemptToken}`,
        now: 1_015,
      });
    },
  });
  assert.equal(expiredToken, stale.attemptToken);
  assert.notEqual(fresh.attemptToken, stale.attemptToken);
  assert.equal(db.prepare("SELECT status FROM family_expedition_minigame_attempts WHERE attempt_token = ?")
    .pluck().get(stale.attemptToken), 'expired');
});
