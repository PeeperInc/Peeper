import assert from 'node:assert/strict';
import test from 'node:test';
import { preferredExpeditionRoomKey } from './expeditionRoomSelection.mjs';

const activeRooms = [
  { key: 'active-trap', state: 'unlocked', clearedAt: null, bossDefeated: false },
  { key: 'open-combat', state: 'unlocked', clearedAt: null, bossDefeated: false },
];

test('an unfinished mini-game room stays selected instead of alternating with the next room', () => {
  assert.equal(
    preferredExpeditionRoomKey(activeRooms, 'active-trap', 'active-trap'),
    'active-trap',
  );
  assert.equal(
    preferredExpeditionRoomKey(activeRooms, 'open-combat', 'active-trap'),
    'active-trap',
  );
});

test('normal room selection resumes after the pinned mini-game attempt is cleared', () => {
  const rooms = [
    { key: 'cleared-trap', state: 'cleared', clearedAt: 100 },
    { key: 'open-combat', state: 'unlocked', clearedAt: null, bossDefeated: false },
  ];

  assert.equal(
    preferredExpeditionRoomKey(rooms, 'cleared-trap', 'cleared-trap'),
    'open-combat',
  );
});
