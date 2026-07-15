const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const db       = require('../database');
const { validateTelegramInit } = require('../auth');
const { isAdminTelegramId } = require('../adminAccess');
const { bustAssetCache, getPublicAppSettings } = require('../appSettings');
const {
  HOME_ALLOWED_SLOTS,
  HOME_CANVAS_HEIGHT,
  HOME_CANVAS_WIDTH,
  HOME_STARTER_WALL_ITEM_ID,
} = require('../homeConstants');

// Admin access by Telegram ID — stable, works regardless of username privacy settings
const PROD_HTML_DIR = '/var/www/peeper.frenzyradio.online/html';

function getLocalAssetRoot() {
  const sharedHtml = path.join(__dirname, '../../html');
  if (fs.existsSync(sharedHtml)) return sharedHtml;
  return path.join(__dirname, '../../frontend/public');
}

function getSpritesDir() {
  return fs.existsSync(PROD_HTML_DIR)
    ? path.join(PROD_HTML_DIR, 'sprites')
    : path.join(getLocalAssetRoot(), 'sprites');
}

function getGiftsDir() {
  return fs.existsSync(PROD_HTML_DIR)
    ? path.join(PROD_HTML_DIR, 'gifts')
    : path.join(getLocalAssetRoot(), 'gifts');
}

function getHomeDir() {
  return fs.existsSync(PROD_HTML_DIR)
    ? path.join(PROD_HTML_DIR, 'home')
    : path.join(getLocalAssetRoot(), 'home');
}

function readPngDimensions(filePath) {
  const header = fs.readFileSync(filePath);
  const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (header.length < 24 || !pngSignature.every((byte, index) => header[index] === byte)) {
    throw new Error('Invalid PNG file');
  }

  return {
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
}

function readGifDimensions(filePath) {
  const header = fs.readFileSync(filePath);
  if (header.length < 10 || header.toString('ascii', 0, 6) !== 'GIF89a' && header.toString('ascii', 0, 6) !== 'GIF87a') {
    throw new Error('Invalid GIF file');
  }

  return {
    width: header.readUInt16LE(6),
    height: header.readUInt16LE(8),
  };
}

function readHomeImageDimensions(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return readPngDimensions(filePath);
  if (ext === '.gif') return readGifDimensions(filePath);
  throw new Error('Only PNG or GIF files allowed');
}

function validateHomeImageSize(filePath) {
  const { width, height } = readHomeImageDimensions(filePath);
  if (width !== HOME_CANVAS_WIDTH || height !== HOME_CANVAS_HEIGHT) {
    throw new Error(`Home decor image must be exactly ${HOME_CANVAS_WIDTH}x${HOME_CANVAS_HEIGHT}`);
  }
}

function requireAdmin(req, res, next) {
  const telegramId = String(req.telegramUser?.id || '');
  if (!isAdminTelegramId(telegramId)) {
    return res.status(403).json({ error: 'Forbidden — admin only' });
  }
  next();
}

router.get('/cache-settings', validateTelegramInit, requireAdmin, (_req, res) => {
  res.json(getPublicAppSettings());
});

router.post('/cache/bust-assets', validateTelegramInit, requireAdmin, (_req, res) => {
  const settings = bustAssetCache();
  res.json({
    message: 'Asset cache version updated. Clients will redownload sprites, home decor, and avatars on the next sync.',
    ...settings,
  });
});

router.get('/chat-mutes', validateTelegramInit, requireAdmin, (_req, res) => {
  const nowTs = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM global_chat_mutes WHERE muted_until IS NOT NULL AND muted_until <= ?').run(nowTs);

  const mutes = db.prepare(`
    SELECT mute.user_id, mute.muted_until, mute.created_at,
           target.telegram_id, target.first_name, target.username, target.photo_url,
           actor.id AS actor_user_id, actor.first_name AS actor_first_name,
           actor.username AS actor_username
    FROM global_chat_mutes mute
    JOIN users target ON target.id = mute.user_id
    LEFT JOIN users actor ON actor.id = mute.muted_by
    ORDER BY mute.muted_until IS NULL DESC, mute.created_at DESC
  `).all().map(row => ({
    userId: row.user_id,
    telegramId: row.telegram_id,
    firstName: row.first_name,
    username: row.username,
    photoUrl: row.photo_url,
    mutedUntil: row.muted_until,
    createdAt: row.created_at,
    mutedBy: row.actor_user_id ? {
      userId: row.actor_user_id,
      firstName: row.actor_first_name,
      username: row.actor_username,
    } : null,
  }));

  res.json({ mutes });
});

router.delete('/chat-mutes/:userId', validateTelegramInit, requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  const target = db.prepare('SELECT first_name FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const result = db.prepare('DELETE FROM global_chat_mutes WHERE user_id = ?').run(userId);
  if (result.changes === 0) return res.status(404).json({ error: 'This user is not muted' });
  return res.json({ message: `${target.first_name || 'Player'} can speak in Global Chat again` });
});

// Multer for sprites (PNG)
const spriteStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = getSpritesDir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, _file, cb) => {
    const itemId = (req.body.itemId || '').replace(/[^a-z0-9_]/gi, '');
    if (!itemId) return cb(new Error('itemId required'));
    cb(null, `${itemId}.png`);
  },
});

