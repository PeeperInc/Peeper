import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const databasePath = require.resolve('../database.js');

test('database startup backfills one pending reward for a legacy finished expedition', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'peeper-reward-backfill-'));
  const dbPath = path.join(directory, 'peeper.db');
  const previousPath = process.env.PEEPER_DB_PATH;

  try {
    process.env.PEEPER_DB_PATH = dbPath;
    delete require.cache[databasePath];
    let db = require('../database.js');
    db.prepare(`
      INSERT INTO users (id, telegram_id, first_name) VALUES (10, 'legacy-user', 'Legacy')
    `).run();
    db.prepare(`
      INSERT INTO families (id, name, founder_id, invite_code)
      VALUES (1, 'Legacy Family', 10, 'LEGACY')
    `).run();
    db.prepare(`
      INSERT INTO family_expeditions (
        id, family_id, theme_id, seed, status, map_json, started_by,
        started_at, boss_defeated_at, finished_at
      ) VALUES (1, 1, 'root_king', 'legacy-seed', 'finished', ?, 10, 100, 190, 200)
    `).run(JSON.stringify({ title: 'Legacy Crypt', rooms: [] }));
    db.prepare(`
      INSERT INTO family_expedition_members (
        expedition_id, user_id, role, ap_regen_day, role_ability_day,
        contribution_ap, prepared_at
      ) VALUES (1, 10, 'scout', 0, 0, 3, 100)
    `).run();
    db.prepare(`
      DELETE FROM app_settings WHERE key = 'expedition_pending_rewards_backfilled_v1'
    `).run();
    db.close();

    delete require.cache[databasePath];
    db = require('../database.js');
    const rewards = db.prepare(`
      SELECT payload_json AS payloadJson
      FROM family_expedition_pending_rewards
      WHERE expedition_id = 1 AND user_id = 10
    `).all();
    db.close();

    assert.equal(rewards.length, 1);
    assert.equal(JSON.parse(rewards[0].payloadJson).expeditionTitle, 'Legacy Crypt');
  } finally {
    delete require.cache[databasePath];
    if (previousPath === undefined) delete process.env.PEEPER_DB_PATH;
    else process.env.PEEPER_DB_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
