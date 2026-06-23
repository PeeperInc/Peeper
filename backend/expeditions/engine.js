'use strict';

const {
  ARTIFACTS,
  DAILY_AP,
  MAX_AP,
  PROGRESS_BANDS,
  PROVISIONS,
  ROLES,
} = require('./catalog');
const { applyArtifactEffects } = require('./artifactEffects');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_SUPPORT = 6;
const ASSIST_SUPPORT = 2;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function utcDayKey(value = Date.now()) {
  const time = value instanceof Date ? value.getTime() : Number(value);
  const milliseconds = Math.abs(time) < 1_000_000_000_000 ? time * 1000 : time;
  if (!Number.isFinite(milliseconds)) throw new TypeError('A valid timestamp is required');
  return Math.floor(milliseconds / MS_PER_DAY);
}

function regenerateAp(member, currentDay = utcDayKey()) {
  const apRegenDay = Number.isInteger(member?.apRegenDay) ? member.apRegenDay : currentDay;
  const elapsedDays = Math.max(0, currentDay - apRegenDay);
  if (elapsedDays === 0) {
    return { ap: Math.min(MAX_AP, member?.ap ?? DAILY_AP), apRegenDay };
  }
  return {
    ap: Math.min(MAX_AP, (member?.ap ?? 0) + elapsedDays * DAILY_AP),
    apRegenDay: currentDay,
  };
}

function progressForRoll({ rawRoll, modifiedRoll, naturalOneProtected = false }) {
  if (rawRoll === 20) return 5;
  if (rawRoll === 1 && !naturalOneProtected) return 0;
  const band = PROGRESS_BANDS.find(({ max }) => modifiedRoll <= max);
  return band?.progress ?? 0;
}

function normalizeSupport(value, available = MAX_SUPPORT) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(MAX_SUPPORT, Math.floor(Number(value)), Math.max(0, available)));
}

function normalizeRoleDay(member, dayKey) {
  const normalized = clone(member || {});
  if (normalized.roleAbilityDay !== dayKey) {
    normalized.roleAbilityDay = dayKey;
    normalized.roleAbilityUsed = false;
  }
  return normalized;
}

function provisionStateFor(provisionId) {
  const provision = PROVISIONS[provisionId];
  if (!provision) return {};
  const { type, config } = provision.effect;
  if (type === 'prevent_debuff') return { preventDebuff: { uses: config.uses } };
  if (type === 'minimum_progress') {
    return { minimumProgress: { uses: config.uses, from: config.from, to: config.to } };
  }
  if (type === 'roll_bonus') return { rollBonus: { uses: config.uses, amount: config.amount } };
  if (type === 'restore_role_ability') {
    return { restoreRoleAbility: { uses: config.uses, roomType: config.roomType } };
  }
  if (type === 'upgrade_loot_rarity') {
    return { upgradeLootRarity: { uses: config.uses, tiers: config.tiers } };
  }
  if (type === 'raise_modified_roll') {
    return { raiseModifiedRoll: { uses: config.uses, below: config.below, value: config.value } };
  }
  return {};
}

function slotFromInventoryItem(item) {
  return {
    artifactId: item.artifactId ?? item.artifact_id,
    charges: item.charges ?? 0,
    quantity: item.quantity ?? 0,
  };
}

function inventoryItemFor(inventory = [], artifactId) {
  return inventory.find(item => (item.artifactId ?? item.artifact_id) === artifactId);
}

function normalizeLoadout(loadout = [], maxSlots = 3) {
  const normalized = clone(loadout || []).slice(0, maxSlots);
  while (normalized.length < maxSlots) normalized.push(null);
  return normalized;
}

function equipFoundArtifact({ loadout = [], inventory = [], artifactId, slotIndex, maxSlots = 3 } = {}) {
  if (!ARTIFACTS[artifactId]) throw new RangeError(`Unknown artifact: ${artifactId}`);
  const owned = inventoryItemFor(inventory, artifactId);
  if (!owned || ((owned.quantity ?? 0) <= 0 && (owned.charges ?? 0) <= 0)) {
    throw new RangeError(`Artifact not owned: ${artifactId}`);
  }
  const targetSlot = slotIndex ?? normalizeLoadout(loadout, maxSlots).findIndex(slot => !slot || slot.exhausted);
  if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot >= maxSlots) {
    throw new RangeError('slotIndex must target one of three loadout slots');
  }
  const next = normalizeLoadout(loadout, maxSlots);
  if (next[targetSlot] && !next[targetSlot].exhausted) {
    throw new RangeError('slot is occupied');
  }
  next[targetSlot] = slotFromInventoryItem(owned);
  return next;
}

function prepareMemberLoadout({ member, inventory = [], artifactIds = null } = {}) {
  const prepared = clone(member || {});
  prepared.provisionState = clone(prepared.provisionState || {});
  if (prepared.provisionId && Object.keys(prepared.provisionState).length === 0) {
    prepared.provisionState = provisionStateFor(prepared.provisionId);
    if (PROVISIONS[prepared.provisionId]?.effect.type === 'grant_ap') {
      const amount = PROVISIONS[prepared.provisionId].effect.config.amount;
      prepared.ap = Math.min(MAX_AP, (prepared.ap ?? DAILY_AP) + amount);
      prepared.provisionState.grantAp = { used: true, amount };
    }
  }
  if (Array.isArray(artifactIds)) {
    if (artifactIds.length > 3) throw new RangeError('loadout cannot exceed three slots');
    prepared.loadout = artifactIds.map(artifactId => {
      const owned = inventoryItemFor(inventory, artifactId);
      if (!owned || ((owned.quantity ?? 0) <= 0 && (owned.charges ?? 0) <= 0)) {
        throw new RangeError(`Artifact not owned: ${artifactId}`);
      }
      return slotFromInventoryItem(owned);
    });
    prepared.loadout = normalizeLoadout(prepared.loadout, 3);
  } else {
    prepared.loadout = normalizeLoadout(prepared.loadout || [], 3);
  }
  return prepared;
}

