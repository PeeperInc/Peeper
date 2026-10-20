import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Exercise both existing status entry points without opening the application DB.
for (const file of ['familyFeastState.js', 'routes/family.js']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = source.indexOf('function getBigFeastStatus(');
  const end = source.indexOf('\n}', start) + 2;
  const now = 1_788_724_117;
  const week = 7 * 24 * 3600;
  function status(lastUse, at = now) {
    const context = vm.createContext({
      db: { prepare: () => ({ get: () => lastUse }) },
      BIG_FEAST_COST: 100,
      BIG_FEAST_COOLDOWN: week,
      ts: () => at,
    });
    vm.runInContext(source.slice(start, end), context);
    return context.getBigFeastStatus(1495, at);
  }

  test(`${file}: ready feast stays available with a slow client clock and repeated refreshes`, () => {
    for (const lastUse of [undefined, { used_at: 1_787_993_941 }, { used_at: now - week }]) {
      for (const elapsed of [0, 60, 86400]) {
        const result = status(lastUse, now + elapsed);
        assert.equal(result.available, true);
        assert.equal(result.cooldown_seconds, 0);
        assert.equal(result.available_at, 0);
        const clientNow = now + elapsed - 90;
        // Compatibility with the deployed UI's deadline-or-now fallback.
        assert.equal(Math.max(0, (result.available_at || clientNow) - clientNow), 0);
      }
    }
  });

  test(`${file}: real cooldown is retained until its exact deadline`, () => {
    const lastUse = { used_at: now - week + 60 };
    const pending = status(lastUse);
    assert.equal(pending.available, false);
    assert.equal(pending.available_at, now + 60);
    assert.equal(pending.cooldown_seconds, 60);
    assert.equal(status(lastUse, now + 59).available, false);
    assert.equal(status(lastUse, now + 60).available, true);
  });
}
