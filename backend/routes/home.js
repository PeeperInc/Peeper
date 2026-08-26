const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const {
  HOME_FOREGROUND_MULTI_SLOT,
  HOME_MULTI_SLOT,
  HOME_PRICE_COINS,
  HOME_SINGLE_SLOTS,
} = require('../homeConstants');
const {
  assertHomeOwned,
  getBackDecor,
  getForegroundItems,
  getFullHomeState,
  getHomeCatalog,
  getHomeItemRow,
  getHomeSummary,
  getOwnedHomeItems,
  grantFreeHomeItems,
  serializeHomeItem,
} = require('../homeState');
const { syncOwnedPeeper } = require('../peeperState');
const { renderVisitHomeScene } = require('../homeRenderer');
const { getPublicAppSettings } = require('../appSettings');

function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(req.telegramUser.id));
}

function getOwnedHomeItemSet(userId) {
  return new Set(getOwnedHomeItems(userId));
}

function getPublicProfileRow(userId) {
  return db.prepare(`
    SELECT id, telegram_id, username, first_name
    FROM users
    WHERE id = ?
  `).get(userId);
}

function getVisitOwner(req) {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { error: 'Invalid user id', status: 400 };
  }

  const owner = getPublicProfileRow(userId);
  if (!owner) {
    return { error: 'User not found', status: 404 };
  }

  const homeState = getFullHomeState(owner.id);
  if (!homeState?.home?.owned) {
    return { error: 'This player does not have a Personal Home yet', status: 404 };
  }

  return { owner, homeState };
}

async function sendTelegramPhoto(chatId, imageBuffer, caption) {
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'dev') {
    return { ok: false, status: 400, description: 'Photo sending is disabled in local development.' };
  }

  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption || '');
    form.append('parse_mode', 'HTML');
    form.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'visit-home.png');

    const resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: form,
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const description = data.description || 'Could not send photo';
      const lowered = description.toLowerCase();
      if (
        lowered.includes('bot was blocked') ||
        lowered.includes("can't initiate conversation") ||
        lowered.includes('chat not found')
      ) {
        return {
          ok: false,
          status: 400,
          description: 'Open the bot chat once and try again so I can send the photo there.',
        };
      }

      return { ok: false, status: resp.status, description };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      description: error.message || 'Could not send photo',
    };
  }
}

router.post('/buy', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const existing = db.prepare('SELECT 1 FROM personal_homes WHERE user_id = ?').get(user.id);
  if (existing) {
    return res.status(400).json({ error: 'Your Personal Home is already unlocked!' });
  }

  if (user.coins < HOME_PRICE_COINS) {
    return res.status(400).json({ error: `Not enough coins! Need ${HOME_PRICE_COINS} ✦` });
  }

  db.transaction(() => {
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(HOME_PRICE_COINS, user.id);
    db.prepare(`
      INSERT INTO personal_homes (user_id)
      VALUES (?)
    `).run(user.id);
    grantFreeHomeItems(user.id);
  })();

  const freshUser = db.prepare('SELECT coins FROM users WHERE id = ?').get(user.id);
  res.json({
    message: '🏠 Your Personal Home is ready!',
    coins: freshUser.coins,
    homeSummary: getHomeSummary(user.id),
    ownedHomeItems: getOwnedHomeItems(user.id),
    ...getPublicAppSettings(),
  });
});

router.get('/state', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    ...getFullHomeState(user.id),
    ...getPublicAppSettings(),
  });
});

router.get('/catalog', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    items: getHomeCatalog(user.id),
    coins: user.coins,
    homeSummary: getHomeSummary(user.id),
    ...getPublicAppSettings(),
  });
});

router.post('/buy-item', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    assertHomeOwned(user.id);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  const { itemId } = req.body || {};
  if (!itemId) return res.status(400).json({ error: 'itemId required' });

  const item = getHomeItemRow(itemId);
  if (!item || !item.is_active) {
    return res.status(404).json({ error: 'Home item not found' });
  }

  const alreadyOwned = db.prepare(`
    SELECT 1
    FROM owned_home_items
    WHERE user_id = ? AND item_id = ?
  `).get(user.id, itemId);
  if (alreadyOwned) {
    return res.status(400).json({ error: 'You already own this decor item!' });
  }

  if (!item.is_free && user.coins < item.price) {
    return res.status(400).json({ error: `Not enough coins! Need ${item.price} ✦` });
  }

  db.transaction(() => {
    if (!item.is_free) {
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(item.price, user.id);
    }
    db.prepare(`
      INSERT INTO owned_home_items (user_id, item_id)
      VALUES (?, ?)
    `).run(user.id, itemId);
  })();

  const freshUser = db.prepare('SELECT coins FROM users WHERE id = ?').get(user.id);
  res.json({
    message: item.is_free ? `Added free decor: ${item.name}` : `You bought: ${item.name}!`,
    item: serializeHomeItem(item),
    coins: freshUser.coins,
    ownedHomeItems: getOwnedHomeItems(user.id),
    ...getPublicAppSettings(),
  });
});