function addPart(parts, source, amount, extra = {}) {
  if (amount === 0) return;
  parts.push({ source, amount, ...extra });
}

function buildRollModifiers({
  expedition = {},
  member,
  room,
  action,
  selectedSupport = 0,
  dayKey = utcDayKey(),
  rng = () => 0,
} = {}) {
  const workingMember = clone(member || {});
  const workingAction = clone(action || {});
  const workingRoom = clone(room || {});
  const parts = [];
  let total = 0;

  const actionModifier = workingAction.modifier ?? 0;
  total += actionModifier;
  addPart(parts, 'action', actionModifier, { actionId: workingAction.id });

  const role = ROLES[workingMember.role];
  if (role?.stat === workingAction.stat) {
    total += role.bonus;
    addPart(parts, 'role', role.bonus, { role: workingMember.role });
  }

  const supportApplied = normalizeSupport(selectedSupport, workingRoom.support ?? MAX_SUPPORT);
  total += supportApplied;
  addPart(parts, 'support', supportApplied);

  const provision = workingMember.provisionState?.rollBonus;
  if ((provision?.uses ?? 0) > 0) {
    total += provision.amount;
    addPart(parts, 'provision', provision.amount);
  }

  const debuff = workingMember.debuff;
  if (debuff?.type === 'frightened') {
    const applies = !debuff.stat || debuff.stat === workingAction.stat;
    if (applies) {
      const amount = debuff.amount ?? -2;
      total += amount;
      addPart(parts, 'debuff', amount, { debuffType: debuff.type });
    }
  }

  const beforeArtifact = applyArtifactEffects({
    phase: 'before_roll',
    actionType: 'attempt',
    expeditionId: expedition.id,
    dayKey,
    bossPhase: workingRoom.phase,
    stat: workingAction.stat,
    roomType: workingRoom.type,
    roomTags: workingRoom.tags || [],
    actionTags: workingAction.tags || [],
    modifier: total,
    support: supportApplied,
    helpers: supportApplied > 0 ? 1 : 0,
    rawRoll: 0,
    modifiedRoll: 0,
    loadout: workingMember.loadout || [],
    triggerHistory: workingMember.triggerHistory || [],
    debuff: clone(debuff),
    artifactsDisabled: debuff?.type === 'cursed',
    rng,
  });

  const artifactDelta = beforeArtifact.modifier - total;
  total = beforeArtifact.modifier;
  for (const artifactId of beforeArtifact.triggered) {
    addPart(parts, `artifact:${artifactId}`, artifactDelta, { artifactId });
  }

  return {
    total,
    parts,
    supportApplied,
    loadout: beforeArtifact.loadout,
    triggerHistory: beforeArtifact.triggerHistory,
    artifactEvents: beforeArtifact.events || [],
    triggeredArtifacts: beforeArtifact.triggered || [],
  };
}

function rollD20(roll, rng) {
  const value = typeof roll === 'function'
    ? roll(rng)
    : (roll ?? (1 + Math.floor((rng || Math.random)() * 20)));
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new RangeError('roll must be an integer from 1 to 20');
  }
  return value;
}

function firstRevealableConnectedRoom(expedition, fromRoomKey) {
  const rooms = expedition?.map?.rooms || [];
  const edges = expedition?.map?.edges || [];
  const roomByKey = new Map(rooms.map(room => [room.key, room]));
  const edge = edges.find(candidate => {
    const room = roomByKey.get(candidate.to);
    return candidate.from === fromRoomKey && room?.state === 'hidden';
  });
  return edge?.to;
}