const upload = multer({
  storage: spriteStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'image/png') return cb(new Error('Only PNG files allowed'));
    cb(null, true);
  },
});

// Multer for gift images (WebP, PNG, GIF)
const GIFT_MIME_MAP = {
  'image/webp': '.webp',
  'image/png':  '.png',
  'image/gif':  '.gif',
};

const giftStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = getGiftsDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const itemId = (req.body.itemId || '').replace(/[^a-z0-9_]/gi, '');
    if (!itemId) return cb(new Error('itemId is required'));
    // Determine extension from mime or original filename
    const origLower = file.originalname.toLowerCase();
    let ext = GIFT_MIME_MAP[file.mimetype];
    if (!ext) {
      if (origLower.endsWith('.gif'))  ext = '.gif';
      else if (origLower.endsWith('.png'))  ext = '.png';
      else if (origLower.endsWith('.webp')) ext = '.webp';
      else ext = '.webp'; // fallback
    }
    cb(null, `${itemId}${ext}`);
  },
});

const uploadGift = multer({
  storage: giftStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const origLower = file.originalname.toLowerCase();
    const allowedMimes = Object.keys(GIFT_MIME_MAP);
    const allowedExts  = ['.webp', '.png', '.gif'];
    const byMime = allowedMimes.includes(file.mimetype);
    const byExt  = allowedExts.some(e => origLower.endsWith(e));
    // Also allow generic octet-stream (some browsers send this for any binary)
    const generic = ['application/octet-stream', 'binary/octet-stream'].includes(file.mimetype);
    if (!byMime && !byExt && !generic) {
      return cb(new Error(`Only WebP, PNG or GIF files allowed (got: ${file.mimetype})`));
    }
    cb(null, true);
  },
});

const homeStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = getHomeDir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const itemId = (req.body.itemId || '').replace(/[^a-z0-9_]/gi, '');
    if (!itemId) return cb(new Error('itemId required'));
    const origLower = (file.originalname || '').toLowerCase();
    let ext = '.png';
    if (file.mimetype === 'image/gif' || origLower.endsWith('.gif')) ext = '.gif';
    cb(null, `${itemId}${ext}`);
  },
});

const uploadHome = multer({
  storage: homeStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const origLower = (file.originalname || '').toLowerCase();
    const allowedMimes = ['image/png', 'image/gif'];
    const allowedExts = ['.png', '.gif'];
    const byMime = allowedMimes.includes(file.mimetype);
    const byExt = allowedExts.some(ext => origLower.endsWith(ext));
    const generic = ['application/octet-stream', 'binary/octet-stream'].includes(file.mimetype);
    if (!byMime && !byExt && !generic) {
      return cb(new Error(`Only PNG or GIF files allowed (got: ${file.mimetype})`));
    }
    cb(null, true);
  },
});

// ── ITEMS CRUD ────────────────────────────────────────────────────────────────

/** GET /api/admin/items — list all shop items */
router.get('/items', validateTelegramInit, requireAdmin, (_req, res) => {
  const items = db.prepare('SELECT * FROM shop_items ORDER BY slot, price').all();
  res.json({ items });
});

