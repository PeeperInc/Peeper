import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import chatModule from './globalChat.js';

const {
  CHAT_MESSAGE_LIMIT,
  GlobalChatError,
  activeMute,
  postGlobalMessage,
  setGlobalMute,
} = chatModule;

function fixture() {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE global_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      reply_to_id INTEGER,
      family_id INTEGER,
      sent_at INTEGER NOT NULL
    );
    CREATE TABLE global_chat_mutes (
      user_id INTEGER PRIMARY KEY,
      muted_by INTEGER NOT NULL,
      muted_until INTEGER,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

test('global chat enforces five-second slow mode and validates replies', () => {
  const db = fixture();
  const first = postGlobalMessage(db, { userId: 1, message: 'Hello', nowTs: 100 });

  assert.throws(
    () => postGlobalMessage(db, { userId: 1, message: 'Too fast', nowTs: 104 }),
    error => error instanceof GlobalChatError && error.statusCode === 429 && error.data.retryAfter === 1,
  );
  const reply = postGlobalMessage(db, {
    userId: 2,
    message: 'Reply',
    replyToId: first.id,
    nowTs: 101,
  });
  assert.equal(db.prepare('SELECT reply_to_id FROM global_messages WHERE id = ?').pluck().get(reply.id), first.id);
  assert.throws(
    () => postGlobalMessage(db, { userId: 3, message: 'Missing', replyToId: 999, nowTs: 102 }),
    /no longer available/,
  );
});

test('global chat keeps only the latest fifty messages', () => {
  const db = fixture();
  for (let index = 0; index < CHAT_MESSAGE_LIMIT + 7; index += 1) {
    postGlobalMessage(db, { userId: index + 1, message: `Message ${index}`, nowTs: 100 + index });
  }

  assert.equal(db.prepare('SELECT COUNT(*) FROM global_messages').pluck().get(), CHAT_MESSAGE_LIMIT);
  assert.equal(db.prepare('SELECT MIN(id) FROM global_messages').pluck().get(), 8);
});

test('temporary and permanent global chat mutes block posting and can be removed', () => {
  const db = fixture();
  setGlobalMute(db, { actorUserId: 10, targetUserId: 1, duration: '1h', nowTs: 100 });
  assert.equal(activeMute(db, 1, 200).muted_until, 3700);
  assert.throws(
    () => postGlobalMessage(db, { userId: 1, message: 'Blocked', nowTs: 200 }),
    error => error instanceof GlobalChatError && error.statusCode === 403,
  );
  assert.equal(activeMute(db, 1, 3701), null);

  setGlobalMute(db, { actorUserId: 10, targetUserId: 1, duration: 'forever', nowTs: 4000 });
  assert.equal(activeMute(db, 1, 999999).muted_until, null);
  setGlobalMute(db, { actorUserId: 10, targetUserId: 1, duration: 'unmute', nowTs: 5000 });
  assert.equal(activeMute(db, 1, 5000), null);
});
