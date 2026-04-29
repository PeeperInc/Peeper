const crypto = require('crypto');

/**
 * Validates Telegram Mini App initData using HMAC-SHA256.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * In development mode (BOT_TOKEN=dev or not set) it accepts mock data.
 */
function validateTelegramInit(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];

  if (!initData) {
    return res.status(401).json({ error: 'Missing Telegram init data' });
  }

  // Development bypass
  if (process.env.BOT_TOKEN === 'dev' || process.env.NODE_ENV === 'development') {
    try {
      const parsed = parseTelegramInitData(initData);
      req.telegramUser = parsed.user || { id: 999999, username: 'devuser', first_name: 'Dev' };
      return next();
    } catch {
      req.telegramUser = { id: 999999, username: 'devuser', first_name: 'Dev' };
      return next();
    }
  }

  // Production validation
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    return res.status(500).json({ error: 'Server misconfiguration: BOT_TOKEN not set' });
  }

  try {
    if (!verifyInitData(initData, botToken)) {
      return res.status(401).json({ error: 'Invalid Telegram auth' });
    }
    const parsed = parseTelegramInitData(initData);

    // Check init_data is not too old (24h max)
    if (parsed.auth_date) {
      const age = Math.floor(Date.now() / 1000) - parseInt(parsed.auth_date, 10);
      if (age > 86400) {
        return res.status(401).json({ error: 'Auth data expired' });
      }
    }

    req.telegramUser = parsed.user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(401).json({ error: 'Auth failed' });
  }
}

function verifyInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function parseTelegramInitData(initData) {
  const params = new URLSearchParams(initData);
  const result = {};
  for (const [key, value] of params.entries()) {
    if (key === 'user') {
      try { result.user = JSON.parse(value); } catch { result.user = {}; }
    } else {
      result[key] = value;
    }
  }
  return result;
}

module.exports = { validateTelegramInit };
