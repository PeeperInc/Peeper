import assert from 'node:assert/strict';
import test from 'node:test';
import serializerModule from './serializer.js';

const { serializeExpeditionState } = serializerModule;

test('visible combat rooms expose their actual armor class', () => {
  const state = serializeExpeditionState({
    snapshot: {
      expedition: {
        id: 1,
        familyId: 2,
        themeId: 'root_king',
        status: 'active',
        map: { rooms: [{ key: 'combat-1' }], edges: [] },
      },
      rooms: [{
        id: 10,
        key: 'combat-1',
        type: 'combat',
        state: 'unlocked',
        progress: 0,
        progressTarget: 18,
        attackTarget: 7,
        enemyId: 'hollow_archer',
      }],
      members: [],
      actions: [],
    },
  });

  assert.equal(state.map.rooms[0].attackTarget, 7);
});
