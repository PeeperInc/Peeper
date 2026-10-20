import React, { useEffect, useRef, useState } from "react";
import ForgeStage from "./ForgeStage";
import FieldStage from "./FieldStage";
import TouchStage from "./TouchStage";
import WorkshopTouchStage from "./WorkshopTouchStage";
import CarpentryStage from "./CarpentryStage";
import core from "@peeper/frontier-core";
import marsh from "../assets/frontier/marsh-world.webp";
import workshop from "../assets/frontier/workshop.webp";
import cartArt from "../assets/frontier/cart.webp";
import arena from "../assets/frontier/dragon-arena.png";
import bossArt from "../assets/frontier/marsh-dragon.png";
import "./ArcadeStage.css";

const copy = {
  stack: [
    "Make every board count",
    "Tap to align the moving board. Overhang gets cut away.",
  ],
  convoy: [
    "Bring the cargo home",
    "Recover 3 crates. Steer around stumps to keep the cart intact.",
  ],
  slice: [
    "Keep the lanterns flying",
    "Clear at least 5 beetles. A golden bug costs a catch; hitting two loses the round.",
  ],
  pipes: [
    "Get the oil flowing",
    "Turn the pipe pieces. Connect the left tank to the right axle.",
  ],
  duel: [
    "Read Mirewake's charge",
    "Move into the clear lane. Strike back after his charge misses.",
  ],
  herbs: [
    "Brew a field remedy",
    "Link 3 or more matching herbs. Longer chains save moves.",
  ],
};
const ink = "#25362a",
  paper = "#f3e4ba",
  brass = "#e3ba62",
  green = "#83b66c";
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));

export default function ArcadeStage(props) {
  if (["chopping", "quarrying", "trail"].includes(props.challenge.arcade.mode))
    return <TouchStage {...props} />;
  if (props.challenge.arcade.mode === "carpentry")
    return <CarpentryStage {...props} />;
  if (props.challenge.arcade.mode === "match3")
    return <WorkshopTouchStage {...props} />;
  if (
    ["logging", "mining", "convoy", "duel"].includes(
      props.challenge.arcade.mode,
    )
  )
    return <FieldStage {...props} />;
  return props.challenge.arcade.mode === "forge" ? (
    <ForgeStage {...props} />
  ) : (
    <ArcadeGame {...props} />
  );
}

