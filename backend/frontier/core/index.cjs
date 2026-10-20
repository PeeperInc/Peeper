"use strict";

// Shared deterministic rules. No renderer, clock, browser or database dependencies.
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const modes = {
  split: "chopping",
  chip: "quarrying",
  board: "carpentry",
  drive: "trail",
  brew: "match3",
  provision: "match3",
  smith: "forge",
  fell: "logging",
  excavate: "mining",
  forge: "forge",
  plane: "stack",
  steer: "convoy",
  guard: "slice",
  crank: "pipes",
  dodge: "duel",
  rune: "herbs",
};
// Both the visible progress and the server grade use these exact recorded samples.
// Release endpoints count: short mouse strokes often contain no intermediate move.
function sawProgress(trace, c) {
  let band = 0,
    turns = 0,
    error = 0,
    length = 0;
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i],
      next = p[1] < 0.35 ? -1 : p[1] > 0.68 ? 1 : 0;
    if (p[3] === 0) band = next;
    else if (next && next !== band) {
      if (band) turns++;
      band = next;
    }
    if (i && p[3] !== 0) {
      const prev = trace[i - 1],
        d = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      length += d;
      error += (d * (Math.abs(p[0] - c.x) + Math.abs(prev[0] - c.x))) / 2;
    }
  }
  const quality = clamp(
    1 - Math.max(0, error / Math.max(0.001, length) - 0.05) / 0.12,
  );
  return { turns, band, quality: turns >= c.strokes ? quality : 0 };
}

