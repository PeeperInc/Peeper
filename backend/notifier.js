/**
 * PEEPER NOTIFICATION WORKER
 *
 * Checks every 60 seconds. Five notification types (no spam):
 *
 *  fun_zero    — fun hit 0 (max energy available) — once, resets when fun > 5
 *  hunger_30   — hunger ≤ 30% — once per 6h, resets when hunger > 40
 *  hunger_zero — hunger = 0 (HP draining!) — every 2h while starving
 *  hp50        — HP ≤ 50% — once per 6h, resets when HP > 60
 *  hp10        — HP ≤ 10% — every 1h while critical, resets when HP > 20
 *  died        — peeper died — once per death
 */

const db      = require('./database');
const { liveStats } = require('./gameLogic');
const { isNotificationEnabled } = require('./notificationSettings');

const INTERVAL_MS = 60 * 1000;
const APP_URL     = 'https://peeper.frenzyradio.online';

const COOLDOWNS = {
  fun_zero:    0,           // once until fun recovers (cleared when fun > 5)
  hunger_30:   6 * 3600,   // resend every 6h while hunger ≤ 30
  hunger_zero: 2 * 3600,   // resend every 2h while starving
  hp50:        6 * 3600,   // resend every 6h while HP ≤ 50
  hp10:        1 * 3600,   // resend every 1h while critical
  died:        0,           // once per death
};

let botToken = null;

function ts() { return Math.floor(Date.now() / 1000); }

// ── Telegram ────────────────────────────────────────────────────────────────

async function sendMessage(telegramId, text) {
  if (!botToken) return;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    telegramId,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{
            text:    '🐸 Open Peeper',
            web_app: { url: APP_URL },
            style:   'success',
          }]],
        },
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (err.error_code !== 403) {
        console.warn(`[notifier] TG error for ${telegramId}:`, err.description || resp.status);
      }
    }
  } catch (e) {
    console.warn(`[notifier] fetch error for ${telegramId}:`, e.message);
  }
}

async function sendCareNotification(userId, telegramId, text) {
  if (!isNotificationEnabled(userId, 'care_notifications')) return;
  await sendMessage(telegramId, text);
}

// ── Dedup ───────────────────────────────────────────────────────────────────

function getSentAt(userId, type) {
  const row = db.prepare('SELECT sent_at FROM notifications_sent WHERE user_id = ? AND type = ?').get(userId, type);
  return row ? row.sent_at : null;
}

function markSent(userId, type) {
  db.prepare(`
    INSERT OR REPLACE INTO notifications_sent (user_id, type, sent_at)
    VALUES (?, ?, ?)
  `).run(userId, type, ts());
}

function clearFlag(userId, type) {
  db.prepare('DELETE FROM notifications_sent WHERE user_id = ? AND type = ?').run(userId, type);
}

function shouldSend(userId, type) {
  const sentAt   = getSentAt(userId, type);
  if (sentAt === null) return true;
  const cooldown = COOLDOWNS[type] ?? 0;
  if (cooldown === 0) return false;           // one-shot until cleared
  return (ts() - sentAt) >= cooldown;
}

// ── Main check ──────────────────────────────────────────────────────────────

