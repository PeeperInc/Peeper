const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const { getHomeSummary } = require('../homeState');

/**
 * GET /api/users/search?q=username
 * Search users by @ or name (for profile viewing, not gifting).
 */
router.get('/search', validateTelegramInit, (req, res) => {
  const query = (req.query.q || '').trim().replace(/^@/, '');
  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Query too short' });
  }

  const users = db.prepare(`
    SELECT u.id, u.telegram_id, u.username, u.first_name, u.photo_url,
           p.alive, p.born_at,
           (SELECT COUNT(*) FROM gifts_received WHERE recipient_id = u.id) AS gift_count
    FROM users u
    LEFT JOIN peepers p ON p.user_id = u.id
    WHERE u.username LIKE ? OR u.first_name LIKE ?
    LIMIT 10
  `).all(`%${query}%`, `%${query}%`);

  res.json({ users });
});

/**
 * GET /api/users/:userId/profile
 * Public profile of a user — peeper info + top gifts + stats.
 */
router.get('/:userId/profile', validateTelegramInit, (req, res) => {
  const userId = parseInt(req.params.userId, 10);

  const user = db.prepare('SELECT id, telegram_id, username, first_name, photo_url FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const peeper = db.prepare('SELECT * FROM peepers WHERE user_id = ?').get(userId);

  const topGifts = db.prepare(`
    SELECT gr.gift_id, gr.gift_price, gr.sent_at,
           u.username AS sender_username, u.first_name AS sender_name
    FROM gifts_received gr
    LEFT JOIN users u ON gr.sender_id = u.id
    WHERE gr.recipient_id = ?
    ORDER BY gr.gift_price DESC, gr.sent_at DESC
    LIMIT 10
  `).all(userId);

  const totalGifts = db.prepare(
    'SELECT COUNT(*) AS count FROM gifts_received WHERE recipient_id = ?'
  ).get(userId).count;

  const ageDays = peeper
    ? Math.floor((Date.now() / 1000 - peeper.born_at) / 86400)
    : 0;

  // Get user's family if any
  const familyRow = db.prepare(`
    SELECT f.id, f.name FROM families f
    JOIN family_members fm ON fm.family_id = f.id
    WHERE fm.user_id = ?
  `).get(userId);

  res.json({
    user,
    peeper,
    topGifts,
    totalGifts,
    ageDays,
    family: familyRow || null,
    homeSummary: getHomeSummary(userId),
  });
});

/**
 * GET /api/users/leaderboard/longevity
 * Top 50 players with longest living (or lived) Peepers.
 */
router.get('/leaderboard/longevity', validateTelegramInit, (req, res) => {
  // Only show alive peepers. The notifier marks dead ones every 60s,
  // but as extra safety we also compute liveStats here.
  const { liveStats } = require('../gameLogic');
  const raw = db.prepare(`
    SELECT u.id, u.telegram_id, u.username, u.first_name, u.photo_url,
           p.alive, p.born_at, p.hp, p.last_fed, p.last_played,
           CAST((strftime('%s','now') - p.born_at) AS INTEGER) AS age_seconds
    FROM users u
    INNER JOIN peepers p ON p.user_id = u.id
    WHERE p.alive = 1
    ORDER BY age_seconds DESC
    LIMIT 100
  `).all();
  // Double-check with liveStats to catch peepers that died but user never logged in
  const rows = raw.filter(r => liveStats(r).alive).slice(0, 50);
  res.json({ leaderboard: rows });
});

router.get('/leaderboard/gifts', validateTelegramInit, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.telegram_id, u.username, u.first_name, u.photo_url,
           COUNT(gr.id) AS gift_count
    FROM users u
    LEFT JOIN gifts_received gr ON gr.recipient_id = u.id
    GROUP BY u.id
    ORDER BY gift_count DESC
    LIMIT 50
  `).all();
  res.json({ leaderboard: rows });
});

module.exports = router;
