import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { arcadeGesture } from "./arcade-fixtures.mjs";
const require = createRequire(import.meta.url),
  core = require("./core");
const challenge = (kind, seed) => ({
  kind,
  seed,
  version: 3,
  arcade: core.make(kind, seed),
});
for (const kind of Object.keys(core.modes))
  test(`${kind}: varied rounds are solvable with intentional input`, () => {
    for (let seed = 1; seed <= 100; seed++) {
      const c = challenge(kind, seed),
        g = arcadeGesture(c);
      assert.equal(
        core.replay(c, g, 15).passed,
        true,
        `${kind} seed ${seed}: ${JSON.stringify(core.replay(c, g, 15))}`,
      );
      assert.equal(core.replay(c, g, 0).valid, false);
    }
  });
test("arcade rejects invalid, oversized, time-reversed and accelerated input", () => {
  const c = challenge("steer", 1);
  for (const g of [
    { events: [] },
    { events: [[0, 4, 9, 0]] },
    { events: [[0, 4, 1, NaN]] },
    {
      events: [
        [400, 4, 0, 0],
        [100, 4, 1, 0],
      ],
    },
    { events: Array(257).fill([0, 4, 1, 0]) },
  ])
    assert.equal(core.replay(c, g, 20).valid, false);
  assert.equal(core.replay(c, arcadeGesture(c), 2).valid, false);
});
test("weather variants remain solvable with the same controls", () => {
  for (const weather of ["rain", "wind", "harvest"])
    for (const kind of Object.keys(core.modes))
      for (let seed = 1; seed <= 100; seed++) {
        const c = {
          kind,
          seed,
          version: 3,
          arcade: core.make(kind, seed, weather),
        };
        assert.equal(
          core.replay(c, arcadeGesture(c), 15).passed,
          true,
          `${weather} ${kind} seed ${seed}`,
        );
      }
});
test("defender cannot sweep every flying creature indiscriminately", () => {
  const c = challenge("guard", 1),
    events = [];
  for (let wave = 0; wave < 4; wave++) {
    const t = 1300 + wave * 2100;
    events.push(
      [t, 0, 0.1, 0.31],
      [t + 70, 1, 0.9, 0.31],
      [t + 90, 2, 0.9, 0.31],
    );
  }
  assert.equal(core.replay(c, { events }, 15).passed, false);
});
test("convoy requires collecting cargo and cannot pass by staying in one lane", () => {
  for (let seed = 1; seed <= 100; seed++)
    for (let lane = 0; lane < 3; lane++) {
      const c = challenge("steer", seed);
      assert.equal(
        core.replay(c, { events: [[300, 4, lane, 0]] }, 15).passed,
        false,
      );
    }
});
test("collision outcomes are identical at different render frame rates", () => {
  for (const kind of ["steer", "dodge", "forge"])
    for (const fps of [24, 30, 60, 144]) {
      const c = challenge(kind, 40),
        g = arcadeGesture(c),
        s = core.create(c);
      let event = 0;
      for (let time = 0; time < c.arcade.duration; time += 1000 / fps) {
        while (event < g.events.length && g.events[event][0] <= time)
          core.act(s, g.events[event++]);
        core.advance(s, time);
      }
      while (event < g.events.length) core.act(s, g.events[event++]);
      core.advance(s, c.arcade.duration);
      assert.deepEqual(core.grade(s), core.replay(c, g, 15));
    }
});
test("boss requires both avoiding charges and counterattacking", () => {
  const c = challenge("dodge", 7),
    g = arcadeGesture(c);
  assert.equal(
    core.replay(c, { events: g.events.filter((e) => e[1] === 4) }, 15).passed,
    false,
  );
  assert.equal(
    core.replay(
      c,
      {
        events: [
          [300, 5, 0, 0],
          [900, 5, 0, 0],
        ],
      },
      15,
    ).passed,
    false,
  );
});
test("stacking loses the actual overhang instead of awarding any tap", () => {
  const c = challenge("plane", 5),
    s = core.create(c);
  let t = 400;
  while (Math.abs(core.boardX(s, t) - s.center) < 0.27) t += 20;
  core.act(s, [t, 3, 0, 0]);
  assert.ok(s.width < 0.4);
  assert.equal(core.replay(c, { events: [[t, 3, 0, 0]] }, 15).passed, false);
});
test("pipe flow cannot cross a disconnected seam", () => {
  assert.deepEqual(core.flow([0, 0, 0, 10, 5, 10, 0, 0, 0]), [3]);
  assert.deepEqual(core.flow([0, 0, 0, 10, 10, 10, 0, 0, 0]), [3, 4, 5]);
});
test("healing rejects isolated taps and jumping across the board", () => {
  const c = challenge("rune", 1),
    s = core.create(c);
  core.act(s, [400, 0, 0.2, 0.305]);
  core.act(s, [500, 1, 0.8, 0.305]);
  core.act(s, [600, 2, 0.8, 0.305]);
  assert.equal(s.harvested, 0);
  assert.equal(s.moves, 0);
});
test("a quick continuous herb swipe collects crossed cells, but cannot skip a different herb", () => {
  const c = challenge("rune", 1),
    s = core.create(c);
  s.board = [0, 0, 0, 0, ...Array(12).fill(1)];
  core.act(s, [400, 0, 0.2, 0.305]);
  core.act(s, [450, 2, 0.8, 0.305]);
  assert.equal(s.harvested, 4);
  assert.equal(s.moves, 1);
  const blocked = core.create(c);
  blocked.board = [0, 1, 0, 0, ...Array(12).fill(1)];
  core.act(blocked, [400, 0, 0.2, 0.305]);
  core.act(blocked, [450, 2, 0.8, 0.305]);
  assert.equal(blocked.harvested, 0);
});
test("pointer cancellation clears an uncommitted herb chain without spending a brew", () => {
  const c = challenge("rune", 1),
    s = core.create(c);
  s.board = Array(16).fill(0);
  core.act(s, [400, 0, 0.2, 0.305]);
  core.act(s, [500, 1, 0.6, 0.305]);
  core.act(s, [550, 7, 0, 0]);
  assert.deepEqual(s.chain, []);
  assert.equal(s.pointer, null);
  assert.equal(s.moves, 0);
});