function resolveAttempt({
  expedition = {},
  member,
  room,
  action,
  selectedSupport = 0,
  roll,
  reroll,
  rng = () => 0,
  now = Date.now(),
  useRoleAbility = false,
  useSharedBuff = false,
} = {}) {
  const dayKey = utcDayKey(now);
  const regenerated = regenerateAp(member || {}, dayKey);
  const nextMember = normalizeRoleDay({ ...(clone(member || {})), ...regenerated }, dayKey);
  if ((nextMember.ap ?? 0) < 1) throw new RangeError('member does not have enough AP');
  if (['hidden', 'locked'].includes(room?.state)) throw new RangeError('room is not unlocked');

  const nextRoom = clone(room || {});
  const nextExpedition = clone(expedition || {});
  nextExpedition.sharedBuffs = clone(nextExpedition.sharedBuffs || {});
  const nextAction = clone(action || {});
  const events = [];
  const role = ROLES[nextMember.role];
  const canUseRoleAbility = Boolean(useRoleAbility && role && !nextMember.roleAbilityUsed);
  const artifactsDisabledForAction = nextMember.debuff?.type === 'cursed';
  let rawRoll = rollD20(roll, rng);
  const initialRawRoll = rawRoll;

  if (canUseRoleAbility && role.ability === 'reroll') {
    const replacement = rollD20(reroll, rng);
    rawRoll = Math.max(rawRoll, replacement);
    nextMember.roleAbilityUsed = true;
    events.push({ type: 'role_reroll', roll: replacement });
  }

  const modifiers = buildRollModifiers({
    expedition: nextExpedition,
    member: nextMember,
    room: nextRoom,
    action: nextAction,
    selectedSupport,
    dayKey,
    rng,
  });
  nextMember.loadout = modifiers.loadout;
  nextMember.triggerHistory = modifiers.triggerHistory;

  if (useSharedBuff && (nextExpedition.sharedBuffs.rollBonus?.uses ?? 0) > 0) {
    const shared = nextExpedition.sharedBuffs.rollBonus;
    modifiers.total += shared.amount;
    modifiers.parts.push({ source: `shared:${shared.source || 'roll_bonus'}`, amount: shared.amount });
    shared.uses -= 1;
  }
  if (canUseRoleAbility && role.ability === 'blessing') {
    nextExpedition.sharedBuffs.rollBonus = {
      amount: 3,
      uses: (nextExpedition.sharedBuffs.rollBonus?.uses || 0) + 1,
      source: 'cleric_blessing',
    };
    nextMember.roleAbilityUsed = true;
    events.push({ type: 'shared_blessing_added', amount: 3 });
  }
  if (canUseRoleAbility && role.ability === 'shield_wall') {
    nextMember.roleAbilityUsed = true;
  }
  if (canUseRoleAbility && role.ability === 'reveal_room') {
    const roomKey = firstRevealableConnectedRoom(nextExpedition, nextRoom.key);
    if (roomKey) events.push({ type: 'room_revealed', roomKey });
    nextMember.roleAbilityUsed = true;
  }

  let modifiedRoll = rawRoll + modifiers.total;
  const afterRoll = applyArtifactEffects({
    phase: 'after_roll',
    actionType: 'attempt',
    expeditionId: nextExpedition.id,
    dayKey,
    bossPhase: nextRoom.phase,
    stat: nextAction.stat,
    roomType: nextRoom.type,
    roomTags: nextRoom.tags || [],
    actionTags: nextAction.tags || [],
    modifier: modifiers.total,
    rawRoll,
    modifiedRoll,
    critical: rawRoll === 20,
    loadout: nextMember.loadout,
    triggerHistory: nextMember.triggerHistory,
    artifactsDisabled: artifactsDisabledForAction,
    rng,
  });
  rawRoll = afterRoll.rawRoll;
  modifiers.total = afterRoll.modifier;
  nextMember.loadout = afterRoll.loadout;
  nextMember.triggerHistory = afterRoll.triggerHistory;
  modifiedRoll = rawRoll + modifiers.total;

  const raiseModifiedRoll = nextMember.provisionState?.raiseModifiedRoll;
  if ((raiseModifiedRoll?.uses ?? 0) > 0 && modifiedRoll < raiseModifiedRoll.below) {
    raiseModifiedRoll.uses -= 1;
    modifiedRoll = raiseModifiedRoll.value;
  }

  const shieldProtected = canUseRoleAbility && role.ability === 'shield_wall';
  let progressAwarded = progressForRoll({
    rawRoll,
    modifiedRoll,
    naturalOneProtected: shieldProtected && initialRawRoll === 1,
  });
  if (shieldProtected && progressAwarded === 0) {
    progressAwarded = 1;
    events.push({ type: 'zero_progress_protected' });
    if (initialRawRoll === 1) events.push({ type: 'natural_one_protected' });
  }

  const minimum = nextMember.provisionState?.minimumProgress;
  if ((minimum?.uses ?? 0) > 0 && progressAwarded === minimum.from) {
    progressAwarded = Math.max(progressAwarded, minimum.to);
    minimum.uses -= 1;
  }

  const beforeProgress = applyArtifactEffects({
    phase: 'before_progress',
    actionType: 'attempt',
    expeditionId: nextExpedition.id,
    dayKey,
    bossPhase: nextRoom.phase,
    stat: nextAction.stat,
    roomType: nextRoom.type,
    roomTags: nextRoom.tags || [],
    actionTags: nextAction.tags || [],
    rawRoll,
    modifiedRoll,
    progress: progressAwarded,
    debuff: nextRoom.complication ? { type: nextRoom.complication, amount: 2 } : null,
    loadout: nextMember.loadout,
    triggerHistory: nextMember.triggerHistory,
    artifactsDisabled: artifactsDisabledForAction,
    rng,
  });
  progressAwarded = beforeProgress.clearRoom ? nextRoom.progressTarget : beforeProgress.progress;
  nextMember.loadout = beforeProgress.loadout;
  nextMember.triggerHistory = beforeProgress.triggerHistory;

  nextMember.ap -= 1;
  if (nextMember.provisionState?.rollBonus?.uses > 0) nextMember.provisionState.rollBonus.uses -= 1;
  nextMember.debuff = null;
  nextRoom.support = Math.max(0, (nextRoom.support || 0) - modifiers.supportApplied);

  const previousProgress = nextRoom.progress || 0;
  nextRoom.progress = Math.max(
    previousProgress,
    Math.min(nextRoom.progressTarget || Infinity, previousProgress + progressAwarded),
  );
  const appliedProgress = Math.max(0, nextRoom.progress - previousProgress);

  if (nextRoom.type === 'boss' && nextRoom.progress >= nextRoom.progressTarget) {
    const phase = nextRoom.phase || 1;
    if (phase < 3) {
      nextRoom.phase = phase + 1;
      nextRoom.progress = 0;
      nextRoom.state = 'unlocked';
    } else {
      nextRoom.state = 'cleared';
      nextRoom.bossDefeated = true;
      nextRoom.clearedAt = now;
      nextExpedition.status = 'boss_defeated';
      nextExpedition.bossDefeatedAt = now;
    }
  } else if (nextRoom.progress >= nextRoom.progressTarget) {
    nextRoom.state = 'cleared';
    nextRoom.clearedAt = now;
  }

  if (progressAwarded === 0 && nextRoom.complication) {
    const prevented = nextMember.provisionState?.preventDebuff;
    if ((prevented?.uses ?? 0) > 0 || shieldProtected || beforeProgress.debuffPrevented) {
      if ((prevented?.uses ?? 0) > 0) prevented.uses -= 1;
    } else {
      nextMember.debuff = { type: nextRoom.complication };
    }
  }

  const afterProgress = applyArtifactEffects({
    phase: 'after_progress',
    actionType: 'attempt',
    expeditionId: nextExpedition.id,
    dayKey,
    bossPhase: nextRoom.phase,
    stat: nextAction.stat,
    roomType: nextRoom.type,
    roomTags: nextRoom.tags || [],
    actionTags: nextAction.tags || [],
    rawRoll,
    modifiedRoll,
    progress: progressAwarded,
    roleAbilityUsed: nextMember.roleAbilityUsed,
    loadout: nextMember.loadout,
    triggerHistory: nextMember.triggerHistory,
    artifactsDisabled: artifactsDisabledForAction,
    rng,
  });
  nextMember.loadout = afterProgress.loadout;
  nextMember.triggerHistory = afterProgress.triggerHistory;
  if (afterProgress.roleAbilityRestored) nextMember.roleAbilityUsed = false;

  const restore = nextMember.provisionState?.restoreRoleAbility;
  if ((restore?.uses ?? 0) > 0 && restore.roomType === nextRoom.type) {
    nextMember.roleAbilityUsed = false;
    restore.uses -= 1;
  }

  const loot = {
    coins: 0,
    artifactRolls: rawRoll === 20 ? 1 + (nextRoom.criticalBonusLootRolls || 0) : 0,
  };
  const beforeLoot = applyArtifactEffects({
    phase: 'before_loot',
    actionType: 'attempt',
    expeditionId: nextExpedition.id,
    dayKey,
    bossPhase: nextRoom.phase,
    stat: nextAction.stat,
    roomType: nextRoom.type,
    roomTags: nextRoom.tags || [],
    actionTags: nextAction.tags || [],
    rawRoll,
    modifiedRoll,
    critical: rawRoll === 20,
    success: progressAwarded > 0,
    successStreak: nextMember.successStreak || 0,
    coins: loot.coins,
    artifactRolls: loot.artifactRolls,
    loadout: nextMember.loadout,
    triggerHistory: nextMember.triggerHistory,
    artifactsDisabled: artifactsDisabledForAction,
    rng,
  });
  loot.coins = beforeLoot.coins * (beforeLoot.coinMultiplier || 1);
  loot.artifactRolls = beforeLoot.artifactRolls;
  nextMember.loadout = beforeLoot.loadout;
  nextMember.triggerHistory = beforeLoot.triggerHistory;

  return deepFreeze({
    expedition: nextExpedition,
    member: nextMember,
    room: nextRoom,
    action: nextAction,
    rawRoll,
    modifiedRoll,
    modifiers,
    progressAwarded: appliedProgress,
    loot,
    events: [...events, ...modifiers.artifactEvents, ...afterRoll.events],
    revealedRoomKeys: events
      .filter(event => event.type === 'room_revealed')
      .map(event => event.roomKey),
  });
}

