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
const { getFarmCropReadiness, getFarmAnimalReadiness } = require('./farmState');

const INTERVAL_MS = 60 * 1000;
const APP_URL     = 'https://peeper.frenzyradio.online';

const COOLDOWNS = {
  fun_zero:    0,           // once until fun recovers (cleared when fun > 5)
  hunger_30:   6 * 3600,   // resend every 6h while hunger ≤ 30
  hunger_zero: 2 * 3600,   // resend every 2h while starving
  hp50:        6 * 3600,   // resend every 6h while HP ≤ 50
  hp10:        1 * 3600,   // resend every 1h while critical
  died:        0,           // once per death
  farm_crops_ready: 0,      // once until crops are harvested/replanted
  farm_animals_ready: 0,    // once until animal products are collected/new feed starts
  expedition_ap_full: 0,    // once until AP is spent below cap
  expedition_boss_ready: 0, // once until boss is no longer attackable
  expedition_boss_reward: 0,// once until reward is claimed
  expedition_finished: 0,   // once while a recent finish is visible
};

const EXPEDITION_AP_CAP = 6;
const EXPEDITION_FINISHED_RECENT_SECONDS = 24 * 3600;

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

async function sendFarmNotification(userId, telegramId, text) {
  if (!isNotificationEnabled(userId, 'farm_notifications')) return;
  await sendMessage(telegramId, text);
}

async function sendFarmAnimalNotification(userId, telegramId, text) {
  if (!isNotificationEnabled(userId, 'farm_animal_notifications')) return;
  await sendMessage(telegramId, text);
}

