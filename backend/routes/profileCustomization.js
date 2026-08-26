'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const {
  PROFILE_FRAME_SIZE,
  PROFILE_SCENE_HEIGHT,
  PROFILE_SCENE_WIDTH,
  equipProfileItem,
  getProfileAppearance,
  getProfileCatalog,
  grantAdminTitleIfNeeded,
  purchaseProfileItem,
} = require('../profileCustomization');

function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?')
    .get(String(req.telegramUser?.id || ''));
}

function sendKnownError(res, error) {
  const status = Number(error?.status || 500);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: error.message });
  }
  console.error('[profile customization]', error);
  return res.status(500).json({ error: 'Could not update profile customization' });
}

router.get('/catalog', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  grantAdminTitleIfNeeded(user);
  return res.json({
    items: getProfileCatalog(user.id),
    appearance: getProfileAppearance(user.id),
    coins: Number(user.coins || 0),
    assetGuide: {
      frame: { width: PROFILE_FRAME_SIZE, height: PROFILE_FRAME_SIZE, format: 'PNG' },
      scene: { width: PROFILE_SCENE_WIDTH, height: PROFILE_SCENE_HEIGHT, format: 'PNG' },
    },
  });
});

router.post('/buy', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  try {
    const result = purchaseProfileItem(user.id, String(req.body?.itemId || ''));
    return res.json({ ...result, message: `${result.item.name} added to your Profile Studio` });
  } catch (error) {
    return sendKnownError(res, error);
  }
});

router.post('/equip', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  try {
    const appearance = equipProfileItem(user.id, req.body?.type, req.body?.itemId);
    return res.json({
      appearance,
      message: req.body?.itemId ? 'Profile style equipped' : 'Profile style removed',
    });
  } catch (error) {
    return sendKnownError(res, error);
  }
});

module.exports = router;
