/**
 * Telegram Bot Webhook
 * POST /api/webhook
 *
 * Commands:
 *   /start      → greeting + green Play button
 *   /mypeeper   → renders peeper as PNG and sends as photo (works in groups too)
 *   /myhome     → renders current Personal Home scene and sends it as photo
 *
 * Button colors via Bot API 9.4:
 *   InlineKeyboardButton supports style: "success" (green), "primary" (blue), "danger" (red)
 *
 * Note: web_app buttons only work in private chats.
 *       In groups we fall back to a regular url button.
 */

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const db      = require('../database');
const { authorizeTelegramWebhookRequest } = require('../telegramWebhookAuth');
const {
  buildTargetLabel,
  parseCommandTarget,
  resolveTargetUser,
} = require('../telegramCommandTarget');
const { liveStats } = require('../gameLogic');
const { getFullHomeState } = require('../homeState');
const { syncOwnedPeeper } = require('../peeperState');
const { renderHomeScene, renderVisitHomeScene } = require('../homeRenderer');
const {
  ensureNotificationSettingsRow,
  getNotificationSettings,
  toggleNotificationSetting,
  buildNotificationSettingsText,
  buildNotificationSettingsMarkup,
} = require('../notificationSettings');
const {
  parseSupportPayload,
  recordSupportDonation,
} = require('../supportState');
const {
  HOME_BUILTIN_FLOOR_PATH,
  HOME_BUILTIN_WALL_PATH,
  HOME_CANVAS_HEIGHT,
  HOME_CANVAS_WIDTH,
} = require('../homeConstants');

const APP_URL     = 'https://peeper.frenzyradio.online';
const PROD_HTML_DIR = '/var/www/peeper.frenzyradio.online/html';
const BOT_USERNAME = 'Peepergochi_bot';
const INLINE_CACHE_DIR = path.join(getHtmlRoot(), 'generated', 'inline');
const INLINE_CACHE_URL = `${APP_URL}/generated/inline`;
const CANVAS_SIZE = 500;
const HOME_PEEPER_SIZE = 255;
const HOME_PEEPER_CENTER_X = HOME_CANVAS_WIDTH / 2;
const HOME_PEEPER_CENTER_Y = HOME_CANVAS_HEIGHT * 0.7;
 
// Register Noto fonts for full Unicode support (emoji, special chars, cyrillic etc)
try {
  const { registerFont } = require('canvas');
  const FONT_PATHS = [
    // Noto Sans — wide Unicode coverage
    ['/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',  { family: 'Noto' }],
    ['/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',     { family: 'Noto', weight: 'bold' }],
    // Noto Color Emoji — renders emoji as colored glyphs
    ['/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',    { family: 'NotoEmoji' }],
  ];
  for (const [path, opts] of FONT_PATHS) {
    if (require('fs').existsSync(path)) {
      registerFont(path, opts);
    }
  }
} catch (e) {
  console.warn('[webhook] font registration failed:', e.message);
}

function getHtmlRoot() {
  if (fs.existsSync(PROD_HTML_DIR)) return PROD_HTML_DIR;
  const sharedHtml = path.join(__dirname, '../../html');
  if (fs.existsSync(sharedHtml)) return sharedHtml;
  return path.join(__dirname, '../../frontend/public');
}

function resolvePublicAsset(publicPath) {
  if (!publicPath || typeof publicPath !== 'string') return null;
  const relativePath = publicPath.split('?')[0].replace(/^\/+/, '');
  const absolutePath = path.join(getHtmlRoot(), relativePath);
  return fs.existsSync(absolutePath) ? absolutePath : null;
}

function ensureInlineCacheDir() {
  fs.mkdirSync(INLINE_CACHE_DIR, { recursive: true });
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(INLINE_CACHE_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue;
    const fullPath = path.join(INLINE_CACHE_DIR, entry.name);
    try {
      if (fs.statSync(fullPath).mtimeMs < cutoff) fs.unlinkSync(fullPath);
    } catch {}
  }
}

function shortHash(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 14);
}

async function writeInlineCachePng(kind, userId, fingerprint, renderBuffer) {
  ensureInlineCacheDir();
  const fileName = `${kind}-${userId}-${shortHash(fingerprint)}.png`;
  const filePath = path.join(INLINE_CACHE_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    const buffer = await renderBuffer();
    if (!buffer) return null;
    fs.writeFileSync(filePath, buffer);
  }
  return `${INLINE_CACHE_URL}/${fileName}`;
}

function syncUserIdentityFromTelegram(tgUser) {
  if (!tgUser?.id) return;

  db.prepare(`
    UPDATE users
    SET
      username = ?,
      first_name = COALESCE(?, first_name)
    WHERE telegram_id = ?
  `).run(
    tgUser.username ?? null,
    tgUser.first_name || null,
    String(tgUser.id)
  );
}

// ── Telegram API helpers ─────────────────────────────────────────────────────

function botToken() { return process.env.BOT_TOKEN; }

/**
 * Build an inline button that opens the Mini App.
 * web_app buttons only work in private chats (chatId > 0).
 * In groups we use a plain url button instead.
 * style: "success" makes the button green (Bot API 9.4+).
 */
function openAppButton(label, chatId) {
  const isPrivate = Number(chatId) > 0;
  if (isPrivate) {
    // In private chat — open Mini App directly
    return { text: label, web_app: { url: APP_URL }, style: 'success' };
  }
  // In groups — link to bot, user taps and Mini App opens in private chat
  return { text: label, url: 'https://t.me/Peepergochi_bot', style: 'success' };
}

async function sendMessage(chatId, text, replyMarkup) {
  const token = botToken();
  if (!token || token === 'dev') return;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:      chatId,
        text,
        parse_mode:   'HTML',
        reply_markup: replyMarkup,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn('[webhook] sendMessage failed:', err.description || resp.status);
    }
  } catch (e) { console.error('[webhook] sendMessage error:', e.message); }
}

async function sendPhoto(chatId, imageBuffer, caption, replyMarkup) {
  const token = botToken();
  if (!token || token === 'dev') return false;
  try {
    const form = new FormData();
    form.append('chat_id',    String(chatId));
    form.append('caption',    caption || '');
    form.append('parse_mode', 'HTML');
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    form.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'peeper.png');

    const resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body:   form,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn('[webhook] sendPhoto failed:', err.description || resp.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[webhook] sendPhoto error:', e.message);
    return false;
  }
}

async function editMessageText(chatId, messageId, text, replyMarkup) {
  const token = botToken();
  if (!token || token === 'dev') return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      }),
    });
  } catch (e) {
    console.error('[webhook] editMessageText error:', e.message);
  }
}

async function answerCallbackQuery(callbackQueryId, text, showAlert = false) {
  const token = botToken();
  if (!token || token === 'dev') return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      }),
    });
  } catch (e) {
    console.error('[webhook] answerCallbackQuery error:', e.message);
  }
}

async function answerPreCheckoutQuery(preCheckoutQueryId, ok, errorMessage = '') {
  const token = botToken();
  if (!token || token === 'dev') return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pre_checkout_query_id: preCheckoutQueryId,
        ok: Boolean(ok),
        error_message: ok ? undefined : errorMessage,
      }),
    });
  } catch (e) {
    console.error('[webhook] answerPreCheckoutQuery error:', e.message);
  }
}

