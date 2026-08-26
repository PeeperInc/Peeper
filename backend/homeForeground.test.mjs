import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('legacy foreground selection migrates into ordered multi-layer state', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'peeper-home-foreground-'));
  const dbPath = join(tempDir, 'test.db');
  process.env.PEEPER_DB_PATH = dbPath;

  let db = require('./database');
  const user = db.prepare(`
    INSERT INTO users (telegram_id, first_name)
    VALUES ('foreground-test', 'Foreground Test')
  `).run();
  const userId = Number(user.lastInsertRowid);

  db.prepare(`
    INSERT INTO personal_homes (user_id, foreground_item_id)
    VALUES (?, 'front_one')
  `).run(userId);
  db.prepare(`
    INSERT INTO home_shop_items (item_id, name, slot, price)
    VALUES ('front_one', 'Front One', 'foreground_item', 1)
  `).run();
  db.prepare(`
    INSERT INTO home_shop_items (item_id, name, slot, price)
    VALUES ('front_two', 'Front Two', 'foreground_item', 1)
  `).run();
  db.close();

  delete require.cache[require.resolve('./database')];
  delete require.cache[require.resolve('./homeState')];
  db = require('./database');
  const { getForegroundItems, getFullHomeState } = require('./homeState');

  let state = getFullHomeState(userId).home;
  let items = state.slots.foreground_items;
  assert.deepEqual(items.map((item) => item.item_id), ['front_one']);
  assert.equal(state.slots.foreground_item.item_id, 'front_one');
  assert.equal(
    db.prepare('SELECT foreground_item_id FROM personal_homes WHERE user_id = ?').get(userId).foreground_item_id,
    null,
  );

  db.prepare(`
    INSERT INTO home_foreground_items_enabled (user_id, item_id, sort_order)
    VALUES (?, 'front_two', 2)
  `).run(userId);
  items = getForegroundItems(userId);
  assert.deepEqual(items.map((item) => item.item_id), ['front_one', 'front_two']);

  db.close();
  delete process.env.PEEPER_DB_PATH;
  for (const file of readdirSync(tempDir)) unlinkSync(join(tempDir, file));
  rmdirSync(tempDir);
});
