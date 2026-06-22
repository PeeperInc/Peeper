import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
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
    const actionStats = new Set(map.rooms.flatMap(room => room.actions.map(action => action.stat)));

    assert.equal(requiredRooms.length >= 8 && requiredRooms.length <= 12, true, map.seed);
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

test('different seeds produce different maps', () => {
  const maps = new Set(
    Array.from({ length: 20 }, (_, index) => JSON.stringify(generateExpeditionMap(`variety-${index}`))),
  );
  assert.equal(maps.size, 20);
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
      delete authoredGameplayData.optional;
      assert.ok(key);
      assert.equal(Number.isInteger(depth), true);
      assert.deepEqual(gameplayData, authoredGameplayData, `${map.seed}: ${room.id}`);
    }
  }
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
