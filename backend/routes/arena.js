const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const {
  ARENA_STAKE,
  ARENA_CHOICE_SECONDS,
  ARENA_COUNTDOWN_SECONDS,
  joinQueue,
  leaveQueue,
  getQueueStatus,
  getPublicQueueStatus,
  getCurrentArenaState,
  getArenaLeaderboard,
  createPrivateRoom,
  joinPrivateRoomByCode,
  createMatchInvite,
  joinMatchByInvite,
  submitChoice,
  forfeitMatch,
  serializeMatchState,
} = require('../arenaEngine');

const APP_URL = 'https://peeper.frenzyradio.online';

function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(req.telegramUser.id));
}

function respondWithState(res, matchId, userId) {
  const state = serializeMatchState(matchId, userId);
  if (!state) {
    return res.status(404).json({ error: 'Arena match not found or you are not in it.' });
  }
  return res.json(state);
}

async function sendArenaInviteNotification(target, inviter, invite) {
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'dev' || !target?.telegram_id) return false;

  const joinUrl = `${APP_URL}/?arenaInvite=${encodeURIComponent(invite.token)}`;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target.telegram_id,
        text: `<b>${inviter.first_name || 'A player'}</b> invited you to an Arena fight.`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: 'Join Arena',
            web_app: { url: joinUrl },
            style: 'success',
          }]],
        },
      }),
    });
    return resp.ok;
  } catch (error) {
    console.warn('[arena] invite notification failed:', error.message);
    return false;
  }
}

router.post('/queue', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const result = joinQueue(user.id);
    if (result.matched) return respondWithState(res, result.matchId, user.id);
    return res.json({
      queued: true,
      stake: ARENA_STAKE,
      choiceSeconds: ARENA_CHOICE_SECONDS,
      countdownSeconds: ARENA_COUNTDOWN_SECONDS,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not join Arena queue.' });
  }
});

router.delete('/queue', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  leaveQueue(user.id);
  return res.json({ ok: true });
});

router.get('/queue/status', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  return res.json(getQueueStatus(user.id));
});

router.get('/queue/public-status', validateTelegramInit, (_req, res) => {
  return res.json(getPublicQueueStatus());
});

router.get('/current', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  return res.json(getCurrentArenaState(user.id));
});

router.get('/leaderboard', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  return res.json(getArenaLeaderboard(user.id, 10));
});

router.post('/create', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const result = createPrivateRoom(user.id);
    return respondWithState(res, result.matchId, user.id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not create Arena room.' });
  }
});

router.post('/join', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Enter the Arena code.' });

  try {
    const result = joinPrivateRoomByCode(user.id, code);
    return respondWithState(res, result.matchId, user.id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not join Arena room.' });
  }
});

router.post('/invites/join', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing invite token.' });

  try {
    const result = joinMatchByInvite(user.id, token);
    return respondWithState(res, result.matchId, user.id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not join this Arena invite.' });
  }
});

router.get('/state/:matchId', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const matchId = Number(req.params.matchId || 0);
  if (!matchId) return res.status(400).json({ error: 'Invalid Arena match id.' });

  return respondWithState(res, matchId, user.id);
});

router.post('/choose/:matchId', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const matchId = Number(req.params.matchId || 0);
  if (!matchId) return res.status(400).json({ error: 'Invalid Arena match id.' });

  try {
    submitChoice(user.id, matchId, req.body?.attack, req.body?.defense);
    return respondWithState(res, matchId, user.id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not submit Arena choice.' });
  }
});

router.post('/forfeit/:matchId', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const matchId = Number(req.params.matchId || 0);
  if (!matchId) return res.status(400).json({ error: 'Invalid Arena match id.' });

  try {
    forfeitMatch(user.id, matchId);
    return respondWithState(res, matchId, user.id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not surrender Arena match.' });
  }
});

router.post('/matches/:matchId/invite', validateTelegramInit, async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const matchId = Number(req.params.matchId || 0);
  const targetUserId = Number(req.body?.targetUserId || 0);
  if (!matchId) return res.status(400).json({ error: 'Invalid Arena match id.' });
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId required.' });

  try {
    const inviteResult = createMatchInvite(user.id, matchId, targetUserId);
    const notified = await sendArenaInviteNotification(inviteResult.target, user, inviteResult.invite);
    return res.json({
      ok: true,
      message: notified
        ? inviteResult.message
        : 'Invite created, but the bot could not notify them.',
      notified,
      created: inviteResult.created,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not send Arena invite.' });
  }
});

module.exports = router;
