import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  chooseCombatTemplate,
  createSeededRandom,
  generateExpeditionMap,
  isBossReachable,
  validateExpeditionMap,
} = require('./generator.js');
const { ROOM_TEMPLATES } = require('./catalog.js');

const STATS = ['might', 'agility', 'arcana', 'spirit'];

test('generator creates deterministic reachable root king maps', () => {
  const first = generateExpeditionMap('seed-123');
  const second = generateExpeditionMap('seed-123');

  assert.deepEqual(first, second);
  assert.equal(first.version, 1);
  assert.equal(first.themeId, 'root_king');
  assert.equal(first.rooms[0].type, 'camp');
  assert.equal(first.rooms.at(-1).type, 'boss');
  assert.equal(isBossReachable(first), true);
  assert.deepEqual(validateExpeditionMap(first), []);
});

test('generator satisfies structural constraints across 500 seeds', () => {
  for (let index = 0; index < 500; index += 1) {
    const map = generateExpeditionMap(`structural-${index}`);
    const requiredRooms = map.rooms.filter(room => room.required && room.type !== 'camp' && room.type !== 'boss');
    const optionalRooms = map.rooms.filter(room => room.optional);
    const treasureRooms = map.rooms.filter(room => room.type === 'treasure');
    const roomKeys = new Set(map.rooms.map(room => room.key));
    const proceduralRooms = map.rooms.filter(room => room.type !== 'camp' && room.type !== 'boss');
    const actionStats = new Set(proceduralRooms.flatMap(room => room.actions.map(action => action.stat)));

    assert.equal(requiredRooms.length >= 8 && requiredRooms.length <= 12, true, map.seed);
    const requiredCombatCount = requiredRooms.filter(room => room.type === 'combat').length;
    assert.equal(
      requiredCombatCount >= Math.round(requiredRooms.length * 0.7),
      true,
      `${map.seed}: expected combat-heavy required path, got ${requiredCombatCount}/${requiredRooms.length}`,
    );
    let eventStreak = 0;
    for (const room of requiredRooms) {
      eventStreak = room.type === 'combat' ? 0 : eventStreak + 1;
      assert.equal(eventStreak <= 2, true, `${map.seed}: too many event rooms in a row`);
    }
    assert.equal(optionalRooms.length >= 3 && optionalRooms.length <= 5, true, map.seed);
    assert.equal(treasureRooms.length >= 1 && treasureRooms.length <= 2, true, map.seed);
    assert.equal(roomKeys.size, map.rooms.length, map.seed);
    assert.deepEqual([...actionStats].sort(), [...STATS].sort(), map.seed);
    assert.equal(isBossReachable(map), true, map.seed);
    assert.deepEqual(validateExpeditionMap(map), [], map.seed);

    for (const edge of map.edges) {
      const from = map.rooms.find(room => room.key === edge.from);
      const to = map.rooms.find(room => room.key === edge.to);
      assert.ok(from, `${map.seed}: missing edge source`);
      assert.ok(to, `${map.seed}: missing edge target`);
      assert.equal(from.depth < to.depth, true, `${map.seed}: cycle/back edge`);
    }
  }
});

test('generated event rooms expose varied mini-game contracts', () => {
  const kinds = new Set();

  for (let index = 0; index < 80; index += 1) {
    const map = generateExpeditionMap(`minigame-variety-${index}`);
    for (const room of map.rooms) {
      if (room.required && !['camp', 'boss', 'combat'].includes(room.type)) {
        assert.ok(room.miniGame?.kind, `${room.key} is missing miniGame.kind`);
        kinds.add(room.miniGame.kind);
      }
    }
  }

  assert.ok(kinds.size >= 4, `expected varied mini-games, received ${[...kinds].join(', ')}`);
});

test('generation guarantees procedural stat coverage for coverage-probe-892690', () => {
  const map = generateExpeditionMap('coverage-probe-892690');
  const proceduralRooms = map.rooms.filter(room => room.type !== 'camp' && room.type !== 'boss');
  const stats = new Set(proceduralRooms.flatMap(room => room.actions.map(action => action.stat)));

  assert.deepEqual([...stats].sort(), [...STATS].sort());
  assert.deepEqual(validateExpeditionMap(map), []);
});

test('combat quota survives stat coverage enforcement for known low-combat seed', () => {
  const map = generateExpeditionMap('probe-fixed-2');
  const requiredRooms = map.rooms.filter(room => room.required && room.type !== 'camp' && room.type !== 'boss');
  const combatCount = requiredRooms.filter(room => room.type === 'combat').length;

  assert.equal(combatCount >= Math.round(requiredRooms.length * 0.7), true);
});

