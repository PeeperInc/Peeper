/**
 * FAMILY ROUTES
 * POST /api/family/create       { name }
 * POST /api/family/join         { inviteCode }
 * POST /api/family/leave
 * POST /api/family/kick         { userId }
 * GET  /api/family/me           → family + members + peeper statuses
 * POST /api/family/feed         { targetUserId }
 * GET  /api/family/messages     → last 50 messages
 * POST /api/family/message      { message }
 */
const express  = require('express');
const router   = express.Router();
const db       = require('../database');
const { validateTelegramInit } = require('../auth');
const { liveStats, FOOD_TYPES, HUNGER_DRAIN } = require('../gameLogic');
const { syncPeeperRow } = require('../peeperState');
const { isNotificationEnabled } = require('../notificationSettings');
const { serializeFamilyMemberStats } = require('../familyMemberStats');
const { regenerateAp } = require('../expeditions/engine');
const { MAX_AP } = require('../expeditions/catalog');

const BIG_FEAST_COST = 100;
const BIG_FEAST_COOLDOWN = 7 * 24 * 3600;
const APP_URL = 'https://peeper.frenzyradio.online';

function ts() { return Math.floor(Date.now() / 1000); }
function getUser(req) { return db.prepare('SELECT * FROM users WHERE telegram_id=?').get(String(req.telegramUser.id)); }
function getPeeper(userId) { return db.prepare('SELECT * FROM peepers WHERE user_id=?').get(userId); }

function randomCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getUserFamily(userId) {
  return db.prepare(`
    SELECT f.* FROM families f
    JOIN family_members fm ON fm.family_id = f.id
    WHERE fm.user_id = ?
  `).get(userId);
}

function getFamilyChatUnreadCount(userId, familyId) {
  const readState = db.prepare(`
    SELECT last_read_message_id
    FROM family_chat_reads
    WHERE user_id = ? AND family_id = ?
  `).get(userId, familyId);

  return db.prepare(`
    SELECT COUNT(*) AS unreadCount
    FROM family_messages
    WHERE family_id = ?
      AND user_id != ?
      AND id > ?
  `).get(familyId, userId, readState?.last_read_message_id || 0).unreadCount;
}

function markFamilyChatRead(userId, familyId, nowTs = ts()) {
  const latestForeignMessage = db.prepare(`
    SELECT id
    FROM family_messages
    WHERE family_id = ? AND user_id != ?
    ORDER BY id DESC
    LIMIT 1
  `).get(familyId, userId);

  const lastReadMessageId = latestForeignMessage?.id || null;

  db.prepare(`
    INSERT INTO family_chat_reads (user_id, family_id, last_read_message_id, read_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, family_id) DO UPDATE SET
      last_read_message_id = excluded.last_read_message_id,
      read_at = excluded.read_at
  `).run(userId, familyId, lastReadMessageId, nowTs);

  return {
    lastReadMessageId,
    unreadCount: 0,
  };
}

async function sendTelegramFamilyMessage(userId, telegramId, text) {
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'dev' || !telegramId) return;
  if (!isNotificationEnabled(userId, 'family_notifications')) return;

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text: '🐸 Open Peeper',
            web_app: { url: APP_URL },
            style: 'success',
          }]],
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (err.error_code !== 403) {
        console.warn('[family] notification failed:', err.description || resp.status);
      }
    }
  } catch (error) {
    console.warn('[family] notification error:', error.message);
  }
}

function getBigFeastStatus(userId, nowTs = ts()) {
  const lastUse = db.prepare(`
    SELECT used_at
    FROM family_big_feasts
    WHERE feaster_id = ?
    ORDER BY used_at DESC
    LIMIT 1
  `).get(userId);

  const availableAt = lastUse ? lastUse.used_at + BIG_FEAST_COOLDOWN : nowTs;
  const cooldownSeconds = Math.max(0, availableAt - nowTs);

  return {
    cost: BIG_FEAST_COST,
    cooldown_seconds: cooldownSeconds,
    available_at: cooldownSeconds > 0 ? availableAt : nowTs,
    last_used_at: lastUse?.used_at || null,
    available: cooldownSeconds <= 0,
  };
}

