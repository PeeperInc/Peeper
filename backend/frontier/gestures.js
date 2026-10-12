"use strict";
const { randomInt, randomUUID } = require("node:crypto");
const arcade = require("./core");
const rand = (a, b) => a + ((b - a) * randomInt(10000)) / 10000;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const shapes = [
  [
    [0, 0],
    [1, 0],
  ],
  [
    [0, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
];
function rotated(shape, turn) {
  let s = shape.map((p) => [...p]);
  for (let i = 0; i < turn; i++) s = s.map(([x, y]) => [-y, x]);
  const minX = Math.min(...s.map((p) => p[0])),
    minY = Math.min(...s.map((p) => p[1]));
  return s.map(([x, y]) => [x - minX, y - minY]);
}
function makeChallenge(kind, now, weather = "clear") {
  const c = {
    version: 3,
    kind,
    nonce: randomUUID(),
    issued_at: now,
    seed: randomInt(100000),
  };
  if (arcade.modes[kind]) {
    c.arcade = arcade.make(kind, c.seed, weather);
    c.weather = weather;
    return c;
  }
  if (kind === "saw") {
    c.x = rand(0.38, 0.62);
    c.strokes = 6;
  }
  if (kind === "mine") {
    c.points = [
      [rand(0.22, 0.35), rand(0.36, 0.48)],
      [rand(0.62, 0.76), rand(0.4, 0.53)],
      [rand(0.4, 0.58), rand(0.61, 0.73)],
    ];
    c.home = [0.84, 0.88];
    c.gripOffset = 0.14;
    c.period = randomInt(1800, 2201);
    c.strikes = 5;
  }
  if (kind === "plane" || kind === "steer") {
    const phase = rand(0, Math.PI);
    c.path = Array.from({ length: 25 }, (_, i) => {
      const t = i / 24;
      return kind === "plane"
        ? [0.13 + t * 0.74, 0.52 + Math.sin(t * Math.PI * 2 + phase) * 0.09]
        : [0.5 + Math.sin(t * Math.PI * 2 + phase) * 0.18, 0.83 - t * 0.63];
    });
  }
  if (kind === "pack") c.shapes = shapes.map((s) => rotated(s, randomInt(4)));
  if (kind === "guard")
    c.points = [
      [rand(0.22, 0.35), 0.4],
      [rand(0.61, 0.75), 0.55],
      [rand(0.37, 0.56), 0.72],
    ];
  if (kind === "crank") {
    c.center = [0.5, 0.52];
    c.radius = 0.21;
  }
  if (kind === "dodge") {
    c.path = [
      [0.2, 0.82],
      [0.23, 0.55],
      [0.5, 0.36],
      [0.8, 0.22],
    ];
    c.hazards = [
      [0.48, 0.7, 0.13],
      [0.73, 0.48, 0.12],
      [0.24, 0.26, 0.1],
    ];
  }
  if (kind === "rune")
    c.path = [
      [0.5, 0.26],
      [0.23, 0.73],
      [0.77, 0.73],
      [0.5, 0.26],
    ];
  return c;
}
function inspect(c, g, elapsed) {
  if (c?.version === 3 && c.arcade) return arcade.replay(c, g, elapsed);
  if (
    !c ||
    ![2, 3].includes(c.version) ||
    !g ||
    typeof g !== "object" ||
    !Array.isArray(g.trace) ||
    g.trace.length < 4 ||
    g.trace.length > 256
  )
    return { valid: false };
  const trace = g.trace;
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i];
    if (
      !Array.isArray(p) ||
      p.length !== 4 ||
      !p.every(Number.isFinite) ||
      p[0] < 0 ||
      p[0] > 1 ||
      p[1] < 0 ||
      p[1] > 1 ||
      p[2] < 0 ||
      p[2] > 60000 ||
      ![0, 1, 2].includes(p[3]) ||
      (i && p[2] < trace[i - 1][2])
    )
      return { valid: false };
  }
  const duration = trace.at(-1)[2] - trace[0][2];
  if (
    duration < 120 ||
    duration > elapsed * 1000 + 600 ||
    trace[0][3] !== 0 ||
    trace.at(-1)[3] !== 2
  )
    return { valid: false };
  const points = trace.filter((p) => p[3] !== 2);
  let quality = 0;
  if (c.kind === "saw") {
    quality = arcade.sawProgress(trace, c).quality;
  } else if (c.kind === "mine") {
    let down = null,
      hits = 0,
      attempts = 0;
    for (const p of trace) {
      if (p[3] === 0) down = p;
      if (p[3] !== 2 || !down) continue;
      if (attempts >= (c.strikes ?? 5) || hits === c.points.length) break;
      attempts++;
      const ms = p[2] - down[2];
      const power =
        0.5 - 0.5 * Math.cos((2 * Math.PI * ms) / (c.period ?? 2000));
      const head = [p[0], p[1] - (c.gripOffset ?? 0.14)];
      if (
        dist(down, c.home ?? [0.84, 0.88]) <= 0.12 &&
        dist(down, p) >= 0.14 &&
        dist(head, c.points[hits]) <= 0.105 &&
        ms >= 300 &&
        ms <= 3600 &&
        power >= 0.62 &&
        power <= 0.94
      )
        hits++;
      down = null;
    }
    // All cracks must break. Misses spend an attempt and reduce the grade.
    quality = hits === c.points.length ? hits / attempts : 0;
  } else if (c.kind === "guard") {
    let down = null,
      hit = 0;
    for (const p of trace) {
      if (p[3] === 0) down = p;
      if (p[3] === 2 && down && hit < c.points.length) {
        const ms = p[2] - down[2];
        const ok =
          Math.min(dist(down, c.points[hit]), dist(p, c.points[hit])) < 0.16 &&
          dist(down, p) > 0.13 &&
          ms >= 120 &&
          ms <= 1300;
        if (ok) hit++;
        down = null;
      }
    }
    quality = hit / c.points.length;
  } else if (c.kind === "pack") {
    if (!Array.isArray(g.placements) || g.placements.length !== 3)
      return { valid: false };
    const occupied = new Set();
    let good = true;
    for (let i = 0; i < 3; i++) {
      const p = g.placements[i];
      if (
        !p ||
        ![p.x, p.y, p.rotation].every(Number.isInteger) ||
        p.rotation < 0 ||
        p.rotation > 3
      ) {
        good = false;
        break;
      }
      for (const [dx, dy] of rotated(c.shapes[i], p.rotation)) {
        const x = p.x + dx,
          y = p.y + dy,
          k = `${x},${y}`;
        if (x < 0 || x > 3 || y < 0 || y > 2 || occupied.has(k)) good = false;
        occupied.add(k);
      }
    }
    quality = good ? 1 : 0;
  } else if (c.kind === "crank") {
    let angle = 0,
      radial = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      radial += Math.abs(dist(p, c.center) - c.radius);
      if (i) {
        const prev = points[i - 1];
        let d =
          Math.atan2(p[1] - c.center[1], p[0] - c.center[0]) -
          Math.atan2(prev[1] - c.center[1], prev[0] - c.center[0]);
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        angle += d;
      }
    }
    quality =
      Math.abs(angle) > Math.PI * 3.5
        ? Math.max(0, 1 - radial / points.length / 0.12)
        : 0;
  } else if (c.kind === "dodge") {
    let safe = true;
    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1],
        b = trace[i];
      for (const [x, y, r] of c.hazards) {
        const dx = b[0] - a[0],
          dy = b[1] - a[1],
          den = dx * dx + dy * dy,
          t = den
            ? Math.max(
                0,
                Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / den),
              )
            : 0;
        if (dist([x, y], [a[0] + dx * t, a[1] + dy * t]) < r + 0.015)
          safe = false;
      }
    }
    quality =
      safe &&
      dist(trace[0], c.path[0]) < 0.1 &&
      dist(trace.at(-1), c.path.at(-1)) < 0.1
        ? 1
        : 0;
  } else {
    const path = c.path;
    let covered = 0,
      errors = 0;
    for (const p of points) {
      let best = Infinity,
        idx = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i],
          b = path[i + 1],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          t = Math.max(
            0,
            Math.min(
              1,
              ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy),
            ),
          );
        const d = dist(p, [a[0] + t * dx, a[1] + t * dy]);
        if (d < best) {
          best = d;
          idx = i + t;
        }
      }
      errors += best;
      if (idx >= covered && idx - covered < 3) covered = idx;
    }
    const end = dist(trace.at(-1), path.at(-1)),
      start = dist(trace[0], path[0]);
    quality =
      start < 0.13 && end < 0.12 && covered >= path.length - 2
        ? Math.max(0, 1 - errors / points.length / 0.12)
        : 0;
  }
  return {
    valid: true,
    quality: Math.round(quality * 100),
    passed: quality >= 0.6,
  };
}
module.exports = { makeChallenge, inspect, rotated };