async function answerInlineQuery(inlineQueryId, results, options = {}) {
  const token = botToken();
  if (!token || token === 'dev') return;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/answerInlineQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inline_query_id: inlineQueryId,
        results,
        cache_time: options.cacheTime ?? 5,
        is_personal: options.isPersonal ?? true,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn('[webhook] answerInlineQuery failed:', err.description || resp.status);
    }
  } catch (e) {
    console.error('[webhook] answerInlineQuery error:', e.message);
  }
}

function buildInlineArticle({ id, title, description, message }) {
  return {
    type: 'article',
    id,
    title,
    description,
    input_message_content: {
      message_text: message,
      parse_mode: 'HTML',
    },
  };
}

function buildInlinePhoto({ id, title, description, photoUrl, caption }) {
  return {
    type: 'photo',
    id,
    title,
    description,
    photo_url: photoUrl,
    thumbnail_url: photoUrl,
    caption,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{ text: 'Open Peeper', url: `https://t.me/${BOT_USERNAME}` }]],
    },
  };
}

function peeperAppearanceFingerprint(peeper, live = {}) {
  return JSON.stringify({
    alive: Boolean(live.alive ?? peeper?.alive ?? true),
    slot_body: peeper?.slot_body || null,
    slot_face: peeper?.slot_face || null,
    slot_head: peeper?.slot_head || null,
    slot_hands: peeper?.slot_hands || null,
    slot_fren: peeper?.slot_fren || null,
  });
}

async function buildInlinePeeperResult(user) {
  const peeper = db.prepare('SELECT * FROM peepers WHERE user_id = ?').get(user.id);
  if (!peeper) return null;
  const live = liveStats(peeper);
  const peeperWithLive = { ...peeper, ...live };
  const photoUrl = await writeInlineCachePng(
    'peeper',
    user.id,
    peeperAppearanceFingerprint(peeper, live),
    () => renderPeeper(peeperWithLive),
  );
  if (!photoUrl) return null;

  return buildInlinePhoto({
    id: `peeper_${user.id}`,
    title: 'Show My Peeper',
    description: 'Share your current Peeper.',
    photoUrl,
    caption: `🐸 <b>${user.first_name || 'My'}'s Peeper</b>`,
  });
}

async function buildInlineHomeResult(user) {
  const peeper = db.prepare('SELECT * FROM peepers WHERE user_id = ?').get(user.id);
  const homeState = getFullHomeState(user.id);
  if (!peeper || !homeState?.home?.owned) return null;
  const live = liveStats(peeper);
  const peeperWithLive = { ...peeper, ...live };
  const photoUrl = await writeInlineCachePng(
    'home',
    user.id,
    JSON.stringify({ home: homeState.home, peeper: peeperAppearanceFingerprint(peeper, live) }),
    () => renderHomeScene(homeState.home, peeperWithLive),
  );
  if (!photoUrl) return null;

  return buildInlinePhoto({
    id: `home_${user.id}`,
    title: 'Show My Home',
    description: 'Share your current home scene.',
    photoUrl,
    caption: `🏠 <b>${user.first_name || 'My'}'s Home</b>`,
  });
}

