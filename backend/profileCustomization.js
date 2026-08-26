'use strict';

const db = require('./database');
const { isAdminTelegramId } = require('./adminAccess');

const PROFILE_CUSTOMIZATION_TYPES = Object.freeze(['frame', 'scene', 'title', 'name_style']);
const PROFILE_FRAME_SIZE = 1024;
const PROFILE_SCENE_WIDTH = 1240;
const PROFILE_SCENE_HEIGHT = 640;
const ADMIN_TITLE_ITEM_ID = 'title_admin';
const ACHIEVEMENT_STAT_COLUMNS = Object.freeze({
  farm_big_feasts_served: 'farm_big_feasts_served',
  casino_jackpots_won: 'casino_jackpots_won',
});

const SLOT_COLUMNS = Object.freeze({
  frame: 'frame_item_id',
  scene: 'scene_item_id',
  title: 'title_item_id',
  name_style: 'name_style_item_id',
});

function normalizeType(value) {
  const type = String(value || '').trim().toLowerCase();
  return PROFILE_CUSTOMIZATION_TYPES.includes(type) ? type : null;
}

function makeItemId(type, name) {
  const normalizedType = normalizeType(type);
  const slug = String(name || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  if (!normalizedType || !slug) return null;
  return `profile_${normalizedType}_${slug}`;
}

function serializeItem(row) {
  if (!row) return null;
  return {
    itemId: row.item_id,
    name: row.name,
    type: row.type,
    price: Number(row.price || 0),
    titleText: row.title_text || null,
    filePath: row.file_path || null,
    nameColor: row.name_color || null,
    nameColorSecondary: row.name_color_secondary || null,
    nameGlowColor: row.name_glow_color || null,
    nameGlowStrength: Math.max(0, Math.min(3, Number(row.name_glow_strength || 0))),
    nameEffect: row.name_effect || null,
    unlockType: row.unlock_type || null,
    unlockValue: Math.max(0, Number(row.unlock_value || 0)),
    unlockText: row.unlock_text || null,
    unlockProgress: Math.max(0, Number(row.unlock_progress || 0)),
    locked: Boolean(row.locked),
    active: Boolean(row.is_active),
    system: Boolean(row.is_system),
    owned: Boolean(row.owned),
    equipped: Boolean(row.equipped),
    createdAt: Number(row.created_at || 0),
  };
}

function emptyProfileAppearance() {
  return { frame: null, scene: null, title: null, nameStyle: null };
}

function serializeProfileAppearanceRow(row) {
  if (!row) return emptyProfileAppearance();
  return {
    frame: row.frame_item_id ? {
      itemId: row.frame_item_id,
      name: row.frame_name,
      filePath: row.frame_file_path,
    } : null,
    scene: row.scene_item_id ? {
      itemId: row.scene_item_id,
      name: row.scene_name,
      filePath: row.scene_file_path,
    } : null,
    title: row.title_item_id ? {
      itemId: row.title_item_id,
      name: row.title_name,
      text: row.title_text,
    } : null,
    nameStyle: row.name_style_item_id ? {
      itemId: row.name_style_item_id,
      name: row.name_style_name,
      color: row.name_color,
      colorSecondary: row.name_color_secondary,
      glowColor: row.name_glow_color,
      glowStrength: Math.max(0, Math.min(3, Number(row.name_glow_strength || 0))),
      effect: row.name_effect || null,
    } : null,
  };
}

function getProfileAppearances(userIds) {
  const ids = [...new Set((userIds || [])
    .map(value => Number(value))
    .filter(value => Number.isInteger(value) && value > 0))];
  if (!ids.length) return new Map();

  const placeholders = ids.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      u.id AS user_id,
      frame.item_id AS frame_item_id,
      frame.name AS frame_name,
      frame.file_path AS frame_file_path,
      scene.item_id AS scene_item_id,
      scene.name AS scene_name,
      scene.file_path AS scene_file_path,
      title.item_id AS title_item_id,
      title.name AS title_name,
      title.title_text AS title_text,
      name_style.item_id AS name_style_item_id,
      name_style.name AS name_style_name,
      name_style.name_color,
      name_style.name_color_secondary,
      name_style.name_glow_color,
      name_style.name_glow_strength,
      name_style.name_effect
    FROM users u
    LEFT JOIN user_profile_customization loadout ON loadout.user_id = u.id
    LEFT JOIN profile_customization_items frame ON frame.item_id = loadout.frame_item_id
    LEFT JOIN profile_customization_items scene ON scene.item_id = loadout.scene_item_id
    LEFT JOIN profile_customization_items title ON title.item_id = loadout.title_item_id
    LEFT JOIN profile_customization_items name_style ON name_style.item_id = loadout.name_style_item_id
    WHERE u.id IN (${placeholders})
  `).all(...ids);

  return new Map(rows.map(row => [Number(row.user_id), serializeProfileAppearanceRow(row)]));
}

function getProfileAppearance(userId) {
  return getProfileAppearances([userId]).get(Number(userId)) || emptyProfileAppearance();
}

function attachProfileAppearances(rows, idField = 'id') {
  const source = Array.isArray(rows) ? rows : [];
  const appearances = getProfileAppearances(source.map(row => row?.[idField]));
  return source.map(row => ({
    ...row,
    appearance: appearances.get(Number(row?.[idField])) || emptyProfileAppearance(),
  }));
}

function getAchievementProgress(userId) {
  const now = Math.floor(Date.now() / 1000);
  const peeper = db.prepare(`
    SELECT born_at, alive FROM peepers WHERE user_id = ?
  `).get(userId);
  const peeperAgeDays = peeper?.alive
    ? Math.max(0, Math.floor((now - Number(peeper.born_at || now)) / 86400))
    : 0;
  const arenaWins = db.prepare(`
    SELECT COUNT(*) AS count
    FROM arena_matches
    WHERE winner_id = ? AND status = 'finished'
  `).get(userId)?.count || 0;
  const magicSquashes = db.prepare(`
    SELECT COALESCE(quantity, 0) AS quantity
    FROM farm_inventory
    WHERE user_id = ? AND product_id = 'magic_squash'
  `).get(userId)?.quantity || 0;
  const bossFinalBlows = db.prepare(`
    SELECT COUNT(*) AS count
    FROM family_expedition_actions action
    INNER JOIN family_expedition_rooms room ON room.id = action.room_id
    WHERE action.user_id = ?
      AND action.action_type = 'attempt'
      AND room.room_type = 'boss'
      AND room.state = 'cleared'
      AND action.id = (
        SELECT MAX(final_action.id)
        FROM family_expedition_actions final_action
        WHERE final_action.room_id = room.id AND final_action.action_type = 'attempt'
      )
  `).get(userId)?.count || 0;
  const giftsSent = db.prepare(`
    SELECT COUNT(*) AS count FROM gifts_received WHERE sender_id = ?
  `).get(userId)?.count || 0;
  const expeditionsCompleted = db.prepare(`
    SELECT COUNT(*) AS count
    FROM family_expedition_members member
    INNER JOIN family_expeditions expedition ON expedition.id = member.expedition_id
    WHERE member.user_id = ? AND expedition.status = 'finished'
  `).get(userId)?.count || 0;
  const paidFamilyFeasts = db.prepare(`
    SELECT COUNT(*) AS count FROM family_big_feasts WHERE feaster_id = ?
  `).get(userId)?.count || 0;
  const stats = db.prepare(`
    SELECT farm_big_feasts_served, casino_jackpots_won
    FROM profile_achievement_stats
    WHERE user_id = ?
  `).get(userId);

  return {
    arena_wins: Math.max(0, Number(arenaWins)),
    magic_squash_inventory: Math.max(0, Number(magicSquashes)),
    expedition_boss_final_blow: Math.max(0, Number(bossFinalBlows)),
    peeper_age_days: peeperAgeDays,
    gifts_sent: Math.max(0, Number(giftsSent)),
    expeditions_completed: Math.max(0, Number(expeditionsCompleted)),
    family_feasts_served: Math.max(0, Number(paidFamilyFeasts) + Number(stats?.farm_big_feasts_served || 0)),
    casino_jackpots_won: Math.max(0, Number(stats?.casino_jackpots_won || 0)),
  };
}

function incrementProfileAchievementStat(userId, stat, amount = 1) {
  const column = ACHIEVEMENT_STAT_COLUMNS[stat];
  const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!column || !safeAmount) return false;
  db.prepare(`
    INSERT INTO profile_achievement_stats (user_id, ${column}, updated_at)
    VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(user_id) DO UPDATE SET
      ${column} = ${column} + excluded.${column},
      updated_at = excluded.updated_at
  `).run(userId, safeAmount);
  return true;
}

function syncProfileAchievementUnlocks(userId) {
  const progress = getAchievementProgress(userId);
  const achievementItems = db.prepare(`
    SELECT item_id, unlock_type, unlock_value
    FROM profile_customization_items
    WHERE unlock_type IS NOT NULL AND is_active = 1
  `).all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO owned_profile_customizations (user_id, item_id)
    VALUES (?, ?)
  `);
  db.transaction(() => {
    for (const item of achievementItems) {
      if ((progress[item.unlock_type] || 0) >= Math.max(1, Number(item.unlock_value || 1))) {
        insert.run(userId, item.item_id);
      }
    }
  })();
  return progress;
}

