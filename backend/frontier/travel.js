"use strict";
// The server route and the 3D roads use this same waypoint network.
const { nodes, edges } = require("./roads.json");
function findRoute(from, to, completed) {
  if (!nodes[from] || !nodes[to]) return null;
  const queue = [{ node: from, path: [nodes[from]], cost: 0 }],
    seen = new Set();
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (current.node === to) return current.path;
    if (seen.has(current.node)) continue;
    seen.add(current.node);
    for (const [a, b, gate, via] of edges) {
      if (gate && !completed.includes(gate)) continue;
      const next = current.node === a ? b : current.node === b ? a : null;
      if (!next || seen.has(next)) continue;
      const segment = [nodes[a], ...via, nodes[b]];
      if (current.node === b) segment.reverse();
      const cost = segment
        .slice(1)
        .reduce(
          (n, p, i) =>
            n + Math.hypot(p[0] - segment[i][0], p[1] - segment[i][1]),
          0,
        );
      queue.push({
        node: next,
        path: [...current.path, ...segment.slice(1)],
        cost: current.cost + cost,
      });
    }
  }
  return null;
}
module.exports = { nodes, findRoute };