async function renderSimpleFamilyInlineImage(family, members) {
  let createCanvas, loadImage;
  try { ({ createCanvas, loadImage } = require('canvas')); }
  catch (e) {
    console.warn('[webhook] inline family canvas unavailable:', e.message);
    return null;
  }

  const W = 1200;
  const H = 760;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#143326');
  bg.addColorStop(1, '#07120d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.fillStyle = '#eaffea';
  ctx.font = 'bold 42px Noto, NotoEmoji, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(family.name || 'Peeper Family', W / 2, 72);
  ctx.font = 'bold 22px Noto, NotoEmoji, sans-serif';
  ctx.fillStyle = 'rgba(234,255,234,0.72)';
  ctx.fillText(`${members.length}/10 members`, W / 2, 108);
  ctx.restore();

  const shown = members.slice(0, 10);
  const cols = Math.min(5, Math.max(1, shown.length));
  const rows = Math.ceil(shown.length / cols);
  const size = rows <= 1 ? 245 : 205;
  const gapX = Math.min(42, Math.max(18, (W - cols * size) / (cols + 1)));
  const startY = rows <= 1 ? 210 : 170;

  for (let index = 0; index < shown.length; index += 1) {
    const member = shown[index];
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = Math.round(gapX + col * (size + gapX));
    const y = Math.round(startY + row * (size + 66));
    await renderPeeperOnto(ctx, member, x, y, size, loadImage, false);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.beginPath();
    ctx.roundRect(x + 20, y + size - 6, size - 40, 36, 16);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Noto, NotoEmoji, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((member.first_name || '?').slice(0, 14), x + size / 2, y + size + 18);
    ctx.restore();
  }

  return canvas.toBuffer('image/png');
}

async function buildInlineFamilyResult(user) {
  const family = db.prepare(`
    SELECT f.* FROM families f
    JOIN family_members fm ON fm.family_id = f.id
    WHERE fm.user_id = ?
  `).get(user.id);
  if (!family) return null;

  const members = db.prepare(`
    SELECT u.id, u.first_name, fm.joined_at,
           p.slot_head, p.slot_body, p.slot_hands, p.slot_fren, p.slot_face, p.alive
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    LEFT JOIN peepers p ON p.user_id = u.id
    WHERE fm.family_id = ?
    ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, fm.joined_at ASC
  `).all(family.id, family.founder_id);
  if (!members.length) return null;

  const photoUrl = await writeInlineCachePng(
    'family',
    user.id,
    JSON.stringify({ family: family.name, members: members.map((member) => peeperAppearanceFingerprint(member, member)) }),
    () => renderSimpleFamilyInlineImage(family, members),
  );
  if (!photoUrl) return null;

  return buildInlinePhoto({
    id: `family_${user.id}`,
    title: 'Show My Family',
    description: 'Share your family portrait.',
    photoUrl,
    caption: `👨‍👩‍👧 <b>${family.name}</b> family`,
  });
}

async function handleInlineQuery(inlineQuery) {
  if (!inlineQuery?.id) return;
  syncUserIdentityFromTelegram(inlineQuery.from);

  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(inlineQuery.from?.id || ''));
  if (!user) {
    await answerInlineQuery(inlineQuery.id, [
      buildInlineArticle({
        id: 'open_peeper_first',
        title: 'Open Peeper first',
        description: 'Create your Peeper before sharing it inline.',
        message: `🐸 <b>Come meet my Peeper!</b>\nOpen @${BOT_USERNAME} to play.`,
      }),
    ], { cacheTime: 2, isPersonal: true });
    return;
  }

  const normalizedQuery = String(inlineQuery.query || '').trim().toLowerCase();
  const allResults = (await Promise.all([
    buildInlinePeeperResult(user),
    buildInlineHomeResult(user),
    buildInlineFamilyResult(user),
  ])).filter(Boolean);

  if (!allResults.length) {
    await answerInlineQuery(inlineQuery.id, [
      buildInlineArticle({
        id: 'nothing_to_share',
        title: 'Nothing to share yet',
        description: 'Open Peeper to create your frog, home, or family.',
        message: `🐸 <b>Come meet my Peeper!</b>\nOpen @${BOT_USERNAME} to play.`,
      }),
    ], { cacheTime: 2, isPersonal: true });
    return;
  }

  const results = normalizedQuery
    ? allResults.filter((result) => {
        const haystack = `${result.title} ${result.description}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : allResults;

  await answerInlineQuery(inlineQuery.id, results.length ? results : allResults, {
    cacheTime: 2,
    isPersonal: true,
  });
}

async function sendNotificationSettingsMenu(chatId, user, messageId = null) {
  ensureNotificationSettingsRow(user.id);
  const settings = getNotificationSettings(user.id);
  const text = buildNotificationSettingsText(user.first_name, settings);
  const markup = buildNotificationSettingsMarkup(settings);

  if (messageId) {
    await editMessageText(chatId, messageId, text, markup);
    return;
  }

  await sendMessage(chatId, text, markup);
}

async function handleNotificationSettingsCallback(callbackQuery) {
  const fromId = String(callbackQuery.from?.id || '');
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const [, settingKey] = String(callbackQuery.data || '').split(':');
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(fromId);

  if (!user || !chatId || !messageId) {
    await answerCallbackQuery(callbackQuery.id, 'Open the app first to create your account.', true);
    return;
  }

  try {
    toggleNotificationSetting(user.id, settingKey);
  } catch {
    await answerCallbackQuery(callbackQuery.id, 'Unknown setting.', true);
    return;
  }

  await sendNotificationSettingsMenu(chatId, user, messageId);
  await answerCallbackQuery(callbackQuery.id, 'Saved');
}

async function handleSupportPreCheckout(preCheckoutQuery) {
  const parsed = parseSupportPayload(preCheckoutQuery.invoice_payload);
  if (!parsed || preCheckoutQuery.currency !== 'XTR' || Number(preCheckoutQuery.total_amount) !== parsed.stars) {
    await answerPreCheckoutQuery(preCheckoutQuery.id, false, 'This donation invoice is no longer valid.');
    return;
  }

  const user = db.prepare('SELECT id, telegram_id FROM users WHERE id = ?').get(parsed.userId);
  if (!user || String(user.telegram_id) !== String(preCheckoutQuery.from?.id || '')) {
    await answerPreCheckoutQuery(preCheckoutQuery.id, false, 'Open Peeper and try the donation again.');
    return;
  }

  await answerPreCheckoutQuery(preCheckoutQuery.id, true);
}

async function handleSupportSuccessfulPayment(message) {
  const payment = message?.successful_payment;
  const parsed = parseSupportPayload(payment?.invoice_payload);
  if (!parsed || payment?.currency !== 'XTR' || Number(payment?.total_amount) !== parsed.stars) {
    console.warn('[support] ignored invalid successful payment payload');
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(parsed.userId);
  if (!user || String(user.telegram_id) !== String(message.from?.id || '')) {
    console.warn('[support] ignored payment with mismatched user', parsed.userId);
    return;
  }

  const result = recordSupportDonation(db, {
    userId: user.id,
    telegramPaymentChargeId: payment.telegram_payment_charge_id,
    providerPaymentChargeId: payment.provider_payment_charge_id || '',
    stars: parsed.stars,
    payload: payment.invoice_payload,
    createdAt: Math.floor(Date.now() / 1000),
  });

  if (result.recorded && message.chat?.id) {
    await sendMessage(
      message.chat.id,
      `⭐ <b>Thank you for supporting Peeper!</b>\n\nYour supporter badge is now active.`,
    );
  }
}

// ── Peeper renderer ──────────────────────────────────────────────────────────

async function renderPeeper(peeper) {
  let createCanvas, loadImage;
  try {
    ({ createCanvas, loadImage } = require('canvas'));
  } catch (e) {
    console.warn('[webhook] canvas not available:', e.message);
    return null;
  }

  const SIZE = CANVAS_SIZE;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx    = canvas.getContext('2d');

  // Warm white background
  ctx.fillStyle = '#FDF8F2';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Subtle warm vignette
  const vignette = ctx.createRadialGradient(SIZE/2, SIZE/2, SIZE*0.3, SIZE/2, SIZE/2, SIZE*0.75);
  vignette.addColorStop(0, 'rgba(255,235,200,0)');
  vignette.addColorStop(1, 'rgba(220,180,120,0.12)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, SIZE, SIZE);
  await renderPeeperOnto(ctx, peeper, 0, 0, SIZE, loadImage, false);

  try {
    return canvas.toBuffer('image/png');
  } catch (e) {
    console.error('[webhook] toBuffer failed:', e.message);
    return null;
  }
}


async function handleFamilyInviteCallback(callbackQuery) {
  const chatId   = callbackQuery.message?.chat?.id;
  const msgId    = callbackQuery.message?.message_id;
  const fromId   = String(callbackQuery.from?.id);
  const data     = callbackQuery.data || '';
  const token    = botToken();

  async function answerCallback(text) {
    if (!token || token === 'dev') return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQuery.id, text, show_alert: true }),
      });
    } catch {}
  }

  async function editMessage(text) {
    if (!token || token === 'dev' || !chatId || !msgId) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML' }),
      });
    } catch {}
  }

  const [action, inviteIdStr] = data.split(':');
  const inviteId = parseInt(inviteIdStr, 10);
  if (!inviteId) return;

  const invite = db.prepare("SELECT * FROM family_invites WHERE id=? AND status='pending'").get(inviteId);
  if (!invite) {
    await answerCallback('This invitation has already been processed.');
    return;
  }

  // Verify the callback is from the invitee
  const invitee = db.prepare('SELECT * FROM users WHERE id=?').get(invite.invitee_id);
  if (!invitee || String(invitee.telegram_id) !== fromId) {
    await answerCallback('This invitation is not for you.');
    return;
  }

  const family = db.prepare('SELECT * FROM families WHERE id=?').get(invite.family_id);
  if (!family) {
    db.prepare("UPDATE family_invites SET status='declined' WHERE id=?").run(inviteId);
    await answerCallback('This family no longer exists.');
    return;
  }

  if (action === 'family_decline') {
    db.prepare("UPDATE family_invites SET status='declined' WHERE id=?").run(inviteId);
    await answerCallback(`You declined the invitation to "${family.name}".`);
    await editMessage(`👨‍👩‍👧 Invitation to <b>${family.name}</b>

❌ You declined this invitation.`);
    return;
  }

  if (action === 'family_accept') {
    // Check invitee not already in a family
    const alreadyIn = db.prepare('SELECT 1 FROM family_members WHERE user_id=?').get(invite.invitee_id);
    if (alreadyIn) {
      db.prepare("UPDATE family_invites SET status='declined' WHERE id=?").run(inviteId);
      await answerCallback('You are already in a family!');
      return;
    }

    // Check slots
    const memberCount = db.prepare('SELECT COUNT(*) as c FROM family_members WHERE family_id=?').get(invite.family_id).c;
    if (memberCount >= 10) {
      db.prepare("UPDATE family_invites SET status='declined' WHERE id=?").run(inviteId);
      await answerCallback(`Sorry — "${family.name}" is already full (10/10)!`);
      await editMessage(`👨‍👩‍👧 Invitation to <b>${family.name}</b>

❌ Family is full — no slots available.`);
      return;
    }

    db.transaction(() => {
      db.prepare('INSERT INTO family_members (family_id, user_id) VALUES (?,?)').run(invite.family_id, invite.invitee_id);
      db.prepare("UPDATE family_invites SET status='accepted' WHERE id=?").run(inviteId);
      // Decline all other pending invites for this user
      db.prepare("UPDATE family_invites SET status='declined' WHERE invitee_id=? AND status='pending' AND id!=?").run(invite.invitee_id, inviteId);
    })();

    await answerCallback(`🎉 Welcome to "${family.name}"!`);
    await editMessage(`👨‍👩‍👧 Invitation to <b>${family.name}</b>

✅ You joined the family! Open the app to meet your family members 🐸`);
  }
}


// ── Render peeper onto existing canvas at position (transparent bg helper) ───
async function renderPeeperOnto(ctx, peeper, x, y, size, loadImage, mirror = false) {
  async function loadSprite(name) {
    const p = resolvePublicAsset(`/sprites/${name}.png`);
    if (!p) return null;
    try { return await loadImage(p); } catch { return null; }
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

  const isAlive = Boolean(peeper.alive ?? true);

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
  if (peeper.slot_body)  drawSprite(await loadSprite(peeper.slot_body), mirror);
  if (peeper.slot_face)  drawSprite(await loadSprite(peeper.slot_face), mirror);
  if (peeper.slot_head)  drawSprite(await loadSprite(peeper.slot_head), mirror);
  if (peeper.slot_hands) drawSprite(await loadSprite(peeper.slot_hands), mirror);
  if (peeper.slot_fren)  drawSprite(await loadSprite(peeper.slot_fren), mirror);
}

async function drawHomeLayer(ctx, loadImage, publicPath) {
  const absolutePath = resolvePublicAsset(publicPath);
  if (!absolutePath) return false;

  try {
    const image = await loadImage(absolutePath);
    ctx.drawImage(image, 0, 0, HOME_CANVAS_WIDTH, HOME_CANVAS_HEIGHT);
    return true;
  } catch (e) {
    console.warn('[webhook] drawHomeLayer failed:', publicPath, e.message);
    return false;
  }
}

async function renderHome(home, peeper) {
  let createCanvas, loadImage;
  try {
    ({ createCanvas, loadImage } = require('canvas'));
  } catch (e) {
    console.warn('[webhook] canvas not available for home render:', e.message);
    return null;
  }

  const canvas = createCanvas(HOME_CANVAS_WIDTH, HOME_CANVAS_HEIGHT);
  const ctx = canvas.getContext('2d');

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

  const slots = home?.slots || {};
  const backDecor = Array.isArray(slots.back_decor)
    ? [...slots.back_decor].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    : [];

  await drawHomeLayer(ctx, loadImage, HOME_BUILTIN_WALL_PATH);
  await drawHomeLayer(ctx, loadImage, slots.wall_base?.file_path);
  await drawHomeLayer(ctx, loadImage, HOME_BUILTIN_FLOOR_PATH);
  await drawHomeLayer(ctx, loadImage, slots.floor_base?.file_path);
  await drawHomeLayer(ctx, loadImage, slots.floor_cover?.file_path);

  for (const item of backDecor) {
    await drawHomeLayer(ctx, loadImage, item.file_path);
  }

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
    console.error('[webhook] home toBuffer failed:', e.message);
    return null;
  }
}

// ── /PNGpeeper — transparent background PNG sent as document ─────────────────
async function handlePNGPeeper(chatId, fromUserId, firstName) {
  const user   = db.prepare('SELECT * FROM users WHERE telegram_id=?').get(String(fromUserId));
  const peeper = user ? db.prepare('SELECT * FROM peepers WHERE user_id=?').get(user.id) : null;

  if (!user || !peeper) {
    await sendMessage(chatId,
      `Hey ${firstName || 'there'}! 👋 You don't have a Peeper yet 🐸`,
      { inline_keyboard: [[openAppButton('🐸 Get my Peeper', chatId)]] }
    );
    return;
  }

  let createCanvas, loadImage;
  try { ({ createCanvas, loadImage } = require('canvas')); }
  catch (e) { await sendMessage(chatId, '❌ Render unavailable.'); return; }

  const SIZE   = CANVAS_SIZE;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx    = canvas.getContext('2d');
  // Transparent background — no fillRect

  await renderPeeperOnto(ctx, peeper, 0, 0, SIZE, loadImage, false);

  const buf = canvas.toBuffer('image/png');
  const token = botToken();
  if (!token || token === 'dev') return;

  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', `🐸 ${firstName || user.first_name}'s Peeper — transparent PNG`);
    form.append('document', new Blob([buf], { type: 'image/png' }), 'peeper.png');
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn('[webhook] sendDocument failed:', err.description);
      await sendMessage(chatId, '❌ Could not send file.');
    }
  } catch (e) { console.error('[webhook] PNGpeeper error:', e.message); }
}

// ── /myfamily — group render of all family peepers ───────────────────────────
async function handleMyFamily(chatId, fromUserId, firstName) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id=?').get(String(fromUserId));
  if (!user) { await sendMessage(chatId, `You don't have an account yet 🐸`); return; }

  const family = db.prepare(`
    SELECT f.* FROM families f
    JOIN family_members fm ON fm.family_id = f.id
    WHERE fm.user_id = ?
  `).get(user.id);

  if (!family) {
    await sendMessage(
      chatId,
      `You're not in a family yet! Create or join one in the app \u{1F468}\u200D\u{1F469}\u200D\u{1F467}`,
      { inline_keyboard: [[openAppButton('\u{1F438} Open Peeper', chatId)]] },
    );
    return;
  }

  if (!family) {
    await sendMessage(chatId, `You're not in a family yet! Create or join one in the app 👨‍👩‍👧`,
      { inline_keyboard: [[openAppButton('🐸 Open Peeper', chatId)]] });
    return;
  }

  // Get all members: founder first, rest sorted by coins_spent desc
  const members = db.prepare(`
    SELECT u.id, u.first_name, fm.joined_at,
           p.slot_head, p.slot_body, p.slot_hands, p.slot_fren, p.slot_face, p.alive,
           COALESCE(gs.coins_spent, 0) AS coins_spent
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    LEFT JOIN peepers p ON p.user_id = u.id
    LEFT JOIN (
      SELECT sender_id, COALESCE(SUM(gift_price),0) AS coins_spent
      FROM gifts_received GROUP BY sender_id
    ) gs ON gs.sender_id = u.id
    WHERE fm.family_id = ?
    ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END,
             COALESCE(gs.coins_spent, 0) DESC
  `).all(family.id, family.founder_id);

  if (members.length === 0) { await sendMessage(chatId, '❌ No members found.'); return; }

  let createCanvas, loadImage;
  try { ({ createCanvas, loadImage } = require('canvas')); }
  catch (e) { await sendMessage(chatId, '❌ Render unavailable.'); return; }

  // Canvas layout:
  // - members form a gentle arc (center lowest, edges slightly higher)
  // - founder drawn FIRST (behind everyone), positioned higher (70% up from arc center)
  const SPRITE   = 320;
  const HSTEP    = SPRITE * 0.37;
  const MAX_SIDE = 4;
  const W        = Math.ceil(HSTEP * MAX_SIDE * 2 + SPRITE) + 140;
  const H        = SPRITE + 360;  // tall enough for founder above + labels below

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(W/2, H*0.45, 40, W/2, H*0.45, W*0.7);
  grad.addColorStop(0, 'rgba(107,191,106,0.1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const founder = members[0];
  const rest    = members.slice(1);

  const centerX = W / 2;
  // Arc row: members sit at baseY (center lowest, edges slightly higher)
  const baseY    = H * 0.42;   // +30px lower than before
  const paraA    = 10;
  const SPACING  = HSTEP + 10; // 10px extra spacing between peepers

  // Founder stays at original height (not lowered), behind all
  const founderY = baseY - SPRITE * 0.70;
  const founderX = centerX - SPRITE / 2;

  function getMemberPos(restIdx) {
    if (restIdx === 0) return { x: centerX - SPRITE/2, y: baseY, mirror: false };
    const pair    = Math.ceil(restIdx / 2);
    const isRight = (restIdx % 2 === 0);
    const dx      = SPACING * pair * (isRight ? 1 : -1);
    const dy      = -paraA * pair * pair;
    return { x: centerX - SPRITE/2 + dx, y: baseY + dy, mirror: isRight };
  }

  // Sort rest by coins_spent desc (top spender = #2 = center)
  const restSorted = rest.slice().sort((a, b) => (b.coins_spent || 0) - (a.coins_spent || 0));

  // Draw founder FIRST (behind all)
  await renderPeeperOnto(ctx, founder, founderX, founderY, SPRITE, loadImage, false);

  // Draw arc members back-to-front (outermost first)
  for (let i = restSorted.length - 1; i >= 0; i--) {
    const pos = getMemberPos(i);
    if (!pos || !restSorted[i]) continue;
    await renderPeeperOnto(ctx, restSorted[i], pos.x, pos.y, SPRITE, loadImage, pos.mirror);
  }

  // ── Labels (drawn after all sprites) ────────────────────────────────────
  // Helper: draw label pill with ascii-safe name
  function drawLabel(name, cx, cy, color = '#ffffff', bgAlpha = 0.55) {
    const safe = (name || '?').slice(0, 14);
    ctx.font = 'bold 22px Noto, NotoEmoji, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(safe).width;
    ctx.fillStyle = `rgba(0,0,0,${bgAlpha})`;
    ctx.beginPath();
    ctx.roundRect(cx - tw/2 - 8, cy - 18, tw + 16, 26, 8);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(safe, cx, cy);
  }

  // Founder label with star crown drawn as shape
  const flx = founderX + SPRITE / 2;
  const fly  = founderY + SPRITE * 0.82;
  // Draw a simple crown shape instead of emoji
  ctx.save();
  ctx.fillStyle = '#ffd700';
  const cw = 32, ch = 20, cx0 = flx - cw/2, cy0 = fly - 38;
  ctx.beginPath();
  ctx.moveTo(cx0, cy0 + ch);
  ctx.lineTo(cx0, cy0 + 6);
  ctx.lineTo(cx0 + cw*0.25, cy0 + 12);
  ctx.lineTo(cx0 + cw*0.5,  cy0);
  ctx.lineTo(cx0 + cw*0.75, cy0 + 12);
  ctx.lineTo(cx0 + cw,      cy0 + 6);
  ctx.lineTo(cx0 + cw,      cy0 + ch);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  drawLabel(founder.first_name || '?', flx, fly, '#ffd700');

  // Member labels
  for (let idx = 0; idx < restSorted.length; idx++) {
    const pos = getMemberPos(idx);
    if (!pos || !restSorted[idx]) continue;
    const lx = pos.x + SPRITE / 2;
    const ly = pos.y + SPRITE * 0.84;
    drawLabel(restSorted[idx].first_name || '?', lx, ly);
  }

  // Family name at bottom
  ctx.font      = 'bold 32px Noto, NotoEmoji, sans-serif';
  ctx.textAlign = 'center';
  const famName = (family.name || '').slice(0, 24);
  const fnw = ctx.measureText(famName).width;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(W/2 - fnw/2 - 16, H - 52, fnw + 32, 40, 10);
  ctx.fill();
  ctx.fillStyle = '#aaffaa';
  ctx.fillText(famName, W/2, H - 22);

  const buf    = canvas.toBuffer('image/png');
  const token  = botToken();
  if (!token || token === 'dev') return;

  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', `👨‍👩‍👧 <b>${family.name}</b> family`);
    form.append('parse_mode', 'HTML');
    form.append('photo', new Blob([buf], { type: 'image/png' }), 'family.png');
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn('[webhook] myfamily photo failed:', err.description);
      await sendMessage(chatId, '❌ Could not send family picture.');
    }
  } catch (e) { console.error('[webhook] myfamily error:', e.message); }
}


