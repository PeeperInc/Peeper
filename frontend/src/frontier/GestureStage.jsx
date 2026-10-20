import React, { useEffect, useRef, useState } from "react";
import workshop from "../assets/frontier/workshop.webp";
import bossArt from "../assets/frontier/leech-king.webp";
import marshArt from "../assets/frontier/marsh-world.webp";
import cartArt from "../assets/frontier/cart.webp";
import propsArt from "../assets/frontier/workshop-props.png";
import ArcadeStage from "./ArcadeStage";
import core from "@peeper/frontier-core";

const instructions = {
  saw: [
    "Saw a straight cut",
    "Move up and down between the guides. A little wobble is fine.",
  ],
  mine: [
    "Break the iron vein",
    "Drag the hammer onto a glowing crack. Release when the power enters gold.",
  ],
  plane: [
    "Follow the grain",
    "Drag the plane from the brass handle to the end of the board.",
  ],
  pack: [
    "Pack the expedition kit",
    "Drag all three items into the satchel. Tap an item to rotate it.",
  ],
  steer: [
    "Keep the cargo upright",
    "Guide the cart along the trail. Stay clear of the muddy edges.",
  ],
  guard: ["Cover your party", "Slash across each incoming spore, in order."],
  crank: ["Repair the axle", "Grip the handle and wind two complete turns."],
  dodge: [
    "Find an opening",
    "Drag your fighter around the poison pools to the exposed weak spot.",
  ],
  rune: ["Restore the ward", "Draw the healing seal in one continuous stroke."],
};
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
function rotate(shape, n) {
  let cells = shape.map((p) => [...p]);
  for (let i = 0; i < n; i++) cells = cells.map(([x, y]) => [-y, x]);
  const x = Math.min(...cells.map((p) => p[0])),
    y = Math.min(...cells.map((p) => p[1]));
  return cells.map((p) => [p[0] - x, p[1] - y]);
}
const ink = "#22251a",
  bone = "#f0dfad",
  gold = "#d7b86c";