function resolveAssist({
  member,
  room,
  expedition = {},
  rng = () => 0,
  now = Date.now(),
} = {}) {
  const dayKey = utcDayKey(now);
  const regenerated = regenerateAp(member || {}, dayKey);
  const nextMember = normalizeRoleDay({ ...(clone(member || {})), ...regenerated }, dayKey);
  const nextRoom = clone(room || {});
  if ((nextMember.ap ?? 0) < 1) throw new RangeError('member does not have enough AP');
  if (['hidden', 'locked', 'cleared'].includes(nextRoom.state)) {
    throw new RangeError('room is not assistable');
  }
  if ((nextRoom.support || 0) >= MAX_SUPPORT) {
    throw new RangeError('support is already capped');
  }
  const baseAmount = nextMember.debuff?.type === 'exhausted' ? 1 : ASSIST_SUPPORT;
  const beforeAssist = applyArtifactEffects({
    phase: 'before_progress',
    actionType: 'assist',
    expeditionId: expedition.id,
    dayKey,
    roomType: nextRoom.type,
    roomTags: nextRoom.tags || [],
    assist: baseAmount,
    loadout: nextMember.loadout || [],
    triggerHistory: nextMember.triggerHistory || [],
    artifactsDisabled: nextMember.debuff?.type === 'cursed',
    rng,
  });
  const available = Math.max(0, MAX_SUPPORT - (nextRoom.support || 0));
  const supportAdded = Math.min(available, beforeAssist.assist);
  nextRoom.support = (nextRoom.support || 0) + supportAdded;
  nextMember.ap -= 1;
  nextMember.debuff = null;
  nextMember.loadout = beforeAssist.loadout;
  nextMember.triggerHistory = beforeAssist.triggerHistory;
  return deepFreeze({ member: nextMember, room: nextRoom, supportAdded });
}

function unlockConnectedRooms({ map, rooms, fromRoomKey, now = Date.now() } = {}) {
  const roomByKey = new Map((rooms || []).map(room => [room.key, clone(room)]));
  for (const edge of map?.edges || []) {
    if (edge.from !== fromRoomKey) continue;
    const room = roomByKey.get(edge.to);
    if (!room || room.state === 'cleared' || room.state === 'unlocked') continue;
    room.state = 'unlocked';
    room.unlockedAt = now;
  }
  return [...roomByKey.values()];
}

function reachableRoomKeys(map) {
  const rooms = map?.rooms || [];
  const start = rooms.find(room => room.type === 'camp' || room.startingRoom)?.key;
  if (!start) return new Set(rooms.map(room => room.key));
  const outgoing = new Map();
  for (const edge of map?.edges || []) {
    const destinations = outgoing.get(edge.from) || [];
    destinations.push(edge.to);
    outgoing.set(edge.from, destinations);
  }
  const visited = new Set();
  const pending = [start];
  while (pending.length > 0) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    pending.push(...(outgoing.get(key) || []));
  }
  return visited;
}