/** POST /api/admin/items — create new item */
router.post('/items', validateTelegramInit, requireAdmin, (req, res) => {
  const { name, slot, price, is_free } = req.body;
  if (!name || !slot) return res.status(400).json({ error: 'name and slot are required' });

  const VALID_SLOTS = ['head', 'body', 'hands', 'fren', 'face'];
  if (!VALID_SLOTS.includes(slot)) return res.status(400).json({ error: 'Invalid slot' });

  const base   = `${slot}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const itemId = base.slice(0, 40);

  const existing = db.prepare('SELECT id FROM shop_items WHERE item_id = ?').get(itemId);
  if (existing) return res.status(400).json({ error: `Item ID "${itemId}" already exists. Choose a different name.` });

  const parsedPrice = Math.max(0, parseInt(price, 10) || 0);
  const isFree      = is_free ? 1 : 0;

  const result = db.prepare(`
    INSERT INTO shop_items (item_id, name, slot, price, is_free)
    VALUES (?, ?, ?, ?, ?)
  `).run(itemId, name.trim(), slot, parsedPrice, isFree);

  if (isFree) {
    const users = db.prepare('SELECT id FROM users').all();
    const grant = db.transaction(() => {
      for (const u of users) {
        db.prepare('INSERT OR IGNORE INTO owned_items (user_id, item_id) VALUES (?, ?)').run(u.id, itemId);
      }
    });
    grant();
  }

  const item = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(result.lastInsertRowid);
  res.json({ message: `Item "${name}" created!`, item });
});

/** PATCH /api/admin/items/:itemId — edit item */
router.patch('/items/:itemId', validateTelegramInit, requireAdmin, (req, res) => {
  const { itemId } = req.params;
  const { name, price, is_free } = req.body;

  const item = db.prepare('SELECT * FROM shop_items WHERE item_id = ?').get(itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  db.prepare(`
    UPDATE shop_items SET
      name    = COALESCE(?, name),
      price   = COALESCE(?, price),
      is_free = COALESCE(?, is_free)
    WHERE item_id = ?
  `).run(name ?? null, price != null ? parseInt(price, 10) : null, is_free != null ? (is_free ? 1 : 0) : null, itemId);

  const updated = db.prepare('SELECT * FROM shop_items WHERE item_id = ?').get(itemId);
  res.json({ item: updated });
});

/** DELETE /api/admin/items/:itemId */
router.delete('/items/:itemId', validateTelegramInit, requireAdmin, (req, res) => {
  const { itemId } = req.params;
  db.prepare('DELETE FROM shop_items WHERE item_id = ?').run(itemId);
  db.prepare('DELETE FROM owned_items WHERE item_id = ?').run(itemId);
  try { fs.unlinkSync(path.join(getSpritesDir(), `${itemId}.png`)); } catch {}
  res.json({ message: `Item "${itemId}" deleted` });
});

// ── SPRITES ────────────────────────────────────────────────────────────────────

/** GET /api/admin/sprites */
router.get('/sprites', validateTelegramInit, requireAdmin, (_req, res) => {
  const dir = getSpritesDir();
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.png'))
      .map(f => ({
        filename: f, itemId: f.replace('.png', ''),
        url: `/sprites/${f}`,
        size: fs.statSync(path.join(dir, f)).size,
      }));
  } catch {}
  res.json({ sprites: files });
});

/** POST /api/admin/sprites/upload */
router.post('/sprites/upload', validateTelegramInit, requireAdmin, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const itemId = (req.body.itemId || '').replace(/[^a-z0-9_]/gi, '');
    db.prepare(`
      INSERT INTO custom_sprites (item_id, file_path)
      VALUES (?, ?)
      ON CONFLICT(item_id) DO UPDATE SET file_path = excluded.file_path, uploaded_at = strftime('%s','now')
    `).run(itemId, `/sprites/${itemId}.png`);

    res.json({ message: `Uploaded: ${itemId}.png`, url: `/sprites/${itemId}.png`, itemId });
  });
});

/** DELETE /api/admin/sprites/:itemId */
router.delete('/sprites/:itemId', validateTelegramInit, requireAdmin, (req, res) => {
  const itemId = req.params.itemId.replace(/[^a-z0-9_]/gi, '');
  try { fs.unlinkSync(path.join(getSpritesDir(), `${itemId}.png`)); } catch {}
  db.prepare('DELETE FROM custom_sprites WHERE item_id = ?').run(itemId);
  res.json({ message: `Deleted: ${itemId}` });
});

// ── GIFT CATALOG CRUD ──────────────────────────────────────────────────────────

/** GET /api/admin/gift-items — list all gift catalog items */
router.get('/gift-items', validateTelegramInit, requireAdmin, (_req, res) => {
  const items = db.prepare('SELECT * FROM gift_catalog ORDER BY price').all();
  res.json({ items });
});

/** POST /api/admin/gift-items — create a new gift item */
router.post('/gift-items', validateTelegramInit, requireAdmin, (req, res) => {
  const { name, price } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const base   = `gift_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const itemId = base.slice(0, 40);

  const existing = db.prepare('SELECT id FROM gift_catalog WHERE item_id = ?').get(itemId);
  if (existing) return res.status(400).json({ error: `Gift ID "${itemId}" already exists. Choose a different name.` });

  const parsedPrice = Math.max(0, parseInt(price, 10) || 50);

  const result = db.prepare(`
    INSERT INTO gift_catalog (item_id, name, price)
    VALUES (?, ?, ?)
  `).run(itemId, name.trim(), parsedPrice);

  const item = db.prepare('SELECT * FROM gift_catalog WHERE id = ?').get(result.lastInsertRowid);
  res.json({ message: `Gift "${name}" created! ID: ${itemId}`, item });
});