test('generated required paths offer three scout choices for the next room', () => {
  const map = generateExpeditionMap('scout-choice-generation');
  const requiredSources = map.rooms.filter(room => (
    room.required
    && room.type !== 'boss'
    && map.edges.some(edge => {
      const target = map.rooms.find(candidate => candidate.key === edge.to);
      return edge.from === room.key && target?.required && target.type !== 'boss';
    })
  ));

  assert.ok(requiredSources.length > 0);
  for (const room of requiredSources) {
    assert.equal(room.scoutChoices.length, 3, `${room.key} should expose three choices`);
    const targetKeys = new Set(room.scoutChoices.map(choice => choice.targetKey));
    const typeLabels = new Set(room.scoutChoices.map(choice => choice.room.type));
    assert.equal(targetKeys.size, 1, `${room.key} choices should point at the same next slot`);
    assert.equal(typeLabels.size, 3, `${room.key} choices should be visibly different room types`);
  }
});

test('different seeds produce meaningful map content variety', () => {
  const contentSignature = map => JSON.stringify({
    themeId: map.themeId,
    rooms: map.rooms,
    edges: map.edges,
  });
  const firstMap = generateExpeditionMap('variety-0');
  const seedOnlyVariants = [
    firstMap,
    { ...firstMap, seed: 'different-seed-with-identical-content' },
  ];
  const maps = new Set(
    Array.from(
      { length: 20 },
      (_, index) => contentSignature(generateExpeditionMap(`variety-${index}`)),
    ),
  );

  assert.equal(new Set(seedOnlyVariants.map(contentSignature)).size, 1);
  assert.ok(maps.size >= 10, `expected at least 10 distinct maps, received ${maps.size}`);
});

test('generated maps serialize without losing Infinity-free payload data', () => {
  const map = generateExpeditionMap('json-safe');
  assert.deepEqual(JSON.parse(JSON.stringify(map)), map);
});

test('generated room gameplay data comes from authored templates', () => {
  const authoredTemplates = new Map(
    Object.values(ROOM_TEMPLATES).flat().map(template => [template.id, template]),
  );

  for (let index = 0; index < 50; index += 1) {
    const map = generateExpeditionMap(`authored-${index}`);

    for (const room of map.rooms) {
      const { key, depth, required, optional, ...gameplayData } = room;
      const authoredGameplayData = { ...authoredTemplates.get(room.id) };
      delete gameplayData.scoutChoices;
      delete authoredGameplayData.optional;
      assert.ok(key);
      assert.equal(Number.isInteger(depth), true);
      assert.deepEqual(gameplayData, authoredGameplayData, `${map.seed}: ${room.id}`);
    }
  }
});

test('combat HP trends down as armor class rises without changing event targets', () => {
  assert.deepEqual(ROOM_TEMPLATES.combat.map(room => room.progressTarget), [28, 26, 25, 25, 24, 24, 23, 23, 22, 21, 20, 18]);
  assert.deepEqual(ROOM_TEMPLATES.combat.map(room => room.attackTarget), [6, 6, 6, 7, 7, 7, 8, 8, 9, 10, 11, 12]);
  assert.deepEqual(ROOM_TEMPLATES.boss.map(room => room.progressTarget), [41, 48, 55]);
  assert.deepEqual(ROOM_TEMPLATES.boss.map(room => room.attackTarget), [12, 13, 14]);
  assert.deepEqual(ROOM_TEMPLATES.trap.map(room => room.progressTarget), [4, 4]);
  assert.deepEqual(ROOM_TEMPLATES.arcane.map(room => room.progressTarget), [5, 5]);
  assert.deepEqual(ROOM_TEMPLATES.exploration.map(room => room.progressTarget), [5, 4]);
  assert.deepEqual(ROOM_TEMPLATES.shrine.map(room => room.progressTarget), [4, 4]);
  assert.deepEqual(ROOM_TEMPLATES.mystery.map(room => room.progressTarget), [4, 3]);
});

test('combat selection never repeats the previous enemy and strongly favors unseen enemies', () => {
  const history = [];
  const rng = createSeededRandom('enemy-rotation');
  const selected = Array.from({ length: 40 }, () => chooseCombatTemplate(rng, history).enemyId);

  for (let index = 1; index < selected.length; index += 1) {
    assert.notEqual(selected[index], selected[index - 1]);
  }
  assert.ok(new Set(selected.slice(0, 12)).size >= 9, `expected broad opening rotation, got ${selected.slice(0, 12).join(', ')}`);
  assert.equal(new Set(selected).size, 12);
});

test('validation reports backward edges and an unreachable boss', () => {
  const map = generateExpeditionMap('invalid-graph');
  const camp = map.rooms[0];
  const boss = map.rooms.at(-1);
  const invalidMap = {
    ...map,
    edges: [{ from: boss.key, to: camp.key }],
  };

  assert.equal(isBossReachable(invalidMap), false);
  assert.ok(validateExpeditionMap(invalidMap).some(error => error.includes('forward')));
  assert.ok(validateExpeditionMap(invalidMap).some(error => error.includes('reachable')));
});