function canFinishExpedition({ expedition, userId, rooms = [] } = {}) {
  if (expedition?.status === 'finished') return false;
  const bossDefeated = expedition?.status === 'boss_defeated'
    || rooms.some(room => room.type === 'boss' && (room.bossDefeated || room.state === 'cleared'));
  if (!bossDefeated) return false;
  if ((expedition.startedBy ?? expedition.started_by) === userId) return true;
  const roomByKey = new Map(rooms.map(room => [room.key, room]));
  const requiredKeys = expedition?.map ? reachableRoomKeys(expedition.map) : new Set(rooms.map(room => room.key));
  return [...requiredKeys].every(key => roomByKey.get(key)?.state === 'cleared');
}

function assertMutationInput({ transaction, idempotencyKey } = {}) {
  if (!idempotencyKey) throw new TypeError('idempotencyKey is required');
  if (!transaction || transaction.inTransaction !== true || typeof transaction.prepare !== 'function') {
    throw new TypeError('mutation requires an active caller transaction');
  }
}

function parseJson(text, fallback) {
  if (!text) return clone(fallback);
  try {
    return JSON.parse(text);
  } catch {
    return clone(fallback);
  }
}

function stringifyJson(value) {
  return JSON.stringify(value ?? {});
}

function decodeDebuff(text) {
  const value = parseJson(text, null);
  if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) return null;
  return value;
}

function encodeDebuff(value) {
  return stringifyJson(value || {});
}

function findIdempotentAction(transaction, {
  userId,
  idempotencyKey,
  expectedActionType,
  expectedExpeditionId = null,
}) {
  const action = transaction.prepare(`
    SELECT expedition_id AS expeditionId, action_type AS actionType
    FROM family_expedition_actions
    WHERE user_id = ? AND idempotency_key = ?
  `).get(userId, idempotencyKey);
  if (!action) return null;
  if (
    action.actionType !== expectedActionType
    || (expectedExpeditionId !== null && action.expeditionId !== expectedExpeditionId)
  ) {
    throw new Error('idempotency conflict: key was already used for another mutation');
  }
  return action;
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

function rowToMember(row) {
  const loadoutState = parseLoadoutState(row.loadout_json);
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
    debuff: decodeDebuff(row.debuff_json),
    contributionAp: row.contribution_ap,
    contributionProgress: row.contribution_progress,
    preparedAt: row.prepared_at,
    bossRewardClaimedAt: row.boss_reward_claimed_at,
  };
}

function parseLoadoutState(text) {
  const parsed = parseJson(text, []);
  if (Array.isArray(parsed)) {
    return { slots: normalizeLoadout(parsed, 3), triggerHistory: [] };
  }
  if (parsed && typeof parsed === 'object') {
    return {
      slots: normalizeLoadout(parsed.slots || parsed.loadout || [], 3),
      triggerHistory: clone(parsed.triggerHistory || []),
    };
  }
  return { slots: normalizeLoadout([], 3), triggerHistory: [] };
}

