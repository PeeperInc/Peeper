import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const engine = require('./engine.js');

const {
  utcDayKey,
  regenerateAp,
  combatRollOutcome,
  recoverHeroIfReady,
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
  chooseScoutRoom,
  completeEventRoom,
  startMinigameAttempt,
  finishMinigameAttempt,
  equipFoundArtifactForMember,
  claimBossReward,
  finishExpedition,
  useArtifactForMember,
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
  const preparedAt = Math.floor(Date.UTC(2026, 5, 23) / 1000);
  return {
    userId: 10,
    role: 'scout',
    ap: 5,
    apRegenDay: utcDayKey(Date.UTC(2026, 5, 23)),
    apRegenAt: preparedAt,
    heroHp: 3,
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
      ap INTEGER NOT NULL DEFAULT 5,
      ap_regen_day INTEGER NOT NULL,
      ap_regen_at INTEGER NOT NULL DEFAULT 0,
      hero_hp INTEGER NOT NULL DEFAULT 3,
      hero_recover_at INTEGER,
      role_ability_day INTEGER NOT NULL,
      role_ability_used INTEGER NOT NULL DEFAULT 0,
      role_charge INTEGER NOT NULL DEFAULT 1,
      role_charge_progress INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE family_expedition_minigame_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_token TEXT NOT NULL UNIQUE,
      expedition_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      game_type TEXT NOT NULL,
      seed TEXT NOT NULL,
      status TEXT NOT NULL,
      ap_spent INTEGER NOT NULL DEFAULT 0,
      retry_available INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      finished_at INTEGER,
      result_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE family_expedition_minigame_idempotency (
      user_id INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      operation TEXT NOT NULL,
      attempt_id INTEGER NOT NULL,
      intent_json TEXT NOT NULL,
      response_json TEXT,
      http_response_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, idempotency_key)
    );

    CREATE TABLE family_expedition_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expedition_id INTEGER NOT NULL,
      family_id INTEGER NOT NULL,
      summary_json TEXT NOT NULL,
      finished_at INTEGER NOT NULL
    );

    CREATE TABLE family_expedition_member_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expedition_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      acknowledged_at INTEGER
    );

    CREATE TABLE family_expedition_room_effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expedition_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      effect_type TEXT NOT NULL,
      placed_by INTEGER NOT NULL,
      remaining_uses INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      consumed_at INTEGER
    );

    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      coins INTEGER NOT NULL DEFAULT 0,
      first_name TEXT,
      username TEXT
    );

    CREATE TABLE farm_inventory (
      user_id INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, product_id)
    );
  `);
  return db;
}

function inTx(db, fn) {
  return db.transaction(fn)();
}

function minigameArtifactScenario({ userId, artifactIds = [], heroHp = 3 }) {
  const db = expeditionDb();
  db.prepare('INSERT INTO users (id, coins) VALUES (?, 0)').run(userId);
  const addArtifact = db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES (?, ?, 1, 0, 1, 1)
  `);
  for (const artifactId of artifactIds) addArtifact.run(userId, artifactId);
  const eventRoom = {
    ...hall,
    key: 'timing_1',
    type: 'trap',
    encounterType: 'event',
    miniGame: { kind: 'timing_window', label: 'Cross the blades' },
    progressTarget: 2,
    state: undefined,
    progress: undefined,
  };
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: `create-minigame-artifacts-${userId}`,
    familyId: userId,
    userId,
    seed: `minigame-artifacts-${userId}`,
    map: {
      rooms: [{ ...camp, state: undefined, progress: undefined }, eventRoom],
      edges: [{ from: 'camp_0', to: 'timing_1' }],
    },
    now: 1_000,
  }));
  const expeditionId = created.expedition.id;
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: `prepare-minigame-artifacts-${userId}`,
    expeditionId,
    userId,
    role: 'scout',
    artifactIds,
    now: 1_001,
  }));
  db.prepare(`
    UPDATE family_expedition_rooms SET state = 'unlocked'
    WHERE expedition_id = ? AND room_key = 'timing_1'
  `).run(expeditionId);
  db.prepare(`
    UPDATE family_expedition_members SET hero_hp = ?
    WHERE expedition_id = ? AND user_id = ?
  `).run(heroHp, expeditionId, userId);
  return { db, expeditionId, roomKey: 'timing_1', userId };
}

function expeditionMember(db, expeditionId, userId) {
  return db.prepare(`
    SELECT loadout_json AS loadoutJson, debuff_json AS debuffJson, role_charge AS roleCharge
    FROM family_expedition_members WHERE expedition_id = ? AND user_id = ?
  `).get(expeditionId, userId);
}

function failMinigameAttempt(scenario, suffix, now) {
  const started = inTx(scenario.db, () => startMinigameAttempt({
    transaction: scenario.db,
    idempotencyKey: `start-${suffix}`,
    expeditionId: scenario.expeditionId,
    userId: scenario.userId,
    roomKey: scenario.roomKey,
    now,
  }));
  return inTx(scenario.db, () => finishMinigameAttempt({
    transaction: scenario.db,
    idempotencyKey: `finish-${suffix}`,
    expeditionId: scenario.expeditionId,
    userId: scenario.userId,
    roomKey: scenario.roomKey,
    attemptToken: started.attempt.attemptToken,
    result: { success: false, score: 0 },
    now: now + 1,
  }));
}

