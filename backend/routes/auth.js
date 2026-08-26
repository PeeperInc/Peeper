const express = require('express');
const router  = express.Router();
const https   = require('https');
const db      = require('../database');
const { validateTelegramInit } = require('../auth');
const { syncOwnedPeeper } = require('../peeperState');
const { getHomeSummary, getOwnedHomeItems, grantFreeHomeItems } = require('../homeState');
const { getPublicAppSettings } = require('../appSettings');
const { getEnergyDrinkState } = require('../energyDrinkState');
const { getFridgeState } = require('../fridgeState');
const { getFarmSummary } = require('../farmState');
const { getSupporterSummary } = require('../supportState');
const { getNextDirtyAt } = require('../dirtyCycle');
const {
  getProfileAppearance,
  grantAdminTitleIfNeeded,
  syncProfileAchievementUnlocks,
} = require('../profileCustomization');

function tgApiCall(token, method) {
  return new Promise((resolve) => {
    https.get(`https://api.telegram.org/bot${token}/${method}`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

/**
 * Fetch Telegram profile photo URL via Bot API.
 * Returns a temporary Telegram CDN URL (valid ~1h).
 * Client caches it — good enough for display.
 */
async function fetchTelegramPhoto(telegramId) {
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'dev') return null;
  try {
    const photosData = await tgApiCall(token, `getUserProfilePhotos?user_id=${telegramId}&limit=1`);
    if (!photosData?.result?.photos?.length) return null;
    const fileId   = photosData.result.photos[0][0].file_id;
    const fileData = await tgApiCall(token, `getFile?file_id=${fileId}`);
    if (!fileData?.result?.file_path) return null;
    return `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
  } catch {
    return null;
  }
}

/**
 * POST /api/auth/login
 */
router.post('/login', validateTelegramInit, async (req, res) => {
  const tgUser = req.telegramUser;
  if (!tgUser || !tgUser.id) {
    return res.status(400).json({ error: 'No user data in init data' });
  }

  const telegramId = String(tgUser.id);
  const nowTs      = Math.floor(Date.now() / 1000);
  const resolvedUsername = tgUser.username ?? null;
  const resolvedFirstName = tgUser.first_name || 'Peeper Owner';
  const shouldOverwriteUsername = 1;

  // Refresh photo on every login — URL expires ~1h but client caches it
  const existing    = db.prepare('SELECT photo_url, photo_updated_at FROM users WHERE telegram_id = ?').get(telegramId);
  let photoUrl      = existing?.photo_url || null;
  const lastUpdate  = existing?.photo_updated_at || 0;
  // Re-fetch once per day (URL lasts ~1h but client caches; daily refresh keeps it fresh)
  if (!photoUrl || (nowTs - lastUpdate) > 86400) {
    const fresh = await fetchTelegramPhoto(telegramId);
    if (fresh) { photoUrl = fresh; }
  }

  db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, photo_url, photo_updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username         = CASE
                           WHEN ? THEN excluded.username
                           ELSE username
                         END,
      first_name       = excluded.first_name,
      photo_url        = COALESCE(excluded.photo_url, photo_url),
      photo_updated_at = CASE WHEN excluded.photo_url IS NOT NULL THEN excluded.photo_updated_at ELSE photo_updated_at END
  `).run(
    telegramId,
    resolvedUsername,
    resolvedFirstName,
    photoUrl,
    photoUrl ? nowTs : lastUpdate,
    shouldOverwriteUsername
  );

  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  grantAdminTitleIfNeeded(user);
  syncProfileAchievementUnlocks(user.id);

  if (!db.prepare('SELECT id FROM peepers WHERE user_id = ?').get(user.id)) {
    db.prepare(`
      INSERT INTO peepers (user_id, last_fed, last_played, last_action_at, next_dirty_at)
      VALUES (?, ?, ?, 0, ?)
    `).run(user.id, nowTs - 6 * 3600, nowTs - 3 * 3600, getNextDirtyAt(nowTs));
  }

  db.transaction(() => {
    const freeItems = db.prepare("SELECT item_id FROM shop_items WHERE is_free = 1").all();
    for (const { item_id } of freeItems) {
      db.prepare('INSERT OR IGNORE INTO owned_items (user_id, item_id) VALUES (?, ?)').run(user.id, item_id);
    }
    grantFreeHomeItems(user.id);
  })();

  const peeper     = syncOwnedPeeper(user.id, nowTs);
  const freshUser  = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  const ownedItems = db.prepare('SELECT item_id FROM owned_items WHERE user_id = ?')
    .all(user.id).map(r => r.item_id);
  const ownedHomeItems = getOwnedHomeItems(user.id);

  res.json({
    user: {
      id:          freshUser.id,
      telegram_id: freshUser.telegram_id,
      username:    freshUser.username,
      first_name:  freshUser.first_name,
      photo_url:   freshUser.photo_url,
      coins:       freshUser.coins,
      supporter:   getSupporterSummary(freshUser),
      appearance:  getProfileAppearance(freshUser.id),
    },
    peeper,
    ownedItems,
    ownedHomeItems,
    homeSummary: getHomeSummary(user.id),
    farmSummary: getFarmSummary(user.id),
    casinoFreeSpins: Math.max(0, Math.floor(Number(freshUser.casino_free_spins) || 0)),
    energyDrink: getEnergyDrinkState(user.id, peeper, nowTs),
    fridge: getFridgeState(peeper, nowTs),
    ...getPublicAppSettings(),
  });
});

/**
 * POST /api/auth/refresh-photo
 */
router.post('/refresh-photo', validateTelegramInit, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const photoUrl   = await fetchTelegramPhoto(telegramId);
  if (photoUrl) {
    db.prepare('UPDATE users SET photo_url = ?, photo_updated_at = ? WHERE telegram_id = ?')
      .run(photoUrl, Math.floor(Date.now() / 1000), telegramId);
  }
  res.json({ photo_url: photoUrl });
});

/**
 * GET /api/auth/avatar/:telegramId
 * Proxies Telegram profile photo through our server.
 * Fetches on-demand if not in DB yet. Refreshes if expired.
 */
router.get('/avatar/:telegramId', async (req, res) => {
  const telegramId = req.params.telegramId;
  const nowTs = Math.floor(Date.now() / 1000);

  let user = db.prepare('SELECT photo_url, photo_updated_at FROM users WHERE telegram_id = ?').get(telegramId);
  if (!user) return res.status(404).end();

  // Fetch/refresh if missing or older than 24h
  if (!user.photo_url || (nowTs - (user.photo_updated_at || 0)) > 86400) {
    const fresh = await fetchTelegramPhoto(telegramId);
    if (fresh) {
      db.prepare('UPDATE users SET photo_url = ?, photo_updated_at = ? WHERE telegram_id = ?')
        .run(fresh, nowTs, telegramId);
      user = { photo_url: fresh };
    }
  }

  if (!user.photo_url) return res.status(404).end();

  https.get(user.photo_url, (tgRes) => {
    if (tgRes.statusCode !== 200) {
      // URL expired — clear and return 404, next request will re-fetch
      db.prepare('UPDATE users SET photo_url = NULL, photo_updated_at = 0 WHERE telegram_id = ?').run(telegramId);
      return res.status(404).end();
    }
    res.setHeader('Content-Type', tgRes.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=300');
    tgRes.pipe(res);
  }).on('error', () => res.status(502).end());
});

module.exports = router;
