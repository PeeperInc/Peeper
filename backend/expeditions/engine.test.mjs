import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
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

function expeditionDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE family_expeditions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL,
      theme_id TEXT NOT NULL,
      seed TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','boss_defeated','finished')),
      map_json TEXT NOT NULL,
      shared_buffs_json TEXT NOT NULL DEFAULT '{}',
      started_by INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      boss_defeated_at INTEGER,
      finished_at INTEGER
    );

    CREATE TABLE family_expedition_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expedition_id INTEGER NOT NULL,
      room_key TEXT NOT NULL,
      room_type TEXT NOT NULL,
      state TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      progress_target INTEGER NOT NULL,
      support INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      unlocked_at INTEGER,
      cleared_at INTEGER,
      UNIQUE(expedition_id, room_key)
    );

    CREATE TABLE family_expedition_members (
      expedition_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      ap INTEGER NOT NULL DEFAULT 3,
      ap_regen_day INTEGER NOT NULL,
      role_ability_day INTEGER NOT NULL,
      role_ability_used INTEGER NOT NULL DEFAULT 0,
      provision_id TEXT,
      provision_state_json TEXT NOT NULL DEFAULT '{}',
      loadout_json TEXT NOT NULL DEFAULT '[]',
      debuff_json TEXT NOT NULL DEFAULT '{}',
      contribution_ap INTEGER NOT NULL DEFAULT 0,
      contribution_progress INTEGER NOT NULL DEFAULT 0,
      prepared_at INTEGER NOT NULL,
      boss_reward_claimed_at INTEGER,
      PRIMARY KEY(expedition_id, user_id)
    );

    CREATE TABLE expedition_artifact_inventory (
      user_id INTEGER NOT NULL,
      artifact_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      charges INTEGER NOT NULL DEFAULT 0,
      first_acquired_at INTEGER NOT NULL,
      last_acquired_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, artifact_id)
    );

    CREATE TABLE family_expedition_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL,
      expedition_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      stat TEXT,
      raw_roll INTEGER,
      modifier_json TEXT NOT NULL DEFAULT '{}',
      modified_roll INTEGER,
      progress_awarded INTEGER NOT NULL DEFAULT 0,
      loot_json TEXT NOT NULL DEFAULT '{}',
      narration_key TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, idempotency_key)
    );

    CREATE TABLE family_expedition_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expedition_id INTEGER NOT NULL,
      family_id INTEGER NOT NULL,
      summary_json TEXT NOT NULL,
      finished_at INTEGER NOT NULL
    );
  `);
  return db;
}

function inTx(db, fn) {
  return db.transaction(fn)();
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

test('selected support cannot exceed support stored on the room', () => {
  const modifiers = buildRollModifiers({
    member: member({ role: 'scout' }),
    room: { ...hall, support: 2 },
    action: hall.actions[0],
    selectedSupport: 6,
    dayKey: 20627,
  });

  assert.equal(modifiers.supportApplied, 2);
  assert.equal(modifiers.total, 7);
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

test('knight shield wall converts any zero-progress result into one progress', () => {
  const protectedSetback = resolveAttempt({
    expedition: { id: 56, status: 'active' },
    member: member({ role: 'knight' }),
    room: { ...hall, progress: 0 },
    action: { ...hall.actions[0], modifier: 0 },
    roll: 2,
    useRoleAbility: true,
    now: Date.UTC(2026, 5, 23),
  });

  assert.equal(protectedSetback.progressAwarded, 1);
  assert.equal(protectedSetback.member.roleAbilityUsed, true);
});

test('daily role abilities cover scout reveal, mage reroll, and cleric shared blessing', () => {
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
  assert.equal(cleric.modifiedRoll, 10);
  assert.deepEqual(cleric.expedition.sharedBuffs, {
    rollBonus: { amount: 3, uses: 1, source: 'cleric_blessing' },
  });

  const blessed = resolveAttempt({
    expedition: { id: 57, status: 'active', sharedBuffs: cleric.expedition.sharedBuffs },
    member: member({ role: 'scout' }),
    room: { ...hall, progress: 0 },
    action: hall.actions[0],
    roll: 7,
    useSharedBuff: true,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(blessed.modifiedRoll, 15);
  assert.equal(blessed.expedition.sharedBuffs.rollBonus.uses, 0);
});

test('cursed disables artifacts for one action and blinded clears without a generic roll penalty', () => {
  const darkRoom = {
    ...hall,
    tags: ['dark'],
    actions: [{ id: 'search_dark', stat: 'agility', modifier: 0, tags: [] }],
  };
  const cursed = resolveAttempt({
    expedition: { id: 60, status: 'active' },
    member: member({
      role: 'scout',
      debuff: { type: 'cursed' },
      loadout: [{ artifactId: 'old_torch' }],
    }),
    room: darkRoom,
    action: darkRoom.actions[0],
    roll: 7,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(cursed.modifiedRoll, 10);
  assert.deepEqual(cursed.modifiers.triggeredArtifacts, []);
  assert.equal(cursed.member.debuff, null);

  const blinded = resolveAttempt({
    expedition: { id: 60, status: 'active' },
    member: member({ role: 'scout', debuff: { type: 'blinded' } }),
    room: darkRoom,
    action: darkRoom.actions[0],
    roll: 7,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(blinded.modifiedRoll, 10);
  assert.equal(blinded.modifiers.parts.some(part => part.source === 'debuff'), false);
  assert.equal(blinded.member.debuff, null);
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

  assert.throws(() => resolveAssist({
    member: member({ ap: 2 }),
    room: { ...hall, state: 'hidden' },
    now: Date.UTC(2026, 5, 23),
  }), /room is not assistable/);
  assert.throws(() => resolveAssist({
    member: member({ ap: 2 }),
    room: { ...hall, support: 6 },
    now: Date.UTC(2026, 5, 23),
  }), /support is already capped/);
});

test('cursed disables assist artifacts for one action', () => {
  const assisted = resolveAssist({
    member: member({
      ap: 2,
      debuff: { type: 'cursed' },
      loadout: [{ artifactId: 'rusty_buckle' }],
    }),
    room: { ...hall, support: 0 },
    now: Date.UTC(2026, 5, 23),
  });

  assert.equal(assisted.supportAdded, 2);
  assert.equal(assisted.room.support, 2);
  assert.equal(assisted.member.debuff, null);
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
  assert.equal(canFinishExpedition({
    expedition: { startedBy: 11, status: 'boss_defeated', map },
    userId: 10,
    rooms: [
      { ...camp },
      { ...hall, state: 'cleared' },
      { ...optionalVault, state: 'unlocked' },
      { ...boss, state: 'cleared', bossDefeated: true },
      { key: 'disconnected', state: 'unlocked' },
    ],
  }), false);
});

test('equipping found artifacts validates ownership and uses fixed three-slot loadouts', () => {
  const loadout = prepareMemberLoadout({
    member: member({ loadout: [{ artifactId: 'bent_sword' }] }),
    inventory: [
      { artifactId: 'bent_sword', quantity: 1, charges: 0 },
      { artifactId: 'rusty_lockpick', quantity: 0, charges: 3 },
      { artifactId: 'chalk_rune', quantity: 1, charges: 0 },
    ],
    artifactIds: ['rusty_lockpick', 'bent_sword', 'chalk_rune'],
  }).loadout;
  assert.deepEqual(loadout, [
    { artifactId: 'rusty_lockpick', charges: 3, quantity: 0 },
    { artifactId: 'bent_sword', charges: 0, quantity: 1 },
    { artifactId: 'chalk_rune', charges: 0, quantity: 1 },
  ]);

  assert.deepEqual(equipFoundArtifact({
    loadout: [{ artifactId: 'bent_sword' }, null, { artifactId: 'rabbit_foot', exhausted: true }],
    inventory: [{ artifactId: 'chalk_rune', quantity: 1, charges: 0 }],
    artifactId: 'chalk_rune',
    slotIndex: 1,
  }), [
    { artifactId: 'bent_sword' },
    { artifactId: 'chalk_rune', charges: 0, quantity: 1 },
    { artifactId: 'rabbit_foot', exhausted: true },
  ]);

  assert.throws(() => equipFoundArtifact({ loadout: [], inventory: [], artifactId: 'chalk_rune' }), /not owned/);
  assert.throws(() => equipFoundArtifact({
    loadout: [{ artifactId: 'bent_sword' }],
    inventory: [{ artifactId: 'chalk_rune', quantity: 1, charges: 0 }],
    artifactId: 'chalk_rune',
    slotIndex: 0,
  }), /slot is occupied/);
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
});

test('transactional helpers persist attempts, unlocks, idempotent replay, and finish history', () => {
  const db = expeditionDb();
  const routeMap = {
    rooms: [
      { ...camp, state: undefined, progress: undefined },
      { ...hall, progressTarget: 1, state: undefined, progress: undefined },
      { ...optionalVault, state: undefined, progress: undefined },
      { ...boss, state: undefined, progress: undefined },
    ],
    edges: map.edges,
  };

  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-1',
    familyId: 77,
    userId: 10,
    seed: 'route-seed',
    map: routeMap,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  assert.equal(created.rooms.find(room => room.key === 'camp_0').state, 'unlocked');
  assert.equal(created.rooms.find(room => room.key === 'hall_1').state, 'locked');

  const replayedCreate = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-1',
    familyId: 77,
    userId: 10,
    seed: 'route-seed',
    map: routeMap,
    now: 1000,
  }));
  assert.equal(replayedCreate.expedition.id, expeditionId);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM family_expeditions').get().count, 1);

  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-1',
    expeditionId,
    userId: 10,
    role: 'scout',
    now: Date.UTC(2026, 5, 23),
  }));

  const attemptedCamp = inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'attempt-camp',
    expeditionId,
    userId: 10,
    roomKey: 'camp_0',
    actionId: 'tend_campfire',
    roll: 20,
    now: Date.UTC(2026, 5, 23),
  }));
  assert.equal(attemptedCamp.rooms.find(room => room.key === 'hall_1').state, 'unlocked');

  const attemptedHall = inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'attempt-hall',
    expeditionId,
    userId: 10,
    roomKey: 'hall_1',
    actionId: 'thread_gap',
    roll: 20,
    useRoleAbility: true,
    now: Date.UTC(2026, 5, 23),
  }));
  assert.equal(attemptedHall.rooms.find(room => room.key === 'hall_1').state, 'cleared');
  assert.equal(attemptedHall.rooms.find(room => room.key === 'vault_1').state, 'unlocked');
  assert.equal(attemptedHall.rooms.find(room => room.key === 'boss_1').state, 'unlocked');

  const memberAfterAttempt = db.prepare(`
    SELECT ap, contribution_ap AS contributionAp, contribution_progress AS contributionProgress
    FROM family_expedition_members
    WHERE expedition_id = ? AND user_id = ?
  `).get(expeditionId, 10);
  const replayedAttempt = inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'attempt-hall',
    expeditionId,
    userId: 10,
    roomKey: 'hall_1',
    actionId: 'thread_gap',
    roll: 20,
    useRoleAbility: true,
    now: Date.UTC(2026, 5, 23),
  }));
  assert.deepEqual(db.prepare(`
    SELECT ap, contribution_ap AS contributionAp, contribution_progress AS contributionProgress
    FROM family_expedition_members
    WHERE expedition_id = ? AND user_id = ?
  `).get(expeditionId, 10), memberAfterAttempt);
  assert.equal(replayedAttempt.actions.filter(action => action.idempotencyKey === 'attempt-hall').length, 1);

  inTx(db, () => assistRoom({
    transaction: db,
    idempotencyKey: 'assist-1',
    expeditionId,
    userId: 10,
    roomKey: 'boss_1',
    now: Date.UTC(2026, 5, 23),
  }));
  assert.equal(db.prepare(`
    SELECT support FROM family_expedition_rooms WHERE expedition_id = ? AND room_key = 'boss_1'
  `).get(expeditionId).support, 2);

  db.prepare(`
    UPDATE family_expeditions SET status = 'boss_defeated', boss_defeated_at = ?
    WHERE id = ?
  `).run(1999, expeditionId);
  db.prepare(`
    UPDATE family_expedition_rooms
    SET state = 'cleared', progress = progress_target, cleared_at = ?
    WHERE expedition_id = ? AND room_key = 'boss_1'
  `).run(1999, expeditionId);
  inTx(db, () => finishExpedition({
    transaction: db,
    idempotencyKey: 'finish-founder',
    expeditionId,
    userId: 10,
    now: 2000,
  }));
  assert.equal(db.prepare('SELECT status FROM family_expeditions WHERE id = ?').get(expeditionId).status, 'finished');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM family_expedition_history').get().count, 1);
  db.close();
});

test('transactional reveal and found-artifact equip persist member and room state', () => {
  const db = expeditionDb();
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-reveal',
    familyId: 78,
    userId: 11,
    seed: 'reveal-seed',
    map,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES
      (11, 'bent_sword', 1, 0, 1000, 1000),
      (11, 'chalk_rune', 1, 0, 1000, 1000)
  `).run();
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-reveal',
    expeditionId,
    userId: 11,
    role: 'scout',
    artifactIds: ['bent_sword'],
    now: Date.UTC(2026, 5, 23),
  }));
  db.prepare(`
    UPDATE family_expedition_rooms SET state = 'unlocked', unlocked_at = ?
    WHERE expedition_id = ? AND room_key = 'hall_1'
  `).run(2999, expeditionId);

  const revealed = inTx(db, () => revealRoom({
    transaction: db,
    idempotencyKey: 'reveal-vault',
    expeditionId,
    userId: 11,
    fromRoomKey: 'hall_1',
    roomKey: 'vault_1',
    now: 3000,
  }));
  assert.equal(revealed.rooms.find(room => room.key === 'vault_1').state, 'unlocked');

  const equipped = inTx(db, () => equipFoundArtifactForMember({
    transaction: db,
    idempotencyKey: 'equip-found',
    expeditionId,
    userId: 11,
    artifactId: 'chalk_rune',
    slotIndex: 1,
    now: 3001,
  }));
  assert.deepEqual(equipped.members.find(row => row.userId === 11).loadout, [
    { artifactId: 'bent_sword', charges: 0, quantity: 1 },
    { artifactId: 'chalk_rune', charges: 0, quantity: 1 },
    null,
  ]);
  db.close();
});

