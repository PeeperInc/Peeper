const path = require('path');
const fs = require('fs');
const {
  HOME_BUILTIN_FLOOR_PATH,
  HOME_BUILTIN_WALL_PATH,
  HOME_CANVAS_HEIGHT,
  HOME_CANVAS_WIDTH,
  HOME_PEEPER_CENTER_X,
  HOME_PEEPER_CENTER_Y,
  HOME_PEEPER_SIZE,
  VISIT_HOME_OWNER_CENTER_X,
  VISIT_HOME_PEEPER_CENTER_Y,
  VISIT_HOME_PEEPER_SIZE,
  VISIT_HOME_VIEWER_CENTER_X,
} = require('./homeConstants');

const PROD_HTML_DIR = '/var/www/peeper.frenzyradio.online/html';

function getHtmlRoot() {
  if (fs.existsSync(PROD_HTML_DIR)) return PROD_HTML_DIR;
  const sharedHtml = path.join(__dirname, '../html');
  if (fs.existsSync(sharedHtml)) return sharedHtml;
  return path.join(__dirname, '../frontend/public');
}

function resolvePublicAsset(publicPath) {
  if (!publicPath || typeof publicPath !== 'string') return null;
  const relativePath = publicPath.split('?')[0].replace(/^\/+/, '');
  const absolutePath = path.join(getHtmlRoot(), relativePath);
  return fs.existsSync(absolutePath) ? absolutePath : null;
}

async function loadCanvasModule() {
  try {
    return require('canvas');
  } catch (e) {
    console.warn('[homeRenderer] canvas not available:', e.message);
    return null;
  }
}