function grantAdminTitleIfNeeded(user) {
  if (!user?.id || !isAdminTelegramId(user.telegram_id)) return false;
  const result = db.prepare(`
    INSERT OR IGNORE INTO owned_profile_customizations (user_id, item_id)
    VALUES (?, ?)
  `).run(user.id, ADMIN_TITLE_ITEM_ID);
  return result.changes > 0;
}

function getProfileCatalog(userId) {
  const achievementProgress = syncProfileAchievementUnlocks(userId);
  const rows = db.prepare(`
    SELECT
      item.*,
      CASE WHEN owned.item_id IS NULL THEN 0 ELSE 1 END AS owned,
      CASE
        WHEN item.type = 'frame' AND loadout.frame_item_id = item.item_id THEN 1
        WHEN item.type = 'scene' AND loadout.scene_item_id = item.item_id THEN 1
        WHEN item.type = 'title' AND loadout.title_item_id = item.item_id THEN 1
        WHEN item.type = 'name_style' AND loadout.name_style_item_id = item.item_id THEN 1
        ELSE 0
      END AS equipped
    FROM profile_customization_items item
    LEFT JOIN owned_profile_customizations owned
      ON owned.item_id = item.item_id AND owned.user_id = ?
    LEFT JOIN user_profile_customization loadout ON loadout.user_id = ?
    WHERE item.is_active = 1 OR owned.item_id IS NOT NULL
    ORDER BY item.type, item.is_system DESC, item.price, item.created_at DESC
  `).all(userId, userId);
  return rows.map(row => serializeItem({
    ...row,
    unlock_progress: row.unlock_type ? achievementProgress[row.unlock_type] || 0 : 0,
    locked: row.unlock_type && !row.owned ? 1 : 0,
  }));
}

