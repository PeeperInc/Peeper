"use strict";

// Shared deterministic rules. No renderer, clock, browser or database dependencies.
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const modes = {
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
function make(kind, seed, weather = "clear") {
  const rng = random(seed),
    pick = (n) => Math.floor(rng() * n);
  const c = {
    mode: modes[kind],
    duration:
      kind === "forge"
        ? 18000
        : ["plane", "crank", "rune"].includes(kind)
          ? 12000
          : 9500,
    steering: weather === "rain" ? 1.05 : 1.5,
  };
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
        sway: (weather === "wind" ? 0.08 : 0.025) * (rng() < 0.5 ? -1 : 1),
        phase: rng() * Math.PI * 2,
      });
    }
    for (let i = 0; i < 8; i++) flight(450 + i * 920 + pick(130), false);
    for (let i = 0; i < 3; i++) flight(1150 + i * 2600 + pick(350), true);
    c.items.sort((a, b) => a.at - b.at);
    c.items.forEach((item, id) => (item.id = id));
  }
  if (c.mode === "convoy") {
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
    c.target = weather === "harvest" ? 8 : 9;
  }
  return c;
}
function create(c) {
  return {
    c,
    heat: 0.25,
    heating: false,
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
    const boundaries =
      a.mode === "convoy"
        ? a.rows.map((row) => row.at + 1800)
        : a.mode === "duel"
          ? a.attacks.map((attack) => attack.at)
          : [];
    const boundary = Math.min(...boundaries.filter((t) => t > s.t));
    const prev = s.t;
    s.t = Math.min(until, s.t + 20, boundary);
    const dt = (s.t - prev) / 1000;
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
    s.x += clamp(s.targetX - s.x, -dt * a.steering, dt * a.steering);
    if (a.mode === "convoy")
      a.rows.forEach((row, i) => {
        if (!s.crossed.includes(i) && s.t >= row.at + 1800) {
          s.crossed.push(i);
          if (Math.abs(s.x - (0.22 + row.obstacle * 0.28)) < 0.14) {
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
    return s;
  }
  if (a.mode === "forge") {
    if (type === 0) s.heating = true;
    if (type === 2) s.heating = false;
    if (type === 6 && x < 3 && t - s.lastStrike >= 320) {
      s.lastStrike = t;
      if (s.heating) s.message = "Release the bellows before hammering";
      else if (s.sections[x] >= 2)
        s.message = "This section is shaped. Work another.";
      else if (s.heat < 0.45 || s.heat > 0.9) {
        s.faults++;
        s.message =
          s.heat < 0.45
            ? "Metal is too cold — reheat it"
            : "Let the metal cool into the gold band";
        s.flash = { t, bad: true };
      } else {
        s.sections[x]++;
        s.heat = Math.max(0, s.heat - 0.04);
        s.revision++;
        s.flash = { t, bad: false, section: x };
        s.message = s.sections.every((n) => n === 2)
          ? "Blade shaped — quench it in water"
          : "Clean strike. Keep the metal hot.";
      }
    }
    if (type === 5) {
      s.heating = false;
      s.quenched =
        s.sections.every((n) => n === 2) && s.heat >= 0.35 && s.heat <= 0.7;
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
  if (a.mode === "convoy" || a.mode === "duel") {
    if (type === 4) s.targetX = 0.22 + x * 0.28;
    if (a.mode === "convoy" && [0, 1, 2].includes(type))
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
  if (a.mode === "convoy")
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
