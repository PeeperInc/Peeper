'use strict';

const { enqueueMemberEvent } = require('./memberEvents');

const ROLE_EFFECT_TYPES = Object.freeze({
  knight: 'knight_shield',
  mage: 'bend_fate',
});

const ROLE_EFFECT_EVENTS = Object.freeze({
  knight_shield: 'shield_blocked',
  bend_fate: 'mage_advantage',
});

const MAX_ROLE_CHARGE = 1;
const DEFAULT_RECHARGE_THRESHOLD = 3;
const CLERIC_RECOVERY_REDUCTION_SECONDS = 2 * 60 * 60;

function parseJson(text, fallback = {}) {
  if (!text) return JSON.parse(JSON.stringify(fallback));
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(JSON.stringify(fallback));
  }
}

function normalizeCharge(value) {
  return Math.max(0, Math.min(MAX_ROLE_CHARGE, Math.floor(Number(value) || 0)));
}

function advanceRoleCharge(member = {}, apSpent = 1, threshold = DEFAULT_RECHARGE_THRESHOLD) {
  const rechargeThreshold = Math.max(1, Math.floor(Number(threshold) || DEFAULT_RECHARGE_THRESHOLD));
  const roleCharge = normalizeCharge(member.roleCharge ?? member.role_charge);
  if (roleCharge >= MAX_ROLE_CHARGE) {
    return { roleCharge: MAX_ROLE_CHARGE, roleChargeProgress: 0 };
  }
  const currentProgress = Math.max(0, Math.floor(Number(
    member.roleChargeProgress ?? member.role_charge_progress,
  ) || 0));
  const nextProgress = currentProgress + Math.max(0, Math.floor(Number(apSpent) || 0));
  if (nextProgress >= rechargeThreshold) {
    return { roleCharge: MAX_ROLE_CHARGE, roleChargeProgress: 0 };
  }
  return { roleCharge: 0, roleChargeProgress: nextProgress };
}

function memberChargeRow(transaction, expeditionId, userId) {
  const row = transaction.prepare(`
    SELECT role, role_charge AS roleCharge, role_charge_progress AS roleChargeProgress
    FROM family_expedition_members
    WHERE expedition_id = ? AND user_id = ?
  `).get(expeditionId, userId);
  if (!row) throw new RangeError('member is not prepared');
  return row;
}

