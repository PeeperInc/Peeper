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
const {
  ADMIN_TITLE_ITEM_ID,
  PROFILE_FRAME_SIZE,
  PROFILE_SCENE_HEIGHT,
  PROFILE_SCENE_WIDTH,
  getProfileAppearances,
  makeItemId: makeProfileItemId,
  normalizeType: normalizeProfileItemType,
  serializeItem: serializeProfileItem,
} = require('../profileCustomization');

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

function getProfileAssetDir(type) {
  const folder = type === 'frame' ? 'frames' : 'scenes';
  const root = fs.existsSync(PROD_HTML_DIR) ? PROD_HTML_DIR : getLocalAssetRoot();
  return path.join(root, 'profile', folder);
}

function readPngBufferDimensions(buffer) {
  const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !pngSignature.every((byte, index) => buffer[index] === byte)) {
    throw new Error('Invalid PNG file');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function validateNameStyleInput(source, current = null) {
  const normalizeColor = (value) => {
    const color = String(value || '').trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(color) ? color : null;
  };
  const primaryInput = source?.nameColor ?? current?.name_color ?? '#F4FFE9';
  const secondaryInput = source?.nameColorSecondary ?? current?.name_color_secondary ?? '';
  const glowInput = source?.nameGlowColor ?? current?.name_glow_color ?? primaryInput;
  const primary = normalizeColor(primaryInput);
  const secondary = String(secondaryInput || '').trim() ? normalizeColor(secondaryInput) : null;
  const glow = normalizeColor(glowInput);
  const glowStrength = Math.max(0, Math.min(3, Number.parseInt(
    source?.nameGlowStrength ?? current?.name_glow_strength ?? 0,
    10,
  ) || 0));

  if (!primary) return { error: 'Primary name color must be a valid #RRGGBB color' };
  if (String(secondaryInput || '').trim() && !secondary) {
    return { error: 'Secondary name color must be empty or a valid #RRGGBB color' };
  }
  if (!glow) return { error: 'Glow color must be a valid #RRGGBB color' };
  return { values: { primary, secondary, glow, glowStrength } };
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

  const muteRows = db.prepare(`
    SELECT mute.user_id, mute.muted_until, mute.created_at,
           target.telegram_id, target.first_name, target.username, target.photo_url,
           actor.id AS actor_user_id, actor.first_name AS actor_first_name,
           actor.username AS actor_username
    FROM global_chat_mutes mute
    JOIN users target ON target.id = mute.user_id
    LEFT JOIN users actor ON actor.id = mute.muted_by
    ORDER BY mute.muted_until IS NULL DESC, mute.created_at DESC
  `).all();
  const appearances = getProfileAppearances(muteRows.flatMap(row => [row.user_id, row.actor_user_id]));
  const mutes = muteRows.map(row => ({
    userId: row.user_id,
    telegramId: row.telegram_id,
    firstName: row.first_name,
    username: row.username,
    photoUrl: row.photo_url,
    appearance: appearances.get(Number(row.user_id)) || null,
    mutedUntil: row.muted_until,
    createdAt: row.created_at,
    mutedBy: row.actor_user_id ? {
      userId: row.actor_user_id,
      firstName: row.actor_first_name,
      username: row.actor_username,
      appearance: appearances.get(Number(row.actor_user_id)) || null,
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

const uploadProfileAsset = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPng = file.mimetype === 'image/png' || String(file.originalname || '').toLowerCase().endsWith('.png');
    if (!isPng) return cb(new Error('Only PNG files allowed'));
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
    db.prepare('DELETE FROM home_foreground_items_enabled WHERE item_id = ?').run(itemId);
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

// ── PROFILE CUSTOMIZATION ───────────────────────────────────────────────────

router.get('/profile-items', validateTelegramInit, requireAdmin, (_req, res) => {
  const items = db.prepare(`
    SELECT item.*,
           (SELECT COUNT(*) FROM owned_profile_customizations owned WHERE owned.item_id = item.item_id) AS owner_count
    FROM profile_customization_items item
    ORDER BY item.type, item.is_system DESC, item.created_at DESC
  `).all().map(row => ({ ...serializeProfileItem(row), ownerCount: Number(row.owner_count || 0) }));
  res.json({
    items,
    assetGuide: {
      frame: { width: PROFILE_FRAME_SIZE, height: PROFILE_FRAME_SIZE, format: 'PNG' },
      scene: { width: PROFILE_SCENE_WIDTH, height: PROFILE_SCENE_HEIGHT, format: 'PNG' },
    },
  });
});

router.post('/profile-items', validateTelegramInit, requireAdmin, (req, res) => {
  const type = normalizeProfileItemType(req.body?.type);
  const name = String(req.body?.name || '').trim();
  const titleText = String(req.body?.titleText || '').trim();
  const price = Math.max(0, Math.min(1_000_000, Number.parseInt(req.body?.price, 10) || 0));
  const requestedActive = req.body?.isActive == null ? 1 : (req.body.isActive ? 1 : 0);
  const isActive = ['title', 'name_style'].includes(type) ? requestedActive : 0;

  if (!type) return res.status(400).json({ error: 'Type must be frame, scene, title or name style' });
  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Name must be 2-40 characters' });
  if (type === 'title' && (titleText.length < 2 || titleText.length > 32)) {
    return res.status(400).json({ error: 'Title text must be 2-32 characters' });
  }
  const styleResult = type === 'name_style' ? validateNameStyleInput(req.body) : { values: {} };
  if (styleResult.error) return res.status(400).json({ error: styleResult.error });

  const itemId = makeProfileItemId(type, name);
  if (!itemId) return res.status(400).json({ error: 'Name must contain Latin letters or numbers for the item ID' });
  if (db.prepare('SELECT 1 FROM profile_customization_items WHERE item_id = ?').get(itemId)) {
    return res.status(409).json({ error: `Profile item "${itemId}" already exists` });
  }

  db.prepare(`
    INSERT INTO profile_customization_items (
      item_id, name, type, price, title_text, file_path,
      name_color, name_color_secondary, name_glow_color, name_glow_strength,
      is_active, is_system
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0)
  `).run(
    itemId,
    name,
    type,
    price,
    type === 'title' ? titleText : null,
    styleResult.values.primary || null,
    styleResult.values.secondary || null,
    styleResult.values.glow || null,
    styleResult.values.glowStrength || 0,
    isActive,
  );

  const row = db.prepare('SELECT * FROM profile_customization_items WHERE item_id = ?').get(itemId);
  res.json({ item: serializeProfileItem(row), message: `${name} added to Profile Studio` });
});

router.patch('/profile-items/:itemId', validateTelegramInit, requireAdmin, (req, res) => {
  const itemId = String(req.params.itemId || '').replace(/[^a-z0-9_]/gi, '');
  const current = db.prepare('SELECT * FROM profile_customization_items WHERE item_id = ?').get(itemId);
  if (!current) return res.status(404).json({ error: 'Profile item not found' });
  if (current.is_system) return res.status(400).json({ error: 'System profile items cannot be edited' });

  const name = req.body?.name == null ? current.name : String(req.body.name).trim();
  const titleText = req.body?.titleText == null ? current.title_text : String(req.body.titleText).trim();
  const price = req.body?.price == null
    ? current.price
    : Math.max(0, Math.min(1_000_000, Number.parseInt(req.body.price, 10) || 0));
  const isActive = req.body?.isActive == null ? current.is_active : (req.body.isActive ? 1 : 0);

  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Name must be 2-40 characters' });
  if (current.type === 'title' && (String(titleText || '').length < 2 || String(titleText || '').length > 32)) {
    return res.status(400).json({ error: 'Title text must be 2-32 characters' });
  }
  const styleResult = current.type === 'name_style'
    ? validateNameStyleInput(req.body, current)
    : { values: {} };
  if (styleResult.error) return res.status(400).json({ error: styleResult.error });

  db.prepare(`
    UPDATE profile_customization_items
    SET name = ?, price = ?, title_text = ?,
        name_color = ?, name_color_secondary = ?, name_glow_color = ?, name_glow_strength = ?,
        is_active = ?
    WHERE item_id = ?
  `).run(
    name,
    price,
    current.type === 'title' ? titleText : null,
    styleResult.values.primary || null,
    styleResult.values.secondary || null,
    styleResult.values.glow || null,
    styleResult.values.glowStrength || 0,
    isActive,
    itemId,
  );

  const updated = db.prepare('SELECT * FROM profile_customization_items WHERE item_id = ?').get(itemId);
  res.json({ item: serializeProfileItem(updated), message: `${name} updated` });
});

router.post('/profile-items/upload', validateTelegramInit, requireAdmin, (req, res) => {
  uploadProfileAsset.single('file')(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.message });
    if (!req.file) return res.status(400).json({ error: 'Choose a PNG file' });

    const itemId = String(req.body?.itemId || '').replace(/[^a-z0-9_]/gi, '');
    const item = db.prepare('SELECT * FROM profile_customization_items WHERE item_id = ?').get(itemId);
    if (!item) return res.status(404).json({ error: 'Profile item not found' });
    if (!['frame', 'scene'].includes(item.type)) {
      return res.status(400).json({ error: 'Titles and name styles do not use image files' });
    }

    let dimensions;
    try {
      dimensions = readPngBufferDimensions(req.file.buffer);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const expected = item.type === 'frame'
      ? { width: PROFILE_FRAME_SIZE, height: PROFILE_FRAME_SIZE }
      : { width: PROFILE_SCENE_WIDTH, height: PROFILE_SCENE_HEIGHT };
    if (dimensions.width !== expected.width || dimensions.height !== expected.height) {
      return res.status(400).json({
        error: `${item.type === 'frame' ? 'Profile frame' : 'Profile scene'} must be exactly ${expected.width}x${expected.height}px`,
      });
    }

    const directory = getProfileAssetDir(item.type);
    fs.mkdirSync(directory, { recursive: true });
    const destination = path.join(directory, `${itemId}.png`);
    fs.writeFileSync(destination, req.file.buffer);
    const folder = item.type === 'frame' ? 'frames' : 'scenes';
    const filePath = `/profile/${folder}/${itemId}.png`;
    db.prepare('UPDATE profile_customization_items SET file_path = ? WHERE item_id = ?').run(filePath, itemId);

    res.json({
      itemId,
      url: filePath,
      width: dimensions.width,
      height: dimensions.height,
      message: `${item.name} PNG uploaded`,
    });
  });
});

router.delete('/profile-items/:itemId', validateTelegramInit, requireAdmin, (req, res) => {
  const itemId = String(req.params.itemId || '').replace(/[^a-z0-9_]/gi, '');
  const item = db.prepare('SELECT * FROM profile_customization_items WHERE item_id = ?').get(itemId);
  if (!item) return res.status(404).json({ error: 'Profile item not found' });
  if (item.is_system || item.item_id === ADMIN_TITLE_ITEM_ID) {
    return res.status(400).json({ error: 'System profile items cannot be deleted' });
  }

  db.prepare('DELETE FROM profile_customization_items WHERE item_id = ?').run(itemId);
  if (item.file_path) {
    const directory = getProfileAssetDir(item.type);
    try { fs.unlinkSync(path.join(directory, `${itemId}.png`)); } catch {}
  }
  res.json({ message: `${item.name} deleted` });
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
