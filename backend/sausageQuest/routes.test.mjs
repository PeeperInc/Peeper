import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';

const require = createRequire(import.meta.url);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'peeper-sausage-routes-'));
process.env.PEEPER_DB_PATH = path.join(temporary, 'test.db');
process.env.NODE_ENV = 'development';
process.env.BOT_TOKEN = 'dev';
const express = require('express');
const db = require('../database');
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.use('/api/game', require('../routes/game'));
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
const headers = {
  'Content-Type': 'application/json',
  'X-Telegram-Init-Data': new URLSearchParams({ user: JSON.stringify({ id: 999991, first_name: 'Quest test' }) }).toString(),
};
const request = async (method, route, payload) => {
  const response = await fetch(base + route, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
  return { status: response.status, body: await response.json() };
};

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(temporary, { force: true, recursive: true });
});

test('authenticated routes award levels at zero energy, update login/state and safely replay finishes', async () => {
  const login = await request('POST', '/auth/login');
  assert.equal(login.status, 200);
  assert.equal(login.body.sausageQuest.remainingToday, 5);
  const userId = login.body.user.id;
  db.prepare(`UPDATE peepers SET last_played = ?, fun = 100 WHERE user_id = ?`).run(Math.floor(Date.now() / 1000), userId);
  const before = db.prepare('SELECT last_played, fun FROM peepers WHERE user_id = ?').get(userId);
  const startingCoins = login.body.user.coins;
  const level = { index: 0, seed: 12345, length: 130, hazard: .4 };
  for (let i = 0; i < 5; i++) {
    const started = await request('POST', '/game/sausage-quest/start', { requestId: `route-level-${i}`, level });
    assert.equal(started.status, 200);
    db.prepare('UPDATE sausage_quest_attempts SET started_at = started_at - 30 WHERE token = ?').run(started.body.token);
    const payload = { token: started.body.token, collected: started.body.totalSausages, total: started.body.totalSausages };
    const [finished, replay] = await Promise.all([
      request('POST', '/game/sausage-quest/finish', payload), request('POST', '/game/sausage-quest/finish', payload),
    ]);
    assert.equal(finished.status, 200);
    assert.equal(replay.status, 200);
    assert.equal(finished.body.coinsEarned, 10);
    assert.equal(replay.body.coins, startingCoins + (i + 1) * 10);
  }
  assert.deepEqual(db.prepare('SELECT last_played, fun FROM peepers WHERE user_id = ?').get(userId), before);
  const state = await request('GET', '/game/state');
  assert.equal(state.body.coins, startingCoins + 50);
  assert.equal(state.body.sausageQuest.remainingToday, 0);
  const relogin = await request('POST', '/auth/login');
  assert.equal(relogin.body.sausageQuest.completedToday, 5);
  const practice = await request('POST', '/game/sausage-quest/start', { requestId: 'route-practice', level });
  assert.equal(practice.body.token, null);
  const bypass = await request('POST', '/game/play', { gameId: 'sausage', coinsEarned: 10, gameWon: true });
  assert.equal(bypass.status, 400);
});

test('unknown and unauthenticated users cannot start or finish reward attempts', async () => {
  const missing = await fetch(base + '/game/sausage-quest/start', {
    method: 'POST', headers: { ...headers, 'X-Telegram-Init-Data': 'user=%7B%22id%22%3A777777%7D' },
    body: JSON.stringify({ requestId: 'unknown-request', level: { index: 0, seed: 1, length: 130, hazard: .4 } }),
  });
  assert.equal(missing.status, 404);
  const unauthenticated = await fetch(base + '/game/sausage-quest/finish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(unauthenticated.status, 401);
});
