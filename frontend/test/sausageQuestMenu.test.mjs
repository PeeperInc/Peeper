import assert from 'node:assert/strict';
import test from 'node:test';
import { orderSausageQuestGames } from '../src/games/sausageQuestMenu.mjs';

const games = [
  { id: 'sausage', energy: 0 }, { id: 'adrian', energy: 1 }, { id: 'arena', energy: 0 },
  { id: 'sniper', energy: 1 }, { id: 'flappy', energy: 1 }, { id: 'blackjack', energy: 0 },
];
const ids = list => list.map(game => game.id);

test('available daily rewards put Sausage Quest first in Games and exclude it from Free', () => {
  const ordered = orderSausageQuestGames(games, { remainingToday: 1 }, 'energy');
  assert.equal(ordered[0].id, 'sausage');
  assert.equal(ordered.filter(game => game.id === 'sausage').length, 1);
  assert.deepEqual(ids(orderSausageQuestGames(games, { remainingToday: 1 }, 'free')), ['arena', 'blackjack']);
});

test('after five rewards Sausage Quest sits immediately below Sniper in Games and stays excluded from Free', () => {
  assert.deepEqual(ids(orderSausageQuestGames(games, { remainingToday: 0 }, 'energy')), ['adrian', 'sniper', 'sausage', 'flappy']);
  assert.deepEqual(ids(orderSausageQuestGames(games, { remainingToday: 0 }, 'free')), ['arena', 'blackjack']);
});