function getFamilyExpeditionSummary(familyId, userId, nowTs = ts()) {
  const expedition = db.prepare(`
    SELECT id, status
    FROM family_expeditions
    WHERE family_id = ?
      AND status IN ('active', 'boss_defeated')
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).get(familyId);

  if (!expedition) {
    return {
      active: false,
      joined: false,
      canStart: true,
      canJoin: false,
      needsEntry: true,
      apFull: false,
      bossReady: false,
      rewardWaiting: false,
      status: null,
    };
  }

  const member = db.prepare(`
    SELECT ap, ap_regen_day, ap_regen_at
    FROM family_expedition_members
    WHERE expedition_id = ? AND user_id = ?
  `).get(expedition.id, userId);
  const regenerated = member ? regenerateAp({
    ap: member.ap,
    apRegenDay: member.ap_regen_day,
    apRegenAt: member.ap_regen_at,
  }, nowTs) : null;
  return {
    active: true,
    joined: Boolean(member),
    canStart: false,
    canJoin: expedition.status === 'active' && !member,
    needsEntry: expedition.status === 'active' && !member,
    apFull: Boolean(regenerated && regenerated.ap >= MAX_AP),
    bossReady: false,
    rewardWaiting: false,
    status: expedition.status,
  };
}

function applyFullFeed(userId, nowTs = ts()) {
  let peeper = syncPeeperRow(userId, nowTs);
  if (!peeper || !peeper.alive) return false;

  const live = liveStats(peeper, nowTs);
  if (!live.alive) return false;

  db.prepare(`
    UPDATE peepers
    SET hp = ?, last_fed = ?
    WHERE user_id = ?
  `).run(live.hp, nowTs - Math.round(HUNGER_DRAIN * (1 - 1)), userId);

  return true;
}

function applyDeathIfNeeded(userId) {
  const p = getPeeper(userId);
  if (!p || !p.alive) return;
  const live = liveStats(p);
  if (!live.alive) {
    const secondsSinceFed = ts() - p.last_fed;
    if (secondsSinceFed >= 28800) {
      // Apply death
      const dp = db.prepare('SELECT slot_head,slot_body,slot_hands,slot_fren,slot_face FROM peepers WHERE user_id=?').get(userId);
      const equipped = dp ? ['slot_head','slot_body','slot_hands','slot_fren','slot_face'].flatMap(k => {
        const v = dp[k]; if (!v) return [];
        if (v.startsWith('[')) { try { return JSON.parse(v); } catch { return []; } }
        return [v];
      }) : [];
      db.transaction(() => {
        db.prepare('UPDATE peepers SET alive=0,hp=0,slot_head=NULL,slot_body=NULL,slot_hands=NULL,slot_fren=NULL,slot_face=NULL WHERE user_id=?').run(userId);
        for (const id of equipped) db.prepare('DELETE FROM owned_items WHERE user_id=? AND item_id=?').run(userId, id);
        const fresh = db.prepare('SELECT coins FROM users WHERE id=?').get(userId);
        const penalty = Math.floor((fresh?.coins || 0) / 2);
        if (penalty > 0) db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(penalty, userId);
      })();
    }
  }
}

// ── POST /api/family/create ────────────────────────────────────────────────────
router.post('/create', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const existing = getUserFamily(user.id);
  if (existing) return res.status(400).json({ error: 'You are already in a family' });

  const { name } = req.body;
  if (!name || name.trim().length < 2 || name.trim().length > 24)
    return res.status(400).json({ error: 'Family name must be 2–24 characters' });

  let code, tries = 0;
  do { code = randomCode(); tries++; } while (
    db.prepare('SELECT 1 FROM families WHERE invite_code=?').get(code) && tries < 10
  );

  if (user.coins < 500)
    return res.status(400).json({ error: 'Not enough coins! Creating a family costs 500 ✦' });

  db.transaction(() => {
    const fam = db.prepare('INSERT INTO families (name, founder_id, invite_code) VALUES (?,?,?)').run(name.trim(), user.id, code);
    db.prepare('INSERT INTO family_members (family_id, user_id) VALUES (?,?)').run(fam.lastInsertRowid, user.id);
    db.prepare('UPDATE users SET coins = coins - 500 WHERE id=?').run(user.id);
  })();

  const family = getUserFamily(user.id);
  res.json({ family, message: `Family "${name.trim()}" created!` });
});

// ── POST /api/family/join ─────────────────────────────────────────────────────
router.post('/join', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const existing = getUserFamily(user.id);
  if (existing) return res.status(400).json({ error: 'You are already in a family. Leave first.' });

  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'Invite code required' });

  const family = db.prepare('SELECT * FROM families WHERE invite_code=?').get(inviteCode.trim().toUpperCase());
  if (!family) return res.status(404).json({ error: 'Family not found — check the invite code' });

  const memberCount = db.prepare('SELECT COUNT(*) as c FROM family_members WHERE family_id=?').get(family.id).c;
  if (memberCount >= 10) return res.status(400).json({ error: 'Family is full (max 10 members)' });

  db.prepare('INSERT INTO family_members (family_id, user_id) VALUES (?,?)').run(family.id, user.id);
  res.json({ family, message: `Joined "${family.name}"!` });
});

// ── POST /api/family/leave ────────────────────────────────────────────────────
router.post('/leave', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const family = getUserFamily(user.id);
  if (!family) return res.status(400).json({ error: 'You are not in a family' });

  db.transaction(() => {
    db.prepare('DELETE FROM family_members WHERE family_id=? AND user_id=?').run(family.id, user.id);
    const remaining = db.prepare('SELECT COUNT(*) as c FROM family_members WHERE family_id=?').get(family.id).c;
    if (remaining === 0) {
      db.prepare('DELETE FROM family_messages WHERE family_id=?').run(family.id);
      db.prepare('DELETE FROM families WHERE id=?').run(family.id);
    } else if (family.founder_id === user.id) {
      // Transfer leadership to oldest member
      const next = db.prepare('SELECT user_id FROM family_members WHERE family_id=? ORDER BY joined_at ASC LIMIT 1').get(family.id);
      if (next) db.prepare('UPDATE families SET founder_id=? WHERE id=?').run(next.user_id, family.id);
    }
  })();

  res.json({ message: `Left "${family.name}"` });
});

// ── POST /api/family/kick ─────────────────────────────────────────────────────
router.post('/kick', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const family = getUserFamily(user.id);
  if (!family) return res.status(400).json({ error: 'You are not in a family' });
  if (family.founder_id !== user.id) return res.status(403).json({ error: 'Only the family founder can kick members' });

  const { userId } = req.body;
  if (!userId || userId === user.id) return res.status(400).json({ error: 'Invalid target' });

  const isMember = db.prepare('SELECT 1 FROM family_members WHERE family_id=? AND user_id=?').get(family.id, userId);
  if (!isMember) return res.status(404).json({ error: 'User is not in your family' });

  db.prepare('DELETE FROM family_members WHERE family_id=? AND user_id=?').run(family.id, userId);
  res.json({ message: 'Member removed' });
});

// ── GET /api/family/me ────────────────────────────────────────────────────────
router.get('/me', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const family = getUserFamily(user.id);
  if (!family) return res.json({ family: null });

  const members = db.prepare(`
    SELECT u.id, u.telegram_id, u.first_name, u.username,
           u.supporter_since, u.supporter_stars,
           fm.joined_at,
           p.alive, p.hp, p.hunger, p.last_fed, p.last_played,
           p.fridge_owned, p.fridge_food_until, p.fridge_purchased_at,
           COALESCE(gs.coins_spent, 0) AS coins_spent,
           COALESCE(gs.gift_count, 0)  AS gifts_sent
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    LEFT JOIN peepers p ON p.user_id = u.id
    LEFT JOIN (
      SELECT sender_id, COUNT(*) AS gift_count, COALESCE(SUM(gift_price),0) AS coins_spent
      FROM gifts_received GROUP BY sender_id
    ) gs ON gs.sender_id = u.id
    WHERE fm.family_id = ?
    ORDER BY COALESCE(gs.coins_spent, 0) DESC, fm.joined_at ASC
  `).all(family.id);

  // Compute live stats for each member
  const now = ts();
  const membersWithStats = members.map(m => serializeFamilyMemberStats(m, now));

  // Check if current user already fed someone today (UTC day)
  const todayStart = Math.floor(new Date().setUTCHours(0,0,0,0) / 1000);
  const fedToday = db.prepare('SELECT fed_id FROM family_feeds WHERE feeder_id=? AND fed_at>=?').get(user.id, todayStart);

  res.json({
    family,
    members: membersWithStats,
    fedTodayUserId: fedToday?.fed_id || null,
    bigFeast: getBigFeastStatus(user.id, now),
    unreadCount: getFamilyChatUnreadCount(user.id, family.id),
    expeditionSummary: getFamilyExpeditionSummary(family.id, user.id, now),
  });
});

// ── POST /api/family/feed ─────────────────────────────────────────────────────
router.post('/feed', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const family = getUserFamily(user.id);
  if (!family) return res.status(400).json({ error: 'You are not in a family' });

  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
  if (targetUserId === user.id) return res.status(400).json({ error: 'Cannot feed yourself' });

  // Check target is in same family
  const isMember = db.prepare('SELECT 1 FROM family_members WHERE family_id=? AND user_id=?').get(family.id, targetUserId);
  if (!isMember) return res.status(403).json({ error: 'Target is not in your family' });

  // Check cooldown — once per UTC day
  const todayStart = Math.floor(new Date().setUTCHours(0,0,0,0) / 1000);
  const alreadyFed = db.prepare('SELECT 1 FROM family_feeds WHERE feeder_id=? AND fed_at>=?').get(user.id, todayStart);
  if (alreadyFed) return res.status(400).json({ error: 'You already fed a family member today. Come back tomorrow!' });

  // Apply death if needed before feeding
  applyDeathIfNeeded(targetUserId);

  const peeper = getPeeper(targetUserId);
  if (!peeper) return res.status(404).json({ error: 'Target peeper not found' });
  if (!peeper.alive) return res.status(400).json({ error: "This Peeper has passed away 😢 — they can't be fed" });

  const live = liveStats(peeper);
  if (!live.alive) {
    applyDeathIfNeeded(targetUserId);
    return res.status(400).json({ error: "This Peeper just died 😢" });
  }
  if (live.hunger > 70) return res.status(400).json({ error: `${peeper.name || 'Peeper'} is not hungry yet! (${Math.round(live.hunger)}%)` });

  // Feed: Tendies = 60% hunger
  const TENDIES_HUNGER = 60;
  const nowTs = ts();
  const HUNGER_DRAIN = 8 * 3600;
  const FUN_DRAIN = 100 * 60;
  const newHunger = Math.min(100, live.hunger + TENDIES_HUNGER);
  const newLastFed = nowTs - Math.round(HUNGER_DRAIN * (1 - newHunger / 100));

  db.transaction(() => {
    db.prepare('UPDATE peepers SET hp=?, last_fed=? WHERE user_id=?').run(live.hp, newLastFed, targetUserId);
    db.prepare('INSERT INTO family_feeds (feeder_id, fed_id) VALUES (?,?)').run(user.id, targetUserId);
  })();

  // Get target user name for message
  const targetUser = db.prepare('SELECT first_name, telegram_id FROM users WHERE id=?').get(targetUserId);
  void sendTelegramFamilyMessage(
    targetUserId,
    targetUser?.telegram_id,
    [
      `🍗 <b>${escapeHtml(user.first_name || 'A family member')}</b> fed your Peeper with Tendies!`,
      '',
      `Your hunger was restored by <b>60%</b> in <b>${escapeHtml(family.name)}</b>.`,
    ].join('\n')
  );
  res.json({ message: `🍗 You fed ${targetUser?.first_name || 'a family member'} Tendies! (+60% hunger)` });
});

// ——— POST /api/family/big-feast ——————————————————————————————————————————————
router.post('/big-feast', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const family = getUserFamily(user.id);
  if (!family) return res.status(400).json({ error: 'You are not in a family' });

  const nowTs = ts();
  const feastStatus = getBigFeastStatus(user.id, nowTs);
  if (!feastStatus.available) {
    return res.status(400).json({
      error: 'Big Feast is still on cooldown',
      bigFeast: feastStatus,
    });
  }

  if ((user.coins || 0) < BIG_FEAST_COST) {
    return res.status(400).json({
      error: `Not enough coins! Big Feast costs ${BIG_FEAST_COST} ✦`,
      bigFeast: feastStatus,
    });
  }

  const memberRows = db.prepare(`
    SELECT u.id AS user_id, u.telegram_id, u.first_name
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    WHERE fm.family_id = ?
  `).all(family.id);

  let fedCount = 0;
  const fedMemberIds = [];
  try {
    db.transaction(() => {
      for (const member of memberRows) {
        if (applyFullFeed(member.user_id, nowTs)) {
          fedCount += 1;
          fedMemberIds.push(member.user_id);
        }
      }

      if (fedCount <= 0) {
        throw new Error('No living family members need a Big Feast right now');
      }

      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(BIG_FEAST_COST, user.id);
      db.prepare(`
        INSERT INTO family_big_feasts (family_id, feaster_id, cost, used_at)
        VALUES (?, ?, ?, ?)
      `).run(family.id, user.id, BIG_FEAST_COST, nowTs);
    })();
  } catch (error) {
    return res.status(400).json({
      error: error.message || 'Big Feast could not be served',
      bigFeast: getBigFeastStatus(user.id, nowTs),
    });
  }

  const feastMessage = [
    '🍽️✨ <b>BIG FEAST!</b> ✨🍽️',
    '',
    `<b>${escapeHtml(user.first_name || 'A family member')}</b> just served a feast for the whole <b>${escapeHtml(family.name)}</b> family.`,
    '',
    'Your Peeper is now fed to <b>100%</b> hunger.',
  ].join('\n');
  for (const member of memberRows) {
    if (!fedMemberIds.includes(member.user_id) || member.user_id === user.id) continue;
    void sendTelegramFamilyMessage(member.user_id, member.telegram_id, feastMessage);
  }

  const freshUser = db.prepare('SELECT coins FROM users WHERE id=?').get(user.id);
  res.json({
    message: `🍽️ Big Feast served! ${fedCount} family member${fedCount === 1 ? '' : 's'} fed to 100%.`,
    coins: freshUser?.coins ?? user.coins,
    bigFeast: getBigFeastStatus(user.id, nowTs),
  });
});

// ── GET /api/family/messages ──────────────────────────────────────────────────
router.get('/messages', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const family = getUserFamily(user.id);
  if (!family) return res.status(400).json({ error: 'You are not in a family' });

  const messages = db.prepare(`
    SELECT fm.id, fm.message, fm.sent_at,
           u.id as user_id, u.first_name, u.username, u.telegram_id,
           u.supporter_since, u.supporter_stars
    FROM family_messages fm
    JOIN users u ON u.id = fm.user_id
    WHERE fm.family_id = ?
    ORDER BY fm.sent_at DESC
    LIMIT 50
  `).all(family.id).reverse(); // oldest first

  res.json({ messages });
});

router.post('/messages/read', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const family = getUserFamily(user.id);
  if (!family) return res.status(400).json({ error: 'You are not in a family' });

  const readState = markFamilyChatRead(user.id, family.id);
  res.json({ ok: true, ...readState });
});

// ── POST /api/family/message ──────────────────────────────────────────────────
router.post('/message', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const family = getUserFamily(user.id);
  if (!family) return res.status(400).json({ error: 'You are not in a family' });

  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message cannot be empty' });
  if (message.trim().length > 200) return res.status(400).json({ error: 'Message too long (max 200 chars)' });

  db.prepare('INSERT INTO family_messages (family_id, user_id, message) VALUES (?,?,?)').run(family.id, user.id, message.trim());

  // Keep only last 200 messages per family
  db.prepare(`
    DELETE FROM family_messages WHERE family_id=? AND id NOT IN (
      SELECT id FROM family_messages WHERE family_id=? ORDER BY sent_at DESC LIMIT 200
    )
  `).run(family.id, family.id);

  res.json({ ok: true });
});

router.get('/unread', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const family = getUserFamily(user.id);
  if (!family) {
    return res.json({ hasFamily: false, unreadCount: 0 });
  }

  res.json({
    hasFamily: true,
    unreadCount: getFamilyChatUnreadCount(user.id, family.id),
  });
});

// ── POST /api/family/invite ───────────────────────────────────────────────────
router.post('/invite', validateTelegramInit, async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const family = getUserFamily(user.id);
  if (!family) return res.status(400).json({ error: 'You are not in a family' });
  if (family.founder_id !== user.id) return res.status(403).json({ error: 'Only the founder can invite members' });

  const memberCount = db.prepare('SELECT COUNT(*) as c FROM family_members WHERE family_id=?').get(family.id).c;
  if (memberCount >= 10) return res.status(400).json({ error: 'Family is full (10/10)' });

  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
  if (targetUserId === user.id) return res.status(400).json({ error: 'Cannot invite yourself' });

  // Check target exists
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(targetUserId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Check target not already in a family
  const targetFamily = db.prepare('SELECT 1 FROM family_members fm JOIN families f ON f.id=fm.family_id WHERE fm.user_id=?').get(targetUserId);
  if (targetFamily) return res.status(400).json({ error: `${target.first_name} is already in a family` });

  // Check no pending invite already exists
  const existing = db.prepare("SELECT 1 FROM family_invites WHERE family_id=? AND invitee_id=? AND status='pending'").get(family.id, targetUserId);
  if (existing) return res.status(400).json({ error: `${target.first_name} already has a pending invite` });

  // Create invite
  const invite = db.prepare('INSERT INTO family_invites (family_id, inviter_id, invitee_id) VALUES (?,?,?)').run(family.id, user.id, targetUserId);
  const inviteId = invite.lastInsertRowid;

  // Send Telegram notification
  const token = process.env.BOT_TOKEN;
  if (token && token !== 'dev' && target.telegram_id && isNotificationEnabled(target.id, 'family_notifications')) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    target.telegram_id,
          text:       `👨‍👩‍👧 <b>${user.first_name}</b> is inviting you to join the family <b>${family.name}</b>!

Accept to feed each other's Peepers and climb the family leaderboard together 🐸`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Accept', callback_data: `family_accept:${inviteId}`, style: 'success' },
              { text: '❌ Decline', callback_data: `family_decline:${inviteId}`, style: 'danger' },
            ]],
          },
        }),
      });
    } catch (e) {
      console.warn('[family] invite notification failed:', e.message);
    }
  }

  res.json({ message: `Invitation sent to ${target.first_name}!` });
});