function compactSawTrace(trace) {
  if (trace.length <= 240) return trace;
  let band = 0;
  return trace.filter((p, i) => {
    const next = p[1] < 0.35 ? -1 : p[1] > 0.68 ? 1 : 0;
    const crossing = next && next !== band;
    if (next) band = next;
    return crossing || p[3] !== 1 || i % 2 === 0 || i === trace.length - 1;
  });
}
function random(seed) {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
const turnMask = (mask) => ((mask << 1) & 15) | (mask >> 3);
function ensureHerbs(board) {
  for (let start = 0; start < 16; start++) {
    const seen = new Set([start]),
      queue = [start];
    for (let n = 0; n < queue.length; n++) {
      const p = queue[n];
      for (let i = 0; i < 16; i++)
        if (
          !seen.has(i) &&
          board[i] === board[p] &&
          Math.abs((i % 4) - (p % 4)) +
            Math.abs(Math.floor(i / 4) - Math.floor(p / 4)) ===
            1
        ) {
          seen.add(i);
          queue.push(i);
        }
    }
    if (seen.size >= 3) return;
  }
  board[1] = board[2] = board[0];
}
const pipePaths = [];
(function walk(path) {
  const end = path.at(-1);
  if (end === 5) {
    if (path.length >= 5) pipePaths.push(path);
    return;
  }
  for (let i = 0; i < 9; i++)
    if (
      !path.includes(i) &&
      Math.abs((i % 3) - (end % 3)) +
        Math.abs(Math.floor(i / 3) - Math.floor(end / 3)) ===
        1
    )
      walk([...path, i]);
})([3]);
const pipePath = (seed) => pipePaths[(seed >>> 0) % pipePaths.length];
function pipeSolution(seed) {
  const masks = Array(9).fill(0),
    path = pipePath(seed);
  const bit = (a, b) =>
    b === a - 3 ? 1 : b === a + 1 ? 2 : b === a + 3 ? 4 : 8;
  path.forEach((cell, i) => {
    masks[cell] =
      (i ? bit(cell, path[i - 1]) : 8) |
      (i === path.length - 1 ? 2 : bit(cell, path[i + 1]));
  });
  return masks;
}
function toolPulse(s, t = s.t) {
  return 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 1100 + (s.c.seed % 11) * 0.4);
}
function match3Matches(board) {
  const found = new Set();
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 5; col++)
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        const cells = [];
        let x = col,
          y = row;
        while (x < 5 && y < 5 && board[y * 5 + x] === board[row * 5 + col]) {
          cells.push(y * 5 + x);
          x += dx;
          y += dy;
        }
        if (cells.length >= 3) cells.forEach((i) => found.add(i));
      }
  return [...found];
}
function match3Moves(board) {
  const moves = [];
  for (let i = 0; i < 25; i++)
    for (const j of [i % 5 < 4 ? i + 1 : -1, i + 5 < 25 ? i + 5 : -1]) {
      if (j < 0 || board[i] === board[j]) continue;
      const copy = board.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      if (match3Matches(copy).length) moves.push([i, j]);
    }
  return moves;
}
function ensureMatch3Move(board, seed) {
  const rng = random(seed + 7781);
  for (let attempt = 0; attempt < 25; attempt++) {
    if (match3Moves(board).length && !match3Matches(board).length) return;
    for (let i = 24; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [board[i], board[j]] = [board[j], board[i]];
    }
  }
  for (let i = 0; i < 25; i++) board[i] = ((i % 5) + Math.floor(i / 5) * 2) % 4;
  board[0] = board[1] = board[7] = 0;
  board[2] = 1;
}
function swapMatch3(s, first, second) {
  if (
    !Number.isInteger(first) ||
    !Number.isInteger(second) ||
    first < 0 ||
    first >= 25 ||
    second < 0 ||
    second >= 25
  )
    return false;
  if (
    s.done ||
    s.moves >= s.c.arcade.moves ||
    Math.abs((first % 5) - (second % 5)) +
      Math.abs(Math.floor(first / 5) - Math.floor(second / 5)) !==
      1
  )
    return false;
  [s.board[first], s.board[second]] = [s.board[second], s.board[first]];
  const frames = [
    {
      type: "swap",
      board: s.board.slice(),
      collected: s.collected.slice(),
      from: first,
      to: second,
      ms: 210,
    },
  ];
  let cells = match3Matches(s.board);
  if (!cells.length) {
    [s.board[first], s.board[second]] = [s.board[second], s.board[first]];
    s.matchAnimation = {
      id: (s.matchAnimation?.id || 0) + 1,
      frames: [
        ...frames,
        {
          type: "return",
          board: s.board.slice(),
          collected: s.collected.slice(),
          from: first,
          to: second,
          ms: 210,
        },
      ],
    };
    s.message = "Swap neighbours to make three";
    return false;
  }
  s.moves++;
  s.revision++;
  let cascades = 0,
    harvested = 0;
  while (cells.length && cascades++ < 12) {
    frames.push({
      type: "pop",
      board: s.board.slice(),
      cells: cells.slice(),
      collected: s.collected.slice(),
      cascade: cascades,
      ms: 260,
    });
    cells.forEach((i) => {
      s.collected[s.board[i]]++;
      harvested++;
    });
    const rng = random(s.c.seed + ++s.refill * 997);
    const falls = Array(25).fill(0);
    for (let col = 0; col < 5; col++) {
      const remaining = Array.from(
        { length: 5 },
        (_, row) => row * 5 + col,
      ).filter((i) => !cells.includes(i));
      const missing = 5 - remaining.length;
      const keep = remaining.map((i) => s.board[i]);
      while (keep.length < 5) keep.unshift(Math.floor(rng() * 4));
      keep.forEach((v, row) => {
        s.board[row * 5 + col] = v;
        falls[row * 5 + col] =
          row < missing
            ? missing
            : row - Math.floor(remaining[row - missing] / 5);
      });
    }
    frames.push({
      type: "fall",
      board: s.board.slice(),
      falls,
      collected: s.collected.slice(),
      cascade: cascades,
      ms: 310,
    });
    cells = match3Matches(s.board);
  }
  s.harvested += harvested;
  s.message =
    cascades > 1
      ? `${cascades} cascades · ${harvested} ${s.c.arcade.theme === "kit" ? "supplies" : "herbs"}`
      : `${harvested} ${s.c.arcade.theme === "kit" ? "supplies" : "herbs"} collected`;
  if (
    s.c.arcade.orders.every((n, i) => s.collected[i] >= n) ||
    s.moves >= s.c.arcade.moves
  )
    s.done = true;
  else ensureMatch3Move(s.board, s.c.seed + s.refill);
  if (frames.at(-1).board.some((v, i) => v !== s.board[i]))
    frames.push({ type: "shuffle", board: s.board.slice(), ms: 320 });
  s.matchAnimation = { id: (s.matchAnimation?.id || 0) + 1, frames };
  return true;
}
function make(kind, seed, weather = "clear") {
  const rng = random(seed),
    pick = (n) => Math.floor(rng() * n);
  const c = {
    mode: modes[kind],
    duration: ["fell", "excavate"].includes(kind)
      ? 15000
      : kind === "forge"
        ? 18000
        : ["plane", "crank", "rune"].includes(kind)
          ? 12000
          : 9500,
    steering: 1.5,
  };
  if (
    ["chopping", "quarrying", "carpentry", "trail", "match3"].includes(c.mode)
  ) {
    c.touch = true;
    c.duration =
      c.mode === "match3" ? 45000 : c.mode === "trail" ? 9500 : 15000;
  }
  if (c.mode === "chopping") {
    c.notches = Array.from({ length: 6 }, () => pick(2));
    c.windows = Array.from({ length: 6 }, () => {
      const center = [560, 760, 960][pick(3)];
      return [center - 140, center + 140];
    });
    c.mistakeLimit = 4;
    c.target = 6;
  }
  if (c.mode === "quarrying") {
    c.precision = true;
    c.mistakeLimit = 5;
    c.nodes = ["ore", "ore", "ore"];
    const start = pick(3);
    c.order = [start, (start + 1) % 3, (start + 2) % 3];
    if (pick(2)) c.order.reverse();
    c.target = 3;
  }
  if (c.mode === "carpentry") {
    c.cutX = 0.35 + rng() * 0.3;
    c.nails = 4;
    c.workbench = { saw: 4, plane: 2 };
    c.duration = 26000;
  }
  if (c.mode === "trail") {
    const counts = [0, 0, 0];
    c.rows = Array.from({ length: 5 }, (_, i) => {
      const lanes = [0, 1, 2].filter((l) => counts[l] < 2),
        crate = lanes[pick(lanes.length)];
      counts[crate]++;
      return { at: 250 + i * 1450, crate, obstacle: (crate + 1 + pick(2)) % 3 };
    });
  }
  if (c.mode === "match3") {
    c.size = 5;
    c.moves = 8;
    c.target = 24;
    c.orders = [8, 8, 8, 0];
    if (kind === "provision") {
      c.theme = "kit";
      c.duration = 75000;
      c.moves = 9;
      c.orders = [8, 8, 8, 8];
      c.orders[(seed >>> 0) % 4] = 0;
    }
    c.board = [];
    for (let i = 0; i < 25; i++) {
      let value;
      do {
        value = pick(4);
      } while (
        (i % 5 > 1 && c.board[i - 1] === value && c.board[i - 2] === value) ||
        (i >= 10 && c.board[i - 5] === value && c.board[i - 10] === value)
      );
      c.board.push(value);
    }
    ensureMatch3Move(c.board, seed);
  }
  if (kind === "smith") {
    const variants = [
      {
        name: "Hatchet",
        sections: [2, 3, 1],
        order: [0, 1, 1, 2, 1, 0],
        hot: [0.5, 0.88],
        quench: [0.36, 0.65],
      },
      {
        name: "Spearhead",
        sections: [1, 2, 3],
        order: [2, 1, 2, 0, 1, 2],
        hot: [0.48, 0.86],
        quench: [0.4, 0.7],
      },
      {
        name: "Short blade",
        sections: [2, 2, 2],
        order: [0, 1, 2, 2, 1, 0],
        hot: [0.45, 0.9],
        quench: [0.35, 0.7],
      },
    ];
    c.recipe = { ...variants[pick(variants.length)], thermal: true };
    c.duration = 26000;
  }
  if (c.mode === "logging") {
    c.notches = Array.from({ length: 6 }, (_, i) => (pick(2) + i) % 2);
    c.target = 6;
  }
  if (c.mode === "mining") {
    c.nodes = ["brace", "ore", "ore", "ore", "brace", "brittle"];
    for (let i = c.nodes.length - 1; i > 0; i--) {
      const j = pick(i + 1);
      [c.nodes[i], c.nodes[j]] = [c.nodes[j], c.nodes[i]];
    }
    c.target = 3;
  }
  if (c.mode === "slice") {
    c.items = [];
    let sides = [];
    function flight(at, friendly) {
      if (!sides.length) sides = [0, 1, 2];
      const side = sides.splice(pick(sides.length), 1)[0],
        height = 0.32 + rng() * 0.46;
      const start =
        side === 0
          ? [0.065, height]
          : side === 1
            ? [0.935, height]
            : [0.2 + rng() * 0.6, 0.9];
      const end =
        side === 0
          ? [0.88, 0.3 + rng() * 0.4]
          : side === 1
            ? [0.12, 0.3 + rng() * 0.4]
            : [0.15 + rng() * 0.7, 0.25 + rng() * 0.25];
      c.items.push({
        at: Math.round(at),
        friendly,
        life: 1750 + pick(300),
        start,
        end,
        control: [0.25 + rng() * 0.5, 0.22 + rng() * 0.5],
        sway: 0.025 * (rng() < 0.5 ? -1 : 1),
        phase: rng() * Math.PI * 2,
      });
    }
    for (let i = 0; i < 8; i++) flight(450 + i * 920 + pick(130), false);
    for (let i = 0; i < 3; i++) flight(1150 + i * 2600 + pick(350), true);
    c.items.sort((a, b) => a.at - b.at);
    c.items.forEach((item, id) => (item.id = id));
  }
  if (c.mode === "convoy") {
    c.balance = true;
    const counts = [0, 0, 0];
    c.rows = Array.from({ length: 5 }, (_, i) => {
      const available = [0, 1, 2].filter((lane) => counts[lane] < 2),
        crate = available[pick(available.length)];
      counts[crate]++;
      return { at: 250 + i * 1450, obstacle: (crate + 1 + pick(2)) % 3, crate };
    });
  }
  if (c.mode === "duel")
    c.attacks = Array.from({ length: 3 }, (_, i) => ({
      at: 2200 + i * 2700,
      safe: pick(3),
    }));
  if (c.mode === "stack") {
    c.period = 1450 + pick(500);
    c.phase = rng() * Math.PI * 2;
    c.levels = 5;
  }
  if (c.mode === "pipes") {
    const target = pipeSolution(seed);
    let budget = 0;
    c.tiles = target.map((mask) => {
      if (!mask) return [5, 10, 3, 6, 12, 9][pick(6)];
      const turns = 1 + pick(2);
      budget += 4 - turns;
      for (let i = 0; i < turns; i++) mask = turnMask(mask);
      return mask;
    });
    c.moves = budget + 3;
  }
  if (c.mode === "herbs") {
    c.board = Array.from(
      { length: 16 },
      (_, i) => (Math.floor(i / 4) + pick(2)) % 3,
    );
    ensureHerbs(c.board);
    c.moves = 4;
    c.target = 9;
  }
  return c;
}
function create(c) {
  return {
    c,
    stamina: 1,
    stress: 0.28,
    charging: false,
    chargeStarted: 0,
    toolSide: 0,
    selectedNode: 0,
    balance: 0,
    bracing: false,
    lastSpill: -2000,
    cutsMade: 0,
    oreFound: 0,
    braced: 0,
    cleanHits: 0,
    attempts: 0,
    rockHP: c.arcade.nodes?.map((type) =>
      c.arcade.mode === "quarrying" ? 3 : type === "ore" ? 2 : 1,
    ),
    carpentryStep: 0,
    craftStrokes: [0, 0],
    craftDistance: 0,
    craftDirection: 0,
    craftLastDirection: 0,
    nailHP: [2, 2, 2, 2],
    collected: [0, 0, 0, 0],
    criticals: 0,
    jumpAt: -2000,
    heat: 0.25,
    heating: false,
    heatBatchHits: 0,
    heatStarted: 0,
    sections: [0, 0, 0],
    faults: 0,
    scorched: false,
    quenched: false,
    t: 0,
    done: false,
    pointer: null,
    hits: [],
    friendly: 0,
    combo: 0,
    bestCombo: 0,
    x: 0.5,
    targetX: 0.5,
    health: 3,
    crates: 0,
    crossed: [],
    dodges: 0,
    counters: 0,
    attacked: [],
    countered: [],
    lastStrike: -1000,
    flash: null,
    width: 0.66,
    center: 0.5,
    boards: [],
    perfect: 0,
    cuts: [],
    tiles: c.arcade.tiles?.slice(),
    moves: 0,
    flow: [],
    board: c.arcade.board?.slice(),
    chain: [],
    harvested: 0,
    refill: 0,
    message: "",
    revision: 0,
  };
}
function insect(item, t) {
  const age = (t - item.at) / item.life;
  if (age < 0 || age > 1) return null;
  if (item.start) {
    const inv = 1 - age,
      sway =
        Math.sin(age * Math.PI) *
        Math.sin(age * Math.PI * 3 + item.phase) *
        item.sway;
    return [
      clamp(
        inv * inv * item.start[0] +
          2 * inv * age * item.control[0] +
          age * age * item.end[0] +
          sway,
        0.06,
        0.94,
      ),
      clamp(
        inv * inv * item.start[1] +
          2 * inv * age * item.control[1] +
          age * age * item.end[1] +
          sway * 0.4,
        0.18,
        0.91,
      ),
    ];
  }
  return [
    item.x + item.vx * Math.sin(age * Math.PI),
    0.87 - Math.sin(age * Math.PI) * 0.56,
  ];
}
function boardX(s, t = s.t) {
  return (
    0.5 +
    Math.sin(
      (t * Math.PI * 2) / s.c.arcade.period +
        s.c.arcade.phase +
        s.boards.length * 0.8,
    ) *
      0.3
  );
}
function flow(tiles) {
  if (!(tiles[3] & 8)) return [];
  const found = new Set([3]),
    queue = [3];
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k],
      x = i % 3,
      y = Math.floor(i / 3);
    for (const [dx, dy, out, into] of [
      [0, -1, 1, 4],
      [1, 0, 2, 8],
      [0, 1, 4, 1],
      [-1, 0, 8, 2],
    ]) {
      const nx = x + dx,
        ny = y + dy,
        j = ny * 3 + nx;
      if (
        nx >= 0 &&
        nx < 3 &&
        ny >= 0 &&
        ny < 3 &&
        tiles[i] & out &&
        tiles[j] & into &&
        !found.has(j)
      ) {
        found.add(j);
        queue.push(j);
      }
    }
  }
  return [...found];
}
function advance(s, time) {
  if (s.done) return s;
  const a = s.c.arcade,
    until = Math.min(time, a.duration);
  while (s.t < until) {
    // Resolve collisions at their exact timestamp, independent of render frame rate.
    const boundaries = ["convoy", "trail"].includes(a.mode)
      ? a.rows.map((row) => row.at + 1800)
      : a.mode === "duel"
        ? a.attacks.map((attack) => attack.at)
        : [];
    const boundary = Math.min(...boundaries.filter((t) => t > s.t));
    const prev = s.t;
    s.t = Math.min(until, s.t + 20, boundary);
    const dt = (s.t - prev) / 1000;
    if (a.mode === "logging")
      s.stamina = clamp(s.stamina + dt * (s.charging ? -0.025 : 0.18));
    if (a.mode === "mining") s.stress = Math.max(0, s.stress - dt * 0.012);
    if (a.mode === "forge") {
      s.heat = clamp(s.heat + dt * (s.heating ? 0.28 : -0.035));
      if (s.heat >= 0.98 && !s.scorched) {
        s.scorched = true;
        s.faults++;
        s.message = "Too hot — release the bellows";
        s.flash = { t: s.t, bad: true };
      }
      if (s.heat < 0.85) s.scorched = false;
    }
    const beforeX = s.x;
    const steering = a.steering * (a.balance && s.bracing ? 0.65 : 1);
    s.x += clamp(s.targetX - s.x, -dt * steering, dt * steering);
    if (["convoy", "trail"].includes(a.mode) && a.balance) {
      s.balance = clamp(
        s.balance * Math.exp(-dt * (s.bracing ? 6 : 2)) +
          (s.x - beforeX) * (s.bracing ? 1.5 : 4),
        -1.5,
        1.5,
      );
      if (Math.abs(s.balance) > 0.92 && s.t - s.lastSpill > 1000) {
        s.lastSpill = s.t;
        s.health--;
        s.crates = Math.max(0, s.crates - 1);
        s.balance *= 0.35;
        s.flash = { t: s.t, bad: true };
        s.message = "Cargo spilled — brace before a sharp turn";
      }
    }
    if (["convoy", "trail"].includes(a.mode))
      a.rows.forEach((row, i) => {
        if (!s.crossed.includes(i) && s.t >= row.at + 1800) {
          s.crossed.push(i);
          if (
            Math.abs(s.x - (0.22 + row.obstacle * 0.28)) < 0.14 &&
            !(a.mode === "trail" && s.t - s.jumpAt >= 0 && s.t - s.jumpAt < 650)
          ) {
            s.health--;
            s.message = "Wheel struck a stump";
            s.flash = { t: s.t, bad: true };
          } else if (Math.abs(s.x - (0.22 + row.crate * 0.28)) < 0.12) {
            s.crates++;
            s.message = "Spare cargo recovered";
            s.flash = { t: s.t, bad: false };
          }
        }
      });
    if (a.mode === "duel")
      a.attacks.forEach((attack, i) => {
        if (!s.attacked.includes(i) && s.t >= attack.at) {
          s.attacked.push(i);
          if (Math.abs(s.x - (0.22 + attack.safe * 0.28)) < 0.13) {
            s.dodges++;
            s.message = "An opening — counter now";
          } else {
            s.health--;
            s.message = "Caught by the charge";
            s.flash = { t: s.t, bad: true };
          }
        }
      });
  }
  if (s.t >= a.duration || s.health <= 0) s.done = true;
  return s;
}
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    den = dx * dx + dy * dy;
  const t = den ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}
