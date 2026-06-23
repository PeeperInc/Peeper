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

function normalizeSupport(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(MAX_SUPPORT, Math.floor(Number(value))));
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

function equipFoundArtifact({ loadout = [], inventory = [], artifactId, maxSlots = 2 } = {}) {
  if (!ARTIFACTS[artifactId]) throw new RangeError(`Unknown artifact: ${artifactId}`);
  const owned = inventoryItemFor(inventory, artifactId);
  if (!owned || ((owned.quantity ?? 0) <= 0 && (owned.charges ?? 0) <= 0)) {
    throw new RangeError(`Artifact not owned: ${artifactId}`);
  }
  const next = clone(loadout || []).filter(slot => slot?.artifactId !== artifactId);
  next.unshift(slotFromInventoryItem(owned));
  return next.slice(0, maxSlots);
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
    prepared.loadout = artifactIds.map(artifactId => {
      const owned = inventoryItemFor(inventory, artifactId);
      if (!owned || ((owned.quantity ?? 0) <= 0 && (owned.charges ?? 0) <= 0)) {
        throw new RangeError(`Artifact not owned: ${artifactId}`);
      }
      return slotFromInventoryItem(owned);
    });
  } else {
    prepared.loadout = clone(prepared.loadout || []);
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

  const supportApplied = normalizeSupport(selectedSupport);
  total += supportApplied;
  addPart(parts, 'support', supportApplied);

  const provision = workingMember.provisionState?.rollBonus;
  if ((provision?.uses ?? 0) > 0) {
    total += provision.amount;
    addPart(parts, 'provision', provision.amount);
  }

  const debuff = workingMember.debuff;
  if (debuff && debuff.type !== 'exhausted') {
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
} = {}) {
  const dayKey = utcDayKey(now);
  const regenerated = regenerateAp(member || {}, dayKey);
  const nextMember = normalizeRoleDay({ ...(clone(member || {})), ...regenerated }, dayKey);
  if ((nextMember.ap ?? 0) < 1) throw new RangeError('member does not have enough AP');
  if (['hidden', 'locked'].includes(room?.state)) throw new RangeError('room is not unlocked');

  const nextRoom = clone(room || {});
  const nextExpedition = clone(expedition || {});
  const nextAction = clone(action || {});
  const events = [];
  const role = ROLES[nextMember.role];
  const canUseRoleAbility = Boolean(useRoleAbility && role && !nextMember.roleAbilityUsed);
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

  if (canUseRoleAbility && role.ability === 'blessing') {
    modifiers.total += 2;
    modifiers.parts.push({ source: 'role_ability:blessing', amount: 2 });
    nextMember.roleAbilityUsed = true;
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

  const shieldProtected = canUseRoleAbility && role.ability === 'shield_wall' && initialRawRoll === 1;
  let progressAwarded = progressForRoll({
    rawRoll,
    modifiedRoll,
    naturalOneProtected: shieldProtected,
  });
  if (shieldProtected && progressAwarded === 0) {
    progressAwarded = 1;
    events.push({ type: 'natural_one_protected' });
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

function canFinishExpedition({ expedition, userId, rooms = [] } = {}) {
  if (expedition?.status === 'finished') return false;
  const bossDefeated = expedition?.status === 'boss_defeated'
    || rooms.some(room => room.type === 'boss' && (room.bossDefeated || room.state === 'cleared'));
  if (!bossDefeated) return false;
  if ((expedition.startedBy ?? expedition.started_by) === userId) return true;
  return rooms.every(room => room.state === 'cleared');
}

function assertMutationInput({ transaction, idempotencyKey } = {}) {
  if (!idempotencyKey) throw new TypeError('idempotencyKey is required');
  if (!transaction || transaction.inTransaction !== true || typeof transaction.prepare !== 'function') {
    throw new TypeError('mutation requires an active caller transaction');
  }
}

function orchestrationStub(options = {}, actionType) {
  assertMutationInput(options);
  return clone({
    actionType,
    idempotencyKey: options.idempotencyKey,
    state: options.state || {},
  });
}

function createExpedition(options) {
  return orchestrationStub(options, 'create_expedition');
}

function prepareMember(options) {
  return orchestrationStub(options, 'prepare_member');
}

function attemptRoom(options) {
  return orchestrationStub(options, 'attempt_room');
}

function assistRoom(options) {
  return orchestrationStub(options, 'assist_room');
}

function revealRoom(options) {
  return orchestrationStub(options, 'reveal_room');
}

function equipFoundArtifactForMember(options) {
  return orchestrationStub(options, 'equip_found_artifact');
}

function finishExpedition(options) {
  return orchestrationStub(options, 'finish_expedition');
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
