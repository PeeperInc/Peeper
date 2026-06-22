import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const databaseModulePath = require.resolve('../database.js');
const notificationModulePath = require.resolve('../notificationSettings.js');
const betterSqliteModulePath = require.resolve('better-sqlite3');

function createTempDatabasePath() {
  const directory = mkdtempSync(path.join(tmpdir(), 'peeper-expedition-schema-'));
  return {
    directory,
    databasePath: path.join(directory, 'peeper.test.db'),
  };
}

function initializeDatabaseAt(databasePath) {
  delete require.cache[databaseModulePath];
  delete require.cache[notificationModulePath];

  const originalDatabaseExport = require.cache[betterSqliteModulePath].exports;
  function IsolatedDatabase(requestedPath, options) {
    assert.equal(
      requestedPath,
      databasePath,
      'database initialization must honor PEEPER_DB_PATH',
    );
    return new Database(requestedPath, options);
  }
  IsolatedDatabase.prototype = Database.prototype;

  require.cache[betterSqliteModulePath].exports = IsolatedDatabase;
  process.env.PEEPER_DB_PATH = databasePath;
  try {
    return require(databaseModulePath);
  } finally {
    delete process.env.PEEPER_DB_PATH;
    require.cache[betterSqliteModulePath].exports = originalDatabaseExport;
  }
}