function encodeLoadoutState(member) {
  return stringifyJson({
    slots: normalizeLoadout(member.loadout || [], 3),
    triggerHistory: clone(member.triggerHistory || []),
  });
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

function readSnapshot(transaction, expeditionId) {
  const expedition = rowToExpedition(transaction.prepare(`
    SELECT * FROM family_expeditions WHERE id = ?
  `).get(expeditionId));
  if (!expedition) throw new RangeError(`Unknown expedition: ${expeditionId}`);
  const rooms = transaction.prepare(`
    SELECT * FROM family_expedition_rooms WHERE expedition_id = ? ORDER BY id
  `).all(expeditionId).map(rowToRoom);
  const members = transaction.prepare(`
    SELECT * FROM family_expedition_members WHERE expedition_id = ? ORDER BY user_id
  `).all(expeditionId).map(rowToMember);
  const actions = transaction.prepare(`
    SELECT * FROM family_expedition_actions WHERE expedition_id = ? ORDER BY id
  `).all(expeditionId).map(rowToAction);
  return clone({ expedition, rooms, members, actions });
}

function roomPayload(room) {
  const payload = clone(room || {});
  delete payload.id;
  delete payload.state;
  delete payload.progress;
  delete payload.progressTarget;
  delete payload.support;
  delete payload.unlockedAt;
  delete payload.clearedAt;
  return payload;
}

function defaultRoomState(room) {
  if (typeof room.state === 'string') return room.state;
  if (room.startingRoom || room.type === 'camp') return 'unlocked';
  if (room.optional) return 'hidden';
  return 'locked';
}

function insertAction(transaction, {
  idempotencyKey,
  expeditionId,
  roomId,
  userId,
  actionType,
  stat = null,
  rawRoll = null,
  modifiers = {},
  modifiedRoll = null,
  progressAwarded = 0,
  loot = {},
  narrationKey = null,
  now,
}) {
  transaction.prepare(`
    INSERT INTO family_expedition_actions (
      idempotency_key, expedition_id, room_id, user_id, action_type, stat, raw_roll,
      modifier_json, modified_roll, progress_awarded, loot_json, narration_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    idempotencyKey,
    expeditionId,
    roomId,
    userId,
    actionType,
    stat,
    rawRoll,
    stringifyJson(modifiers),
    modifiedRoll,
    progressAwarded,
    stringifyJson(loot),
    narrationKey,
    now,
  );
}

function campRoom(transaction, expeditionId) {
  return transaction.prepare(`
    SELECT * FROM family_expedition_rooms
    WHERE expedition_id = ?
    ORDER BY CASE WHEN room_type = 'camp' THEN 0 ELSE 1 END, id
    LIMIT 1
  `).get(expeditionId);
}

function getRoomRow(transaction, expeditionId, roomKey) {
  const row = transaction.prepare(`
    SELECT * FROM family_expedition_rooms WHERE expedition_id = ? AND room_key = ?
  `).get(expeditionId, roomKey);
  if (!row) throw new RangeError(`Unknown room: ${roomKey}`);
  return row;
}

function getMemberRow(transaction, expeditionId, userId) {
  const row = transaction.prepare(`
    SELECT * FROM family_expedition_members WHERE expedition_id = ? AND user_id = ?
  `).get(expeditionId, userId);
  if (!row) throw new RangeError('member is not prepared');
  return row;
}

function readInventory(transaction, userId) {
  return transaction.prepare(`
    SELECT artifact_id AS artifactId, quantity, charges
    FROM expedition_artifact_inventory
    WHERE user_id = ?
  `).all(userId);
}

function mapWithRoomStates(map, rooms) {
  const roomsByKey = new Map(rooms.map(room => [room.key, room]));
  return {
    ...clone(map || {}),
    rooms: (map?.rooms || []).map(room => ({
      ...room,
      ...(roomsByKey.get(room.key) || {}),
    })),
  };
}

function updateMember(transaction, expeditionId, memberResult, contribution = {}) {
  transaction.prepare(`
    UPDATE family_expedition_members SET
      ap = ?,
      ap_regen_day = ?,
      role_ability_day = ?,
      role_ability_used = ?,
      provision_state_json = ?,
      loadout_json = ?,
      debuff_json = ?,
      contribution_ap = contribution_ap + ?,
      contribution_progress = contribution_progress + ?
    WHERE expedition_id = ? AND user_id = ?
  `).run(
    memberResult.ap,
    memberResult.apRegenDay,
    memberResult.roleAbilityDay,
    memberResult.roleAbilityUsed ? 1 : 0,
    stringifyJson(memberResult.provisionState || {}),
    encodeLoadoutState(memberResult),
    encodeDebuff(memberResult.debuff),
    contribution.ap || 0,
    contribution.progress || 0,
    expeditionId,
    memberResult.userId,
  );
}

function assertExpeditionNotFinished(snapshotOrExpedition) {
  const expedition = snapshotOrExpedition?.expedition || snapshotOrExpedition;
  if (expedition?.status === 'finished') {
    throw new RangeError('expedition is finished');
  }
}

function updateRoom(transaction, expeditionId, roomResult) {
  transaction.prepare(`
    UPDATE family_expedition_rooms SET
      state = ?,
      progress = ?,
      support = ?,
      payload_json = ?,
      unlocked_at = ?,
      cleared_at = ?
    WHERE expedition_id = ? AND room_key = ?
  `).run(
    roomResult.state,
    roomResult.progress,
    roomResult.support || 0,
    stringifyJson(roomPayload(roomResult)),
    roomResult.unlockedAt ?? roomResult.unlocked_at ?? null,
    roomResult.clearedAt ?? roomResult.cleared_at ?? null,
    expeditionId,
    roomResult.key,
  );
}

function persistUnlocks(transaction, expeditionId, map, fromRoomKey, now) {
  const rooms = readSnapshot(transaction, expeditionId).rooms;
  const unlocked = unlockConnectedRooms({ map, rooms, fromRoomKey, now });
  for (const room of unlocked) updateRoom(transaction, expeditionId, room);
}

function revealRoomByKey(transaction, expeditionId, roomKey, now) {
  const row = getRoomRow(transaction, expeditionId, roomKey);
  const room = rowToRoom(row);
  if (room.state === 'cleared' || room.state === 'unlocked') return room;
  room.state = 'unlocked';
  room.unlockedAt = now;
  updateRoom(transaction, expeditionId, room);
  return room;
}

function createExpedition(options) {
  assertMutationInput(options);
  const {
    transaction,
    idempotencyKey,
    familyId,
    userId,
    startedBy = userId,
    themeId = 'root_king',
    seed,
    map,
    now = Math.floor(Date.now() / 1000),
  } = options;
  const replay = findIdempotentAction(transaction, {
    userId: startedBy,
    idempotencyKey,
    expectedActionType: 'create_expedition',
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);
  if (!familyId || !startedBy || !map) throw new TypeError('familyId, userId, and map are required');

  const expeditionInfo = transaction.prepare(`
    INSERT INTO family_expeditions (
      family_id, theme_id, seed, status, map_json, shared_buffs_json, started_by, started_at
    ) VALUES (?, ?, ?, 'active', ?, '{}', ?, ?)
  `).run(familyId, themeId, seed || String(now), stringifyJson(map), startedBy, now);
  const expeditionId = Number(expeditionInfo.lastInsertRowid);

  for (const room of map.rooms || []) {
    const state = defaultRoomState(room);
    transaction.prepare(`
      INSERT INTO family_expedition_rooms (
        expedition_id, room_key, room_type, state, progress, progress_target, support,
        payload_json, unlocked_at, cleared_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      expeditionId,
      room.key,
      room.type,
      state,
      room.progress || 0,
      room.progressTarget,
      stringifyJson(roomPayload(room)),
      state === 'unlocked' ? now : null,
      state === 'cleared' ? now : null,
    );
  }

  const room = campRoom(transaction, expeditionId);
  insertAction(transaction, {
    idempotencyKey,
    expeditionId,
    roomId: room.id,
    userId: startedBy,
    actionType: 'create_expedition',
    now,
  });
  return readSnapshot(transaction, expeditionId);
}

function prepareMember(options) {
  assertMutationInput(options);
  const {
    transaction,
    idempotencyKey,
    expeditionId,
    userId,
    role,
    provisionId = null,
    artifactIds = [],
    now = Math.floor(Date.now() / 1000),
  } = options;
  const snapshot = readSnapshot(transaction, expeditionId);
  assertExpeditionNotFinished(snapshot);
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'prepare_member',
    expectedExpeditionId: expeditionId,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);
  if (!ROLES[role]) throw new RangeError(`Unknown role: ${role}`);
  const dayKey = utcDayKey(now);
  const prepared = prepareMemberLoadout({
    member: {
      userId,
      role,
      ap: DAILY_AP,
      apRegenDay: dayKey,
      roleAbilityDay: dayKey,
      roleAbilityUsed: false,
      provisionId,
      provisionState: {},
      loadout: [],
      debuff: null,
    },
    inventory: readInventory(transaction, userId),
    artifactIds,
  });
  transaction.prepare(`
    INSERT INTO family_expedition_members (
      expedition_id, user_id, role, ap, ap_regen_day, role_ability_day, role_ability_used,
      provision_id, provision_state_json, loadout_json, debuff_json, prepared_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(expedition_id, user_id) DO UPDATE SET
      role = excluded.role,
      ap = excluded.ap,
      ap_regen_day = excluded.ap_regen_day,
      role_ability_day = excluded.role_ability_day,
      role_ability_used = excluded.role_ability_used,
      provision_id = excluded.provision_id,
      provision_state_json = excluded.provision_state_json,
      loadout_json = excluded.loadout_json,
      debuff_json = excluded.debuff_json
  `).run(
    expeditionId,
    userId,
    role,
    prepared.ap,
    prepared.apRegenDay,
    prepared.roleAbilityDay,
    prepared.roleAbilityUsed ? 1 : 0,
    provisionId,
    stringifyJson(prepared.provisionState || {}),
    encodeLoadoutState(prepared),
    encodeDebuff(prepared.debuff),
    now,
  );
  insertAction(transaction, {
    idempotencyKey,
    expeditionId,
    roomId: campRoom(transaction, expeditionId).id,
    userId,
    actionType: 'prepare_member',
    now,
  });
  return readSnapshot(transaction, expeditionId);
}

