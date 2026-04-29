const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const {
  BLACKJACK_STAKE,
  BLACKJACK_MAX_PLAYERS,
  BLACKJACK_BETTING_SECONDS,
  BLACKJACK_TURN_SECONDS,
  listLobbies,
  createLobby,
  joinLobby,
  createLobbyInvite,
  joinLobbyByInvite,
  leaveLobby,
  placeBet,
  applyPlayerAction,
  serializeLobbyState,
} = require('../blackjackEngine');

const APP_URL = 'https://peeper.frenzyradio.online';

function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(req.telegramUser.id));
}

function respondWithState(res, lobbyId, userId) {
  const state = serializeLobbyState(lobbyId, userId);
  if (!state) {
    return res.status(404).json({ error: 'Table not found or you are not seated there.' });
  }
  return res.json(state);
}

async function sendBlackjackInviteNotification(target, inviter, invite) {
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'dev' || !target?.telegram_id) return false;

  const joinUrl = `${APP_URL}/?bjInvite=${encodeURIComponent(invite.token)}`;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: target.telegram_id,
        text: `<b>${inviter.first_name || 'A player'}</b> invited you to a private Blackjack table.`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: 'Join Table',
            web_app: { url: joinUrl },
            style: 'success',
          }]],
        },
      }),
    });
    return resp.ok;
  } catch (error) {
    console.warn('[blackjack] invite notification failed:', error.message);
    return false;
  }
}

router.get('/lobbies', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    ...listLobbies(user.id),
    stake: BLACKJACK_STAKE,
    maxPlayers: BLACKJACK_MAX_PLAYERS,
    countdownSeconds: BLACKJACK_BETTING_SECONDS,
    turnSeconds: BLACKJACK_TURN_SECONDS,
  });
});

router.post('/lobbies', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const visibility = req.body?.visibility === 'closed' ? 'closed' : 'open';

  try {
    const result = createLobby(user.id, visibility);
    return respondWithState(res, result.lobbyId, user.id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not create table.' });
  }
});

router.post('/lobbies/join', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const lobbyId = Number(req.body?.lobbyId || 0);
  if (!lobbyId) return res.status(400).json({ error: 'Missing lobbyId.' });

  try {
    const result = joinLobby(user.id, { lobbyId });
    return respondWithState(res, result.lobbyId, user.id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not join table.' });
  }
});

router.post('/lobbies/join-by-code', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const lobbyId = Number(req.body?.lobbyId || 0) || null;
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Enter the table code.' });

  try {
    const result = joinLobby(user.id, { lobbyId, code });
    return respondWithState(res, result.lobbyId, user.id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not join private table.' });
  }
});

router.post('/invites/join', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing invite token.' });

  try {
    const result = joinLobbyByInvite(user.id, token);
    return respondWithState(res, result.lobbyId, user.id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not join this invite.' });
  }
});

router.post('/lobbies/:id/leave', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const lobbyId = Number(req.params.id || 0);
  if (!lobbyId) return res.status(400).json({ error: 'Invalid table id.' });

  try {
    leaveLobby(user.id, lobbyId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not leave the table.' });
  }
});

router.get('/lobbies/:id/state', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const lobbyId = Number(req.params.id || 0);
  if (!lobbyId) return res.status(400).json({ error: 'Invalid table id.' });

  return respondWithState(res, lobbyId, user.id);
});

router.post('/lobbies/:id/invite', validateTelegramInit, async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const lobbyId = Number(req.params.id || 0);
  const targetUserId = Number(req.body?.targetUserId || 0);
  if (!lobbyId) return res.status(400).json({ error: 'Invalid table id.' });
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId required.' });

  try {
    const inviteResult = createLobbyInvite(user.id, lobbyId, targetUserId);
    if (inviteResult.alreadySeated) {
      return res.json({ ok: true, message: inviteResult.message, alreadySeated: true });
    }

    const notified = await sendBlackjackInviteNotification(inviteResult.target, user, inviteResult.invite);
    return res.json({
      ok: true,
      message: notified
        ? inviteResult.message
        : 'Invite created, but the bot could not notify them.',
      notified,
      created: inviteResult.created,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not send invite.' });
  }
});

router.post('/lobbies/:id/bet', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const lobbyId = Number(req.params.id || 0);
  if (!lobbyId) return res.status(400).json({ error: 'Invalid table id.' });

  try {
    placeBet(user.id, lobbyId);
    return respondWithState(res, lobbyId, user.id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not place bet.' });
  }
});

router.post('/lobbies/:id/action', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const lobbyId = Number(req.params.id || 0);
  const action = String(req.body?.action || '').trim().toLowerCase();
  if (!lobbyId) return res.status(400).json({ error: 'Invalid table id.' });
  if (!['hit', 'stand'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action.' });
  }

  try {
    applyPlayerAction(user.id, lobbyId, action);
    return respondWithState(res, lobbyId, user.id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Could not apply action.' });
  }
});

module.exports = router;
