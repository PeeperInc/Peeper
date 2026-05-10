const crypto = require('crypto');

const SUPPORT_STAR_AMOUNTS = [50, 100, 250, 500];
const SUPPORT_PAYLOAD_PREFIX = 'support';

function normalizeSupportStars(value) {
  const stars = Math.floor(Number(value));
  if (!SUPPORT_STAR_AMOUNTS.includes(stars)) {
    throw new Error('Unsupported Telegram Stars donation amount.');
  }
  return stars;
}

function createSupportNonce() {
  return crypto.randomBytes(8).toString('hex');
}

function buildSupportPayload(userId, stars, nonce = createSupportNonce()) {
  const normalizedUserId = Math.floor(Number(userId));
  const normalizedStars = normalizeSupportStars(stars);
  if (!normalizedUserId || normalizedUserId < 1) {
    throw new Error('Invalid support user id.');
  }
  return `${SUPPORT_PAYLOAD_PREFIX}:${normalizedUserId}:${normalizedStars}:${String(nonce).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function parseSupportPayload(payload) {
  const parts = String(payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== SUPPORT_PAYLOAD_PREFIX) return null;

  const userId = Math.floor(Number(parts[1]));
  let stars;
  try {
    stars = normalizeSupportStars(parts[2]);
  } catch {
    return null;
  }
  const nonce = parts[3];
  if (!userId || userId < 1 || !nonce) return null;
  return { userId, stars, nonce };
}

function recordSupportDonation(db, {
  userId,
  telegramPaymentChargeId,
  providerPaymentChargeId = '',
  stars,
  payload,
  createdAt = Math.floor(Date.now() / 1000),
}) {
  const normalizedStars = normalizeSupportStars(stars);
  const chargeId = String(telegramPaymentChargeId || '').trim();
  if (!chargeId) throw new Error('Missing Telegram payment charge id.');

  const existing = db.prepare('SELECT id FROM support_donations WHERE telegram_payment_charge_id = ?').get(chargeId);
  if (existing) return { recorded: false };

  db.prepare(`
    INSERT INTO support_donations (
      user_id,
      telegram_payment_charge_id,
      provider_payment_charge_id,
      stars_amount,
      payload,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    chargeId,
    String(providerPaymentChargeId || ''),
    normalizedStars,
    String(payload || ''),
    createdAt,
  );

  db.prepare(`
    UPDATE users
    SET supporter_since = COALESCE(supporter_since, ?),
        supporter_stars = COALESCE(supporter_stars, 0) + ?
    WHERE id = ?
  `).run(createdAt, normalizedStars, userId);

  return { recorded: true };
}

function getSupporterSummary(user = {}) {
  const starsTotal = Math.max(0, Math.floor(Number(user.supporter_stars) || 0));
  const since = user.supporter_since ? Number(user.supporter_since) : null;
  return {
    donated: starsTotal > 0 || Boolean(since),
    starsTotal,
    since,
  };
}

module.exports = {
  SUPPORT_STAR_AMOUNTS,
  normalizeSupportStars,
  createSupportNonce,
  buildSupportPayload,
  parseSupportPayload,
  recordSupportDonation,
  getSupporterSummary,
};
