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

function indexedColumns(db, indexName) {
  const escapedName = indexName.replaceAll("'", "''");
  return db.prepare(`PRAGMA index_xinfo('${escapedName}')`).all()
    .filter(({ key }) => key === 1)
    .map(({ name, desc }) => ({ name, desc }));
}

function indexSql(db, indexName) {
  return db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get('index', indexName)?.sql ?? null;
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
      columns: indexedColumns(db, name),
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
      [{
        name: 'auto',
        origin: 'pk',
        unique: 1,
        columns: [
          { name: 'user_id', desc: 0 },
          { name: 'artifact_id', desc: 0 },
        ],
      }],
    );
  } finally {
    db?.close();
    delete require.cache[databaseModulePath];
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy expedition members migrate idempotently without losing rows', () => {
  const { directory, databasePath } = createTempDatabasePath();
  const legacyDb = new Database(databasePath);
  legacyDb.exec(`
    CREATE TABLE family_expedition_members (
      expedition_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      ap INTEGER NOT NULL DEFAULT 3,
      ap_regen_day INTEGER NOT NULL,
      role_ability_day INTEGER NOT NULL,
      role_ability_used INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(expedition_id, user_id)
    );
    INSERT INTO family_expedition_members (
      expedition_id, user_id, role, ap, ap_regen_day, role_ability_day
    ) VALUES (7, 42, 'scout', 2, 100, 100);
  `);
  legacyDb.close();

  const expectedRow = {
    expedition_id: 7,
    user_id: 42,
    role: 'scout',
    ap: 2,
    role_charge: 1,
    role_charge_progress: 0,
    room_coins_earned: 0,
  };
  let db;
  try {
    for (let initialization = 0; initialization < 2; initialization += 1) {
      db = initializeDatabaseAt(databasePath);
      assert.deepEqual(
        db.prepare(`
          SELECT expedition_id, user_id, role, ap,
                 role_charge, role_charge_progress, room_coins_earned
          FROM family_expedition_members
        `).get(),
        expectedRow,
        `legacy row after initialization ${initialization + 1}`,
      );

      const migratedColumns = Object.fromEntries(
        columns(db, 'family_expedition_members')
          .filter(({ name }) => [
            'role_charge',
            'role_charge_progress',
            'room_coins_earned',
          ].includes(name))
          .map(({ name, notnull, dflt_value }) => [name, { notnull, dflt_value }]),
      );
      assert.deepEqual(migratedColumns, {
        role_charge: { notnull: 1, dflt_value: '1' },
        role_charge_progress: { notnull: 1, dflt_value: '0' },
        room_coins_earned: { notnull: 1, dflt_value: '0' },
      });

      db.close();
      db = null;
    }
  } finally {
    db?.close();
    delete require.cache[databaseModulePath];
    delete require.cache[notificationModulePath];
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy minigame idempotency metadata backfills into indexed records idempotently', () => {
  const { directory, databasePath } = createTempDatabasePath();
  let db;
  try {
    db = initializeDatabaseAt(databasePath);
    db.prepare("INSERT INTO users (id, telegram_id) VALUES (1, 'owner')").run();
    db.prepare("INSERT INTO families (id, name, founder_id, invite_code) VALUES (1, 'Family', 1, 'LEDGER')").run();
    db.prepare(`
      INSERT INTO family_expeditions (
        id, family_id, theme_id, seed, status, map_json, started_by, started_at
      ) VALUES (1, 1, 'root_king', 'seed', 'active', '{}', 1, 1000)
    `).run();
    db.prepare(`
      INSERT INTO family_expedition_rooms (
        id, expedition_id, room_key, room_type, state, progress_target
      ) VALUES (1, 1, 'room', 'event', 'unlocked', 1)
    `).run();
    db.prepare(`
      INSERT INTO family_expedition_minigame_attempts (
        id, attempt_token, expedition_id, room_id, user_id, game_type, seed,
        status, started_at, expires_at, result_json
      ) VALUES (1, 'legacy-attempt', 1, 1, 1, 'focus_hold', 'seed',
                'succeeded', 1000, 1012, ?)
    `).run(JSON.stringify({
      startIdempotencyKey: 'legacy-start',
      startIntent: { expeditionId: 1, roomId: 1, userId: 1, gameType: 'focus_hold' },
      startResponse: { attempt: { attemptToken: 'legacy-attempt' } },
      finishes: [{
        idempotencyKey: 'legacy-finish',
        intent: { attemptToken: 'legacy-attempt', outcome: { success: true, score: 90 }, forceState: null },
        response: { state: 'succeeded', success: true },
      }],
    }));
    db.prepare(`
      DELETE FROM app_settings WHERE key = 'expedition_minigame_idempotency_backfilled_v1'
    `).run();
    db.exec('DROP TABLE family_expedition_minigame_idempotency');
    db.close();
    db = null;

    for (let initialization = 0; initialization < 2; initialization += 1) {
      db = initializeDatabaseAt(databasePath);
      assert.deepEqual(db.prepare(`
        SELECT idempotency_key AS key, operation
        FROM family_expedition_minigame_idempotency
        WHERE user_id = 1 ORDER BY idempotency_key
      `).all(), [
        { key: 'legacy-finish', operation: 'finish' },
        { key: 'legacy-start', operation: 'start' },
      ]);
      assert.equal(db.prepare(`
        SELECT value FROM app_settings
        WHERE key = 'expedition_minigame_idempotency_backfilled_v1'
      `).pluck().get(), '1');
      db.close();
      db = null;
    }
  } finally {
    db?.close();
    delete require.cache[databaseModulePath];
    delete require.cache[notificationModulePath];
    rmSync(directory, { recursive: true, force: true });
  }
});

