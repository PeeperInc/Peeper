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

test('family prep exposes prepared hero health without leaking it for unprepared members', () => {
  const state = serializeExpeditionState({
    snapshot: {
      expedition: {
        id: 1,
        familyId: 2,
        themeId: 'root_king',
        status: 'active',
        map: { rooms: [], edges: [] },
      },
      rooms: [],
      members: [{
        userId: 10,
        role: 'knight',
        ap: 2,
        heroHp: 1,
        heroRecoverAt: 12345,
      }],
      actions: [],
    },
    familyMembers: [
      { userId: 10, firstName: 'Wounded' },
      { userId: 11, firstName: 'Waiting' },
    ],
  });

  assert.equal(state.familyMembers[0].heroHp, 1);
  assert.equal(state.familyMembers[0].heroRecoverAt, 12345);
  assert.equal(state.familyMembers[1].prepared, false);
  assert.equal(state.familyMembers[1].heroHp, undefined);
  assert.equal(state.familyMembers[1].heroRecoverAt, undefined);
});
