'use strict';

const express = require('express');
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const { isAdminTelegramId } = require('../adminAccess');
const {
  CHAT_MESSAGE_LIMIT,
  GlobalChatError,
  activeMute,
  postGlobalMessage,
  setGlobalMute,
} = require('../globalChat');

const router = express.Router();

function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(req.telegramUser.id));
}

function handleChatError(res, error) {
  if (error instanceof GlobalChatError) {
    return res.status(error.statusCode).json({ error: error.message, ...error.data });
  }
  console.error('[global-chat]', error);
  return res.status(500).json({ error: 'Global Chat is unavailable' });
}

function messageRows() {
  return db.prepare(`
    SELECT gm.id, gm.message, gm.message_type, gm.sent_at, gm.reply_to_id,
           u.id AS user_id, u.first_name, u.username, u.telegram_id,
           u.photo_url, u.supporter_since, u.supporter_stars,
           reply.message AS reply_message,
           reply_user.id AS reply_user_id,
           reply_user.first_name AS reply_first_name,
           f.id AS family_id, f.name AS family_name, f.invite_code AS family_invite_code,
           (SELECT COUNT(*) FROM family_members fm WHERE fm.family_id = f.id) AS family_member_count,
           mute.user_id AS mute_user_id, mute.muted_until
    FROM global_messages gm
    JOIN users u ON u.id = gm.user_id
    LEFT JOIN global_messages reply ON reply.id = gm.reply_to_id
    LEFT JOIN users reply_user ON reply_user.id = reply.user_id
    LEFT JOIN families f ON f.id = gm.family_id
    LEFT JOIN global_chat_mutes mute ON mute.user_id = gm.user_id
    ORDER BY gm.id DESC
    LIMIT ?
  `).all(CHAT_MESSAGE_LIMIT).reverse();
}

router.get('/messages', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const nowTs = Math.floor(Date.now() / 1000);
  const mute = activeMute(db, user.id, nowTs);
  return res.json({
    messages: messageRows(),
    isAdmin: isAdminTelegramId(user.telegram_id),
    mute: mute ? { mutedUntil: mute.muted_until } : null,
  });
});

router.get('/unread', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const read = db.prepare('SELECT last_read_message_id FROM global_chat_reads WHERE user_id = ?').get(user.id);
  const unreadCount = db.prepare(`
    SELECT COUNT(*) FROM global_messages
    WHERE id > ? AND user_id != ?
  `).pluck().get(Number(read?.last_read_message_id || 0), user.id);
  return res.json({ unreadCount });
});

router.post('/read', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const latestId = Number(db.prepare('SELECT MAX(id) FROM global_messages').pluck().get() || 0);
  db.prepare(`
    INSERT INTO global_chat_reads (user_id, last_read_message_id, read_at)
    VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(user_id) DO UPDATE SET
      last_read_message_id = excluded.last_read_message_id,
      read_at = excluded.read_at
  `).run(user.id, latestId);
  return res.json({ ok: true, lastReadMessageId: latestId });
});

router.post('/message', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  try {
    return res.json({
      ok: true,
      ...postGlobalMessage(db, {
        userId: user.id,
        message: req.body?.message,
        replyToId: req.body?.replyToId,
      }),
    });
  } catch (error) {
    return handleChatError(res, error);
  }
});

router.post('/family-invite', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const family = db.prepare(`
    SELECT f.*, (SELECT COUNT(*) FROM family_members fm2 WHERE fm2.family_id = f.id) AS member_count
    FROM families f
    JOIN family_members fm ON fm.family_id = f.id
    WHERE fm.user_id = ?
  `).get(user.id);
  if (!family) return res.status(400).json({ error: 'You are not in a family' });
  if (Number(family.founder_id) !== Number(user.id)) {
    return res.status(403).json({ error: 'Only the family founder can post an invitation' });
  }
  if (Number(family.member_count) >= 10) return res.status(400).json({ error: 'Family is full' });

  try {
    const result = postGlobalMessage(db, {
      userId: user.id,
      message: `Join ${family.name}`,
      type: 'family_invite',
      familyId: family.id,
    });
    return res.json({ ok: true, message: 'Family invitation posted in Global Chat', ...result });
  } catch (error) {
    return handleChatError(res, error);
  }
});

router.post('/mute', validateTelegramInit, (req, res) => {
  const admin = getUser(req);
  if (!admin) return res.status(404).json({ error: 'User not found' });
  if (!isAdminTelegramId(admin.telegram_id)) return res.status(403).json({ error: 'Admin access only' });

  const target = db.prepare('SELECT id, telegram_id, first_name FROM users WHERE id = ?').get(Number(req.body?.userId));
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (isAdminTelegramId(target.telegram_id)) return res.status(400).json({ error: 'Admins cannot mute other admins' });

  try {
    const result = setGlobalMute(db, {
      actorUserId: admin.id,
      targetUserId: target.id,
      duration: req.body?.duration,
    });
    return res.json({
      ...result,
      message: result.duration === 'unmute' ? `${target.first_name} can speak again` : `${target.first_name} muted`,
    });
  } catch (error) {
    return handleChatError(res, error);
  }
});

module.exports = router;
