import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const {
  IDEMPOTENCY_CLEANUP_INTERVAL_MS,
  pruneExpeditionMinigameIdempotency,
  startExpeditionIdempotencyRetention,
} = require('./idempotencyRetention');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE family_expedition_minigame_idempotency (
      user_id INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, idempotency_key)
    );
  `);
  return db;
}

function insertRow(db, key, updatedAt) {
  db.prepare(`
    INSERT INTO family_expedition_minigame_idempotency (user_id, idempotency_key, updated_at)
    VALUES (1, ?, ?)
  `).run(key, updatedAt);
}

test('prunes only idempotency records older than 24 hours', () => {
  const db = createDatabase();
  const nowSeconds = 200_000;
  const cutoff = nowSeconds - (24 * 60 * 60);

  insertRow(db, 'expired', cutoff - 1);
  insertRow(db, 'boundary', cutoff);
  insertRow(db, 'recent', cutoff + 1);

  const result = pruneExpeditionMinigameIdempotency(db, { nowSeconds });
  const remaining = db.prepare(`
    SELECT idempotency_key FROM family_expedition_minigame_idempotency ORDER BY idempotency_key
  `).all().map(row => row.idempotency_key);

  assert.deepEqual(result, { deletedRows: 1, cutoff });
  assert.deepEqual(remaining, ['boundary', 'recent']);
  db.close();
});

test('runs cleanup at startup and schedules it every 24 hours', () => {
  const db = createDatabase();
  let nowSeconds = 200_000;
  let scheduledCallback;
  let scheduledDelay;
  let unrefCalled = false;

  insertRow(db, 'expired-at-startup', nowSeconds - (24 * 60 * 60) - 1);
  insertRow(db, 'recent', nowSeconds);

  const setIntervalFn = (callback, delay) => {
    scheduledCallback = callback;
    scheduledDelay = delay;
    return { unref: () => { unrefCalled = true; } };
  };
  const logger = { info() {}, error() {} };

  startExpeditionIdempotencyRetention(db, {
    now: () => nowSeconds,
    logger,
    setIntervalFn,
  });

  assert.equal(scheduledDelay, IDEMPOTENCY_CLEANUP_INTERVAL_MS);
  assert.equal(unrefCalled, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM family_expedition_minigame_idempotency').get().count, 1);

  nowSeconds += 24 * 60 * 60 + 1;
  scheduledCallback();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM family_expedition_minigame_idempotency').get().count, 0);
  db.close();
});
