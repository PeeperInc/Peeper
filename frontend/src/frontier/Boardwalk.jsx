import React from "react";
import roads from "../../../backend/frontier/roads.json";
// The eastern mill stands over water. Its walkable approach is a timber
// boardwalk drawn from the same waypoints used by server movement.
const edge = roads.edges.find(([a, b]) => a === "east" && b === "mill");
const path = [roads.nodes.east, ...edge[3], roads.nodes.mill].map((p) =>
  p.map((n) => n * 1254),
);
const boards = [];
let carry = 0;
for (let i = 1; i < path.length; i++) {
  const a = path[i - 1],
    b = path[i],
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    len = Math.hypot(dx, dy);
  for (let d = carry; d < len; d += 13) {
    const x = a[0] + (dx * d) / len,
      y = a[1] + (dy * d) / len;
    boards.push([
      x - (dy / len) * 14,
      y + (dx / len) * 14,
      x + (dy / len) * 14,
      y - (dx / len) * 14,
    ]);
  }
  carry = (carry - len) % 13;
  if (carry < 0) carry += 13;
}
export default function Boardwalk() {
  const points = path.map((p) => p.join(",")).join(" ");
  return (
    <svg className="world-route" viewBox="0 0 1254 1254" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="#2e3023"
        strokeWidth="32"
        strokeLinejoin="round"
      />
      <polyline
        points={points}
        fill="none"
        stroke="#b29660"
        strokeWidth="27"
        strokeLinejoin="round"
      />
      <polyline
        points={points}
        fill="none"
        stroke="#d0b77866"
        strokeWidth="8"
        strokeLinejoin="round"
      />
      {boards.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#534a31"
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}