async function renderPeeperOnto(ctx, peeper, x, y, size, loadImage, mirror = false) {
  async function loadSprite(name) {
    const p = resolvePublicAsset(`/sprites/${name}.png`);
    if (!p) return null;
    try {
      return await loadImage(p);
    } catch {
      return null;
    }
  }

  function drawSprite(img, flip) {
    if (!img) return;
    ctx.save();
    if (flip) {
      ctx.translate(x + size, y);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, size, size);
    } else {
      ctx.drawImage(img, x, y, size, size);
    }
    ctx.restore();
  }

  const isAlive = Boolean(peeper?.alive ?? true);

  if (!isAlive) {
    const dead = await loadSprite('dead');
    if (dead) {
      drawSprite(dead, mirror);
      return;
    }

    ctx.save();
    ctx.font = `${size * 0.35}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💀', x + size / 2, y + size / 2);
    ctx.restore();
    return;
  }

  const base = await loadSprite('base');
  if (base) {
    drawSprite(base, mirror);
  } else {
    ctx.save();
    ctx.fillStyle = '#6DBF6A';
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (peeper?.slot_body) drawSprite(await loadSprite(peeper.slot_body), mirror);
  if (peeper?.slot_face) drawSprite(await loadSprite(peeper.slot_face), mirror);
  if (peeper?.slot_head) drawSprite(await loadSprite(peeper.slot_head), mirror);
  if (peeper?.slot_hands) drawSprite(await loadSprite(peeper.slot_hands), mirror);
  if (peeper?.slot_fren) drawSprite(await loadSprite(peeper.slot_fren), mirror);
}

async function drawHomeLayer(ctx, loadImage, publicPath) {
  const absolutePath = resolvePublicAsset(publicPath);
  if (!absolutePath) return false;

  try {
    const image = await loadImage(absolutePath);
    ctx.drawImage(image, 0, 0, HOME_CANVAS_WIDTH, HOME_CANVAS_HEIGHT);
    return true;
  } catch (e) {
    console.warn('[homeRenderer] drawHomeLayer failed:', publicPath, e.message);
    return false;
  }
}

function getSortedBackDecor(home) {
  const items = home?.slots?.back_decor;
  return Array.isArray(items)
    ? [...items].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    : [];
}

async function drawHomeInterior(ctx, loadImage, home) {
  const slots = home?.slots || {};
  const backDecor = getSortedBackDecor(home);

  await drawHomeLayer(ctx, loadImage, HOME_BUILTIN_WALL_PATH);
  await drawHomeLayer(ctx, loadImage, slots.wall_base?.file_path);
  await drawHomeLayer(ctx, loadImage, HOME_BUILTIN_FLOOR_PATH);
  await drawHomeLayer(ctx, loadImage, slots.floor_base?.file_path);
  await drawHomeLayer(ctx, loadImage, slots.floor_cover?.file_path);

  for (const item of backDecor) {
    await drawHomeLayer(ctx, loadImage, item.file_path);
  }

  return slots;
}

function paintBackdrop(ctx) {
  const bg = ctx.createLinearGradient(0, 0, 0, HOME_CANVAS_HEIGHT);
  bg.addColorStop(0, '#efe4d0');
  bg.addColorStop(0.55, '#e4d4bc');
  bg.addColorStop(1, '#ccb393');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, HOME_CANVAS_WIDTH, HOME_CANVAS_HEIGHT);

  const glow = ctx.createRadialGradient(
    HOME_CANVAS_WIDTH / 2,
    HOME_CANVAS_HEIGHT * 0.12,
    24,
    HOME_CANVAS_WIDTH / 2,
    HOME_CANVAS_HEIGHT * 0.12,
    HOME_CANVAS_WIDTH * 0.55
  );
  glow.addColorStop(0, 'rgba(255,255,255,0.28)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, HOME_CANVAS_WIDTH, HOME_CANVAS_HEIGHT);
}

async function renderHomeScene(home, peeper) {
  const canvasApi = await loadCanvasModule();
  if (!canvasApi) return null;

  const { createCanvas, loadImage } = canvasApi;
  const canvas = createCanvas(HOME_CANVAS_WIDTH, HOME_CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  paintBackdrop(ctx);
  const slots = await drawHomeInterior(ctx, loadImage, home);

  await renderPeeperOnto(
    ctx,
    peeper,
    Math.round(HOME_PEEPER_CENTER_X - HOME_PEEPER_SIZE / 2),
    Math.round(HOME_PEEPER_CENTER_Y - HOME_PEEPER_SIZE / 2),
    HOME_PEEPER_SIZE,
    loadImage,
    false
  );

  await drawHomeLayer(ctx, loadImage, slots.foreground_item?.file_path);

  try {
    return canvas.toBuffer('image/png');
  } catch (e) {
    console.error('[homeRenderer] home toBuffer failed:', e.message);
    return null;
  }
}

async function renderVisitHomeScene(home, viewerPeeper, ownerPeeper) {
  const canvasApi = await loadCanvasModule();
  if (!canvasApi) return null;

  const { createCanvas, loadImage } = canvasApi;
  const canvas = createCanvas(HOME_CANVAS_WIDTH, HOME_CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

  paintBackdrop(ctx);
  const slots = await drawHomeInterior(ctx, loadImage, home);

  await renderPeeperOnto(
    ctx,
    viewerPeeper,
    Math.round(VISIT_HOME_VIEWER_CENTER_X - VISIT_HOME_PEEPER_SIZE / 2),
    Math.round(VISIT_HOME_PEEPER_CENTER_Y - VISIT_HOME_PEEPER_SIZE / 2),
    VISIT_HOME_PEEPER_SIZE,
    loadImage,
    false
  );

  await renderPeeperOnto(
    ctx,
    ownerPeeper,
    Math.round(VISIT_HOME_OWNER_CENTER_X - VISIT_HOME_PEEPER_SIZE / 2),
    Math.round(VISIT_HOME_PEEPER_CENTER_Y - VISIT_HOME_PEEPER_SIZE / 2),
    VISIT_HOME_PEEPER_SIZE,
    loadImage,
    true
  );

  await drawHomeLayer(ctx, loadImage, slots.foreground_item?.file_path);

  try {
    return canvas.toBuffer('image/png');
  } catch (e) {
    console.error('[homeRenderer] visit toBuffer failed:', e.message);
    return null;
  }
}

module.exports = {
  renderHomeScene,
  renderVisitHomeScene,
};