test('UTC day keys and AP regeneration add one AP every three hours and cap at five', () => {
  assert.equal(utcDayKey(Date.UTC(2026, 5, 23, 23, 59, 59)), 20627);
  const startedAt = Math.floor(Date.UTC(2026, 5, 23, 0, 0, 0) / 1000);
  assert.deepEqual(regenerateAp({ ap: 1, apRegenAt: startedAt }, startedAt + 6 * 60 * 60), {
    ap: 3,
    apRegenAt: startedAt + 6 * 60 * 60,
    apRegenDay: utcDayKey(startedAt + 6 * 60 * 60),
  });
  assert.deepEqual(regenerateAp({ ap: 4, apRegenAt: startedAt }, startedAt + 2 * 60 * 60), {
    ap: 4,
    apRegenAt: startedAt,
    apRegenDay: utcDayKey(startedAt),
  });
  assert.deepEqual(regenerateAp({ ap: 4, apRegenAt: startedAt }, startedAt + 9 * 60 * 60), {
    ap: 5,
    apRegenAt: startedAt + 9 * 60 * 60,
    apRegenDay: utcDayKey(startedAt + 9 * 60 * 60),
  });
  assert.deepEqual(regenerateAp({ ap: 5, apRegenAt: startedAt }, startedAt + 9 * 60 * 60), {
    ap: 5,
    apRegenAt: startedAt + 9 * 60 * 60,
    apRegenDay: utcDayKey(startedAt + 9 * 60 * 60),
  });
  assert.deepEqual(regenerateAp({ ap: 1, apRegenAt: startedAt }, startedAt + 10 * 60 * 60), {
    ap: 4,
    apRegenAt: startedAt + 9 * 60 * 60,
    apRegenDay: utcDayKey(startedAt + 9 * 60 * 60),
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

test('combat rooms use simple d20 hit bands and only low rolls damage the hero', () => {
  const combatRoom = { ...hall, type: 'combat', encounterType: 'combat', progress: 0, progressTarget: 4 };
  const wounded = resolveAttempt({
    expedition: { id: 54, status: 'active' },
    member: member({ role: 'scout', heroHp: 3 }),
    room: combatRoom,
    action: { ...hall.actions[0], modifier: 0, stat: 'might' },
    roll: 4,
    now: Math.floor(Date.UTC(2026, 5, 23) / 1000),
  });
  const strongHit = resolveAttempt({
    expedition: { id: 54, status: 'active' },
    member: member({ role: 'scout', heroHp: 3 }),
    room: combatRoom,
    action: { ...hall.actions[0], modifier: 0, stat: 'might' },
    roll: 16,
    now: Math.floor(Date.UTC(2026, 5, 23) / 1000),
  });
  const crit = resolveAttempt({
    expedition: { id: 54, status: 'active' },
    member: member({ role: 'scout', heroHp: 3 }),
    room: combatRoom,
    action: { ...hall.actions[0], modifier: 0, stat: 'might' },
    roll: 20,
    now: Math.floor(Date.UTC(2026, 5, 23) / 1000),
  });
  const boosted = resolveAttempt({
    expedition: { id: 54, status: 'active' },
    member: member({ role: 'scout', heroHp: 3 }),
    room: combatRoom,
    action: { ...hall.actions[0], modifier: 2, stat: 'might' },
    roll: 7,
    now: Math.floor(Date.UTC(2026, 5, 23) / 1000),
  });
  const knockedOut = resolveAttempt({
    expedition: { id: 54, status: 'active' },
    member: member({ role: 'scout', heroHp: 1 }),
    room: combatRoom,
    action: { ...hall.actions[0], modifier: 0, stat: 'might' },
    roll: 4,
    now: 1000,
  });
  const roomCleared = resolveAttempt({
    expedition: { id: 54, status: 'active' },
    member: member({ role: 'scout', heroHp: 2 }),
    room: { ...combatRoom, progress: 3, progressTarget: 4 },
    action: { ...hall.actions[0], modifier: 0, stat: 'might' },
    roll: 12,
    now: 1000,
  });

  assert.equal(wounded.progressAwarded, 0);
  assert.equal(wounded.member.heroHp, 2);
  assert.equal(wounded.events.some(event => event.type === 'hero_damaged'), true);
  assert.equal(strongHit.progressAwarded, 2);
  assert.equal(strongHit.member.heroHp, 3);
  assert.equal(crit.progressAwarded, 3);
  assert.equal(boosted.progressAwarded, 1);
  assert.equal(knockedOut.member.heroHp, 0);
  assert.equal(knockedOut.member.heroRecoverAt, 1000 + 6 * 60 * 60);
  assert.equal(knockedOut.events.some(event => event.type === 'hero_recovering'), true);
  assert.equal(roomCleared.room.state, 'cleared');
  assert.equal(roomCleared.member.heroHp, 2);
  assert.equal(roomCleared.events.some(event => event.type === 'hero_refreshed'), false);
});

test('combat d20 outcome uses the exact public-test bands', () => {
  assert.deepEqual(combatRollOutcome(1), { label: 'hero_hit', heroDamage: 1, progress: 0 });
  assert.deepEqual(combatRollOutcome(5), { label: 'hero_hit', heroDamage: 1, progress: 0 });
  assert.deepEqual(combatRollOutcome(6), { label: 'standoff', heroDamage: 0, progress: 0 });
  assert.deepEqual(combatRollOutcome(8), { label: 'standoff', heroDamage: 0, progress: 0 });
  assert.deepEqual(combatRollOutcome(9), { label: 'enemy_hit', heroDamage: 0, progress: 1 });
  assert.deepEqual(combatRollOutcome(15), { label: 'enemy_hit', heroDamage: 0, progress: 1 });
  assert.deepEqual(combatRollOutcome(16), { label: 'enemy_hit_hard', heroDamage: 0, progress: 2 });
  assert.deepEqual(combatRollOutcome(19), { label: 'enemy_hit_hard', heroDamage: 0, progress: 2 });
  assert.deepEqual(combatRollOutcome(20), { label: 'critical_hit', heroDamage: 0, progress: 3 });
});

test('knocked-out heroes recover to full HP only after six hours', () => {
  const recoverAt = 1000 + 6 * 60 * 60;
  const recovering = { heroHp: 0, heroRecoverAt: recoverAt };

  assert.deepEqual(recoverHeroIfReady(recovering, recoverAt - 1), recovering);
  assert.deepEqual(recoverHeroIfReady(recovering, recoverAt), {
    heroHp: 3,
    heroRecoverAt: null,
  });
});

test('default attempt time stores knockout recovery as unix seconds', () => {
  const before = Math.floor(Date.now() / 1000);
  const result = resolveAttempt({
    expedition: { id: 54, status: 'active' },
    member: member({ role: 'scout', heroHp: 1 }),
    room: { ...hall, type: 'combat', encounterType: 'combat', progress: 0, progressTarget: 6 },
    action: { ...hall.actions[0], modifier: 0, stat: 'might' },
    roll: 1,
  });
  const after = Math.floor(Date.now() / 1000);

  assert.equal(result.member.heroHp, 0);
  assert.ok(result.member.heroRecoverAt >= before + 6 * 60 * 60);
  assert.ok(result.member.heroRecoverAt <= after + 6 * 60 * 60);
});

test('millisecond attempt time stores knockout recovery as unix seconds', () => {
  const now = Date.UTC(2026, 5, 23);
  const result = resolveAttempt({
    expedition: { id: 54, status: 'active' },
    member: member({ role: 'scout', heroHp: 1 }),
    room: { ...hall, type: 'combat', encounterType: 'combat', progress: 0, progressTarget: 6 },
    action: { ...hall.actions[0], modifier: 0, stat: 'might' },
    roll: 1,
    now,
  });

  assert.equal(result.member.heroRecoverAt, Math.floor(now / 1000) + 6 * 60 * 60);
});

test('boss encounters use combat damage and progress bands', () => {
  const bossRoom = {
    ...boss,
    state: 'unlocked',
    encounterType: 'boss',
    progress: 0,
    progressTarget: 9,
  };
  const wounded = resolveAttempt({
    expedition: { id: 54, status: 'active' },
    member: member({ role: 'scout', heroHp: 3 }),
    room: bossRoom,
    action: { ...boss.actions[0], modifier: 0 },
    roll: 5,
    now: 1000,
  });
  const critical = resolveAttempt({
    expedition: { id: 54, status: 'active' },
    member: member({ role: 'scout', heroHp: 3 }),
    room: bossRoom,
    action: { ...boss.actions[0], modifier: 0 },
    roll: 20,
    now: 1000,
  });

  assert.equal(wounded.progressAwarded, 0);
  assert.equal(wounded.member.heroHp, 2);
  assert.equal(critical.progressAwarded, 3);
});

test('roll modifiers include action difficulty, role, provision, debuff, and capped support', () => {
  const modifiers = buildRollModifiers({
    member: member({
      role: 'scout',
      provisionState: { rollBonus: { amount: 2, uses: 1 } },
      debuff: { type: 'frightened', stat: 'agility', amount: -2 },
      loadout: [{ artifactId: 'old_torch' }],
    }),
    room: hall,
    action: hall.actions[0],
    selectedSupport: 9,
    dayKey: 20627,
  });

  assert.equal(modifiers.total, 11);
  assert.equal(modifiers.supportApplied, 6);
  assert.deepEqual(modifiers.parts.map(part => part.source), [
    'action',
    'role',
    'support',
    'provision',
    'debuff',
  ]);
  assert.equal(modifiers.loadout[0].artifactId, 'old_torch');
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

test('room mechanic choices are real roll decisions, not decorative labels', () => {
  const routeRoom = {
    ...hall,
    miniMechanic: {
      type: 'route_choice',
      options: [
        { id: 'safe_path', label: 'Safe Path' },
        { id: 'fast_path', label: 'Fast Path' },
        { id: 'greedy_path', label: 'Greedy Path' },
      ],
    },
  };

  const safe = buildRollModifiers({
    member: member({ role: 'scout' }),
    room: routeRoom,
    action: routeRoom.actions[0],
    mechanicChoice: 'safe_path',
    dayKey: 20627,
  });
  const greedy = buildRollModifiers({
    member: member({ role: 'scout' }),
    room: routeRoom,
    action: routeRoom.actions[0],
    mechanicChoice: 'greedy_path',
    dayKey: 20627,
  });

  assert.equal(safe.total, 6);
  assert.equal(greedy.total, 8);
  assert.deepEqual(greedy.parts.at(-1), { source: 'mechanic:greedy_path', amount: 3 });
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
  assert.equal(result.modifiedRoll, 18);
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

test('attempts can resolve from one roll button without a client action id', () => {
  const db = expeditionDb();
  db.prepare('INSERT INTO users (id, coins) VALUES (10, 0)').run();
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-one-roll',
    familyId: 84,
    userId: 10,
    seed: 'one-roll-seed',
    map,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-one-roll',
    expeditionId,
    userId: 10,
    role: 'scout',
    now: Math.floor(Date.UTC(2026, 5, 23) / 1000),
  }));
  db.prepare(`
    UPDATE family_expedition_rooms SET state = 'unlocked'
    WHERE expedition_id = ? AND room_key = 'hall_1'
  `).run(expeditionId);

  const attempted = inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'attempt-one-roll',
    expeditionId,
    userId: 10,
    roomKey: 'hall_1',
    roll: 10,
    now: Math.floor(Date.UTC(2026, 5, 23) / 1000),
  }));
  const action = attempted.actions.find(row => row.idempotencyKey === 'attempt-one-roll');

  assert.equal(action.stat, 'agility');
  assert.equal(action.modifiers.intent.actionId, 'thread_gap');
  assert.equal(attempted.members.find(row => row.userId === 10).ap, 4);
  db.close();
});

test('room threat rises on setbacks and clears when the room is completed', () => {
  const setback = resolveAttempt({
    expedition: { id: 56, status: 'active' },
    member: member({ role: 'scout' }),
    room: { ...hall, progress: 0, threat: 0, threatMax: 5 },
    action: { ...hall.actions[0], modifier: 0 },
    roll: 1,
    now: Math.floor(Date.UTC(2026, 5, 23) / 1000),
  });
  assert.equal(setback.progressAwarded, 0);
  assert.equal(setback.room.threat, 2);
  assert.equal(setback.room.threatState, 'guarded');

  const cleared = resolveAttempt({
    expedition: { id: 56, status: 'active' },
    member: member({ role: 'scout' }),
    room: { ...hall, progress: 3, threat: 4, threatMax: 5 },
    action: hall.actions[0],
    roll: 20,
    now: Math.floor(Date.UTC(2026, 5, 23) / 1000),
  });
  assert.equal(cleared.room.state, 'cleared');
  assert.equal(cleared.room.threat, 0);
  assert.equal(cleared.room.threatState, null);
});

test('room mechanic choices can trade safety for higher threat risk', () => {
  const routeRoom = {
    ...hall,
    progress: 0,
    threat: 0,
    threatMax: 5,
    miniMechanic: {
      type: 'route_choice',
      options: [
        { id: 'safe_path', label: 'Safe Path' },
        { id: 'greedy_path', label: 'Greedy Path' },
      ],
    },
  };

  const safe = resolveAttempt({
    expedition: { id: 56, status: 'active' },
    member: member({ role: 'scout' }),
    room: routeRoom,
    action: { ...routeRoom.actions[0], modifier: -10 },
    mechanicChoice: 'safe_path',
    roll: 1,
    now: Math.floor(Date.UTC(2026, 5, 23) / 1000),
  });
  const greedy = resolveAttempt({
    expedition: { id: 56, status: 'active' },
    member: member({ role: 'scout' }),
    room: routeRoom,
    action: { ...routeRoom.actions[0], modifier: -10 },
    mechanicChoice: 'greedy_path',
    roll: 1,
    now: Math.floor(Date.UTC(2026, 5, 23) / 1000),
  });

  assert.equal(safe.room.threat, 1);
  assert.equal(greedy.room.threat, 3);
});

test('natural 20 grants a bonus loot roll', () => {
  const critical = resolveAttempt({
    expedition: { id: 56, status: 'active' },
    member: member({ role: 'knight' }),
    room: { ...boss, state: 'unlocked' },
    action: boss.actions[0],
    roll: 20,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(critical.progressAwarded, 3);
  assert.equal(critical.loot.artifactRolls, 1);
});

test('legacy useRoleAbility input cannot activate superseded daily role powers', () => {
  const cases = [
    { role: 'knight', roll: 1, reroll: 20 },
    { role: 'mage', roll: 4, reroll: 20 },
    { role: 'cleric', roll: 8, reroll: 20 },
    { role: 'scout', roll: 8, reroll: 20 },
  ];

  for (const candidate of cases) {
    const result = resolveAttempt({
      expedition: { id: 57, status: 'active', map },
      member: member({ role: candidate.role, roleAbilityUsed: false }),
      room: { ...hall, progress: 0 },
      action: hall.actions[0],
      roll: candidate.roll,
      reroll: candidate.reroll,
      useRoleAbility: true,
      now: Date.UTC(2026, 5, 23),
    });

    assert.equal(result.rawRoll, candidate.roll, `${candidate.role} must keep the original roll`);
    assert.equal(result.member.roleAbilityUsed, false, `${candidate.role} must not use legacy state`);
    assert.deepEqual(result.revealedRoomKeys, [], `${candidate.role} must not reveal rooms`);
    assert.deepEqual(result.expedition.sharedBuffs, {}, `${candidate.role} must not add legacy buffs`);
    assert.equal(
      result.events.some(event => ['role_reroll', 'shared_blessing_added', 'natural_one_protected'].includes(event.type)),
      false,
      `${candidate.role} must not emit legacy role events`,
    );
  }
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

test('cursed combat suppresses offensive passives and Emerald Heart healing', () => {
  const combatRoom = {
    ...hall,
    type: 'combat',
    encounterType: 'combat',
    progressTarget: 20,
    actions: [{ id: 'strike', stat: 'might', modifier: 0, tags: [] }],
  };
  const loadout = [
    { artifactId: 'crown_of_twenty' },
    { artifactId: 'bent_sword' },
    { artifactId: 'emerald_heart' },
  ];
  const crown = resolveAttempt({
    expedition: { id: 61, status: 'active' },
    member: member({ role: 'scout', heroHp: 2, debuff: { type: 'cursed' }, loadout }),
    room: combatRoom,
    action: combatRoom.actions[0],
    roll: 19,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(crown.rawRoll, 19);
  assert.equal(crown.progressAwarded, 2);
  assert.equal(crown.member.heroHp, 2);

  const heart = resolveAttempt({
    expedition: { id: 61, status: 'active' },
    member: member({ role: 'scout', heroHp: 2, debuff: { type: 'cursed' }, loadout }),
    room: combatRoom,
    action: combatRoom.actions[0],
    roll: 20,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(heart.progressAwarded, 3);
  assert.equal(heart.member.heroHp, 2);
});

test('cursed combat preserves armed roll artifacts for the next eligible action', () => {
  const combatRoom = {
    ...hall,
    type: 'combat',
    encounterType: 'combat',
    progressTarget: 20,
    actions: [{ id: 'strike', stat: 'might', modifier: 0, tags: [] }],
  };
  const armed = [
    { artifactId: 'bone_die', effectKind: 'combat_roll_floor', roomKey: hall.key, remainingUses: 1, scope: 'armed' },
    { artifactId: 'loaded_die', effectKind: 'combat_advantage', roomKey: hall.key, remainingUses: 1, scope: 'armed' },
  ];
  const cursed = resolveAttempt({
    expedition: { id: 62, status: 'active' },
    member: member({ role: 'scout', debuff: { type: 'cursed' }, triggerHistory: armed }),
    room: combatRoom,
    action: combatRoom.actions[0],
    roll: 1,
    reroll: 20,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(cursed.rawRoll, 1);
  assert.deepEqual(cursed.member.triggerHistory, armed);
  assert.equal(cursed.events.some(event => event.type.startsWith('artifact_')), false);

  const eligible = resolveAttempt({
    expedition: { id: 62, status: 'active' },
    member: { ...cursed.member, ap: 5, heroHp: 3, heroRecoverAt: null },
    room: combatRoom,
    action: combatRoom.actions[0],
    roll: 1,
    reroll: 20,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(eligible.rawRoll, 20);
  assert.equal(eligible.member.triggerHistory.length, 0);
  assert.equal(eligible.events.some(event => event.type === 'artifact_roll_floor'), true);
  assert.equal(eligible.events.some(event => event.type === 'artifact_advantage'), true);
});

test('cursed combat bypasses all armed and passive personal damage protection', () => {
  const combatRoom = {
    ...hall,
    type: 'combat',
    encounterType: 'combat',
    progressTarget: 20,
    actions: [{ id: 'strike', stat: 'might', modifier: 0, tags: [] }],
  };
  const shield = {
    artifactId: 'wooden_shield',
    effectKind: 'prevent_personal_damage',
    roomKey: hall.key,
    remainingUses: 1,
    scope: 'armed',
  };
  const cursed = resolveAttempt({
    expedition: { id: 63, status: 'active' },
    member: member({
      role: 'scout',
      heroHp: 1,
      debuff: { type: 'cursed' },
      loadout: [{ artifactId: 'rabbit_foot' }, { artifactId: 'last_stand_banner' }],
      triggerHistory: [shield],
    }),
    room: combatRoom,
    action: combatRoom.actions[0],
    roll: 1,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(cursed.member.heroHp, 0);
  assert.deepEqual(cursed.member.triggerHistory, [shield]);
  assert.equal(cursed.events.some(event => event.type === 'artifact_damage_prevented'), false);

  const eligible = resolveAttempt({
    expedition: { id: 63, status: 'active' },
    member: { ...cursed.member, ap: 5, heroHp: 3, heroRecoverAt: null },
    room: combatRoom,
    action: combatRoom.actions[0],
    roll: 1,
    now: Date.UTC(2026, 5, 23),
  });
  assert.equal(eligible.member.heroHp, 3);
  assert.equal(eligible.member.triggerHistory.some(entry => entry.artifactId === 'wooden_shield'), false);
  assert.equal(eligible.events.some(event => event.type === 'artifact_damage_prevented'), true);
});

test('provisions grant AP, prevent debuffs, and protect minimum progress', () => {
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

test('role restoration provisions recharge the new role charge once in the matching room', () => {
  const restored = resolveAttempt({
    expedition: { id: 58, status: 'active' },
    member: member({
      roleCharge: 0,
      roleChargeProgress: 2,
      provisionState: { restoreRoleAbility: { uses: 1, roomType: 'camp' } },
    }),
    room: { ...hall, type: 'camp', progress: 0 },
    action: hall.actions[0],
    roll: 8,
    now: Date.UTC(2026, 5, 23),
  });

  assert.equal(restored.member.roleCharge, 1);
  assert.equal(restored.member.roleChargeProgress, 0);
  assert.equal(restored.member.provisionState.restoreRoleAbility.uses, 0);
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

test('artifact loadouts validate copy counts and use three nonreplaceable slots', () => {
  const loadout = prepareMemberLoadout({
    member: member({ loadout: [{ artifactId: 'bent_sword' }] }),
    inventory: [
      { artifactId: 'bent_sword', quantity: 1, charges: 0 },
      { artifactId: 'rusty_lockpick', quantity: 1, charges: 0 },
      { artifactId: 'chalk_rune', quantity: 1, charges: 0 },
    ],
    artifactIds: ['rusty_lockpick', 'bent_sword', 'chalk_rune'],
  }).loadout;
  assert.deepEqual(loadout, [
    { artifactId: 'rusty_lockpick' },
    { artifactId: 'bent_sword' },
    { artifactId: 'chalk_rune' },
  ]);

  assert.deepEqual(equipFoundArtifact({
    loadout: [{ artifactId: 'bent_sword' }, null, { artifactId: 'rabbit_foot', exhausted: true }],
    inventory: [{ artifactId: 'chalk_rune', quantity: 1, charges: 0 }],
    artifactId: 'chalk_rune',
    slotIndex: 1,
  }), [
    { artifactId: 'bent_sword' },
    { artifactId: 'chalk_rune' },
    { artifactId: 'rabbit_foot', exhausted: true },
  ]);

  assert.throws(() => equipFoundArtifact({ loadout: [], inventory: [], artifactId: 'chalk_rune' }), /not owned/);
  assert.throws(() => equipFoundArtifact({
    loadout: [{ artifactId: 'bent_sword' }],
    inventory: [{ artifactId: 'chalk_rune', quantity: 1, charges: 0 }],
    artifactId: 'chalk_rune',
    slotIndex: 0,
  }), /slot is occupied/);
  assert.throws(() => equipFoundArtifact({
    loadout: [{ artifactId: 'bent_sword' }, null, { artifactId: 'rabbit_foot', exhausted: true }],
    inventory: [{ artifactId: 'chalk_rune', quantity: 1 }],
    artifactId: 'chalk_rune',
    slotIndex: 2,
  }), /slot is occupied/);
  assert.throws(() => prepareMemberLoadout({
    member: member(),
    inventory: [{ artifactId: 'chalk_rune', quantity: 1 }],
    artifactIds: ['chalk_rune', 'chalk_rune'],
  }), /not enough copies/);
});

test('transactional orchestration helpers require active transactions and idempotency keys', () => {
  const tx = { inTransaction: true, prepare() { throw new Error('not integrated in unit tests'); } };
  for (const fn of [
    createExpedition,
    prepareMember,
    attemptRoom,
    assistRoom,
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

test('finish expedition reward payload uses finish transaction time after boss defeat', () => {
  const db = expeditionDb();
  db.exec(`
    CREATE TABLE family_expedition_pending_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expedition_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      claimed_at INTEGER,
      UNIQUE(expedition_id, user_id)
    );
  `);
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-reward-finish-time',
    familyId: 78,
    userId: 10,
    seed: 'reward-finish-time-seed',
    map,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-reward-finish-time',
    expeditionId,
    userId: 10,
    role: 'scout',
    now: Date.UTC(2026, 5, 23),
  }));
  db.prepare(`
    UPDATE family_expeditions SET status = 'boss_defeated', boss_defeated_at = ?
    WHERE id = ?
  `).run(1999, expeditionId);
  db.prepare(`
    UPDATE family_expedition_members SET contribution_ap = ?
    WHERE expedition_id = ? AND user_id = ?
  `).run(3, expeditionId, 10);

  inTx(db, () => finishExpedition({
    transaction: db,
    idempotencyKey: 'finish-reward-finish-time',
    expeditionId,
    userId: 10,
    now: 2000,
  }));

  const reward = db.prepare(`
    SELECT payload_json AS payloadJson, created_at AS createdAt
    FROM family_expedition_pending_rewards
    WHERE expedition_id = ? AND user_id = ?
  `).get(expeditionId, 10);
  const payload = JSON.parse(reward.payloadJson);
  assert.equal(payload.completedAt, 2000);
  assert.notEqual(payload.completedAt, 1999);
  assert.equal(reward.createdAt, 2000);
  db.close();
});

test('transactional attempts award personal coins and artifacts only when the room is cleared', () => {
  const db = expeditionDb();
  db.prepare('INSERT INTO users (id, coins) VALUES (10, 0)').run();
  const lootVault = {
    ...optionalVault,
    state: undefined,
    progress: undefined,
    progressTarget: 4,
    loot: { coins: { min: 8, max: 8 }, artifactRolls: 1 },
  };
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-loot',
    familyId: 80,
    userId: 10,
    seed: 'loot-seed',
    map: {
      rooms: [
        { ...camp, state: undefined, progress: undefined },
        lootVault,
      ],
      edges: [{ from: 'camp_0', to: 'vault_1' }],
    },
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  db.prepare(`
    UPDATE family_expedition_rooms SET state = 'unlocked'
    WHERE expedition_id = ? AND room_key = 'vault_1'
  `).run(expeditionId);
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-loot',
    expeditionId,
    userId: 10,
    role: 'scout',
    now: Date.UTC(2026, 5, 23),
  }));

  inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'attempt-loot-progress',
    expeditionId,
    userId: 10,
    roomKey: 'vault_1',
    actionId: 'pick_vault',
    roll: 10,
    rng: () => 0.99,
    now: Date.UTC(2026, 5, 23),
  }));
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 10').get().coins, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expedition_artifact_inventory WHERE user_id = 10').get().count, 0);
  assert.equal(db.prepare("SELECT state FROM family_expedition_rooms WHERE expedition_id = ? AND room_key = 'vault_1'").get(expeditionId).state, 'unlocked');

  inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'attempt-loot-clear',
    expeditionId,
    userId: 10,
    roomKey: 'vault_1',
    actionId: 'pick_vault',
    roll: 10,
    rng: () => 0.99,
    now: Date.UTC(2026, 5, 23),
  }));
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 10').get().coins, 8);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expedition_artifact_inventory WHERE user_id = 10').get().count, 1);

  inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'attempt-loot-clear',
    expeditionId,
    userId: 10,
    roomKey: 'vault_1',
    actionId: 'pick_vault',
    roll: 10,
    rng: () => 0.99,
    now: Date.UTC(2026, 5, 23),
  }));
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 10').get().coins, 8);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expedition_artifact_inventory WHERE user_id = 10').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM family_expedition_actions WHERE idempotency_key = ?').get('attempt-loot-clear').count, 1);
  db.close();
});

test('preparation provisions consume farm inventory and replay without double spending', () => {
  const db = expeditionDb();
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-provision',
    familyId: 81,
    userId: 15,
    seed: 'provision-seed',
    map,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  db.prepare("INSERT INTO farm_inventory (user_id, product_id, quantity, updated_at) VALUES (15, 'carrot', 20, 1000)").run();

  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-provision',
    expeditionId,
    userId: 15,
    role: 'scout',
    provisionId: 'carrot_rations',
    now: Date.UTC(2026, 5, 23),
  }));
  assert.equal(db.prepare("SELECT COALESCE(quantity, 0) AS quantity FROM farm_inventory WHERE user_id = 15 AND product_id = 'carrot'").get()?.quantity || 0, 0);
  assert.equal(db.prepare('SELECT ap FROM family_expedition_members WHERE expedition_id = ? AND user_id = 15').get(expeditionId).ap, 5);

  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-provision',
    expeditionId,
    userId: 15,
    role: 'scout',
    provisionId: 'carrot_rations',
    now: Date.UTC(2026, 5, 23),
  }));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM family_expedition_actions WHERE idempotency_key = 'prepare-provision'").get().count, 1);

  const second = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-provision-short',
    familyId: 82,
    userId: 16,
    seed: 'provision-short-seed',
    map,
    now: 1000,
  }));
  db.prepare("INSERT INTO farm_inventory (user_id, product_id, quantity, updated_at) VALUES (16, 'carrot', 19, 1000)").run();
  assert.throws(() => inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-provision-short',
    expeditionId: second.expedition.id,
    userId: 16,
    role: 'scout',
    provisionId: 'carrot_rations',
    now: Date.UTC(2026, 5, 23),
  })), /Not enough Carrot/);
  db.close();
});

