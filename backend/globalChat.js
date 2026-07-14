'use strict';

const CHAT_MESSAGE_LIMIT = 50;
const CHAT_MESSAGE_MAX_LENGTH = 200;
const CHAT_RATE_LIMIT_SECONDS = 5;
const MUTE_DURATIONS = Object.freeze({
  '1h': 60 * 60,
  '6h': 6 * 60 * 60,
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  forever: null,
});

class GlobalChatError extends Error {
  constructor(message, statusCode = 400, data = {}) {
    super(message);
    this.name = 'GlobalChatError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

function activeMute(db, userId, nowTs) {
  const mute = db.prepare(`
    SELECT user_id, muted_by, muted_until, created_at
    FROM global_chat_mutes
    WHERE user_id = ?
  `).get(userId);
  if (!mute) return null;
  if (mute.muted_until !== null && Number(mute.muted_until) <= nowTs) {
    db.prepare('DELETE FROM global_chat_mutes WHERE user_id = ?').run(userId);
    return null;
  }
  return mute;
}

function assertCanPost(db, userId, nowTs) {
  const mute = activeMute(db, userId, nowTs);
  if (mute) {
    throw new GlobalChatError(
      mute.muted_until === null
        ? 'You are muted in Global Chat permanently'
        : 'You are muted in Global Chat',
      403,
      { mutedUntil: mute.muted_until },
    );
  }

  const latest = db.prepare(`
    SELECT sent_at FROM global_messages
    WHERE user_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(userId);
  const retryAfter = latest
    ? Math.max(0, CHAT_RATE_LIMIT_SECONDS - (nowTs - Number(latest.sent_at)))
    : 0;
  if (retryAfter > 0) {
    throw new GlobalChatError(`Slow mode: wait ${retryAfter}s`, 429, { retryAfter });
  }
}

function normalizeMessage(message) {
  const normalized = typeof message === 'string' ? message.trim() : '';
  if (!normalized) throw new GlobalChatError('Message cannot be empty');
  if (normalized.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new GlobalChatError(`Message too long (max ${CHAT_MESSAGE_MAX_LENGTH} chars)`);
  }
  return normalized;
}

function postGlobalMessage(db, {
  userId,
  message,
  replyToId = null,
  type = 'text',
  familyId = null,
  nowTs = Math.floor(Date.now() / 1000),
}) {
  assertCanPost(db, userId, nowTs);
  const normalizedMessage = normalizeMessage(message);
  const normalizedReplyId = replyToId === null || replyToId === undefined ? null : Number(replyToId);
  if (normalizedReplyId !== null) {
    const replyExists = Number.isInteger(normalizedReplyId)
      && db.prepare('SELECT 1 FROM global_messages WHERE id = ?').get(normalizedReplyId);
    if (!replyExists) throw new GlobalChatError('The replied message is no longer available', 404);
  }

  return db.transaction(() => {
    const inserted = db.prepare(`
      INSERT INTO global_messages (user_id, message, message_type, reply_to_id, family_id, sent_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, normalizedMessage, type, normalizedReplyId, familyId, nowTs);

    db.prepare(`
      DELETE FROM global_messages
      WHERE id NOT IN (SELECT id FROM global_messages ORDER BY id DESC LIMIT ?)
    `).run(CHAT_MESSAGE_LIMIT);

    return { id: Number(inserted.lastInsertRowid), sentAt: nowTs };
  })();
}

function setGlobalMute(db, {
  actorUserId,
  targetUserId,
  duration,
  nowTs = Math.floor(Date.now() / 1000),
}) {
  const targetId = Number(targetUserId);
  if (!Number.isInteger(targetId) || targetId <= 0 || targetId === Number(actorUserId)) {
    throw new GlobalChatError('Choose another user');
  }
  if (duration === 'unmute') {
    db.prepare('DELETE FROM global_chat_mutes WHERE user_id = ?').run(targetId);
    return { mutedUntil: 0, duration: 'unmute' };
  }
  if (!Object.prototype.hasOwnProperty.call(MUTE_DURATIONS, duration)) {
    throw new GlobalChatError('Invalid mute duration');
  }

  const seconds = MUTE_DURATIONS[duration];
  const mutedUntil = seconds === null ? null : nowTs + seconds;
  db.prepare(`
    INSERT INTO global_chat_mutes (user_id, muted_by, muted_until, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      muted_by = excluded.muted_by,
      muted_until = excluded.muted_until,
      created_at = excluded.created_at
  `).run(targetId, actorUserId, mutedUntil, nowTs);
  return { mutedUntil, duration };
}

module.exports = {
  CHAT_MESSAGE_LIMIT,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_RATE_LIMIT_SECONDS,
  MUTE_DURATIONS,
  GlobalChatError,
  activeMute,
  postGlobalMessage,
  setGlobalMute,
};
