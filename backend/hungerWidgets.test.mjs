import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { Script } from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const directory = mkdtempSync(path.join(tmpdir(), 'peeper-hunger-widgets-'));
process.env.PEEPER_DB_PATH = path.join(directory, 'test.db');
process.env.BOT_TOKEN = 'dev';
const db = require('./database');
const { HUNGER_DRAIN, liveStats, FOOD_TYPES } = require('./gameLogic');
const { performCareAction } = require('./careActions');
const { FRIDGE_PLANS } = require('./fridgeState');
const { HOME_FRIDGE_DECOR_ITEM_ID } = require('./homeConstants');
const { sendHungerWidget, handleHungerWidgetQuery, HUNGER_WIDGET_HTML } = require('./hungerWidgets');

after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

let sequence = 990000;
function player({ coins = 1000, hunger = 22, fridge = false, name = 'Peeper' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const telegramId = String(++sequence);
  const id = Number(db.prepare('INSERT INTO users (telegram_id, coins) VALUES (?, ?)').run(telegramId, coins).lastInsertRowid);
  db.prepare('INSERT INTO peepers (user_id, name, hp, last_fed, last_played, fridge_owned) VALUES (?, ?, 100, ?, ?, ?)')
    .run(id, name, now - Math.round(HUNGER_DRAIN * (1 - hunger / 100)), now, Number(fridge));
  return { id, telegramId, now };
}
const balance = id => db.prepare('SELECT coins FROM users WHERE id = ?').get(id).coins;
const pet = id => db.prepare('SELECT * FROM peepers WHERE user_id = ?').get(id);
async function notification(options = {}) {
  const user = player(options), calls = [];
  const call = async (method, body) => {
    calls.push({ method, body });
    return { ok: true, result: { message_id: sequence } };
  };
  assert.equal((await sendHungerWidget(user.id, user.telegramId, { call })).ok, true);
  const sent = calls[0].body, state = JSON.parse(sent.chat_data);
  const query = (action, revision = state.r) => ({
    id: String(++sequence), from: { id: Number(user.telegramId) },
    chat: { id: Number(user.telegramId), type: 'private' }, message_id: sequenceForMessage,
    type: { type: 'data' }, data: `care:${state.n}:${action === 'refresh' ? 'refresh' : `${revision}:${action}`}`,
  });
  const sequenceForMessage = sequence;
  const ask = async (action, revision) => {
    calls.length = 0;
    await handleHungerWidgetQuery(query(action, revision), { call });
    return JSON.parse(calls.find(c => c.method === 'answerWidgetQuery').body.data);
  };
  return { user, calls, call, sent, state, query, ask };
}

test('widget is standalone, valid JavaScript and within Telegram HTML/compression limits', () => {
  assert.ok(Buffer.byteLength(HUNGER_WIDGET_HTML) <= 32768);
  assert.ok(deflateSync(HUNGER_WIDGET_HTML, { level: 9 }).length <= 4096);
  assert.ok(!HUNGER_WIDGET_HTML.includes('\u0000'));
  assert.doesNotThrow(() => new Script(HUNGER_WIDGET_HTML.match(/<script>([\s\S]*)<\/script>/)[1]));
  assert.doesNotMatch(HUNGER_WIDGET_HTML, /\b(fetch|WebSocket|XMLHttpRequest)\s*\(/);
});

test('notification contains the game food catalog, prices and both fridge plans', async () => {
  const { sent, state } = await notification({ fridge: true });
  assert.equal(sent.allow_queries, true);
  assert.equal(sent.html, HUNGER_WIDGET_HTML);
  assert.deepEqual(state.f, Object.entries(FOOD_TYPES).map(([key, food]) => [key, food.label, food.emoji, String(food.cost), food.hunger]));
  assert.deepEqual(state.fr.plans, Object.values(FRIDGE_PLANS).map(p => [p.type, String(p.days), p.cost]));
  assert.equal(state.fr.o, true);
  assert.ok(Buffer.byteLength(sent.chat_data) <= 1024);
});

test('decimal-comma Desktop parsing cannot merge meal prices with effects or fridge days with costs', async () => {
  // Reproduce tdesktop#31597: the JSON tokenizer keeps the array length,
  // but a number conversion reads the following comma/digits as decimals.
  function desktopParse(json) {
    return JSON.parse(json.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?/g, (token, offset) => {
      if (token.startsWith('"')) return token;
      const next = json.slice(offset + token.length).match(/^,(\d+)/);
      return next ? String(Number(`${token}.${next[1]}`)) : token;
    }));
  }
  assert.deepEqual(desktopParse('[1,30]'), [1.3, 30]);
  assert.deepEqual(desktopParse('[3,150]'), [3.15, 150]);
  const f = await notification({ fridge: true });
  const check = state => {
    assert.deepEqual(state.f.map(meal => meal[3]), ['1', '2', '3']);
    assert.deepEqual(state.fr.plans.map(plan => plan[1]), ['3', '7']);
    assert.deepEqual(state.f.map(meal => meal[4]), [30, 60, 100]);
  };
  check(desktopParse(f.sent.chat_data));
  await f.ask('refresh');
  check(desktopParse(f.calls.find(c => c.method === 'answerWidgetQuery').body.data).s);
  check(desktopParse(f.calls.find(c => c.method === 'editMessageWidgetData').body.chat_data));
});

test('feeding updates this message and debits once across concurrent duplicate queries', async () => {
  const f = await notification();
  const query = f.query('chicken');
  await Promise.all([
    handleHungerWidgetQuery(query, { call: f.call }),
    handleHungerWidgetQuery({ ...query, id: 'redelivery' }, { call: f.call }),
  ]);
  assert.equal(balance(f.user.id), 998);
  assert.equal(Math.round(liveStats(pet(f.user.id)).hunger), 82);
  assert.equal(db.prepare('SELECT revision FROM hunger_widgets WHERE nonce = ?').get(f.state.n).revision, 1);
  assert.ok(f.calls.some(c => c.method === 'editMessageWidgetData' && JSON.parse(c.body.chat_data).h >= 81));
  assert.ok(f.calls.some(c => c.method === 'editMessageCaption' && /has been fed/.test(c.body.caption)));
});

test('fridge can be purchased then stocked using the same game rules and decor grant', async () => {
  db.prepare("INSERT OR IGNORE INTO home_shop_items (item_id, name, slot, price) VALUES (?, 'Fridge', 'back_decor', 0)").run(HOME_FRIDGE_DECOR_ITEM_ID);
  const f = await notification();
  const bought = await f.ask('fridge_buy');
  assert.equal(bought.s.fr.o, true);
  assert.equal(bought.s.fr.a, false);
  assert.equal(bought.s.c, 500);
  assert.ok(db.prepare('SELECT 1 FROM owned_home_items WHERE user_id = ? AND item_id = ?').get(f.user.id, HOME_FRIDGE_DECOR_ITEM_ID));
  const stocked = await f.ask('fridge_stock_3d', bought.s.r);
  assert.equal(stocked.s.fr.a, true);
  assert.equal(stocked.s.h, 100);
  assert.equal(stocked.s.c, 350);
  assert.ok(Math.abs(stocked.s.fr.u - f.user.now - 3 * 86400) <= 2);
  await f.ask('fridge_stock_3d', bought.s.r);
  assert.equal(balance(f.user.id), 350);
});

test('seven-day stock costs 500 and keeps the pet full', async () => {
  const f = await notification({ fridge: true });
  const answer = await f.ask('fridge_stock_7d');
  assert.equal(answer.s.fr.a, true);
  assert.equal(answer.s.c, 500);
  assert.equal(answer.s.h, 100);
  assert.ok(Math.abs(answer.s.fr.u - f.user.now - 7 * 86400) <= 2);
});

test('stock without a fridge, poor balance and unsupported action never charge', async () => {
  const f = await notification({ coins: 0 });
  assert.match((await f.ask('fridge_stock_3d')).m, /Buy a Fridge first/);
  assert.match((await f.ask('pizza', 1)).m, /Not enough coins/);
  for (const action of ['energy_drink', 'toString', '__proto__']) {
    assert.match((await f.ask(action, 2)).m, /not supported/);
  }
  assert.equal(balance(f.user.id), 0);
  assert.equal(Math.round(liveStats(pet(f.user.id)).hunger), 22);
});

test('failed purchases cannot become successful when Telegram retries after balance increases', async () => {
  const f = await notification({ coins: 0 });
  await f.ask('pizza');
  db.prepare('UPDATE users SET coins = 100 WHERE id = ?').run(f.user.id);
  assert.match((await f.ask('pizza')).m, /updated/);
  assert.equal(balance(f.user.id), 100);
});

test('latest Mini App feeding is checked before accepting a widget purchase', async () => {
  const f = await notification();
  assert.equal(performCareAction(f.user.id, 'pizza').coinsSpent, 3);
  const answer = await f.ask('chicken');
  assert.match(answer.m, /not hungry yet/);
  assert.equal(balance(f.user.id), 997);
  assert.equal(Math.round(answer.s.h), 100);
});

test('refresh is read-only for purchases and reflects new balances and fridge state', async () => {
  const f = await notification({ fridge: true });
  performCareAction(f.user.id, 'fridge_stock_3d');
  const answer = await f.ask('refresh');
  assert.equal(answer.s.fr.a, true);
  assert.equal(answer.s.c, 850);
  assert.equal(answer.s.r, 0);
});

test('foreign sender, wrong chat, wrong message and wallet queries are rejected', async () => {
  const f = await notification();
  const base = f.query('pizza');
  const changes = [
    { from: { id: 1 } }, { chat: { id: -1, type: 'group' } },
    { message_id: base.message_id + 1 }, { type: { type: 'sent_transaction' } },
    { data: base.data.replace(f.state.n, '0000000000000000') },
  ];
  for (const change of changes) {
    f.calls.length = 0;
    await handleHungerWidgetQuery({ ...base, ...change }, { call: f.call });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, 'answerWidgetQuery');
  }
  assert.equal(balance(f.user.id), 1000);
});