function ArcadeGame({ challenge, disabled, onComplete, feedback }) {
  const canvas = useRef(null),
    run = useRef(null),
    send = useRef(onComplete),
    blocked = useRef(disabled);
  const [hud, setHud] = useState({
      time: 0,
      message: "",
      detail: "",
      progress: 0,
    }),
    [retry, setRetry] = useState(0),
    [failed, setFailed] = useState(false);
  send.current = onComplete;
  blocked.current = disabled;
  const mode = challenge.arcade.mode,
    [title, hint] = copy[mode];
  useEffect(() => {
    function key(e) {
      if (
        e.repeat ||
        /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
        e.target.isContentEditable
      )
        return;
      if (e.code === "Space" && ["stack", "duel"].includes(mode)) {
        if (e.target.tagName === "BUTTON") return;
        e.preventDefault();
        action(mode === "stack" ? 3 : 5);
      }
      if (
        ["convoy", "duel"].includes(mode) &&
        ["ArrowLeft", "ArrowDown", "ArrowRight"].includes(e.code)
      ) {
        e.preventDefault();
        action(4, ["ArrowLeft", "ArrowDown", "ArrowRight"].indexOf(e.code));
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [challenge.nonce, mode]);
  useEffect(() => {
    const el = canvas.current,
      ctx = el.getContext("2d"),
      s = core.create(challenge);
    const r = {
      s,
      events: [],
      start: performance.now() + 600,
      submitted: false,
      pointerId: null,
      lastMove: -100,
      lastRevision: 0,
      trail: [],
    };
    run.current = r;
    setFailed(false);
    let gone = false,
      frame,
      lastHud = 0;
    const cart = new Image(),
      king = new Image();
    if (mode === "convoy") cart.src = cartArt;
    if (mode === "duel") king.src = bossArt;
    const resize = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect(),
        d = Math.min(devicePixelRatio || 1, 2);
      el.width = Math.max(1, Math.round(rect.width * d));
      el.height = Math.max(1, Math.round(rect.height * d));
      // Resizing clears a canvas even when a completed round has stopped animating.
      if (s.done) draw(performance.now());
    });
    resize.observe(el);
    function line(points, color, width = 2) {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    function shape(points, fill, stroke = ink, width = 2) {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.lineWidth = width;
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    }
    function oval(x, y, rx, ry, fill, stroke = ink, width = 2) {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }
    function text(value, x, y, size = 13, color = paper, align = "center") {
      ctx.fillStyle = color;
      ctx.font = `600 ${size}px system-ui`;
      ctx.textAlign = align;
      ctx.fillText(value, x, y);
    }
    function plank(x, y, w, h, color = "#b78952") {
      shape(
        [
          [x + 2, y + 3],
          [x + w - 2, y],
          [x + w, y + h - 2],
          [x, y + h],
        ],
        color,
      );
      for (let i = 1; i < 4; i++)
        line(
          [
            [x + 9, y + (h * i) / 4],
            [x + w * 0.43, y + (h * i) / 4 + 2],
            [x + w - 9, y + (h * i) / 4 - 1],
          ],
          i % 2 ? "#745334" : "#d4ae76",
          1,
        );
      oval(x + w * 0.3, y + h * 0.52, 9, 3, "#946e44", "#674c30", 1);
    }
    function frog(x, y, scale = 1) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      oval(0, 10, 24, 18, "#315ecd");
      oval(-2, -10, 29, 22, "#739d45");
      oval(-13, -23, 15, 13, paper);
      oval(11, -22, 15, 12, paper);
      oval(-10, -22, 6, 8, "#121d18", null);
      oval(13, -21, 6, 8, "#121d18", null);
      line(
        [
          [-24, -1],
          [-8, 3],
          [11, 2],
          [24, -1],
        ],
        "#b27a59",
        6,
      );
      ctx.restore();
    }
    function bug(x, y, friendly, t) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(t * 0.009) * 0.12);
      const flap = 10 + Math.abs(Math.sin(t * 0.024)) * 12;
      oval(-17, -7, flap, 12, friendly ? "#f0da9777" : "#b8c99a99", ink, 1);
      oval(17, -7, flap, 12, friendly ? "#f0da9777" : "#b8c99a99", ink, 1);
      for (const side of [-1, 1])
        for (let i = 0; i < 3; i++)
          line(
            [
              [side * 9, 0 + i * 6],
              [side * 20, 4 + i * 5],
              [side * 23, 1 + i * 5],
            ],
            ink,
            2,
          );
      if (friendly) {
        oval(0, 10, 12, 19, "#e9bd50");
        ctx.shadowColor = "#f8da6c";
        ctx.shadowBlur = 18;
        oval(0, 14, 7, 10, "#ffea8c", null);
        ctx.shadowBlur = 0;
        line(
          [
            [-9, 6],
            [9, 6],
          ],
          "#826034",
          2,
        );
        line(
          [
            [-8, 18],
            [8, 18],
          ],
          "#826034",
          2,
        );
      } else {
        oval(0, 9, 16, 21, "#826641");
        line(
          [
            [0, -7],
            [0, 29],
          ],
          "#382f21",
          3,
        );
        for (const side of [-1, 1])
          for (let i = 0; i < 3; i++)
            oval(side * 8, 2 + i * 8, 3, 3, "#b7b172", null);
      }
      oval(0, -14, 12, 10, friendly ? "#8aa657" : "#6f7e44");
      oval(-5, -16, 5, 5, paper);
      oval(5, -16, 5, 5, paper);
      oval(-4, -15, 2, 3, ink, null);
      oval(6, -15, 2, 3, ink, null);
      line(
        [
          [-5, -24],
          [-10, -32],
        ],
        ink,
        2,
      );
      line(
        [
          [5, -24],
          [11, -31],
        ],
        ink,
        2,
      );
      ctx.restore();
    }
    function herb(kind, x, y, selected = false) {
      if (selected) oval(x, y, 28, 28, "#e9dba355", "#f3dd94", 2);
      ctx.save();
      ctx.translate(x, y);
      if (kind === 0) {
        line(
          [
            [0, 21],
            [0, -17],
          ],
          "#467446",
          3,
        );
        shape(
          [
            [0, 10],
            [-22, 3],
            [-21, -10],
            [-5, -5],
            [0, 10],
          ],
          "#88b864",
        );
        shape(
          [
            [0, 2],
            [21, -7],
            [21, -20],
            [6, -15],
            [0, 2],
          ],
          "#aac47e",
        );
        line(
          [
            [-15, -3],
            [0, 10],
            [14, -11],
          ],
          "#50764b",
          1,
        );
      } else if (kind === 1) {
        shape(
          [
            [-7, 6],
            [7, 6],
            [10, 23],
            [-10, 23],
          ],
          "#e3d8b0",
        );
        shape(
          [
            [-24, 7],
            [-20, -8],
            [-8, -21],
            [8, -20],
            [22, -5],
            [24, 7],
            [4, 11],
          ],
          "#bd8069",
        );
        for (const [x, y] of [
          [-11, -6],
          [6, -12],
          [13, 1],
        ])
          oval(x, y, 4, 3, "#f0d5a4", null);
      } else {
        line(
          [
            [0, 21],
            [0, -12],
          ],
          "#667b53",
          3,
        );
        for (const [x, y] of [
          [-10, 0],
          [9, 0],
          [0, -13],
        ])
          oval(x, y, 10, 12, "#739db4");
        oval(0, -2, 4, 5, "#d9da9a", null);
      }
      ctx.restore();
    }
    function draw(now) {
      if (gone) return;
      const t = clamp(now - r.start, 0, challenge.arcade.duration);
      core.advance(s, t);
      ctx.setTransform(el.width / 400, 0, 0, el.height / 500, 0, 0);
      ctx.clearRect(0, 0, 400, 500);
      if (mode === "convoy") {
        shape(
          [
            [55, 0],
            [330, 0],
            [375, 500],
            [24, 500],
          ],
          "#bc9b65",
        );
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(55, 0);
        ctx.lineTo(330, 0);
        ctx.lineTo(375, 500);
        ctx.lineTo(24, 500);
        ctx.closePath();
        ctx.clip();
        for (let i = 0; i < 34; i++) {
          const y = ((i * 59 + t * 0.085) % 560) - 30,
            x = 50 + ((i * 73) % 305);
          oval(
            x,
            y,
            11 + (i % 5) * 7,
            3 + (i % 4),
            i % 4 === 0 ? "#776e4b44" : "#d9bc8538",
            null,
          );
          if (i % 4 === 0) {
            line(
              [
                [x - 7, y],
                [x + 4, y + 1],
              ],
              "#4b634e55",
              1,
            );
            oval(x + 13, y + 4, 3, 2, "#74796388", null);
          }
        }
        for (const x of [77, 101, 186, 211, 298, 323])
          line(
            [
              [x - 7, 0],
              [x, 190],
              [x - 4, 350],
              [x + 3, 500],
            ],
            "#7d744329",
            3,
          );
        ctx.restore();
        line(
          [
            [48, 0],
            [29, 500],
          ],
          "#5e663c",
          8,
        );
        line(
          [
            [338, 0],
            [373, 500],
          ],
          "#5e663c",
          8,
        );
        for (let lane = 0; lane < 2; lane++)
          for (let j = -1; j < 9; j++) {
            const y = (j * 70 + t * 0.085) % 560;
            line(
              [
                [144 + lane * 112, y],
                [144 + lane * 112, y + 25],
              ],
              "#ebd3a155",
              3,
            );
          }
        for (let j = 0; j < 14; j++) {
          const y = (j * 47 + t * 0.065) % 540,
            side = j % 2 ? 1 : -1,
            x = 200 + side * (170 + Math.sin(j) * 7);
          line(
            [
              [x, y],
              [x + side * 9, y - 21],
              [x + side * 3, y - 4],
              [x - side * 10, y - 13],
            ],
            "#839b55",
            3,
          );
        }
        challenge.arcade.rows.forEach((row, i) => {
          const age = (t - row.at) / 1800;
          if (age < 0 || age > 1.2) return;
          const y = 60 + age * 360;
          if (!s.crossed.includes(i)) {
            const x = (0.22 + row.obstacle * 0.28) * 400;
            shape(
              [
                [x - 28, y + 20],
                [x - 23, y - 19],
                [x - 9, y - 25],
                [x + 27, y - 16],
                [x + 31, y + 19],
              ],
              "#79573b",
            );
            oval(x, y - 17, 25, 11, "#c19a64");
            oval(x, y - 17, 15, 6, "#b58955", "#765237", 1);
            plank(
              (0.22 + row.crate * 0.28) * 400 - 21,
              y - 18,
              42,
              37,
              "#d5ad64",
            );
          }
        });
        const x = s.x * 400;
        oval(x, 438, 38, 10, "#24352144", null);
        if (cart.naturalWidth) ctx.drawImage(cart, x - 54, 379, 108, 72);
        else {
          plank(x - 28, 395, 56, 43);
          frog(x, 390, 0.65);
        }
      }
      if (mode === "slice") {
        line(
          [
            [18, 435],
            [382, 438],
          ],
          "#b5a16b66",
          3,
        );
        for (const item of challenge.arcade.items) {
          const p = core.insect(item, t);
          if (item.start && t >= item.at - 400 && t < item.at) {
            const pulse = (t - item.at + 400) / 400;
            oval(
              item.start[0] * 400,
              item.start[1] * 500,
              10 + pulse * 14,
              10 + pulse * 14,
              item.friendly ? "#efcf6733" : "#dd8e6544",
              item.friendly ? "#eac45f" : "#d1a77c",
            );
          }
          if (!p || s.hits.includes(item.id)) continue;
          const ahead = core.insect(item, t + 20) || p;
          ctx.save();
          ctx.translate(p[0] * 400, p[1] * 500);
          ctx.rotate(
            Math.atan2((ahead[1] - p[1]) * 500, (ahead[0] - p[0]) * 400) +
              Math.PI / 2,
          );
          bug(0, 0, item.friendly, t + item.id * 67);
          ctx.restore();
        }
        r.trail = r.trail.filter((p) => t - p[2] < 180);
        if (r.trail.length > 1)
          line(
            r.trail.map((p) => [p[0] * 400, p[1] * 500]),
            "#fff2c6",
            5,
          );
        text("SPORE BEETLES", 105, 473, 11);
        text("SPARE LANTERNS", 298, 473, 11, "#f2d57e");
      }
      if (mode === "duel") {
        const next = challenge.arcade.attacks.find((a) => t < a.at),
          active = next && t > next.at - 1100;
        for (let lane = 0; lane < 3; lane++) {
          const x = (0.22 + lane * 0.28) * 400;
          shape(
            [
              [x - 46, 205],
              [x + 46, 205],
              [x + 49, 460],
              [x - 49, 460],
            ],
            active
              ? next.safe === lane
                ? "#94b87755"
                : "#bc694666"
              : "#74946a18",
            "#bdd0a52a",
            1,
          );
          if (active && next.safe !== lane)
            for (let y = 250; y < 440; y += 45)
              line(
                [
                  [x - 14, y - 10],
                  [x, y + 4],
                  [x + 14, y - 10],
                ],
                "#e5a174",
                3,
              );
          if (active && next.safe === lane)
            text("CLEAR", x, 248, 13, "#d6e9b6");
        }
        const attack = challenge.arcade.attacks.find(
          (a) => t >= a.at && t < a.at + 850,
        );
        const shake = attack ? Math.sin((t - attack.at) * 0.025) * 5 : 0;
        const surge = challenge.arcade.attacks.find(
          (a) => t > a.at - 360 && t < a.at + 240,
        );
        const lean = surge
          ? Math.sin(clamp((t - surge.at + 360) / 600) * Math.PI) * 14
          : Math.sin(t * 0.002) * 2;
        if (king.naturalWidth)
          ctx.drawImage(
            king,
            93 + shake - lean * 0.3,
            12 + lean,
            216 + lean * 0.6,
            208 - lean * 0.35,
          );
        if (surge) {
          const y = 232 + clamp((t - surge.at + 360) / 360) * 190;
          ctx.save();
          ctx.globalAlpha = t > surge.at ? 1 - (t - surge.at) / 240 : 1;
          for (let lane = 0; lane < 3; lane++)
            if (lane !== surge.safe) {
              const x = (0.22 + lane * 0.28) * 400;
              shape(
                [
                  [x - 43, y - 18],
                  [x - 25, y - 9],
                  [x - 12, y - 22],
                  [x + 7, y - 7],
                  [x + 27, y - 21],
                  [x + 43, y - 9],
                  [x + 40, y + 14],
                  [x - 38, y + 13],
                ],
                "#aabd56",
                "#506740",
                2,
              );
              for (let j = 0; j < 5; j++)
                oval(
                  x - 31 + j * 15,
                  y + Math.sin(j) * 8,
                  3,
                  5,
                  "#d9d38a",
                  null,
                );
            }
          ctx.restore();
        }
        text(
          active
            ? "CHARGE INCOMING"
            : attack
              ? "COUNTER WINDOW"
              : "WATCH HIS NEXT MOVE",
          200,
          205,
          12,
          active ? "#edb98d" : "#eaddad",
        );
        frog(s.x * 400, 415, 1.12);
        if (t - s.lastStrike < 180)
          line(
            [
              [s.x * 400 - 25, 383],
              [s.x * 400 + 30, 325],
            ],
            "#ffebad",
            8,
          );
      }
      if (mode === "stack") {
        plank(34, 414, 332, 43, "#715d3e");
        plank(68, 391, 264, 25, "#ac8957");
        s.boards.forEach((b, i) =>
          plank(
            b.x * 400 - b.width * 200,
            363 - i * 39,
            b.width * 400,
            29,
            b.perfect ? "#d7b775" : "#b88e59",
          ),
        );
        if (!s.done) {
          const x = core.boardX(s) * 400,
            y = 335 - s.boards.length * 39;
          plank(x - s.width * 200, y, s.width * 400, 29, "#dec18a");
          line(
            [
              [s.center * 400, 70],
              [s.center * 400, 310 - s.boards.length * 39],
            ],
            "#efe2b526",
            1,
          );
        }
        for (const cut of s.cuts)
          if (t - cut.t < 500) {
            ctx.save();
            ctx.globalAlpha = 1 - (t - cut.t) / 500;
            ctx.translate(cut.x * 400, 350 + (t - cut.t) * 0.16);
            ctx.rotate((t - cut.t) * 0.003);
            plank(-15, 0, 30, 24);
            ctx.restore();
          }
        text(`${s.boards.length} / 5 boards`, 200, 480, 14);
      }
      if (mode === "pipes") {
        plank(33, 85, 334, 322, "#6b6344");
        const reached = core.flow(s.tiles);
        s.tiles.forEach((mask, i) => {
          const x = 92 + (i % 3) * 108,
            y = 142 + Math.floor(i / 3) * 105,
            on = reached.includes(i);
          shape(
            [
              [x - 46, y - 45],
              [x + 46, y - 45],
              [x + 46, y + 44],
              [x - 46, y + 44],
            ],
            "#233d35",
            "#9fa981",
            1,
          );
          for (const [bit, dx, dy] of [
            [1, 0, -49],
            [2, 50, 0],
            [4, 0, 49],
            [8, -50, 0],
          ])
            if (mask & bit) {
              line(
                [
                  [x, y],
                  [x + dx, y + dy],
                ],
                "#172c27",
                25,
              );
              line(
                [
                  [x, y],
                  [x + dx, y + dy],
                ],
                on ? "#d2b66c" : "#879783",
                17,
              );
              line(
                [
                  [x - 2, y - 2],
                  [x + dx - 2, y + dy - 2],
                ],
                on ? "#f1d892" : "#b4bfa5",
                3,
              );
            }
          oval(x, y, 11, 11, on ? "#e4c478" : "#9cab96", "#273b30", 2);
        });
        line(
          [
            [10, 247],
            [38, 247],
          ],
          brass,
          16,
        );
        line(
          [
            [362, 247],
            [390, 247],
          ],
          reached.includes(5) && s.tiles[5] & 2 ? brass : "#82917a",
          16,
        );
        text("OIL", 18, 220, 10);
        text("AXLE", 378, 220, 10);
        text(`${challenge.arcade.moves - s.moves} turns left`, 200, 455, 14);
      }
      if (mode === "herbs") {
        shape(
          [
            [27, 95],
            [372, 91],
            [380, 434],
            [24, 431],
          ],
          "#304b3b",
          "#a4b185",
          2,
        );
        s.board.forEach((kind, i) => {
          const x = 80 + (i % 4) * 80,
            y = 152.5 + Math.floor(i / 4) * 75;
          shape(
            [
              [x - 37, y - 34],
              [x + 36, y - 34],
              [x + 36, y + 34],
              [x - 37, y + 34],
            ],
            "#79966b1c",
            "#b0c08b25",
            1,
          );
          herb(kind, x, y, s.chain.includes(i));
        });
        if (s.chain.length > 1)
          line(
            s.chain.map((i) => [
              80 + (i % 4) * 80,
              152.5 + Math.floor(i / 4) * 75,
            ]),
            "#f5dda4bb",
            4,
          );
        text(
          `${s.harvested} / ${challenge.arcade.target} ingredients`,
          200,
          64,
          17,
        );
        text(`${challenge.arcade.moves - s.moves} brews left`, 200, 472, 14);
      }
      if (s.flash && t - s.flash.t < 280) {
        ctx.globalAlpha = (1 - (t - s.flash.t) / 280) * 0.17;
        ctx.fillStyle = s.flash.bad ? "#df764e" : "#ffe9a4";
        ctx.fillRect(0, 0, 400, 500);
        ctx.globalAlpha = 1;
      }
      if (now < r.start) text("READY", 200, 260, 26);
      if (s.revision !== r.lastRevision) {
        r.lastRevision = s.revision;
        try {
          window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
        } catch {}
      }
      if (s.done || now - lastHud > 90) {
        let detail = "",
          progress = 0;
        if (mode === "convoy") {
          detail = `${s.health}/3 condition · ${s.crates}/3 crates`;
          progress = s.crates / 3;
        }
        if (mode === "slice") {
          const good = s.hits.filter(
            (id) => !challenge.arcade.items[id].friendly,
          ).length;
          const needed =
            Math.ceil(
              challenge.arcade.items.filter((i) => !i.friendly).length * 0.6,
            ) + s.friendly;
          detail = `${good}/${needed} beetles needed · ${s.friendly}/2 lantern mistakes`;
          progress = s.friendly > 1 ? 0 : Math.min(1, good / needed);
        }
        if (mode === "duel") {
          detail = `${s.health}/3 resolve · ${s.counters} counters`;
          progress = s.counters / 3;
        }
        if (mode === "stack") {
          detail = `${Math.round((s.width / 0.66) * 100)}% usable width`;
          progress = s.boards.length / 5;
        }
        if (mode === "pipes") {
          detail = `${challenge.arcade.moves - s.moves} turns`;
          progress = core.flow(s.tiles).length / 5;
        }
        if (mode === "herbs") {
          detail = `${s.harvested}/${challenge.arcade.target} herbs`;
          progress = s.harvested / challenge.arcade.target;
        }
        setHud({
          time: Math.max(0, Math.ceil((challenge.arcade.duration - t) / 1000)),
          message: s.message,
          detail,
          progress: clamp(progress),
          lane: Math.round((s.targetX - 0.22) / 0.28),
          cue:
            mode === "duel"
              ? (() => {
                  const windup = challenge.arcade.attacks.find(
                    (a) => t >= a.at - 1100 && t < a.at,
                  );
                  if (windup)
                    return `Clear lane: ${["left", "middle", "right"][windup.safe]}`;
                  const opening = challenge.arcade.attacks.findIndex(
                    (a) => t >= a.at + 100 && t <= a.at + 850,
                  );
                  return opening >= 0 && !s.countered.includes(opening)
                    ? "Strike now"
                    : "Watch the dragon";
                })()
              : "",
        });
        lastHud = now;
      }
      if (s.done && !r.submitted) {
        r.submitted = true;
        if (!r.events.length) r.events.push([Math.round(s.t), 7, 0, 0]);
        r.pending = setTimeout(
          async () => {
            try {
              const result = await send.current({ events: r.events });
              if (!gone && !result) setFailed(true);
            } catch {
              if (!gone) setFailed(true);
            }
          },
          Math.max(0, 2300 - (now - r.start)),
        );
      }
      if (!s.done) frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      clearTimeout(r.pending);
      resize.disconnect();
    };
  }, [challenge.nonce, retry]);
  function action(type, a = 0, b = 0) {
    const r = run.current;
    if (!r || r.submitted || blocked.current || performance.now() < r.start)
      return;
    const t = Math.min(
      challenge.arcade.duration,
      Math.round(performance.now() - r.start),
    );
    if (type === 1 && t - r.lastMove < 50) return;
    if (type === 1) r.lastMove = t;
    if (r.events.length >= 250) return;
    const event = [
      t,
      type,
      Math.round(a * 10000) / 10000,
      Math.round(b * 10000) / 10000,
    ];
    r.events.push(event);
    core.act(r.s, event);
    if (mode === "slice" && [0, 1, 2].includes(type)) {
      if (type === 0) r.trail = [];
      r.trail.push([a, b, t]);
    }
  }
  function point(e) {
    const box = canvas.current.getBoundingClientRect();
    return [
      clamp((e.clientX - box.left) / box.width),
      clamp((e.clientY - box.top) / box.height),
    ];
  }
  function down(e) {
    if (e.isPrimary === false) return;
    e.preventDefault();
    const r = run.current;
    r.pointerId = e.pointerId;
    canvas.current.setPointerCapture(e.pointerId);
    const [x, y] = point(e);
    if (mode === "stack") action(3);
    else if (mode === "pipes") {
      const col = Math.floor((x * 400 - 38) / 108),
        row = Math.floor((y * 500 - 90) / 105);
      if (col >= 0 && col < 3 && row >= 0 && row < 3) action(6, row * 3 + col);
    } else if (mode === "duel")
      action(4, clamp(Math.round((x - 0.22) / 0.28), 0, 2));
    else action(0, x, y);
  }
  function move(e) {
    if (run.current?.pointerId !== e.pointerId) return;
    e.preventDefault();
    if (["slice", "herbs", "convoy"].includes(mode)) action(1, ...point(e));
  }
  function up(e) {
    if (run.current?.pointerId !== e.pointerId) return;
    if (["slice", "herbs", "convoy"].includes(mode)) action(2, ...point(e));
    run.current.pointerId = null;
  }
  return (
    <section className={`arcade-stage arcade-${mode}`} aria-label={title}>
      <header className="arcade-heading">
        <div>
          <h3>{title}</h3>
          <p>{hint}</p>
        </div>
        <span aria-label="Round time">{hud.time}s</span>
      </header>
      <div
        className="arcade-field"
        style={{
          "--scene": `url(${mode === "duel" ? arena : ["stack", "pipes", "herbs"].includes(mode) ? workshop : marsh})`,
        }}
      >
        <canvas
          ref={canvas}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => {
            action(7);
            run.current.pointerId = null;
            run.current.trail = [];
          }}
          aria-label={hint}
        />
      </div>
      <div className="arcade-controls">
        {mode === "duel" && (
          <div
            className={`arcade-battle-cue ${hud.cue === "Strike now" ? "counter" : ""}`}
            aria-live="polite"
          >
            {hud.cue || "Watch the dragon"}
          </div>
        )}

        {mode === "stack" && (
          <button
            className="arcade-primary"
            disabled={disabled || run.current?.submitted}
            onClick={() => action(3)}
          >
            Place board <kbd>Space</kbd>
          </button>
        )}
        {["convoy", "duel"].includes(mode) && (
          <div
            className={`arcade-lanes ${mode === "duel" ? "with-strike" : ""}`}
          >
            {["← Left", "• Middle", "Right →"].map((label, i) => (
              <button
                key={i}
                aria-pressed={hud.lane === i}
                disabled={disabled || run.current?.submitted}
                onClick={() => action(4, i)}
              >
                {label}
              </button>
            ))}
            {mode === "duel" && (
              <button
                className={`arcade-primary ${hud.cue === "Strike now" ? "counter-ready" : ""}`}
                disabled={disabled || run.current?.submitted}
                onClick={() => action(5)}
              >
                Strike
              </button>
            )}
          </div>
        )}
        <div className="arcade-readout" role="status">
          <span>
            {disabled ? "Saving…" : hud.detail}
            {!disabled && hud.message && <small>{hud.message}</small>}
          </span>
          <b>{Math.round(hud.progress * 100)}%</b>
        </div>
        <div className="arcade-progress">
          <i style={{ transform: `scaleX(${hud.progress})` }} />
        </div>
        {feedback && (
          <small className={feedback.passed ? "arcade-good" : "arcade-missed"}>
            {feedback.passed
              ? "Previous round cleared"
              : "Previous round missed"}{" "}
            · {feedback.quality}%
          </small>
        )}
        {failed && (
          <button onClick={() => setRetry((n) => n + 1)}>
            Connection interrupted · Try this round again
          </button>
        )}
      </div>
    </section>
  );
}
