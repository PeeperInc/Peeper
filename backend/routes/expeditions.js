'use strict';

const express = require('express');
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const {
  createExpedition,
  prepareMember,
  attemptRoom,
  assistRoom,
  revealRoom,
  equipFoundArtifactForMember,
  finishExpedition,
} = require('../expeditions/engine');
const { THEME_ID } = require('../expeditions/catalog');
const { generateExpeditionMap } = require('../expeditions/generator');
const { serializeExpeditionState } = require('../expeditions/serializer');

const router = express.Router();

function parseJson(text, fallback) {
  if (!text) return JSON.parse(JSON.stringify(fallback));
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(JSON.stringify(fallback));
  }
}

function rowToExpedition(row) {
  if (!row) return null;
  return {
    id: row.id,
    familyId: row.family_id,
    themeId: row.theme_id,
    seed: row.seed,
    status: row.status,
    map: parseJson(row.map_json, {}),
    sharedBuffs: parseJson(row.shared_buffs_json, {}),
    startedBy: row.started_by,
    startedAt: row.started_at,
    bossDefeatedAt: row.boss_defeated_at,
    finishedAt: row.finished_at,
  };
}

function rowToRoom(row) {
  const payload = parseJson(row.payload_json, {});
  return {
    ...payload,
    id: row.id,
    key: row.room_key,
    type: row.room_type,
    state: row.state,
    progress: row.progress,
    progressTarget: row.progress_target,
    support: row.support,
    unlockedAt: row.unlocked_at,
    clearedAt: row.cleared_at,
  };
}

function normalizeLoadout(loadout = []) {
  const normalized = Array.isArray(loadout) ? loadout.slice(0, 3) : [];
  while (normalized.length < 3) normalized.push(null);
  return normalized;
}

function parseLoadoutState(text) {
  const parsed = parseJson(text, []);
  if (Array.isArray(parsed)) return { slots: normalizeLoadout(parsed), triggerHistory: [] };
  if (parsed && typeof parsed === 'object') {
    return {
      slots: normalizeLoadout(parsed.slots || parsed.loadout || []),
      triggerHistory: parsed.triggerHistory || [],
    };
  }
  return { slots: normalizeLoadout([]), triggerHistory: [] };
}

function rowToMember(row) {
  const loadoutState = parseLoadoutState(row.loadout_json);
  const debuff = parseJson(row.debuff_json, null);
  return {
    expeditionId: row.expedition_id,
    userId: row.user_id,
    role: row.role,
    ap: row.ap,
    apRegenDay: row.ap_regen_day,
    roleAbilityDay: row.role_ability_day,
    roleAbilityUsed: Boolean(row.role_ability_used),
    provisionId: row.provision_id,
    provisionState: parseJson(row.provision_state_json, {}),
    loadout: loadoutState.slots,
    triggerHistory: loadoutState.triggerHistory,
    debuff: debuff && Object.keys(debuff).length > 0 ? debuff : null,
    contributionAp: row.contribution_ap,
    contributionProgress: row.contribution_progress,
    preparedAt: row.prepared_at,
    bossRewardClaimedAt: row.boss_reward_claimed_at,
  };
}

function rowToAction(row) {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    expeditionId: row.expedition_id,
    roomId: row.room_id,
    userId: row.user_id,
    actionType: row.action_type,
    stat: row.stat,
    rawRoll: row.raw_roll,
    modifiers: parseJson(row.modifier_json, {}),
    modifiedRoll: row.modified_roll,
    progressAwarded: row.progress_awarded,
    loot: parseJson(row.loot_json, {}),
    narrationKey: row.narration_key,
    createdAt: row.created_at,
  };
}

function readSnapshot(expeditionId) {
  const expedition = rowToExpedition(db.prepare(`
    SELECT * FROM family_expeditions WHERE id = ?
  `).get(expeditionId));
  if (!expedition) return null;
  const rooms = db.prepare(`
    SELECT * FROM family_expedition_rooms WHERE expedition_id = ? ORDER BY id
  `).all(expeditionId).map(rowToRoom);
  const members = db.prepare(`
    SELECT * FROM family_expedition_members WHERE expedition_id = ? ORDER BY user_id
  `).all(expeditionId).map(rowToMember);
  const actions = db.prepare(`
    SELECT * FROM family_expedition_actions WHERE expedition_id = ? ORDER BY id
  `).all(expeditionId).map(rowToAction);
  return { expedition, rooms, members, actions };
}

function getUser(req) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(req.telegramUser.id));
}

