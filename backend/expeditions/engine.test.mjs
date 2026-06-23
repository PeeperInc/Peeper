import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('./engine.js');

const {
  utcDayKey,
  regenerateAp,
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
  equipFoundArtifactForMember,
  finishExpedition,
} = engine;

const camp = {
  key: 'camp_0',
  type: 'camp',
  progressTarget: 1,
  tags: ['camp'],
  state: 'cleared',
  progress: 1,
  required: true,
  actions: [{ id: 'tend_campfire', stat: 'spirit', modifier: 0, tags: ['camp'] }],
};

const hall = {
  key: 'hall_1',
  type: 'exploration',
  progressTarget: 4,
  tags: ['hidden_path'],
  state: 'unlocked',
  progress: 0,
  required: true,
  actions: [{ id: 'thread_gap', stat: 'agility', modifier: 2, tags: ['hidden_path'] }],
};

const optionalVault = {
  key: 'vault_1',
  type: 'treasure',
  progressTarget: 4,
  tags: ['sealed', 'lock'],
  state: 'hidden',
  progress: 0,
  optional: true,
  actions: [{ id: 'pick_vault', stat: 'agility', modifier: 2, tags: ['lock'] }],
};

const boss = {
  key: 'boss_1',
  type: 'boss',
  progressTarget: 8,
  tags: ['boss', 'root_creature'],
  state: 'locked',
  progress: 0,
  required: true,
  phase: 1,
  actions: [{ id: 'break_armor', stat: 'might', modifier: 0, tags: ['boss'] }],
};

const map = {
  rooms: [camp, hall, optionalVault, boss],
  edges: [
    { from: 'camp_0', to: 'hall_1' },
    { from: 'hall_1', to: 'vault_1' },
    { from: 'hall_1', to: 'boss_1' },
  ],
};

function member(overrides = {}) {
  return {
    userId: 10,
    role: 'scout',
    ap: 3,
    apRegenDay: utcDayKey(Date.UTC(2026, 5, 23)),
    roleAbilityDay: utcDayKey(Date.UTC(2026, 5, 23)),
    roleAbilityUsed: false,
    provisionState: {},
    loadout: [],
    debuff: null,
    triggerHistory: [],
    ...overrides,
  };
}

test('UTC day keys and AP regeneration add three per elapsed day and cap at six', () => {
  assert.equal(utcDayKey(Date.UTC(2026, 5, 23, 23, 59, 59)), 20627);
  assert.deepEqual(regenerateAp({ ap: 1, apRegenDay: 100 }, 102), {
    ap: 6,
    apRegenDay: 102,
  });
  assert.deepEqual(regenerateAp({ ap: 4, apRegenDay: 102 }, 102), {
    ap: 4,
    apRegenDay: 102,
  });
});

test('modified rolls map to progress bands with natural 1 and natural 20 overrides', () => {
  assert.equal(progressForRoll({ rawRoll: 1, modifiedRoll: 30 }), 0);
  assert.equal(progressForRoll({ rawRoll: 1, modifiedRoll: 30, naturalOneProtected: true }), 5);
  assert.equal(progressForRoll({ rawRoll: 10, modifiedRoll: 10 }), 1);
  assert.equal(progressForRoll({ rawRoll: 15, modifiedRoll: 15 }), 2);
  assert.equal(progressForRoll({ rawRoll: 19, modifiedRoll: 19 }), 3);
  assert.equal(progressForRoll({ rawRoll: 20, modifiedRoll: 3 }), 5);
});

test('roll modifiers include action difficulty, matching role bonus, provision, debuff, artifacts, and capped selected support', () => {
  const modifiers = buildRollModifiers({
    member: member({
      role: 'scout',
      provisionState: { rollBonus: { amount: 2, uses: 1 } },
      debuff: { type: 'frightened', stat: 'agility', amount: -2 },
      loadout: [{ artifactId: 'worn_gloves' }],
    }),
    room: hall,
    action: hall.actions[0],
    selectedSupport: 9,
    dayKey: 20627,
  });

  assert.equal(modifiers.total, 12);
  assert.equal(modifiers.supportApplied, 6);
  assert.deepEqual(modifiers.parts.map(part => part.source), [
    'action',
    'role',
    'support',
    'provision',
    'debuff',
    'artifact:worn_gloves',
  ]);
  assert.equal(modifiers.loadout[0].artifactId, 'worn_gloves');
});