test('transactional mutations reject finished expeditions', () => {
  const db = expeditionDb();
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-finished',
    familyId: 79,
    userId: 12,
    seed: 'finished-seed',
    map,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES (12, 'chalk_rune', 1, 0, 1000, 1000)
  `).run();
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-before-finish',
    expeditionId,
    userId: 12,
    role: 'scout',
    now: Date.UTC(2026, 5, 23),
  }));
  db.prepare("UPDATE family_expeditions SET status = 'finished', finished_at = 2000 WHERE id = ?").run(expeditionId);

  assert.throws(() => inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-after-finish',
    expeditionId,
    userId: 12,
    role: 'scout',
  })), /expedition is finished/);
  assert.throws(() => inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'attempt-after-finish',
    expeditionId,
    userId: 12,
    roomKey: 'camp_0',
    actionId: 'tend_campfire',
    roll: 20,
  })), /expedition is finished/);
  assert.throws(() => inTx(db, () => assistRoom({
    transaction: db,
    idempotencyKey: 'assist-after-finish',
    expeditionId,
    userId: 12,
    roomKey: 'hall_1',
  })), /expedition is finished/);
  assert.throws(() => inTx(db, () => revealRoom({
    transaction: db,
    idempotencyKey: 'reveal-after-finish',
    expeditionId,
    userId: 12,
    fromRoomKey: 'hall_1',
    roomKey: 'vault_1',
  })), /expedition is finished/);
  assert.throws(() => inTx(db, () => equipFoundArtifactForMember({
    transaction: db,
    idempotencyKey: 'equip-after-finish',
    expeditionId,
    userId: 12,
    artifactId: 'chalk_rune',
    slotIndex: 1,
  })), /expedition is finished/);
  db.close();
});

test('transactional scout reveal requires reachable source, connected hidden target, and unused ability', () => {
  const db = expeditionDb();
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-scout-reveal',
    familyId: 80,
    userId: 13,
    seed: 'scout-reveal-seed',
    map,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-scout-reveal',
    expeditionId,
    userId: 13,
    role: 'scout',
    now: Date.UTC(2026, 5, 23),
  }));
  db.prepare(`
    UPDATE family_expedition_rooms SET state = 'locked', unlocked_at = NULL
    WHERE expedition_id = ? AND room_key = 'hall_1'
  `).run(expeditionId);

  assert.throws(() => inTx(db, () => revealRoom({
    transaction: db,
    idempotencyKey: 'reveal-from-locked',
    expeditionId,
    userId: 13,
    fromRoomKey: 'hall_1',
    roomKey: 'vault_1',
    now: 3000,
  })), /source room is not available/);

  db.prepare(`
    UPDATE family_expedition_rooms SET state = 'unlocked', unlocked_at = ?
    WHERE expedition_id = ? AND room_key = 'hall_1'
  `).run(2999, expeditionId);
  const revealed = inTx(db, () => revealRoom({
    transaction: db,
    idempotencyKey: 'reveal-scout-vault',
    expeditionId,
    userId: 13,
    fromRoomKey: 'hall_1',
    roomKey: 'vault_1',
    now: 3000,
  }));
  const scout = revealed.members.find(row => row.userId === 13);
  assert.equal(revealed.rooms.find(room => room.key === 'vault_1').state, 'unlocked');
  assert.equal(scout.roleAbilityUsed, true);

  assert.throws(() => inTx(db, () => revealRoom({
    transaction: db,
    idempotencyKey: 'reveal-scout-boss',
    expeditionId,
    userId: 13,
    fromRoomKey: 'hall_1',
    roomKey: 'boss_1',
    now: 3001,
  })), /scout reveal ability is already used/);
  db.close();
});

test('transactional attempts persist artifact trigger history across API calls', () => {
  const db = expeditionDb();
  const routeMap = {
    rooms: [
      { ...camp, state: 'cleared', progress: 1 },
      { ...hall, progressTarget: 20, state: 'unlocked', progress: 0 },
      { ...boss, state: 'locked' },
    ],
    edges: [
      { from: 'camp_0', to: 'hall_1' },
      { from: 'hall_1', to: 'boss_1' },
    ],
  };
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-history',
    familyId: 81,
    userId: 14,
    seed: 'history-seed',
    map: routeMap,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES (14, 'rabbit_foot', 1, 0, 1000, 1000)
  `).run();
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-history',
    expeditionId,
    userId: 14,
    role: 'scout',
    artifactIds: ['rabbit_foot'],
    now: Date.UTC(2026, 5, 23),
  }));

  const first = inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'attempt-history-1',
    expeditionId,
    userId: 14,
    roomKey: 'hall_1',
    actionId: 'thread_gap',
    roll: 7,
    now: Date.UTC(2026, 5, 23),
  }));
  const second = inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'attempt-history-2',
    expeditionId,
    userId: 14,
    roomKey: 'hall_1',
    actionId: 'thread_gap',
    roll: 7,
    now: Date.UTC(2026, 5, 23),
  }));

  const firstAction = first.actions.find(action => action.idempotencyKey === 'attempt-history-1');
  const secondAction = second.actions.find(action => action.idempotencyKey === 'attempt-history-2');
  assert.deepEqual(firstAction.modifiers.triggeredArtifacts, ['rabbit_foot']);
  assert.deepEqual(secondAction.modifiers.triggeredArtifacts, []);
  assert.equal(second.members.find(row => row.userId === 14).triggerHistory.length, 1);
  db.close();
});

test('idempotency replay rejects same key for different intent', () => {
  const db = expeditionDb();
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-idem',
    familyId: 82,
    userId: 15,
    seed: 'idem-seed',
    map,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'same-key',
    expeditionId,
    userId: 15,
    role: 'scout',
    now: Date.UTC(2026, 5, 23),
  }));

  assert.throws(() => inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'same-key',
    expeditionId,
    userId: 15,
    roomKey: 'camp_0',
    actionId: 'tend_campfire',
    roll: 20,
    now: Date.UTC(2026, 5, 23),
  })), /idempotency conflict/);
  db.close();
});
