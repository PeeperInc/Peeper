import test from 'node:test';
import assert from 'node:assert/strict';

import blackjackInviteModule from './blackjackInviteUtils.js';

const { createBlackjackInviteToken, validateBlackjackInviteForUser } = blackjackInviteModule;

test('invite token is compact and URL-safe', () => {
  const token = createBlackjackInviteToken();

  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(token.length >= 20);
});

test('pending invite can only be used by its invitee', () => {
  const invite = { invitee_id: 10, status: 'pending' };

  assert.equal(validateBlackjackInviteForUser(invite, 10).ok, true);
  assert.equal(validateBlackjackInviteForUser(invite, 11).ok, false);
});

test('used invite is rejected', () => {
  const invite = { invitee_id: 10, status: 'used' };

  assert.equal(validateBlackjackInviteForUser(invite, 10).ok, false);
}
);