function consumeRoleCharge(transaction, { expeditionId, userId, expectedRole = null }) {
  const member = memberChargeRow(transaction, expeditionId, userId);
  if (expectedRole && member.role !== expectedRole) {
    throw new RangeError(`only ${expectedRole}s can use this ability`);
  }
  if (normalizeCharge(member.roleCharge) < 1) {
    throw new RangeError('role ability is not charged');
  }
  transaction.prepare(`
    UPDATE family_expedition_members
    SET role_charge = 0, role_charge_progress = 0
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, userId);
  return { roleCharge: 0, roleChargeProgress: 0 };
}

function ownerFromRow(row) {
  return {
    userId: row.placed_by,
    firstName: row.first_name,
    username: row.username || null,
  };
}

function effectFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    expeditionId: row.expedition_id,
    roomId: row.room_id,
    effectType: row.effect_type,
    placedBy: ownerFromRow(row),
    remainingUses: row.remaining_uses,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function effectSelectSql(extraWhere = '') {
  return `
    SELECT effects.*, users.first_name, users.username
    FROM family_expedition_room_effects effects
    JOIN users ON users.id = effects.placed_by
    WHERE effects.consumed_at IS NULL ${extraWhere}
  `;
}

function isMissingRoleEffectTable(error) {
  return error?.code === 'SQLITE_ERROR'
    && /no such table: family_expedition_room_effects/i.test(error.message || '');
}

function listActiveRoomEffects(transaction, { expeditionId, roomId = null }) {
  const roomFilter = roomId === null
    ? 'AND effects.expedition_id = ?'
    : 'AND effects.expedition_id = ? AND effects.room_id = ?';
  let rows;
  try {
    const statement = transaction.prepare(`${effectSelectSql(roomFilter)} ORDER BY effects.id`);
    rows = roomId === null
      ? statement.all(expeditionId)
      : statement.all(expeditionId, roomId);
  } catch (error) {
    if (isMissingRoleEffectTable(error)) return [];
    throw error;
  }
  return rows.map(effectFromRow);
}

function placeRoleEffect(transaction, {
  expeditionId,
  roomId,
  userId,
  role,
  now = Math.floor(Date.now() / 1000),
  payload = {},
}) {
  const effectType = ROLE_EFFECT_TYPES[role];
  if (!effectType) throw new RangeError('role does not place a room effect');
  const duplicate = transaction.prepare(`
    SELECT id
    FROM family_expedition_room_effects
    WHERE expedition_id = ? AND room_id = ? AND effect_type = ? AND consumed_at IS NULL
  `).get(expeditionId, roomId, effectType);
  if (duplicate) throw new RangeError(`${effectType} is already active in this room`);

  consumeRoleCharge(transaction, { expeditionId, userId, expectedRole: role });
  const info = transaction.prepare(`
    INSERT INTO family_expedition_room_effects (
      expedition_id, room_id, effect_type, placed_by, remaining_uses, payload_json, created_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(expeditionId, roomId, effectType, userId, JSON.stringify(payload || {}), now);
  const row = transaction.prepare(`${effectSelectSql('AND effects.id = ?')}`).get(info.lastInsertRowid);
  return effectFromRow(row);
}

function consumeRoomEffect(transaction, {
  expeditionId,
  roomId,
  effectType,
  now = Math.floor(Date.now() / 1000),
}) {
  let row;
  try {
    row = transaction.prepare(`${effectSelectSql(`
      AND effects.expedition_id = ?
      AND effects.room_id = ?
      AND effects.effect_type = ?
    `)} ORDER BY effects.id LIMIT 1`).get(expeditionId, roomId, effectType);
  } catch (error) {
    if (isMissingRoleEffectTable(error)) return null;
    throw error;
  }
  if (!row) return null;

  const remainingUses = Math.max(0, Number(row.remaining_uses || 0) - 1);
  transaction.prepare(`
    UPDATE family_expedition_room_effects
    SET remaining_uses = ?, consumed_at = CASE WHEN ? <= 0 THEN ? ELSE consumed_at END
    WHERE id = ? AND consumed_at IS NULL
  `).run(remainingUses, remainingUses, now, row.id);
  const effect = effectFromRow(row);
  const baseEvent = {
    type: ROLE_EFFECT_EVENTS[effectType] || 'room_effect_consumed',
    effectId: effect.id,
    placedBy: effect.placedBy,
  };
  return {
    effect,
    event: effectType === ROLE_EFFECT_TYPES.knight
      ? { ...baseEvent, preventedDamage: 1 }
      : baseEvent,
  };
}

function resolveMageRoll(transaction, {
  expeditionId,
  roomId,
  rolls,
  now = Math.floor(Date.now() / 1000),
}) {
  if (!Array.isArray(rolls) || rolls.length !== 2 || rolls.some(roll => !Number.isInteger(roll))) {
    throw new TypeError('Mage advantage requires two integer rolls');
  }
  const consumed = consumeRoomEffect(transaction, {
    expeditionId,
    roomId,
    effectType: ROLE_EFFECT_TYPES.mage,
    now,
  });
  if (!consumed) return null;
  const chosen = Math.max(...rolls);
  return {
    effect: consumed.effect,
    chosen,
    event: {
      ...consumed.event,
      rolls: [...rolls],
      chosen,
    },
  };
}

function consumeMageRetry(transaction, {
  expeditionId,
  roomId,
  now = Math.floor(Date.now() / 1000),
}) {
  const consumed = consumeRoomEffect(transaction, {
    expeditionId,
    roomId,
    effectType: ROLE_EFFECT_TYPES.mage,
    now,
  });
  if (!consumed) return null;
  return {
    effect: consumed.effect,
    event: {
      ...consumed.event,
      type: 'mage_retry',
      retryWithoutAp: true,
      preventedDamage: 1,
    },
  };
}

function useClericPrayer(transaction, {
  expeditionId,
  userId,
  now = Math.floor(Date.now() / 1000),
}) {
  consumeRoleCharge(transaction, { expeditionId, userId, expectedRole: 'cleric' });
  const owner = transaction.prepare(`
    SELECT id AS userId, first_name AS firstName, username
    FROM users WHERE id = ?
  `).get(userId);
  const members = transaction.prepare(`
    SELECT user_id AS userId, hero_hp AS heroHp, hero_recover_at AS heroRecoverAt
    FROM family_expedition_members
    WHERE expedition_id = ?
    ORDER BY user_id
  `).all(expeditionId);
  let healedCount = 0;
  let recoveryReducedCount = 0;

  for (const member of members) {
    if (member.heroRecoverAt) {
      const nextRecoverAt = Math.max(now, member.heroRecoverAt - CLERIC_RECOVERY_REDUCTION_SECONDS);
      const revived = nextRecoverAt <= now;
      transaction.prepare(`
        UPDATE family_expedition_members
        SET hero_hp = ?, hero_recover_at = ?
        WHERE expedition_id = ? AND user_id = ?
      `).run(revived ? 3 : member.heroHp, revived ? null : nextRecoverAt, expeditionId, member.userId);
      const event = {
        type: 'cleric_recovery_reduced',
        placedBy: owner,
        amountSeconds: CLERIC_RECOVERY_REDUCTION_SECONDS,
        heroHp: revived ? 3 : member.heroHp,
        heroRecoverAt: revived ? null : nextRecoverAt,
        revived,
      };
      enqueueMemberEvent(transaction, {
        expeditionId,
        userId: member.userId,
        eventType: event.type,
        payload: event,
        now,
      });
      recoveryReducedCount += 1;
      continue;
    }
    if (member.heroHp <= 0 || member.heroHp >= 3) continue;
    const heroHp = Math.min(3, member.heroHp + 1);
    transaction.prepare(`
      UPDATE family_expedition_members SET hero_hp = ?
      WHERE expedition_id = ? AND user_id = ?
    `).run(heroHp, expeditionId, member.userId);
    const event = { type: 'cleric_heal', placedBy: owner, amount: 1, heroHp };
    enqueueMemberEvent(transaction, {
      expeditionId,
      userId: member.userId,
      eventType: event.type,
      payload: event,
      now,
    });
    healedCount += 1;
  }
  return {
    events: [{
      type: 'cleric_prayer',
      placedBy: owner,
      healedCount,
      recoveryReducedCount,
    }],
  };
}

module.exports = {
  ROLE_EFFECT_TYPES,
  advanceRoleCharge,
  consumeRoleCharge,
  consumeMageRetry,
  consumeRoomEffect,
  listActiveRoomEffects,
  placeRoleEffect,
  resolveMageRoll,
  useClericPrayer,
};
