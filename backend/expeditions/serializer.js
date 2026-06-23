'use strict';

const { ROLES, PROVISIONS, THEME_ID } = require('./catalog');
const { canFinishExpedition } = require('./engine');

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
    ['support', room.support],
    ['depth', room.depth],
    ['name', room.name],
    ['tags', clone(room.tags)],
    ['required', room.required],
    ['optional', room.optional],
    ['startingRoom', room.startingRoom],
    ['phase', room.phase],
    ['complication', room.complication],
    ['unlockedAt', room.unlockedAt],
    ['clearedAt', room.clearedAt],
    ['actions', Array.isArray(room.actions) ? room.actions.map(safeAction) : undefined],
    ['bossDefeated', room.bossDefeated],
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

  return mergedRooms.map(room => room.state === 'hidden' ? hiddenRoom(room) : visibleRoom(room));
}

function serializeMember(member) {
  if (!member) return null;
  return definedObject([
    ['userId', member.userId],
    ['role', member.role],
    ['ap', member.ap],
    ['apRegenDay', member.apRegenDay],
    ['roleAbilityDay', member.roleAbilityDay],
    ['roleAbilityUsed', member.roleAbilityUsed],
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
    ]);
  });
}

function serializeAction(action) {
  return definedObject([
    ['id', action.id],
    ['expeditionId', action.expeditionId],
    ['roomId', action.roomId],
    ['userId', action.userId],
    ['actionType', action.actionType],
    ['stat', action.stat],
    ['rawRoll', action.rawRoll],
    ['modifiers', stripSensitive(action.modifiers || {})],
    ['modifiedRoll', action.modifiedRoll],
    ['progressAwarded', action.progressAwarded],
    ['loot', stripSensitive(action.loot || {})],
    ['narrationKey', action.narrationKey],
    ['createdAt', action.createdAt],
  ]);
}

function serializeInventory(inventory = []) {
  return inventory.map(item => ({
    artifactId: item.artifactId ?? item.artifact_id,
    quantity: item.quantity,
    charges: item.charges,
  }));
}

function serializeExpeditionState({
  snapshot = null,
  userId = null,
  familyMembers = [],
  artifactInventory = [],
  canStart = false,
} = {}) {
  const expedition = snapshot?.expedition || null;
  const members = snapshot?.members || [];
  const member = members.find(candidate => candidate.userId === userId) || null;
  const rooms = snapshot?.rooms || [];

  return {
    expedition: serializeExpedition(expedition),
    map: {
      rooms: expedition ? serializeRooms(snapshot) : [],
      edges: expedition ? clone(expedition.map?.edges || []) : [],
    },
    member: serializeMember(member),
    familyMembers: serializeFamilyMembers(familyMembers, members),
    recentActions: (snapshot?.actions || []).slice(-20).map(serializeAction),
    artifactInventory: serializeInventory(artifactInventory),
    catalog: {
      roles: clone(ROLES),
      provisions: clone(PROVISIONS),
      theme: { id: expedition?.themeId || THEME_ID },
    },
    permissions: {
      canStart: Boolean(canStart),
      canPrepare: Boolean(expedition && expedition.status !== 'finished' && !member),
      canFinish: Boolean(expedition && canFinishExpedition({ expedition, userId, rooms })),
    },
  };
}

module.exports = { serializeExpeditionState };
