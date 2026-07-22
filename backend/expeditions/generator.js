const { ROOM_TEMPLATES, THEME_ID } = require('./catalog');

const REQUIRED_ROOM_COUNT = 18;
const OPTIONAL_ROOM_COUNT = 5;
const TREASURE_ROOM_COUNT = 2;
const TOTAL_ROOM_COUNT = REQUIRED_ROOM_COUNT + OPTIONAL_ROOM_COUNT + 2;
const { isDeepStrictEqual } = require('node:util');

const ACTION_STATS = ['might', 'agility', 'arcana', 'spirit'];
const EVENT_ROOM_TYPES = ['trap', 'arcane', 'exploration', 'shrine', 'mystery'];
const REQUIRED_ROOM_TYPES = ['combat', ...EVENT_ROOM_TYPES];
const OPTIONAL_ROOM_TYPES = ['combat', ...EVENT_ROOM_TYPES];

function createSeededRandom(seed) {
  let hash = 2166136261;
  const value = String(seed);

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return function random() {
    hash += 0x6d2b79f5;
    let result = hash;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function choose(rng, values) {
  return values[randomInt(rng, 0, values.length - 1)];
}

function chooseWeighted(rng, weighted) {
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return weighted[0]?.value;
  let cursor = rng() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.value;
  }
  return weighted.at(-1)?.value;
}

function chooseCombatTemplate(rng, encounterHistory = []) {
  const templates = ROOM_TEMPLATES.combat;
  const lastEnemyId = encounterHistory.at(-1) || null;
  const weighted = templates.map(template => {
    const lastIndex = encounterHistory.lastIndexOf(template.enemyId);
    const distance = lastIndex < 0 ? Infinity : encounterHistory.length - lastIndex;
    const recencyWeight = distance === Infinity
      ? 8
      : distance <= 1
        ? 0
        : Math.min(1, (distance / 6) ** 2);
    const difficultyWeight = Math.max(1, 13 - Number(template.attackTarget || 10));
    return {
      value: template,
      weight: template.enemyId === lastEnemyId ? 0 : recencyWeight * difficultyWeight,
    };
  });
  const selected = chooseWeighted(rng, weighted)
    || templates.find(template => template.enemyId !== lastEnemyId)
    || templates[0];
  encounterHistory.push(selected.enemyId);
  return selected;
}

function cloneTemplate(template, placement) {
  return {
    ...JSON.parse(JSON.stringify(template)),
    ...placement,
  };
}

function chooseTemplate(rng, types) {
  const type = choose(rng, types);
  return choose(rng, ROOM_TEMPLATES[type]);
}

function chooseEncounterTemplate(rng, types, encounterHistory = []) {
  const available = new Set(types);
  if (available.has('combat') && rng() < 0.7) {
    return chooseCombatTemplate(rng, encounterHistory);
  }
  const eventTypes = EVENT_ROOM_TYPES.filter(type => available.has(type));
  return choose(rng, ROOM_TEMPLATES[choose(rng, eventTypes.length > 0 ? eventTypes : types)]);
}

function createsLongEventStreak(plan, index, type) {
  if (type === 'combat') return false;
  return (
    (plan[index - 1] !== 'combat' && plan[index - 2] !== 'combat')
    || (plan[index - 1] !== 'combat' && plan[index + 1] !== 'combat')
    || (plan[index + 1] !== 'combat' && plan[index + 2] !== 'combat')
  );
}

function buildRequiredTypePlan(rng, encounterCount) {
  const combatCount = Math.max(1, Math.round(encounterCount * 0.7));
  const eventCount = Math.max(0, encounterCount - combatCount);
  const plan = Array.from({ length: encounterCount }, () => 'combat');
  const eventTypes = [];

  for (let index = 0; index < eventCount; index += 1) {
    eventTypes.push(choose(rng, EVENT_ROOM_TYPES));
  }

  for (const eventType of eventTypes) {
    const candidates = plan
      .map((type, index) => ({ type, index, weight: rng() }))
      .filter(candidate => candidate.type === 'combat')
      .filter(candidate => !createsLongEventStreak(plan, candidate.index, eventType))
      .sort((left, right) => left.weight - right.weight);

    const targetIndex = candidates[0]?.index ?? plan.findIndex(type => type === 'combat');
    plan[targetIndex] = eventType;
  }

  return plan;
}

function createRoom(template, sequence, depth, placement) {
  return cloneTemplate(template, {
    key: `${template.type}_${sequence}`,
    depth,
    ...placement,
  });
}

function scoutChoiceRoom(template, targetRoom) {
  const { key, depth, required, optional, state, progress, ...gameplay } = cloneTemplate(template, {});
  const room = {
    ...gameplay,
    key: targetRoom.key,
    depth: targetRoom.depth,
  };
  if (targetRoom.required !== undefined) room.required = targetRoom.required;
  if (targetRoom.optional !== undefined) room.optional = targetRoom.optional;
  return room;
}

function buildScoutChoices(rng, targetRoom, encounterHistory = []) {
  const choices = [{
    id: `choice-${targetRoom.key}-default`,
    targetKey: targetRoom.key,
    label: targetRoom.name || targetRoom.id || targetRoom.type,
    room: scoutChoiceRoom(targetRoom, targetRoom),
  }];
  const usedTypes = new Set([targetRoom.type]);
  let guard = 0;

  while (choices.length < 3 && guard < 40) {
    guard += 1;
    const availableTypes = REQUIRED_ROOM_TYPES.filter(type => !usedTypes.has(type));
    const template = chooseEncounterTemplate(rng, availableTypes, encounterHistory);
    if (usedTypes.has(template.type)) continue;
    usedTypes.add(template.type);
    choices.push({
      id: `choice-${targetRoom.key}-${template.type}`,
      targetKey: targetRoom.key,
      label: template.name || template.id || template.type,
      room: scoutChoiceRoom(template, targetRoom),
    });
  }

  return choices;
}

function buildRequiredSpine(rng, encounterCount, encounterHistory = []) {
  const camp = createRoom(ROOM_TEMPLATES.camp[0], 0, 0, { required: true });
  const rooms = [camp];
  const typePlan = buildRequiredTypePlan(rng, encounterCount);

  for (let index = 0; index < encounterCount; index += 1) {
    const roomType = typePlan[index] || 'combat';
    const template = roomType === 'combat'
      ? chooseCombatTemplate(rng, encounterHistory)
      : choose(rng, ROOM_TEMPLATES[roomType]);
    rooms.push(createRoom(template, index + 1, index + 1, { required: true }));
  }

  return rooms;
}

function attachOptionalBranches(rng, rooms, optionalCount, treasureCount, encounterHistory = []) {
  const requiredRooms = [...rooms];
  const optionalTemplates = [];

  for (let index = 0; index < treasureCount; index += 1) {
    optionalTemplates.push(choose(rng, ROOM_TEMPLATES.treasure));
  }
  for (let index = treasureCount; index < optionalCount; index += 1) {
    optionalTemplates.push(chooseEncounterTemplate(rng, OPTIONAL_ROOM_TYPES, encounterHistory));
  }

  for (let index = optionalTemplates.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(rng, 0, index);
    [optionalTemplates[index], optionalTemplates[swapIndex]] =
      [optionalTemplates[swapIndex], optionalTemplates[index]];
  }

  const optionalRooms = optionalTemplates.map((template, index) => {
    const source = choose(rng, requiredRooms.slice(0, -1));
    const room = createRoom(template, rooms.length + index, source.depth + 1, { optional: true });
    return { room, sourceKey: source.key };
  });

  return optionalRooms;
}

function appendBoss(rooms) {
  const template = ROOM_TEMPLATES.boss[0];
  const depth = Math.max(...rooms.map(room => room.depth)) + 1;
  return createRoom(template, rooms.length, depth, { required: true });
}

function actionStatsFor(rooms) {
  const stats = new Set();
  if (!Array.isArray(rooms)) return stats;

  for (const room of rooms) {
    if (!isPlainObject(room) || !Array.isArray(room.actions)) continue;
    for (const action of room.actions) {
      if (isPlainObject(action) && typeof action.stat === 'string') stats.add(action.stat);
    }
  }
  return stats;
}

function hasAllActionStats(rooms) {
  const stats = actionStatsFor(rooms);
  return ACTION_STATS.every(stat => stats.has(stat));
}

function enforceStatCoverage(rng, rooms) {
  const proceduralRooms = rooms.filter(room => !['camp', 'boss'].includes(room.type));
  if (hasAllActionStats(proceduralRooms)) return rooms;

  const authoredCandidates = REQUIRED_ROOM_TYPES.flatMap(type => ROOM_TEMPLATES[type]);
  const requiredProceduralCount = rooms.filter(room => room.required && !['camp', 'boss'].includes(room.type)).length;
  const minRequiredCombatCount = Math.round(requiredProceduralCount * 0.7);
  const replacementIndexes = rooms
    .map((room, index) => ({ room, index }))
    .filter(({ room }) => room.required && !['camp', 'boss'].includes(room.type));
  const validReplacements = replacementIndexes.flatMap(({ room, index }) => {
    const remainingRooms = proceduralRooms.filter(candidate => candidate !== room);
    return authoredCandidates
      .filter(template => {
        if (!hasAllActionStats([...remainingRooms, template])) return false;
        const nextRequiredRooms = rooms.map((candidate, candidateIndex) => (
          candidateIndex === index ? template : candidate
        )).filter(candidate => candidate.required && !['camp', 'boss'].includes(candidate.type));
        const nextCombatCount = nextRequiredRooms.filter(candidate => candidate.type === 'combat').length;
        return nextCombatCount >= minRequiredCombatCount;
      })
      .map(template => ({ room, index, template }));
  });

  if (validReplacements.length === 0) {
    throw new Error('Authored room templates cannot cover all action stats');
  }

  const { room, index, template } = choose(rng, validReplacements);
  const placement = { key: room.key, depth: room.depth, required: true };
  const coveredRooms = [...rooms];
  coveredRooms[index] = cloneTemplate(template, placement);
  return coveredRooms;
}

function generateExpeditionMap(seed) {
  const normalizedSeed = String(seed);
  const rng = createSeededRandom(normalizedSeed);
  const requiredCount = REQUIRED_ROOM_COUNT;
  const optionalCount = OPTIONAL_ROOM_COUNT;
  const treasureCount = TREASURE_ROOM_COUNT;
  const encounterHistory = [];
  const requiredRooms = enforceStatCoverage(rng, buildRequiredSpine(rng, requiredCount, encounterHistory));
  const optionalBranches = attachOptionalBranches(rng, requiredRooms, optionalCount, treasureCount, encounterHistory);
  const boss = appendBoss(requiredRooms);
  const rooms = [...requiredRooms, ...optionalBranches.map(branch => branch.room), boss];
  const edges = [];

  for (let index = 1; index < requiredRooms.length; index += 1) {
    edges.push({ from: requiredRooms[index - 1].key, to: requiredRooms[index].key });
    requiredRooms[index - 1].scoutChoices = buildScoutChoices(rng, requiredRooms[index], encounterHistory);
  }
  edges.push({ from: requiredRooms.at(-1).key, to: boss.key });
  for (const branch of optionalBranches) {
    edges.push({ from: branch.sourceKey, to: branch.room.key });
  }

  const proceduralRooms = rooms.filter(room => room.type !== 'camp' && room.type !== 'boss');
  if (!hasAllActionStats(proceduralRooms)) {
    throw new Error('Authored room templates do not cover all action stats');
  }

  return { version: 1, seed: normalizedSeed, themeId: THEME_ID, rooms, edges };
}

function isBossReachable(map) {
  try {
    if (!isPlainObject(map) || !Array.isArray(map.rooms) || !Array.isArray(map.edges)) return false;
    const camps = map.rooms.filter(room => isPlainObject(room) && room.type === 'camp');
    const bosses = map.rooms.filter(room => isPlainObject(room) && room.type === 'boss');
    if (camps.length !== 1 || bosses.length !== 1) return false;

    const roomsByKey = validRoomsByKey(map.rooms);
    const outgoing = buildForwardAdjacency(map.edges, roomsByKey);
    return reachableKeys(camps[0].key, outgoing).has(bosses[0].key);
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function isJsonData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value) && !isPlainObject(value)) return false;
  if (seen.has(value)) return false;

  const ownKeys = Reflect.ownKeys(value);
  const expectedKeys = Array.isArray(value)
    ? [...Array.from({ length: value.length }, (_, index) => String(index)), 'length']
    : Object.keys(value);
  if (ownKeys.length !== expectedKeys.length) return false;
  if (ownKeys.some((key, index) => key !== expectedKeys[index])) return false;

  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (Array.isArray(value) && key === 'length') continue;
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
  }

  seen.add(value);
  const safe = ownKeys.every(key => key === 'length' || isJsonData(value[key], seen));
  seen.delete(value);
  return safe;
}

