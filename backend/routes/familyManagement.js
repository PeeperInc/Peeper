'use strict';

const express = require('express');
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const {
  FAMILY_RENAME_COST,
  FamilyManagementError,
  removeFamilyMember,
  renameFamily,
  transferFamilyOwnership,
} = require('../familyManagement');

const router = express.Router();

function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(req.telegramUser.id));
}

function handleManagementError(res, error) {
  if (error instanceof FamilyManagementError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error('[family-management]', error);
  return res.status(500).json({ error: 'Could not update the family' });
}

router.post('/kick', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    removeFamilyMember(db, {
      actorUserId: user.id,
      targetUserId: req.body?.userId,
    });
    return res.json({ message: 'Member removed' });
  } catch (error) {
    return handleManagementError(res, error);
  }
});

router.post('/rename', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const result = renameFamily(db, {
      actorUserId: user.id,
      name: req.body?.name,
      cost: FAMILY_RENAME_COST,
    });
    return res.json({
      ...result,
      message: `Family renamed to "${result.family.name}"`,
    });
  } catch (error) {
    return handleManagementError(res, error);
  }
});

router.post('/transfer', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const result = transferFamilyOwnership(db, {
      actorUserId: user.id,
      targetUserId: req.body?.userId,
    });
    return res.json({
      ...result,
      message: `Ownership transferred to ${result.newFounder.first_name || result.newFounder.username || 'the selected member'}`,
    });
  } catch (error) {
    return handleManagementError(res, error);
  }
});

module.exports = router;
