import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const core = require("./core");

// Intentional input recordings for rule tests; never used by the game client.
export function arcadeGesture(c) {
  const a = c.arcade,
    events = [];
  if (a.mode === "forge") {
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
  if (a.mode === "convoy")
    for (const row of a.rows) events.push([row.at + 800, 4, row.crate, 0]);
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