test('expired notifications and deceased pets never charge', async () => {
  const f = await notification();
  await handleHungerWidgetQuery(f.query('pizza'), { call: f.call, now: f.user.now + 8 * 86400 });
  assert.equal(balance(f.user.id), 1000);
  db.prepare('UPDATE peepers SET alive = 0, hp = 0 WHERE user_id = ?').run(f.user.id);
  const answer = await f.ask('pizza');
  assert.equal(answer.s.a, false);
  assert.equal(balance(f.user.id), 1000);
});

test('long hostile names are escaped and Telegram data limits hold in answers and edits', async () => {
  const f = await notification({ name: '<b>🐸"\u0000'.repeat(100) });
  assert.doesNotMatch(f.sent.caption, /<b>🐸/);
  assert.doesNotMatch(f.sent.chat_data, /\\u0000/);
  await f.ask('apple');
  for (const { body } of f.calls) {
    if (body.data) assert.ok(Buffer.byteLength(body.data) <= 1024);
    if (body.chat_data) assert.ok(Buffer.byteLength(body.chat_data) <= 1024);
  }
});

test('failed delivery does not leave a usable widget record', async () => {
  const user = player();
  const sent = await sendHungerWidget(user.id, user.telegramId, { call: async () => ({ ok: false }) });
  assert.equal(sent.ok, false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM hunger_widgets WHERE user_id = ?').get(user.id).n, 0);
  assert.equal(balance(user.id), 1000);
});

test('full pets and mismatched recipients do not receive hunger widgets', async () => {
  const full = player({ hunger: 100 });
  let calls = 0;
  const call = async () => { calls++; return { ok: true }; };
  assert.equal((await sendHungerWidget(full.id, full.telegramId, { call })).ok, false);
  const hungry = player();
  assert.equal((await sendHungerWidget(hungry.id, full.telegramId, { call })).ok, false);
  assert.equal(calls, 0);
});

test('an administrative preview can resend a fed pet without changing its state', async () => {
  const full = player({ hunger: 100, coins: 5200, fridge: true });
  const originalPet = pet(full.id);
  let payload;
  const result = await sendHungerWidget(full.id, full.telegramId, {
    onlyIfHungry: false,
    call: async (_method, body) => { payload = body; return { ok: true, result: { message_id: 123456 } }; },
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(payload.chat_data).h, 100);
  assert.equal(balance(full.id), 5200);
  assert.equal(pet(full.id).last_fed, originalPet.last_fed);
  assert.equal(pet(full.id).fridge_food_until, originalPet.fridge_food_until);
  assert.equal((await sendHungerWidget(full.id, '1', { onlyIfHungry: false })).ok, false);
});

test('notifier preserves hunger thresholds, preferences, delivery retries and cooldowns', async () => {
  const { checkHungerNotification } = require('./notifier')._notificationInternals;
  const { toggleNotificationSetting } = require('./notificationSettings');
  const user = player();
  let calls = 0;
  const options = { userId: user.id, telegramId: user.telegramId, live: { hunger: 22 }, send: async () => { calls++; return { ok: false }; } };
  const flags = () => db.prepare('SELECT type FROM notifications_sent WHERE user_id = ? ORDER BY type').all(user.id).map(r => r.type);
  await checkHungerNotification(options);
  assert.deepEqual(flags(), []);
  options.send = async () => { calls++; return { ok: true }; };
  await checkHungerNotification(options);
  await checkHungerNotification(options);
  assert.equal(calls, 2);
  assert.deepEqual(flags(), ['hunger_30']);
  await checkHungerNotification({ ...options, live: { hunger: 0 } });
  assert.deepEqual(flags(), ['hunger_30', 'hunger_zero']);
  await checkHungerNotification({ ...options, live: { hunger: 80 } });
  assert.deepEqual(flags(), []);
  toggleNotificationSetting(user.id, 'care_notifications');
  await checkHungerNotification(options);
  assert.equal(calls, 3);
  assert.deepEqual(flags(), []);
});

test('Mini App feed endpoint retains response shape, validation and Energy Drink behavior', async () => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/game', require('./routes/game'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const user = player();
  try {
    const post = async foodType => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/game/feed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': new URLSearchParams({ user: JSON.stringify({ id: Number(user.telegramId) }) }).toString() },
        body: JSON.stringify({ foodType }),
      });
      return { status: response.status, body: await response.json() };
    };
    let response = await post('chicken');
    assert.equal(response.status, 200);
    assert.equal(response.body.coinsSpent, 2);
    assert.equal(response.body.coins, 998);
    assert.equal(Math.round(response.body.peeper.hunger), 82);
    assert.ok(response.body.fridge && response.body.farmSummary && response.body.cooldowns);
    assert.equal((await post('pizza')).status, 400);
    assert.equal((await post('__proto__')).status, 400);
    response = await post('energy_drink');
    assert.equal(response.status, 200);
    assert.equal(response.body.coinsSpent, 10);
    assert.equal(response.body.coins, 988);
    assert.equal((await post('energy_drink')).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('widget processing rolls back purchase and revision together on a database failure', async () => {
  const f = await notification();
  db.exec(`CREATE TEMP TRIGGER widget_test_abort BEFORE INSERT ON owned_home_items
    WHEN NEW.user_id = ${f.user.id} BEGIN SELECT RAISE(ABORT, 'test interruption'); END;`);
  try {
    const answer = await f.ask('fridge_buy');
    assert.match(answer.m, /Could not update/);
    assert.equal(balance(f.user.id), 1000);
    assert.equal(pet(f.user.id).fridge_owned, 0);
    assert.equal(db.prepare('SELECT revision FROM hunger_widgets WHERE nonce = ?').get(f.state.n).revision, 0);
  } finally {
    db.exec('DROP TRIGGER widget_test_abort');
  }
});

test('authenticated Telegram webhook dispatches widget queries and rejects an invalid secret', async () => {
  const express = require('express');
  const { getTelegramWebhookSecret } = require('./telegramWebhookAuth');
  const app = express();
  app.use('/webhook', require('./routes/webhook'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const f = await notification();
  const actualFetch = global.fetch;
  const telegramCalls = [];
  process.env.BOT_TOKEN = 'widget-test-token';
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.telegram.org/')) {
      telegramCalls.push({ method: String(url).split('/').at(-1), body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true, result: true }) };
    }
    return actualFetch(url, options);
  };
  try {
    const post = secret => actualFetch(`http://127.0.0.1:${server.address().port}/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
      body: JSON.stringify({ widget_query: f.query('chicken') }),
    });
    assert.equal((await post('wrong-secret')).status, 403);
    assert.equal(balance(f.user.id), 1000);
    assert.equal((await post(getTelegramWebhookSecret())).status, 200);
    // The webhook acknowledges immediately; allow the asynchronous edits to finish.
    for (let i = 0; i < 20 && telegramCalls.length < 3; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(balance(f.user.id), 998);
    assert.deepEqual(telegramCalls.map(c => c.method), ['answerWidgetQuery', 'editMessageWidgetData', 'editMessageCaption']);
  } finally {
    global.fetch = actualFetch;
    process.env.BOT_TOKEN = 'dev';
    await new Promise(resolve => server.close(resolve));
  }
});