// ── /together @username — render two peepers side by side ────────────────────
// /myfamily v2 - balanced family portrait with highlighted founder
async function handleMyFamilyV2(chatId, fromUserId, firstName) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id=?').get(String(fromUserId));
  if (!user) { await sendMessage(chatId, `You don't have an account yet рџђё`); return; }

  const family = db.prepare(`
    SELECT f.* FROM families f
    JOIN family_members fm ON fm.family_id = f.id
    WHERE fm.user_id = ?
  `).get(user.id);

  if (!family) {
    await sendMessage(chatId, `You're not in a family yet! Create or join one in the app рџ‘ЁвЂЌрџ‘©вЂЌрџ‘§`,
      { inline_keyboard: [[openAppButton('рџђё Open Peeper', chatId)]] });
    return;
  }

  const members = db.prepare(`
    SELECT u.id, u.first_name, fm.joined_at,
           p.slot_head, p.slot_body, p.slot_hands, p.slot_fren, p.slot_face, p.alive,
           COALESCE(gs.coins_spent, 0) AS coins_spent
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    LEFT JOIN peepers p ON p.user_id = u.id
    LEFT JOIN (
      SELECT sender_id, COALESCE(SUM(gift_price),0) AS coins_spent
      FROM gifts_received GROUP BY sender_id
    ) gs ON gs.sender_id = u.id
    WHERE fm.family_id = ?
    ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END,
             COALESCE(gs.coins_spent, 0) DESC
  `).all(family.id, family.founder_id);

  if (members.length === 0) { await sendMessage(chatId, 'вќЊ No members found.'); return; }

  let createCanvas, loadImage;
  try { ({ createCanvas, loadImage } = require('canvas')); }
  catch (e) { await sendMessage(chatId, 'вќЊ Render unavailable.'); return; }

  const W = 1500;
  const H = 1080;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#10241d');
  bg.addColorStop(0.5, '#0b1914');
  bg.addColorStop(1, '#08110d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const topGlow = ctx.createRadialGradient(W / 2, 130, 40, W / 2, 130, 620);
  topGlow.addColorStop(0, 'rgba(127,221,149,0.22)');
  topGlow.addColorStop(1, 'rgba(127,221,149,0)');
  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, W, H);

  const floorGlow = ctx.createRadialGradient(W / 2, H * 0.82, 80, W / 2, H * 0.82, W * 0.42);
  floorGlow.addColorStop(0, 'rgba(82,145,98,0.18)');
  floorGlow.addColorStop(1, 'rgba(82,145,98,0)');
  ctx.fillStyle = floorGlow;
  ctx.fillRect(0, 0, W, H);

  const founder = members[0];
  const rest = members.slice(1).sort((a, b) => (b.coins_spent || 0) - (a.coins_spent || 0));

  const founderSize = rest.length === 0 ? 400 : rest.length <= 4 ? 350 : 325;
  const founderX = Math.round(W / 2 - founderSize / 2);
  const founderY = rest.length === 0 ? 240 : 170;

  const topRowCount = Math.ceil(rest.length / 2);
  const topRow = rest.slice(0, topRowCount);
  const bottomRow = rest.slice(topRowCount);
  const topRowSize = rest.length <= 2 ? 285 : 265;
  const bottomRowSize = 225;
  const topRowY = founderY + founderSize - 4;
  const bottomRowY = topRow.length > 0 ? topRowY + topRowSize - 6 : topRowY;

  function safeName(name, max = 14) {
    return (name || '?').slice(0, max);
  }

  function drawRoundedPill(text, cx, cy, options = {}) {
    const {
      font = 'bold 24px Noto, NotoEmoji, sans-serif',
      fg = '#ffffff',
      bg = 'rgba(7,13,10,0.62)',
      paddingX = 18,
      paddingY = 10,
      radius = 18,
    } = options;

    ctx.save();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(text);
    const width = Math.ceil(metrics.width + paddingX * 2);
    const height = Math.ceil(28 + paddingY);

    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(Math.round(cx - width / 2), Math.round(cy - height / 2), width, height, radius);
    ctx.fill();

    ctx.fillStyle = fg;
    ctx.fillText(text, cx, cy + 1);
    ctx.restore();
  }

  function drawFounderBadge(name, cx, topY) {
    const crownW = 42;
    const crownH = 24;
    const crownX = cx - crownW / 2;
    const crownY = topY;

    ctx.save();
    ctx.fillStyle = '#ffd76a';
    ctx.shadowColor = 'rgba(255,215,106,0.45)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(crownX, crownY + crownH);
    ctx.lineTo(crownX, crownY + 8);
    ctx.lineTo(crownX + crownW * 0.23, crownY + 14);
    ctx.lineTo(crownX + crownW * 0.5, crownY);
    ctx.lineTo(crownX + crownW * 0.77, crownY + 14);
    ctx.lineTo(crownX + crownW, crownY + 8);
    ctx.lineTo(crownX + crownW, crownY + crownH);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    drawRoundedPill(safeName(name), cx, topY + 42, {
      font: 'bold 26px Noto, NotoEmoji, sans-serif',
      fg: '#fff2c4',
      bg: 'rgba(100,71,13,0.72)',
      paddingX: 22,
      paddingY: 12,
      radius: 20,
    });
  }

  function centerPriorityIndices(count) {
    const center = (count - 1) / 2;
    return [...Array(count).keys()].sort((a, b) => {
      const diff = Math.abs(a - center) - Math.abs(b - center);
      return diff !== 0 ? diff : a - b;
    });
  }

  function buildRowLayout(rowMembers, y, size) {
    if (!rowMembers.length) return [];

    const maxWidth = W - 160;
    const step = rowMembers.length === 1
      ? 0
      : Math.min(size * 0.86, maxWidth / Math.max(1, rowMembers.length - 1));
    const totalWidth = size + step * Math.max(0, rowMembers.length - 1);
    const startX = Math.round((W - totalWidth) / 2);
    const center = (rowMembers.length - 1) / 2;
    const slotPriority = centerPriorityIndices(rowMembers.length);
    const orderedSlots = new Array(rowMembers.length);

    rowMembers.forEach((member, idx) => {
      orderedSlots[slotPriority[idx]] = member;
    });

    return orderedSlots.map((member, index) => {
      const offset = Math.abs(index - center);
      const x = Math.round(startX + index * step);
      return {
        member,
        x,
        y: Math.round(y + offset * 14),
        size,
        mirror: x + size / 2 > W / 2,
      };
    }).filter((entry) => entry.member);
  }

  function drawFamilyHeader() {
    drawRoundedPill(safeName(family.name, 24), W / 2, 68, {
      font: 'bold 34px Noto, NotoEmoji, sans-serif',
      fg: '#eaffea',
      bg: 'rgba(8,15,11,0.58)',
      paddingX: 28,
      paddingY: 14,
      radius: 24,
    });

    drawRoundedPill(`${members.length}/10 members`, W / 2, 116, {
      font: 'bold 18px Noto, NotoEmoji, sans-serif',
      fg: '#9fd3a9',
      bg: 'rgba(8,15,11,0.42)',
      paddingX: 16,
      paddingY: 8,
      radius: 999,
    });
  }

  function drawMemberLabel(name, cx, cy) {
    drawRoundedPill(safeName(name, 12), cx, cy, {
      font: 'bold 20px Noto, NotoEmoji, sans-serif',
      fg: '#ffffff',
      bg: 'rgba(6,10,8,0.55)',
      paddingX: 14,
      paddingY: 8,
      radius: 16,
    });
  }

  const topRowLayout = buildRowLayout(topRow, topRowY, topRowSize);
  const bottomRowLayout = buildRowLayout(bottomRow, bottomRowY, bottomRowSize);

  drawFamilyHeader();

  const founderGlow = ctx.createRadialGradient(
    founderX + founderSize / 2,
    founderY + founderSize * 0.42,
    30,
    founderX + founderSize / 2,
    founderY + founderSize * 0.42,
    founderSize * 0.95
  );
  founderGlow.addColorStop(0, 'rgba(255,220,120,0.18)');
  founderGlow.addColorStop(1, 'rgba(255,220,120,0)');
  ctx.fillStyle = founderGlow;
  ctx.fillRect(0, 0, W, H);

  for (const row of [bottomRowLayout, topRowLayout]) {
    for (const entry of row) {
      await renderPeeperOnto(ctx, entry.member, entry.x, entry.y, entry.size, loadImage, entry.mirror);
      drawMemberLabel(entry.member.first_name || '?', entry.x + entry.size / 2, entry.y + entry.size + 6);
    }
  }

  await renderPeeperOnto(ctx, founder, founderX, founderY, founderSize, loadImage, false);
  drawFounderBadge(founder.first_name || '?', founderX + founderSize / 2, founderY - 24);

  const buf = canvas.toBuffer('image/png');
  const token = botToken();
  if (!token || token === 'dev') return;

  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', `\u{1F46A} <b>${family.name}</b> family`);
    form.append('parse_mode', 'HTML');
    form.append('photo', new Blob([buf], { type: 'image/png' }), 'family.png');
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn('[webhook] myfamily photo failed:', err.description);
      await sendMessage(chatId, '\u274C Could not send family picture.');
    }
  } catch (e) { console.error('[webhook] myfamily error:', e.message); }
}

