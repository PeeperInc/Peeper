import React, { useLayoutEffect, useRef, useState } from "react";
import core from "@peeper/frontier-core";
import useArcadeRun from "./useArcadeRun";
import KitItem from "./KitItem";
import "./WorkshopTouchStage.css";
const herbs = ["Mint", "Mushroom", "Marigold", "Berry"];
function Herb({ kind }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      {kind === 0 ? (
        <>
          <path
            d="M15 49C4 14 40 7 53 12C55 37 35 58 15 49Z"
            fill="#8fbc7c"
            stroke="#365344"
            strokeWidth="3"
          />
          <path
            d="M12 56L44 23M25 43L21 28M33 34L46 33"
            stroke="#365344"
            fill="none"
            strokeWidth="3"
          />
        </>
      ) : kind === 1 ? (
        <>
          <path
            d="M24 33L21 57H43L40 33"
            fill="#e5d8b3"
            stroke="#4d5040"
            strokeWidth="3"
          />
          <path
            d="M7 35C7 1 56 0 57 35Z"
            fill="#c98268"
            stroke="#584739"
            strokeWidth="3"
          />
          <circle cx="24" cy="22" r="5" fill="#f6dbac" />
          <circle cx="41" cy="19" r="4" fill="#f6dbac" />
        </>
      ) : kind === 2 ? (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <ellipse
              key={i}
              cx="32"
              cy="18"
              rx="9"
              ry="14"
              fill="#e6c475"
              stroke="#7f6943"
              strokeWidth="2"
              transform={`rotate(${i * 72} 32 32)`}
            />
          ))}
          <circle cx="32" cy="32" r="9" fill="#9c733c" />
        </>
      ) : (
        <>
          <path d="M32 51V12L45 7" stroke="#6d8b62" strokeWidth="4" />
          {[
            [21, 33],
            [42, 34],
            [32, 47],
          ].map(([x, y]) => (
            <circle
              key={x}
              cx={x}
              cy={y}
              r="12"
              fill="#879db5"
              stroke="#435a65"
              strokeWidth="3"
            />
          ))}
        </>
      )}
    </svg>
  );
}
export default function WorkshopTouchStage(props) {
  const { challenge, disabled } = props,
    a = challenge.arcade,
    match = a.mode === "match3",
    kit = a.theme === "kit",
    Piece = kit ? KitItem : Herb,
    names = kit ? ["Bandage", "Ration", "Tonic", "Flint"] : herbs,
    g = useArcadeRun(props, props.autoStart),
    { view: s, action, locked } = g;
  const svg = useRef(null),
    grid = useRef(null),
    finger = useRef(null),
    selected = useRef(null);
  const [motion, setMotion] = useState(null);
  const animationId = s.matchAnimation?.id;
  useLayoutEffect(() => {
    if (!animationId) {
      setMotion(null);
      return;
    }
    const frames = s.matchAnimation.frames;
    let index = 0,
      timer;
    function next() {
      if (index >= frames.length) {
        setMotion(null);
        return;
      }
      setMotion({ ...frames[index], key: `${animationId}:${index}` });
      timer = setTimeout(next, frames[index++].ms);
    }
    next();
    return () => clearTimeout(timer);
  }, [animationId, challenge.nonce]);
  const inputLocked = locked || !!motion;
  const drawnBoard = motion?.board || s.board;
  const stages = [
    "Saw on the marked line",
    "Plane along the grain",
    "Seat the four nails",
  ];
  function point(e) {
    const p = svg.current.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.current.getScreenCTM().inverse());
    return [
      Math.max(0, Math.min(1, q.x / 360)),
      Math.max(0, Math.min(1, q.y / 360)),
    ];
  }
  function cellPoint(i) {
    return [((i % 5) + 0.5) / 5, (Math.floor(i / 5) + 0.5) / 5];
  }
  function choose(i) {
    if (inputLocked) return;
    if (selected.current === null) {
      selected.current = i;
      action(0, ...cellPoint(i));
    } else if (selected.current === i) {
      selected.current = null;
      action(7);
    } else {
      action(2, ...cellPoint(i));
      selected.current = null;
    }
  }
  function cellAt(e) {
    const r = grid.current.getBoundingClientRect(),
      x = Math.max(
        0,
        Math.min(4, Math.floor(((e.clientX - r.left) / r.width) * 5)),
      ),
      y = Math.max(
        0,
        Math.min(4, Math.floor(((e.clientY - r.top) / r.height) * 5)),
      );
    return y * 5 + x;
  }
  const current = s.craftTrace?.at(-1),
    cursor = core.toolPulse(s),
    stage = s.carpentryStep;
  return (
    <section
      className={`workshop-touch ${match ? "touch-match3" : "touch-carpentry"}`}
      aria-label={
        match
          ? kit
            ? "Prepare an expedition kit"
            : "Brew the field remedy"
          : "Make a construction plank"
      }
    >
      <header>
        <h3>
          {match
            ? kit
              ? "Prepare the kit"
              : "Brew the remedy"
            : "Make it by hand"}
        </h3>
        <span>
          {match
            ? `${a.moves - s.moves} moves${kit ? ` · ${Math.max(0, Math.ceil((a.duration - s.t) / 1000))}s` : ""}`
            : `${Math.min(3, stage + 1)} / 3`}
        </span>
      </header>
      {match ? (
        <div className="remedy-orders" aria-label="Recipe">
          {a.orders.map(
            (n, i) =>
              n > 0 && (
                <div
                  key={i}
                  aria-label={`${names[i]}: ${Math.min(n, (motion?.collected || s.collected)[i])} of ${n}`}
                >
                  <Piece kind={i} />
                  <b>
                    {Math.min(n, (motion?.collected || s.collected)[i])}/{n}
                  </b>
                </div>
              ),
          )}
        </div>
      ) : (
        <p className="craft-instruction" role="status">
          {stages[stage]}
        </p>
      )}
      <div className="workshop-touch-field">
        {match ? (
          <div
            className={`remedy-grid ${motion ? "resolving" : ""}`}
            data-motion-frame={motion?.type || "ready"}
            ref={grid}
            onPointerUp={(e) => {
              if (!finger.current) return;
              const end = cellAt(e);
              if (end !== finger.current.start) {
                action(2, ...cellPoint(end));
                selected.current = null;
              }
              finger.current = null;
            }}
            onPointerCancel={() => {
              finger.current = null;
              selected.current = null;
              action(7);
            }}
          >
            {drawnBoard.map((kind, i) => (
              <button
                key={`${motion?.key || "rest"}:${i}`}
                className={`${s.matchStart === i ? "selected" : ""} ${motion?.type === "pop" && motion.cells.includes(i) ? "matched" : ""} ${motion?.type === "fall" ? "falling" : ""} ${["swap", "return"].includes(motion?.type) && [motion.from, motion.to].includes(i) ? "swapping" : ""} ${motion?.type === "shuffle" ? "reshuffle" : ""}`}
                style={{
                  "--fall": `${-(motion?.falls?.[i] || 0) * 108}%`,
                  "--swap-x": `${motion && i === motion.from ? ((motion.to % 5) - (motion.from % 5)) * 108 : motion && i === motion.to ? ((motion.from % 5) - (motion.to % 5)) * 108 : 0}%`,
                  "--swap-y": `${motion && i === motion.from ? (Math.floor(motion.to / 5) - Math.floor(motion.from / 5)) * 108 : motion && i === motion.to ? (Math.floor(motion.from / 5) - Math.floor(motion.to / 5)) * 108 : 0}%`,
                }}
                disabled={inputLocked}
                aria-label={`${names[kind]} row ${Math.floor(i / 5) + 1} column ${(i % 5) + 1}`}
                aria-pressed={s.matchStart === i}
                onPointerDown={(e) => {
                  if (inputLocked) return;
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  finger.current = { start: i };
                  choose(i);
                }}
                onClick={(e) => {
                  if (e.detail === 0) choose(i);
                }}
              >
                <Piece kind={kind} />
              </button>
            ))}
          </div>
        ) : (
          <svg
            ref={svg}
            viewBox="0 0 360 360"
            aria-label={stages[stage]}
            onPointerDown={(e) => {
              if (locked || stage === 2) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              finger.current = e.pointerId;
              action(0, ...point(e));
            }}
            onPointerMove={(e) => {
              if (finger.current !== e.pointerId) return;
              action(1, ...point(e));
            }}
            onPointerUp={(e) => {
              if (finger.current !== e.pointerId) return;
              action(2, ...point(e));
              finger.current = null;
            }}
            onPointerCancel={() => {
              finger.current = null;
              action(7);
            }}
          >
            <path d="M20 285L336 270V310L20 328Z" fill="#705c40" />
            <rect
              x="48"
              y="57"
              width="264"
              height="243"
              rx="8"
              fill="#bb915b"
              stroke="#534b36"
              strokeWidth="5"
            />
            {Array.from({ length: 9 }, (_, i) => (
              <path
                key={i}
                d={`M62 ${82 + i * 23} Q160 ${65 + i * 23} 300 ${78 + i * 23}`}
                fill="none"
                stroke={i % 2 ? "#d2ae78" : "#956e46"}
                strokeWidth="3"
              />
            ))}
            {stage === 0 && (
              <>
                <path
                  d={`M${a.cutX * 360} 48V305`}
                  stroke="#ffeb9b"
                  strokeWidth="6"
                  strokeDasharray="10 8"
                />
                <path
                  d={`M${a.cutX * 360 - 22} 110l22 18 22-18M${a.cutX * 360 - 22} 220l22 18 22-18`}
                  fill="none"
                  stroke="#fbe29a"
                  strokeWidth="6"
                />
                <g
                  transform={`translate(${(current?.[0] ?? a.cutX) * 360} ${(current?.[1] ?? 0.3) * 360})`}
                >
                  <rect
                    x="-25"
                    y="-17"
                    width="50"
                    height="34"
                    rx="9"
                    fill="#65482e"
                    stroke="#e4c486"
                    strokeWidth="6"
                  />
                  <path
                    d="M-6 17L-12 80L11 66L3 56L13 45L2 36L12 25"
                    fill="#bac5b6"
                    stroke="#3e5549"
                    strokeWidth="3"
                  />
                </g>
              </>
            )}
            {stage === 1 && (
              <>
                <path
                  d="M90 180H276M247 153L277 180L247 207"
                  fill="none"
                  stroke="#ffe6a2"
                  strokeWidth="6"
                />
                <g
                  transform={`translate(${(current?.[0] ?? 0.22) * 360} ${(current?.[1] ?? 0.5) * 360})`}
                >
                  <path
                    d="M-34 17L34 17L42-7L-29-14Z"
                    fill="#d0ad74"
                    stroke="#4e553b"
                    strokeWidth="4"
                  />
                  <path
                    d="M-14-10V-32H15V-9"
                    fill="#7c6844"
                    stroke="#4e553b"
                    strokeWidth="4"
                  />
                </g>
              </>
            )}
            {stage === 2 &&
              [
                [90, 115],
                [270, 115],
                [90, 255],
                [270, 255],
              ].map(([x, y], i) => (
                <g
                  key={i}
                  role="button"
                  tabIndex={locked ? -1 : 0}
                  aria-label={`Hammer nail ${i + 1}`}
                  aria-disabled={locked || !s.nailHP[i]}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!locked) action(6, i);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !locked) action(6, i);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <circle cx={x} cy={y} r="40" fill="transparent" />
                  <circle
                    cx={x}
                    cy={y}
                    r={s.nailHP[i] ? 27 : 14}
                    fill={
                      s.nailHP[i]
                        ? cursor > 0.72
                          ? "#f5d17e"
                          : "#c0d3bb"
                        : "#77937a"
                    }
                    stroke="#344e40"
                    strokeWidth="4"
                  />
                  <path
                    d={`M${x - 7} ${y}H${x + 7}M${x} ${y - 7}V${y + 7}`}
                    stroke="#465b4b"
                    strokeWidth="3"
                  />
                  {!s.nailHP[i] && (
                    <text x={x} y={y + 5} textAnchor="middle" fill="#eaf1d2">
                      ✓
                    </text>
                  )}
                </g>
              ))}
          </svg>
        )}
        {!g.started && (
          <div className="touch-intro">
            <h4>
              {match
                ? kit
                  ? "Fill the kit"
                  : "Fill the recipe"
                : "Saw. Plane. Nail."}
            </h4>
            <p>
              {match
                ? kit
                  ? `Swap neighbours to match 3. Collect the three supplies shown above within ${a.moves} moves. Cascades count too.`
                  : "Swap neighbours to match 3. Fill all three recipe jars before your moves run out."
                : "Follow the mark on the wood. Each step is shown on the plank."}
            </p>
            <button onClick={g.start} disabled={disabled}>
              Start →
            </button>
          </div>
        )}
        {match && motion?.type === "pop" && (
          <div className="cascade-caption" key={motion.key}>
            {motion.cascade > 1
              ? `Cascade ×${motion.cascade}`
              : kit
                ? "Supplies collected!"
                : "Fresh ingredients!"}
          </div>
        )}
        {s.done && !motion && (
          <div className="touch-result" role="status">
            <b>
              {g.grade.passed
                ? match
                  ? kit
                    ? "Kit ready"
                    : "Remedy brewed"
                  : "Plank finished"
                : "Try another batch"}
            </b>
            <span>{g.grade.quality}%</span>
          </div>
        )}
      </div>
      <footer>
        <p role="status">
          {s.message ||
            (match
              ? kit
                ? "Match 3 supplies · fill all three orders"
                : "Swap two neighbouring ingredients"
              : stage === 0
                ? "Drag the saw down the gold line"
                : stage === 1
                  ? "Slide across the grain"
                  : "Tap nail heads · gold seats them faster")}
        </p>
        {match && !kit && (
          <small>
            {Math.max(0, Math.ceil((a.duration - s.t) / 1000))}s remaining
          </small>
        )}
        {g.failed && <button onClick={g.retry}>Connection lost · Retry</button>}
      </footer>
    </section>
  );
}
