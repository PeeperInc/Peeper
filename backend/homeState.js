const db = require('./database');
const {
  HOME_CANVAS_WIDTH,
  HOME_CANVAS_HEIGHT,
  HOME_FRIDGE_DECOR_ITEM_ID,
  HOME_STARTER_WALL_ITEM_ID,
} = require('./homeConstants');

function normalizeHomeSlotItemId(itemId) {
  return itemId === HOME_STARTER_WALL_ITEM_ID ? null : itemId;
}

function getHomeSummary(userId) {
  const row = db.prepare('SELECT purchased_at FROM personal_homes WHERE user_id = ?').get(userId);
  return {
    owned: Boolean(row),
    purchased_at: row?.purchased_at ?? null,
  };
}

function getOwnedHomeItems(userId) {
  return db.prepare(`
    SELECT item_id
    FROM owned_home_items
    WHERE user_id = ?
    ORDER BY purchased_at ASC, id ASC
  `).all(userId)
    .map((row) => row.item_id)
    .filter((itemId) => itemId !== HOME_STARTER_WALL_ITEM_ID);
}

function grantFreeHomeItems(userId) {
  const freeItems = db.prepare(`
    SELECT item_id
    FROM home_shop_items
    WHERE is_free = 1 AND item_id != ?
  `).all(HOME_STARTER_WALL_ITEM_ID);

  for (const { item_id } of freeItems) {
    db.prepare(`
      INSERT OR IGNORE INTO owned_home_items (user_id, item_id)
      VALUES (?, ?)
    `).run(userId, item_id);
  }
}

function grantFridgeHomeDecor(userId) {
  return db.prepare(`
    INSERT OR IGNORE INTO owned_home_items (user_id, item_id)
    SELECT ?, item_id
    FROM home_shop_items
    WHERE item_id = ?
  `).run(userId, HOME_FRIDGE_DECOR_ITEM_ID);
}

function getHomeItemRow(itemId) {
  if (!itemId) return null;

  return db.prepare(`
    SELECT
      i.item_id,
      i.name,
      i.slot,
      i.price,
      i.is_free,
      i.is_active,
      COALESCE(s.file_path, '/home/' || i.item_id || '.png') AS file_path
    FROM home_shop_items i
    LEFT JOIN home_custom_sprites s ON s.item_id = i.item_id
    WHERE i.item_id = ?
  `).get(itemId);
}

function serializeHomeItem(row) {
  if (!row) return null;
  return {
    item_id: row.item_id,
    name: row.name,
    slot: row.slot,
    file_path: row.file_path,
  };
}

function serializeCatalogItem(row, ownedSet) {
  return {
    item_id: row.item_id,
    name: row.name,
    slot: row.slot,
    price: row.price,
    created_at: row.created_at,
    is_free: Boolean(row.is_free),
    is_active: Boolean(row.is_active),
    owned: ownedSet.has(row.item_id),
    file_path: row.file_path,
  };
}

function serializeBackDecorRow(row) {
  return {
    item_id: row.item_id,
    name: row.name,
    slot: row.slot,
    file_path: row.file_path,
    sort_order: row.sort_order,
    enabled_at: row.enabled_at,
  };
}

function getBackDecor(userId) {
  return db.prepare(`
    SELECT
      i.item_id,
      i.name,
      i.slot,
      COALESCE(s.file_path, '/home/' || i.item_id || '.png') AS file_path,
      e.sort_order,
      e.enabled_at
    FROM home_back_decor_enabled e
    JOIN home_shop_items i ON i.item_id = e.item_id
    LEFT JOIN home_custom_sprites s ON s.item_id = i.item_id
    WHERE e.user_id = ?
    ORDER BY e.sort_order ASC, e.enabled_at ASC, e.item_id ASC
  `).all(userId).map(serializeBackDecorRow);
}

function getFullHomeState(userId) {
  const summary = getHomeSummary(userId);
  if (!summary.owned) {
    return {
      home: {
        ...summary,
        canvas: {
          width: HOME_CANVAS_WIDTH,
          height: HOME_CANVAS_HEIGHT,
        },
        slots: {
          wall_base: null,
          floor_base: null,
          floor_cover: null,
          back_decor: [],
          foreground_item: null,
        },
      },
    };
  }

  const row = db.prepare(`
    SELECT
      purchased_at,
      wall_base_item_id,
      floor_base_item_id,
      floor_cover_item_id,
      foreground_item_id
    FROM personal_homes
    WHERE user_id = ?
  `).get(userId);

  return {
    home: {
      ...summary,
      canvas: {
        width: HOME_CANVAS_WIDTH,
        height: HOME_CANVAS_HEIGHT,
      },
      slots: {
        wall_base: serializeHomeItem(getHomeItemRow(normalizeHomeSlotItemId(row.wall_base_item_id))),
        floor_base: serializeHomeItem(getHomeItemRow(row.floor_base_item_id)),
        floor_cover: serializeHomeItem(getHomeItemRow(row.floor_cover_item_id)),
        back_decor: getBackDecor(userId),
        foreground_item: serializeHomeItem(getHomeItemRow(row.foreground_item_id)),
      },
    },
  };
}

function getHomeCatalog(userId) {
  const ownedSet = new Set(getOwnedHomeItems(userId));
  return db.prepare(`
    SELECT
      i.item_id,
      i.name,
      i.slot,
      i.price,
      i.created_at,
      i.is_free,
      i.is_active,
      COALESCE(s.file_path, '/home/' || i.item_id || '.png') AS file_path
    FROM home_shop_items i
    LEFT JOIN home_custom_sprites s ON s.item_id = i.item_id
    LEFT JOIN owned_home_items o
      ON o.item_id = i.item_id
     AND o.user_id = ?
    WHERE i.item_id != ?
      AND (i.is_active = 1 OR o.item_id IS NOT NULL)
    ORDER BY i.slot ASC, i.is_free DESC, i.price ASC, i.name ASC
  `).all(userId, HOME_STARTER_WALL_ITEM_ID).map((row) => serializeCatalogItem(row, ownedSet));
}

function assertHomeOwned(userId) {
  const home = db.prepare('SELECT 1 FROM personal_homes WHERE user_id = ?').get(userId);
  if (!home) {
    const error = new Error('Buy your Personal Home first!');
    error.status = 400;
    throw error;
  }
}

module.exports = {
  assertHomeOwned,
  getBackDecor,
  getFullHomeState,
  getHomeCatalog,
  getHomeItemRow,
  getHomeSummary,
  getOwnedHomeItems,
  grantFridgeHomeDecor,
  grantFreeHomeItems,
  serializeHomeItem,
};