// /together - render two peepers side by side
async function handleTogether(chatId, fromUserId, firstName, targetUser, targetLabel) {
  if (!targetUser) {
    await sendMessage(chatId, `Usage: /together @username, /together <mention>, or reply /together\n${targetLabel ? `${targetLabel} hasn't joined Peeper yet 🥲` : 'Example: /together @friend_name'}`);
    return;
  }

  const userA = db.prepare('SELECT * FROM users WHERE telegram_id=?').get(String(fromUserId));
  const userB = targetUser;

  if (!userA) {
    await sendMessage(chatId, `You don't have a Peeper yet! Open the app first 🐸`);
    return;
  }
  if (userA.id === userB.id) {
    await sendMessage(chatId, `You can't take a photo with yourself! 🐸`);
    return;
  }

  const peeperA = db.prepare('SELECT * FROM peepers WHERE user_id=?').get(userA.id);
  const peeperB = db.prepare('SELECT * FROM peepers WHERE user_id=?').get(userB.id);

  if (!peeperA || !peeperB) {
    await sendMessage(chatId, `One of you doesn't have a Peeper yet 😢`);
    return;
  }

  let createCanvas, loadImage;
  try { ({ createCanvas, loadImage } = require('canvas')); }
  catch (e) { await sendMessage(chatId, '❌ Render unavailable.'); return; }

  // Canvas: two peepers side by side, same style as /mypeeper
  const SPRITE = CANVAS_SIZE; // 500px each
  const PAD    = 40;
  const W      = SPRITE * 2 + PAD * 3;
  const H      = SPRITE + PAD * 2;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Background — same warm style as /mypeeper
  ctx.fillStyle = '#FDF8F2';
  ctx.fillRect(0, 0, W, H);
  const vignette = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, W*0.7);
  vignette.addColorStop(0, 'rgba(255,235,200,0)');
  vignette.addColorStop(1, 'rgba(220,180,120,0.12)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  // Draw peeper A on the left (normal)
  await renderPeeperOnto(ctx, peeperA, PAD, PAD, SPRITE, loadImage, false);

  // Draw peeper B on the right (mirrored — faces left toward A)
  await renderPeeperOnto(ctx, peeperB, PAD * 2 + SPRITE, PAD, SPRITE, loadImage, true);

  // Name labels
  ctx.font      = 'bold 28px Noto, NotoEmoji, sans-serif';
  ctx.textAlign = 'center';

  // Left name
  const nameA = (userA.first_name || firstName || '?').slice(0, 14);
  const twA   = ctx.measureText(nameA).width;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(PAD + SPRITE/2 - twA/2 - 8, PAD + SPRITE - 44, twA + 16, 34);
  ctx.fillStyle = '#fff';
  ctx.fillText(nameA, PAD + SPRITE/2, PAD + SPRITE - 16);

  // Right name
  const nameB = (userB.first_name || userB.username || targetLabel || '?').slice(0, 14);
  const twB   = ctx.measureText(nameB).width;
  const bx    = PAD * 2 + SPRITE + SPRITE/2;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(bx - twB/2 - 8, PAD + SPRITE - 44, twB + 16, 34);
  ctx.fillStyle = '#fff';
  ctx.fillText(nameB, bx, PAD + SPRITE - 16);

  // Red geometric heart between peepers
  {
    const hx = W / 2, hy = H / 2, hs = 42;
    ctx.save();
    ctx.fillStyle = '#e74c3c';
    ctx.shadowColor = 'rgba(231,76,60,0.5)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(hx, hy + hs * 0.5);
    ctx.bezierCurveTo(hx - hs * 0.1, hy + hs * 0.25, hx - hs, hy + hs * 0.1, hx - hs, hy - hs * 0.25);
    ctx.bezierCurveTo(hx - hs, hy - hs * 0.7, hx, hy - hs * 0.65, hx, hy - hs * 0.2);
    ctx.bezierCurveTo(hx, hy - hs * 0.65, hx + hs, hy - hs * 0.7, hx + hs, hy - hs * 0.25);
    ctx.bezierCurveTo(hx + hs, hy + hs * 0.1, hx + hs * 0.1, hy + hs * 0.25, hx, hy + hs * 0.5);
    ctx.fill();
    ctx.restore();
  }

  const buf   = canvas.toBuffer('image/png');
  const token = botToken();
  if (!token || token === 'dev') return;

  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', `🐸 ${nameA} & ${nameB}`);
    form.append('photo', new Blob([buf], { type: 'image/png' }), 'together.png');
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn('[webhook] together failed:', err.description);
      await sendMessage(chatId, '❌ Could not render photo.');
    }
  } catch (e) { console.error('[webhook] together error:', e.message); }
}

