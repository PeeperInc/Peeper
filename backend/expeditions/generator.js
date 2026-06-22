const { ROOM_TEMPLATES, THEME_ID } = require('./catalog');
const { isDeepStrictEqual } = require('node:util');

const ACTION_STATS = ['might', 'agility', 'arcana', 'spirit'];
const REQUIRED_ROOM_TYPES = ['combat', 'trap', 'arcane', 'exploration', 'shrine', 'mystery'];
const OPTIONAL_ROOM_TYPES = ['combat', 'trap', 'arcane', 'exploration', 'shrine', 'mystery'];

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

function createRoom(template, sequence, depth, placement) {
  return cloneTemplate(template, {
    key: `${template.type}_${sequence}`,
    depth,
    ...placement,
  });
}

function buildRequiredSpine(rng, encounterCount) {
  const camp = createRoom(ROOM_TEMPLATES.camp[0], 0, 0, { required: true });
  const rooms = [camp];

  for (let index = 0; index < encounterCount; index += 1) {
    const template = chooseTemplate(rng, REQUIRED_ROOM_TYPES);
    rooms.push(createRoom(template, index + 1, index + 1, { required: true }));
  }

  return rooms;
}

function attachOptionalBranches(rng, rooms, optionalCount, treasureCount) {
  const requiredRooms = [...rooms];
  const optionalTemplates = [];

  for (let index = 0; index < treasureCount; index += 1) {
    optionalTemplates.push(choose(rng, ROOM_TEMPLATES.treasure));
  }
  for (let index = treasureCount; index < optionalCount; index += 1) {
    optionalTemplates.push(chooseTemplate(rng, OPTIONAL_ROOM_TYPES));
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
  const replacementIndexes = rooms
    .map((room, index) => ({ room, index }))
    .filter(({ room }) => room.required && !['camp', 'boss'].includes(room.type));
  const validReplacements = replacementIndexes.flatMap(({ room, index }) => {
    const remainingRooms = proceduralRooms.filter(candidate => candidate !== room);
    return authoredCandidates
      .filter(template => hasAllActionStats([...remainingRooms, template]))
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
  const requiredCount = randomInt(rng, 8, 12);
  const optionalCount = randomInt(rng, 3, 5);
  const treasureCount = randomInt(rng, 1, 2);
  const requiredRooms = enforceStatCoverage(rng, buildRequiredSpine(rng, requiredCount));
  const optionalBranches = attachOptionalBranches(rng, requiredRooms, optionalCount, treasureCount);
  const boss = appendBoss(requiredRooms);
  const rooms = [...requiredRooms, ...optionalBranches.map(branch => branch.room), boss];
  const edges = [];

  for (let index = 1; index < requiredRooms.length; index += 1) {
    edges.push({ from: requiredRooms[index - 1].key, to: requiredRooms[index].key });
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
  if (requiredCount < 8 || requiredCount > 12) errors.push('Map must have 8-12 required rooms');
  if (optionalCount < 3 || optionalCount > 5) errors.push('Map must have 3-5 optional rooms');
  if (treasureCount < 1 || treasureCount > 2) errors.push('Map must have 1-2 treasure rooms');
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