// ── GET /api/family/invites/pending ───────────────────────────────────────────
router.get('/invites/pending', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const invites = db.prepare(`
    SELECT fi.id, fi.created_at,
           f.name AS family_name, f.id AS family_id,
           u.first_name AS inviter_name, u.telegram_id AS inviter_telegram_id
    FROM family_invites fi
    JOIN families f ON f.id = fi.family_id
    JOIN users u ON u.id = fi.inviter_id
    WHERE fi.invitee_id=? AND fi.status='pending'
    ORDER BY fi.created_at DESC
  `).all(user.id);

  res.json({ invites });
});

// ── GET /api/family/:familyId/profile ─────────────────────────────────────────
router.get('/:familyId/profile', validateTelegramInit, (req, res) => {
  const familyId = parseInt(req.params.familyId, 10);
  const family = db.prepare('SELECT * FROM families WHERE id=?').get(familyId);
  if (!family) return res.status(404).json({ error: 'Family not found' });

  const members = db.prepare(`
    SELECT u.id, u.telegram_id, u.first_name, u.username,
           u.supporter_since, u.supporter_stars,
           fm.joined_at,
           p.alive, p.hp, p.last_fed, p.last_played, p.born_at,
           p.fridge_owned, p.fridge_food_until, p.fridge_purchased_at,
           COALESCE(gs.coins_spent, 0) AS coins_spent,
           COALESCE(gs.gift_count, 0)  AS gifts_sent
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    LEFT JOIN peepers p ON p.user_id = u.id
    LEFT JOIN (
      SELECT sender_id, COUNT(*) AS gift_count, COALESCE(SUM(gift_price),0) AS coins_spent
      FROM gifts_received GROUP BY sender_id
    ) gs ON gs.sender_id = u.id
    WHERE fm.family_id = ?
    ORDER BY COALESCE(gs.coins_spent, 0) DESC, fm.joined_at ASC
  `).all(familyId);

  const now = ts();
  const membersWithStats = members.map(m => serializeFamilyMemberStats(m, now));

  // Stats
  const giftStats = db.prepare(`
    SELECT COUNT(*) AS gift_count, COALESCE(SUM(gift_price),0) AS coins_spent
    FROM gifts_received
    WHERE sender_id IN (SELECT user_id FROM family_members WHERE family_id=?)
  `).get(familyId);

  res.json({
    family,
    members: membersWithStats,
    stats: {
      total_gifts_sent:  giftStats.gift_count,
      total_coins_spent: giftStats.coins_spent,
      member_count:      members.length,
    },
  });
});

// ── GET /api/family/leaderboard ───────────────────────────────────────────────
router.get('/leaderboard', validateTelegramInit, (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit) || 10);
  const now = ts();

  const rows = db.prepare(`
    SELECT
      f.id,
      f.name,
      COUNT(DISTINCT fm.user_id) AS member_count,
      COALESCE(SUM(gift_stats.gift_count), 0) AS total_gifts_sent,
      COALESCE(SUM(gift_stats.coins_spent), 0) AS total_coins_spent
    FROM families f
    JOIN family_members fm ON fm.family_id = f.id
    LEFT JOIN (
      SELECT sender_id, COUNT(*) AS gift_count, COALESCE(SUM(gift_price), 0) AS coins_spent
      FROM gifts_received
      GROUP BY sender_id
    ) gift_stats ON gift_stats.sender_id = fm.user_id
    GROUP BY f.id
    ORDER BY total_coins_spent DESC
    LIMIT ?
  `).all(limit);

  const leaderboard = rows;

  res.json({ leaderboard });
});

module.exports = router;