test("insects launch independently from both sides and below and remain reachable", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const a = core.make("guard", seed, "wind");
    assert.equal(new Set(a.items.map((i) => i.at)).size, a.items.length);
    assert.ok(new Set(a.items.map((i) => i.start[0])).size >= 3);
    assert.ok(a.items.some((i) => i.end[0] - i.start[0] > 0.3));
    assert.ok(a.items.some((i) => i.end[0] - i.start[0] < -0.3));
    for (const i of a.items) {
      assert.ok(i.at + i.life <= a.duration);
      for (let age = 0; age <= 1; age += 0.1) {
        const [x, y] = core.insect(i, i.at + age * i.life);
        assert.ok(x >= 0.06 && x <= 0.94 && y >= 0.18 && y <= 0.91);
      }
    }
  }
});

test("forge requires hot metal, six distinct forming hits, and a final quench", () => {
  const c = challenge("forge", 1),
    g = arcadeGesture(c);
  assert.equal(core.replay(c, g, 15).quality, 100);
  for (const events of [
    g.events.filter((e) => ![0, 2].includes(e[1])),
    g.events.filter((e) => e[1] !== 5),
    g.events.map((e) => (e[1] === 6 ? [e[0], 6, 0, 0] : e)),
    [[300, 5, 0, 0]],
  ])
    assert.equal(core.replay(c, { events }, 20).passed, false);
});
test("forge prevents hammer spam and interrupted holds stop heating", () => {
  const c = challenge("forge", 2),
    s = core.create(c);
  core.act(s, [300, 0, 0, 0]);
  core.act(s, [2000, 7, 0, 0]);
  const released = s.heat;
  core.advance(s, 2200);
  assert.ok(s.heat < released);
  for (const zone of [0, 1, 2]) core.act(s, [2300, 6, zone, 0]);
  assert.equal(
    s.sections.reduce((a, b) => a + b, 0),
    1,
  );
  assert.equal(s.heating, false);
});
test("forge overheating lowers quality but allows recovery", () => {
  const c = challenge("forge", 3),
    s = core.create(c);
  core.act(s, [300, 0, 0, 0]);
  core.advance(s, 3500);
  assert.equal(s.faults, 1);
  core.advance(s, 4000);
  assert.equal(s.faults, 1, "one sustained overheat is one fault");
  core.act(s, [4000, 2, 0, 0]);
  core.advance(s, 7200);
  for (let i = 0; i < 3; i++) core.act(s, [7300 + i * 400, 6, i, 0]);
  core.act(s, [8300, 0, 0, 0]);
  core.act(s, [8750, 2, 0, 0]);
  for (let i = 0; i < 3; i++) core.act(s, [8900 + i * 400, 6, i, 0]);
  core.act(s, [11200, 5, 0, 0]);
  assert.equal(core.grade(s).passed, true);
  assert.equal(core.grade(s).quality, 93);
});