/** PATCH /api/admin/gift-items/:itemId — edit gift item */
router.patch('/gift-items/:itemId', validateTelegramInit, requireAdmin, (req, res) => {
  const { itemId } = req.params;
  const { name, price } = req.body;

  const item = db.prepare('SELECT * FROM gift_catalog WHERE item_id = ?').get(itemId);
  if (!item) return res.status(404).json({ error: 'Gift not found' });

  db.prepare(`
    UPDATE gift_catalog SET
      name  = COALESCE(?, name),
      price = COALESCE(?, price)
    WHERE item_id = ?
  `).run(name ?? null, price != null ? parseInt(price, 10) : null, itemId);

  const updated = db.prepare('SELECT * FROM gift_catalog WHERE item_id = ?').get(itemId);
  res.json({ item: updated });
});

/** DELETE /api/admin/gift-items/:itemId */
router.delete('/gift-items/:itemId', validateTelegramInit, requireAdmin, (req, res) => {
  const { itemId } = req.params;
  // Delete gift file regardless of extension
  for (const ext of ['.webp', '.png', '.gif']) {
    try { fs.unlinkSync(path.join(getGiftsDir(), `${itemId}${ext}`)); } catch {}
  }
  db.prepare('DELETE FROM gift_catalog WHERE item_id = ?').run(itemId);
  res.json({ message: `Gift "${itemId}" deleted` });
});