// ── Command handlers ─────────────────────────────────────────────────────────

async function handleStart(chatId) {
  await sendMessage(chatId,
    `Henlo! 🐸\n\nLet's start care your own Peeper!`,
    { inline_keyboard: [[openAppButton('🐸 Play', chatId)]] }
  );
}

async function handlePaySupport(chatId) {
  await sendMessage(
    chatId,
    [
      '<b>Payment Support</b>',
      '',
      'If you have any issue with a Telegram Stars payment in Peeper, please contact us in the group:',
      '<a href="https://t.me/peeperupdates">https://t.me/peeperupdates</a>',
      '',
      'Include:',
      '• your Telegram ID',
      '• payment time',
      '• what happened',
      '• screenshot of the receipt if possible',
      '',
      'We will review payment issues and refunds manually.',
    ].join('\n'),
    { inline_keyboard: [[{ text: 'Open Support Group', url: 'https://t.me/peeperupdates' }]] },
  );
}

async function handleMyPeeper(chatId, fromUserId, firstName) {
  const user   = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(fromUserId));
  const peeper = user ? db.prepare('SELECT * FROM peepers WHERE user_id = ?').get(user.id) : null;

  if (!user || !peeper) {
    await sendMessage(chatId,
      `Hey ${firstName || 'there'}! 👋\n\nYou don't have a Peeper yet — come join and get your own frog! 🐸`,
      { inline_keyboard: [[openAppButton('🐸 Get my Peeper', chatId)]] }
    );
    return;
  }

  const live           = liveStats(peeper);
  const peeperWithLive = { ...peeper, ...live };

  const ageSeconds = Math.floor(Date.now() / 1000) - peeper.born_at;
  const ageDays    = Math.floor(ageSeconds / 86400);
  const ageHours   = Math.floor((ageSeconds % 86400) / 3600);

  const statusLine = live.alive
    ? `❤️ HP: ${Math.round(live.hp)}%  🍃 Hunger: ${Math.round(live.hunger)}%  🎈 Fun: ${Math.round(live.fun)}%`
    : `💀 <i>Passed away</i>`;

  const caption = [
    `🐸 <b>${firstName || user.first_name}'s Peeper</b>`,
    `🌱 Age: ${ageDays}d ${ageHours}h`,
    statusLine,
  ].join('\n');

  const markup = { inline_keyboard: [[openAppButton('🐸 Open Peeper', chatId)]] };

  // Try to render and send as photo
  console.log('[webhook] rendering peeper for', fromUserId);
  const imgBuf = await renderPeeper(peeperWithLive);

  if (imgBuf) {
    const sent = await sendPhoto(chatId, imgBuf, caption, markup);
    if (sent) return; // success
  }

  // Fallback: text message
  console.log('[webhook] falling back to text for', fromUserId);
  await sendMessage(chatId, caption, markup);
}

