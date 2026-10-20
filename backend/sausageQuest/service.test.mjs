import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { ensureSausageQuestSchema } = require('./schema');
const { createSausageQuestService } = require('./service');
const { generateCollectibles } = require('./layout');
const level = { index: 0, seed: 12345, length: 130, hazard: .4 };

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, coins INTEGER NOT NULL);
    INSERT INTO users VALUES (1, 100), (2, 100);
    CREATE TABLE peepers (user_id INTEGER PRIMARY KEY, last_played INTEGER, fun INTEGER);
    INSERT INTO peepers VALUES (1, 123, 100);`);
  ensureSausageQuestSchema(db);
  let clock = 10 * 86400 + 1000;
  const service = createSausageQuestService(db, { now: () => clock });
  return { db, service, advance: n => { clock += n; }, setTime: n => { clock = n; } };
}

test('five completed levels award 25 coins without changing energy', () => {
  const { db, service, advance } = setup();
  const before = db.prepare('SELECT * FROM peepers').get();
  for (let i = 0; i < 5; i++) {
    const started = service.start(1, { requestId: `request-${i}`, level });
    advance(30);
    const result = service.finish(1, { token: started.token, collected: 0, total: started.totalSausages });
    assert.equal(result.coinsEarned, 5);
    assert.equal(result.sausageQuest.completedToday, i + 1);
  }
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 1').get().coins, 125);
  assert.deepEqual(db.prepare('SELECT * FROM peepers').get(), before);
  assert.equal(service.start(1, { requestId: 'practice-start', level }).token, null);
  assert.equal(service.getState(1).remainingToday, 0);
  db.close();
});

test('all sausages awards 10, partial collection awards 5, total is verified from the layout', () => {
  const { db, service, advance } = setup();
  const start = service.start(1, { requestId: 'all-sausages', level });
  assert.equal(start.totalSausages, generateCollectibles(level).length);
  advance(30);
  assert.throws(() => service.finish(1, { token: start.token, collected: 1, total: 1 }), /Invalid sausage/);
  assert.equal(service.finish(1, { token: start.token, collected: start.totalSausages, total: start.totalSausages }).coinsEarned, 10);
  const second = service.start(1, { requestId: 'some-sausages', level });
  advance(30);
  assert.equal(service.finish(1, { token: second.token, collected: second.totalSausages - 1, total: second.totalSausages }).coinsEarned, 5);
  assert.equal(service.getState(1).earnedToday, 15);
  db.close();
});

test('start and finish retries are idempotent and reject changed results or owners', () => {
  const { db, service, advance } = setup();
  const start = service.start(1, { requestId: 'retry-request', level });
  assert.equal(service.start(1, { requestId: 'retry-request', level }).token, start.token);
  assert.throws(() => service.start(1, { requestId: 'retry-request', level: { ...level, seed: 3 } }), /different level/);
  const payload = { token: start.token, collected: 0, total: start.totalSausages };
  assert.throws(() => service.finish(2, payload), /not found/);
  assert.throws(() => service.finish(1, payload), /too quickly/);
  advance(30);
  service.finish(1, payload);
  assert.equal(service.finish(1, payload).replayed, true);
  assert.throws(() => service.finish(1, { ...payload, collected: 1 }), /different result/);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 1').get().coins, 105);
  assert.equal(service.getState(1).completedToday, 1);
  db.close();
});

test('concurrent device tickets cannot exceed five awards or 50 coins', () => {
  const { db, service, advance } = setup();
  const attempts = Array.from({ length: 8 }, (_, i) => service.start(1, { requestId: `device-${i}`, level }));
  advance(30);
  const earned = attempts.map(start => service.finish(1, { token: start.token, collected: start.totalSausages, total: start.totalSausages }).coinsEarned);
  assert.deepEqual(earned, [10, 10, 10, 10, 10, 0, 0, 0]);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 1').get().coins, 150);
  assert.equal(service.getState(1).earnedToday, 50);
  db.close();
});

test('UTC rollover refreshes rewards; a level started before midnight counts on completion day', () => {
  const { db, service, advance, setTime } = setup();
  const start = service.start(1, { requestId: 'old-day-award', level });
  advance(30);
  service.finish(1, { token: start.token, collected: 0, total: start.totalSausages });
  setTime(11 * 86400 - 20);
  const crossing = service.start(1, { requestId: 'midnight-level', level });
  advance(30);
  assert.equal(service.getState(1).completedToday, 0);
  service.finish(1, { token: crossing.token, collected: 0, total: crossing.totalSausages });
  assert.equal(service.getState(1).completedToday, 1);
  service.finish(1, { token: start.token, collected: 0, total: start.totalSausages });
  assert.equal(service.getState(1).completedToday, 1);
  assert.equal(service.getState(1).resetsAt, 12 * 86400);
  db.close();
});

test('unfinished earlier ticket remains usable after starting another level', () => {
  const { db, service, advance } = setup();
  const first = service.start(1, { requestId: 'offline-finish', level });
  advance(30);
  service.start(1, { requestId: 'next-level-start', level });
  assert.equal(service.finish(1, { token: first.token, collected: 0, total: first.totalSausages }).coinsEarned, 5);
  db.close();
});

test('expired attempts and malformed counts cannot pay rewards', () => {
  const { db, service, advance } = setup();
  const start = service.start(1, { requestId: 'invalid-values', level });
  advance(30);
  for (const collected of [-1, 1.5, '1', NaN, start.totalSausages + 1]) {
    assert.throws(() => service.finish(1, { token: start.token, collected, total: start.totalSausages }), /Invalid sausage/);
  }
  advance(21600);
  assert.throws(() => service.finish(1, { token: start.token, collected: 0, total: start.totalSausages }), /expired/);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 1').get().coins, 100);
  db.close();
});

test('cleanup removes only old small tickets and preserves balances and daily state', () => {
  const { db, service, advance } = setup();
  const first = service.start(1, { requestId: 'cleanup-old-ticket', level });
  advance(30);
  service.finish(1, { token: first.token, collected: 0, total: first.totalSausages });
  advance(2 * 86400);
  service.start(1, { requestId: 'cleanup-new-ticket', level });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sausage_quest_attempts').get().count, 1);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 1').get().coins, 105);
  db.close();
});
