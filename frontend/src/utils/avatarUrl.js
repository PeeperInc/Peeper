import { getAssetVersion } from './assetUrl';

const DAY_MS = 24 * 60 * 60 * 1000;

export function getAvatarDaySeed(now = Date.now()) {
  return Math.floor(now / DAY_MS);
}

export function avatarUrl(telegramId) {
  if (!telegramId) return null;
  const daySeed = getAvatarDaySeed();
  const assetVersion = getAssetVersion();
  return `/api/auth/avatar/${telegramId}?v=${encodeURIComponent(assetVersion)}&d=${daySeed}`;
}
