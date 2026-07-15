'use strict';

const {
  ARTIFACTS,
  ROLES,
  PROVISIONS,
  THEME_ID,
} = require('./catalog');
const { canFinishExpedition } = require('./engine');
const { sanitizeMemberEventPayload } = require('./memberEvents');

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function definedObject(entries) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

function stripSensitive(value) {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (!value || typeof value !== 'object') return value;
  const hiddenKeys = new Set([
    'idempotencyKey',
    'telegramId',
    'telegram_id',
    'seed',
    'rngSeed',
    'rewardSeed',
    'futureLoot',
    'intent',
  ]);
  return Object.keys(value).reduce((result, key) => {
    if (hiddenKeys.has(key)) return result;
    result[key] = stripSensitive(value[key]);
    return result;
  }, {});
}

function serializeExpedition(expedition) {
  if (!expedition) return null;
  return definedObject([
    ['id', expedition.id],
    ['familyId', expedition.familyId],
    ['themeId', expedition.themeId],
    ['status', expedition.status],
    ['sharedBuffs', stripSensitive(expedition.sharedBuffs || {})],
    ['startedBy', expedition.startedBy],
    ['startedAt', expedition.startedAt],
    ['bossDefeatedAt', expedition.bossDefeatedAt],
    ['finishedAt', expedition.finishedAt],
  ]);
}

function safeAction(action) {
  if (!action) return action;
  return stripSensitive({
    id: action.id,
    label: action.label,
    description: action.description,
    stat: action.stat,
    difficulty: action.difficulty,
    modifier: action.modifier,
    tags: action.tags,
    narration: action.narration,
    complication: action.complication,
  });
}

function visibleRoom(room) {
  return definedObject([
    ['key', room.key],
    ['type', room.type],
    ['state', room.state],
    ['progress', room.progress],
    ['progressTarget', room.progressTarget],
    ['attackTarget', room.attackTarget],
    ['support', room.support],
    ['depth', room.depth],
    ['name', room.name],
    ['tags', clone(room.tags)],
    ['required', room.required],
    ['optional', room.optional],
    ['startingRoom', room.startingRoom],
    ['phase', room.phase],
    ['complication', room.complication],
    ['encounterType', room.encounterType],
    ['weakRoles', clone(room.weakRoles)],
    ['enemyIntent', room.enemyIntent],
    ['threat', room.threat],
    ['threatMax', room.threatMax],
    ['miniMechanic', stripSensitive(room.miniMechanic)],
    ['miniGame', stripSensitive(room.miniGame)],
    ['scoutChoices', stripSensitive(room.scoutChoices)],
    ['scoutChoice', stripSensitive(room.scoutChoice)],
    ['scoutChoiceId', room.scoutChoiceId],
    ['scoutChosenFrom', room.scoutChosenFrom],
    ['enemyId', room.enemyId],
    ['objectId', room.objectId],
    ['opening', stripSensitive(room.opening)],
    ['bossPhase', stripSensitive(room.bossPhase)],
    ['unlockedAt', room.unlockedAt],
    ['clearedAt', room.clearedAt],
    ['actions', Array.isArray(room.actions) ? room.actions.map(safeAction) : undefined],
    ['bossDefeated', room.bossDefeated],
    ['activeEffects', stripSensitive(room.activeEffects || [])],
  ]);
}

function hiddenRoom(room) {
  return definedObject([
    ['key', room.key],
    ['type', room.type],
    ['state', room.state],
    ['progress', room.progress],
    ['progressTarget', room.progressTarget],
    ['support', room.support],
    ['depth', room.depth],
    ['required', room.required],
    ['optional', room.optional],
  ]);
}

