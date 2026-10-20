import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const core = require("./core");

// Intentional input recordings for rule tests; never used by the game client.
export function arcadeGesture(c) {
  const a = c.arcade,
    events = [];
  if (a.mode === "chopping")
    for (let i = 0; i < 6; i++)
      events.push(
        [400 + i * 1300, 6, a.notches[i], 0],
        [450 + i * 1300, 0, 0, 0],
        [
          450 +
            i * 1300 +
            (a.windows ? (a.windows[i][0] + a.windows[i][1]) / 2 : 650),
          2,
          0,
          0,
        ],
      );
  if (a.mode === "quarrying") {
    const s = core.create(c);
    for (let t = 400; t < 14000 && !s.done; t += 30) {
      if (
        t - s.lastStrike < 390 ||
        (a.precision && core.toolPulse(s, t) <= 0.88)
      )
        continue;
      const e = [t, 6, a.order[s.oreFound], 0];
      events.push(e);
      core.act(s, e);
    }
  }
  if (a.mode === "carpentry") {
    if (a.workbench)
      events.push(
        [300, 0, a.cutX, 0.2],
        [700, 1, a.cutX, 0.75],
        [1100, 1, a.cutX, 0.2],
        [1500, 1, a.cutX, 0.75],
        [1900, 2, a.cutX, 0.2],
        [2200, 0, 0.16, 0.5],
        [2700, 1, 0.84, 0.5],
        [3200, 2, 0.16, 0.5],
      );
    else
      events.push(
        [300, 0, a.cutX, 0.2],
        [650, 1, a.cutX, 0.5],
        [1000, 2, a.cutX, 0.8],
        [1400, 0, 0.16, 0.5],
        [1800, 1, 0.5, 0.5],
        [2200, 2, 0.84, 0.5],
      );
    const s = core.create(c);
    events.forEach((e) => core.act(s, e));
    for (let t = a.workbench ? 3700 : 2600; t < 14000 && !s.done; t += 450) {
      const e = [t, 6, s.nailHP.findIndex((n) => n > 0), 0];
      events.push(e);
      core.act(s, e);
    }
  }
  if (a.mode === "match3") {
    let beam = [{ s: core.create(c), path: [] }],
      won;
    const score = (s) =>
      a.orders.reduce((n, v, i) => n + Math.min(v, s.collected[i]) * 10, 0) +
      s.harvested * 0.03;
    for (let depth = 0; depth < a.moves && !won; depth++) {
      const next = [];
      for (const entry of beam)
        for (const move of core.match3Moves(entry.s.board)) {
          const s = structuredClone(entry.s);
          core.swapMatch3(s, ...move);
          const node = { s, path: [...entry.path, move] };
          if (core.grade(s).passed) {
            won = node;
            break;
          }
          if (!s.done) next.push(node);
        }
      next.sort((x, y) => score(y.s) - score(x.s));
      beam = next.slice(0, 18);
      if (!beam.length) break;
    }
    const path = won?.path || beam[0]?.path || [];
    path.forEach(([from, to], i) =>
      events.push(
        [
          400 + i * 800,
          0,
          ((from % 5) + 0.5) / 5,
          (Math.floor(from / 5) + 0.5) / 5,
        ],
        [
          700 + i * 800,
          2,
          ((to % 5) + 0.5) / 5,
          (Math.floor(to / 5) + 0.5) / 5,
        ],
      ),
    );
  }
  if (a.mode === "logging") {
    for (let i = 0; i < a.target; i++)
      events.push(
        [400 + i * 1800, 6, a.notches[i], 0],
        [450 + i * 1800, 0, 0, 0],
        [1150 + i * 1800, 2, 0, 0],
      );
  }
  if (a.mode === "mining") {
    const order = [
      a.nodes.indexOf("brace"),
      ...a.nodes
        .map((type, i) => (type === "ore" ? i : -1))
        .filter((i) => i >= 0),
    ];
    order.forEach((node, i) =>
      events.push(
        [400 + i * 1400, 6, node, 0],
        [450 + i * 1400, 0, 0, 0],
        [1200 + i * 1400, 2, 0, 0],
      ),
    );
  }
  if (a.mode === "forge" && a.recipe) {
    const s = core.create(c);
    function push(e) {
      events.push(e);
      core.act(s, e);
    }
    for (let t = 400; t < 14500 && !s.done; t += 40) {
      core.advance(s, t);
      const formed = s.sections.every((n, i) => n === a.recipe.sections[i]);
      if (formed) {
        if (s.heating) push([t, 2, 0, 0]);
        else if (s.heat >= a.recipe.quench[0] && s.heat <= a.recipe.quench[1])
          push([t, 5, 0, 0]);
      } else if (s.heating && s.heat >= 0.81) push([t, 2, 0, 0]);
      else if (
        !s.heating &&
        (s.heat < 0.62 || (a.recipe.thermal && s.heatBatchHits >= 2))
      )
        push([t, 0, 0, 0]);
      else if (!s.heating && t - s.lastStrike >= 420)
        push([t, 6, a.recipe.order[s.sections.reduce((n, v) => n + v, 0)], 0]);
    }
  }
  if (a.mode === "forge" && !a.recipe) {
    events.push([300, 0, 0, 0], [2000, 2, 0, 0]);
    events.push([2200, 6, 0, 0], [2600, 6, 1, 0], [3000, 6, 2, 0]);
    events.push([3200, 0, 0, 0], [3900, 2, 0, 0]);
    events.push([4200, 6, 2, 0], [4600, 6, 1, 0], [5000, 6, 0, 0]);
    events.push([5400, 5, 0, 0]);
  }
  if (a.mode === "slice")
    for (const item of a.items.filter((i) => !i.friendly)) {
      // Wait for separation rather than cutting through friendly insects in wind.
      for (
        let t = Math.max(item.at + 450, (events.at(-1)?.[0] ?? 0) + 100);
        t < item.at + item.life - 100;
        t += 70
      ) {
        const p = core.insect(item, t + 50);
        if (
          a.items
            .filter((i) => i.friendly && t >= i.at && t < i.at + 2000)
            .some((i) => {
              const other = core.insect(i, t + 50);
              return (
                other && Math.hypot(p[0] - other[0], p[1] - other[1]) < 0.17
              );
            })
        )
          continue;
        events.push(
          [t, 0, p[0] - 0.04, p[1]],
          [t + 50, 1, p[0] + 0.04, p[1]],
          [t + 70, 2, p[0] + 0.04, p[1]],
        );
        break;
      }
    }
  if (["convoy", "trail"].includes(a.mode))
    for (const row of a.rows) {
      if (a.balance) events.push([row.at + 600, 0, 0, 0]);
      events.push([row.at + 800, 4, row.crate, 0]);
      if (a.balance) events.push([row.at + 1500, 2, 0, 0]);
    }
  if (a.mode === "duel")
    for (const attack of a.attacks)
      events.push(
        [attack.at - 900, 4, attack.safe, 0],
        [attack.at + 200, 5, 0, 0],
      );
  if (a.mode === "stack") {
    const s = core.create(c);
    for (let t = 400; t < 11000 && !s.done; t += 20) {
      core.advance(s, t);
      if (
        Math.abs(core.boardX(s) - s.center) < 0.02 &&
        t - (events.at(-1)?.[0] ?? -500) > 400
      ) {
        const e = [t, 3, 0, 0];
        events.push(e);
        core.act(s, e);
      }
    }
  }
  if (a.mode === "pipes") {
    const target = core.pipeSolution(c.seed),
      tiles = a.tiles.slice();
    target.forEach((mask, i) => {
      if (!mask) return;
      while (tiles[i] !== mask) {
        events.push([400 + events.length * 300, 6, i, 0]);
        tiles[i] = core.turnMask(tiles[i]);
      }
    });
  }
  if (a.mode === "herbs") {
    const s = core.create(c);
    for (let move = 0; move < a.moves && !s.done; move++) {
      let best = [];
      function walk(path) {
        if (path.length > best.length) best = path.slice();
        if (path.length >= 9) return;
        const p = path.at(-1);
        for (let i = 0; i < 16; i++)
          if (
            !path.includes(i) &&
            s.board[i] === s.board[p] &&
            Math.abs((i % 4) - (p % 4)) +
              Math.abs(Math.floor(i / 4) - Math.floor(p / 4)) ===
              1
          )
            walk([...path, i]);
      }
      for (let i = 0; i < 16; i++) walk([i]);
      if (best.length < 3) break;
      const start = 400 + move * 1600;
      best.forEach((index, j) => {
        const e = [
          start + j * 70,
          j ? 1 : 0,
          0.2 + (index % 4) * 0.2,
          0.305 + Math.floor(index / 4) * 0.15,
        ];
        events.push(e);
        core.act(s, e);
      });
      const p = events.at(-1),
        e = [p[0] + 70, 2, p[2], p[3]];
      events.push(e);
      core.act(s, e);
    }
  }
  events.sort((x, y) => x[0] - y[0]);
  return { events };
}