router.post('/layout', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    assertHomeOwned(user.id);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  const updates = {};
  const ownedSet = getOwnedHomeItemSet(user.id);
  const legacyForegroundProvided = Object.prototype.hasOwnProperty.call(req.body || {}, HOME_FOREGROUND_MULTI_SLOT);
  let legacyForegroundItemId = null;

  for (const slot of HOME_SINGLE_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, slot)) continue;
    const itemId = req.body[slot];

    if (itemId == null || itemId === '') {
      updates[slot] = null;
      continue;
    }

    const item = getHomeItemRow(itemId);
    if (!item || item.slot !== slot) {
      return res.status(400).json({ error: `Invalid ${slot} item: ${itemId}` });
    }
    if (!ownedSet.has(itemId)) {
      return res.status(400).json({ error: `You do not own ${item.name}` });
    }
    updates[slot] = itemId;
  }

  if (legacyForegroundProvided) {
    const itemId = req.body[HOME_FOREGROUND_MULTI_SLOT];
    if (itemId != null && itemId !== '') {
      const item = getHomeItemRow(itemId);
      if (!item || item.slot !== HOME_FOREGROUND_MULTI_SLOT) {
        return res.status(400).json({ error: `Invalid foreground item: ${itemId}` });
      }
      if (!ownedSet.has(itemId)) {
        return res.status(400).json({ error: `You do not own ${item.name}` });
      }
      legacyForegroundItemId = itemId;
    }
  }

  if (Object.keys(updates).length === 0 && !legacyForegroundProvided) {
    return res.status(400).json({ error: 'No layout changes provided' });
  }

  const current = db.prepare(`
    SELECT wall_base_item_id, floor_base_item_id, floor_cover_item_id
    FROM personal_homes
    WHERE user_id = ?
  `).get(user.id);

  db.transaction(() => {
    db.prepare(`
      UPDATE personal_homes SET
        wall_base_item_id = ?,
        floor_base_item_id = ?,
        floor_cover_item_id = ?,
        updated_at = strftime('%s','now')
      WHERE user_id = ?
    `).run(
      Object.prototype.hasOwnProperty.call(updates, 'wall_base') ? updates.wall_base : current.wall_base_item_id,
      Object.prototype.hasOwnProperty.call(updates, 'floor_base') ? updates.floor_base : current.floor_base_item_id,
      Object.prototype.hasOwnProperty.call(updates, 'floor_cover') ? updates.floor_cover : current.floor_cover_item_id,
      user.id
    );

    if (legacyForegroundProvided) {
      db.prepare('DELETE FROM home_foreground_items_enabled WHERE user_id = ?').run(user.id);
      if (legacyForegroundItemId) {
        db.prepare(`
          INSERT INTO home_foreground_items_enabled (user_id, item_id, sort_order, enabled_at)
          VALUES (?, ?, 1, strftime('%s','now'))
        `).run(user.id, legacyForegroundItemId);
      }
    }
  })();

  res.json({
    message: 'Home layout updated!',
    ...getFullHomeState(user.id),
    ...getPublicAppSettings(),
  });
});

router.post('/back-decor/toggle', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    assertHomeOwned(user.id);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  const { itemId, enabled } = req.body || {};
  if (!itemId || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'itemId and enabled are required' });
  }

  const item = getHomeItemRow(itemId);
  if (!item || item.slot !== HOME_MULTI_SLOT) {
    return res.status(400).json({ error: 'Invalid back decor item' });
  }

  const ownedSet = getOwnedHomeItemSet(user.id);
  if (!ownedSet.has(itemId)) {
    return res.status(400).json({ error: `You do not own ${item.name}` });
  }

  if (enabled) {
    const nextOrder = db.prepare(`
      SELECT COALESCE(MAX(sort_order) + 1, 1) AS next_order
      FROM home_back_decor_enabled
      WHERE user_id = ?
    `).get(user.id).next_order;

    db.prepare(`
      INSERT OR IGNORE INTO home_back_decor_enabled (user_id, item_id, sort_order, enabled_at)
      VALUES (?, ?, ?, strftime('%s','now'))
    `).run(user.id, itemId, nextOrder);
  } else {
    db.prepare(`
      DELETE FROM home_back_decor_enabled
      WHERE user_id = ? AND item_id = ?
    `).run(user.id, itemId);
  }

  res.json({
    message: enabled ? `${item.name} placed in your home!` : `${item.name} removed from your home.`,
    backDecor: getBackDecor(user.id),
    ...getFullHomeState(user.id),
    ...getPublicAppSettings(),
  });
});

router.post('/back-decor/reorder', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    assertHomeOwned(user.id);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  const { itemIds } = req.body || {};
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: 'itemIds must be a non-empty array' });
  }

  const enabledItems = getBackDecor(user.id);
  const enabledIds = enabledItems.map((item) => item.item_id);

  if (itemIds.length !== enabledIds.length) {
    return res.status(400).json({ error: 'Decor order payload does not match enabled decor set' });
  }

  const enabledSet = new Set(enabledIds);
  const payloadSet = new Set(itemIds);
  if (payloadSet.size !== itemIds.length || itemIds.some((itemId) => !enabledSet.has(itemId))) {
    return res.status(400).json({ error: 'Decor order payload contains invalid items' });
  }

  db.transaction(() => {
    itemIds.forEach((itemId, index) => {
      db.prepare(`
        UPDATE home_back_decor_enabled
        SET sort_order = ?
        WHERE user_id = ? AND item_id = ?
      `).run(index + 1, user.id, itemId);
    });
  })();

  res.json({
    message: 'Decor order updated!',
    backDecor: getBackDecor(user.id),
    ...getFullHomeState(user.id),
    ...getPublicAppSettings(),
  });
});