test('resolveAttempt consumes AP, selected support, one-shot effects, and never regresses room progress', () => {
  const result = resolveAttempt({
    expedition: { id: 55, status: 'active' },
    member: member({
      ap: 2,
      role: 'scout',
      provisionState: { rollBonus: { amount: 2, uses: 1 } },
      debuff: { type: 'frightened', stat: 'agility', amount: -2 },
      loadout: [{ artifactId: 'rabbit_foot' }],
    }),
    room: { ...hall, progress: 3, support: 8 },
    action: hall.actions[0],
    selectedSupport: 7,
    roll: 7,
    rng: () => 0,
    now: Date.UTC(2026, 5, 23),
  });

  assert.equal(result.rawRoll, 7);
  assert.equal(result.modifiedRoll, 19);
  assert.equal(result.progressAwarded, 1);
  assert.equal(result.room.progress, 4);
  assert.equal(result.room.state, 'cleared');
  assert.equal(result.room.support, 2);
  assert.equal(result.member.ap, 1);
  assert.equal(result.member.provisionState.rollBonus.uses, 0);
  assert.equal(result.member.debuff, null);
  assert.equal(result.member.loadout[0].artifactId, 'rabbit_foot');
  assert.equal(Object.isFrozen(result), true);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('natural 1 can be protected by daily knight shield and natural 20 grants bonus loot roll', () => {
  const protectedMiss = resolveAttempt({
    expedition: { id: 56, status: 'active' },
    member: member({ role: 'knight', roleAbilityUsed: false }),
    room: { ...boss, state: 'unlocked' },
    action: boss.actions[0],
    roll: 1,
    useRoleAbility: true,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(protectedMiss.progressAwarded, 1);
  assert.equal(protectedMiss.member.roleAbilityUsed, true);
  assert.equal(protectedMiss.events.some(event => event.type === 'natural_one_protected'), true);

  const critical = resolveAttempt({
    expedition: { id: 56, status: 'active' },
    member: member({ role: 'knight' }),
    room: { ...boss, state: 'unlocked' },
    action: boss.actions[0],
    roll: 20,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(critical.progressAwarded, 5);
  assert.equal(critical.loot.artifactRolls, 1);
});

test('daily role abilities cover scout reveal, mage reroll, and cleric blessing', () => {
  const scout = resolveAttempt({
    expedition: { id: 57, status: 'active', map },
    member: member({ role: 'scout' }),
    room: hall,
    action: hall.actions[0],
    roll: 8,
    useRoleAbility: true,
    now: Date.UTC(2026, 5, 23),
  });
  assert.deepEqual(scout.revealedRoomKeys, ['vault_1']);

  const mage = resolveAttempt({
    expedition: { id: 57, status: 'active' },
    member: member({ role: 'mage' }),
    room: { ...hall, progress: 0 },
    action: hall.actions[0],
    roll: 4,
    reroll: 16,
    useRoleAbility: true,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(mage.rawRoll, 16);
  assert.equal(mage.events.some(event => event.type === 'role_reroll'), true);

  const cleric = resolveAttempt({
    expedition: { id: 57, status: 'active' },
    member: member({ role: 'cleric' }),
    room: { ...hall, progress: 0 },
    action: hall.actions[0],
    roll: 8,
    useRoleAbility: true,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(cleric.modifiedRoll, 12);
  assert.equal(cleric.modifiers.parts.some(part => part.source === 'role_ability:blessing'), true);
});

test('provisions grant AP, prevent debuffs, protect minimum progress, and restore abilities at camp', () => {
  assert.equal(prepareMemberLoadout({
    member: member({ ap: 2, provisionId: 'carrot_rations' }),
  }).ap, 3);

  const prevented = resolveAttempt({
    expedition: { id: 58, status: 'active' },
    member: member({ provisionState: { preventDebuff: { uses: 1 } } }),
    room: { ...hall, complication: 'frightened' },
    action: hall.actions[0],
    roll: 1,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(prevented.member.debuff, null);
  assert.equal(prevented.member.provisionState.preventDebuff.uses, 0);

  const minimum = resolveAttempt({
    expedition: { id: 58, status: 'active' },
    member: member({ provisionState: { minimumProgress: { uses: 1, from: 0, to: 1 } } }),
    room: { ...hall, progress: 0 },
    action: hall.actions[0],
    roll: 1,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(minimum.progressAwarded, 1);

  const restored = resolveAttempt({
    expedition: { id: 58, status: 'active' },
    member: member({
      role: 'cleric',
      roleAbilityUsed: true,
      provisionState: { restoreRoleAbility: { uses: 1, roomType: 'camp' } },
    }),
    room: camp,
    action: camp.actions[0],
    roll: 8,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(restored.member.roleAbilityUsed, false);
  assert.equal(restored.member.provisionState.restoreRoleAbility.uses, 0);

  const raised = resolveAttempt({
    expedition: { id: 58, status: 'active' },
    member: member({ provisionState: { raiseModifiedRoll: { uses: 1, below: 10, value: 10 } } }),
    room: { ...hall, progress: 0 },
    action: hall.actions[0],
    roll: 2,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(raised.modifiedRoll, 10);
  assert.equal(raised.progressAwarded, 1);
  assert.equal(raised.member.provisionState.raiseModifiedRoll.uses, 0);
});

test('assist costs one AP and adds capped support, with exhausted debuff reducing the grant for one action', () => {
  const normal = resolveAssist({
    member: member({ ap: 2 }),
    room: { ...hall, support: 5 },
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(normal.member.ap, 1);
  assert.equal(normal.room.support, 6);
  assert.equal(normal.supportAdded, 1);

  const exhausted = resolveAssist({
    member: member({ ap: 2, debuff: { type: 'exhausted' } }),
    room: { ...hall, support: 0 },
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(exhausted.room.support, 1);
  assert.equal(exhausted.supportAdded, 1);
  assert.equal(exhausted.member.debuff, null);
});

test('clearing rooms unlocks connected rooms without hiding already visible rooms', () => {
  const result = unlockConnectedRooms({
    map,
    rooms: [
      { ...camp },
      { ...hall, state: 'cleared' },
      { ...optionalVault, state: 'hidden' },
      { ...boss, state: 'locked' },
    ],
    fromRoomKey: 'hall_1',
    now: 1234,
  });

  assert.equal(result.find(room => room.key === 'vault_1').state, 'unlocked');
  assert.equal(result.find(room => room.key === 'boss_1').state, 'unlocked');
  assert.equal(result.find(room => room.key === 'hall_1').state, 'cleared');
});

test('boss room advances through three phases before boss_defeated and supports solo completion', () => {
  const phase1 = resolveAttempt({
    expedition: { id: 59, status: 'active' },
    member: member({ role: 'knight' }),
    room: { ...boss, state: 'unlocked', progress: 7, phase: 1 },
    action: boss.actions[0],
    roll: 20,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(phase1.room.phase, 2);
  assert.equal(phase1.room.progress, 0);
  assert.equal(phase1.expedition.status, 'active');

  const phase2 = resolveAttempt({
    expedition: phase1.expedition,
    member: phase1.member,
    room: { ...phase1.room, progress: 7 },
    action: boss.actions[0],
    roll: 20,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(phase2.room.phase, 3);
  assert.equal(phase2.expedition.status, 'active');

  const phase3 = resolveAttempt({
    expedition: phase2.expedition,
    member: phase2.member,
    room: { ...phase2.room, progress: 7 },
    action: boss.actions[0],
    roll: 20,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(phase3.room.state, 'cleared');
  assert.equal(phase3.room.bossDefeated, true);
  assert.equal(phase3.expedition.status, 'boss_defeated');
  assert.equal(phase3.member.userId, 10);
});

test('finish permissions allow founder after boss or any member after all reachable rooms are cleared', () => {
  const roomsAfterBoss = [
    { ...camp },
    { ...hall, state: 'cleared' },
    { ...optionalVault, state: 'unlocked' },
    { ...boss, state: 'cleared', bossDefeated: true },
  ];
  assert.equal(canFinishExpedition({
    expedition: { startedBy: 10, status: 'boss_defeated' },
    userId: 10,
    rooms: roomsAfterBoss,
  }), true);
  assert.equal(canFinishExpedition({
    expedition: { startedBy: 11, status: 'boss_defeated' },
    userId: 10,
    rooms: roomsAfterBoss,
  }), false);
  assert.equal(canFinishExpedition({
    expedition: { startedBy: 11, status: 'boss_defeated' },
    userId: 10,
    rooms: roomsAfterBoss.map(room => ({ ...room, state: 'cleared' })),
  }), true);
});

test('equipping found artifacts validates ownership and initializes slot state', () => {
  const loadout = prepareMemberLoadout({
    member: member({ loadout: [{ artifactId: 'bent_sword' }] }),
    inventory: [
      { artifactId: 'bent_sword', quantity: 1, charges: 0 },
      { artifactId: 'rusty_lockpick', quantity: 0, charges: 3 },
    ],
    artifactIds: ['rusty_lockpick', 'bent_sword'],
  }).loadout;
  assert.deepEqual(loadout, [
    { artifactId: 'rusty_lockpick', charges: 3, quantity: 0 },
    { artifactId: 'bent_sword', charges: 0, quantity: 1 },
  ]);

  assert.deepEqual(equipFoundArtifact({
    loadout: [],
    inventory: [{ artifactId: 'chalk_rune', quantity: 1, charges: 0 }],
    artifactId: 'chalk_rune',
  }), [{ artifactId: 'chalk_rune', charges: 0, quantity: 1 }]);

  assert.throws(() => equipFoundArtifact({ loadout: [], inventory: [], artifactId: 'chalk_rune' }), /not owned/);
});

test('transactional orchestration helpers require active transactions and idempotency keys', () => {
  const tx = { inTransaction: true, prepare() { throw new Error('not integrated in unit tests'); } };
  for (const fn of [
    createExpedition,
    prepareMember,
    attemptRoom,
    assistRoom,
    revealRoom,
    equipFoundArtifactForMember,
    finishExpedition,
  ]) {
    assert.throws(() => fn({ transaction: tx }), /idempotencyKey/);
    assert.throws(() => fn({ idempotencyKey: 'abc' }), /active caller transaction/);
  }

  const inputState = { nested: { value: 1 } };
  const created = createExpedition({ transaction: tx, idempotencyKey: 'abc', state: inputState });
  inputState.nested.value = 2;
  assert.deepEqual(created, {
    actionType: 'create_expedition',
    idempotencyKey: 'abc',
    state: { nested: { value: 1 } },
  });
});