async function handleMyHome(chatId, fromUserId, firstName) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(fromUserId));
  const peeper = user ? db.prepare('SELECT * FROM peepers WHERE user_id = ?').get(user.id) : null;

  if (!user || !peeper) {
    await sendMessage(chatId,
      `Hey ${firstName || 'there'}! 👋\n\nYou don't have a Peeper yet — come join and get your own frog! 🐸`,
      { inline_keyboard: [[openAppButton('🐸 Get my Peeper', chatId)]] }
    );
    return;
  }

  const homeState = getFullHomeState(user.id);
  if (!homeState?.home?.owned) {
    await sendMessage(chatId,
      `🏠 <b>You don't have a Personal Home yet.</b>\n\nOpen the app, buy your home, and start decorating it.`,
      { inline_keyboard: [[openAppButton('🏠 Open Peeper', chatId)]] }
    );
    return;
  }

  const live = liveStats(peeper);
  const peeperWithLive = { ...peeper, ...live };
  const caption = [
    `🏠 <b>${firstName || user.first_name}'s Home</b>`,
    live.alive ? 'A cozy place for your Peeper.' : '<i>Your Peeper is resting here...</i>',
  ].join('\n');
  const markup = { inline_keyboard: [[openAppButton('🏠 Open Personal Home', chatId)]] };

  console.log('[webhook] rendering home for', fromUserId);
  const imgBuf = await renderHomeScene(homeState.home, peeperWithLive);

  if (imgBuf) {
    const sent = await sendPhoto(chatId, imgBuf, caption, markup);
    if (sent) return;
  }

  console.log('[webhook] falling back to text home response for', fromUserId);
  await sendMessage(chatId, caption, markup);
}