test('expedition schema exposes required columns, foreign keys, and indexes', () => {
  withTempDatabase((db) => {
    const column = (name, type, notnull, dflt_value = null, pk = 0) => ({
      name,
      type,
      notnull,
      dflt_value,
      pk,
    });
    const expectedColumns = {
      family_expeditions: [
        column('id', 'INTEGER', 0, null, 1),
        column('family_id', 'INTEGER', 1),
        column('theme_id', 'TEXT', 1),
        column('seed', 'TEXT', 1),
        column('status', 'TEXT', 1),
        column('map_json', 'TEXT', 1),
        column('shared_buffs_json', 'TEXT', 1, "'{}'"),
        column('started_by', 'INTEGER', 1),
        column('started_at', 'INTEGER', 1),
        column('boss_defeated_at', 'INTEGER', 0),
        column('finished_at', 'INTEGER', 0),
      ],
      family_expedition_rooms: [
        column('id', 'INTEGER', 0, null, 1),
        column('expedition_id', 'INTEGER', 1),
        column('room_key', 'TEXT', 1),
        column('room_type', 'TEXT', 1),
        column('state', 'TEXT', 1),
        column('progress', 'INTEGER', 1, '0'),
        column('progress_target', 'INTEGER', 1),
        column('support', 'INTEGER', 1, '0'),
        column('payload_json', 'TEXT', 1, "'{}'"),
        column('unlocked_at', 'INTEGER', 0),
        column('cleared_at', 'INTEGER', 0),
      ],
      family_expedition_members: [
        column('expedition_id', 'INTEGER', 1, null, 1),
        column('user_id', 'INTEGER', 1, null, 2),
        column('role', 'TEXT', 1),
        column('ap', 'INTEGER', 1, '3'),
        column('ap_regen_day', 'INTEGER', 1),
        column('ap_regen_at', 'INTEGER', 1, '0'),
        column('hero_hp', 'INTEGER', 1, '3'),
        column('hero_recover_at', 'INTEGER', 0),
        column('role_ability_day', 'INTEGER', 1),
        column('role_ability_used', 'INTEGER', 1, '0'),
        column('role_charge', 'INTEGER', 1, '1'),
        column('role_charge_progress', 'INTEGER', 1, '0'),
        column('room_coins_earned', 'INTEGER', 1, '0'),
        column('provision_id', 'TEXT', 0),
        column('provision_state_json', 'TEXT', 1, "'{}'"),
        column('loadout_json', 'TEXT', 1, "'[]'"),
        column('debuff_json', 'TEXT', 1, "'{}'"),
        column('contribution_ap', 'INTEGER', 1, '0'),
        column('contribution_progress', 'INTEGER', 1, '0'),
        column('prepared_at', 'INTEGER', 1),
        column('boss_reward_claimed_at', 'INTEGER', 0),
      ],
      family_expedition_room_effects: [
        column('id', 'INTEGER', 0, null, 1),
        column('expedition_id', 'INTEGER', 1),
        column('room_id', 'INTEGER', 1),
        column('effect_type', 'TEXT', 1),
        column('placed_by', 'INTEGER', 1),
        column('remaining_uses', 'INTEGER', 1, '1'),
        column('payload_json', 'TEXT', 1, "'{}'"),
        column('created_at', 'INTEGER', 1),
        column('consumed_at', 'INTEGER', 0),
      ],
      family_expedition_minigame_attempts: [
        column('id', 'INTEGER', 0, null, 1),
        column('attempt_token', 'TEXT', 1),
        column('expedition_id', 'INTEGER', 1),
        column('room_id', 'INTEGER', 1),
        column('user_id', 'INTEGER', 1),
        column('game_type', 'TEXT', 1),
        column('seed', 'TEXT', 1),
        column('status', 'TEXT', 1),
        column('ap_spent', 'INTEGER', 1, '0'),
        column('retry_available', 'INTEGER', 1, '0'),
        column('started_at', 'INTEGER', 1),
        column('expires_at', 'INTEGER', 1),
        column('finished_at', 'INTEGER', 0),
        column('result_json', 'TEXT', 1, "'{}'"),
      ],
      family_expedition_minigame_idempotency: [
        column('user_id', 'INTEGER', 1, null, 1),
        column('idempotency_key', 'TEXT', 1, null, 2),
        column('operation', 'TEXT', 1),
        column('attempt_id', 'INTEGER', 1),
        column('intent_json', 'TEXT', 1),
        column('response_json', 'TEXT', 0),
        column('http_response_json', 'TEXT', 0),
        column('created_at', 'INTEGER', 1),
        column('updated_at', 'INTEGER', 1),
      ],
      family_expedition_pending_rewards: [
        column('id', 'INTEGER', 0, null, 1),
        column('expedition_id', 'INTEGER', 1),
        column('user_id', 'INTEGER', 1),
        column('payload_json', 'TEXT', 1, "'{}'"),
        column('created_at', 'INTEGER', 1),
        column('claimed_at', 'INTEGER', 0),
      ],
      family_expedition_member_events: [
        column('id', 'INTEGER', 0, null, 1),
        column('expedition_id', 'INTEGER', 1),
        column('user_id', 'INTEGER', 1),
        column('event_type', 'TEXT', 1),
        column('payload_json', 'TEXT', 1, "'{}'"),
        column('created_at', 'INTEGER', 1),
        column('acknowledged_at', 'INTEGER', 0),
      ],
      expedition_artifact_inventory: [
        column('user_id', 'INTEGER', 1, null, 1),
        column('artifact_id', 'TEXT', 1, null, 2),
        column('quantity', 'INTEGER', 1, '0'),
        column('charges', 'INTEGER', 1, '0'),
        column('first_acquired_at', 'INTEGER', 1),
        column('last_acquired_at', 'INTEGER', 1),
      ],
      family_expedition_actions: [
        column('id', 'INTEGER', 0, null, 1),
        column('idempotency_key', 'TEXT', 1),
        column('expedition_id', 'INTEGER', 1),
        column('room_id', 'INTEGER', 1),
        column('user_id', 'INTEGER', 1),
        column('action_type', 'TEXT', 1),
        column('stat', 'TEXT', 0),
        column('raw_roll', 'INTEGER', 0),
        column('modifier_json', 'TEXT', 1, "'{}'"),
        column('modified_roll', 'INTEGER', 0),
        column('progress_awarded', 'INTEGER', 1, '0'),
        column('loot_json', 'TEXT', 1, "'{}'"),
        column('narration_key', 'TEXT', 0),
        column('created_at', 'INTEGER', 1),
      ],
      family_expedition_history: [
        column('id', 'INTEGER', 0, null, 1),
        column('expedition_id', 'INTEGER', 1),
        column('family_id', 'INTEGER', 1),
        column('summary_json', 'TEXT', 1),
        column('finished_at', 'INTEGER', 1),
      ],
    };

    for (const [table, expected] of Object.entries(expectedColumns)) {
      assert.deepEqual(
        columns(db, table).map(({ name, type, notnull, dflt_value, pk }) => ({
          name,
          type,
          notnull,
          dflt_value,
          pk,
        })),
        expected,
        `${table} columns`,
      );
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
      family_expedition_room_effects: [
        { from: 'expedition_id', table: 'family_expedition_rooms', on_delete: 'CASCADE' },
        { from: 'placed_by', table: 'users', on_delete: 'CASCADE' },
        { from: 'room_id', table: 'family_expedition_rooms', on_delete: 'CASCADE' },
      ],
      family_expedition_minigame_attempts: [
        { from: 'expedition_id', table: 'family_expedition_rooms', on_delete: 'CASCADE' },
        { from: 'room_id', table: 'family_expedition_rooms', on_delete: 'CASCADE' },
        { from: 'user_id', table: 'users', on_delete: 'CASCADE' },
      ],
      family_expedition_minigame_idempotency: [
        { from: 'attempt_id', table: 'family_expedition_minigame_attempts', on_delete: 'CASCADE' },
        { from: 'user_id', table: 'users', on_delete: 'CASCADE' },
      ],
      family_expedition_pending_rewards: [
        { from: 'expedition_id', table: 'family_expeditions', on_delete: 'CASCADE' },
        { from: 'user_id', table: 'users', on_delete: 'CASCADE' },
      ],
      family_expedition_member_events: [
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
        {
          name: 'idx_family_expeditions_family_status',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'family_id', desc: 0 }, { name: 'status', desc: 0 }],
        },
      ],
      family_expedition_rooms: [
        {
          name: 'idx_expedition_room_identity',
          origin: 'c',
          unique: 1,
          columns: [{ name: 'id', desc: 0 }, { name: 'expedition_id', desc: 0 }],
        },
        {
          name: 'idx_family_expedition_rooms_expedition',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'expedition_id', desc: 0 }, { name: 'state', desc: 0 }],
        },
        {
          name: 'auto',
          origin: 'u',
          unique: 1,
          columns: [{ name: 'expedition_id', desc: 0 }, { name: 'room_key', desc: 0 }],
        },
      ],
      family_expedition_members: [
        {
          name: 'auto',
          origin: 'pk',
          unique: 1,
          columns: [{ name: 'expedition_id', desc: 0 }, { name: 'user_id', desc: 0 }],
        },
      ],
      family_expedition_room_effects: [
        {
          name: 'idx_expedition_room_effect_active',
          origin: 'c',
          unique: 1,
          columns: [
            { name: 'expedition_id', desc: 0 },
            { name: 'room_id', desc: 0 },
            { name: 'effect_type', desc: 0 },
          ],
        },
        {
          name: 'idx_expedition_room_effect_placed_by',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'placed_by', desc: 0 }],
        },
        {
          name: 'idx_expedition_room_effect_room',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'room_id', desc: 0 }],
        },
      ],
      family_expedition_minigame_attempts: [
        {
          name: 'idx_expedition_attempt_room',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'room_id', desc: 0 }],
        },
        {
          name: 'idx_expedition_attempt_token',
          origin: 'c',
          unique: 1,
          columns: [{ name: 'attempt_token', desc: 0 }],
        },
        {
          name: 'idx_expedition_attempt_user',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'user_id', desc: 0 }],
        },
        {
          name: 'idx_expedition_open_attempt',
          origin: 'c',
          unique: 1,
          columns: [
            { name: 'expedition_id', desc: 0 },
            { name: 'room_id', desc: 0 },
            { name: 'user_id', desc: 0 },
          ],
        },
      ],
      family_expedition_minigame_idempotency: [
        {
          name: 'idx_expedition_minigame_idempotency_attempt',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'attempt_id', desc: 0 }],
        },
        {
          name: 'auto',
          origin: 'pk',
          unique: 1,
          columns: [{ name: 'user_id', desc: 0 }, { name: 'idempotency_key', desc: 0 }],
        },
      ],
      family_expedition_pending_rewards: [
        {
          name: 'idx_expedition_pending_reward',
          origin: 'c',
          unique: 1,
          columns: [{ name: 'expedition_id', desc: 0 }, { name: 'user_id', desc: 0 }],
        },
        {
          name: 'idx_expedition_pending_reward_user',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'user_id', desc: 0 }, { name: 'claimed_at', desc: 0 }],
        },
      ],
      family_expedition_member_events: [
        {
          name: 'idx_expedition_member_events_expedition_user',
          origin: 'c',
          unique: 0,
          columns: [
            { name: 'expedition_id', desc: 0 },
            { name: 'user_id', desc: 0 },
            { name: 'created_at', desc: 1 },
          ],
        },
        {
          name: 'idx_expedition_member_events_pending_user',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'user_id', desc: 0 }, { name: 'created_at', desc: 0 }],
        },
        {
          name: 'idx_expedition_member_events_user',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'user_id', desc: 0 }, { name: 'created_at', desc: 0 }],
        },
      ],
      expedition_artifact_inventory: [
        {
          name: 'auto',
          origin: 'pk',
          unique: 1,
          columns: [{ name: 'user_id', desc: 0 }, { name: 'artifact_id', desc: 0 }],
        },
      ],
      family_expedition_actions: [
        {
          name: 'idx_family_expedition_actions_chronology',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'expedition_id', desc: 0 }, { name: 'created_at', desc: 0 }],
        },
        {
          name: 'auto',
          origin: 'u',
          unique: 1,
          columns: [{ name: 'user_id', desc: 0 }, { name: 'idempotency_key', desc: 0 }],
        },
      ],
      family_expedition_history: [
        {
          name: 'idx_family_expedition_history_family',
          origin: 'c',
          unique: 0,
          columns: [{ name: 'family_id', desc: 0 }, { name: 'finished_at', desc: 1 }],
        },
      ],
    };
    for (const [table, expected] of Object.entries(expectedIndexes)) {
      assert.deepEqual(normalizedIndexes(db, table), expected, `${table} indexes`);
    }

    assert.match(
      indexSql(db, 'idx_expedition_room_effect_active'),
      /WHERE\s+consumed_at\s+IS\s+NULL/i,
    );
    assert.match(
      indexSql(db, 'idx_expedition_open_attempt'),
      /WHERE\s+status\s+IN\s*\(\s*'ready'\s*,\s*'active'\s*,\s*'retry'\s*\)/i,
    );
    assert.match(
      indexSql(db, 'idx_expedition_member_events_pending_user'),
      /WHERE\s+acknowledged_at\s+IS\s+NULL/i,
    );
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
    insertExpedition.run(101, 'active');
    assert.throws(() => insertExpedition.run(102, 'failed'), /CHECK constraint failed/);

    const insertRoom = db.prepare(`
      INSERT INTO family_expedition_rooms (
        id, expedition_id, room_key, room_type, state, progress_target
      ) VALUES (?, ?, ?, 'combat', 'available', 5)
    `);
    insertRoom.run(200, 100, 'room-1');
    insertRoom.run(201, 101, 'room-1');
    assert.throws(() => insertRoom.run(202, 100, 'room-1'), /UNIQUE constraint failed/);
    assert.throws(() => insertRoom.run(203, 999, 'orphan'), /FOREIGN KEY constraint failed/);

    assert.throws(() => db.prepare(`
      INSERT INTO family_expedition_room_effects (
        expedition_id, room_id, effect_type, placed_by, created_at
      ) VALUES (100, 201, 'knight_shield', 1, 1000)
    `).run(), /FOREIGN KEY constraint failed/);
    assert.throws(() => db.prepare(`
      INSERT INTO family_expedition_minigame_attempts (
        attempt_token, expedition_id, room_id, user_id, game_type, seed,
        status, started_at, expires_at
      ) VALUES ('cross-expedition', 100, 201, 2, 'roots', 'seed',
                'active', 1000, 1100)
    `).run(), /FOREIGN KEY constraint failed/);

    db.prepare(`
      INSERT INTO family_expedition_minigame_attempts (
        id, attempt_token, expedition_id, room_id, user_id, game_type, seed,
        status, started_at, expires_at
      ) VALUES (300, 'valid-attempt', 100, 200, 2, 'roots', 'seed',
                'succeeded', 1000, 1100)
    `).run();
    const insertMinigameReplay = db.prepare(`
      INSERT INTO family_expedition_minigame_idempotency (
        user_id, idempotency_key, operation, attempt_id, intent_json,
        response_json, created_at, updated_at
      ) VALUES (2, ?, ?, 300, '{}', '{}', 1000, 1000)
    `);
    assert.throws(() => insertMinigameReplay.run('   ', 'finish'), /CHECK constraint failed/);
    assert.throws(() => insertMinigameReplay.run('x'.repeat(129), 'finish'), /CHECK constraint failed/);
    assert.throws(() => insertMinigameReplay.run('invalid-operation', 'retry'), /CHECK constraint failed/);

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
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE expedition_id = 100`).get().count,
        0,
        table,
      );
    }
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM family_expedition_rooms WHERE expedition_id = 101').get().count,
      1,
      'deleting one expedition preserves rooms from another expedition',
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expedition_artifact_inventory').get().count, 1);

    db.prepare('DELETE FROM users WHERE id = 2').run();
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM expedition_artifact_inventory').get().count, 0);
  });
});