/** POST /api/admin/gift-items/upload — upload animated webp for a gift */
router.post('/gift-items/upload', validateTelegramInit, requireAdmin, (req, res) => {
  uploadGift.single('file')(req, res, (err) => {
    if (err) {
      console.error('[gift upload] multer error:', err.message);
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const itemId = (req.body.itemId || '').replace(/[^a-z0-9_]/gi, '');
    if (!itemId) return res.status(400).json({ error: 'itemId required in form data' });

    // Determine actual extension from uploaded file
    const origLower2 = req.file.originalname.toLowerCase();
    let savedExt = path.extname(req.file.filename) || '.webp';
    // Ensure correct ext based on mime
    if (req.file.mimetype === 'image/gif')  savedExt = '.gif';
    else if (req.file.mimetype === 'image/png') savedExt = '.png';
    else if (req.file.mimetype === 'image/webp') savedExt = '.webp';
    else if (origLower2.endsWith('.gif'))  savedExt = '.gif';
    else if (origLower2.endsWith('.png'))  savedExt = '.png';

    const expectedPath = path.join(getGiftsDir(), `${itemId}${savedExt}`);
    if (req.file.path !== expectedPath) {
      try { fs.renameSync(req.file.path, expectedPath); } catch {}
    }

    const filePath = `/gifts/${itemId}${savedExt}`;
    const result = db.prepare(`
      UPDATE gift_catalog SET file_path = ? WHERE item_id = ?
    `).run(filePath, itemId);

    if (result.changes === 0) {
      return res.status(404).json({ error: `Gift "${itemId}" not found in catalog` });
    }

    res.json({ message: `Uploaded: ${itemId}${savedExt}`, url: filePath, itemId });
  });
});

// ── GET /api/admin/stats ─────────────────────────────────────────────────────
router.get('/home-items', validateTelegramInit, requireAdmin, (_req, res) => {
  const items = db.prepare(`
    SELECT
      i.*,
      COALESCE(s.file_path, '/home/' || i.item_id || '.png') AS file_path
    FROM home_shop_items i
    LEFT JOIN home_custom_sprites s ON s.item_id = i.item_id
    WHERE i.item_id != ?
    ORDER BY i.slot, i.is_free DESC, i.price, i.name
  `).all(HOME_STARTER_WALL_ITEM_ID);

  res.json({ items });
});

router.post('/home-items', validateTelegramInit, requireAdmin, (req, res) => {
  const { name, slot, price, is_free, is_active } = req.body || {};
  if (!name || !slot) return res.status(400).json({ error: 'name and slot are required' });
  if (!HOME_ALLOWED_SLOTS.includes(slot)) {
    return res.status(400).json({ error: 'Invalid home decor slot' });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const itemId = `home_${slot}_${slug}`.slice(0, 64);
  const existing = db.prepare('SELECT id FROM home_shop_items WHERE item_id = ?').get(itemId);
  if (existing) {
    return res.status(400).json({ error: `Home item ID "${itemId}" already exists. Choose a different name.` });
  }

  const parsedPrice = Math.max(0, parseInt(price, 10) || 0);
  const isFree = is_free ? 1 : 0;
  const isActive = is_active == null ? 1 : (is_active ? 1 : 0);

  const result = db.prepare(`
    INSERT INTO home_shop_items (item_id, name, slot, price, is_free, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(itemId, name.trim(), slot, parsedPrice, isFree, isActive);

  if (isFree) {
    const users = db.prepare('SELECT id FROM users').all();
    const grant = db.transaction(() => {
      for (const u of users) {
        db.prepare('INSERT OR IGNORE INTO owned_home_items (user_id, item_id) VALUES (?, ?)').run(u.id, itemId);
      }
    });
    grant();
  }

  const item = db.prepare(`
    SELECT
      i.*,
      COALESCE(s.file_path, '/home/' || i.item_id || '.png') AS file_path
    FROM home_shop_items i
    LEFT JOIN home_custom_sprites s ON s.item_id = i.item_id
    WHERE i.id = ?
  `).get(result.lastInsertRowid);

  res.json({ message: `Home decor "${name}" created!`, item });
});

router.patch('/home-items/:itemId', validateTelegramInit, requireAdmin, (req, res) => {
  const { itemId } = req.params;
  const { name, price, is_free, is_active } = req.body || {};
  if (itemId === HOME_STARTER_WALL_ITEM_ID) {
    return res.status(400).json({ error: 'Base home is built-in and cannot be edited here' });
  }

  const item = db.prepare('SELECT * FROM home_shop_items WHERE item_id = ?').get(itemId);
  if (!item) return res.status(404).json({ error: 'Home decor item not found' });

  const nextIsFree = is_free != null ? (is_free ? 1 : 0) : item.is_free;

  db.prepare(`
    UPDATE home_shop_items SET
      name = COALESCE(?, name),
      price = COALESCE(?, price),
      is_free = COALESCE(?, is_free),
      is_active = COALESCE(?, is_active)
    WHERE item_id = ?
  `).run(
    name ?? null,
    price != null ? Math.max(0, parseInt(price, 10) || 0) : null,
    is_free != null ? nextIsFree : null,
    is_active != null ? (is_active ? 1 : 0) : null,
    itemId
  );

  if (!item.is_free && nextIsFree) {
    const users = db.prepare('SELECT id FROM users').all();
    const grant = db.transaction(() => {
      for (const u of users) {
        db.prepare('INSERT OR IGNORE INTO owned_home_items (user_id, item_id) VALUES (?, ?)').run(u.id, itemId);
      }
    });
    grant();
  }

  const updated = db.prepare(`
    SELECT
      i.*,
      COALESCE(s.file_path, '/home/' || i.item_id || '.png') AS file_path
    FROM home_shop_items i
    LEFT JOIN home_custom_sprites s ON s.item_id = i.item_id
    WHERE i.item_id = ?
  `).get(itemId);

  res.json({ item: updated });
});

router.delete('/home-items/:itemId', validateTelegramInit, requireAdmin, (req, res) => {
  const itemId = req.params.itemId.replace(/[^a-z0-9_]/gi, '');
  if (itemId === HOME_STARTER_WALL_ITEM_ID) {
    return res.status(400).json({ error: 'Base home is built-in and cannot be deleted here' });
  }

  db.transaction(() => {
    db.prepare('DELETE FROM home_shop_items WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM owned_home_items WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM home_back_decor_enabled WHERE item_id = ?').run(itemId);
    db.prepare('DELETE FROM home_custom_sprites WHERE item_id = ?').run(itemId);
    db.prepare(`
      UPDATE personal_homes
      SET
        wall_base_item_id = CASE WHEN wall_base_item_id = ? THEN NULL ELSE wall_base_item_id END,
        floor_base_item_id = CASE WHEN floor_base_item_id = ? THEN NULL ELSE floor_base_item_id END,
        floor_cover_item_id = CASE WHEN floor_cover_item_id = ? THEN NULL ELSE floor_cover_item_id END,
        foreground_item_id = CASE WHEN foreground_item_id = ? THEN NULL ELSE foreground_item_id END,
        updated_at = strftime('%s','now')
      WHERE wall_base_item_id = ? OR floor_base_item_id = ? OR floor_cover_item_id = ? OR foreground_item_id = ?
    `).run(itemId, itemId, itemId, itemId, itemId, itemId, itemId, itemId);
  })();

  for (const ext of ['.png', '.gif']) {
    try { fs.unlinkSync(path.join(getHomeDir(), `${itemId}${ext}`)); } catch {}
  }
  res.json({ message: `Home decor "${itemId}" deleted` });
});

router.post('/home-items/upload', validateTelegramInit, requireAdmin, (req, res) => {
  uploadHome.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const itemId = (req.body.itemId || '').replace(/[^a-z0-9_]/gi, '');
    if (itemId === HOME_STARTER_WALL_ITEM_ID) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ error: 'Base home is built-in and cannot be uploaded here' });
    }
    const item = db.prepare('SELECT item_id FROM home_shop_items WHERE item_id = ?').get(itemId);
    if (!item) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(404).json({ error: `Home decor "${itemId}" not found in catalog` });
    }

      try {
        validateHomeImageSize(req.file.path);
      } catch (error) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: error.message });
      }

      const origLower = (req.file.originalname || '').toLowerCase();
      let savedExt = path.extname(req.file.filename) || '.png';
      if (req.file.mimetype === 'image/gif') savedExt = '.gif';
      else if (req.file.mimetype === 'image/png') savedExt = '.png';
      else if (origLower.endsWith('.gif')) savedExt = '.gif';
      else if (origLower.endsWith('.png')) savedExt = '.png';

      const expectedPath = path.join(getHomeDir(), `${itemId}${savedExt}`);
      if (req.file.path !== expectedPath) {
        try { fs.renameSync(req.file.path, expectedPath); } catch {}
      }

      for (const ext of ['.png', '.gif']) {
        if (ext === savedExt) continue;
        try { fs.unlinkSync(path.join(getHomeDir(), `${itemId}${ext}`)); } catch {}
      }

      const filePath = `/home/${itemId}${savedExt}`;

      db.prepare(`
        INSERT INTO home_custom_sprites (item_id, file_path)
        VALUES (?, ?)
        ON CONFLICT(item_id) DO UPDATE SET file_path = excluded.file_path, uploaded_at = strftime('%s','now')
      `).run(itemId, filePath);

      res.json({ message: `Uploaded: ${itemId}${savedExt}`, url: filePath, itemId });
    });
  });

router.get('/stats', validateTelegramInit, requireAdmin, (req, res) => {
  const now24h = Math.floor(Date.now() / 1000) - 86400;

  const dau = db.prepare(`
    SELECT COUNT(DISTINCT u.id) AS count
    FROM users u
    JOIN peepers p ON p.user_id = u.id
    WHERE p.last_fed > ? OR p.last_played > ?
  `).get(now24h, now24h);

  const gifts24h = db.prepare(`
    SELECT COUNT(*) AS count FROM gifts_received WHERE sent_at > ?
  `).get(now24h);

  const alivePeepers = db.prepare(`
    SELECT COUNT(*) AS count FROM peepers WHERE alive = 1
  `).get();

  const totalPeepers = db.prepare(`
    SELECT COUNT(*) AS count FROM peepers
  `).get();

  res.json({
    dau:          dau.count,
    gifts24h:     gifts24h.count,
    alivePeepers: alivePeepers.count,
    totalPeepers: totalPeepers.count,
  });
});

module.exports = router;