export default function GestureStage(props) {
  return props.challenge?.arcade ? (
    <ArcadeStage {...props} />
  ) : (
    <WorkshopGesture {...props} />
  );
}
function WorkshopGesture({
  challenge,
  disabled,
  onComplete,
  boss = false,
  feedback,
}) {
  const canvas = useRef(null),
    state = useRef(null),
    submit = useRef(onComplete),
    blocked = useRef(disabled),
    [readout, setReadout] = useState(""),
    [progress, setProgress] = useState(0);
  submit.current = onComplete;
  blocked.current = disabled;
  useEffect(() => {
    if (!challenge) return;
    const c = challenge,
      element = canvas.current,
      ctx = element.getContext("2d");
    let disposed = false,
      raf,
      lastUpdate = 0;
    const s = {
      trace: [],
      base: 0,
      down: null,
      pointer: [0.5, 0.65],
      turns: 0,
      band: 0,
      hits: 0,
      strikes: 0,
      combo: 0,
      impact: null,
      angle: 0,
      lastAngle: null,
      drag: null,
      placements: [null, null, null],
      rotations: [0, 0, 0],
      particles: [],
      message: "",
      finished: false,
      quality: 1,
    };
    state.current = s;
    setReadout("");
    setProgress(0);
    const observer = new ResizeObserver(() => {
      const r = element.getBoundingClientRect(),
        d = Math.min(devicePixelRatio || 1, 2);
      element.width = Math.round(r.width * d);
      element.height = Math.round(r.height * d);
    });
    observer.observe(element);
    const sprite = new Image();
    if (c.kind === "dodge") sprite.src = bossArt;
    const cart = new Image();
    if (c.kind === "steer") cart.src = cartArt;
    const atlas = new Image();
    if (["saw", "mine", "plane"].includes(c.kind)) atlas.src = propsArt;
    const frames = {
      log: [5, 85, 534, 326],
      rock: [565, 18, 429, 426],
      plank: [1017, 170, 514, 208],
      saw: [181, 416, 184, 585],
      hammer: [647, 459, 220, 547],
      plane: [1020, 550, 495, 382],
    };
    function prop(name, x, y, w, h) {
      const f = frames[name];
      ctx.drawImage(atlas, ...f, x, y, w, h);
    }

    function polygon(points, fill, stroke = ink, line = 2) {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.lineWidth = line;
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    }
    function line(points, color, width = 2, dash = []) {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.setLineDash([]);
    }
    function circle(x, y, r, fill, stroke = ink, width = 2) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }
    function wood(x, y, w, h) {
      polygon(
        [
          [x, y + 5],
          [x + w - 5, y],
          [x + w, y + h - 3],
          [x + 3, y + h],
        ],
        "#a67949",
      );
      for (let i = 1; i < 8; i++)
        line(
          [
            [x + 8, y + (h * i) / 8],
            [x + w * 0.3, y + (h * i) / 8 + Math.sin(i) * 5],
            [x + w * 0.7, y + (h * i) / 8 - 3],
            [x + w - 8, y + (h * i) / 8 + 2],
          ],
          i % 2 ? "#664628" : "#d0a56c",
          1.2,
        );
    }
    function particle(x, y, color = gold) {
      for (let i = 0; i < 9; i++)
        s.particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 2,
          vy: -Math.random() * 2,
          life: 1,
          color,
        });
    }
    s.burst = (x, y, color) => {
      particle(x, y, color);
      try {
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
      } catch {}
    };
    function draw(t) {
      if (disposed) return;
      const w = element.width,
        h = element.height;
      ctx.setTransform(w, 0, 0, h, 0, 0);
      ctx.clearRect(0, 0, 1, 1);
      ctx.setTransform(w / 400, 0, 0, h / 500, 0, 0);
      const p = [s.pointer[0] * 400, s.pointer[1] * 500];
      if (["saw", "plane"].includes(c.kind)) {
        if (atlas.naturalWidth)
          prop(c.kind === "saw" ? "log" : "plank", 18, 167, 367, 177);
        else {
          wood(22, 175, 355, 160);
          for (let i = 0; i < 18; i++) {
            const x = 27 + i * 18;
            line(
              [
                [x, 176],
                [x + 5, 184],
                [x + 14, 179],
              ],
              "#68492b",
              2,
            );
            line(
              [
                [x, 328],
                [x + 8, 332],
                [x + 14, 327],
              ],
              "#6d4b2d",
              2,
            );
          }
          for (const [x, y] of [
            [80, 218],
            [310, 296],
          ])
            for (let j = 1; j < 4; j++) {
              ctx.beginPath();
              ctx.ellipse(x, y, j * 7, j * 3, 0.15, 0, Math.PI * 2);
              ctx.lineWidth = 1;
              ctx.strokeStyle = "#6d4b2daa";
              ctx.stroke();
            }
          circle(365, 255, 68, "#bb925d");
          for (let i = 1; i < 7; i++) {
            ctx.beginPath();
            ctx.ellipse(365, 255, i * 8, i * 10, 0, 0, Math.PI * 2);
            ctx.strokeStyle = "#86603b";
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
        }
        if (c.kind === "saw") {
          const x = c.x * 400;
          ctx.fillStyle = "#efd99b22";
          ctx.fillRect(x - 39, 162, 78, 180);
          line(
            [
              [x, 155],
              [x, 345],
            ],
            "#fff4d3",
            2,
            [5, 7],
          );
          line(
            [
              [x, 177],
              [x, 177 + clamp(s.turns / c.strokes) * 155],
            ],
            "#352d20",
            4,
          );
          ctx.save();
          ctx.translate(s.down ? p[0] : x, s.down ? p[1] - 90 : 238);
          ctx.rotate(0.035);
          if (atlas.naturalWidth) prop("saw", -33, -105, 70, 226);
          else {
            polygon(
              [
                [-13, -100],
                [12, -100],
                [14, 95],
                [-13, 95],
              ],
              "#b9c1b8",
            );
            line(
              [
                [-9, -94],
                [-8, 84],
              ],
              "#eef1d9",
              2,
            );
            line(
              [
                [-4, -82],
                [7, -70],
                [-3, -49],
                [8, -32],
                [-3, -9],
                [9, 7],
                [-2, 28],
                [8, 46],
                [-1, 62],
              ],
              "#899a9277",
              1,
            );
            for (let i = 0; i < 18; i++)
              polygon(
                [
                  [12, -86 + i * 10],
                  [20, -81 + i * 10],
                  [12, -76 + i * 10],
                ],
                "#dce0d2",
              );
            wood(-37, 85, 72, 34);
            circle(0, 102, 9, "#354030");
          }
          ctx.restore();
          // Draw guides after the tool, with a dark outline for contrast on bark.
          for (const side of [-1, 1]) {
            const rail = x + side * 39;
            line(
              [
                [rail, 145],
                [rail, 358],
              ],
              "#25352d",
              7,
            );
            line(
              [
                [rail, 145],
                [rail, 358],
              ],
              "#f3dfa5",
              3,
              [9, 7],
            );
            for (const y of [147, 356])
              line(
                [
                  [rail, y],
                  [rail - side * 11, y],
                ],
                "#f3dfa5",
                3,
              );
          }
          const cursorX = s.down ? p[0] : x;
          polygon(
            [
              [cursorX - 7, 128],
              [cursorX + 7, 128],
              [cursorX, 140],
            ],
            s.quality >= 0.6 ? "#f3dfa5" : "#e3876c",
            "#25352d",
          );
          ctx.fillStyle = bone;
          ctx.font = "12px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            `${Math.min(s.turns, c.strokes)} / ${c.strokes} strokes`,
            200,
            388,
          );
        } else {
          const path = c.path.map(([x, y]) => [x * 400, y * 500]);
          line(path, "#6e4b2e", 18);
          line(path, "#d5b37b", 2, [3, 6]);
          const x = s.down ? p[0] : path[0][0],
            y = s.down ? p[1] : path[0][1];
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(-0.08);
          if (atlas.naturalWidth) prop("plane", -40, -38, 90, 64);
          else {
            wood(-32, -18, 70, 35);
            polygon(
              [
                [-10, -17],
                [3, -37],
                [15, -30],
                [10, -10],
              ],
              "#4b5349",
            );
            circle(-18, -17, 10, "#d8b46e");
          }
          ctx.restore();
          circle(path.at(-1)[0], path.at(-1)[1], 11, "#ffffff18", bone, 1);
        }
      } else if (c.kind === "mine") {
        if (c.forge) {
          ctx.fillStyle = "#4a5552";
          ctx.strokeStyle = ink;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(46, 250);
          ctx.lineTo(345, 250);
          ctx.lineTo(308, 293);
          ctx.lineTo(249, 301);
          ctx.lineTo(260, 370);
          ctx.lineTo(128, 370);
          ctx.lineTo(142, 297);
          ctx.lineTo(66, 283);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#e6ac52";
          ctx.beginPath();
          ctx.moveTo(80, 219);
          ctx.lineTo(298, 219);
          ctx.lineTo(328, 242);
          ctx.lineTo(298, 261);
          ctx.lineTo(80, 261);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.strokeStyle = "#ffdc82";
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(92, 231);
          ctx.lineTo(288, 231);
          ctx.stroke();
        } else if (atlas.naturalWidth) prop("rock", 25, 120, 350, 276);
        else {
          polygon(
            [
              [48, 150],
              [104, 101],
              [207, 116],
              [308, 143],
              [363, 230],
              [344, 349],
              [231, 398],
              [90, 355],
              [33, 260],
            ],
            "#667474",
            ink,
            3,
          );
          for (let i = 0; i < 16; i++) {
            const x = 70 + ((i * 57 + c.seed) % 260),
              y = 156 + ((i * 37) % 180);
            polygon(
              [
                [x, y],
                [x + 12, y - 8],
                [x + 25, y + 9],
                [x + 2, y + 16],
              ],
              i % 3 ? "#738480" : "#bd9e57",
              null,
            );
          }
        }
        c.points.forEach(([x, y], i) => {
          x *= 400;
          y *= 500;
          line(
            [
              [x - 19, y - 14],
              [x, y],
              [x + 15, y - 16],
              [x + 8, y + 10],
              [x + 27, y + 22],
            ],
            i < s.hits ? "#253e36" : gold,
            i === s.hits ? 3 : 1.5,
          );
          if (i === s.hits) circle(x, y, 36, "#e8d18a19", "#f1dc9d", 2);
          if (i < s.hits) {
            circle(x, y, 16, "#263c34cc", "#99b57c", 1);
            line(
              [
                [x - 7, y],
                [x - 1, y + 5],
                [x + 8, y - 7],
              ],
              "#c6d9a8",
              3,
            );
          }
        });
        const home = c.home ?? [0.84, 0.88];
        const grip = s.down ? s.pointer : home;
        const hx = grip[0] * 400,
          hy = (grip[1] - (c.gripOffset ?? 0.14)) * 500;
        const power = s.down
          ? 0.5 -
            0.5 *
              Math.cos((2 * Math.PI * (t - s.down.time)) / (c.period ?? 2000))
          : 0;
        const ready =
          power >= 0.62 && power <= 0.94 && t - (s.down?.time ?? t) <= 3600;
        circle(home[0] * 400, home[1] * 500, 25, "#192e29cc", "#d7bd80", 2);
        ctx.fillStyle = bone;
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("GRIP", home[0] * 400, home[1] * 500 + 39);
        ctx.save();
        ctx.translate(hx, hy);
        if (atlas.naturalWidth) prop("hammer", -24, -14, 48, 102);
        else {
          wood(-5, -10, 10, 78);
          polygon(
            [
              [-26, -29],
              [26, -29],
              [29, -5],
              [-28, -6],
            ],
            "#b5b9a2",
          );
        }
        ctx.restore();
        if (s.down) {
          const aimed =
            distance(
              [grip[0], grip[1] - (c.gripOffset ?? 0.14)],
              c.points[Math.min(s.hits, 2)],
            ) <= 0.105;
          circle(hx, hy, 24, "#ffffff00", aimed ? "#cbe0a2" : "#f1dba0", 2);
          line(
            [
              [hx - 8, hy],
              [hx + 8, hy],
            ],
            "#f9edc9",
            2,
          );
          line(
            [
              [hx, hy - 8],
              [hx, hy + 8],
            ],
            "#f9edc9",
            2,
          );
        }
        // Power stays above the rock, clear of both the hand and the tool.
        ctx.fillStyle = "#102923ee";
        ctx.fillRect(70, 107, 260, 16);
        ctx.fillStyle = gold;
        ctx.fillRect(70 + 260 * 0.62, 109, 260 * 0.32, 12);
        line(
          [
            [70 + power * 260, 103],
            [70 + power * 260, 127],
          ],
          ready ? "#fff6cf" : "#bfc8ae",
          4,
        );
        ctx.fillStyle = bone;
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.font = "9px sans-serif";
        ctx.fillText("POWER", 20, 119);
        ctx.font = "11px sans-serif";
        ctx.fillText(
          `${s.hits} / 3 ${c.forge ? "sections forged" : "cracks"} · ${(c.strikes ?? 5) - s.strikes} strikes left`,
          35,
          430,
        );
        if (s.combo > 1)
          ctx.fillText(`${s.combo} clean strikes in a row`, 35, 410);
        if (s.impact && t - s.impact.time < 450) {
          ctx.globalAlpha = 1 - (t - s.impact.time) / 450;
          circle(
            s.impact.x,
            s.impact.y,
            18 + (t - s.impact.time) / 14,
            "#ffffff00",
            s.impact.hit ? "#e4d29b" : "#d78470",
            3,
          );
          ctx.globalAlpha = 1;
        }
      } else if (c.kind === "pack") {
        polygon(
          [
            [27, 112],
            [369, 114],
            [383, 361],
            [22, 359],
          ],
          "#56654c",
          ink,
          3,
        );
        polygon(
          [
            [33, 104],
            [365, 105],
            [370, 146],
            [28, 147],
          ],
          "#8c9265",
        );
        for (let x = 0; x < 4; x++)
          for (let y = 0; y < 3; y++) {
            ctx.strokeStyle = "#b5b99250";
            ctx.lineWidth = 1;
            ctx.strokeRect(40 + x * 80, 160 + y * 60, 80, 60);
          }
        c.shapes.forEach((shape, i) => {
          const cells = rotate(shape, s.rotations[i]);
          const place = s.placements[i],
            drag = s.drag === i;
          const pos = drag
            ? [p[0] - 30, p[1] - 25]
            : place
              ? [40 + place.x * 80, 160 + place.y * 60]
              : [24 + i * 128, 411];
          const size = place || drag ? [80, 60] : [37, 31];
          for (const [x, y] of cells) {
            const ax = pos[0] + x * size[0],
              ay = pos[1] + y * size[1];
            polygon(
              [
                [ax + 3, ay + 2],
                [ax + size[0] - 4, ay],
                [ax + size[0] - 2, ay + size[1] - 4],
                [ax, ay + size[1] - 2],
              ],
              ["#d4c7a1", "#a6905b", "#9aa789"][i],
              ink,
              2,
            );
            const cx = ax + size[0] / 2,
              cy = ay + size[1] / 2,
              unit = size[0] / 80;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(unit, unit);
            if (i === 0) {
              polygon(
                [
                  [-22, -10],
                  [18, -13],
                  [24, 11],
                  [-17, 14],
                ],
                "#e6e0c3",
                "#57604b",
                1,
              );
              for (let n = -12; n < 20; n += 7)
                line(
                  [
                    [n, -10],
                    [n + 5, 12],
                  ],
                  "#b4b89a",
                  1,
                );
              circle(18, 0, 9, "#f3eed9", "#747c63", 1);
              circle(18, 0, 4, "#78836a", null);
            }
            if (i === 1) {
              for (let n = 0; n < 4; n++) {
                ctx.beginPath();
                ctx.ellipse(
                  0,
                  0,
                  22 - n * 4,
                  16 - n * 3,
                  -0.15,
                  0,
                  Math.PI * 2,
                );
                ctx.strokeStyle = "#655337";
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.strokeStyle = "#d1b87a";
                ctx.lineWidth = 1;
                ctx.stroke();
              }
              line(
                [
                  [18, 0],
                  [24, 14],
                  [10, 20],
                ],
                "#ccb479",
                3,
              );
            }
            if (i === 2) {
              polygon(
                [
                  [-10, -12],
                  [10, -12],
                  [10, -4],
                  [16, 5],
                  [13, 20],
                  [-13, 20],
                  [-16, 5],
                  [-10, -4],
                ],
                "#506f58",
                "#364b3b",
                1,
              );
              polygon(
                [
                  [-8, -12],
                  [8, -12],
                  [8, -18],
                  [-8, -18],
                ],
                "#bda77d",
                ink,
                1,
              );
              line(
                [
                  [-9, 6],
                  [9, 6],
                ],
                "#b8ca93",
                7,
              );
              line(
                [
                  [0, 0],
                  [0, 14],
                ],
                "#e4dfac",
                2,
              );
              line(
                [
                  [-4, 5],
                  [4, 9],
                ],
                "#e4dfac",
                2,
              );
              line(
                [
                  [-9, -2],
                  [-10, 10],
                ],
                "#b3c7aa",
                1,
              );
            }
            ctx.restore();
          }
          if (!place && !drag) {
            ctx.fillStyle = bone;
            ctx.font = "10px sans-serif";
            ctx.textAlign = "left";
            ctx.fillText(["BANDAGES", "ROPE", "REMEDIES"][i], pos[0], 399);
          }
        });
      } else if (c.kind === "crank") {
        wood(35, 176, 330, 155);
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          line(
            [
              [200, 260],
              [200 + Math.cos(a) * 84, 260 + Math.sin(a) * 105],
            ],
            "#66583c",
            13,
          );
        }
        ctx.beginPath();
        ctx.ellipse(200, 260, 85, 105, 0, 0, Math.PI * 2);
        ctx.strokeStyle = "#afb5a2";
        ctx.lineWidth = 14;
        ctx.stroke();
        circle(200, 260, 28, "#766b4b");
        const a = s.lastAngle ?? 0;
        circle(200 + Math.cos(a) * 84, 260 + Math.sin(a) * 105, 16, gold);
        ctx.fillStyle = bone;
        ctx.font = "15px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          `${Math.min(2, Math.abs(s.angle) / (Math.PI * 2)).toFixed(1)} / 2 turns`,
          200,
          420,
        );
      } else if (c.kind === "guard") {
        for (let i = 0; i < c.points.length; i++) {
          const [x, y] = c.points[i];
          const pulse = 1 + Math.sin(t * 0.004 + i) * 0.05;
          if (i >= s.hits) {
            circle(
              x * 400,
              y * 500,
              29 * pulse,
              i === s.hits ? "#8fba62" : "#516744",
            );
            for (let a = 0; a < 8; a++) {
              const angle = (a * Math.PI) / 4;
              line(
                [
                  [
                    x * 400 + Math.cos(angle) * 23,
                    y * 500 + Math.sin(angle) * 23,
                  ],
                  [
                    x * 400 + Math.cos(angle) * 37,
                    y * 500 + Math.sin(angle) * 37,
                  ],
                ],
                "#d6cd88",
                2,
              );
            }
            ctx.fillStyle = ink;
            ctx.font = "bold 14px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(String(i + 1), x * 400, y * 500 + 5);
          } else {
            line(
              [
                [x * 400 - 13, y * 500 - 13],
                [x * 400 + 13, y * 500 + 13],
              ],
              gold,
              3,
            );
          }
        }
      } else {
        if (c.kind === "dodge") {
          if (sprite.naturalWidth) ctx.drawImage(sprite, 214, 75, 177, 145);
          c.hazards.forEach(([x, y, r]) => {
            circle(x * 400, y * 500, r * 420, "#68935566", "#a3ba64", 2);
            for (let j = 0; j < 6; j++)
              circle(
                x * 400 + Math.sin(t * 0.001 + j) * r * 260,
                y * 500 + Math.cos(j) * r * 280,
                3,
                "#d6d790",
                null,
              );
          });
        }
        const path = c.path.map(([x, y]) => [x * 400, y * 500]);
        if (c.kind === "steer") {
          line(path, "#273f32", 74);
          line(path, "#b18f58", 54);
          line(path, "#d9c18b", 2, [2, 16]);
          for (let i = 0; i < path.length; i++) {
            const [x, y] = path[i],
              side = i % 2 ? 1 : -1;
            circle(x + side * 39, y, 5, i % 3 ? "#546b41" : "#66715a", ink, 1);
            line(
              [
                [x + side * 43, y],
                [x + side * 48, y - 9],
                [x + side * 44, y - 3],
                [x + side * 53, y - 5],
              ],
              "#86a06a",
              2,
            );
            if (i % 3 === 0) {
              line(
                [
                  [x - 8, y],
                  [x - 1, y + 1],
                ],
                "#715c383f",
                2,
              );
              line(
                [
                  [x + 10, y - 4],
                  [x + 13, y - 2],
                ],
                "#efd6a166",
                1,
              );
            }
          }
        } else if (c.kind !== "dodge") line(path, "#ccb67f88", 3, [3, 10]);
        circle(path[0][0], path[0][1], 16, "#d9bd78", ink);
        circle(path.at(-1)[0], path.at(-1)[1], 18, "#f4d98c33", bone, 2);
        const x = s.down ? p[0] : path[0][0],
          y = s.down ? p[1] : path[0][1];
        if (c.kind === "steer") {
          if (cart.naturalWidth) ctx.drawImage(cart, x - 35, y - 25, 70, 50);
          else {
            wood(x - 20, y - 25, 40, 45);
            line(
              [
                [x - 24, y - 15],
                [x - 24, y + 15],
              ],
              ink,
              7,
            );
            line(
              [
                [x + 24, y - 15],
                [x + 24, y + 15],
              ],
              ink,
              7,
            );
          }
        } else if (c.kind === "dodge") {
          circle(x, y, 15, "#71a34c");
          circle(x - 6, y - 5, 5, bone);
          circle(x + 6, y - 5, 5, bone);
          circle(x - 6, y - 5, 2, ink);
          circle(x + 6, y - 5, 2, ink);
        }
      }
      if (s.trace.length > 1 && !["mine", "pack"].includes(c.kind))
        line(
          s.trace.slice(-100).map((p) => [p[0] * 400, p[1] * 500]),
          s.quality > 0.6 ? "#ffe4a6aa" : "#df7960aa",
          c.kind === "guard" ? 5 : 2,
        );
      s.particles = s.particles.filter((q) => q.life > 0);
      for (const q of s.particles) {
        q.x += q.vx;
        q.y += q.vy;
        q.vy += 0.06;
        q.life -= 0.02;
        ctx.globalAlpha = q.life;
        ctx.fillStyle = q.color;
        ctx.fillRect(q.x, q.y, 3, 2);
      }
      ctx.globalAlpha = 1;
      if (t - lastUpdate > 100) {
        setReadout(s.message);
        setProgress(
          c.kind === "saw"
            ? s.turns / c.strokes
            : c.kind === "mine" || c.kind === "guard"
              ? s.hits / 3
              : c.kind === "pack"
                ? s.placements.filter(Boolean).length / 3
                : c.kind === "crank"
                  ? Math.abs(s.angle) / (Math.PI * 4)
                  : s.finished
                    ? 1
                    : 0,
        );
        lastUpdate = t;
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(s.pending);
      observer.disconnect();
    };
  }, [challenge?.nonce]);

  function point(e) {
    const r = canvas.current.getBoundingClientRect();
    return [
      clamp((e.clientX - r.left) / r.width),
      clamp((e.clientY - r.top) / r.height),
    ];
  }
  function append(p, phase) {
    const s = state.current;
    if (!s.base) s.base = performance.now();
    const t = performance.now() - s.base;
    const band = p[1] < 0.35 ? -1 : p[1] > 0.68 ? 1 : 0;
    const crossing = challenge.kind === "saw" && band && band !== s.band;
    if (
      phase === 1 &&
      !crossing &&
      s.trace.length &&
      t - s.trace.at(-1)[2] < 38
    )
      return;
    s.trace.push([
      Math.round(p[0] * 10000) / 10000,
      Math.round(p[1] * 10000) / 10000,
      Math.round(t),
      phase,
    ]);
    if (challenge.kind === "saw") {
      s.trace = core.compactSawTrace(s.trace);
      const progress = core.sawProgress(s.trace, challenge);
      s.turns = progress.turns;
      s.band = progress.band;
    } else if (s.trace.length > 248)
      s.trace = s.trace.filter((p, i) => p[3] !== 1 || i % 2 === 0);
  }
  function finish() {
    const s = state.current;
    if (s.finished) return;
    s.finished = true;
    s.down = null;
    if (s.trace.at(-1)?.[3] !== 2) append(s.pointer, 2);
    s.message = "Checking the work…";
    s.pending = setTimeout(
      async () => {
        const result = await submit.current({
          trace: s.trace,
          placements: s.placements?.map((p, i) =>
            p ? { ...p, rotation: s.rotations[i] } : null,
          ),
        });
        if (!result && state.current === s) {
          s.finished = false;
          s.trace = [];
          s.base = 0;
          s.hits = 0;
          s.strikes = 0;
          s.combo = 0;
          s.turns = 0;
          s.angle = 0;
          s.band = 0;
          s.lastAngle = null;
          s.placements = [null, null, null];
          s.message = "Try the motion again";
        }
      },
      Math.max(0, 2300 - (performance.now() - s.base)),
    );
  }
  function down(e) {
    if (e.isPrimary === false) return;
    if (blocked.current || state.current.finished) return;
    e.preventDefault();
    canvas.current.setPointerCapture(e.pointerId);
    const s = state.current,
      p = point(e);
    if (
      challenge.kind === "mine" &&
      distance(p, challenge.home ?? [0.84, 0.88]) > 0.12
    ) {
      s.message = "Pick up the hammer by its grip, at the bottom right.";
      return;
    }
    s.pointer = p;
    s.down = { point: p, time: performance.now(), pointerId: e.pointerId };
    append(p, 0);
    s.message = "";
    if (challenge.kind === "pack") {
      let picked = -1;
      challenge.shapes.forEach((shape, i) => {
        const place = s.placements[i],
          x = place?.x * 80 + 40,
          y = place?.y * 60 + 160;
        const cells = rotate(shape, s.rotations[i]);
        const origin = place
            ? [x / 400, y / 500]
            : [(24 + i * 128) / 400, 0.822],
          size = place ? [0.2, 0.12] : [0.0925, 0.062];
        if (
          cells.some(
            ([dx, dy]) =>
              p[0] >= origin[0] + dx * size[0] - 0.025 &&
              p[0] <= origin[0] + (dx + 1) * size[0] + 0.025 &&
              p[1] >= origin[1] + dy * size[1] - 0.025 &&
              p[1] <= origin[1] + (dy + 1) * size[1] + 0.025,
          )
        )
          picked = i;
      });
      s.drag = picked >= 0 ? picked : null;
      s.original = picked >= 0 ? s.placements[picked] : null;
      if (picked >= 0) s.placements[picked] = null;
    }
  }
  function move(e) {
    const s = state.current;
    if (!s.down || s.finished || s.down.pointerId !== e.pointerId) return;
    e.preventDefault();
    s.pointer = point(e);
    append(s.pointer, 1);
    const [x, y] = s.pointer;
    if (["plane", "steer", "rune"].includes(challenge.kind)) {
      let nearest = 1,
        index = 0;
      for (let i = 0; i < challenge.path.length - 1; i++) {
        const a = challenge.path[i],
          b = challenge.path[i + 1],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)),
          d = distance([x, y], [a[0] + dx * t, a[1] + dy * t]);
        if (d < nearest) {
          nearest = d;
          index = i + t;
        }
      }
      s.quality = clamp(1 - nearest / 0.12);
      s.pathProgress = index / (challenge.path.length - 1);
      s.message =
        s.quality < 0.6
          ? challenge.kind === "steer"
            ? "The wheels are slipping"
            : "Ease back onto the line"
          : challenge.kind === "plane"
            ? "A smooth shaving"
            : challenge.kind === "steer"
              ? "Cargo steady"
              : "The ward is taking shape";
      if (challenge.kind === "plane" && s.trace.length % 4 === 0)
        s.burst(x * 400, y * 500, "#ccb47a");
    }
    if (
      challenge.kind === "dodge" &&
      challenge.hazards.some(
        ([a, b, r]) => distance([x, y], [a, b]) < r + 0.015,
      )
    ) {
      s.quality = 0;
      s.message = "Poison! Find a clear route on the next attempt.";
    }

    if (challenge.kind === "saw") {
      s.quality = clamp(
        1 - Math.max(0, Math.abs(x - challenge.x) - 0.05) / 0.12,
      );
      s.message =
        s.quality < 0.6
          ? "Bring the blade back between the guides"
          : "Good cut — keep the saw moving";
      if (s.turns >= challenge.strokes) finish();
    }
    if (challenge.kind === "crank") {
      const a = Math.atan2(y - 0.52, x - 0.5);
      if (s.lastAngle !== null) {
        let d = a - s.lastAngle;
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        s.angle += d;
      }
      s.lastAngle = a;
      if (Math.abs(s.angle) >= Math.PI * 4) {
        s.burst(200, 260);
        finish();
      }
    }
  }
  function up(e) {
    const s = state.current;
    if (!s.down || s.finished || s.down.pointerId !== e.pointerId) return;
    const p = point(e);
    s.pointer = p;
    append(p, 2);
    if (challenge.kind === "saw" && s.turns >= challenge.strokes) {
      finish();
      return;
    }
    const held = performance.now() - s.down.time,
      travel = distance(s.down.point, p);
    if (challenge.kind === "mine") {
      const head = [p[0], p[1] - (challenge.gripOffset ?? 0.14)];
      // Use the submitted sample times so rounding cannot change a boundary hit.
      const start = [...s.trace].reverse().find((sample) => sample[3] === 0);
      const ms = s.trace.at(-1)[2] - start[2];
      const power =
        0.5 - 0.5 * Math.cos((2 * Math.PI * ms) / (challenge.period ?? 2000));
      const aimed =
        distance(head, challenge.points[s.hits]) <= 0.105 && travel >= 0.14;
      const hit =
        aimed && ms >= 300 && ms <= 3600 && power >= 0.62 && power <= 0.94;
      s.strikes++;
      s.combo = hit ? s.combo + 1 : 0;
      s.impact = {
        x: head[0] * 400,
        y: head[1] * 500,
        time: performance.now(),
        hit,
      };
      s.burst(head[0] * 400, head[1] * 500, hit ? "#d6ccb0" : "#bc7965");
      if (hit) s.hits++;
      s.message = hit
        ? "Clean fracture. Pick up the hammer again."
        : !aimed
          ? "Missed the mark. Line up the hammer head."
          : ms > 3600
            ? "The swing stalled. Start again from the grip."
            : power > 0.94
              ? "Too much force. Release a little earlier."
              : "Weak impact. Release while the needle is in gold.";
      s.down = null;
      if (s.hits === 3 || s.strikes >= (challenge.strikes ?? 5)) finish();
      return;
    }
    if (challenge.kind === "guard") {
      const target = challenge.points[s.hits];
      const hit =
        Math.min(distance(s.down.point, target), distance(p, target)) < 0.16 &&
        travel > 0.13 &&
        held >= 120 &&
        held <= 1300;
      if (hit) {
        s.hits++;
        s.burst(p[0] * 400, p[1] * 500, "#bfdc70");
        s.message = "Covered";
      } else s.message = "Swipe through the glowing spore.";
      s.down = null;
      if (s.hits === 3) finish();
      return;
    }
    if (challenge.kind === "pack") {
      const i = s.drag;
      if (i !== null) {
        if (travel < 0.035) {
          s.rotations[i] = (s.rotations[i] + 1) % 4;
          s.placements[i] = null;
          s.message = "Rotated";
        } else {
          const q = {
            x: Math.round((p[0] * 400 - 70) / 80),
            y: Math.round((p[1] * 500 - 185) / 60),
          };
          const occupied = new Set();
          s.placements.forEach((pl, n) => {
            if (pl)
              for (const [dx, dy] of rotate(
                challenge.shapes[n],
                s.rotations[n],
              ))
                occupied.add(`${pl.x + dx},${pl.y + dy}`);
          });
          const cells = rotate(challenge.shapes[i], s.rotations[i]);
          if (
            cells.every(
              ([dx, dy]) =>
                q.x + dx >= 0 &&
                q.x + dx < 4 &&
                q.y + dy >= 0 &&
                q.y + dy < 3 &&
                !occupied.has(`${q.x + dx},${q.y + dy}`),
            )
          ) {
            s.placements[i] = q;
            s.burst(p[0] * 400, p[1] * 500);
            s.message = "Fits";
          } else {
            s.placements[i] = s.original;
            s.message = "No room there. Rotate or rearrange.";
          }
        }
      }
      s.drag = null;
      s.down = null;
      if (s.placements.every(Boolean)) finish();
      return;
    }
    s.down = null;
    if (["plane", "steer", "dodge", "rune"].includes(challenge.kind)) finish();
    else {
      s.message = "Keep going — finish the motion";
    }
  }
  if (!challenge) return null;
  const [title, hint] = (challenge.forge
    ? [
        "Forge the blade",
        "Move the hammer along the hot blade. Release in gold to shape each section.",
      ]
    : instructions[challenge.kind]) || ["Continue", ""];
  return (
    <div
      className={`touch-game touch-${challenge.kind} ${boss ? "touch-boss" : ""}`}
    >
      <div
        className="touch-game-backdrop"
        style={{
          backgroundImage: ["saw", "plane", "mine", "pack", "crank"].includes(
            challenge.kind,
          )
            ? `url(${workshop})`
            : `url(${marshArt})`,
        }}
      />
      <div className="touch-instruction">
        <span>{title}</span>
        <p>{hint}</p>
      </div>
      <canvas
        ref={canvas}
        className="touch-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          if (state.current) {
            const s = state.current;
            s.down = null;
            s.drag = null;
            s.trace = [];
            s.base = 0;
            s.hits = 0;
            s.strikes = 0;
            s.combo = 0;
            s.turns = 0;
            s.band = 0;
            s.angle = 0;
            s.lastAngle = null;
            s.placements = [null, null, null];
            s.message = "Touch released. Try again.";
          }
        }}
        aria-label={hint}
      />
      <div className="touch-feedback" role="status">
        <span>
          {disabled ? "Saving…" : readout || "Touch the work surface to begin"}
        </span>
        <div>
          <i style={{ width: `${clamp(progress) * 100}%` }} />
        </div>
        {feedback && (
          <small>
            {feedback.passed
              ? "Clean work"
              : challenge.kind === "mine"
                ? "Aim at the cracks and time each swing"
                : "Try to keep it steadier"}{" "}
            · {feedback.quality}% quality
          </small>
        )}
      </div>
    </div>
  );
}