function getCurrentFamily(userId) {
  return db.prepare(`
    SELECT f.*
    FROM families f
    JOIN family_members fm ON fm.family_id = f.id
    WHERE fm.user_id = ?
  `).get(userId);
}

function getFamilyMembers(familyId) {
  return db.prepare(`
    SELECT
      u.id AS userId,
      u.first_name AS firstName,
      u.username,
      u.photo_url AS photoUrl
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    WHERE fm.family_id = ?
    ORDER BY fm.joined_at ASC, u.id ASC
  `).all(familyId);
}

function getArtifactInventory(userId) {
  return db.prepare(`
    SELECT artifact_id AS artifactId, quantity, charges
    FROM expedition_artifact_inventory
    WHERE user_id = ?
    ORDER BY artifact_id ASC
  `).all(userId);
}

function getUnfinishedExpedition(familyId) {
  return rowToExpedition(db.prepare(`
    SELECT * FROM family_expeditions
    WHERE family_id = ? AND status != 'finished'
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).get(familyId));
}

function existingIdempotentAction(userId, idempotencyKey) {
  if (!idempotencyKey) return null;
  return db.prepare(`
    SELECT expedition_id AS expeditionId, action_type AS actionType
    FROM family_expedition_actions
    WHERE user_id = ? AND idempotency_key = ?
  `).get(userId, idempotencyKey);
}

function serializeFor(user, family, snapshot, canStart = false) {
  return serializeExpeditionState({
    userId: user.id,
    snapshot,
    familyMembers: family ? getFamilyMembers(family.id) : [],
    artifactInventory: getArtifactInventory(user.id),
    canStart,
  });
}

function requireIdempotencyKey(req, res) {
  const idempotencyKey = req.body?.idempotencyKey;
  if (!idempotencyKey) {
    res.status(400).json({ error: 'idempotencyKey is required' });
    return null;
  }
  return String(idempotencyKey);
}

function requireExpeditionAccess(req, res) {
  const expeditionId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(expeditionId)) {
    res.status(400).json({ error: 'Invalid expedition id' });
    return null;
  }
  const expedition = rowToExpedition(db.prepare('SELECT * FROM family_expeditions WHERE id = ?').get(expeditionId));
  if (!expedition) {
    res.status(404).json({ error: 'Expedition not found' });
    return null;
  }
  const currentFamily = getCurrentFamily(req.currentUser.id);
  if (!currentFamily || currentFamily.id !== expedition.familyId) {
    res.status(403).json({ error: 'You are not a current family member for this expedition' });
    return null;
  }
  return { expeditionId, expedition, family: currentFamily };
}

function roomState(expeditionId, roomKey) {
  return db.prepare(`
    SELECT state FROM family_expedition_rooms
    WHERE expedition_id = ? AND room_key = ?
  `).get(expeditionId, roomKey)?.state || null;
}

function handleRouteError(res, error) {
  const message = error?.message || 'Expedition action failed';
  if (/room is already cleared/i.test(message)) {
    return res.status(409).json({ error: 'Room already cleared' });
  }
  if (/idempotency conflict/i.test(message)) {
    return res.status(409).json({ error: message });
  }
  if (error instanceof RangeError || error instanceof TypeError) {
    return res.status(400).json({ error: message });
  }
  console.error('[expeditions] route error:', error);
  return res.status(500).json({ error: 'Internal server error' });
}

router.use(validateTelegramInit);
router.use((req, res, next) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  req.currentUser = user;
  return next();
});

router.get('/current', (req, res) => {
  const family = getCurrentFamily(req.currentUser.id);
  if (!family) return res.json(serializeFor(req.currentUser, null, null, false));
  const active = getUnfinishedExpedition(family.id);
  const snapshot = active ? readSnapshot(active.id) : null;
  return res.json(serializeFor(req.currentUser, family, snapshot, !active));
});

router.post('/start', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const family = getCurrentFamily(req.currentUser.id);
  if (!family) return res.status(403).json({ error: 'You are not in a family' });

  const seed = `family:${family.id}:start:${idempotencyKey}`;
  const map = generateExpeditionMap(seed);

  try {
    const snapshot = db.transaction(() => {
      const replay = existingIdempotentAction(req.currentUser.id, idempotencyKey);
      if (!replay) {
        const active = getUnfinishedExpedition(family.id);
        if (active) {
          const error = new Error('Family already has an unfinished expedition');
          error.statusCode = 409;
          throw error;
        }
      }
      return createExpedition({
        transaction: db,
        idempotencyKey,
        familyId: family.id,
        userId: req.currentUser.id,
        startedBy: req.currentUser.id,
        themeId: THEME_ID,
        seed,
        map,
      });
    })();
    return res.json(serializeFor(req.currentUser, family, snapshot, false));
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({ error: error.message });
    }
    return handleRouteError(res, error);
  }
});

router.post('/:id/prepare', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;

  try {
    const snapshot = db.transaction(() => prepareMember({
      transaction: db,
      idempotencyKey,
      expeditionId: access.expeditionId,
      userId: req.currentUser.id,
      role: req.body?.role,
      provisionId: req.body?.provisionId || null,
      artifactIds: Array.isArray(req.body?.artifactIds) ? req.body.artifactIds : [],
    }))();
    return res.json(serializeFor(req.currentUser, access.family, snapshot, false));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post('/:id/rooms/:roomKey/attempt', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;
  if (roomState(access.expeditionId, req.params.roomKey) === 'cleared') {
    const replay = existingIdempotentAction(req.currentUser.id, idempotencyKey);
    if (!replay) return res.status(409).json({ error: 'Room already cleared' });
  }

  try {
    const snapshot = db.transaction(() => attemptRoom({
      transaction: db,
      idempotencyKey,
      expeditionId: access.expeditionId,
      userId: req.currentUser.id,
      roomKey: req.params.roomKey,
      actionId: req.body?.actionId,
      selectedSupport: req.body?.selectedSupport ?? 0,
      roll: req.body?.roll,
      reroll: req.body?.reroll,
      useRoleAbility: Boolean(req.body?.useRoleAbility),
      useSharedBuff: Boolean(req.body?.useSharedBuff),
    }))();
    return res.json(serializeFor(req.currentUser, access.family, snapshot, false));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post('/:id/rooms/:roomKey/assist', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;
  if (roomState(access.expeditionId, req.params.roomKey) === 'cleared') {
    const replay = existingIdempotentAction(req.currentUser.id, idempotencyKey);
    if (!replay) return res.status(409).json({ error: 'Room already cleared' });
  }

  try {
    const snapshot = db.transaction(() => assistRoom({
      transaction: db,
      idempotencyKey,
      expeditionId: access.expeditionId,
      userId: req.currentUser.id,
      roomKey: req.params.roomKey,
    }))();
    return res.json(serializeFor(req.currentUser, access.family, snapshot, false));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post('/:id/rooms/:roomKey/reveal', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;

  try {
    const snapshot = db.transaction(() => revealRoom({
      transaction: db,
      idempotencyKey,
      expeditionId: access.expeditionId,
      userId: req.currentUser.id,
      fromRoomKey: req.body?.fromRoomKey,
      roomKey: req.params.roomKey,
    }))();
    return res.json(serializeFor(req.currentUser, access.family, snapshot, false));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post('/:id/equip-found-artifact', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;

  try {
    const snapshot = db.transaction(() => equipFoundArtifactForMember({
      transaction: db,
      idempotencyKey,
      expeditionId: access.expeditionId,
      userId: req.currentUser.id,
      artifactId: req.body?.artifactId,
      slotIndex: req.body?.slotIndex,
    }))();
    return res.json(serializeFor(req.currentUser, access.family, snapshot, false));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post('/:id/finish', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;

  try {
    const snapshot = db.transaction(() => finishExpedition({
      transaction: db,
      idempotencyKey,
      expeditionId: access.expeditionId,
      userId: req.currentUser.id,
    }))();
    return res.json(serializeFor(req.currentUser, access.family, snapshot, false));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.get('/:id/log', (req, res) => {
  const access = requireExpeditionAccess(req, res);
  if (!access) return;
  const snapshot = readSnapshot(access.expeditionId);
  return res.json({ recentActions: serializeFor(req.currentUser, access.family, snapshot, false).recentActions });
});

router.get('/history', (req, res) => {
  const family = getCurrentFamily(req.currentUser.id);
  if (!family) return res.status(403).json({ error: 'You are not in a family' });
  const history = db.prepare(`
    SELECT id, expedition_id AS expeditionId, family_id AS familyId, summary_json AS summaryJson, finished_at AS finishedAt
    FROM family_expedition_history
    WHERE family_id = ?
    ORDER BY finished_at DESC, id DESC
    LIMIT 20
  `).all(family.id).map(row => ({
    id: row.id,
    expeditionId: row.expeditionId,
    familyId: row.familyId,
    summary: parseJson(row.summaryJson, {}),
    finishedAt: row.finishedAt,
  }));
  return res.json({ history });
});

router.get('/artifacts', (req, res) => {
  return res.json({ artifactInventory: getArtifactInventory(req.currentUser.id) });
});

module.exports = router;