function serializeRooms(snapshot = {}) {
  const stateByKey = new Map((snapshot.rooms || []).map(room => [room.key, room]));
  const mapRooms = snapshot.expedition?.map?.rooms || [];
  const orderedKeys = new Set(mapRooms.map(room => room.key));
  const mergedRooms = mapRooms.map(room => ({ ...room, ...(stateByKey.get(room.key) || {}) }));

  for (const room of snapshot.rooms || []) {
    if (!orderedKeys.has(room.key)) mergedRooms.push(room);
  }

  const effectsByRoom = new Map();
  for (const effect of snapshot.roomEffects || []) {
    const effects = effectsByRoom.get(effect.roomId) || [];
    effects.push(effect);
    effectsByRoom.set(effect.roomId, effects);
  }
  return mergedRooms.map(room => {
    const withEffects = { ...room, activeEffects: effectsByRoom.get(room.id) || [] };
    return ['hidden', 'locked'].includes(room.state) ? hiddenRoom(withEffects) : visibleRoom(withEffects);
  });
}

function serializeMember(member) {
  if (!member) return null;
  return definedObject([
    ['userId', member.userId],
    ['role', member.role],
    ['ap', member.ap],
    ['apRegenDay', member.apRegenDay],
    ['apRegenAt', member.apRegenAt],
    ['heroHp', member.heroHp],
    ['heroRecoverAt', member.heroRecoverAt],
    ['roleAbilityDay', member.roleAbilityDay],
    ['roleAbilityUsed', member.roleAbilityUsed],
    ['roleCharge', member.roleCharge],
    ['roleChargeProgress', member.roleChargeProgress],
    ['roleChargeReadyAt', member.roleChargeReadyAt || 0],
    ['provisionId', member.provisionId],
    ['provisionState', stripSensitive(member.provisionState || {})],
    ['loadout', stripSensitive(member.loadout || [])],
    ['triggerHistory', stripSensitive(member.triggerHistory || [])],
    ['debuff', stripSensitive(member.debuff)],
    ['contributionAp', member.contributionAp],
    ['contributionProgress', member.contributionProgress],
    ['preparedAt', member.preparedAt],
    ['bossRewardClaimedAt', member.bossRewardClaimedAt],
  ]);
}

function memberUserId(row) {
  return row?.userId ?? row?.user_id ?? row?.id;
}

function serializeFamilyMembers(familyMembers = [], expeditionMembers = []) {
  const preparedByUser = new Map(expeditionMembers.map(member => [member.userId, member]));
  return familyMembers.map(row => {
    const userId = memberUserId(row);
    const prepared = preparedByUser.get(userId);
    return definedObject([
      ['userId', userId],
      ['firstName', row.firstName ?? row.first_name],
      ['username', row.username],
      ['photoUrl', row.photoUrl ?? row.photo_url],
      ['prepared', Boolean(prepared)],
      ['role', prepared?.role],
      ['ap', prepared?.ap],
      ['contributionAp', prepared?.contributionAp],
      ['contributionProgress', prepared?.contributionProgress],
      ['roleCharge', prepared?.roleCharge],
      ['roleChargeProgress', prepared?.roleChargeProgress],
    ]);
  });
}

function serializeAction(action) {
  const privateEventTypes = new Set(['cleric_heal', 'cleric_recovery_reduced']);
  const events = (action.events || action.modifiers?.events || [])
    .filter(event => !privateEventTypes.has(event?.type));
  const modifiers = clone(action.modifiers || {});
  if (Array.isArray(modifiers.events)) modifiers.events = events;
  return definedObject([
    ['id', action.id],
    ['expeditionId', action.expeditionId],
    ['roomId', action.roomId],
    ['userId', action.userId],
    ['actionType', action.actionType],
    ['stat', action.stat],
    ['rawRoll', action.rawRoll],
    ['modifiers', stripSensitive(modifiers)],
    ['events', events.length > 0 ? stripSensitive(events) : undefined],
    ['modifiedRoll', action.modifiedRoll],
    ['progressAwarded', action.progressAwarded],
    ['loot', stripSensitive(action.loot || {})],
    ['narrationKey', action.narrationKey],
    ['createdAt', action.createdAt],
  ]);
}