function withTempDatabase(callback) {
  const { directory, databasePath } = createTempDatabasePath();
  let db;
  try {
    db = initializeDatabaseAt(databasePath);
    return callback(db, databasePath);
  } finally {
    db?.close();
    delete require.cache[databaseModulePath];
    delete require.cache[notificationModulePath];
    rmSync(directory, { recursive: true, force: true });
  }
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function foreignKeys(db, table) {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all();
}

function indexes(db, table) {
  return db.prepare(`PRAGMA index_list(${table})`).all();
}

function normalizedForeignKeys(db, table) {
  return foreignKeys(db, table)
    .map(({ from, table: referencedTable, on_delete }) => ({
      from,
      table: referencedTable,
      on_delete,
    }))
    .sort((left, right) => left.from.localeCompare(right.from));
}

function normalizedIndexes(db, table) {
  return indexes(db, table)
    .map(({ name, origin, unique }) => ({
      name: name.startsWith('sqlite_autoindex_') ? 'auto' : name,
      origin,
      unique,
    }))
    .sort((left, right) => `${left.origin}:${left.name}`.localeCompare(`${right.origin}:${right.name}`));
}

test('existing notification settings migrate with expedition alerts enabled and toggleable', () => {
  const { directory, databasePath } = createTempDatabasePath();
  const legacyDb = new Database(databasePath);
  legacyDb.exec(`
    CREATE TABLE user_notification_settings (
      user_id INTEGER PRIMARY KEY,
      care_notifications INTEGER NOT NULL DEFAULT 1,
      family_notifications INTEGER NOT NULL DEFAULT 1,
      gift_notifications INTEGER NOT NULL DEFAULT 1,
      jackpot_notifications INTEGER NOT NULL DEFAULT 1,
      farm_notifications INTEGER NOT NULL DEFAULT 1,
      farm_animal_notifications INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    INSERT INTO user_notification_settings (
      user_id,
      care_notifications,
      family_notifications,
      gift_notifications,
      jackpot_notifications,
      farm_notifications,
      farm_animal_notifications
    ) VALUES (42, 0, 1, 0, 1, 0, 1);
  `);
  legacyDb.close();

  let db;
  try {
    db = initializeDatabaseAt(databasePath);
    const notifications = require(notificationModulePath);
    const migratedColumn = columns(db, 'user_notification_settings')
      .find((column) => column.name === 'expedition_notifications');

    assert.equal(migratedColumn.notnull, 1);
    assert.equal(migratedColumn.dflt_value, '1');
    assert.deepEqual(notifications.getNotificationSettings(42), {
      care_notifications: 0,
      family_notifications: 1,
      gift_notifications: 0,
      jackpot_notifications: 1,
      farm_notifications: 0,
      farm_animal_notifications: 1,
      expedition_notifications: 1,
    });

    const toggled = notifications.toggleNotificationSetting(42, 'expedition_notifications');
    assert.equal(toggled.expedition_notifications, 0);
    assert.equal(
      db.prepare('SELECT expedition_notifications FROM user_notification_settings WHERE user_id = 42').get()
        .expedition_notifications,
      0,
    );
  } finally {
    db?.close();
    delete require.cache[databaseModulePath];
    delete require.cache[notificationModulePath];
    rmSync(directory, { recursive: true, force: true });
  }
});

test('existing redundant artifact ownership index is removed', () => {
  const { directory, databasePath } = createTempDatabasePath();
  const legacyDb = new Database(databasePath);
  legacyDb.exec(`
    CREATE TABLE expedition_artifact_inventory (
      user_id INTEGER NOT NULL,
      artifact_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      charges INTEGER NOT NULL DEFAULT 0,
      first_acquired_at INTEGER NOT NULL,
      last_acquired_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, artifact_id)
    );
    CREATE INDEX idx_expedition_artifacts_user
      ON expedition_artifact_inventory(user_id, artifact_id);
  `);
  legacyDb.close();

  let db;
  try {
    db = initializeDatabaseAt(databasePath);
    assert.deepEqual(
      normalizedIndexes(db, 'expedition_artifact_inventory'),
      [{ name: 'auto', origin: 'pk', unique: 1 }],
    );
  } finally {
    db?.close();
    delete require.cache[databaseModulePath];
    rmSync(directory, { recursive: true, force: true });
  }
});

test('expedition schema exposes required columns, foreign keys, and indexes', () => {
  withTempDatabase((db) => {
    const expectedColumns = {
      family_expeditions: [
        'id', 'family_id', 'theme_id', 'seed', 'status', 'map_json', 'shared_buffs_json',
        'started_by', 'started_at', 'boss_defeated_at', 'finished_at',
      ],
      family_expedition_rooms: [
        'id', 'expedition_id', 'room_key', 'room_type', 'state', 'progress',
        'progress_target', 'support', 'payload_json', 'unlocked_at', 'cleared_at',
      ],
      family_expedition_members: [
        'expedition_id', 'user_id', 'role', 'ap', 'ap_regen_day', 'role_ability_day',
        'role_ability_used', 'provision_id', 'provision_state_json', 'loadout_json',
        'debuff_json', 'contribution_ap', 'contribution_progress', 'prepared_at',
        'boss_reward_claimed_at',
      ],
      expedition_artifact_inventory: [
        'user_id', 'artifact_id', 'quantity', 'charges', 'first_acquired_at', 'last_acquired_at',
      ],
      family_expedition_actions: [
        'id', 'idempotency_key', 'expedition_id', 'room_id', 'user_id', 'action_type',
        'stat', 'raw_roll', 'modifier_json', 'modified_roll', 'progress_awarded', 'loot_json',
        'narration_key', 'created_at',
      ],
      family_expedition_history: [
        'id', 'expedition_id', 'family_id', 'summary_json', 'finished_at',
      ],
    };

    for (const [table, expected] of Object.entries(expectedColumns)) {
      assert.deepEqual(columns(db, table).map((column) => column.name), expected, table);
      assert.ok(Array.isArray(foreignKeys(db, table)), `${table} foreign keys are inspectable`);
      assert.ok(Array.isArray(indexes(db, table)), `${table} indexes are inspectable`);
    }

    const expectedForeignKeys = {
      family_expeditions: [
        { from: 'family_id', table: 'families', on_delete: 'CASCADE' },
        { from: 'started_by', table: 'users', on_delete: 'NO ACTION' },
      ],
      family_expedition_rooms: [
        { from: 'expedition_id', table: 'family_expeditions', on_delete: 'CASCADE' },
      ],
      family_expedition_members: [
        { from: 'expedition_id', table: 'family_expeditions', on_delete: 'CASCADE' },
        { from: 'user_id', table: 'users', on_delete: 'CASCADE' },
      ],
      expedition_artifact_inventory: [
        { from: 'user_id', table: 'users', on_delete: 'CASCADE' },
      ],
      family_expedition_actions: [
        { from: 'expedition_id', table: 'family_expeditions', on_delete: 'CASCADE' },
        { from: 'room_id', table: 'family_expedition_rooms', on_delete: 'CASCADE' },
        { from: 'user_id', table: 'users', on_delete: 'CASCADE' },
      ],
      family_expedition_history: [
        { from: 'expedition_id', table: 'family_expeditions', on_delete: 'CASCADE' },
        { from: 'family_id', table: 'families', on_delete: 'CASCADE' },
      ],
    };
    for (const [table, expected] of Object.entries(expectedForeignKeys)) {
      assert.deepEqual(normalizedForeignKeys(db, table), expected, `${table} foreign keys`);
    }

    const expectedIndexes = {
      family_expeditions: [
        { name: 'idx_family_expeditions_family_status', origin: 'c', unique: 0 },
      ],
      family_expedition_rooms: [
        { name: 'idx_family_expedition_rooms_expedition', origin: 'c', unique: 0 },
        { name: 'auto', origin: 'u', unique: 1 },
      ],
      family_expedition_members: [
        { name: 'auto', origin: 'pk', unique: 1 },
      ],
      expedition_artifact_inventory: [
        { name: 'auto', origin: 'pk', unique: 1 },
      ],
      family_expedition_actions: [
        { name: 'idx_family_expedition_actions_chronology', origin: 'c', unique: 0 },
        { name: 'auto', origin: 'u', unique: 1 },
      ],
      family_expedition_history: [
        { name: 'idx_family_expedition_history_family', origin: 'c', unique: 0 },
      ],
    };
    for (const [table, expected] of Object.entries(expectedIndexes)) {
      assert.deepEqual(normalizedIndexes(db, table), expected, `${table} indexes`);
    }

    const defaults = Object.fromEntries(
      columns(db, 'family_expedition_members').map(({ name, dflt_value }) => [name, dflt_value]),
    );
    assert.equal(defaults.ap, '3');
    assert.equal(defaults.role_ability_used, '0');
    assert.equal(defaults.provision_state_json, "'{}'");
    assert.equal(defaults.loadout_json, "'[]'");
    assert.equal(defaults.debuff_json, "'{}'");
    assert.equal(defaults.contribution_ap, '0');
    assert.equal(defaults.contribution_progress, '0');
  });
});

test('expedition schema enforces status, uniqueness, foreign keys, and cascades', () => {
  withTempDatabase((db) => {
    db.prepare("INSERT INTO users (id, telegram_id) VALUES (1, 'owner'), (2, 'member')").run();
    db.prepare("INSERT INTO families (id, name, founder_id, invite_code) VALUES (10, 'Test Family', 1, 'TEST10')").run();

    const insertExpedition = db.prepare(`
      INSERT INTO family_expeditions (
        id, family_id, theme_id, seed, status, map_json, started_by, started_at
      ) VALUES (?, 10, 'root-king', 'seed', ?, '{}', 1, 1000)
    `);
    insertExpedition.run(100, 'active');
    assert.throws(() => insertExpedition.run(101, 'failed'), /CHECK constraint failed/);

    const insertRoom = db.prepare(`
      INSERT INTO family_expedition_rooms (
        id, expedition_id, room_key, room_type, state, progress_target
      ) VALUES (?, ?, ?, 'combat', 'available', 5)
    `);
    insertRoom.run(200, 100, 'room-1');
    assert.throws(() => insertRoom.run(201, 100, 'room-1'), /UNIQUE constraint failed/);
    assert.throws(() => insertRoom.run(202, 999, 'orphan'), /FOREIGN KEY constraint failed/);

    db.prepare(`
      INSERT INTO family_expedition_members (
        expedition_id, user_id, role, ap_regen_day, role_ability_day, prepared_at
      ) VALUES (100, 2, 'knight', 1, 1, 1000)
    `).run();
    db.prepare(`
      INSERT INTO expedition_artifact_inventory (
        user_id, artifact_id, quantity, first_acquired_at, last_acquired_at
      ) VALUES (2, 'root-blade', 1, 1000, 1000)
    `).run();
    assert.throws(() => db.prepare(`
      INSERT INTO expedition_artifact_inventory (
        user_id, artifact_id, quantity, first_acquired_at, last_acquired_at
      ) VALUES (2, 'root-blade', 1, 1000, 1000)
    `).run(), /UNIQUE constraint failed/);

    const insertAction = db.prepare(`
      INSERT INTO family_expedition_actions (
        idempotency_key, expedition_id, room_id, user_id, action_type, created_at
      ) VALUES ('attempt-1', 100, 200, 2, 'attempt', 1001)
    `);
    insertAction.run();
    assert.throws(() => insertAction.run(), /UNIQUE constraint failed/);
    db.prepare(`
      INSERT INTO family_expedition_history (expedition_id, family_id, summary_json, finished_at)
      VALUES (100, 10, '{}', 2000)
    `).run();

    db.prepare('DELETE FROM family_expeditions WHERE id = 100').run();
    for (const table of [
      'family_expedition_rooms',
      'family_expedition_members',
      'family_expedition_actions',
      'family_expedition_history',
    ]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expedition_artifact_inventory').get().count, 1);

    db.prepare('DELETE FROM users WHERE id = 2').run();
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expedition_artifact_inventory').get().count, 0);
  });
});
