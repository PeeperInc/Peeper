'use strict';

const {
  AP_REGEN_SECONDS,
  ARTIFACTS,
  DAILY_AP,
  MAX_AP,
  PROGRESS_BANDS,
  PROVISIONS,
  ROLES,
} = require('./catalog');
const { applyArtifactEffects } = require('./artifactEffects');
const {
  LOOT_TABLES,
  grantArtifact,
  rollCoins,
  rollPersonalLoot,
} = require('./loot');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_SUPPORT = 6;
const ASSIST_SUPPORT = 2;
const BOSS_REWARD_AP_REQUIREMENT = 3;
const HERO_RECOVERY_SECONDS = 6 * 60 * 60;
const BOSS_REWARD_LOOT = Object.freeze({
  coins: Object.freeze({ min: 40, max: 70 }),
  artifactRolls: 1,
});
const FARM_PRODUCT_NAMES = Object.freeze({
  carrot: 'Carrot',
  tomato: 'Tomato',
  potato: 'Potato',
  egg: 'Egg',
  milk: 'Milk',
  truffle: 'Truffle',
  magic_squash: 'Magic Squash',
});

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

function unixSeconds(value = Date.now()) {
  const time = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(time)) throw new TypeError('A valid timestamp is required');
  return Math.floor(Math.abs(time) > 1_000_000_000_000 ? time / 1000 : time);
}

function memberApRegenAt(member, fallbackNow = unixSeconds()) {
  if (Number.isInteger(member?.apRegenAt) && member.apRegenAt > 0) return member.apRegenAt;
  if (Number.isInteger(member?.ap_regen_at) && member.ap_regen_at > 0) return member.ap_regen_at;
  if (Number.isInteger(member?.apRegenDay)) return member.apRegenDay * 24 * 60 * 60;
  if (Number.isInteger(member?.ap_regen_day)) return member.ap_regen_day * 24 * 60 * 60;
  return fallbackNow;
}

function regenerateAp(member, now = unixSeconds()) {
  const currentTime = unixSeconds(now);
  const currentAp = Math.min(MAX_AP, Math.max(0, Math.floor(Number(member?.ap ?? DAILY_AP))));
  const previousRegenAt = Math.min(currentTime, memberApRegenAt(member, currentTime));

  if (currentAp >= MAX_AP) {
    return {
      ap: MAX_AP,
      apRegenAt: currentTime,
      apRegenDay: utcDayKey(currentTime),
    };
  }

  const elapsedIntervals = Math.floor(Math.max(0, currentTime - previousRegenAt) / AP_REGEN_SECONDS);
  if (elapsedIntervals <= 0) {
    return {
      ap: currentAp,
      apRegenAt: previousRegenAt,
      apRegenDay: utcDayKey(previousRegenAt),
    };
  }

  const granted = Math.min(elapsedIntervals, MAX_AP - currentAp);
  const nextAp = currentAp + granted;
  const apRegenAt = nextAp >= MAX_AP
    ? currentTime
    : previousRegenAt + granted * AP_REGEN_SECONDS;
  return {
    ap: nextAp,
    apRegenAt,
    apRegenDay: utcDayKey(apRegenAt),
  };
}

function recoverHeroIfReady(member, now = unixSeconds()) {
  const currentTime = unixSeconds(now);
  const recoverAt = Number(member?.heroRecoverAt ?? member?.hero_recover_at ?? 0);
  if (recoverAt > 0 && recoverAt <= currentTime) {
    return {
      ...clone(member || {}),
      heroHp: 3,
      heroRecoverAt: null,
    };
  }
  return clone(member || {});
}

function assertHeroCanAct(member, now = unixSeconds()) {
  const recoverAt = Number(member?.heroRecoverAt ?? member?.hero_recover_at ?? 0);
  if (recoverAt > unixSeconds(now) || Number(member?.heroHp ?? 3) <= 0) {
    throw new RangeError('hero is recovering');
  }
}

function progressForRoll({ rawRoll, modifiedRoll, naturalOneProtected = false }) {
  if (rawRoll === 20) return 5;
  if (rawRoll === 1 && !naturalOneProtected) return 0;
  const band = PROGRESS_BANDS.find(({ max }) => modifiedRoll <= max);
  return band?.progress ?? 0;
}

