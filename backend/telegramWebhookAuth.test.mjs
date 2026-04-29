import test from 'node:test';
import assert from 'node:assert/strict';

import telegramWebhookAuthModule from './telegramWebhookAuth.js';

const {
  authorizeTelegramWebhookRequest,
  getTelegramWebhookSecret,
} = telegramWebhookAuthModule;

test('valid webhook secret header is accepted', () => {
  const botToken = '123456:abc';
  const secret = getTelegramWebhookSecret(botToken);

  const result = authorizeTelegramWebhookRequest({
    headerValue: secret,
    botToken,
  });

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.enforced, true);
});

test('missing webhook secret header is rejected in production mode', () => {
  const result = authorizeTelegramWebhookRequest({
    headerValue: '',
    botToken: '123456:abc',
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 401);
  assert.equal(result.enforced, true);
});

test('wrong webhook secret header is rejected in production mode', () => {
  const result = authorizeTelegramWebhookRequest({
    headerValue: 'wrong-secret',
    botToken: '123456:abc',
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.enforced, true);
});

test('dev mode bypasses webhook secret enforcement', () => {
  const result = authorizeTelegramWebhookRequest({
    headerValue: '',
    botToken: 'dev',
  });

  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.enforced, false);
});
