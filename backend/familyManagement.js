'use strict';

const FAMILY_RENAME_COST = 300;

class FamilyManagementError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'FamilyManagementError';
    this.statusCode = statusCode;
  }
}

function actorFamily(db, actorUserId) {
  return db.prepare(`
    SELECT f.*
    FROM families f
    JOIN family_members fm ON fm.family_id = f.id
    WHERE fm.user_id = ?
  `).get(actorUserId);
}

function requireFounder(db, actorUserId) {
  const family = actorFamily(db, actorUserId);
  if (!family) throw new FamilyManagementError('You are not in a family', 400);
  if (Number(family.founder_id) !== Number(actorUserId)) {
    throw new FamilyManagementError('Only the family founder can manage the family', 403);
  }
  return family;
}

function normalizeFamilyName(value) {
  if (typeof value !== 'string') {
    throw new FamilyManagementError('Family name must be 2-24 characters');
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 24) {
    throw new FamilyManagementError('Family name must be 2-24 characters');
  }
  return name;
}

function renameFamily(db, { actorUserId, name, cost = FAMILY_RENAME_COST }) {
  const normalizedName = normalizeFamilyName(name);
  const family = requireFounder(db, actorUserId);
  if (family.name === normalizedName) {
    throw new FamilyManagementError('Choose a different family name');
  }

  return db.transaction(() => {
    const charged = db.prepare(`
      UPDATE users
      SET coins = coins - ?
      WHERE id = ? AND coins >= ?
    `).run(cost, actorUserId, cost);
    if (charged.changes !== 1) {
      throw new FamilyManagementError(`Not enough coins! Renaming costs ${cost} coins`);
    }

    const renamed = db.prepare(`
      UPDATE families
      SET name = ?
      WHERE id = ? AND founder_id = ?
    `).run(normalizedName, family.id, actorUserId);
    if (renamed.changes !== 1) {
      throw new FamilyManagementError('Family ownership changed. Refresh and try again.', 409);
    }

    return {
      family: db.prepare('SELECT * FROM families WHERE id = ?').get(family.id),
      coins: db.prepare('SELECT coins FROM users WHERE id = ?').pluck().get(actorUserId),
    };
  })();
}

function transferFamilyOwnership(db, { actorUserId, targetUserId }) {
  const family = requireFounder(db, actorUserId);
  const targetId = Number(targetUserId);
  if (!Number.isInteger(targetId) || targetId <= 0 || targetId === Number(actorUserId)) {
    throw new FamilyManagementError('Choose another family member');
  }

  const target = db.prepare(`
    SELECT u.id, u.first_name, u.username
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    WHERE fm.family_id = ? AND fm.user_id = ?
  `).get(family.id, targetId);
  if (!target) throw new FamilyManagementError('User is not in your family', 404);

  const changed = db.prepare(`
    UPDATE families
    SET founder_id = ?
    WHERE id = ? AND founder_id = ?
  `).run(targetId, family.id, actorUserId);
  if (changed.changes !== 1) {
    throw new FamilyManagementError('Family ownership changed. Refresh and try again.', 409);
  }

  return {
    family: db.prepare('SELECT * FROM families WHERE id = ?').get(family.id),
    newFounder: target,
  };
}

function removeFamilyMember(db, { actorUserId, targetUserId }) {
  const family = requireFounder(db, actorUserId);
  const targetId = Number(targetUserId);
  if (!Number.isInteger(targetId) || targetId <= 0 || targetId === Number(actorUserId)) {
    throw new FamilyManagementError('Choose another family member');
  }

  const removed = db.prepare(`
    DELETE FROM family_members
    WHERE family_id = ? AND user_id = ?
  `).run(family.id, targetId);
  if (removed.changes !== 1) {
    throw new FamilyManagementError('User is not in your family', 404);
  }

  return { removedUserId: targetId };
}

module.exports = {
  FAMILY_RENAME_COST,
  FamilyManagementError,
  normalizeFamilyName,
  removeFamilyMember,
  renameFamily,
  transferFamilyOwnership,
};