function isLosslessJson(value) {
  if (!isJsonData(value)) return false;
  try {
    return isDeepStrictEqual(JSON.parse(JSON.stringify(value)), value);
  } catch {
    return false;
  }
}

function validRoomsByKey(rooms) {
  const roomsByKey = new Map();
  for (const room of rooms) {
    if (isPlainObject(room) && typeof room.key === 'string' && room.key.length > 0) {
      roomsByKey.set(room.key, room);
    }
  }
  return roomsByKey;
}

function buildForwardAdjacency(edges, roomsByKey) {
  const outgoing = new Map();
  for (const edge of edges) {
    if (!isPlainObject(edge) || typeof edge.from !== 'string' || typeof edge.to !== 'string') continue;
    const from = roomsByKey.get(edge.from);
    const to = roomsByKey.get(edge.to);
    if (!from || !to || !Number.isInteger(from.depth) || !Number.isInteger(to.depth)) continue;
    if (from.depth >= to.depth) continue;
    const destinations = outgoing.get(edge.from) || [];
    destinations.push(edge.to);
    outgoing.set(edge.from, destinations);
  }
  return outgoing;
}

function reachableKeys(startKey, adjacency) {
  const pending = [startKey];
  const visited = new Set();
  while (pending.length > 0) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    pending.push(...(adjacency.get(key) || []));
  }
  return visited;
}