test('preparation claims one immutable loadout and rejects a different request without reserving again', () => {
  const db = expeditionDb();
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-exclusive-prepare',
    familyId: 85,
    userId: 35,
    seed: 'exclusive-prepare-seed',
    map,
    now: 1_000,
  }));
  const expeditionId = created.expedition.id;
  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES
      (35, 'bent_sword', 1, 0, 1, 1),
      (35, 'chalk_rune', 1, 0, 1, 1)
  `).run();
  const firstRequest = {
    transaction: db,
    idempotencyKey: 'prepare-exclusive-first',
    expeditionId,
    userId: 35,
    role: 'scout',
    artifactIds: ['bent_sword'],
    now: 1_001,
  };
  inTx(db, () => prepareMember(firstRequest));
  inTx(db, () => prepareMember(firstRequest));
  assert.throws(() => inTx(db, () => prepareMember({
    ...firstRequest,
    idempotencyKey: 'prepare-exclusive-second',
    role: 'mage',
    artifactIds: ['chalk_rune'],
    now: 1_002,
  })), /already prepared/i);

  const prepared = db.prepare(`
    SELECT role, loadout_json AS loadoutJson
    FROM family_expedition_members WHERE expedition_id = ? AND user_id = 35
  `).get(expeditionId);
  const inventory = db.prepare(`
    SELECT artifact_id AS artifactId, quantity
    FROM expedition_artifact_inventory WHERE user_id = 35 ORDER BY artifact_id
  `).all();
  assert.equal(prepared.role, 'scout');
  assert.equal(JSON.parse(prepared.loadoutJson).slots[0].artifactId, 'bent_sword');
  assert.deepEqual(inventory, [
    { artifactId: 'bent_sword', quantity: 0 },
    { artifactId: 'chalk_rune', quantity: 1 },
  ]);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM family_expedition_actions
    WHERE user_id = 35 AND action_type = 'prepare_member'
  `).get().count, 1);
  db.close();
});

