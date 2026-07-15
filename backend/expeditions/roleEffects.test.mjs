import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const {
  ROLE_EFFECT_TYPES,
  advanceRoleCharge,
  consumeRoleCharge,
  consumeMageRetry,
  consumeRoomEffect,
  listActiveRoomEffects,
  placeRoleEffect,
  resolveMageRoll,
  useClericPrayer,
} = require('./roleEffects.js');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      first_name TEXT NOT NULL,
      username TEXT
    );
    CREATE TABLE family_expedition_members (
      expedition_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      role_charge INTEGER NOT NULL DEFAULT 1,
      role_charge_progress INTEGER NOT NULL DEFAULT 0,
      role_charge_ready_at INTEGER NOT NULL DEFAULT 0,
      hero_hp INTEGER NOT NULL DEFAULT 3,
      hero_recover_at INTEGER,
      prepared_at INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (expedition_id, user_id)
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
    CREATE UNIQUE INDEX active_room_effect
      ON family_expedition_room_effects(expedition_id, room_id, effect_type)
      WHERE consumed_at IS NULL;
    CREATE TABLE family_expedition_member_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expedition_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      acknowledged_at INTEGER
    );
  `);
  db.prepare('INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)').run(10, 'Nora', 'nora');
  db.prepare('INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)').run(11, 'Milo', 'milo');
  db.prepare('INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)').run(12, 'Pip', null);
  return db;
}

function addMember(db, {
  userId,
  role,
  charge = 1,
  progress = 0,
  hp = 3,
  recoverAt = null,
}) {
  db.prepare(`
    INSERT INTO family_expedition_members (
      expedition_id, user_id, role, role_charge, role_charge_progress, hero_hp, hero_recover_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run(userId, role, charge, progress, hp, recoverAt);
}

test('advanceRoleCharge caps at one and recharges after the configured AP threshold', () => {
  assert.deepEqual(
    advanceRoleCharge({ roleCharge: 0, roleChargeProgress: 2 }, 1, 3),
    { roleCharge: 1, roleChargeProgress: 0 },
  );
  assert.deepEqual(
    advanceRoleCharge({ roleCharge: 0, roleChargeProgress: 0 }, 1, 2),
    { roleCharge: 0, roleChargeProgress: 1 },
  );
  assert.deepEqual(
    advanceRoleCharge({ roleCharge: 1, roleChargeProgress: 2 }, 5, 3),
    { roleCharge: 1, roleChargeProgress: 0 },
  );
});

test('placing an effect consumes charge only after duplicate validation', () => {
  const db = createDb();
  addMember(db, { userId: 10, role: 'knight' });
  addMember(db, { userId: 11, role: 'knight' });

  const placed = placeRoleEffect(db, {
    expeditionId: 1,
    roomId: 2,
    userId: 10,
    role: 'knight',
    now: 1000,
  });
  assert.equal(placed.effectType, ROLE_EFFECT_TYPES.knight);
  assert.equal(db.prepare('SELECT role_charge FROM family_expedition_members WHERE user_id = 10').pluck().get(), 0);

  assert.throws(() => placeRoleEffect(db, {
    expeditionId: 1,
    roomId: 2,
    userId: 11,
    role: 'knight',
    now: 1001,
  }), /already active/i);
  assert.equal(db.prepare('SELECT role_charge FROM family_expedition_members WHERE user_id = 11').pluck().get(), 1);
  db.close();
});

test('shield consumption returns its owner and prevents exactly one damage', () => {
  const db = createDb();
  addMember(db, { userId: 10, role: 'knight' });
  placeRoleEffect(db, { expeditionId: 1, roomId: 2, userId: 10, role: 'knight', now: 1000 });

  const consumed = consumeRoomEffect(db, {
    expeditionId: 1,
    roomId: 2,
    effectType: ROLE_EFFECT_TYPES.knight,
    now: 1002,
  });
  assert.deepEqual(consumed.event, {
    type: 'shield_blocked',
    effectId: consumed.effect.id,
    placedBy: { userId: 10, firstName: 'Nora', username: 'nora' },
    preventedDamage: 1,
  });
  assert.equal(listActiveRoomEffects(db, { expeditionId: 1, roomId: 2 }).length, 0);
  assert.equal(consumeRoomEffect(db, {
    expeditionId: 1,
    roomId: 2,
    effectType: ROLE_EFFECT_TYPES.knight,
    now: 1003,
  }), null);
  db.close();
});