function combatRollOutcome(rawRoll) {
  if (rawRoll <= 5) return { label: 'hero_hit', heroDamage: 1, progress: 0 };
  if (rawRoll <= 8) return { label: 'standoff', heroDamage: 0, progress: 0 };
  if (rawRoll <= 15) return { label: 'enemy_hit', heroDamage: 0, progress: 1 };
  if (rawRoll <= 19) return { label: 'enemy_hit_hard', heroDamage: 0, progress: 2 };
  return { label: 'critical_hit', heroDamage: 0, progress: 3 };
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

function actionForMemberRole(room = {}, member = {}) {
  const actions = Array.isArray(room.actions) ? room.actions : [];
  const role = ROLES[member?.role];
  if (role) {
    const matching = actions.find(candidate => candidate.stat === role.stat);
    if (matching) return matching;
  }
  const weakRole = (room.weakRoles || []).find(candidate => ROLES[candidate]);
  if (weakRole) {
    const matching = actions.find(candidate => candidate.stat === ROLES[weakRole].stat);
    if (matching) return matching;
  }
  return actions[0] || null;
}

function threatStateFor(threat, threatMax = 5) {
  if (!threat || threat <= 0) return null;
  if (threat >= threatMax) return 'enraged';
  if (threat >= 2) return 'guarded';
  return 'uneasy';
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

function consumeProvisionRecipe(transaction, userId, provisionId, now) {
  if (!provisionId) return null;
  const provision = PROVISIONS[provisionId];
  if (!provision) throw new RangeError(`Unknown provision: ${provisionId}`);
  const { productId, quantity } = provision.recipe || {};
  if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError(`Invalid provision recipe: ${provisionId}`);
  }
  const row = transaction.prepare(`
    SELECT quantity
    FROM farm_inventory
    WHERE user_id = ? AND product_id = ?
  `).get(userId, productId);
  if (!row || row.quantity < quantity) {
    throw new RangeError(`Not enough ${FARM_PRODUCT_NAMES[productId] || productId}`);
  }
  transaction.prepare(`
    UPDATE farm_inventory
    SET quantity = quantity - ?, updated_at = ?
    WHERE user_id = ? AND product_id = ? AND quantity >= ?
  `).run(quantity, now, userId, productId, quantity);
  transaction.prepare('DELETE FROM farm_inventory WHERE user_id = ? AND quantity <= 0').run(userId);
  return { productId, quantity };
}

function lootTableForRoom(room = {}) {
  if (room.type === 'boss') return { name: 'boss', table: LOOT_TABLES.boss };
  if ((room.tags || []).includes('elite')) return { name: 'elite', table: LOOT_TABLES.elite };
  return { name: 'base', table: LOOT_TABLES.base };
}

function upgradedLootTable(name) {
  if (name === 'base') return { name: 'elite', table: LOOT_TABLES.elite };
  return { name: 'boss', table: LOOT_TABLES.boss };
}

function rollAttemptLoot({ room = {}, member, rawRoll, rng }) {
  const roomLoot = room.loot || {};
  const criticalRolls = rawRoll === 20 ? 1 + (room.criticalBonusLootRolls || 0) : 0;
  const coins = rollCoins(roomLoot.coins || { min: 0, max: 0 }, rng);
  const artifactRolls = Math.max(0, Number(roomLoot.artifactRolls || 0) + criticalRolls);
  let table = lootTableForRoom(room);
  const upgrade = member.provisionState?.upgradeLootRarity;
  if ((upgrade?.uses ?? 0) > 0 && artifactRolls > 0) {
    for (let index = 0; index < (upgrade.tiers || 1); index += 1) {
      table = upgradedLootTable(table.name);
    }
    upgrade.uses -= 1;
  }
  const rolled = rollPersonalLoot({
    coinRange: { min: 0, max: 0 },
    artifactRolls,
    table: table.table,
    rng,
  });
  return {
    coins,
    artifacts: rolled.artifacts,
    artifactRolls,
    table: table.name,
  };
}

function grantPersonalLoot({ transaction, userId, loot = {}, rng = () => 0, now }) {
  let coinsAwarded = Math.max(0, Math.floor(Number(loot.coins || 0)));
  const artifactGrants = [];
  for (const artifactId of loot.artifacts || []) {
    const grant = grantArtifact({ transaction, userId, artifactId, rng, now });
    artifactGrants.push(grant);
    if (grant.kind === 'coins') coinsAwarded += grant.coins;
  }
  if (coinsAwarded > 0) {
    transaction.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(coinsAwarded, userId);
  }
  return {
    ...loot,
    coins: coinsAwarded,
    artifactGrants,
  };
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

function mechanicChoiceOption(room = {}, mechanicChoice = null) {
  if (!mechanicChoice) return null;
  const options = room?.miniMechanic?.options || [];
  const option = options.find(candidate => candidate.id === mechanicChoice);
  if (!option) throw new RangeError(`Unknown mechanic choice: ${mechanicChoice}`);
  return option;
}

function mechanicChoiceEffect(room = {}, mechanicChoice = null) {
  const option = mechanicChoiceOption(room, mechanicChoice);
  if (!option) return { rollBonus: 0, threatDelta: 0 };
  const effects = {
    safe_path: { rollBonus: 1, threatDelta: -1 },
    listen: { rollBonus: 1, threatDelta: -1 },
    fast_path: { rollBonus: 2, threatDelta: 0 },
    bait: { rollBonus: 2, threatDelta: 0 },
    greedy_path: { rollBonus: 3, threatDelta: 1 },
  };
  return effects[option.id] || { rollBonus: 1, threatDelta: 0 };
}

function buildRollModifiers({
  expedition = {},
  member,
  room,
  action,
  selectedSupport = 0,
  mechanicChoice = null,
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

  const mechanicEffect = mechanicChoiceEffect(workingRoom, mechanicChoice);
  total += mechanicEffect.rollBonus;
  addPart(parts, `mechanic:${mechanicChoice}`, mechanicEffect.rollBonus);

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
  mechanicChoice = null,
  roll,
  reroll,
  rng = () => 0,
  now = unixSeconds(),
  useRoleAbility = false,
  useSharedBuff = false,
} = {}) {
  const dayKey = utcDayKey(now);
  const regenerated = regenerateAp(member || {}, now);
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
    mechanicChoice,
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
  const encounterType = nextRoom.encounterType || nextRoom.type;
  const combatRoom = nextRoom.type === 'boss' || ['combat', 'boss'].includes(encounterType);
  const combatRollValue = Math.max(1, Math.min(20, modifiedRoll));
  const combatOutcome = combatRoom ? combatRollOutcome(combatRollValue) : null;
  let progressAwarded = progressForRoll({
    rawRoll,
    modifiedRoll,
    naturalOneProtected: shieldProtected && initialRawRoll === 1,
  });
  if (combatOutcome) {
    progressAwarded = combatOutcome.progress;
    const heroDamage = shieldProtected ? 0 : combatOutcome.heroDamage;
    if (heroDamage > 0) {
      nextMember.heroHp = Math.max(0, Number(nextMember.heroHp ?? 3) - heroDamage);
      events.push({ type: 'hero_damaged', amount: heroDamage, heroHp: nextMember.heroHp });
    }
    events.push({
      type: 'combat_roll',
      outcome: combatOutcome.label,
      roll: combatRollValue,
      progress: combatOutcome.progress,
      heroDamage,
    });
  }
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

  if (nextRoom.state === 'cleared') {
    nextRoom.threat = 0;
    nextRoom.threatState = null;
  } else if (progressAwarded === 0) {
    const threatMax = Math.max(1, Number(nextRoom.threatMax || 5));
    const mechanicEffect = mechanicChoiceEffect(nextRoom, mechanicChoice);
    const threatGain = Math.max(0, (rawRoll === 1 ? 2 : 1) + mechanicEffect.threatDelta);
    nextRoom.threat = Math.min(threatMax, Math.max(0, Number(nextRoom.threat || 0)) + threatGain);
    nextRoom.threatState = threatStateFor(nextRoom.threat, threatMax);
    if (threatGain > 0) events.push({ type: 'threat_gained', amount: threatGain, threat: nextRoom.threat });
  } else {
    const currentThreat = Math.max(0, Number(nextRoom.threat || 0));
    nextRoom.threat = currentThreat;
    nextRoom.threatState = threatStateFor(currentThreat, nextRoom.threatMax || 5);
  }

  if (Number(nextMember.heroHp ?? 3) <= 0) {
    nextMember.heroHp = 0;
    nextMember.heroRecoverAt = now + HERO_RECOVERY_SECONDS;
    events.push({ type: 'hero_recovering', recoverAt: nextMember.heroRecoverAt });
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

  const roomClearedByAttempt = (
    nextRoom.state === 'cleared'
    && nextRoom.type !== 'boss'
    && previousProgress < (nextRoom.progressTarget || Infinity)
  );
  const lootRoom = roomClearedByAttempt
    ? nextRoom
    : {
        ...nextRoom,
        // Room treasure opens only when the room is cleared. Natural-20 and
        // artifact-driven bonus loot can still apply through the normal hooks.
        loot: { coins: { min: 0, max: 0 }, artifactRolls: 0 },
      };
  const loot = rollAttemptLoot({ room: lootRoom, member: nextMember, rawRoll, rng });
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
  if (loot.artifactRolls !== loot.artifacts.length) {
    const rolled = rollPersonalLoot({
      coinRange: { min: 0, max: 0 },
      artifactRolls: loot.artifactRolls,
      table: LOOT_TABLES[loot.table] || lootTableForRoom(lootRoom).table,
      rng,
    });
    loot.artifacts = rolled.artifacts;
  }
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
  const regenerated = regenerateAp(member || {}, now);
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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value ?? null;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
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
  expectedIntent = null,
}) {
  const action = transaction.prepare(`
    SELECT expedition_id AS expeditionId, action_type AS actionType, modifier_json AS modifierJson
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
  if (expectedIntent !== null) {
    const storedIntent = parseJson(action.modifierJson, {}).intent;
    if (stableStringify(storedIntent) !== stableStringify(expectedIntent)) {
      throw new Error('idempotency conflict: key was already used with different intent');
    }
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
  const heroRecoverAt = row.hero_recover_at ?? null;
  return {
    expeditionId: row.expedition_id,
    userId: row.user_id,
    role: row.role,
    ap: row.ap,
    apRegenDay: row.ap_regen_day,
    apRegenAt: row.ap_regen_at,
    heroHp: row.hero_hp ?? 3,
    heroRecoverAt,
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
  intent = null,
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
    stringifyJson(intent === null ? modifiers : { ...modifiers, intent: stableValue(intent) }),
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
      ap_regen_at = ?,
      hero_hp = ?,
      hero_recover_at = ?,
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
    memberResult.apRegenAt ?? memberResult.apRegenDay * 24 * 60 * 60,
    Math.max(0, Math.min(3, Number(memberResult.heroHp ?? 3))),
    memberResult.heroRecoverAt ?? null,
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

function updateRoomDefinition(transaction, expeditionId, roomResult) {
  transaction.prepare(`
    UPDATE family_expedition_rooms SET
      room_type = ?,
      state = ?,
      progress = ?,
      progress_target = ?,
      support = ?,
      payload_json = ?,
      unlocked_at = ?,
      cleared_at = ?
    WHERE expedition_id = ? AND room_key = ?
  `).run(
    roomResult.type,
    roomResult.state,
    roomResult.progress || 0,
    roomResult.progressTarget || 1,
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

function applyScoutChoiceToTarget(source, target, choice, userId, now) {
  const choiceRoom = clone(choice.room || {});
  return {
    ...target,
    ...choiceRoom,
    key: target.key,
    depth: target.depth,
    required: target.required,
    optional: target.optional,
    state: target.state,
    progress: 0,
    support: target.support || 0,
    unlockedAt: target.unlockedAt,
    clearedAt: target.clearedAt,
    scoutChosenFrom: source.key,
    scoutChosenBy: userId,
    scoutChosenAt: now,
    scoutChoiceId: choice.id,
  };
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
  const intent = { familyId, startedBy, themeId, seed: seed || null, map };
  const replay = findIdempotentAction(transaction, {
    userId: startedBy,
    idempotencyKey,
    expectedActionType: 'create_expedition',
    expectedIntent: intent,
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
    intent,
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
  const intent = { expeditionId, userId, role, provisionId, artifactIds };
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'prepare_member',
    expectedExpeditionId: expeditionId,
    expectedIntent: intent,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);
  if (!ROLES[role]) throw new RangeError(`Unknown role: ${role}`);
  consumeProvisionRecipe(transaction, userId, provisionId, now);
  const dayKey = utcDayKey(now);
  const prepared = prepareMemberLoadout({
    member: {
      userId,
      role,
      ap: DAILY_AP,
      apRegenDay: dayKey,
      apRegenAt: now,
      heroHp: 3,
      heroRecoverAt: null,
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
      expedition_id, user_id, role, ap, ap_regen_day, ap_regen_at, hero_hp, hero_recover_at, role_ability_day, role_ability_used,
      provision_id, provision_state_json, loadout_json, debuff_json, prepared_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(expedition_id, user_id) DO UPDATE SET
      role = excluded.role,
      ap = excluded.ap,
      ap_regen_day = excluded.ap_regen_day,
      ap_regen_at = excluded.ap_regen_at,
      hero_hp = excluded.hero_hp,
      hero_recover_at = excluded.hero_recover_at,
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
    prepared.apRegenAt,
    prepared.heroHp ?? 3,
    prepared.heroRecoverAt ?? null,
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
    intent,
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
    mechanicChoice = null,
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
  const room = rowToRoom(getRoomRow(transaction, expeditionId, roomKey));
  const memberRow = getMemberRow(transaction, expeditionId, userId);
  const memberState = recoverHeroIfReady(rowToMember(memberRow), now);
  assertHeroCanAct(memberState, now);
  const action = actionId
    ? (room.actions || []).find(candidate => candidate.id === actionId)
    : actionForMemberRole(room, memberState);
  if (!action) throw new RangeError(`Unknown action: ${actionId}`);
  const normalizedMechanicChoice = mechanicChoiceOption(room, mechanicChoice)?.id || null;
  const intent = {
    expeditionId,
    userId,
    roomKey,
    actionId: action.id,
    mechanicChoice: normalizedMechanicChoice,
    selectedSupport,
    roll: roll ?? null,
    reroll: reroll ?? null,
    useRoleAbility,
    useSharedBuff,
  };
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'attempt',
    expectedExpeditionId: expeditionId,
    expectedIntent: intent,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);
  if (room.state === 'cleared') throw new RangeError('room is already cleared');
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
    mechanicChoice: normalizedMechanicChoice,
    roll,
    reroll,
    rng,
    now,
    useRoleAbility,
    useSharedBuff,
  });
  updateMember(transaction, expeditionId, result.member, { ap: 1, progress: result.progressAwarded });
  updateRoom(transaction, expeditionId, result.room);
  const grantedLoot = grantPersonalLoot({
    transaction,
    userId,
    loot: result.loot,
    rng,
    now,
  });
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
    modifiers: { ...result.modifiers, events: result.events || [] },
    intent,
    modifiedRoll: result.modifiedRoll,
    progressAwarded: result.progressAwarded,
    loot: grantedLoot,
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
  const intent = { expeditionId, userId, roomKey };
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'assist',
    expectedExpeditionId: expeditionId,
    expectedIntent: intent,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);
  const room = rowToRoom(getRoomRow(transaction, expeditionId, roomKey));
  const memberState = recoverHeroIfReady(rowToMember(getMemberRow(transaction, expeditionId, userId)), now);
  assertHeroCanAct(memberState, now);
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
    intent,
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
  const intent = { expeditionId, userId, fromRoomKey, roomKey };
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'reveal_room',
    expectedExpeditionId: expeditionId,
    expectedIntent: intent,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);
  const connected = (snapshot.expedition.map.edges || [])
    .some(edge => edge.from === fromRoomKey && edge.to === roomKey);
  if (!connected) throw new RangeError('room is not connected');
  const memberState = recoverHeroIfReady(rowToMember(getMemberRow(transaction, expeditionId, userId)), now);
  assertHeroCanAct(memberState, now);
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
    intent,
    now,
  });
  return readSnapshot(transaction, expeditionId);
}

function chooseScoutRoom(options) {
  assertMutationInput(options);
  const {
    transaction,
    idempotencyKey,
    expeditionId,
    userId,
    fromRoomKey,
    choiceId,
    now = Math.floor(Date.now() / 1000),
  } = options;
  const snapshot = readSnapshot(transaction, expeditionId);
  assertExpeditionNotFinished(snapshot);
  const intent = { expeditionId, userId, fromRoomKey, choiceId };
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'scout_choice',
    expectedExpeditionId: expeditionId,
    expectedIntent: intent,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);

  const source = rowToRoom(getRoomRow(transaction, expeditionId, fromRoomKey));
  if (!['unlocked', 'cleared'].includes(source.state)) {
    throw new RangeError('source room is not available');
  }
  if (source.scoutChoice?.choiceId) {
    throw new RangeError('next room is already chosen');
  }
  const choices = Array.isArray(source.scoutChoices) ? source.scoutChoices : [];
  const choice = choices.find(candidate => candidate.id === choiceId);
  if (!choice) throw new RangeError('unknown scout choice');

  const memberState = recoverHeroIfReady(rowToMember(getMemberRow(transaction, expeditionId, userId)), now);
  assertHeroCanAct(memberState, now);
  const dayKey = utcDayKey(now);
  const scout = normalizeRoleDay(memberState, dayKey);
  if (scout.role !== 'scout') throw new RangeError('only scouts can choose the next room');
  if (scout.roleAbilityUsed) throw new RangeError('scout choice ability is already used');

  const targetKey = choice.targetKey || choice.room?.key;
  const connected = (snapshot.expedition.map.edges || [])
    .some(edge => edge.from === fromRoomKey && edge.to === targetKey);
  if (!connected) throw new RangeError('choice target is not connected');
  const target = rowToRoom(getRoomRow(transaction, expeditionId, targetKey));
  if (['unlocked', 'cleared'].includes(target.state)) {
    throw new RangeError('target room is already open');
  }

  const nextSource = {
    ...source,
    scoutChoice: {
      choiceId: choice.id,
      targetKey,
      label: choice.label || choice.room?.name || 'Chosen path',
      chosenBy: userId,
      chosenAt: now,
    },
  };
  const nextTarget = applyScoutChoiceToTarget(source, target, choice, userId, now);
  scout.roleAbilityUsed = true;

  updateRoom(transaction, expeditionId, nextSource);
  updateRoomDefinition(transaction, expeditionId, nextTarget);
  updateMember(transaction, expeditionId, scout);
  insertAction(transaction, {
    idempotencyKey,
    expeditionId,
    roomId: source.id,
    userId,
    actionType: 'scout_choice',
    modifiers: { choiceId: choice.id, targetKey },
    intent,
    now,
  });
  return readSnapshot(transaction, expeditionId);
}

function completeEventRoom(options) {
  assertMutationInput(options);
  const {
    transaction,
    idempotencyKey,
    expeditionId,
    userId,
    roomKey,
    score = 0,
    rng = () => 0,
    now = Math.floor(Date.now() / 1000),
  } = options;
  let snapshot = readSnapshot(transaction, expeditionId);
  assertExpeditionNotFinished(snapshot);
  const normalizedScore = Math.max(0, Math.min(100, Math.floor(Number(score || 0))));
  const intent = { expeditionId, userId, roomKey, score: normalizedScore };
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'event_minigame',
    expectedExpeditionId: expeditionId,
    expectedIntent: intent,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);

  const room = rowToRoom(getRoomRow(transaction, expeditionId, roomKey));
  if (room.state === 'cleared') throw new RangeError('room is already cleared');
  if (['hidden', 'locked'].includes(room.state)) throw new RangeError('room is not unlocked');
  if ((room.encounterType || room.type) === 'combat' || ['boss', 'camp'].includes(room.type)) {
    throw new RangeError('event minigame is not available in this room');
  }

  const memberState = recoverHeroIfReady(rowToMember(getMemberRow(transaction, expeditionId, userId)), now);
  assertHeroCanAct(memberState, now);
  const dayKey = utcDayKey(now);
  const nextMember = normalizeRoleDay({ ...memberState, ...regenerateAp(memberState, now) }, dayKey);
  if ((nextMember.ap ?? 0) < 1) throw new RangeError('member does not have enough AP');
  nextMember.ap -= 1;

  const previousProgress = room.progress || 0;
  const rawProgress = normalizedScore >= 90 ? 2 : normalizedScore >= 60 ? 1 : 0;
  const nextRoom = { ...room };
  nextRoom.progress = Math.max(
    previousProgress,
    Math.min(nextRoom.progressTarget || Infinity, previousProgress + rawProgress),
  );
  const appliedProgress = Math.max(0, nextRoom.progress - previousProgress);
  if (nextRoom.progress >= (nextRoom.progressTarget || Infinity)) {
    nextRoom.state = 'cleared';
    nextRoom.clearedAt = now;
    nextRoom.threat = 0;
    nextRoom.threatState = null;
  }

  updateMember(transaction, expeditionId, nextMember, { ap: 1, progress: appliedProgress });
  updateRoom(transaction, expeditionId, nextRoom);
  let grantedLoot = {};
  if (nextRoom.state === 'cleared' && previousProgress < (nextRoom.progressTarget || Infinity)) {
    grantedLoot = grantPersonalLoot({
      transaction,
      userId,
      loot: rollAttemptLoot({ room: nextRoom, member: nextMember, rawRoll: 20, rng }),
      rng,
      now,
    });
    persistUnlocks(transaction, expeditionId, snapshot.expedition.map, nextRoom.key, now);
    snapshot = readSnapshot(transaction, expeditionId);
  }
  insertAction(transaction, {
    idempotencyKey,
    expeditionId,
    roomId: room.id,
    userId,
    actionType: 'event_minigame',
    modifiers: { score: normalizedScore, events: [{ type: 'event_minigame', score: normalizedScore }] },
    intent,
    progressAwarded: appliedProgress,
    loot: grantedLoot,
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
  const intent = { expeditionId, userId, artifactId, slotIndex: slotIndex ?? null };
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'equip_found_artifact',
    expectedExpeditionId: expeditionId,
    expectedIntent: intent,
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
    intent,
    now,
  });
  return readSnapshot(transaction, expeditionId);
}

function claimBossReward(options) {
  assertMutationInput(options);
  const {
    transaction,
    idempotencyKey,
    expeditionId,
    userId,
    rng = () => 0,
    now = Math.floor(Date.now() / 1000),
  } = options;
  const intent = { expeditionId, userId };
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'claim_boss_reward',
    expectedExpeditionId: expeditionId,
    expectedIntent: intent,
  });
  if (replay) return readSnapshot(transaction, replay.expeditionId);

  const snapshot = readSnapshot(transaction, expeditionId);
  if (!['boss_defeated', 'finished'].includes(snapshot.expedition.status)) {
    throw new RangeError('boss reward is not ready');
  }
  const memberState = rowToMember(getMemberRow(transaction, expeditionId, userId));
  if ((memberState.contributionAp || 0) < BOSS_REWARD_AP_REQUIREMENT) {
    throw new RangeError(`Boss reward requires at least ${BOSS_REWARD_AP_REQUIREMENT} AP contribution`);
  }
  if (memberState.bossRewardClaimedAt) throw new RangeError('boss reward already claimed');

  const rolled = rollPersonalLoot({
    coinRange: BOSS_REWARD_LOOT.coins,
    artifactRolls: BOSS_REWARD_LOOT.artifactRolls,
    table: LOOT_TABLES.boss,
    rng,
  });
  const grantedLoot = grantPersonalLoot({
    transaction,
    userId,
    loot: { ...rolled, artifactRolls: rolled.artifacts.length, table: 'boss' },
    rng,
    now,
  });
  transaction.prepare(`
    UPDATE family_expedition_members
    SET boss_reward_claimed_at = ?
    WHERE expedition_id = ? AND user_id = ?
  `).run(now, expeditionId, userId);
  const bossRoom = snapshot.rooms.find(candidate => candidate.type === 'boss') || snapshot.rooms[0];
  insertAction(transaction, {
    idempotencyKey,
    expeditionId,
    roomId: bossRoom.id,
    userId,
    actionType: 'claim_boss_reward',
    modifiers: { contributionAp: memberState.contributionAp },
    intent,
    loot: grantedLoot,
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
  const intent = { expeditionId, userId };
  const replay = findIdempotentAction(transaction, {
    userId,
    idempotencyKey,
    expectedActionType: 'finish_expedition',
    expectedExpeditionId: expeditionId,
    expectedIntent: intent,
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
    intent,
    now,
  });
  return readSnapshot(transaction, expeditionId);
}

module.exports = {
  utcDayKey,
  regenerateAp,
  recoverHeroIfReady,
  combatRollOutcome,
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
  chooseScoutRoom,
  completeEventRoom,
  equipFoundArtifactForMember,
  claimBossReward,
  finishExpedition,
};
