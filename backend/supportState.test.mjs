import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const support = require('./supportState.js');

test('support donation amounts are fixed Telegram Stars values', () => {
  assert.deepEqual(support.SUPPORT_STAR_AMOUNTS, [50, 100, 250, 500]);
  assert.equal(support.normalizeSupportStars(50), 50);
  assert.equal(support.normalizeSupportStars('250'), 250);
  assert.throws(() => support.normalizeSupportStars(10), /Unsupported/);
  assert.throws(() => support.normalizeSupportStars('abc'), /Unsupported/);
});

test('support payment payload is tied to one user and parses safely', () => {
  const payload = support.buildSupportPayload(42, 100, 'abc123');
  assert.equal(payload, 'support:42:100:abc123');
  assert.deepEqual(support.parseSupportPayload(payload), {
    userId: 42,
    stars: 100,
    nonce: 'abc123',
  });
  assert.equal(support.parseSupportPayload('gift:42:100:abc123'), null);
  assert.equal(support.parseSupportPayload('support:nope:100:abc123'), null);
  assert.equal(support.parseSupportPayload('support:42:10:abc123'), null);
});

test('recordSupportDonation is idempotent by Telegram charge id', () => {
  const statements = new Map();
  const user = { supporter_since: null, supporter_stars: 0 };
  const donations = [];
  const fakeDb = {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT id FROM support_donations')) {
        return { get: (chargeId) => donations.find((row) => row.telegram_payment_charge_id === chargeId) || null };
      }
      if (normalized.startsWith('INSERT INTO support_donations')) {
        return {
          run: (userId, chargeId, providerChargeId, stars, payload, createdAt) => {
            donations.push({
              id: donations.length + 1,
              user_id: userId,
              telegram_payment_charge_id: chargeId,
              provider_payment_charge_id: providerChargeId,
              stars_amount: stars,
              payload,
              created_at: createdAt,
            });
            return { changes: 1 };
          },
        };
      }
      if (normalized.startsWith('UPDATE users SET supporter_since')) {
        return {
          run: (createdAt, stars, userId) => {
            user.supporter_since = user.supporter_since || createdAt;
            user.supporter_stars += stars;
            user.updated_user_id = userId;
            return { changes: 1 };
          },
        };
      }
      statements.set(normalized, true);
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };

  const first = support.recordSupportDonation(fakeDb, {
    userId: 7,
    telegramPaymentChargeId: 'tg-charge',
    providerPaymentChargeId: '',
    stars: 100,
    payload: 'support:7:100:n1',
    createdAt: 1234,
  });
  const second = support.recordSupportDonation(fakeDb, {
    userId: 7,
    telegramPaymentChargeId: 'tg-charge',
    providerPaymentChargeId: '',
    stars: 100,
    payload: 'support:7:100:n1',
    createdAt: 1235,
  });

  assert.equal(first.recorded, true);
  assert.equal(second.recorded, false);
  assert.equal(donations.length, 1);
  assert.equal(user.supporter_since, 1234);
  assert.equal(user.supporter_stars, 100);
  assert.equal(user.updated_user_id, 7);
});