async function checkAll() {
  if (!botToken) return;

  const rows = db.prepare(`
    SELECT u.id AS user_id, u.telegram_id, u.first_name, p.*
    FROM users u
    JOIN peepers p ON p.user_id = u.id
  `).all();

  for (const row of rows) {
    const userId     = row.user_id;
    const telegramId = row.telegram_id;
    const name       = row.first_name || 'your Peeper';
    if (!row || !row.born_at) continue; // skip users without a peeper
    const live       = liveStats(row);

    // ── Auto-kill + death penalty ──────────────────────────────────────
    // liveStats confirmed death. Guard against clock-skew bugs: skip if last_fed < 8h ago.
    const secondsSinceFed = ts() - row.last_fed;
    if (!live.alive && row.alive) {
      if (secondsSinceFed < 28800) {
        console.warn(`[notifier] applyDeath SKIPPED for user ${userId}: last_fed only ${secondsSinceFed}s ago`);
      } else {
      db.transaction(() => {
        const dp          = db.prepare('SELECT slot_head, slot_body, slot_hands, slot_fren, slot_face FROM peepers WHERE user_id = ?').get(userId);
        const equippedIds = [dp.slot_head, dp.slot_body, dp.slot_hands, dp.slot_fren, dp.slot_face].filter(Boolean);

        db.prepare(`
          UPDATE peepers
          SET alive = 0, hp = 0,
              slot_head = NULL, slot_body = NULL, slot_hands = NULL, slot_fren = NULL, slot_face = NULL
          WHERE user_id = ?
        `).run(userId);

        for (const itemId of equippedIds) {
          db.prepare('DELETE FROM owned_items WHERE user_id = ? AND item_id = ?').run(userId, itemId);
        }

        const fresh   = db.prepare('SELECT coins FROM users WHERE id = ?').get(userId);
        const penalty = Math.floor((fresh.coins || 0) / 2);
        if (penalty > 0) {
          db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(penalty, userId);
        }
      })();
      } // end secondsSinceFed check
    }

    // ── DIED ──────────────────────────────────────────────────────────
    if (!live.alive) {
      if (shouldSend(userId, 'died')) {
        await sendCareNotification(userId, telegramId,
          `💀 <b>${name} died of hunger!</b>\n\nYou lost your equipped items and half your coins.\n\nOpen the app to revive and try again 🌱`
        );
        markSent(userId, 'died');
      }
      continue;
    }

    // Alive — clear died flag so next death fires again
    clearFlag(userId, 'died');

    // ── FUN = 0 → max energy ──────────────────────────────────────────
    if (live.fun <= 0) {
      if (shouldSend(userId, 'fun_zero')) {
        await sendCareNotification(userId, telegramId,
          `⚡ <b>${name} has max energy!</b>\n\nFun is at 0 — you have 5 energy tokens to spend on mini-games. Earn some coins! 🎮`
        );
        markSent(userId, 'fun_zero');
      }
    } else if (live.fun > 5) {
      clearFlag(userId, 'fun_zero');
    }

    // ── HUNGER ≤ 30% ─────────────────────────────────────────────────
    if (live.hunger <= 30 && live.hunger > 0) {
      if (shouldSend(userId, 'hunger_30')) {
        await sendCareNotification(userId, telegramId,
          `🍽 <b>${name} is getting hungry! (${Math.round(live.hunger)}%)</b>\n\nFeed soon — if hunger hits 0, HP starts draining. 🍎`
        );
        markSent(userId, 'hunger_30');
      }
    } else if (live.hunger > 40) {
      clearFlag(userId, 'hunger_30');
    }

    // ── HUNGER = 0 ────────────────────────────────────────────────────
    if (live.hunger <= 0) {
      if (shouldSend(userId, 'hunger_zero')) {
        await sendCareNotification(userId, telegramId,
          `🚨 <b>${name} is starving!</b>\n\nHunger is 0 — HP is draining now. Feed immediately or ${name} will die in ~36 hours! 🍕`
        );
        markSent(userId, 'hunger_zero');
      }
    } else if (live.hunger > 5) {
      clearFlag(userId, 'hunger_zero');
    }

    // ── HP ≤ 50% ──────────────────────────────────────────────────────
    if (live.hp <= 50 && live.hp > 10) {
      if (shouldSend(userId, 'hp50')) {
        await sendCareNotification(userId, telegramId,
          `💛 <b>${name}'s HP is at ${Math.round(live.hp)}%</b>\n\nHealth is dropping — feed your Peeper to recover HP! 🩹`
        );
        markSent(userId, 'hp50');
      }
    } else if (live.hp > 60) {
      clearFlag(userId, 'hp50');
    }

    // ── HP ≤ 10% ──────────────────────────────────────────────────────
    if (live.hp <= 10) {
      if (shouldSend(userId, 'hp10')) {
        await sendCareNotification(userId, telegramId,
          `🆘 <b>CRITICAL! ${name} is almost dead — HP: ${Math.round(live.hp)}%</b>\n\nFeed RIGHT NOW or they're gone for good! 💀`
        );
        markSent(userId, 'hp10');
      }
    } else if (live.hp > 20) {
      clearFlag(userId, 'hp10');
    }
  }
}

// ── Start / Stop ────────────────────────────────────────────────────────────

let timer = null;

function start(token) {
  if (!token || token === 'dev') {
    console.log('[notifier] No valid BOT_TOKEN — notifications disabled');
    return;
  }
  botToken = token;
  console.log('[notifier] Started');
  setTimeout(() => checkAll().catch(e => console.error('[notifier]', e)), 5000);
  timer = setInterval(() => checkAll().catch(e => console.error('[notifier]', e)), INTERVAL_MS);
}

function stop() {
  if (timer) clearInterval(timer);
}

module.exports = { start, stop };