async function sendExpeditionNotification(userId, telegramId, text, send = sendMessage) {
  if (!isNotificationEnabled(userId, 'expedition_notifications')) return false;
  await send(telegramId, text);
  return true;
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

function rowsToUserIdSet(rows) {
  return new Set(rows.map(row => Number(row.user_id)));
}

function clearStaleFlags(type, activeUserIds) {
  const rows = db.prepare('SELECT user_id FROM notifications_sent WHERE type = ?').all(type);
  for (const row of rows) {
    if (!activeUserIds.has(Number(row.user_id))) {
      clearFlag(row.user_id, type);
    }
  }
}

async function sendExpeditionRows({ type, rows, text, send }) {
  for (const row of rows) {
    const userId = row.user_id;
    if (!row.telegram_id || !shouldSend(userId, type)) continue;
    const delivered = await sendExpeditionNotification(userId, row.telegram_id, text(row), send);
    if (delivered) markSent(userId, type);
  }
}

function getExpeditionApFullRows() {
  return db.prepare(`
    SELECT u.id AS user_id, u.telegram_id, u.first_name, e.id AS expedition_id, m.ap
    FROM family_expedition_members m
    JOIN family_expeditions e ON e.id = m.expedition_id
    JOIN users u ON u.id = m.user_id
    WHERE e.status != 'finished'
      AND m.prepared_at IS NOT NULL
      AND m.ap >= ?
  `).all(EXPEDITION_AP_CAP);
}

function getExpeditionBossReadyRows() {
  return db.prepare(`
    SELECT u.id AS user_id, u.telegram_id, u.first_name, e.id AS expedition_id
    FROM family_expeditions e
    JOIN family_expedition_rooms r ON r.expedition_id = e.id
    JOIN family_expedition_members m ON m.expedition_id = e.id
    JOIN users u ON u.id = m.user_id
    WHERE e.status = 'active'
      AND r.room_type = 'boss'
      AND r.state = 'unlocked'
      AND m.prepared_at IS NOT NULL
  `).all();
}

function getExpeditionBossRewardRows() {
  return db.prepare(`
    SELECT u.id AS user_id, u.telegram_id, u.first_name, e.id AS expedition_id
    FROM family_expedition_members m
    JOIN family_expeditions e ON e.id = m.expedition_id
    JOIN users u ON u.id = m.user_id
    WHERE e.status = 'boss_defeated'
      AND m.prepared_at IS NOT NULL
      AND m.boss_reward_claimed_at IS NULL
  `).all();
}

function getExpeditionFinishedRows(now = ts()) {
  return db.prepare(`
    SELECT u.id AS user_id, u.telegram_id, u.first_name, e.id AS expedition_id, e.finished_at
    FROM family_expeditions e
    JOIN family_members fm ON fm.family_id = e.family_id
    JOIN users u ON u.id = fm.user_id
    WHERE e.status = 'finished'
      AND e.finished_at IS NOT NULL
      AND e.finished_at >= ?
  `).all(now - EXPEDITION_FINISHED_RECENT_SECONDS);
}

async function checkExpeditionNotifications(options = {}) {
  const now = options.now ?? ts();
  const send = options.send || sendMessage;

  const apFullRows = getExpeditionApFullRows();
  clearStaleFlags('expedition_ap_full', rowsToUserIdSet(apFullRows));
  await sendExpeditionRows({
    type: 'expedition_ap_full',
    rows: apFullRows,
    send,
    text: () => `${String.fromCodePoint(0x26A1)} <b>Your expedition AP is full.</b>\n\nThe crypt is waiting. Spend your strength before it spoils.`,
  });

  const bossReadyRows = getExpeditionBossReadyRows();
  clearStaleFlags('expedition_boss_ready', rowsToUserIdSet(bossReadyRows));
  await sendExpeditionRows({
    type: 'expedition_boss_ready',
    rows: bossReadyRows,
    send,
    text: () => `${String.fromCodePoint(0x1F409)} <b>The expedition boss is exposed.</b>\n\nGather the family and strike before the shadows regroup.`,
  });

  const bossRewardRows = getExpeditionBossRewardRows();
  clearStaleFlags('expedition_boss_reward', rowsToUserIdSet(bossRewardRows));
  await sendExpeditionRows({
    type: 'expedition_boss_reward',
    rows: bossRewardRows,
    send,
    text: () => `${String.fromCodePoint(0x1F3C6)} <b>A boss reward is waiting.</b>\n\nClaim your spoils from the fallen horror.`,
  });

  const finishedRows = getExpeditionFinishedRows(now);
  clearStaleFlags('expedition_finished', rowsToUserIdSet(finishedRows));
  await sendExpeditionRows({
    type: 'expedition_finished',
    rows: finishedRows,
    send,
    text: () => `${String.fromCodePoint(0x1F56F)} <b>Your family expedition is finished.</b>\n\nThe dungeon grows quiet. Open Peeper to read the final tale.`,
  });
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

    const farmCrops = getFarmCropReadiness(userId);
    if (farmCrops.allPlantedReady) {
      if (shouldSend(userId, 'farm_crops_ready')) {
        await sendFarmNotification(userId, telegramId,
          `🌾 <b>Your Farm harvest is ready!</b>\n\nAll planted crops are ready to collect. Open Peeper and check the Farm.`
        );
        markSent(userId, 'farm_crops_ready');
      }
    } else {
      clearFlag(userId, 'farm_crops_ready');
    }

    const farmAnimals = getFarmAnimalReadiness(userId);
    if (farmAnimals.allFedAnimalsReady) {
      if (shouldSend(userId, 'farm_animals_ready')) {
        await sendFarmAnimalNotification(userId, telegramId,
          `${String.fromCodePoint(0x1F43E)} <b>Your Farm animals are ready!</b>\n\nAll fed animals have products to collect. Open Peeper and check the Farm.`
        );
        markSent(userId, 'farm_animals_ready');
      }
    } else {
      clearFlag(userId, 'farm_animals_ready');
    }

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

  await checkExpeditionNotifications();
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

module.exports = {
  start,
  stop,
  checkExpeditionNotifications,
  _expeditionNotificationInternals: {
    getExpeditionApFullRows,
    getExpeditionBossReadyRows,
    getExpeditionBossRewardRows,
    getExpeditionFinishedRows,
  },
};
