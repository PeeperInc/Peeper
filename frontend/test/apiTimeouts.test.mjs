import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');
const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function network(t, response) {
  const original = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const requests = [], timers = [], cleared = [];
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = timer => cleared.push(timer);
  globalThis.fetch = (url, options) => {
    const request = new Request(`http://example.test${url}`, options);
    requests.push(request);
    if (response) return Promise.resolve({ ok: true, json: async () => response });
    return new Promise((resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  };
  t.after(() => Object.assign(globalThis, original));
  return { requests, timers, cleared };
}

test('Frontier and Sausage Quest requests share valid AbortSignals and clear their independent deadlines', async t => {
  const payload = { coins: 105, sausageQuest: { dayKey: 20381 } };
  const n = network(t, payload);
  assert.deepEqual(await api.frontierState(), payload);
  assert.deepEqual(await api.startSausageQuestLevel({ levelId: 1 }), payload);
  assert.deepEqual(n.requests.map(r => new URL(r.url).pathname), ['/api/frontier/state', '/api/game/sausage-quest/start']);
  assert.deepEqual(n.timers.map(r => r.delay), [15000, 10000]);
  assert.deepEqual(n.cleared, n.timers);
  assert.ok(n.requests.every(r => !r.signal.aborted));
});

test('a stalled Frontier request aborts with a recoverable connection error', async t => {
  const n = network(t);
  const pending = api.frontierState();
  n.timers[0].callback();
  await assert.rejects(pending, error => /Connection interrupted/.test(error.message));
  assert.equal(n.requests[0].signal.aborted, true);
  assert.deepEqual(n.cleared, n.timers);
});

test('a stalled Sausage Quest reward request still aborts and can be retried', async t => {
  const n = network(t);
  const pending = api.finishSausageQuestLevel({ requestId: 'retryable-level' });
  n.timers[0].callback();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(n.requests[0].signal.aborted, true);
  assert.deepEqual(n.cleared, n.timers);
});
