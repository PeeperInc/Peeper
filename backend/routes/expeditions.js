'use strict';

const crypto = require('node:crypto');
const express = require('express');
const db = require('../database');
const { validateTelegramInit } = require('../auth');
const {
  createExpedition,
  prepareMember,
  attemptRoom,
  assistRoom,
  chooseScoutRoom,
  expireStaleMinigameAttempt,
  readMinigameStartHttpReplay,
  persistMinigameHttpReplay,
  startMinigameAttempt,
  finishMinigameAttempt,
  useRoleAbility,
  useArtifactForMember,
  equipFoundArtifactForMember,
  finishExpedition,
  regenerateAp,
} = require('../expeditions/engine');
const { THEME_ID } = require('../expeditions/catalog');
const { generateExpeditionMap } = require('../expeditions/generator');
const {
  serializeExpeditionState,
  serializePendingReward,
} = require('../expeditions/serializer');
const { listActiveRoomEffects } = require('../expeditions/roleEffects');
const {
  isReservedIdempotencyKey,
  normalizeIdempotencyKey,
  readUserOpenAttempt,
} = require('../expeditions/minigameAttempts');
const {
  claimPendingReward,
  listPendingRewards,
} = require('../expeditions/rewards');
const {
  acknowledgeMemberEvents,
  listPendingMemberEvents,
} = require('../expeditions/memberEvents');

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
  const heroRecoverAt = row.hero_recover_at ?? null;
  const recovered = heroRecoverAt && heroRecoverAt <= Math.floor(Date.now() / 1000);
  const regeneratedAp = regenerateAp({
    ap: row.ap,
    apRegenDay: row.ap_regen_day,
    apRegenAt: row.ap_regen_at,
  });
  return {
    expeditionId: row.expedition_id,
    userId: row.user_id,
    role: row.role,
    ap: regeneratedAp.ap,
    apRegenDay: regeneratedAp.apRegenDay,
    apRegenAt: regeneratedAp.apRegenAt,
    heroHp: recovered ? 3 : row.hero_hp ?? 3,
    heroRecoverAt: recovered ? null : heroRecoverAt,
    roleAbilityDay: row.role_ability_day,
    roleAbilityUsed: Boolean(row.role_ability_used),
    roleCharge: row.role_charge ?? 1,
    roleChargeProgress: row.role_charge_progress ?? 0,
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
  const modifiers = parseJson(row.modifier_json, {});
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    expeditionId: row.expedition_id,
    roomId: row.room_id,
    userId: row.user_id,
    actionType: row.action_type,
    stat: row.stat,
    rawRoll: row.raw_roll,
    modifiers,
    events: modifiers.events || [],
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
  const roomEffects = listActiveRoomEffects(db, { expeditionId });
  return { expedition, rooms, members, actions, roomEffects, memberEvents: [] };
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

function getFarmInventory(userId) {
  return db.prepare(`
    SELECT product_id AS productId, quantity
    FROM farm_inventory
    WHERE user_id = ?
    ORDER BY product_id ASC
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
  const action = db.prepare(`
    SELECT expedition_id AS expeditionId, action_type AS actionType, modifier_json AS modifierJson
    FROM family_expedition_actions
    WHERE user_id = ? AND idempotency_key = ?
  `).get(userId, idempotencyKey);
  if (!action) return null;
  return {
    ...action,
    modifiers: parseJson(action.modifierJson, {}),
  };
}

function serializeFor(user, family, snapshot, canStart = false) {
  const memberEvents = listPendingMemberEvents(db, { userId: user.id });
  const openAttempt = snapshot?.expedition
    ? readUserOpenAttempt(db, { expeditionId: snapshot.expedition.id, userId: user.id })
    : null;
  const attemptRoom = openAttempt
    ? snapshot.rooms.find(room => room.id === openAttempt.roomId)
    : null;
  return serializeExpeditionState({
    userId: user.id,
    snapshot,
    memberEvents,
    familyMembers: family ? getFamilyMembers(family.id) : [],
    artifactInventory: getArtifactInventory(user.id),
    farmInventory: getFarmInventory(user.id),
    pendingRewards: listPendingRewards(db, { userId: user.id }),
    currentMinigameAttempt: openAttempt && attemptRoom
      ? { roomKey: attemptRoom.key, attempt: openAttempt.attempt }
      : null,
    canStart,
  });
}

function requireIdempotencyKey(req, res) {
  const idempotencyKey = req.body?.idempotencyKey;
  let normalized;
  try {
    normalized = normalizeIdempotencyKey(idempotencyKey);
  } catch (error) {
    res.status(400).json({ error: error.message });
    return null;
  }
  if (isReservedIdempotencyKey(normalized)) {
    res.status(400).json({ error: 'This idempotencyKey namespace is reserved' });
    return null;
  }
  return normalized;
}

function secureD20() {
  return 1 + crypto.randomInt(20);
}

function secureRng() {
  return crypto.randomInt(1_000_000) / 1_000_000;
}

function preparedMember(expeditionId, userId) {
  return db.prepare(`
    SELECT 1
    FROM family_expedition_members
    WHERE expedition_id = ? AND user_id = ?
  `).get(expeditionId, userId);
}

function existingAttemptIntent(replay, expeditionId) {
  if (replay?.actionType !== 'attempt' || replay.expeditionId !== expeditionId) return null;
  return replay.modifiers?.intent || null;
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
  if (/already prepared/i.test(message)) {
    return res.status(409).json({ error: message });
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

router.post('/events/ack', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;

  try {
    const result = db.transaction(() => acknowledgeMemberEvents(db, {
      userId: req.currentUser.id,
      eventIds: req.body?.eventIds,
    }))();
    const personalEvents = listPendingMemberEvents(db, { userId: req.currentUser.id })
      .map(event => ({
        id: event.id,
        type: event.eventType,
        ...event.payload,
        createdAt: event.createdAt,
      }));
    return res.json({ ...result, personalEvents });
  } catch (error) {
    return handleRouteError(res, error);
  }
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

router.post('/rewards/:rewardId/claim', (req, res) => {
  const rewardId = Number.parseInt(req.params.rewardId, 10);
  if (!Number.isInteger(rewardId)) {
    return res.status(400).json({ error: 'Invalid reward id' });
  }

  try {
    const result = db.transaction(() => claimPendingReward(db, {
      rewardId,
      userId: req.currentUser.id,
    }))();
    const pendingRewards = listPendingRewards(db, { userId: req.currentUser.id })
      .map(serializePendingReward);
    return res.json({
      reward: serializePendingReward(result.reward),
      pendingRewards,
      pendingRewardCount: result.pendingCount,
    });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post('/:id/prepare', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;
  const replay = existingIdempotentAction(req.currentUser.id, idempotencyKey);
  if (preparedMember(access.expeditionId, req.currentUser.id) && !replay) {
    return res.status(409).json({ error: 'Member is already prepared for this expedition' });
  }

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
  const replay = existingIdempotentAction(req.currentUser.id, idempotencyKey);
  if (roomState(access.expeditionId, req.params.roomKey) === 'cleared') {
    if (!replay) return res.status(409).json({ error: 'Room already cleared' });
  }
  const replayIntent = existingAttemptIntent(replay, access.expeditionId);
  const roll = Number.isInteger(replayIntent?.roll) ? replayIntent.roll : secureD20();
  const reroll = Number.isInteger(replayIntent?.reroll) ? replayIntent.reroll : secureD20();

  try {
    const snapshot = db.transaction(() => attemptRoom({
      transaction: db,
      idempotencyKey,
      expeditionId: access.expeditionId,
      userId: req.currentUser.id,
      roomKey: req.params.roomKey,
      actionId: req.body?.actionId,
      mechanicChoice: req.body?.mechanicChoice,
      selectedSupport: req.body?.selectedSupport ?? 0,
      roll,
      reroll,
      rng: secureRng,
      useSharedBuff: Boolean(req.body?.useSharedBuff),
    }))();
    const action = existingIdempotentAction(req.currentUser.id, idempotencyKey);
    return res.json({
      ...serializeFor(req.currentUser, access.family, snapshot, false),
      visualEvents: action?.modifiers?.events || [],
    });
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

router.post('/:id/rooms/:roomKey/role-ability', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;

  try {
    const result = db.transaction(() => useRoleAbility({
      transaction: db,
      idempotencyKey,
      expeditionId: access.expeditionId,
      userId: req.currentUser.id,
      roomKey: req.params.roomKey,
      choiceId: req.body?.choiceId || null,
    }))();
    return res.json({
      ...serializeFor(req.currentUser, access.family, result.snapshot, false),
      visualEvents: result.visualEvents,
    });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post('/:id/rooms/:roomKey/artifacts/:artifactId/use', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;

  try {
    const result = db.transaction(() => useArtifactForMember({
      transaction: db,
      idempotencyKey,
      expeditionId: access.expeditionId,
      userId: req.currentUser.id,
      roomKey: req.params.roomKey,
      artifactId: req.params.artifactId,
    }))();
    return res.json({
      ...serializeFor(req.currentUser, access.family, result.snapshot, false),
      visualEvents: result.visualEvents,
    });
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post('/:id/rooms/:roomKey/reveal', (req, res) => {
  return res.status(410).json({
    error: 'Scout reveal was removed. Update the client and use the role-ability endpoint.',
  });
});

router.post('/:id/rooms/:roomKey/scout-choice', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;

  try {
    const snapshot = db.transaction(() => chooseScoutRoom({
      transaction: db,
      idempotencyKey,
      expeditionId: access.expeditionId,
      userId: req.currentUser.id,
      fromRoomKey: req.params.roomKey,
      choiceId: req.body?.choiceId,
    }))();
    return res.json(serializeFor(req.currentUser, access.family, snapshot, false));
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post('/:id/rooms/:roomKey/event-minigame', (req, res) => {
  return res.status(410).json({ error: 'Mini-game client update required' });
});

router.post('/:id/rooms/:roomKey/minigame/start', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;

  try {
    const persistedReplay = db.transaction(() => readMinigameStartHttpReplay({
      transaction: db,
      idempotencyKey,
      expeditionId: access.expeditionId,
      userId: req.currentUser.id,
      roomKey: req.params.roomKey,
    }))();
    if (persistedReplay) return res.json(persistedReplay);

    const expiration = db.transaction(() => {
      const result = expireStaleMinigameAttempt({
        transaction: db,
        idempotencyKey,
        expeditionId: access.expeditionId,
        userId: req.currentUser.id,
        roomKey: req.params.roomKey,
      });
      if (!result.resolved || !result.attempt?.retry) return { result, body: null };
      const body = {
        ...serializeFor(req.currentUser, access.family, result.snapshot, false),
        attempt: result.attempt,
        visualEvents: result.visualEvents || [],
      };
      persistMinigameHttpReplay({
        transaction: db,
        idempotencyKey,
        userId: req.currentUser.id,
        kind: 'start',
        response: body,
      });
      return { result, body };
    })();
    if (expiration.body) return res.json(expiration.body);
    const body = db.transaction(() => {
      const result = startMinigameAttempt({
        transaction: db,
        idempotencyKey,
        expeditionId: access.expeditionId,
        userId: req.currentUser.id,
        roomKey: req.params.roomKey,
      });
      if (result.httpResponse) return result.httpResponse;
      const response = {
        ...serializeFor(req.currentUser, access.family, result.snapshot, false),
        attempt: result.attempt,
        ...(result.visualEvents?.length ? { visualEvents: result.visualEvents } : {}),
      };
      persistMinigameHttpReplay({
        transaction: db,
        idempotencyKey,
        userId: req.currentUser.id,
        kind: 'start',
        response,
      });
      return response;
    })();
    return res.json(body);
  } catch (error) {
    return handleRouteError(res, error);
  }
});

router.post('/:id/rooms/:roomKey/minigame/:attemptToken/finish', (req, res) => {
  const idempotencyKey = requireIdempotencyKey(req, res);
  if (!idempotencyKey) return;
  const access = requireExpeditionAccess(req, res);
  if (!access) return;

  try {
    const body = db.transaction(() => {
      const result = finishMinigameAttempt({
        transaction: db,
        idempotencyKey,
        expeditionId: access.expeditionId,
        userId: req.currentUser.id,
        roomKey: req.params.roomKey,
        attemptToken: req.params.attemptToken,
        result: req.body?.result,
        rng: secureRng,
      });
      if (result.httpResponse) return result.httpResponse;
      const { snapshot, ...outcome } = result;
      const response = {
        ...serializeFor(req.currentUser, access.family, snapshot, false),
        ...outcome,
      };
      persistMinigameHttpReplay({
        transaction: db,
        idempotencyKey,
        userId: req.currentUser.id,
        kind: 'finish',
        response,
      });
      return response;
    })();
    return res.json(body);
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

router.post('/:id/claim-boss-reward', (req, res) => {
  return res.status(410).json({ error: 'Boss chest retired. Use Claim Rewards after the expedition.' });
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
      rng: secureRng,
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
  const family = getCurrentFamily(req.currentUser.id);
  if (!family) return res.status(403).json({ error: 'You are not in a family' });
  return res.json({ artifactInventory: getArtifactInventory(req.currentUser.id) });
});

module.exports = router;