function attemptRoom(options) {
  assertMutationInput(options);
  const {
    transaction,
    idempotencyKey,
    expeditionId,
    userId,
    roomKey,
    actionId,
    selectedSupport = 0,
    roll,
    reroll,
    rng = () => 0,
    now = Math.floor(Date.now() / 1000),
    useRoleAbility = false,
    useSharedBuff = false,
  } = options;
  let snapshot = readSnapshot(transaction, expeditionId);
  assertExpeditionNotFinished(snapshot);
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'attempt',
    expectedExpeditionId: expeditionId,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);
  const room = rowToRoom(getRoomRow(transaction, expeditionId, roomKey));
  if (room.state === 'cleared') throw new RangeError('room is already cleared');
  const memberRow = getMemberRow(transaction, expeditionId, userId);
  const memberState = rowToMember(memberRow);
  const action = (room.actions || []).find(candidate => candidate.id === actionId);
  if (!action) throw new RangeError(`Unknown action: ${actionId}`);
  const result = resolveAttempt({
    expedition: {
      id: expeditionId,
      status: snapshot.expedition.status,
      map: mapWithRoomStates(snapshot.expedition.map, snapshot.rooms),
      sharedBuffs: snapshot.expedition.sharedBuffs,
    },
    member: memberState,
    room,
    action,
    selectedSupport,
    roll,
    reroll,
    rng,
    now,
    useRoleAbility,
    useSharedBuff,
  });
  updateMember(transaction, expeditionId, result.member, { ap: 1, progress: result.progressAwarded });
  updateRoom(transaction, expeditionId, result.room);
  transaction.prepare(`
    UPDATE family_expeditions SET status = ?, shared_buffs_json = ?, boss_defeated_at = COALESCE(?, boss_defeated_at)
    WHERE id = ?
  `).run(
    result.expedition.status || snapshot.expedition.status,
    stringifyJson(result.expedition.sharedBuffs || {}),
    result.expedition.bossDefeatedAt || null,
    expeditionId,
  );
  if (result.room.state === 'cleared') {
    persistUnlocks(transaction, expeditionId, snapshot.expedition.map, result.room.key, now);
  }
  for (const revealedRoomKey of result.revealedRoomKeys || []) {
    revealRoomByKey(transaction, expeditionId, revealedRoomKey, now);
  }
  insertAction(transaction, {
    idempotencyKey,
    expeditionId,
    roomId: room.id,
    userId,
    actionType: 'attempt',
    stat: action.stat,
    rawRoll: result.rawRoll,
    modifiers: result.modifiers,
    modifiedRoll: result.modifiedRoll,
    progressAwarded: result.progressAwarded,
    loot: result.loot,
    narrationKey: action.narration?.success || null,
    now,
  });
  return readSnapshot(transaction, expeditionId);
}

function assistRoom(options) {
  assertMutationInput(options);
  const {
    transaction,
    idempotencyKey,
    expeditionId,
    userId,
    roomKey,
    rng = () => 0,
    now = Math.floor(Date.now() / 1000),
  } = options;
  const snapshot = readSnapshot(transaction, expeditionId);
  assertExpeditionNotFinished(snapshot);
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'assist',
    expectedExpeditionId: expeditionId,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);
  const room = rowToRoom(getRoomRow(transaction, expeditionId, roomKey));
  const memberState = rowToMember(getMemberRow(transaction, expeditionId, userId));
  const result = resolveAssist({
    expedition: { id: expeditionId, status: snapshot.expedition.status },
    member: memberState,
    room,
    rng,
    now,
  });
  updateMember(transaction, expeditionId, result.member, { ap: 1, progress: 0 });
  updateRoom(transaction, expeditionId, result.room);
  insertAction(transaction, {
    idempotencyKey,
    expeditionId,
    roomId: room.id,
    userId,
    actionType: 'assist',
    modifiers: { supportAdded: result.supportAdded },
    now,
  });
  return readSnapshot(transaction, expeditionId);
}