router.post('/foreground-items/toggle', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    assertHomeOwned(user.id);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  const { itemId, enabled } = req.body || {};
  if (!itemId || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'itemId and enabled are required' });
  }

  const item = getHomeItemRow(itemId);
  if (!item || item.slot !== HOME_FOREGROUND_MULTI_SLOT) {
    return res.status(400).json({ error: 'Invalid foreground item' });
  }

  const ownedSet = getOwnedHomeItemSet(user.id);
  if (!ownedSet.has(itemId)) {
    return res.status(400).json({ error: `You do not own ${item.name}` });
  }

  if (enabled) {
    const nextOrder = db.prepare(`
      SELECT COALESCE(MAX(sort_order) + 1, 1) AS next_order
      FROM home_foreground_items_enabled
      WHERE user_id = ?
    `).get(user.id).next_order;

    db.prepare(`
      INSERT OR IGNORE INTO home_foreground_items_enabled (user_id, item_id, sort_order, enabled_at)
      VALUES (?, ?, ?, strftime('%s','now'))
    `).run(user.id, itemId, nextOrder);
  } else {
    db.prepare(`
      DELETE FROM home_foreground_items_enabled
      WHERE user_id = ? AND item_id = ?
    `).run(user.id, itemId);
  }

  res.json({
    message: enabled ? `${item.name} placed in front!` : `${item.name} removed from your home.`,
    foregroundItems: getForegroundItems(user.id),
    ...getFullHomeState(user.id),
    ...getPublicAppSettings(),
  });
});

router.post('/foreground-items/reorder', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    assertHomeOwned(user.id);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  const { itemIds } = req.body || {};
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: 'itemIds must be a non-empty array' });
  }

  const enabledItems = getForegroundItems(user.id);
  const enabledIds = enabledItems.map((item) => item.item_id);
  const enabledSet = new Set(enabledIds);
  const payloadSet = new Set(itemIds);

  if (itemIds.length !== enabledIds.length) {
    return res.status(400).json({ error: 'Foreground order payload does not match enabled item set' });
  }
  if (payloadSet.size !== itemIds.length || itemIds.some((itemId) => !enabledSet.has(itemId))) {
    return res.status(400).json({ error: 'Foreground order payload contains invalid items' });
  }

  db.transaction(() => {
    itemIds.forEach((itemId, index) => {
      db.prepare(`
        UPDATE home_foreground_items_enabled
        SET sort_order = ?
        WHERE user_id = ? AND item_id = ?
      `).run(index + 1, user.id, itemId);
    });
  })();

  res.json({
    message: 'Foreground order updated!',
    foregroundItems: getForegroundItems(user.id),
    ...getFullHomeState(user.id),
    ...getPublicAppSettings(),
  });
});

router.get('/visit/:userId', validateTelegramInit, (req, res) => {
  const viewer = getUser(req);
  if (!viewer) return res.status(404).json({ error: 'User not found' });

  const visit = getVisitOwner(req);
  if (visit.error) {
    return res.status(visit.status || 400).json({ error: visit.error });
  }

  const ownerPeeper = syncOwnedPeeper(visit.owner.id);

  res.json({
    owner: visit.owner,
    ownerPeeper,
    home: visit.homeState.home,
    ...getPublicAppSettings(),
  });
});

router.post('/visit/:userId/photo', validateTelegramInit, async (req, res) => {
  const viewer = getUser(req);
  if (!viewer) return res.status(404).json({ error: 'User not found' });

  const visit = getVisitOwner(req);
  if (visit.error) {
    return res.status(visit.status || 400).json({ error: visit.error });
  }

  const viewerPeeper = syncOwnedPeeper(viewer.id);
  const ownerPeeper = syncOwnedPeeper(visit.owner.id);

  if (!viewerPeeper || !ownerPeeper) {
    return res.status(400).json({ error: 'Could not load both Peepers for this photo' });
  }

  const imageBuffer = await renderVisitHomeScene(visit.homeState.home, viewerPeeper, ownerPeeper);
  if (!imageBuffer) {
    return res.status(500).json({ error: 'Could not render visit photo right now' });
  }

  const ownerName = visit.owner.first_name || visit.owner.username || 'your friend';
  const sendResult = await sendTelegramPhoto(
    viewer.telegram_id,
    imageBuffer,
    `🏠 <b>You visited ${ownerName}'s home</b>`
  );

  if (!sendResult.ok) {
    return res.status(sendResult.status || 500).json({ error: sendResult.description });
  }

  res.json({
    message: `Photo sent to your chat with the bot!`,
    ...getPublicAppSettings(),
  });
});

module.exports = router;
