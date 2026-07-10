import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const {
  acknowledgeMemberEvents,
  enqueueMemberEvent,
  listPendingMemberEvents,
} = require('./memberEvents.js');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE family_expedition_member_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expedition_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      acknowledged_at INTEGER
    );
  `);
  return db;
}

test('enqueue and list return only sanitized pending events for the requested member', () => {
  const db = createDb();
  const own = enqueueMemberEvent(db, {
    expeditionId: 7,
    userId: 11,
    eventType: 'cleric_heal',
    payload: {
      type: 'cleric_heal',
      userId: 11,
      targetUserId: 11,
      telegramId: 'private-telegram-id',
      heroHp: 3,
      amount: 1,
      placedBy: { userId: 10, firstName: 'Nora', telegramId: 'hidden' },
      privateState: { token: 'hidden' },
    },
    now: 1000,
  });
  enqueueMemberEvent(db, {
    expeditionId: 7,
    userId: 12,
    eventType: 'cleric_heal',
    payload: { heroHp: 2, secret: 'other member payload' },
    now: 1001,
  });

  assert.equal(own.userId, undefined);
  assert.deepEqual(listPendingMemberEvents(db, { expeditionId: 7, userId: 11 }), [{
    id: own.id,
    expeditionId: 7,
    eventType: 'cleric_heal',
    payload: {
      type: 'cleric_heal',
      heroHp: 3,
      amount: 1,
      placedBy: { userId: 10, firstName: 'Nora' },
    },
    createdAt: 1000,
  }]);
  assert.deepEqual(
    listPendingMemberEvents(db, { userId: 11 }).map(event => event.id),
    [own.id],
  );
  db.close();
});

test('acknowledgement is user-scoped and idempotent', () => {
  const db = createDb();
  const own = enqueueMemberEvent(db, {
    expeditionId: 7,
    userId: 11,
    eventType: 'cleric_heal',
    payload: { heroHp: 3 },
    now: 1000,
  });
  const foreign = enqueueMemberEvent(db, {
    expeditionId: 7,
    userId: 12,
    eventType: 'cleric_heal',
    payload: { heroHp: 2 },
    now: 1001,
  });

  assert.deepEqual(acknowledgeMemberEvents(db, {
    userId: 11,
    eventIds: [own.id, foreign.id],
    now: 1100,
  }), { acknowledgedEventIds: [own.id] });
  assert.deepEqual(acknowledgeMemberEvents(db, {
    userId: 11,
    eventIds: [own.id, foreign.id],
    now: 1200,
  }), { acknowledgedEventIds: [own.id] });
  assert.equal(
    db.prepare('SELECT acknowledged_at FROM family_expedition_member_events WHERE id = ?').pluck().get(foreign.id),
    null,
  );
  assert.deepEqual(listPendingMemberEvents(db, { expeditionId: 7, userId: 11 }), []);
  assert.equal(listPendingMemberEvents(db, { expeditionId: 7, userId: 12 }).length, 1);
  db.close();
});

test('acknowledgement rejects malformed event ids before mutating', () => {
  const db = createDb();
  const event = enqueueMemberEvent(db, {
    expeditionId: 7,
    userId: 11,
    eventType: 'cleric_heal',
    payload: { heroHp: 3 },
    now: 1000,
  });

  for (const eventIds of [null, [], [0], [-1], [1.5], ['1'], [event.id, event.id]]) {
    assert.throws(
      () => acknowledgeMemberEvents(db, { userId: 11, eventIds, now: 1100 }),
      /eventIds/i,
    );
  }
  assert.equal(listPendingMemberEvents(db, { expeditionId: 7, userId: 11 }).length, 1);
  db.close();
});
