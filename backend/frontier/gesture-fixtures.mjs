import { createRequire } from "node:module";
import { arcadeGesture } from "./arcade-fixtures.mjs";
const require = createRequire(import.meta.url);
const { rotated } = require("./gestures");
// Recorded-style input samples, independent of scoring: pointer down, moves, pointer up.
export function gesture(c) {
  if (c.arcade) return arcadeGesture(c);
  let points = [];
  if (c.kind === "saw")
    for (let i = 0; i <= 7; i++)
      for (let j = 0; j < 9; j++)
        points.push([c.x, i % 2 ? 0.76 - j * 0.06 : 0.28 + j * 0.06]);
  else if (c.kind === "mine") {
    const [hx, hy] = c.home ?? [0.84, 0.88];
    const held = Math.round((c.period ?? 2000) * 0.32);
    return {
      trace: c.points.flatMap(([x, y], i) => [
        [hx, hy, i * 900, 0],
        [(hx + x) / 2, (hy + y + (c.gripOffset ?? 0.14)) / 2, i * 900 + 200, 1],
        [x, y + (c.gripOffset ?? 0.14), i * 900 + held, 2],
      ]),
    };
  } else if (c.kind === "guard")
    return {
      trace: c.points.flatMap(([x, y], i) => [
        [x, y, i * 600, 0],
        [x, y, i * 600 + 200, 1],
        [x + (c.kind === "guard" ? 0.18 : 0), y, i * 600 + 500, 2],
      ]),
    };
  else if (c.kind === "crank")
    points = Array.from({ length: 90 }, (_, i) => {
      const a = (i / 89) * Math.PI * 4.1;
      return [
        c.center[0] + Math.cos(a) * c.radius,
        c.center[1] + Math.sin(a) * c.radius,
      ];
    });
  else if (c.path)
    for (let i = 0; i < c.path.length - 1; i++)
      for (let j = 0; j <= 10; j++) {
        const t = j / 10;
        points.push([
          c.path[i][0] * (1 - t) + c.path[i + 1][0] * t,
          c.path[i][1] * (1 - t) + c.path[i + 1][1] * t,
        ]);
      }
  if (c.kind === "pack") {
    function fit(i, used, out) {
      if (i === 3) return out;
      for (let r = 0; r < 4; r++)
        for (let y = 0; y < 3; y++)
          for (let x = 0; x < 4; x++) {
            const cells = rotated(c.shapes[i], r).map(([dx, dy]) => [
              x + dx,
              y + dy,
            ]);
            if (
              cells.every(([a, b]) => a < 4 && b < 3 && !used.has(a + "," + b))
            ) {
              const next = fit(
                i + 1,
                new Set([...used, ...cells.map((p) => p.join(","))]),
                [...out, { x, y, rotation: r }],
              );
              if (next) return next;
            }
          }
    }
    return {
      trace: [
        [0.1, 0.85, 0, 0],
        [0.2, 0.6, 500, 1],
        [0.3, 0.5, 1000, 1],
        [0.3, 0.5, 1800, 2],
      ],
      placements: fit(0, new Set(), []),
    };
  }
  if (points.length > 240)
    points = points.filter((_, i) => i % 2 === 0 || i === points.length - 1);
  return {
    trace: points.map((p, i) => [
      ...p,
      Math.round((i / (points.length - 1)) * 1800),
      i === 0 ? 0 : i === points.length - 1 ? 2 : 1,
    ]),
  };
}
