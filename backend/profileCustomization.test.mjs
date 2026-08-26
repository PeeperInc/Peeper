import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('profile customization grants admin title and protects purchase/equip flow', () => {
  const directory = mkdtempSync(join(tmpdir(), 'peeper-profile-customization-'));
  const databasePath = join(directory, 'test.db');
  const script = `
    const db = require('./database');
    const profile = require('./profileCustomization');
    const adminId = db.prepare("INSERT INTO users (telegram_id, first_name, coins) VALUES ('179221945', 'Admin', 50)").run().lastInsertRowid;
    const userId = db.prepare("INSERT INTO users (telegram_id, first_name, coins) VALUES ('777', 'Player', 200)").run().lastInsertRowid;
    profile.grantAdminTitleIfNeeded(db.prepare('SELECT * FROM users WHERE id = ?').get(adminId));
    db.prepare("INSERT INTO profile_customization_items (item_id, name, type, price, title_text, is_active) VALUES ('profile_title_pathfinder', 'Pathfinder', 'title', 75, 'Pathfinder', 1)").run();
    const purchase = profile.purchaseProfileItem(userId, 'profile_title_pathfinder');
    const appearance = profile.equipProfileItem(userId, 'title', 'profile_title_pathfinder');
    db.prepare("INSERT INTO profile_customization_items (item_id, name, type, price, name_color, name_color_secondary, name_glow_color, name_glow_strength, is_active) VALUES ('profile_name_style_aurora', 'Aurora', 'name_style', 25, '#B8FF57', '#FFD75E', '#B8FF57', 2, 1)").run();
    profile.purchaseProfileItem(userId, 'profile_name_style_aurora');
    const styledAppearance = profile.equipProfileItem(userId, 'name_style', 'profile_name_style_aurora');
    let duplicateStatus = null;
    try { profile.purchaseProfileItem(userId, 'profile_title_pathfinder'); } catch (error) { duplicateStatus = error.status; }
    let unownedStatus = null;
    db.prepare("INSERT INTO profile_customization_items (item_id, name, type, price, file_path, is_active) VALUES ('profile_frame_moss', 'Moss', 'frame', 10, '/profile/frames/moss.png', 1)").run();
    try { profile.equipProfileItem(userId, 'frame', 'profile_frame_moss'); } catch (error) { unownedStatus = error.status; }
    db.prepare("INSERT INTO owned_profile_customizations (user_id, item_id) VALUES (?, 'profile_frame_moss')").run(userId);
    profile.equipProfileItem(userId, 'frame', 'profile_frame_moss');
    const bulkAppearance = profile.getProfileAppearances([userId, adminId]).get(Number(userId));
    const attachedAppearance = profile.attachProfileAppearances([{ userId, label: 'Player' }], 'userId')[0];
    let lockedPurchaseStatus = null;
    try { profile.purchaseProfileItem(userId, 'profile_title_duelist'); } catch (error) { lockedPurchaseStatus = error.status; }
    const result = {
      adminOwnsTitle: Boolean(db.prepare("SELECT 1 FROM owned_profile_customizations WHERE user_id = ? AND item_id = 'title_admin'").get(adminId)),
      coins: purchase.coins,
      title: appearance.title,
      nameStyle: styledAppearance.nameStyle,
      duplicateStatus,
      unownedStatus,
      bulkFrame: bulkAppearance.frame,
      attachedFrame: attachedAppearance.appearance.frame,
      attachedLabel: attachedAppearance.label,
      lockedPurchaseStatus,
      publicCatalogIds: profile.getProfileCatalog(userId).map(item => item.itemId),
    };
    db.close();
    process.stdout.write(JSON.stringify(result));
  `;

  try {
    const run = spawnSync(process.execPath, ['-e', script], {
      cwd: new URL('.', import.meta.url),
      env: { ...process.env, PEEPER_DB_PATH: databasePath, NODE_ENV: 'test' },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.adminOwnsTitle, true);
    assert.equal(result.coins, 125);
    assert.equal(result.title.text, 'Pathfinder');
    assert.equal(result.nameStyle.color, '#B8FF57');
    assert.equal(result.nameStyle.colorSecondary, '#FFD75E');
    assert.equal(result.nameStyle.glowStrength, 2);
    assert.equal(result.duplicateStatus, 409);
    assert.equal(result.unownedStatus, 403);
    assert.equal(result.bulkFrame.itemId, 'profile_frame_moss');
    assert.equal(result.attachedFrame.filePath, '/profile/frames/moss.png');
    assert.equal(result.attachedLabel, 'Player');
    assert.equal(result.lockedPurchaseStatus, 403);
    assert.equal(result.publicCatalogIds.includes('profile_frame_moss'), true);
    assert.equal(result.publicCatalogIds.includes('profile_name_style_aurora'), true);
    assert.equal(result.publicCatalogIds.includes('profile_title_pathfinder'), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('achievement titles unlock permanently from game history and tracked events', () => {
  const directory = mkdtempSync(join(tmpdir(), 'peeper-profile-achievements-'));
  const databasePath = join(directory, 'test.db');
  const script = `
    const db = require('./database');
    const profile = require('./profileCustomization');
    const hero = db.prepare("INSERT INTO users (telegram_id, first_name) VALUES ('hero', 'Hero')").run().lastInsertRowid;
    const rival = db.prepare("INSERT INTO users (telegram_id, first_name) VALUES ('rival', 'Rival')").run().lastInsertRowid;
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT INTO peepers (user_id, born_at, alive) VALUES (?, ?, 1)").run(hero, now - 101 * 86400);
    const arena = db.prepare("INSERT INTO arena_matches (status, player1_id, player2_id, winner_id, result) VALUES ('finished', ?, ?, ?, 'p1_win')");
    for (let index = 0; index < 25; index += 1) arena.run(hero, rival, hero);
    const gift = db.prepare("INSERT INTO gifts_received (recipient_id, sender_id, gift_id, gift_price) VALUES (?, ?, 'test_gift', 1)");
    for (let index = 0; index < 100; index += 1) gift.run(rival, hero);
    db.prepare("INSERT INTO farm_inventory (user_id, product_id, quantity) VALUES (?, 'magic_squash', 5)").run(hero);
    const family = db.prepare("INSERT INTO families (name, founder_id, invite_code) VALUES ('Test', ?, 'PROFILETEST')").run(hero).lastInsertRowid;
    const completedExpedition = db.prepare("INSERT INTO family_expeditions (family_id, theme_id, seed, status, map_json, started_by, started_at, finished_at) VALUES (?, 'root_king', ?, 'finished', '{}', ?, 1, 2)");
    const completedMember = db.prepare("INSERT INTO family_expedition_members (expedition_id, user_id, role, ap_regen_day, role_ability_day, prepared_at) VALUES (?, ?, 'knight', 0, 0, 1)");
    for (let index = 0; index < 10; index += 1) {
      const completedId = completedExpedition.run(family, 'completed-' + index, hero).lastInsertRowid;
      completedMember.run(completedId, hero);
    }
    const feast = db.prepare("INSERT INTO family_big_feasts (family_id, feaster_id, cost, used_at) VALUES (?, ?, 100, ?)");
    for (let index = 0; index < 9; index += 1) feast.run(family, hero, index + 1);
    profile.incrementProfileAchievementStat(hero, 'farm_big_feasts_served');
    profile.incrementProfileAchievementStat(hero, 'casino_jackpots_won');
    const expedition = db.prepare("INSERT INTO family_expeditions (family_id, theme_id, seed, status, map_json, started_by, started_at) VALUES (?, 'root_king', 'seed', 'boss_defeated', '{}', ?, 1)").run(family, hero).lastInsertRowid;
    const room = db.prepare("INSERT INTO family_expedition_rooms (expedition_id, room_key, room_type, state, progress, progress_target, payload_json) VALUES (?, 'boss', 'boss', 'cleared', 1, 1, '{}')").run(expedition).lastInsertRowid;
    db.prepare("INSERT INTO family_expedition_actions (idempotency_key, expedition_id, room_id, user_id, action_type, modifier_json, created_at) VALUES ('final-hit', ?, ?, ?, 'attempt', '{}', 2)").run(expedition, room, hero);
    const catalog = profile.getProfileCatalog(hero);
    const titles = catalog.filter(item => item.type === 'title' && item.unlockType).map(item => ({ id: item.itemId, owned: item.owned, locked: item.locked }));
    const counts = Object.fromEntries(['frame', 'scene', 'title', 'name_style'].map(type => [type, catalog.filter(item => item.type === type).length]));
    db.prepare("UPDATE farm_inventory SET quantity = 0 WHERE user_id = ? AND product_id = 'magic_squash'").run(hero);
    const stillOwned = Boolean(db.prepare("SELECT 1 FROM owned_profile_customizations WHERE user_id = ? AND item_id = 'profile_title_lucky_farmer'").get(hero));
    db.close();
    process.stdout.write(JSON.stringify({ titles, stillOwned, counts }));
  `;

  try {
    const run = spawnSync(process.execPath, ['-e', script], {
      cwd: new URL('.', import.meta.url),
      env: { ...process.env, PEEPER_DB_PATH: databasePath, NODE_ENV: 'test' },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.titles.length, 8);
    assert.equal(result.titles.every(item => item.owned && !item.locked), true);
    assert.equal(result.stillOwned, true);
    assert.deepEqual(result.counts, { frame: 3, scene: 3, title: 8, name_style: 10 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy profile customization catalog migrates to name styles without losing items', () => {
  const directory = mkdtempSync(join(tmpdir(), 'peeper-profile-migration-'));
  const databasePath = join(directory, 'test.db');
  const script = `
    const Database = require('better-sqlite3');
    const legacy = new Database(process.env.PEEPER_DB_PATH);
    legacy.exec(\`
      CREATE TABLE profile_customization_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('frame', 'scene', 'title')),
        price INTEGER NOT NULL DEFAULT 0,
        title_text TEXT DEFAULT NULL,
        file_path TEXT DEFAULT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      INSERT INTO profile_customization_items (item_id, name, type, price, is_active)
      VALUES ('profile_frame_legacy', 'Legacy Frame', 'frame', 10, 1);
    \`);
    legacy.close();
    const db = require('./database');
    const profile = require('./profileCustomization');
    db.prepare("INSERT INTO profile_customization_items (item_id, name, type, price, name_color, name_glow_color, name_glow_strength, is_active) VALUES ('profile_name_style_neon', 'Neon', 'name_style', 50, '#AAFF44', '#AAFF44', 2, 1)").run();
    const result = {
      legacy: db.prepare("SELECT name FROM profile_customization_items WHERE item_id = 'profile_frame_legacy'").get()?.name,
      newType: db.prepare("SELECT type FROM profile_customization_items WHERE item_id = 'profile_name_style_neon'").get()?.type,
      types: profile.PROFILE_CUSTOMIZATION_TYPES,
    };
    db.close();
    process.stdout.write(JSON.stringify(result));
  `;

  try {
    const run = spawnSync(process.execPath, ['-e', script], {
      cwd: new URL('.', import.meta.url),
      env: { ...process.env, PEEPER_DB_PATH: databasePath, NODE_ENV: 'test' },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.legacy, 'Legacy Frame');
    assert.equal(result.newType, 'name_style');
    assert.equal(result.types.includes('name_style'), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
