'use strict';

const MAX_EVENT_IDS = 100;
const MAX_EVENT_TYPE_LENGTH = 64;

function positiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return value;
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : undefined;
}

function safeActor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const actor = {};
  if (Number.isInteger(value.userId) && value.userId > 0) actor.userId = value.userId;
  if (typeof value.firstName === 'string') actor.firstName = value.firstName.slice(0, 128);
  if (typeof value.username === 'string') actor.username = value.username.slice(0, 64);
  else if (value.username === null) actor.username = null;
  return Object.keys(actor).length > 0 ? actor : undefined;
}

function sanitizeMemberEventPayload(payload, eventType = null) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const sanitized = {};
  const type = eventType || (typeof source.type === 'string' ? source.type : null);
  if (typeof type === 'string' && type.length > 0) sanitized.type = type.slice(0, MAX_EVENT_TYPE_LENGTH);

  const placedBy = safeActor(source.placedBy);
  if (placedBy) sanitized.placedBy = placedBy;

  for (const key of ['amount', 'amountSeconds', 'heroHp', 'heroRecoverAt', 'preventedDamage']) {
    const value = safeNumber(source[key]);
    if (value !== undefined) sanitized[key] = value;
  }
  if (source.heroRecoverAt === null) sanitized.heroRecoverAt = null;
  if (typeof source.revived === 'boolean') sanitized.revived = source.revived;
  return sanitized;
}

function normalizeEventType(eventType) {
  if (typeof eventType !== 'string' || eventType.trim().length === 0) {
    throw new TypeError('eventType must be a non-empty string');
  }
  const normalized = eventType.trim();
  if (normalized.length > MAX_EVENT_TYPE_LENGTH) {
    throw new RangeError(`eventType must be at most ${MAX_EVENT_TYPE_LENGTH} characters`);
  }
  return normalized;
}

function normalizeEventIds(eventIds) {
  if (!Array.isArray(eventIds) || eventIds.length === 0 || eventIds.length > MAX_EVENT_IDS) {
    throw new TypeError(`eventIds must be a non-empty array of at most ${MAX_EVENT_IDS} ids`);
  }
  const normalized = eventIds.map(eventId => positiveInteger(eventId, 'eventIds'));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError('eventIds must not contain duplicates');
  }
  return normalized;
}

function eventFromRow(row) {
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json || '{}');
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    expeditionId: row.expedition_id,
    eventType: row.event_type,
    payload: sanitizeMemberEventPayload(payload, row.event_type),
    createdAt: row.created_at,
  };
}

function enqueueMemberEvent(transaction, {
  expeditionId,
  userId,
  eventType,
  payload = {},
  now = Math.floor(Date.now() / 1000),
}) {
  positiveInteger(expeditionId, 'expeditionId');
  positiveInteger(userId, 'userId');
  const normalizedType = normalizeEventType(eventType);
  const sanitizedPayload = sanitizeMemberEventPayload(payload, normalizedType);
  const info = transaction.prepare(`
    INSERT INTO family_expedition_member_events (
      expedition_id, user_id, event_type, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(expeditionId, userId, normalizedType, JSON.stringify(sanitizedPayload), now);
  const row = transaction.prepare(`
    SELECT id, expedition_id, event_type, payload_json, created_at
    FROM family_expedition_member_events
    WHERE id = ?
  `).get(info.lastInsertRowid);
  return eventFromRow(row);
}

function listPendingMemberEvents(transaction, { expeditionId = null, userId }) {
  if (expeditionId !== null) positiveInteger(expeditionId, 'expeditionId');
  positiveInteger(userId, 'userId');
  const expeditionFilter = expeditionId === null ? '' : 'AND expedition_id = ?';
  const statement = transaction.prepare(`
    SELECT id, expedition_id, event_type, payload_json, created_at
    FROM family_expedition_member_events
    WHERE user_id = ? ${expeditionFilter} AND acknowledged_at IS NULL
    ORDER BY id
  `);
  const rows = expeditionId === null
    ? statement.all(userId)
    : statement.all(userId, expeditionId);
  return rows.map(eventFromRow);
}

function acknowledgeMemberEvents(transaction, {
  userId,
  eventIds,
  now = Math.floor(Date.now() / 1000),
}) {
  positiveInteger(userId, 'userId');
  const normalizedIds = normalizeEventIds(eventIds);
  const placeholders = normalizedIds.map(() => '?').join(', ');
  const ownedIds = transaction.prepare(`
    SELECT id
    FROM family_expedition_member_events
    WHERE user_id = ? AND id IN (${placeholders})
    ORDER BY id
  `).all(userId, ...normalizedIds).map(row => row.id);

  if (ownedIds.length > 0) {
    const ownedPlaceholders = ownedIds.map(() => '?').join(', ');
    transaction.prepare(`
      UPDATE family_expedition_member_events
      SET acknowledged_at = COALESCE(acknowledged_at, ?)
      WHERE user_id = ? AND id IN (${ownedPlaceholders})
    `).run(now, userId, ...ownedIds);
  }
  return { acknowledgedEventIds: ownedIds };
}

module.exports = {
  acknowledgeMemberEvents,
  enqueueMemberEvent,
  listPendingMemberEvents,
  sanitizeMemberEventPayload,
};
