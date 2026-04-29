const crypto = require('crypto');

function getTelegramWebhookSecret(botToken = process.env.BOT_TOKEN) {
  if (!botToken || botToken === 'dev') return null;
  return crypto
    .createHash('sha256')
    .update(`peeper-telegram-webhook:${botToken}`)
    .digest('hex');
}

function safeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function authorizeTelegramWebhookRequest({
  headerValue,
  botToken = process.env.BOT_TOKEN,
}) {
  const expectedSecret = getTelegramWebhookSecret(botToken);
  if (!expectedSecret) {
    return {
      ok: true,
      enforced: false,
      statusCode: 200,
    };
  }

  if (!headerValue) {
    return {
      ok: false,
      enforced: true,
      statusCode: 401,
    };
  }

  if (!safeEqualString(String(headerValue), expectedSecret)) {
    return {
      ok: false,
      enforced: true,
      statusCode: 403,
    };
  }

  return {
    ok: true,
    enforced: true,
    statusCode: 200,
  };
}

module.exports = {
  getTelegramWebhookSecret,
  authorizeTelegramWebhookRequest,
};