function revealRoom(options) {
  assertMutationInput(options);
  const {
    transaction,
    idempotencyKey,
    expeditionId,
    userId,
    fromRoomKey,
    roomKey,
    now = Math.floor(Date.now() / 1000),
  } = options;
  const snapshot = readSnapshot(transaction, expeditionId);
  assertExpeditionNotFinished(snapshot);
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'reveal_room',
    expectedExpeditionId: expeditionId,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);
  const connected = (snapshot.expedition.map.edges || [])
    .some(edge => edge.from === fromRoomKey && edge.to === roomKey);
  if (!connected) throw new RangeError('room is not connected');
  const memberState = rowToMember(getMemberRow(transaction, expeditionId, userId));
  const dayKey = utcDayKey(now);
  const revealMember = normalizeRoleDay(memberState, dayKey);
  if (revealMember.role !== 'scout') throw new RangeError('only scouts can reveal rooms');
  if (revealMember.roleAbilityUsed) throw new RangeError('scout reveal ability is already used');
  const fromRoom = getRoomRow(transaction, expeditionId, fromRoomKey);
  const source = rowToRoom(fromRoom);
  if (!['unlocked', 'cleared'].includes(source.state)) {
    throw new RangeError('source room is not available');
  }
  const targetBeforeReveal = rowToRoom(getRoomRow(transaction, expeditionId, roomKey));
  if (!['hidden', 'locked'].includes(targetBeforeReveal.state)) {
    throw new RangeError('target room is already revealed');
  }
  const target = revealRoomByKey(transaction, expeditionId, roomKey, now);
  revealMember.roleAbilityUsed = true;
  updateMember(transaction, expeditionId, revealMember);
  insertAction(transaction, {
    idempotencyKey,
    expeditionId,
    roomId: fromRoom.id,
    userId,
    actionType: 'reveal_room',
    modifiers: { revealedRoomKey: target.key },
    now,
  });
  return readSnapshot(transaction, expeditionId);
}

function equipFoundArtifactForMember(options) {
  assertMutationInput(options);
  const {
    transaction,
    idempotencyKey,
    expeditionId,
    userId,
    artifactId,
    slotIndex,
    now = Math.floor(Date.now() / 1000),
  } = options;
  const snapshot = readSnapshot(transaction, expeditionId);
  assertExpeditionNotFinished(snapshot);
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'equip_found_artifact',
    expectedExpeditionId: expeditionId,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);
  const memberState = rowToMember(getMemberRow(transaction, expeditionId, userId));
  const loadout = equipFoundArtifact({
    loadout: memberState.loadout,
    inventory: readInventory(transaction, userId),
    artifactId,
    slotIndex,
  });
  transaction.prepare(`
    UPDATE family_expedition_members SET loadout_json = ?
    WHERE expedition_id = ? AND user_id = ?
  `).run(encodeLoadoutState({ ...memberState, loadout }), expeditionId, userId);
  insertAction(transaction, {
    idempotencyKey,
    expeditionId,
    roomId: campRoom(transaction, expeditionId).id,
    userId,
    actionType: 'equip_found_artifact',
    modifiers: { artifactId, slotIndex },
    now,
  });
  return readSnapshot(transaction, expeditionId);
}

function finishExpedition(options) {
  assertMutationInput(options);
  const {
    transaction,
    idempotencyKey,
    expeditionId,
    userId,
    now = Math.floor(Date.now() / 1000),
  } = options;
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'finish_expedition',
    expectedExpeditionId: expeditionId,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);
  const snapshot = readSnapshot(transaction, expeditionId);
  if (!canFinishExpedition({ expedition: snapshot.expedition, userId, rooms: snapshot.rooms })) {
    throw new RangeError('user cannot finish expedition yet');
  }
  transaction.prepare(`
    UPDATE family_expeditions SET status = 'finished', finished_at = ? WHERE id = ?
  `).run(now, expeditionId);
  transaction.prepare(`
    INSERT INTO family_expedition_history (expedition_id, family_id, summary_json, finished_at)
    VALUES (?, ?, ?, ?)
  `).run(
    expeditionId,
    snapshot.expedition.familyId,
    stringifyJson({
      expeditionId,
      finishedBy: userId,
      roomsCleared: snapshot.rooms.filter(room => room.state === 'cleared').length,
      members: snapshot.members.map(row => ({ userId: row.userId, progress: row.contributionProgress })),
    }),
    now,
  );
  const room = snapshot.rooms.find(candidate => candidate.type === 'boss') || snapshot.rooms[0];
  insertAction(transaction, {
    idempotencyKey,
    expeditionId,
    roomId: room.id,
    userId,
    actionType: 'finish_expedition',
    now,
  });
  return readSnapshot(transaction, expeditionId);
}

module.exports = {
  utcDayKey,
  regenerateAp,
  progressForRoll,
  buildRollModifiers,
  resolveAttempt,
  resolveAssist,
  unlockConnectedRooms,
  canFinishExpedition,
  prepareMemberLoadout,
  equipFoundArtifact,
  createExpedition,
  prepareMember,
  attemptRoom,
  assistRoom,
  revealRoom,
  equipFoundArtifactForMember,
  finishExpedition,
};
