'use strict';

const ADMIN_TELEGRAM_IDS = ['179221945', '6041075358', '5331682988', '6290708617'];
const DEV_ADMIN_ID = '999999';

function isLocalDevAdmin(telegramId) {
  return process.env.NODE_ENV !== 'production' && String(telegramId) === DEV_ADMIN_ID;
}

function isAdminTelegramId(telegramId) {
  const normalizedId = String(telegramId || '');
  return ADMIN_TELEGRAM_IDS.includes(normalizedId) || isLocalDevAdmin(normalizedId);
}

module.exports = {
  ADMIN_TELEGRAM_IDS,
  DEV_ADMIN_ID,
  isAdminTelegramId,
  isLocalDevAdmin,
};
