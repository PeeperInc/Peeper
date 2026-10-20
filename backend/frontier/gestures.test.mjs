import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { gesture } from "./gesture-fixtures.mjs";
const require = createRequire(import.meta.url),
  { makeChallenge, inspect } = require("./gestures"),
  { findRoute } = require("./travel");
for (const kind of ["saw", "mine", "pack"])
  test(`${kind}: physical gesture, malformed input and accelerated playback`, () => {
    for (let i = 0; i < 30; i++) {
      const c = makeChallenge(kind, 100),
        g = gesture(c);
      assert.equal(
        inspect(c, g, 3).passed,
        true,
        `${kind}: ${JSON.stringify(inspect(c, g, 3))}`,
      );
      assert.equal(inspect(c, g, 0).valid, false);
      assert.equal(inspect(c, "OAK", 30).valid, false);
      assert.equal(
        inspect(
          c,
          {
            trace: [
              [0.5, 0.5, 0, 0],
              [0.5, 0.5, 800, 2],
            ],
          },
          3,
        ).valid,
        false,
      );
      const bad = structuredClone(g);
      bad.trace[1][0] = Infinity;
      assert.equal(inspect(c, bad, 3).valid, false);
    }
  });
test("saw rejects a crooked cut and short reciprocation", () => {
  const c = makeChallenge("saw", 0),
    g = gesture(c);
  g.trace.forEach((p) => (p[0] += 0.15));
  assert.equal(inspect(c, g, 3).passed, false);
  const short = gesture(c);
  short.trace.forEach((p) => (p[1] = 0.5));
  assert.equal(inspect(c, short, 3).passed, false);
});
test("saw accepts hand wobble and a cut near either visible guide", () => {
  const c = makeChallenge("saw", 0);
  for (const offset of [-0.09, -0.05, 0.05, 0.09]) {
    const g = gesture(c);
    g.trace.forEach((p, i) => {
      p[0] += offset + Math.sin(i) * 0.008;
    });
    assert.equal(inspect(c, g, 3).passed, true);
  }
});
test("hammer rejects tapping, excessive force and striking outside cracks", () => {
  const c = makeChallenge("mine", 0);
  for (const mode of ["tap", "overpowered", "off", "stationary", "late"]) {
    const g = gesture(c);
    if (mode === "off") g.trace.forEach((p) => (p[0] = 0.05));
    else if (mode === "stationary") {
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          g.trace[i * 3 + j][0] = c.points[i][0];
          g.trace[i * 3 + j][1] = c.points[i][1];
        }
    } else
      for (let i = 0; i < 3; i++) {
        g.trace[i * 3 + 1][2] = i * 5000 + 50;
        g.trace[i * 3][2] = i * 5000;
        g.trace[i * 3 + 2][2] =
          i * 5000 +
          (mode === "tap"
            ? 100
            : mode === "late"
              ? 3700
              : Math.round(c.period / 2));
      }
    assert.equal(inspect(c, g, 15).passed, false, mode);
  }
});
test("hammer allows two misses, requires all three fractures, and caps attempts", () => {
  const c = makeChallenge("mine", 0);
  const hit = gesture(c).trace;
  const miss = [
    [...c.home, 0, 0],
    [0.1, 0.2, 200, 1],
    [0.1, 0.2, 650, 2],
  ];
  function withMisses(n) {
    return {
      trace: [
        ...Array.from({ length: n }, (_, i) =>
          miss.map((p) => [p[0], p[1], p[2] + i * 900, p[3]]),
        ).flat(),
        ...hit.map((p) => [p[0], p[1], p[2] + n * 900, p[3]]),
      ],
    };
  }
  assert.deepEqual(inspect(c, withMisses(2), 8), {
    valid: true,
    quality: 60,
    passed: true,
  });
  assert.equal(inspect(c, withMisses(3), 8).passed, false);
  assert.equal(inspect(c, { trace: hit.slice(0, 6) }, 4).passed, false);
});
test("existing mining challenges use the new controls without a schema migration", () => {
  const c = {
    version: 2,
    kind: "mine",
    points: [
      [0.3, 0.4],
      [0.7, 0.5],
      [0.5, 0.7],
    ],
  };
  assert.equal(inspect(c, gesture(c), 3).passed, true);
});
test("packing rejects overlapping or out-of-bounds pieces", () => {
  const c = makeChallenge("pack", 0),
    g = gesture(c);
  g.placements = g.placements.map((p) => ({ ...p, x: 0, y: 0 }));
  assert.equal(inspect(c, g, 3).passed, false);
  g.placements[0].x = 99;
  assert.equal(inspect(c, g, 3).passed, false);
});
test("bridge gates the dragon and both expedition workshops", () => {
  for (const from of ["village", "sawmill", "quarry", "bridge"])
    for (const to of ["mill", "pool", "workshop"])
      assert.equal(findRoute(from, to, []), null);
  assert.ok(findRoute("village", "bridge", []));
  assert.ok(findRoute("village", "mill", ["bridge"]));
  assert.ok(findRoute("village", "pool", ["bridge"]));
  assert.ok(findRoute("village", "workshop", ["bridge"]));
  assert.ok(findRoute("village", "pool", ["bridge", "mill"]));
});

test("saw accepts release endpoints and records fast turns without losing the final stroke", () => {
  const core = require("./core"),
    c = makeChallenge("saw", 100);
  const trace = [];
  for (let i = 0; i < 6; i++) {
    trace.push(
      [c.x - 0.04, 0.3, i * 300, 0],
      [c.x + 0.06, 0.75, i * 300 + 180, 2],
    );
  }
  assert.equal(core.sawProgress(trace, c).turns, 6);
  assert.equal(inspect(c, { trace }, 3).passed, true);
  const taps = trace.map((p, i) => [p[0], i % 2 ? 0.3 : 0.3, p[2], p[3]]);
  assert.equal(inspect(c, { trace: taps }, 3).passed, false);
  let dense = [[c.x, 0.3, 0, 0]];
  for (let i = 1; i <= 600; i++) {
    const y = 0.525 - 0.225 * Math.cos((i / 100) * Math.PI);
    dense.push([c.x + Math.sin(i) * 0.03, y, i * 4, 1]);
    dense = core.compactSawTrace(dense);
  }
  dense.push([c.x, 0.3, 2401, 2]);
  assert.ok(dense.length <= 256);
  assert.equal(core.sawProgress(dense, c).turns, 6);
  assert.equal(inspect(c, { trace: dense }, 3).passed, true);
});