test('boss reward claim requires three AP contribution and is idempotent', () => {
  const db = expeditionDb();
  db.prepare('INSERT INTO users (id, coins) VALUES (20, 0), (21, 0)').run();
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-claim',
    familyId: 83,
    userId: 20,
    seed: 'claim-seed',
    map,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-claim-eligible',
    expeditionId,
    userId: 20,
    role: 'scout',
    now: Date.UTC(2026, 5, 23),
  }));
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-claim-short',
    expeditionId,
    userId: 21,
    role: 'scout',
    now: Date.UTC(2026, 5, 23),
  }));
  db.prepare(`
    UPDATE family_expeditions SET status = 'boss_defeated', boss_defeated_at = 2000
    WHERE id = ?
  `).run(expeditionId);
  db.prepare(`
    UPDATE family_expedition_members SET contribution_ap = ?
    WHERE expedition_id = ? AND user_id = ?
  `).run(3, expeditionId, 20);
  db.prepare(`
    UPDATE family_expedition_members SET contribution_ap = ?
    WHERE expedition_id = ? AND user_id = ?
  `).run(2, expeditionId, 21);

  assert.throws(() => inTx(db, () => claimBossReward({
    transaction: db,
    idempotencyKey: 'claim-short',
    expeditionId,
    userId: 21,
    rng: () => 0.99,
    now: 3000,
  })), /at least 3 AP/);

  inTx(db, () => claimBossReward({
    transaction: db,
    idempotencyKey: 'claim-eligible',
    expeditionId,
    userId: 20,
    rng: () => 0.99,
    now: 3000,
  }));
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 20').get().coins, 70);
  assert.equal(db.prepare('SELECT boss_reward_claimed_at FROM family_expedition_members WHERE expedition_id = ? AND user_id = 20').get(expeditionId).boss_reward_claimed_at, 3000);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expedition_artifact_inventory WHERE user_id = 20').get().count, 1);

  inTx(db, () => claimBossReward({
    transaction: db,
    idempotencyKey: 'claim-eligible',
    expeditionId,
    userId: 20,
    rng: () => 0.99,
    now: 3001,
  }));
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 20').get().coins, 70);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM family_expedition_actions WHERE idempotency_key = ?').get('claim-eligible').count, 1);
  db.close();
});