function herbCell(x, y) {
  const col = Math.floor((x - 0.1) / 0.2),
    row = Math.floor((y - 0.23) / 0.15);
  return col >= 0 && col < 4 && row >= 0 && row < 4 ? row * 4 + col : -1;
}
function addHerb(s, index) {
  if (index < 0) return;
  const prev = s.chain.at(-1);
  if (prev === undefined) {
    s.chain.push(index);
    return;
  }
  if (s.chain.length > 1 && index === s.chain.at(-2)) {
    s.chain.pop();
    return;
  }
  if (s.chain.includes(index) || s.board[index] !== s.board[prev]) return;
  if (
    Math.abs((index % 4) - (prev % 4)) +
      Math.abs(Math.floor(index / 4) - Math.floor(prev / 4)) ===
    1
  )
    s.chain.push(index);
}
function traceHerbs(s, x, y) {
  const [px, py] = s.pointer,
    steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / 0.025));
  for (let i = 1; i <= steps; i++)
    addHerb(
      s,
      herbCell(px + ((x - px) * i) / steps, py + ((y - py) * i) / steps),
    );
  s.pointer = [x, y];
}
function act(s, event) {
  const [t, type, x, y] = event;
  advance(s, t);
  if (s.done) return s;
  const a = s.c.arcade;
  if (type === 7) {
    s.pointer = null;
    s.chain = [];
    s.heating = false;
    s.charging = false;
    s.bracing = false;
    delete s.matchStart;
    return s;
  }
  if (a.mode === "chopping") {
    if (type === 6 && x < 2 && !s.charging) s.toolSide = x;
    if (type === 0 && !s.charging) {
      s.charging = true;
      s.chargeStarted = t;
    }
    if (type === 2 && s.charging) {
      const held = t - s.chargeStarted;
      s.charging = false;
      s.lastStrike = t;
      s.attempts++;
      const good =
        s.toolSide === a.notches[s.cutsMade] &&
        held >= (a.windows?.[s.cutsMade]?.[0] ?? 350) &&
        held <= (a.windows?.[s.cutsMade]?.[1] ?? 1100);
      if (good) {
        s.cutsMade++;
        s.cleanHits++;
        s.message = "Clean split";
      } else {
        s.faults++;
        s.message =
          held < (a.windows?.[s.cutsMade]?.[0] ?? 350)
            ? "Hold a little longer"
            : "Too late — release inside the gold arc";
      }
      s.flash = { t, bad: !good, side: s.toolSide };
      s.revision++;
      if (
        s.cutsMade >= a.target ||
        (a.mistakeLimit && s.faults >= a.mistakeLimit)
      )
        s.done = true;
    }
    return s;
  }
  if (a.mode === "quarrying") {
    if (type === 6 && x < a.nodes.length && t - s.lastStrike >= 380) {
      s.lastStrike = t;
      s.selectedNode = x;
      s.attempts++;
      const good = x === a.order[s.oreFound] && s.rockHP[x] > 0,
        pulse = toolPulse(s, t),
        critical = pulse > (a.precision ? 0.88 : 0.72),
        timed = !a.precision || pulse > 0.66;
      if (good && timed) {
        s.rockHP[x] = Math.max(0, s.rockHP[x] - (critical ? 2 : 1));
        s.cleanHits++;
        if (critical) s.criticals++;
        if (!s.rockHP[x]) s.oreFound++;
        s.message = critical ? "Perfect fracture!" : "Crack opened";
      } else {
        s.faults++;
        s.message = good
          ? "Glancing hit — wait for the gold ring"
          : "Hit the glowing crack";
      }
      s.flash = { t, bad: !good || !timed, node: x };
      s.revision++;
      if (
        s.oreFound >= a.target ||
        (a.mistakeLimit && s.faults >= a.mistakeLimit)
      )
        s.done = true;
    }
    return s;
  }
  if (a.mode === "carpentry") {
    if (a.workbench && s.carpentryStep < 2) {
      const stage = s.carpentryStep;
      if (type === 0) {
        s.pointer = [x, y];
        s.craftDistance = 0;
        s.craftDirection = 0;
      }
      if ((type === 1 || type === 2) && s.pointer) {
        const previous = s.pointer,
          delta = stage === 0 ? y - previous[1] : x - previous[0],
          direction = Math.sign(delta),
          onGuide =
            stage === 0
              ? Math.abs(x - a.cutX) < 0.15 &&
                Math.abs(previous[0] - a.cutX) < 0.15
              : Math.abs(y - 0.5) < 0.23 && Math.abs(previous[1] - 0.5) < 0.23;
        s.pointer = [x, y];
        if (!onGuide) {
          s.craftDistance = 0;
          s.message =
            stage === 0
              ? "Keep the saw on its gold guide"
              : "Move across the middle of the plank";
        } else if (Math.abs(delta) > 0.002) {
          if (direction !== s.craftDirection) s.craftDistance = 0;
          s.craftDirection = direction;
          s.craftDistance += Math.abs(delta);
          if (
            s.craftDistance >= (stage === 0 ? 0.26 : 0.48) &&
            direction !== s.craftLastDirection
          ) {
            s.craftStrokes[stage]++;
            s.craftLastDirection = direction;
            s.craftDistance = 0;
            s.revision++;
            s.flash = { t, bad: false };
            s.message =
              stage === 0
                ? "Cut deeper — reverse the saw"
                : "Smooth pass — come back across";
            if (
              s.craftStrokes[stage] >=
              (stage === 0 ? a.workbench.saw : a.workbench.plane)
            ) {
              s.carpentryStep++;
              s.pointer = null;
              s.craftLastDirection = 0;
              s.craftDistance = 0;
              s.craftDirection = 0;
              s.message =
                stage === 0
                  ? "Cut finished — plane back and forth"
                  : "Smooth timber — set the four nails";
            }
          }
        }
        if (type === 2) s.pointer = null;
      }
      return s;
    }
    if (type === 0 && s.carpentryStep < 2) {
      s.pointer = [x, y];
      s.craftTrace = [[x, y]];
    }
    if (type === 1 && s.pointer) s.craftTrace.push([x, y]);
    if (type === 2 && s.pointer) {
      s.craftTrace.push([x, y]);
      const p = s.pointer,
        trace = s.craftTrace;
      let good = false;
      if (s.carpentryStep === 0)
        good =
          Math.abs(y - p[1]) > 0.42 &&
          trace.every((point) => Math.abs(point[0] - a.cutX) < 0.105);
      else
        good =
          Math.abs(x - p[0]) > 0.55 &&
          trace.every((point) => Math.abs(point[1] - 0.5) < 0.18);
      s.pointer = null;
      if (good) {
        s.carpentryStep++;
        s.revision++;
        s.message =
          s.carpentryStep === 1
            ? "Cut made — plane along the grain"
            : "Smooth timber — set the four nails";
      } else
        s.message =
          s.carpentryStep === 0
            ? "Saw down the marked line"
            : "Slide the plane along the board";
    }
    if (
      type === 6 &&
      s.carpentryStep === 2 &&
      x < 4 &&
      s.nailHP[x] > 0 &&
      t - s.lastStrike >= 300
    ) {
      s.lastStrike = t;
      const critical = toolPulse(s, t) > 0.72;
      s.nailHP[x] = Math.max(0, s.nailHP[x] - (critical ? 2 : 1));
      s.flash = { t, bad: false, node: x };
      s.revision++;
      s.message = critical ? "Nail seated in one hit" : "One more hit";
      if (s.nailHP.every((n) => !n)) s.done = true;
    }
    return s;
  }
  if (a.mode === "match3") {
    const cell =
      Math.min(4, Math.floor(x * 5)) + Math.min(4, Math.floor(y * 5)) * 5;
    if (type === 0) s.matchStart = cell;
    if (type === 2 && s.matchStart !== undefined) {
      swapMatch3(s, s.matchStart, cell);
      s.matchStart = undefined;
    }
    return s;
  }
  if (a.mode === "trail" && type === 5 && t - s.jumpAt >= 1250) {
    s.jumpAt = t;
    s.message = "Hop!";
  }
  if (["logging", "mining"].includes(a.mode)) {
    if (type === 6 && !s.charging) {
      if (a.mode === "logging" && x < 2) s.toolSide = x;
      if (a.mode === "mining" && x < a.nodes.length) s.selectedNode = x;
    }
    if (type === 0 && !s.charging && t - s.lastStrike >= 350) {
      s.charging = true;
      s.chargeStarted = t;
    }
    if (type === 2 && s.charging) {
      const power = (t - s.chargeStarted) / 1000;
      s.charging = false;
      s.lastStrike = t;
      s.attempts++;
      const strong = power >= 0.66 && power <= 0.9,
        light = power >= 0.36 && power < 0.66;
      let good = false;
      if (a.mode === "logging") {
        good =
          power >= 0.52 &&
          power <= 0.86 &&
          s.toolSide === a.notches[s.cutsMade] &&
          s.stamina >= 0.23;
        s.stamina = Math.max(0, s.stamina - 0.27);
        if (good) {
          s.cutsMade++;
          s.cleanHits++;
          s.message = "Clean split — read the next notch";
        } else
          s.message =
            s.stamina < 0.06
              ? "Catch your breath before the next swing"
              : s.toolSide !== a.notches[s.cutsMade]
                ? "Strike from the marked side"
                : "Release inside the brass band";
        if (s.cutsMade >= a.target) s.done = true;
      } else {
        const index = s.selectedNode,
          type = a.nodes[index];
        if (!s.rockHP[index])
          s.message = "This pocket is clear — choose another";
        else if (type === "brittle" || (!strong && !light)) {
          s.stress = clamp(s.stress + 0.3);
          s.message =
            type === "brittle"
              ? "Loose shale! The ceiling is shifting"
              : "Wild swing — ease off the power";
        } else {
          good = true;
          s.rockHP[index] = Math.max(0, s.rockHP[index] - (strong ? 2 : 1));
          if (type === "brace") {
            if (!s.rockHP[index]) {
              s.stress = Math.max(0, s.stress - 0.45);
              s.braced++;
            }
            s.message = "Support seated — the vein is safer";
          } else {
            s.stress = clamp(s.stress + (strong ? 0.29 : 0.17));
            if (!s.rockHP[index]) {
              s.oreFound++;
              s.message = "Iron pocket freed";
            } else s.message = "Fracture opened — one more light hit";
          }
          s.cleanHits++;
        }
        if (s.stress >= 1) {
          s.done = true;
          s.message = "Cave-in. Seat a support before mining more iron.";
        } else if (s.oreFound >= a.target) s.done = true;
      }
      s.flash = { t, bad: !good, node: s.selectedNode, side: s.toolSide };
      s.revision++;
    }
    return s;
  }
  if (a.mode === "forge") {
    if (type === 0 && !s.heating) {
      s.heating = true;
      s.heatStarted = t;
    }
    if (type === 2) {
      if (
        a.recipe?.thermal &&
        s.heating &&
        t - s.heatStarted >= 450 &&
        s.heat >= a.recipe.hot[0] + 0.1
      )
        s.heatBatchHits = 0;
      s.heating = false;
    }
    if (type === 6 && x < 3 && t - s.lastStrike >= 320) {
      s.lastStrike = t;
      if (s.heating) s.message = "Release the bellows before hammering";
      else if (a.recipe?.thermal && s.heatBatchHits >= 2)
        s.message = "Two strikes shaped this heat — reheat the metal";
      else if (s.sections[x] >= (a.recipe?.sections[x] ?? 2))
        s.message = "This section is shaped. Work another.";
      else if (
        a.recipe &&
        x !== a.recipe.order[s.sections.reduce((n, v) => n + v, 0)]
      )
        s.message = "Follow the glowing hammer mark";
      else if (
        s.heat < (a.recipe?.hot[0] ?? 0.45) ||
        s.heat > (a.recipe?.hot[1] ?? 0.9)
      ) {
        s.faults++;
        s.message =
          s.heat < 0.45
            ? "Metal is too cold — reheat it"
            : "Let the metal cool into the gold band";
        s.flash = { t, bad: true };
      } else {
        s.sections[x]++;
        s.heatBatchHits++;
        s.heat = Math.max(0, s.heat - (a.recipe?.thermal ? 0.16 : 0.04));
        s.revision++;
        s.flash = { t, bad: false, section: x };
        s.message = s.sections.every(
          (n, i) => n === (a.recipe?.sections[i] ?? 2),
        )
          ? "Blade shaped — quench it in water"
          : "Clean strike. Keep the metal hot.";
      }
    }
    if (type === 5) {
      s.heating = false;
      s.quenched =
        s.sections.every((n, i) => n === (a.recipe?.sections[i] ?? 2)) &&
        s.heat >= (a.recipe?.quench[0] ?? 0.35) &&
        s.heat <= (a.recipe?.quench[1] ?? 0.7);
      s.message = s.quenched
        ? "Tempered steel. Ready for the expedition."
        : "Quench only a shaped blade in the blue band";
      s.done = true;
    }
  }
  if (a.mode === "slice") {
    if (type === 0) {
      s.pointer = [x, y];
      s.combo = 0;
    }
    if ((type === 1 || type === 2) && s.pointer) {
      if (Math.hypot(x - s.pointer[0], y - s.pointer[1]) > 0.025)
        a.items.forEach((item) => {
          const p = insect(item, t);
          if (
            p &&
            !s.hits.includes(item.id) &&
            segmentDistance(p, s.pointer, [x, y]) <= 0.067
          ) {
            s.hits.push(item.id);
            s.revision++;
            if (item.friendly) {
              s.friendly++;
              s.combo = 0;
              s.message = "That was a lantern bug — leave it flying";
              s.flash = { t, bad: true };
            } else {
              s.combo++;
              s.bestCombo = Math.max(s.bestCombo, s.combo);
              s.message =
                s.combo > 1
                  ? `${s.combo} in one sweep`
                  : "Spore beetle cleared";
            }
          }
        });
      s.pointer = type === 2 ? null : [x, y];
    }
  }
  if (["convoy", "trail", "duel"].includes(a.mode)) {
    if (["convoy", "trail"].includes(a.mode) && a.balance) {
      if (type === 0) s.bracing = true;
      if (type === 2) s.bracing = false;
    }
    if (type === 4) s.targetX = 0.22 + x * 0.28;
    if (
      ["convoy", "trail"].includes(a.mode) &&
      !a.balance &&
      [0, 1, 2].includes(type)
    )
      s.targetX = clamp(x, 0.18, 0.82);
    if (a.mode === "duel" && type === 5 && t - s.lastStrike >= 650) {
      s.lastStrike = t;
      const i = a.attacks.findIndex(
        (attack) =>
          t >= attack.at + 80 &&
          t <= attack.at + 850 &&
          Math.abs(s.x - (0.22 + attack.safe * 0.28)) < 0.13,
      );
      if (i >= 0 && !s.countered.includes(i)) {
        s.countered.push(i);
        s.counters++;
        s.flash = { t, bad: false };
        s.message = "Counter landed";
      } else s.message = "No opening. Watch the next charge.";
    }
  }
  if (
    a.mode === "stack" &&
    type === 3 &&
    t - (s.boards.at(-1)?.t ?? -500) >= 350
  ) {
    let x = boardX(s),
      width = s.width;
    const error = Math.abs(x - s.center),
      perfect = error <= 0.035;
    if (perfect) {
      x = s.center;
      s.perfect++;
      s.message = "Flush edges";
    } else {
      const left = Math.max(s.center - width / 2, x - width / 2),
        right = Math.min(s.center + width / 2, x + width / 2);
      width = Math.max(0, right - left);
      x = (left + right) / 2;
      s.cuts.push({ x: boardX(s), width: s.width, t });
      s.message = "Overhang trimmed — less room for the next board";
    }
    s.width = width;
    s.center = x;
    s.boards.push({ x, width, t, perfect });
    s.revision++;
    if (width < 0.2 || s.boards.length === a.levels) s.done = true;
  }
  if (a.mode === "pipes" && type === 6 && s.moves < a.moves) {
    s.tiles[x] = turnMask(s.tiles[x]);
    s.moves++;
    s.flow = flow(s.tiles);
    s.revision++;
    const solved = s.flow.includes(5) && s.tiles[5] & 2;
    s.message = solved
      ? "Oil is flowing. Axle repaired."
      : `${a.moves - s.moves} turns left`;
    if (solved || s.moves >= a.moves) s.done = true;
  }
  if (a.mode === "herbs") {
    if (type === 0) {
      s.chain = [];
      addHerb(s, herbCell(x, y));
      s.pointer = [x, y];
    }
    if (type === 1 && s.pointer) traceHerbs(s, x, y);
    if (type === 2 && s.pointer) {
      traceHerbs(s, x, y);
      s.pointer = null;
      if (s.chain.length >= 3) {
        s.moves++;
        s.harvested += s.chain.length;
        s.revision++;
        const rng = random(s.c.seed + ++s.refill * 997);
        for (let col = 0; col < 4; col++) {
          const kept = [0, 1, 2, 3]
            .map((row) => row * 4 + col)
            .filter((i) => !s.chain.includes(i))
            .map((i) => s.board[i]);
          while (kept.length < 4) kept.unshift(Math.floor(rng() * 3));
          kept.forEach((value, row) => (s.board[row * 4 + col] = value));
        }
        ensureHerbs(s.board);
        s.message = `${s.chain.length} herbs brewed`;
      } else s.message = "Link at least three matching herbs, edge to edge";
      s.chain = [];
      if (s.moves >= a.moves || s.harvested >= a.target) s.done = true;
    }
  }
  return s;
}
function grade(s) {
  const a = s.c.arcade;
  let quality = 0;
  if (a.mode === "chopping")
    quality =
      s.cutsMade >= a.target
        ? clamp(0.7 + (0.3 * s.cleanHits) / Math.max(1, s.attempts))
        : 0;
  if (a.mode === "quarrying")
    quality =
      s.oreFound >= a.target
        ? clamp(0.7 + (0.3 * s.criticals) / Math.max(1, s.attempts))
        : 0;
  if (a.mode === "carpentry")
    quality = s.nailHP.every((n) => !n) && s.carpentryStep === 2 ? 1 : 0;
  if (a.mode === "match3")
    quality = a.orders.every((n, i) => s.collected[i] >= n)
      ? clamp(0.7 + (a.moves - s.moves) * 0.03)
      : 0;
  if (a.mode === "logging")
    quality =
      s.cutsMade >= a.target
        ? clamp(0.7 + (0.3 * s.cleanHits) / Math.max(1, s.attempts))
        : 0;
  if (a.mode === "mining")
    quality =
      s.oreFound >= a.target && s.stress < 1
        ? clamp(
            0.7 +
              s.braced * 0.1 +
              (0.1 * s.cleanHits) / Math.max(1, s.attempts),
          )
        : 0;
  if (a.mode === "forge")
    quality = s.quenched ? Math.max(0.65, 1 - s.faults * 0.07) : 0;
  if (a.mode === "slice") {
    const good = s.hits.filter((id) => !a.items[id].friendly).length;
    quality =
      s.friendly > 1
        ? 0
        : clamp(
            (good - s.friendly) / a.items.filter((i) => !i.friendly).length,
          );
  }
  if (["convoy", "trail"].includes(a.mode))
    quality =
      s.health > 0 && s.crates >= 3
        ? clamp(0.6 + (s.health - 1) * 0.1 + (s.crates - 3) * 0.1)
        : 0;
  if (a.mode === "duel")
    quality =
      s.dodges >= 2 && s.counters >= 1
        ? clamp(0.6 + (s.dodges - 2) * 0.1 + (s.counters - 1) * 0.15)
        : 0;
  if (a.mode === "stack")
    quality =
      s.boards.length === a.levels && s.width >= 0.2
        ? clamp(0.6 + s.width * 0.45 + s.perfect * 0.02)
        : 0;
  if (a.mode === "pipes")
    quality =
      s.flow.includes(5) && s.tiles[5] & 2
        ? clamp(1 - (s.moves / a.moves) * 0.25)
        : 0;
  if (a.mode === "herbs")
    quality =
      s.harvested >= a.target ? clamp(0.7 + (a.moves - s.moves) * 0.1) : 0;
  return {
    valid: true,
    quality: Math.round(quality * 100),
    passed: quality >= 0.6,
  };
}
function replay(c, input, elapsed) {
  const events = input?.events;
  if (
    !c.arcade ||
    !Object.values(modes).includes(c.arcade.mode) ||
    !Array.isArray(events) ||
    !events.length ||
    events.length > 256
  )
    return { valid: false };
  let last = -1;
  for (const e of events) {
    if (!Array.isArray(e) || e.length !== 4 || !e.every(Number.isFinite))
      return { valid: false };
    const [t, type, x, y] = e;
    if (
      t < last ||
      t < 0 ||
      t > c.arcade.duration ||
      !Number.isInteger(type) ||
      type < 0 ||
      type > 7 ||
      y < 0 ||
      y > 1
    )
      return { valid: false };
    if (
      type === 6
        ? !Number.isInteger(x) || x < 0 || x > 8
        : type === 4
          ? !Number.isInteger(x) || x < 0 || x > 2
          : x < 0 || x > 1
    )
      return { valid: false };
    last = t;
  }
  const s = create(c);
  for (const e of events) act(s, e);
  if (!s.done) advance(s, c.arcade.duration);
  if (s.t < 300 || s.t > elapsed * 1000 + 150) return { valid: false };
  return grade(s);
}
module.exports = {
  toolPulse,
  match3Matches,
  match3Moves,
  swapMatch3,
  sawProgress,
  compactSawTrace,
  modes,
  make,
  create,
  advance,
  act,
  grade,
  replay,
  insect,
  boardX,
  flow,
  pipeSolution,
  turnMask,
  herbCell,
};
