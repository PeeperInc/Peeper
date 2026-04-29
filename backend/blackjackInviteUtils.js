const crypto = require('crypto');

function createBlackjackInviteToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function validateBlackjackInviteForUser(invite, userId) {
  if (!invite) {
    return { ok: false, error: 'Invite not found.' };
  }

  if (invite.status !== 'pending') {
    return { ok: false, error: 'This invite is no longer active.' };
  }

  if (Number(invite.invitee_id) !== Number(userId)) {
    return { ok: false, error: 'This invite belongs to another player.' };
  }

  return { ok: true };
}

module.exports = {
  createBlackjackInviteToken,
  validateBlackjackInviteForUser,
};