function validateExpeditionMapShape(map) {
  const errors = [];
  if (!isPlainObject(map)) return ['Map must be a plain object'];
  if (!Array.isArray(map.rooms) || !Array.isArray(map.edges)) {
    return ['Map must contain rooms and edges arrays'];
  }

  const validTypes = new Set(Object.keys(ROOM_TEMPLATES));
  const validKeys = [];
  for (const room of map.rooms) {
    if (!isPlainObject(room)) {
      errors.push('Every room must be a plain object');
      continue;
    }
    if (typeof room.key !== 'string' || room.key.length === 0) {
      errors.push('Every room must have a non-empty string key');
    } else {
      validKeys.push(room.key);
    }
    if (!Number.isInteger(room.depth) || room.depth < 0) {
      errors.push('Every room must have a non-negative integer depth');
    }
    if (typeof room.type !== 'string' || !validTypes.has(room.type)) {
      errors.push('Every room must have an authored room type');
    }
    if (!Array.isArray(room.actions) || room.actions.length === 0) {
      errors.push('Every room must have a non-empty actions array');
    } else {
      for (const action of room.actions) {
        if (!isPlainObject(action) || !ACTION_STATS.includes(action.stat)) {
          errors.push('Every action must be an object with a valid stat');
        }
      }
    }
  }

  if (new Set(validKeys).size !== validKeys.length) errors.push('Room keys must be unique');
  const camps = map.rooms.filter(room => isPlainObject(room) && room.type === 'camp');
  const bosses = map.rooms.filter(room => isPlainObject(room) && room.type === 'boss');
  if (camps.length !== 1) errors.push('Map must contain exactly one camp');
  if (bosses.length !== 1) errors.push('Map must contain exactly one boss');
  if (map.rooms[0]?.type !== 'camp') errors.push('Camp must be the first room');
  if (map.rooms.at(-1)?.type !== 'boss') errors.push('Boss must be the last room');

  const requiredCount = map.rooms.filter(
    room => isPlainObject(room) && room.required && room.type !== 'camp' && room.type !== 'boss',
  ).length;
  const optionalCount = map.rooms.filter(room => isPlainObject(room) && room.optional).length;
  const treasureCount = map.rooms.filter(
    room => isPlainObject(room) && room.type === 'treasure',
  ).length;
  if (map.rooms.length !== TOTAL_ROOM_COUNT) errors.push(`Map must have exactly ${TOTAL_ROOM_COUNT} rooms`);
  if (requiredCount !== REQUIRED_ROOM_COUNT) errors.push(`Map must have exactly ${REQUIRED_ROOM_COUNT} required rooms`);
  if (optionalCount !== OPTIONAL_ROOM_COUNT) errors.push(`Map must have exactly ${OPTIONAL_ROOM_COUNT} optional rooms`);
  if (treasureCount !== TREASURE_ROOM_COUNT) errors.push(`Map must have exactly ${TREASURE_ROOM_COUNT} treasure rooms`);
  if (!hasAllActionStats(map.rooms)) errors.push('Map must cover all four action stats');

  const roomsByKey = validRoomsByKey(map.rooms);
  for (const edge of map.edges) {
    if (!isPlainObject(edge) || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      errors.push('Every edge must have string from and to keys');
      continue;
    }
    const from = roomsByKey.get(edge.from);
    const to = roomsByKey.get(edge.to);
    if (!from || !to) {
      errors.push('Every edge must reference existing rooms');
    } else if (!Number.isInteger(from.depth) || !Number.isInteger(to.depth) || from.depth >= to.depth) {
      errors.push('Every edge must point forward');
    }
  }

  if (camps.length === 1 && bosses.length === 1) {
    const outgoing = buildForwardAdjacency(map.edges, roomsByKey);
    const reachableFromCamp = reachableKeys(camps[0].key, outgoing);
    if ([...roomsByKey.keys()].some(key => !reachableFromCamp.has(key))) {
      errors.push('Every room must be reachable from camp');
    }

    const reverse = new Map();
    for (const [from, destinations] of outgoing) {
      for (const to of destinations) {
        const sources = reverse.get(to) || [];
        sources.push(from);
        reverse.set(to, sources);
      }
    }
    const reachesBoss = reachableKeys(bosses[0].key, reverse);
    const requiredRooms = map.rooms.filter(room => isPlainObject(room) && room.required);
    if (requiredRooms.some(room => !reachesBoss.has(room.key))) {
      errors.push('Every required room must have a forward path to boss');
    }
    if (!reachableFromCamp.has(bosses[0].key)) errors.push('Boss must be reachable from camp');
  } else {
    errors.push('Boss must be reachable from camp');
  }

  if (!isLosslessJson(map)) errors.push('Map must contain only lossless JSON data');

  return [...new Set(errors)];
}

function validateExpeditionMap(map) {
  try {
    return validateExpeditionMapShape(map);
  } catch {
    return ['Map contains malformed data that could not be validated'];
  }
}

module.exports = {
  ACTION_STATS,
  createSeededRandom,
  chooseCombatTemplate,
  randomInt,
  buildRequiredSpine,
  attachOptionalBranches,
  appendBoss,
  hasAllActionStats,
  enforceStatCoverage,
  generateExpeditionMap,
  isBossReachable,
  validateExpeditionMap,
};