test('validation requires exactly one camp and one boss', () => {
  const map = generateExpeditionMap('room-cardinality');
  const cases = [
    [{ ...map, rooms: map.rooms.filter(room => room.type !== 'camp') }, 'exactly one camp'],
    [{ ...map, rooms: map.rooms.filter(room => room.type !== 'boss') }, 'exactly one boss'],
    [{ ...map, rooms: [...map.rooms, { ...map.rooms[0], key: 'duplicate_camp' }] }, 'exactly one camp'],
    [{ ...map, rooms: [...map.rooms, { ...map.rooms.at(-1), key: 'duplicate_boss' }] }, 'exactly one boss'],
  ];

  for (const [invalidMap, expectedError] of cases) {
    const errors = validateExpeditionMap(invalidMap);
    assert.ok(errors.some(error => error.includes(expectedError)));
  }
});

test('validation rejects orphan required and optional rooms', () => {
  const map = generateExpeditionMap('orphan-rooms');
  const requiredRooms = map.rooms.filter(
    room => room.required && !['camp', 'boss'].includes(room.type),
  );
  const required = requiredRooms.at(-1);
  const optional = map.rooms.find(room => room.optional);
  const incoming = map.edges.find(edge => edge.to === required.key);
  const outgoing = map.edges.find(edge => edge.from === required.key);
  const orphanRequired = {
    ...map,
    edges: [
      ...map.edges.filter(edge => edge.to !== required.key),
      { from: incoming.from, to: outgoing.to },
    ],
  };
  const orphanOptional = {
    ...map,
    edges: map.edges.filter(edge => edge.to !== optional.key),
  };

  assert.equal(isBossReachable(orphanRequired), true);
  assert.ok(validateExpeditionMap(orphanRequired).some(error => error.includes('reachable from camp')));
  assert.ok(validateExpeditionMap(orphanOptional).some(error => error.includes('reachable from camp')));
});

test('validation requires every required room to have a forward path to boss', () => {
  const map = generateExpeditionMap('required-boss-path');
  const requiredRooms = map.rooms.filter(
    room => room.required && !['camp', 'boss'].includes(room.type),
  );
  const isolatedRequired = requiredRooms.at(-1);
  const invalidMap = {
    ...map,
    edges: map.edges.filter(edge => edge.from !== isolatedRequired.key),
  };

  assert.ok(validateExpeditionMap(invalidMap).some(error => error.includes('forward path to boss')));
});

test('validation is total over malformed map, room, action, and edge shapes', () => {
  const map = generateExpeditionMap('malformed-shapes');
  const malformedMaps = [
    null,
    {},
    { rooms: null, edges: [] },
    { rooms: [], edges: null },
    { ...map, rooms: [...map.rooms, null] },
    { ...map, rooms: map.rooms.map((room, index) => index === 1 ? { ...room, key: null } : room) },
    { ...map, rooms: map.rooms.map((room, index) => index === 1 ? { ...room, depth: 'one' } : room) },
    { ...map, rooms: map.rooms.map((room, index) => index === 1 ? { ...room, type: null } : room) },
    {
      ...map,
      rooms: map.rooms.map((room, index) => {
        if (index !== 1) return room;
        const { actions, ...roomWithoutActions } = room;
        return roomWithoutActions;
      }),
    },
    { ...map, rooms: map.rooms.map((room, index) => index === 1 ? { ...room, actions: null } : room) },
    { ...map, rooms: map.rooms.map((room, index) => index === 1 ? { ...room, actions: 'invalid' } : room) },
    { ...map, rooms: map.rooms.map((room, index) => index === 1 ? { ...room, actions: [null] } : room) },
    { ...map, edges: [...map.edges, null] },
    { ...map, edges: [...map.edges, {}] },
    { ...map, edges: 'not-an-array' },
  ];

  for (const invalidMap of malformedMaps) {
    assert.doesNotThrow(() => validateExpeditionMap(invalidMap));
    assert.ok(validateExpeditionMap(invalidMap).length > 0);
  }
});

test('validation rejects lossy and non-JSON data types', () => {
  const lossyValues = [
    new Map([['key', 'value']]),
    new Set(['value']),
    new Date('2026-06-22T00:00:00.000Z'),
    () => 'value',
    undefined,
    Infinity,
    Number.NaN,
    -0,
    Symbol('value'),
    1n,
    new Array(1),
  ];

  for (const value of lossyValues) {
    const invalidMap = { ...generateExpeditionMap('lossy-json'), lossy: value };
    const errors = validateExpeditionMap(invalidMap);
    assert.ok(errors.some(error => error.includes('lossless JSON')));
  }
});
