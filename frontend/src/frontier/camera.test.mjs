import test from "node:test";
import assert from "node:assert/strict";
import { frameCamera } from "./camera.mjs";

test("edge destinations remain above mobile action panels", () => {
  for (const area of [
    { left: 12, right: 330, top: 238, bottom: 490 },
    { left: 12, right: 260, top: 204, bottom: 400 },
  ]) {
    for (const focus of [
      [0.319, 0.787],
      [0.241, 0.263],
      [0.927, 0.318],
      [0.905, 0.826],
    ]) {
      const p = frameCamera(focus, 0.96, area);
      const feet = p.y + focus[1] * 1254 * 0.96;
      const centre = p.x + focus[0] * 1254 * 0.96;
      assert.ok(feet < area.bottom - 20, "feet clear the action panel");
      assert.ok(feet - 100 > area.top, "face clears the objective");
      assert.ok(
        centre > area.left && centre < area.right,
        "avatar is horizontally visible",
      );
    }
  }
});