const purchaseProfileItem = db.transaction((userId, itemId) => {
  const item = db.prepare(`
    SELECT * FROM profile_customization_items
    WHERE item_id = ? AND is_active = 1
  `).get(itemId);
  if (!item) throw Object.assign(new Error('This profile item is not available'), { status: 404 });
  if (item.is_system) throw Object.assign(new Error('This profile item cannot be purchased'), { status: 403 });
  if (item.unlock_type) {
    throw Object.assign(new Error(item.unlock_text || 'Complete the unlock condition first'), { status: 403 });
  }

  const alreadyOwned = db.prepare(`
    SELECT 1 FROM owned_profile_customizations WHERE user_id = ? AND item_id = ?
  `).get(userId, itemId);
  if (alreadyOwned) throw Object.assign(new Error('You already own this profile item'), { status: 409 });

  const debit = db.prepare(`
    UPDATE users SET coins = coins - ?
    WHERE id = ? AND coins >= ?
  `).run(item.price, userId, item.price);
  if (debit.changes === 0) throw Object.assign(new Error('Not enough coins'), { status: 400 });

  db.prepare(`
    INSERT INTO owned_profile_customizations (user_id, item_id) VALUES (?, ?)
  `).run(userId, itemId);

  return {
    item: serializeItem({ ...item, owned: 1, equipped: 0 }),
    coins: Number(db.prepare('SELECT coins FROM users WHERE id = ?').get(userId).coins),
  };
});

function equipProfileItem(userId, typeValue, itemIdValue) {
  const type = normalizeType(typeValue);
  if (!type) throw Object.assign(new Error('Invalid profile slot'), { status: 400 });

  const itemId = itemIdValue == null || itemIdValue === '' ? null : String(itemIdValue);
  if (itemId) {
    const owned = db.prepare(`
      SELECT item.item_id
      FROM profile_customization_items item
      INNER JOIN owned_profile_customizations owned ON owned.item_id = item.item_id
      WHERE owned.user_id = ? AND item.item_id = ? AND item.type = ?
    `).get(userId, itemId, type);
    if (!owned) throw Object.assign(new Error('You do not own this item for that slot'), { status: 403 });
  }

  const column = SLOT_COLUMNS[type];
  db.prepare(`
    INSERT INTO user_profile_customization (user_id, ${column}, updated_at)
    VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(user_id) DO UPDATE SET
      ${column} = excluded.${column},
      updated_at = excluded.updated_at
  `).run(userId, itemId);

  return getProfileAppearance(userId);
}

module.exports = {
  ADMIN_TITLE_ITEM_ID,
  PROFILE_CUSTOMIZATION_TYPES,
  PROFILE_FRAME_SIZE,
  PROFILE_SCENE_HEIGHT,
  PROFILE_SCENE_WIDTH,
  equipProfileItem,
  attachProfileAppearances,
  getProfileAppearance,
  getProfileAppearances,
  getProfileCatalog,
  grantAdminTitleIfNeeded,
  getAchievementProgress,
  incrementProfileAchievementStat,
  makeItemId,
  normalizeType,
  purchaseProfileItem,
  serializeItem,
  syncProfileAchievementUnlocks,
};