// ── Route ────────────────────────────────────────────────────────────────────

async function handleVisitHome(chatId, fromUserId, firstName, owner, targetLabel) {
  if (!owner) {
    await sendMessage(chatId, targetLabel
      ? `${targetLabel} has not joined Peeper yet.`
      : 'Usage: /visit @username, /visit <mention>, or reply /visit');
    return;
  }

  const viewer = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(fromUserId));

  if (!viewer) {
    await sendMessage(chatId,
      `Hey ${firstName || 'there'}! You need your own Peeper before you can visit other homes.`,
      { inline_keyboard: [[openAppButton('🐸 Open Peeper', chatId)]] }
    );
    return;
  }

  if (viewer.id === owner.id) {
    await handleMyHome(chatId, fromUserId, firstName);
    return;
  }

  const ownerHome = getFullHomeState(owner.id);
  if (!ownerHome?.home?.owned) {
    await sendMessage(chatId, `${owner.first_name || owner.username || 'This player'} does not have a Personal Home yet.`);
    return;
  }

  const viewerPeeper = syncOwnedPeeper(viewer.id);
  const ownerPeeper = syncOwnedPeeper(owner.id);
  if (!viewerPeeper || !ownerPeeper) {
    await sendMessage(chatId, 'Could not load both Peepers for this visit.');
    return;
  }

  const caption = [
    `🏠 <b>${viewer.first_name || firstName} visiting ${owner.first_name || owner.username}'s home</b>`,
    'A cozy little visit.',
  ].join('\n');
  const markup = { inline_keyboard: [[openAppButton('🏠 Open Peeper', chatId)]] };

  const imgBuf = await renderVisitHomeScene(ownerHome.home, viewerPeeper, ownerPeeper);
  if (imgBuf) {
    const sent = await sendPhoto(chatId, imgBuf, caption, markup);
    if (sent) return;
  }

  await sendMessage(chatId, caption, markup);
}

router.post('/', express.json(), async (req, res) => {
  const auth = authorizeTelegramWebhookRequest({
    headerValue: req.get('X-Telegram-Bot-Api-Secret-Token'),
  });
  if (!auth.ok) {
    return res.sendStatus(auth.statusCode);
  }

  res.sendStatus(200); // Always respond immediately

  try {
    const update  = req.body;

    if (update?.inline_query) {
      await handleInlineQuery(update.inline_query);
      return;
    }

    if (update?.pre_checkout_query) {
      await handleSupportPreCheckout(update.pre_checkout_query);
      return;
    }

    // Handle inline button callbacks (family invites)
    if (update?.callback_query) {
      const cb = update.callback_query;
      syncUserIdentityFromTelegram(cb.from);
      if (cb.data?.startsWith('notif_toggle:')) {
        await handleNotificationSettingsCallback(cb);
        return;
      }
      if (cb.data?.startsWith('family_accept:') || cb.data?.startsWith('family_decline:')) {
        await handleFamilyInviteCallback(cb);
      }
      return;
    }

    const message = update?.message;
    if (!message) return;

    const chatId    = message.chat?.id;
    const fromId    = message.from?.id;
    const firstName = message.from?.first_name || '';
    const rawText   = (message.text || '').trim();

    syncUserIdentityFromTelegram(message.from);

    if (message.successful_payment) {
      await handleSupportSuccessfulPayment(message);
      return;
    }

    // Strip bot mention: "/mypeeper@PeeperBot" → "/mypeeper"
    const text = rawText.replace(/@[A-Za-z0-9_]*[Bb]ot\b/, '').trim();

    if (!chatId || !text) return;

    if (text === '/start' || text.startsWith('/start ')) {
      await handleStart(chatId);
    } else if (text === '/paysupport' || text.startsWith('/paysupport ')) {
      await handlePaySupport(chatId);
    } else if (text === '/mypeeper') {
      await handleMyPeeper(chatId, fromId, firstName);
    } else if (text === '/myhome') {
      await handleMyHome(chatId, fromId, firstName);
    } else if (text === '/pngpeeper') {
      await handlePNGPeeper(chatId, fromId, firstName);
    } else if (text === '/myfamily') {
      await handleMyFamilyV2(chatId, fromId, firstName);
    } else if (text === '/notifications' || text === '/settings') {
      const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(fromId));
      if (!user) {
        await sendMessage(
          chatId,
          'Open Peeper once first, then come back here and I will show your notification settings.',
          { inline_keyboard: [[openAppButton('🐸 Open Peeper', chatId)]] },
        );
        return;
      }
      await sendNotificationSettingsMenu(chatId, user);
    } else if (text.startsWith('/visit')) {
      const target = parseCommandTarget(message, '/visit');
      await handleVisitHome(chatId, fromId, firstName, resolveTargetUser(db, target), target ? buildTargetLabel(target) : '');
    } else if (text.startsWith('/together')) {
      const target = parseCommandTarget(message, '/together');
      await handleTogether(chatId, fromId, firstName, resolveTargetUser(db, target), target ? buildTargetLabel(target) : '');
    }
  } catch (e) {
    console.error('[webhook] error:', e.message, e.stack);
  }
});

module.exports = router;