test('transactional found-artifact equip persists member state', () => {
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
    { artifactId: 'bent_sword' },
    { artifactId: 'chalk_rune' },
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

test('transactional scout choice locks one next room option per source room', () => {
  const db = expeditionDb();
  const choiceMap = {
    rooms: [
      {
        ...camp,
        state: undefined,
        progress: undefined,
        scoutChoices: [
          {
            id: 'combat-path',
            targetKey: 'hall_1',
            label: 'Root Bruiser',
            room: {
              ...hall,
              type: 'combat',
              name: 'Root Bruiser',
              encounterType: 'combat',
              weakRoles: ['knight'],
              actions: [{ id: 'strike_bruiser', stat: 'might', modifier: 1, tags: ['combat'] }],
              progressTarget: 3,
            },
          },
          {
            id: 'trap-path',
            targetKey: 'hall_1',
            label: 'Needle Floor',
            room: {
              ...hall,
              type: 'trap',
              name: 'Needle Floor',
              encounterType: 'event',
              weakRoles: ['scout'],
              actions: [{ id: 'cross_needles', stat: 'agility', modifier: 2, tags: ['trap'] }],
              progressTarget: 2,
            },
          },
          {
            id: 'mystery-path',
            targetKey: 'hall_1',
            label: 'Whispering Door',
            room: {
              ...hall,
              type: 'mystery',
              name: 'Whispering Door',
              encounterType: 'event',
              weakRoles: ['mage'],
              actions: [{ id: 'read_door', stat: 'arcana', modifier: 2, tags: ['mystery'] }],
              progressTarget: 2,
            },
          },
        ],
      },
      { ...hall, state: undefined, progress: undefined },
    ],
    edges: [{ from: 'camp_0', to: 'hall_1' }],
  };
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-choice',
    familyId: 90,
    userId: 21,
    seed: 'choice-seed',
    map: choiceMap,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-choice',
    expeditionId,
    userId: 21,
    role: 'scout',
    now: Date.UTC(2026, 5, 23),
  }));

  const chosen = inTx(db, () => chooseScoutRoom({
    transaction: db,
    idempotencyKey: 'choose-trap',
    expeditionId,
    userId: 21,
    fromRoomKey: 'camp_0',
    choiceId: 'trap-path',
    now: Date.UTC(2026, 5, 23),
  }));
  const source = chosen.rooms.find(room => room.key === 'camp_0');
  const target = chosen.rooms.find(room => room.key === 'hall_1');
  assert.equal(source.scoutChoice.choiceId, 'trap-path');
  assert.equal(target.type, 'trap');
  assert.equal(target.name, 'Needle Floor');
  assert.equal(target.progressTarget, 2);
  assert.equal(chosen.members.find(row => row.userId === 21).roleCharge, 0);
  assert.throws(() => inTx(db, () => chooseScoutRoom({
    transaction: db,
    idempotencyKey: 'choose-again',
    expeditionId,
    userId: 21,
    fromRoomKey: 'camp_0',
    choiceId: 'mystery-path',
    now: Date.UTC(2026, 5, 23),
  })), /next room is already chosen/);
  db.close();
});

