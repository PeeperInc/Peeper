const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const db = require('./database');
const { FOOD_TYPES, liveStats } = require('./gameLogic');
const { getFridgeState } = require('./fridgeState');
const { syncPeeperRow, ts } = require('./peeperState');
const { isCareAction, performCareAction } = require('./careActions');

const HUNGER_WIDGET_HTML = fs.readFileSync(path.join(__dirname, 'widgets', 'hunger.html'), 'utf8');
const WIDGET_TTL = 7 * 86400;
const APP_URL = 'https://peeper.frenzyradio.online';

db.exec(`
  CREATE TABLE IF NOT EXISTS hunger_widgets (
    nonce TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL,
    message_id INTEGER,
    revision INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS hunger_widgets_expiry ON hunger_widgets(expires_at);
`);

function shortText(value, bytes = 160) {
  let result = '';
  for (const char of String(value || '').replace(/[\u0000-\u001f]/g, ' ')) {
    if (Buffer.byteLength(result + char) > bytes) break;
    result += char;
  }
  return result;
}

async function callTelegram(method, body, token = process.env.BOT_TOKEN) {
  if (!token || token === 'dev') return { ok: false };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      const code = Number(result.error_code || response.status);
      // Repeating the same state edit is success, including after a delivery retry.
      if (method.startsWith('edit') && /message is not modified/i.test(result.description || '')) return { ok: true };
      if (code !== 403) console.warn(`[hunger-widget] ${method} rejected:`, code);
      return { ok: false, permanent: [400, 403, 404].includes(code),
        ...(code === 429 ? { retryAfter: Math.max(1, Number(result.parameters?.retry_after) || 60) } : {}) };
    }
    return result;
  } catch {
    console.warn(`[hunger-widget] ${method} delivery interrupted`);
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

function snapshot(row, now = ts()) {
  const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(row.user_id);
  const peeper = syncPeeperRow(row.user_id, now);
  const stats = peeper ? liveStats(peeper, now) : { alive: false, hunger: 0, hp: 0 };
  const fridge = getFridgeState(peeper, now);
  return {
    n: row.nonce, r: row.revision, t: now,
    name: shortText(Array.from(peeper?.name || 'Peeper').slice(0, 24).join(''), 96),
    c: user?.coins || 0, a: stats.alive, h: stats.hunger, p: stats.hp,
    f: Object.entries(FOOD_TYPES).map(([type, food]) => [type, food.label, food.emoji, food.cost, food.hunger]),
    fr: { o: fridge.owned, a: fridge.active, u: fridge.foodUntil, c: fridge.purchaseCost,
      plans: fridge.plans.map(plan => [plan.type, plan.days, plan.cost]) },
  };
}

const escapeHtml = (value) => value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
function caption(state) {
  const name = escapeHtml(state.name);
  if (!state.a) return `🐸 <b>${name}</b> needs you. Open Peeper to check on your pet.`;
  const status = state.h <= 0 ? 'is starving!' : state.h <= 30 ? 'is getting hungry!' : 'has been fed.';
  return `🍽 <b>${name} ${status}</b>\nHunger: ${Math.round(state.h)}% · HP: ${Math.round(state.p)}% · Balance: ${state.c} ✦\n${state.h <= 0 ? 'HP is draining! Feed your Peeper or stock your Fridge below.' : state.h <= 70 ? 'Feed your Peeper or stock your Fridge below.' : state.fr.a ? 'Your Fridge is stocked.' : 'Your Peeper is not hungry yet.'}`;
}

async function sendHungerWidget(userId, telegramId, { token, call = callTelegram, now = ts() } = {}) {
  const user = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(userId);
  if (!user || String(user.telegram_id) !== String(telegramId)) return { ok: false };
  db.prepare('DELETE FROM hunger_widgets WHERE expires_at <= ?').run(now);
  const row = { nonce: randomBytes(8).toString('hex'), user_id: userId, chat_id: String(telegramId), revision: 0, expires_at: now + WIDGET_TTL };
  const state = snapshot(row, now);
  if (!state.a || state.h > 30) return { ok: false };
  db.prepare('INSERT INTO hunger_widgets (nonce, user_id, chat_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(row.nonce, userId, row.chat_id, row.expires_at);
  let result;
  try {
    result = await call('sendWidget', {
      chat_id: telegramId, html: HUNGER_WIDGET_HTML, allow_queries: true,
      chat_data: JSON.stringify(state), caption: caption(state), parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🐸 Open Peeper', web_app: { url: APP_URL }, style: 'success' }]] },
    }, token);
  } catch {
    result = { ok: false };
  }
  if (!result.ok || !Number.isSafeInteger(result.result?.message_id)) {
    db.prepare('DELETE FROM hunger_widgets WHERE nonce = ?').run(row.nonce);
    return { ...result, ok: false };
  }
  db.prepare('UPDATE hunger_widgets SET message_id = ? WHERE nonce = ?').run(result.result.message_id, row.nonce);
  return { ok: true };
}

// The message revision is a one-use purchase token. A double tap, Telegram
// redelivery or a delayed response cannot spend again with the old revision.
const processQuery = db.transaction((query, now) => {
  const match = typeof query.data === 'string' && query.data.match(/^care:([a-f0-9]{16}):(?:refresh|(\d+):([a-z0-9_]+))$/);
  if (!match || Buffer.byteLength(query.data) > 64 || query.type?.type !== 'data') {
    return { m: 'This action is not supported.' };
  }
  const row = db.prepare('SELECT * FROM hunger_widgets WHERE nonce = ?').get(match[1]);
  if (!row || row.expires_at <= now) return { m: 'This notification has expired. Open Peeper.', x: true };
  const owner = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(row.user_id);
  if (query.chat?.type !== 'private' || String(query.from?.id) !== row.chat_id
    || String(query.chat.id) !== row.chat_id || query.message_id !== row.message_id
    || String(owner?.telegram_id) !== row.chat_id) {
    return { m: 'Use your own notification in the private chat with Peeper.', x: true };
  }
  if (!match[2]) return { s: snapshot(row, now), row };
  const action = match[3];
  if (!isCareAction(action)) return { s: snapshot(row, now), m: 'This action is not supported.', row };
  if (Number(match[2]) !== row.revision) {
    return { s: snapshot(row, now), m: 'This menu has been updated. Please choose again.', row };
  }
  const result = performCareAction(row.user_id, action);
  // Consume failed attempts too: a retried insufficient-balance request must
  // never turn into an unexpected purchase after the player earns more coins.
  db.prepare('UPDATE hunger_widgets SET revision = revision + 1 WHERE nonce = ?').run(row.nonce);
  row.revision += 1;
  const state = snapshot(row, now);
  let message = result.error || result.message;
  if (result.error && Object.hasOwn(FOOD_TYPES, action) && state.a && state.h > 70) {
    message = `Your Peeper is not hungry yet! (${Math.round(state.h)}%)`;
  } else if (!result.error && Object.hasOwn(FOOD_TYPES, action)) {
    message = `${FOOD_TYPES[action].emoji} Yum! Your Peeper enjoyed the ${FOOD_TYPES[action].label}!`;
  } else if (!result.error && action === 'fridge_buy') {
    message = 'Fridge purchased! Choose a food stock plan.';
  }
  return { s: state, m: shortText(message), row };
});

async function handleHungerWidgetQuery(query, { token, call = callTelegram, now = ts() } = {}) {
  let outcome;
  try {
    outcome = processQuery(query, now);
  } catch {
    console.warn('[hunger-widget] action failed');
    outcome = { m: 'Could not update your Peeper. Please refresh.' };
  }
  const { row, ...answer } = outcome;
  // Keep captions/names out of HTML code and bound all Telegram JSON fields.
  while (Buffer.byteLength(JSON.stringify(answer)) > 1024 && answer.m) answer.m = answer.m.slice(0, -1);
  await call('answerWidgetQuery', { widget_query_id: query.id, data: JSON.stringify(answer) }, token);
  if (row && answer.s) {
    await call('editMessageWidgetData', { chat_id: row.chat_id, message_id: row.message_id, chat_data: JSON.stringify(answer.s) }, token);
    await call('editMessageCaption', { chat_id: row.chat_id, message_id: row.message_id, caption: caption(answer.s), parse_mode: 'HTML' }, token);
  }
}

module.exports = { HUNGER_WIDGET_HTML, sendHungerWidget, handleHungerWidgetQuery };
