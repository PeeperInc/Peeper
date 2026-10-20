import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { arcadeGesture } from "./arcade-fixtures.mjs";
const require = createRequire(import.meta.url),
  core = require("./core"),
  { makeChallenge, inspect } = require("./gestures");
const challenge = (kind, seed = 42) => ({
  kind,
  seed,
  version: 3,
  arcade: core.make(kind, seed),
});
function hit(s, node, start, power = 0.75) {
  core.act(s, [start, 6, node, 0]);
  core.act(s, [start + 10, 0, 0, 0]);
  core.act(s, [start + 10 + power * 1000, 2, 0, 0]);
}
test("timber varies its readable release window; constant holds and ore spam lose to deliberate timing", () => {
  const c = challenge("split"),
    s = core.create(c);
  assert.ok(new Set(c.arcade.windows.map((w) => w[0])).size > 1);
  for (let i = 0; i < 9 && !s.done; i++)
    hit(s, c.arcade.notches[s.cutsMade], 300 + i * 1200, 0.65);
  core.advance(s, 15000);
  assert.equal(core.grade(s).passed, false);
  assert.equal(core.replay(c, arcadeGesture(c), 15).passed, true);
  const q = challenge("chip"),
    spam = core.create(q);
  for (let t = 400; t < 15000 && !spam.done; t += 400)
    core.act(spam, [t, 6, q.arcade.order[spam.oreFound], 0]);
  assert.equal(core.grade(spam).passed, false);
  assert.equal(core.replay(q, arcadeGesture(q), 15).passed, true);
});
test("new smith recipes need three actual reheats; toggling bellows cannot reset the two-strike batch", () => {
  const c = challenge("smith"),
    s = core.create(c);
  core.act(s, [100, 0, 0, 0]);
  core.act(s, [2100, 2, 0, 0]);
  for (let i = 0; i < 6; i++)
    core.act(s, [
      2400 + i * 400,
      6,
      c.arcade.recipe.order[s.sections.reduce((n, v) => n + v, 0)],
      0,
    ]);
  assert.equal(
    s.sections.reduce((n, v) => n + v, 0),
    2,
  );
  core.act(s, [5000, 0, 0, 0]);
  core.act(s, [5001, 2, 0, 0]);
  core.act(s, [5100, 6, c.arcade.recipe.order[2], 0]);
  assert.equal(
    s.sections.reduce((n, v) => n + v, 0),
    2,
  );
  assert.equal(core.replay(c, arcadeGesture(c), 20).passed, true);
});
test("match-three exposes ordered swap, match and gravity frames ending on its authoritative board", () => {
  const c = challenge("brew"),
    s = core.create(c),
    [from, to] = core.match3Moves(s.board)[0];
  assert.equal(core.swapMatch3(s, from, to), true);
  const frames = s.matchAnimation.frames;
  assert.equal(frames[0].type, "swap");
  assert.equal(frames[1].type, "pop");
  assert.equal(frames[2].type, "fall");
  assert.ok(frames[1].cells.length >= 3);
  assert.ok(frames[2].falls.some((n) => n > 0));
  assert.deepEqual(frames.at(-1).board, s.board);
});
test("new work challenges use authoritative replay, legacy gestures remain readable", () => {
  for (const kind of ["fell", "excavate"]) {
    const c = makeChallenge(kind, 100);
    assert.ok(c.arcade);
    assert.equal(inspect(c, arcadeGesture(c), 15).passed, true);
    assert.equal(inspect(c, arcadeGesture(c), 0.1).valid, false);
    assert.equal(inspect(c, { quality: 100, events: [] }, 15).valid, false);
  }
  assert.ok(makeChallenge("saw", 100).strokes);
  assert.ok(makeChallenge("mine", 100).points);
});
test("logging rejects wrong side, spam, overcharging and idle input", () => {
  for (const error of ["wrong-side", "spam", "overcharge", "idle"]) {
    const c = challenge("fell"),
      s = core.create(c);
    if (error !== "idle")
      for (let i = 0; i < 8; i++)
        hit(
          s,
          error === "wrong-side"
            ? 1 - c.arcade.notches[0]
            : c.arcade.notches[s.cutsMade],
          400 + i * 1400,
          error === "spam" ? 0.06 : error === "overcharge" ? 1.2 : 0.7,
        );
    core.advance(s, 15000);
    assert.equal(core.grade(s).passed, false, error);
  }
});
test("rest recovers logging stamina; cancel never grants a free cut", () => {
  const c = challenge("fell"),
    s = core.create(c);
  hit(s, c.arcade.notches[0], 400);
  const stamina = s.stamina;
  core.advance(s, 2600);
  assert.ok(s.stamina > stamina);
  core.act(s, [2700, 0, 0, 0]);
  core.act(s, [3400, 7, 0, 0]);
  core.act(s, [3500, 2, 0, 0]);
  assert.equal(s.cutsMade, 1);
});
test("mining without supports collapses; support choice permits extraction", () => {
  const c = challenge("excavate"),
    unsafe = core.create(c),
    safe = core.create(c),
    ore = c.arcade.nodes
      .map((n, i) => (n === "ore" ? i : -1))
      .filter((i) => i >= 0),
    brace = c.arcade.nodes.indexOf("brace");
  ore.forEach((i, n) => hit(unsafe, i, 400 + n * 1400));
  assert.equal(unsafe.stress, 1);
  assert.equal(core.grade(unsafe).passed, false);
  hit(safe, brace, 400);
  ore.forEach((i, n) => hit(safe, i, 1800 + n * 1400));
  assert.equal(core.grade(safe).passed, true);
  assert.equal(safe.oreFound, 3);
});
test("light hits require two swings and cause less strain than charged hits", () => {
  const c = challenge("excavate"),
    light = core.create(c),
    heavy = core.create(c),
    i = c.arcade.nodes.indexOf("ore");
  hit(light, i, 400, 0.48);
  hit(heavy, i, 400, 0.75);
  assert.equal(light.rockHP[i], 1);
  assert.equal(light.oreFound, 0);
  assert.equal(heavy.oreFound, 1);
  assert.ok(light.stress < heavy.stress);
  hit(light, i, 1800, 0.48);
  assert.equal(light.oreFound, 1);
});
test("cleared pockets cannot be farmed and shale is not iron", () => {
  const c = challenge("excavate"),
    s = core.create(c),
    brace = c.arcade.nodes.indexOf("brace"),
    shale = c.arcade.nodes.indexOf("brittle");
  hit(s, brace, 400);
  hit(s, brace, 1800);
  assert.equal(s.braced, 1);
  const before = s.stress;
  hit(s, shale, 3200);
  assert.ok(s.stress > before);
  assert.equal(s.oreFound, 0);
});
test("fieldwork replays identically at 24, 60 and 144 fps", () => {
  for (const kind of ["fell", "excavate"])
    for (const fps of [24, 60, 144]) {
      const c = challenge(kind),
        record = arcadeGesture(c),
        s = core.create(c);
      let i = 0;
      for (let t = 0; t <= 15000; t += 1000 / fps) {
        while (i < record.events.length && record.events[i][0] <= t)
          core.act(s, record.events[i++]);
        core.advance(s, t);
      }
      while (i < record.events.length) core.act(s, record.events[i++]);
      core.advance(s, 15000);
      assert.deepEqual(core.grade(s), core.replay(c, record, 15));
    }
});
test("bracing protects cargo through a sharp turn and cancel releases the brace", () => {
  const c = challenge("steer"),
    unbraced = core.create(c),
    braced = core.create(c);
  for (const s of [unbraced, braced]) {
    core.act(s, [0, 4, 0, 0]);
    core.advance(s, 600);
  }
  core.act(braced, [650, 0, 0, 0]);
  for (const s of [unbraced, braced]) {
    core.act(s, [700, 4, 2, 0]);
    core.advance(s, 1400);
  }
  assert.ok(unbraced.health < braced.health);
  assert.ok(Math.abs(braced.balance) < Math.abs(unbraced.balance));
  core.act(braced, [1450, 7, 0, 0]);
  assert.equal(braced.bracing, false);
});
test("weather never changes a generated activity", () => {
  for (const kind of Object.keys(core.modes))
    for (const weather of ["rain", "wind", "harvest"])
      assert.deepEqual(
        core.make(kind, 91, weather),
        core.make(kind, 91, "clear"),
      );
});
test("touch quarry has no support or roof mechanic; wrong cracks never earn iron", () => {
  const c = challenge("chip"),
    s = core.create(c);
  assert.ok(c.arcade.nodes.every((n) => n === "ore"));
  for (let i = 0; i < 12; i++)
    core.act(s, [400 + i * 500, 6, (c.arcade.order[0] + 1) % 3, 0]);
  assert.equal(s.oreFound, 0);
  assert.equal(core.grade(s).passed, false);
});
test("carpentry needs the marked cut, grain pass and all nails", () => {
  const c = challenge("board"),
    s = core.create(c);
  for (let i = 0; i < 4; i++) core.act(s, [400 + i * 500, 6, i, 0]);
  assert.equal(core.grade(s).passed, false);
  core.act(s, [2600, 0, 0.05, 0.2]);
  core.act(s, [3400, 2, 0.05, 0.8]);
  assert.equal(s.carpentryStep, 0);
  assert.equal(core.replay(c, arcadeGesture(c), 15).passed, true);
});
test("true match three requires adjacent swaps and completing every recipe jar", () => {
  const c = challenge("brew"),
    s = core.create(c),
    before = s.board.slice();
  core.swapMatch3(s, 0, 24);
  assert.deepEqual(s.board, before);
  assert.equal(s.moves, 0);
  s.collected = [99, 0, 0, 0];
  assert.equal(core.grade(s).passed, false);
  for (let seed = 1; seed < 30; seed++) {
    const q = challenge("brew", seed);
    assert.equal(core.match3Matches(q.arcade.board).length, 0);
    assert.ok(core.match3Moves(q.arcade.board).length > 0);
  }
});

test("kit match-three varies three supply orders and accepts planned swaps with cascades", () => {
  const recipes = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const c = challenge("provision", seed);
    assert.equal(c.arcade.mode, "match3");
    assert.equal(c.arcade.theme, "kit");
    assert.equal(c.arcade.orders.filter((n) => n > 0).length, 3);
    assert.equal(c.arcade.moves, 9);
    assert.equal(core.match3Matches(c.arcade.board).length, 0);
    assert.equal(core.replay(c, arcadeGesture(c), 75).passed, true);
    recipes.add(c.arcade.orders.join(","));
  }
  assert.equal(recipes.size, 4);
});
test("a hop avoids a trail stump, but never creates cargo", () => {
  const c = challenge("drive"),
    s = core.create(c),
    row = c.arcade.rows[0];
  core.act(s, [400, 4, row.obstacle, 0]);
  core.act(s, [row.at + 1550, 5, 0, 0]);
  core.advance(s, row.at + 1800);
  assert.equal(s.health, 3);
  assert.equal(s.crates, 0);
});