test('cursed members cannot spend Crooked Compass on scout choices and keep it for the next eligible choice', () => {
  const db = expeditionDb();
  db.prepare('INSERT INTO users (id, coins) VALUES (24, 0)').run();
  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES (24, 'crooked_compass', 1, 0, 1, 1)
  `).run();
  const choiceMap = {
    rooms: [
      {
        ...camp,
        state: undefined,
        progress: undefined,
        scoutChoices: [
          { id: 'trap-path', targetKey: 'hall_1', label: 'Needle Floor' },
          { id: 'mystery-path', targetKey: 'hall_1', label: 'Whispering Door' },
        ],
      },
      { ...hall, state: undefined, progress: undefined },
    ],
    edges: [{ from: 'camp_0', to: 'hall_1' }],
  };
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-cursed-compass',
    familyId: 24,
    userId: 24,
    seed: 'cursed-compass',
    map: choiceMap,
    now: 1_000,
  }));
  const expeditionId = created.expedition.id;
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-cursed-compass',
    expeditionId,
    userId: 24,
    role: 'mage',
    artifactIds: ['crooked_compass'],
    now: 1_001,
  }));
  inTx(db, () => useArtifactForMember({
    transaction: db,
    idempotencyKey: 'arm-cursed-compass',
    expeditionId,
    userId: 24,
    roomKey: 'camp_0',
    artifactId: 'crooked_compass',
    now: 1_002,
  }));
  db.prepare(`
    UPDATE family_expedition_members SET debuff_json = ?
    WHERE expedition_id = ? AND user_id = ?
  `).run(JSON.stringify({ type: 'cursed' }), expeditionId, 24);

  assert.throws(() => inTx(db, () => chooseScoutRoom({
    transaction: db,
    idempotencyKey: 'choose-cursed-compass',
    expeditionId,
    userId: 24,
    fromRoomKey: 'camp_0',
    choiceId: 'trap-path',
    now: 1_003,
  })), /only scouts can choose/);
  const cursedMember = expeditionMember(db, expeditionId, 24);
  assert.equal(JSON.parse(cursedMember.loadoutJson).triggerHistory.some(entry => (
    entry.artifactId === 'crooked_compass' && entry.remainingUses === 1
  )), true);

  db.prepare(`
    UPDATE family_expedition_members SET debuff_json = '{}'
    WHERE expedition_id = ? AND user_id = ?
  `).run(expeditionId, 24);
  const eligible = inTx(db, () => chooseScoutRoom({
    transaction: db,
    idempotencyKey: 'choose-eligible-compass',
    expeditionId,
    userId: 24,
    fromRoomKey: 'camp_0',
    choiceId: 'trap-path',
    now: 1_004,
  }));
  assert.equal(eligible.rooms.find(room => room.key === 'camp_0').scoutChoice.choiceId, 'trap-path');
  assert.equal(eligible.members.find(member => member.userId === 24).triggerHistory.some(entry => (
    entry.artifactId === 'crooked_compass'
  )), false);
  db.close();
});

test('transactional event minigame clears event rooms without d20 and pays loot only on clear', () => {
  const db = expeditionDb();
  db.prepare('INSERT INTO users (id, coins) VALUES (22, 0)').run();
  const puzzleRoom = {
    ...hall,
    key: 'rune_1',
    type: 'arcane',
    name: 'Rune Lock',
    encounterType: 'event',
    miniGame: { type: 'sequence', label: 'Trace the runes' },
    progressTarget: 2,
    loot: { coins: { min: 12, max: 12 }, artifactRolls: 0 },
    state: undefined,
    progress: undefined,
  };
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-event',
    familyId: 91,
    userId: 22,
    seed: 'event-seed',
    map: {
      rooms: [
        { ...camp, state: undefined, progress: undefined },
        puzzleRoom,
      ],
      edges: [{ from: 'camp_0', to: 'rune_1' }],
    },
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  db.prepare(`
    UPDATE family_expedition_rooms SET state = 'unlocked'
    WHERE expedition_id = ? AND room_key = 'rune_1'
  `).run(expeditionId);
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-event',
    expeditionId,
    userId: 22,
    role: 'mage',
    now: Date.UTC(2026, 5, 23),
  }));
  db.prepare(`
    UPDATE family_expedition_members SET hero_hp = 2
    WHERE expedition_id = ? AND user_id = 22
  `).run(expeditionId);

  const first = inTx(db, () => completeEventRoom({
    transaction: db,
    idempotencyKey: 'event-first',
    expeditionId,
    userId: 22,
    roomKey: 'rune_1',
    score: 70,
    rng: () => 0.99,
    now: Date.UTC(2026, 5, 23),
  }));
  assert.equal(first.rooms.find(room => room.key === 'rune_1').state, 'unlocked');
  assert.equal(first.rooms.find(room => room.key === 'rune_1').progress, 1);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 22').get().coins, 0);

  const failed = inTx(db, () => completeEventRoom({
    transaction: db,
    idempotencyKey: 'event-failed',
    expeditionId,
    userId: 22,
    roomKey: 'rune_1',
    score: 35,
    rng: () => 0.99,
    now: Date.UTC(2026, 5, 23),
  }));
  assert.equal(failed.rooms.find(room => room.key === 'rune_1').state, 'unlocked');
  assert.equal(failed.rooms.find(room => room.key === 'rune_1').progress, 1);
  assert.equal(failed.actions.at(-1).progressAwarded, 0);

  const second = inTx(db, () => completeEventRoom({
    transaction: db,
    idempotencyKey: 'event-second',
    expeditionId,
    userId: 22,
    roomKey: 'rune_1',
    score: 95,
    rng: () => 0.99,
    now: Date.UTC(2026, 5, 23),
  }));
  assert.equal(second.rooms.find(room => room.key === 'rune_1').state, 'cleared');
  assert.equal(second.members.find(member => member.userId === 22).heroHp, 2);
  assert.equal(second.actions.at(-1).actionType, 'event_minigame');
  assert.equal(second.actions.at(-1).rawRoll, null);
  assert.equal(db.prepare('SELECT coins FROM users WHERE id = 22').get().coins, 12);
  db.close();
});

test('passives do not trigger outside their applicable current-system context', () => {
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
  assert.deepEqual(firstAction.modifiers.triggeredArtifacts, []);
  assert.deepEqual(secondAction.modifiers.triggeredArtifacts, []);
  assert.equal(second.members.find(row => row.userId === 14).triggerHistory.length, 0);
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

test('idempotency replay rejects same action type with different room or action intent', () => {
  const db = expeditionDb();
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-same-type-idem',
    familyId: 83,
    userId: 16,
    seed: 'same-type-idem-seed',
    map,
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-same-type-idem',
    expeditionId,
    userId: 16,
    role: 'scout',
    now: Date.UTC(2026, 5, 23),
  }));

  const first = inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'same-attempt-key',
    expeditionId,
    userId: 16,
    roomKey: 'hall_1',
    actionId: 'thread_gap',
    roll: 7,
    now: Date.UTC(2026, 5, 23),
  }));
  const exactReplay = inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'same-attempt-key',
    expeditionId,
    userId: 16,
    roomKey: 'hall_1',
    actionId: 'thread_gap',
    roll: 7,
    now: Date.UTC(2026, 5, 23),
  }));

  assert.equal(first.actions.filter(action => action.idempotencyKey === 'same-attempt-key').length, 1);
  assert.equal(exactReplay.actions.filter(action => action.idempotencyKey === 'same-attempt-key').length, 1);
  assert.throws(() => inTx(db, () => attemptRoom({
    transaction: db,
    idempotencyKey: 'same-attempt-key',
    expeditionId,
    userId: 16,
    roomKey: 'camp_0',
    actionId: 'tend_campfire',
    roll: 7,
    now: Date.UTC(2026, 5, 23),
  })), /idempotency conflict/);
  db.close();
});

test('transactional attempt replay succeeds while the hero is recovering from its knockout', () => {
  const db = expeditionDb();
  const combatHall = {
    ...hall,
    type: 'combat',
    encounterType: 'combat',
    progressTarget: 20,
    actions: [{ ...hall.actions[0], stat: 'might', modifier: 0 }],
  };
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'create-knockout-replay',
    familyId: 84,
    userId: 17,
    seed: 'knockout-replay-seed',
    map: {
      rooms: [camp, combatHall],
      edges: [{ from: 'camp_0', to: 'hall_1' }],
    },
    now: 1000,
  }));
  const expeditionId = created.expedition.id;
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'prepare-knockout-replay',
    expeditionId,
    userId: 17,
    role: 'scout',
    now: 1000,
  }));
  db.prepare(`
    UPDATE family_expedition_rooms SET state = 'unlocked'
    WHERE expedition_id = ? AND room_key = 'hall_1'
  `).run(expeditionId);
  db.prepare(`
    UPDATE family_expedition_members SET hero_hp = 1
    WHERE expedition_id = ? AND user_id = 17
  `).run(expeditionId);

  const attempt = {
    transaction: db,
    idempotencyKey: 'attempt-knockout-replay',
    expeditionId,
    userId: 17,
    roomKey: 'hall_1',
    actionId: 'thread_gap',
    roll: 1,
    now: 2000,
  };
  const first = inTx(db, () => attemptRoom(attempt));
  const memberAfterKnockout = db.prepare(`
    SELECT ap, hero_hp AS heroHp, hero_recover_at AS heroRecoverAt
    FROM family_expedition_members
    WHERE expedition_id = ? AND user_id = 17
  `).get(expeditionId);
  const replay = inTx(db, () => attemptRoom(attempt));

  assert.deepEqual(memberAfterKnockout, {
    ap: 4,
    heroHp: 0,
    heroRecoverAt: 2000 + 6 * 60 * 60,
  });
  assert.deepEqual(db.prepare(`
    SELECT ap, hero_hp AS heroHp, hero_recover_at AS heroRecoverAt
    FROM family_expedition_members
    WHERE expedition_id = ? AND user_id = 17
  `).get(expeditionId), memberAfterKnockout);
  assert.equal(first.actions.filter(action => action.idempotencyKey === 'attempt-knockout-replay').length, 1);
  assert.equal(replay.actions.filter(action => action.idempotencyKey === 'attempt-knockout-replay').length, 1);
  db.close();
});

test('preparation reserves artifact copies and active use is idempotent against stale requests', () => {
  const db = expeditionDb();
  db.prepare('INSERT INTO users (id, coins) VALUES (11, 0)').run();
  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES (11, 'tiny_shovel', 1, 0, 1, 1), (11, 'old_torch', 1, 0, 1, 1)
  `).run();
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'artifact-create',
    familyId: 1,
    userId: 11,
    seed: 'artifact-seed',
    map,
    now: 100,
  }));
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'artifact-prepare',
    expeditionId: created.expedition.id,
    userId: 11,
    role: 'scout',
    artifactIds: ['tiny_shovel', 'old_torch'],
    now: 101,
  }));
  assert.deepEqual(db.prepare(`
    SELECT artifact_id AS artifactId, quantity
    FROM expedition_artifact_inventory WHERE user_id = 11 ORDER BY artifact_id
  `).all(), [
    { artifactId: 'old_torch', quantity: 0 },
    { artifactId: 'tiny_shovel', quantity: 0 },
  ]);

  const first = inTx(db, () => useArtifactForMember({
    transaction: db,
    idempotencyKey: 'use-shovel',
    expeditionId: created.expedition.id,
    userId: 11,
    roomKey: 'hall_1',
    artifactId: 'tiny_shovel',
    now: 102,
  }));
  const replay = inTx(db, () => useArtifactForMember({
    transaction: db,
    idempotencyKey: 'use-shovel',
    expeditionId: created.expedition.id,
    userId: 11,
    roomKey: 'hall_1',
    artifactId: 'tiny_shovel',
    now: 103,
  }));
  assert.equal(first.snapshot.rooms.find(room => room.key === 'hall_1').progress, 2);
  assert.equal(replay.snapshot.rooms.find(room => room.key === 'hall_1').progress, 2);
  assert.deepEqual(first.visualEvents, replay.visualEvents);
  assert.throws(() => inTx(db, () => useArtifactForMember({
    transaction: db,
    idempotencyKey: 'stale-use-shovel',
    expeditionId: created.expedition.id,
    userId: 11,
    roomKey: 'hall_1',
    artifactId: 'tiny_shovel',
    now: 104,
  })), /not equipped/);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM family_expedition_actions
    WHERE action_type = 'use_artifact' AND user_id = 11
  `).get().count, 1);
  db.close();
});

test('finishing consumes reserved passives and returns unused active copies', () => {
  const db = expeditionDb();
  db.prepare('INSERT INTO users (id, coins) VALUES (11, 0)').run();
  db.prepare(`
    INSERT INTO expedition_artifact_inventory (
      user_id, artifact_id, quantity, charges, first_acquired_at, last_acquired_at
    ) VALUES (11, 'ration_box', 1, 0, 1, 1), (11, 'old_torch', 1, 0, 1, 1)
  `).run();
  const created = inTx(db, () => createExpedition({
    transaction: db,
    idempotencyKey: 'finish-artifact-create',
    familyId: 1,
    userId: 11,
    seed: 'finish-artifact-seed',
    map,
    now: 100,
  }));
  inTx(db, () => prepareMember({
    transaction: db,
    idempotencyKey: 'finish-artifact-prepare',
    expeditionId: created.expedition.id,
    userId: 11,
    role: 'scout',
    artifactIds: ['ration_box', 'old_torch'],
    now: 101,
  }));
  db.prepare("UPDATE family_expeditions SET status = 'boss_defeated' WHERE id = ?")
    .run(created.expedition.id);
  inTx(db, () => finishExpedition({
    transaction: db,
    idempotencyKey: 'finish-artifact-expedition',
    expeditionId: created.expedition.id,
    userId: 11,
    now: 102,
  }));
  assert.deepEqual(db.prepare(`
    SELECT artifact_id AS artifactId, quantity
    FROM expedition_artifact_inventory WHERE user_id = 11 ORDER BY artifact_id
  `).all(), [
    { artifactId: 'old_torch', quantity: 0 },
    { artifactId: 'ration_box', quantity: 1 },
  ]);
  db.close();
});

test('failed minigames preserve HP and do not consume an armed Wooden Shield', () => {
  const scenario = minigameArtifactScenario({ userId: 31, artifactIds: ['wooden_shield'] });
  inTx(scenario.db, () => useArtifactForMember({
    transaction: scenario.db,
    idempotencyKey: 'arm-wooden-shield-minigame',
    expeditionId: scenario.expeditionId,
    userId: scenario.userId,
    roomKey: scenario.roomKey,
    artifactId: 'wooden_shield',
    now: 1_900,
  }));

  const first = failMinigameAttempt(scenario, 'wooden-shield-first', 2_000);
  const firstMember = first.snapshot.members.find(member => member.userId === scenario.userId);
  assert.equal(firstMember.heroHp, 3);
  assert.deepEqual(first.visualEvents, []);
  assert.equal(firstMember.triggerHistory.some(entry => entry.artifactId === 'wooden_shield'), true);

  const second = failMinigameAttempt(scenario, 'wooden-shield-second', 2_010);
  const secondMember = second.snapshot.members.find(member => member.userId === scenario.userId);
  assert.equal(secondMember.heroHp, 3);
  assert.deepEqual(second.visualEvents, []);
  assert.equal(secondMember.triggerHistory.some(entry => entry.artifactId === 'wooden_shield'), true);
  scenario.db.close();
});

test('failed minigames preserve HP and personal damage passives for combat', () => {
  const lastStand = minigameArtifactScenario({
    userId: 32,
    artifactIds: ['last_stand_banner'],
    heroHp: 1,
  });
  const first = failMinigameAttempt(lastStand, 'last-stand-first', 2_000);
  const firstMember = first.snapshot.members.find(member => member.userId === lastStand.userId);
  assert.equal(firstMember.heroHp, 1);
  assert.deepEqual(first.visualEvents, []);
  assert.equal(firstMember.triggerHistory.filter(entry => entry.artifactId === 'last_stand_banner').length, 0);

  const second = failMinigameAttempt(lastStand, 'last-stand-second', 2_010);
  const secondMember = second.snapshot.members.find(member => member.userId === lastStand.userId);
  assert.equal(secondMember.heroHp, 1);
  assert.deepEqual(second.visualEvents, []);
  lastStand.db.close();

  const rabbit = minigameArtifactScenario({ userId: 33, artifactIds: ['rabbit_foot'] });
  const rabbitFailure = failMinigameAttempt(rabbit, 'rabbit-foot', 2_000);
  const rabbitMember = rabbitFailure.snapshot.members.find(member => member.userId === rabbit.userId);
  assert.equal(rabbitMember.heroHp, 3);
  assert.deepEqual(rabbitFailure.visualEvents, []);
  assert.equal(rabbitMember.triggerHistory.some(entry => entry.artifactId === 'rabbit_foot'), false);
  rabbit.db.close();
});

test('Old Torch persists a server-owned 10% timing window and extends the attempt limit', () => {
  const scenario = minigameArtifactScenario({ userId: 34, artifactIds: ['old_torch'] });
  const started = inTx(scenario.db, () => startMinigameAttempt({
    transaction: scenario.db,
    idempotencyKey: 'start-old-torch-window',
    expeditionId: scenario.expeditionId,
    userId: scenario.userId,
    roomKey: scenario.roomKey,
    now: 2_000,
  }));
  assert.equal(started.attempt.expiresAt - started.attempt.startedAt, 13);
  const metadata = JSON.parse(scenario.db.prepare(`
    SELECT result_json FROM family_expedition_minigame_attempts WHERE attempt_token = ?
  `).pluck().get(started.attempt.attemptToken));
  assert.equal(metadata.successWindowMultiplier, 1.1);

  const result = inTx(scenario.db, () => finishMinigameAttempt({
    transaction: scenario.db,
    idempotencyKey: 'finish-old-torch-window',
    expeditionId: scenario.expeditionId,
    userId: scenario.userId,
    roomKey: scenario.roomKey,
    attemptToken: started.attempt.attemptToken,
    result: { success: true, score: 55 },
    now: 2_001,
  }));
  assert.equal(result.success, true);
  assert.equal(result.snapshot.rooms.find(room => room.key === scenario.roomKey).progress, 1);
  scenario.db.close();
});

test('cursed minigame starts skip Old Torch and armed minigame artifacts until the next eligible attempt', () => {
  const scenario = minigameArtifactScenario({
    userId: 36,
    artifactIds: ['old_torch', 'chalk_rune', 'rusty_lockpick'],
  });
  inTx(scenario.db, () => useArtifactForMember({
    transaction: scenario.db,
    idempotencyKey: 'arm-cursed-chalk-rune',
    expeditionId: scenario.expeditionId,
    userId: scenario.userId,
    roomKey: scenario.roomKey,
    artifactId: 'chalk_rune',
    now: 1_900,
  }));
  inTx(scenario.db, () => useArtifactForMember({
    transaction: scenario.db,
    idempotencyKey: 'arm-cursed-rusty-lockpick',
    expeditionId: scenario.expeditionId,
    userId: scenario.userId,
    roomKey: scenario.roomKey,
    artifactId: 'rusty_lockpick',
    now: 1_901,
  }));
  scenario.db.prepare(`
    UPDATE family_expedition_members SET debuff_json = ?
    WHERE expedition_id = ? AND user_id = ?
  `).run(JSON.stringify({ type: 'cursed' }), scenario.expeditionId, scenario.userId);

  const cursed = inTx(scenario.db, () => startMinigameAttempt({
    transaction: scenario.db,
    idempotencyKey: 'start-cursed-minigame-artifacts',
    expeditionId: scenario.expeditionId,
    userId: scenario.userId,
    roomKey: scenario.roomKey,
    now: 2_000,
  }));
  assert.equal(cursed.attempt.expiresAt - cursed.attempt.startedAt, 12);
  assert.deepEqual(cursed.visualEvents, []);
  const cursedMetadata = JSON.parse(scenario.db.prepare(`
    SELECT result_json FROM family_expedition_minigame_attempts WHERE attempt_token = ?
  `).pluck().get(cursed.attempt.attemptToken));
  assert.equal(cursedMetadata.successWindowMultiplier, 1);
  assert.equal(cursedMetadata.artifactAutoSuccess, undefined);
  const afterCursed = cursed.snapshot.members.find(member => member.userId === scenario.userId);
  assert.equal(afterCursed.triggerHistory.filter(entry => (
    ['chalk_rune', 'rusty_lockpick'].includes(entry.artifactId)
  )).length, 2);

  const finishedCursed = inTx(scenario.db, () => finishMinigameAttempt({
    transaction: scenario.db,
    idempotencyKey: 'finish-cursed-minigame-artifacts',
    expeditionId: scenario.expeditionId,
    userId: scenario.userId,
    roomKey: scenario.roomKey,
    attemptToken: cursed.attempt.attemptToken,
    result: { success: true, score: 55 },
    now: 2_001,
  }));
  assert.equal(finishedCursed.snapshot.members.find(member => member.userId === scenario.userId)
    .triggerHistory.filter(entry => ['chalk_rune', 'rusty_lockpick'].includes(entry.artifactId)).length, 2);
  const eligible = inTx(scenario.db, () => startMinigameAttempt({
    transaction: scenario.db,
    idempotencyKey: 'start-eligible-minigame-artifacts',
    expeditionId: scenario.expeditionId,
    userId: scenario.userId,
    roomKey: scenario.roomKey,
    now: 2_010,
  }));
  assert.deepEqual(eligible.visualEvents, [
    { type: 'artifact_minigame_time', artifactId: 'chalk_rune', seconds: 3 },
    { type: 'artifact_minigame_auto_success', artifactId: 'rusty_lockpick' },
  ]);
  assert.equal(eligible.attempt.expiresAt - eligible.attempt.startedAt, 16);
  const eligibleMetadata = JSON.parse(scenario.db.prepare(`
    SELECT result_json FROM family_expedition_minigame_attempts WHERE attempt_token = ?
  `).pluck().get(eligible.attempt.attemptToken));
  assert.equal(eligibleMetadata.successWindowMultiplier, 1.1);
  assert.equal(eligibleMetadata.artifactAutoSuccess, 'rusty_lockpick');
  assert.equal(eligible.snapshot.members.find(member => member.userId === scenario.userId)
    .triggerHistory.some(entry => ['chalk_rune', 'rusty_lockpick'].includes(entry.artifactId)), false);
  scenario.db.close();
});
