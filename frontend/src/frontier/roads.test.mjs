import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ribbon, modelKit } from "./lowPolyWorld.mjs";
const require = createRequire(import.meta.url),
  roads = require("../../../backend/frontier/roads.json"),
  content = require("../../../backend/frontier/content.json");
const { findRoute } = require("../../../backend/frontier/travel.js");
test("road surfaces face the camera above the ground, including diagonal turns", () => {
  const kit = modelKit();
  const mesh = ribbon(
    [
      [0, 0],
      [2, 0],
      [3, 2],
      [3, 4],
    ],
    0.9,
    "#dec596",
    kit,
  );
  const normals = mesh.geometry.getAttribute("normal");
  for (let i = 0; i < normals.count; i++)
    assert.ok(normals.getY(i) > 0.99, "Road face was culled from above");
  kit.dispose(mesh);
});
test("every walking route follows the same connected segments rendered on the 3D map", () => {
  const links = new Set();
  for (const [from, to, gate, via] of roads.edges) {
    const points = [roads.nodes[from], ...via, roads.nodes[to]];
    for (let i = 1; i < points.length; i++) {
      links.add(JSON.stringify([points[i - 1], points[i]]));
      links.add(JSON.stringify([points[i], points[i - 1]]));
    }
  }
  for (const from of content.locations)
    for (const to of content.locations) {
      const path = findRoute(from.id, to.id, ["bridge"]);
      assert.deepEqual(path[0], [from.x, from.y]);
      assert.deepEqual(path.at(-1), [to.x, to.y]);
      for (let i = 1; i < path.length; i++)
        assert.ok(links.has(JSON.stringify([path[i - 1], path[i]])));
    }
  assert.equal(findRoute("village", "pool", []), null);
  assert.ok(
    findRoute("village", "bridge", []).every(
      ([x]) => x <= roads.nodes.bridge[0],
    ),
  );
});