test('Bend Fate consumes once and chooses the higher server roll', () => {
  const db = createDb();
  addMember(db, { userId: 10, role: 'mage' });
  placeRoleEffect(db, { expeditionId: 1, roomId: 2, userId: 10, role: 'mage', now: 1000 });

  const result = resolveMageRoll(db, {
    expeditionId: 1,
    roomId: 2,
    rolls: [7, 16],
    now: 1002,
  });
  assert.equal(result.chosen, 16);
  assert.deepEqual(result.event, {
    type: 'mage_advantage',
    effectId: result.effect.id,
    rolls: [7, 16],
    chosen: 16,
    placedBy: { userId: 10, firstName: 'Nora', username: 'nora' },
  });
  assert.equal(resolveMageRoll(db, {
    expeditionId: 1,
    roomId: 2,
    rolls: [4, 20],
    now: 1003,
  }), null);
  db.close();
});

test('Bend Fate exposes a one-shot free mini-game retry for the attempt state machine', () => {
  const db = createDb();
  addMember(db, { userId: 10, role: 'mage' });
  placeRoleEffect(db, { expeditionId: 1, roomId: 2, userId: 10, role: 'mage', now: 1000 });

  const retry = consumeMageRetry(db, { expeditionId: 1, roomId: 2, now: 1002 });
  assert.deepEqual(retry.event, {
    type: 'mage_retry',
    effectId: retry.effect.id,
    placedBy: { userId: 10, firstName: 'Nora', username: 'nora' },
    retryWithoutAp: true,
    preventedDamage: 1,
  });
  assert.equal(consumeMageRetry(db, { expeditionId: 1, roomId: 2, now: 1003 }), null);
  db.close();
});

test('Cleric prayer heals the family and shortens knocked-out recovery by 15 percent', () => {
  const db = createDb();
  addMember(db, { userId: 10, role: 'cleric', hp: 2 });
  addMember(db, { userId: 11, role: 'mage', hp: 2 });
  addMember(db, { userId: 12, role: 'scout', hp: 0, recoverAt: 10_000 });

  const result = useClericPrayer(db, {
    expeditionId: 1,
    userId: 10,
    now: 1000,
  });
  assert.equal(result.events.length, 1);
  assert.equal(db.prepare('SELECT hero_hp FROM family_expedition_members WHERE user_id = 10').pluck().get(), 3);
  assert.equal(db.prepare('SELECT hero_hp FROM family_expedition_members WHERE user_id = 11').pluck().get(), 3);
  assert.equal(db.prepare('SELECT hero_hp FROM family_expedition_members WHERE user_id = 12').pluck().get(), 0);
  assert.equal(db.prepare('SELECT hero_recover_at FROM family_expedition_members WHERE user_id = 12').pluck().get(), 8650);
  assert.deepEqual(
    db.prepare('SELECT event_type FROM family_expedition_member_events ORDER BY user_id').pluck().all(),
    ['cleric_heal', 'cleric_heal', 'cleric_recovery_reduced'],
  );
  assert.equal(db.prepare('SELECT role_charge FROM family_expedition_members WHERE user_id = 10').pluck().get(), 0);
  assert.deepEqual(result.events, [{
    type: 'cleric_prayer',
    placedBy: { userId: 10, firstName: 'Nora', username: 'nora' },
    healedCount: 2,
    recoveryReducedCount: 1,
  }]);
  db.close();
});

test('Scout charge is consumed once and does not recharge from AP spending', () => {
  const db = createDb();
  addMember(db, { userId: 10, role: 'scout' });

  assert.deepEqual(consumeRoleCharge(db, {
    expeditionId: 1,
    userId: 10,
    expectedRole: 'scout',
  }), { roleCharge: 0, roleChargeProgress: 0, roleChargeReadyAt: 0 });
  assert.throws(() => consumeRoleCharge(db, {
    expeditionId: 1,
    userId: 10,
    expectedRole: 'scout',
  }), /not charged/i);
  db.close();
});

test('Knight, Mage and Cleric abilities recover after a three-hour cooldown', () => {
  const db = createDb();
  addMember(db, { userId: 10, role: 'knight' });
  addMember(db, { userId: 11, role: 'mage' });
  const consumed = consumeRoleCharge(db, {
    expeditionId: 1,
    userId: 10,
    expectedRole: 'knight',
    now: 1000,
  });
  assert.equal(consumed.roleChargeReadyAt, 1000 + (3 * 60 * 60));
  assert.throws(() => consumeRoleCharge(db, {
    expeditionId: 1,
    userId: 10,
    expectedRole: 'knight',
    now: consumed.roleChargeReadyAt - 1,
  }), /not charged/i);
  const recovered = consumeRoleCharge(db, {
    expeditionId: 1,
    userId: 10,
    expectedRole: 'knight',
    now: consumed.roleChargeReadyAt,
  });
  assert.equal(recovered.roleChargeReadyAt, consumed.roleChargeReadyAt + (3 * 60 * 60));
  assert.equal(consumeRoleCharge(db, {
    expeditionId: 1,
    userId: 11,
    expectedRole: 'mage',
    now: 1000,
  }).roleChargeReadyAt, 1000 + (3 * 60 * 60));
  db.close();
});