function serializePersonalEvents(memberEvents = [], userId = null) {
  return memberEvents
    .filter(event => event.userId === undefined || event.userId === userId)
    .map(event => {
      const payload = sanitizeMemberEventPayload(event.payload, event.eventType);
      return definedObject([
        ['id', event.id],
        ['type', event.eventType],
        ...Object.entries(payload).filter(([key]) => key !== 'type'),
        ['createdAt', event.createdAt],
      ]);
    });
}

function serializeInventory(inventory = []) {
  return inventory.map(item => ({
    artifactId: item.artifactId ?? item.artifact_id,
    quantity: item.quantity,
    charges: item.charges,
  }));
}

function serializeArtifactCatalog() {
  return Object.values(ARTIFACTS).map(artifact => ({
    id: artifact.id,
    name: artifact.name,
    rarity: artifact.rarity,
    useType: artifact.useType,
    displayEffect: artifact.displayEffect,
    effect: clone(artifact.effect),
    useHint: artifact.useHint,
  }));
}

function serializePendingReward(reward) {
  if (!reward) return null;
  return definedObject([
    ['id', reward.id],
    ['expeditionId', reward.expeditionId ?? reward.expedition_id],
    ['payload', stripSensitive(reward.payload || {})],
    ['createdAt', reward.createdAt ?? reward.created_at],
    ['claimedAt', reward.claimedAt ?? reward.claimed_at],
  ]);
}

function serializePendingRewards(pendingRewards = [], userId = null) {
  return pendingRewards
    .filter(reward => userId == null || (reward.userId ?? reward.user_id) === userId)
    .filter(reward => (reward.claimedAt ?? reward.claimed_at) == null)
    .map(serializePendingReward);
}

function serializeProvisions(farmInventory = []) {
  const quantities = new Map(farmInventory.map(item => [
    item.productId ?? item.product_id,
    item.quantity || 0,
  ]));
  return Object.fromEntries(Object.entries(PROVISIONS).map(([id, provision]) => {
    const recipe = provision.recipe || null;
    const ownedQuantity = recipe?.productId ? (quantities.get(recipe.productId) || 0) : 0;
    return [id, {
      ...clone(provision),
      ownedQuantity,
      requiredQuantity: recipe?.quantity || 0,
      available: !recipe || ownedQuantity >= recipe.quantity,
    }];
  }));
}

function serializeExpeditionState({
  snapshot = null,
  userId = null,
  memberEvents = null,
  familyMembers = [],
  artifactInventory = [],
  farmInventory = [],
  pendingRewards = [],
  currentMinigameAttempt = null,
  canStart = false,
} = {}) {
  const expedition = snapshot?.expedition || null;
  const members = snapshot?.members || [];
  const member = members.find(candidate => candidate.userId === userId) || null;
  const rooms = snapshot?.rooms || [];
  const serializedPendingRewards = serializePendingRewards(pendingRewards, userId);

  return {
    expedition: serializeExpedition(expedition),
    map: {
      rooms: expedition ? serializeRooms(snapshot) : [],
      edges: expedition ? clone(expedition.map?.edges || []) : [],
    },
    member: serializeMember(member),
    familyMembers: serializeFamilyMembers(familyMembers, members),
    recentActions: (snapshot?.actions || []).slice(-20).map(serializeAction),
    personalEvents: serializePersonalEvents(memberEvents ?? snapshot?.memberEvents ?? [], userId),
    artifactInventory: serializeInventory(artifactInventory),
    pendingRewards: serializedPendingRewards,
    pendingRewardCount: serializedPendingRewards.length,
    currentMinigameAttempt: currentMinigameAttempt ? clone(currentMinigameAttempt) : null,
    catalog: {
      roles: clone(ROLES),
      provisions: serializeProvisions(farmInventory),
      artifacts: serializeArtifactCatalog(),
      theme: { id: expedition?.themeId || THEME_ID },
    },
    permissions: {
      canStart: Boolean(canStart),
      canPrepare: Boolean(expedition && expedition.status !== 'finished' && !member),
      canFinish: Boolean(expedition && canFinishExpedition({ expedition, userId, rooms })),
    },
  };
}

module.exports = { serializeExpeditionState, serializePendingReward };
