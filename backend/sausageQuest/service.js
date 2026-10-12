const { randomBytes } = require('node:crypto');
const { generateCollectibles, normalizeLevel } = require('./layout');

const DAILY_LIMIT = 5;
const DAY_SECONDS = 86400;
const ATTEMPT_LIFETIME = 6 * 3600;

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function createSausageQuestService(db, { now = () => Math.floor(Date.now() / 1000) } = {}) {
  function getState(userId, at = now()) {
    const dayKey = Math.floor(at / DAY_SECONDS);
    const row = db.prepare('SELECT * FROM sausage_quest_daily WHERE user_id = ? AND day_key = ?').get(userId, dayKey);
    const completedToday = row?.completed_levels || 0;
    return {
      dayKey,
      dailyLimit: DAILY_LIMIT,
      completedToday,
      remainingToday: DAILY_LIMIT - completedToday,
      earnedToday: row?.earned_coins || 0,
      resetsAt: (dayKey + 1) * DAY_SECONDS,
    };
  }

  const start = db.transaction((userId, { requestId, level }) => {
    const at = now();
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) fail('Invalid request ID');
    const descriptor = normalizeLevel(level);
    db.prepare('DELETE FROM sausage_quest_attempts WHERE started_at < ?').run(at - 2 * DAY_SECONDS);
    const existing = db.prepare('SELECT * FROM sausage_quest_attempts WHERE user_id = ? AND request_id = ?').get(userId, requestId);
    if (existing) {
      if (existing.level_json !== JSON.stringify(descriptor)) fail('Request ID was used for a different level', 409);
      if (at - existing.started_at >= ATTEMPT_LIFETIME) fail('Level attempt expired. Start the level again.', 410);
      return { token: existing.token, totalSausages: existing.total_sausages, sausageQuest: getState(userId, at) };
    }
    const state = getState(userId, at);
    if (!state.remainingToday) return { token: null, sausageQuest: state };
    // Keep unfinished tickets too: a completion may be waiting in a client's
    // offline outbox while its next level is starting. No large payloads are stored.
    const active = db.prepare(`
      SELECT COUNT(*) AS count FROM sausage_quest_attempts
      WHERE user_id = ? AND completed_at IS NULL AND started_at > ?
    `).get(userId, at - ATTEMPT_LIFETIME).count;
    if (active >= 100) fail('Too many unfinished reward attempts. Try again later.', 429);
    const token = randomBytes(24).toString('hex');
    const total = generateCollectibles(descriptor).length;
    db.prepare(`
      INSERT INTO sausage_quest_attempts (token, user_id, request_id, level_json, total_sausages, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(token, userId, requestId, JSON.stringify(descriptor), total, at);
    return { token, totalSausages: total, sausageQuest: state };
  });

  const finish = db.transaction((userId, { token, collected, total }) => {
    const at = now();
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) fail('Invalid level ticket');
    const attempt = db.prepare('SELECT * FROM sausage_quest_attempts WHERE token = ? AND user_id = ?').get(token, userId);
    if (!attempt) fail('Level ticket not found', 404);
    if (!Number.isInteger(collected) || collected < 0 || collected > attempt.total_sausages
      || total !== attempt.total_sausages) fail('Invalid sausage collection result');
    if (attempt.completed_at !== null) {
      if (collected !== attempt.collected) fail('This level was already completed with a different result', 409);
      return { coinsEarned: attempt.reward, replayed: true, sausageQuest: getState(userId, at) };
    }
    if (at - attempt.started_at >= ATTEMPT_LIFETIME) fail('Level attempt expired', 410);
    // The original game has a maximum running speed of 7.2 units/second.
    // Reject instant finishes while allowing acceleration/frame tolerance.
    const descriptor = JSON.parse(attempt.level_json);
    if (at - attempt.started_at < Math.floor((descriptor.length - 3) / 7.2) - 1) fail('Level completed too quickly');
    const state = getState(userId, at);
    const reward = state.remainingToday > 0 ? (collected === attempt.total_sausages ? 10 : 5) : 0;
    if (reward > 0) {
      db.prepare(`
        INSERT INTO sausage_quest_daily (user_id, day_key, completed_levels, earned_coins)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          day_key = excluded.day_key,
          completed_levels = CASE WHEN sausage_quest_daily.day_key = excluded.day_key
            THEN sausage_quest_daily.completed_levels + 1 ELSE 1 END,
          earned_coins = CASE WHEN sausage_quest_daily.day_key = excluded.day_key
            THEN sausage_quest_daily.earned_coins + excluded.earned_coins ELSE excluded.earned_coins END
      `).run(userId, state.dayKey, reward);
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(reward, userId);
    }
    db.prepare('UPDATE sausage_quest_attempts SET completed_at = ?, collected = ?, reward = ? WHERE token = ?')
      .run(at, collected, reward, token);
    return { coinsEarned: reward, replayed: false, sausageQuest: getState(userId, at) };
  });

  return { getState, start, finish };
}

module.exports = { createSausageQuestService, DAILY_LIMIT };
