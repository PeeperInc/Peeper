const db = require('./database');

const DEFAULT_ASSET_VERSION = '20260330-1';
const DEFAULT_SETTINGS = {
  asset_version: DEFAULT_ASSET_VERSION,
  casino_jackpot_pool: '0',
};

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  if (row?.value != null) return row.value;
  return fallback;
}

function setSetting(key, value) {
  const normalized = String(value ?? '');
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, normalized);
  return normalized;
}

function getAssetVersion() {
  return getSetting('asset_version', DEFAULT_SETTINGS.asset_version);
}

function getCasinoJackpot() {
  const raw = getSetting('casino_jackpot_pool', DEFAULT_SETTINGS.casino_jackpot_pool);
  const value = Math.max(0, Math.floor(Number(raw) || 0));
  return value;
}

function setCasinoJackpot(value) {
  const normalized = Math.max(0, Math.floor(Number(value) || 0));
  setSetting('casino_jackpot_pool', normalized);
  return normalized;
}

function addCasinoJackpot(amount) {
  const next = getCasinoJackpot() + Math.max(0, Math.floor(Number(amount) || 0));
  return setCasinoJackpot(next);
}

function resetCasinoJackpot() {
  return setCasinoJackpot(0);
}

function getPublicAppSettings() {
  return {
    assetVersion: getAssetVersion(),
    casinoJackpot: getCasinoJackpot(),
  };
}

function bustAssetCache() {
  const nextVersion = String(Date.now());
  setSetting('asset_version', nextVersion);
  db.prepare('UPDATE users SET photo_updated_at = 0').run();
  return getPublicAppSettings();
}

module.exports = {
  DEFAULT_ASSET_VERSION,
  getAssetVersion,
  getCasinoJackpot,
  setCasinoJackpot,
  addCasinoJackpot,
  resetCasinoJackpot,
  getPublicAppSettings,
  bustAssetCache,
};
