import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  acceptArcadeInput,
  workbenchPoint,
} from "../src/frontier/arcadeInput.mjs";
const core = createRequire(import.meta.url)("../../backend/frontier/core");
test("dense 120Hz touch strokes keep their release and replay a complete workbench round", () => {
  const c = { kind: "board", seed: 42, arcade: core.make("board", 42) },
    events = [],
    s = core.create(c);
  let t = 0;
  function send(type, x, y) {
    const e = [Math.round(t), type, x, y];
    t += 1000 / 120;
    if (acceptArcadeInput(events, e, c.arcade.duration)) {
      events.push(e);
      core.act(s, e);
    }
  }
  function sweep(x1, y1, x2, y2) {
    for (let i = 1; i <= 70; i++)
      send(
        1,
        x1 + ((x2 - x1) * i) / 70 + Math.sin(i * 1.7) * 0.008,
        y1 + ((y2 - y1) * i) / 70 + Math.cos(i * 1.3) * 0.004,
      );
  }
  send(0, c.arcade.cutX, 0.2);
  for (let i = 0; i < 4; i++)
    sweep(c.arcade.cutX, i % 2 ? 0.8 : 0.2, c.arcade.cutX, i % 2 ? 0.2 : 0.8);
  send(2, c.arcade.cutX, 0.2);
  assert.equal(s.carpentryStep, 1);
  send(0, 0.15, 0.5);
  sweep(0.15, 0.5, 0.85, 0.5);
  sweep(0.85, 0.5, 0.15, 0.5);
  send(2, 0.15, 0.5);
  assert.equal(s.carpentryStep, 2);
  for (let i = 0; i < 4; i++)
    while (s.nailHP[i] > 0) {
      t += 400;
      send(6, i, 0);
    }
  assert.ok(events.length < 150);
  assert.equal(core.grade(s).passed, true);
  assert.deepEqual(core.replay(c, { events }, 26), core.grade(s));
});
test("recording reserves room for lift and cancel after an oversized drag", () => {
  const events = [];
  for (let t = 0; t < 26000; t += 3) {
    const e = [t, 1, 0.5, (Math.sin(t) + 1) / 2];
    if (acceptArcadeInput(events, e, 26000)) events.push(e);
  }
  assert.ok(events.length <= 238);
  const end = [26000, 2, 0.5, 0.5];
  assert.equal(acceptArcadeInput(events, end, 26000), true);
  events.push(end);
  assert.equal(acceptArcadeInput(events, [26000, 7, 0, 0], 26000), true);
});
test("the workbench uses the visible letterboxed SVG area on small and tall screens", () => {
  for (const [width, height] of [
    [343, 290],
    [288, 210],
    [700, 260],
  ]) {
    const rect = { left: 18, top: 140, width, height };
    const scale = Math.min(width / 400, height / 300);
    const p = workbenchPoint(
      rect,
      rect.left + (width - 400 * scale) / 2 + 400 * scale * 0.4,
      rect.top + (height - 300 * scale) / 2 + 300 * scale * 0.75,
    );
    assert.ok(Math.abs(p[0] - 0.4) < 1e-8);
    assert.ok(Math.abs(p[1] - 0.75) < 1e-8);
  }
});
