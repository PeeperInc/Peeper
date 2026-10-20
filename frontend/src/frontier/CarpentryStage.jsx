import React, { useLayoutEffect, useRef } from "react";
import core from "@peeper/frontier-core";
import useArcadeRun from "./useArcadeRun";
import "./CarpentryStage.css";
import { workbenchPoint } from "./arcadeInput.mjs";

const names = ["Saw", "Plane", "Fasten"];
export default function CarpentryStage(props) {
  const g = useArcadeRun(props, props.autoStart),
    { view: s, action, locked } = g,
    a = props.challenge.arcade;
  const canvas = useRef(null),
    finger = useRef(null),
    cursor = useRef(null),
    tool = useRef(null);
  const stage = s.carpentryStep,
    guided = !!a.workbench;
  const required =
    stage === 0 ? a.workbench?.saw || 1 : a.workbench?.plane || 1;
  const passes = s.craftStrokes?.[stage] || 0;
  const trace = s.craftTrace;
  const distance = guided
    ? s.craftDirection !== s.craftLastDirection
      ? s.craftDistance
      : 0
    : trace?.length
      ? Math.abs(
          trace.at(-1)[stage === 0 ? 1 : 0] - trace[0][stage === 0 ? 1 : 0],
        )
      : 0;
  const fraction = Math.min(
    1,
    (passes + Math.min(1, distance / (stage === 0 ? 0.26 : 0.48))) / required,
  );
  const nails = s.nailHP.filter((n) => n === 0).length;
  const gold = core.toolPulse(s) > 0.72;
  const prompt =
    stage === 0
      ? guided
        ? "Slide the saw up and down the guide"
        : "Saw down the guide, then lift your finger"
      : stage === 1
        ? guided
          ? "Plane across the plank and back"
          : "Plane across the plank, then lift"
        : "Tap the nail heads · gold drives them deeper";
  useLayoutEffect(() => {
    finger.current = null;
    cursor.current = null;
  }, [stage, props.challenge.nonce]);
  function pose(p) {
    return stage === 0
      ? `translate(${a.cutX * 400} ${p[1] * 300})`
      : `translate(${p[0] * 400} 150)`;
  }
  function point(e) {
    return workbenchPoint(
      canvas.current.getBoundingClientRect(),
      e.clientX,
      e.clientY,
    );
  }
  function move(e, type) {
    if (finger.current !== e.pointerId) return;
    const p = point(e);
    cursor.current = p;
    tool.current?.setAttribute("transform", pose(p));
    action(type, ...p);
    if (type === 2) finger.current = null;
  }
  const at = cursor.current || (stage === 0 ? [a.cutX, 0.3] : [0.22, 0.5]);
  return (
    <section
      className="carpentry-stage"
      aria-label="Make construction planks"
      data-craft-stage={stage}
    >
      <header>
        <div>
          <small>CROOKED POST · WORKSHOP</small>
          <h3>
            {stage === 0
              ? "Cut to size"
              : stage === 1
                ? "A smooth finish"
                : "Make it hold"}
          </h3>
        </div>
        <b>{Math.max(0, Math.ceil((a.duration - s.t) / 1000))}s</b>
      </header>
      <ol className="carpentry-steps" aria-label="Plank making steps">
        {names.map((name, i) => (
          <li
            key={name}
            className={i < stage ? "complete" : i === stage ? "current" : ""}
          >
            <span>{i < stage ? "✓" : i + 1}</span>
            {name}
          </li>
        ))}
      </ol>
      <div className="carpentry-field">
        <svg
          ref={canvas}
          className="carpentry-canvas"
          viewBox="0 0 400 300"
          role="img"
          aria-label={prompt}
          onPointerDown={(e) => {
            if (locked || stage === 2 || e.isPrimary === false) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            finger.current = e.pointerId;
            cursor.current = point(e);
            action(0, ...cursor.current);
          }}
          onPointerMove={(e) => move(e, 1)}
          onPointerUp={(e) => move(e, 2)}
          onPointerCancel={() => {
            finger.current = null;
            action(7);
          }}
          onLostPointerCapture={() => {
            if (finger.current !== null) {
              finger.current = null;
              action(7);
            }
          }}
        >
          <defs>
            <linearGradient id="plank-face" x2=".2" y2="1">
              <stop stopColor="#deb77a" />
              <stop offset=".55" stopColor="#bf8c50" />
              <stop offset="1" stopColor="#a46d3b" />
            </linearGradient>
            <linearGradient id="saw-steel" x2="1" y2="0">
              <stop stopColor="#91a9a0" />
              <stop offset=".45" stopColor="#eff0d1" />
              <stop offset="1" stopColor="#809c90" />
            </linearGradient>
            <pattern
              id="bench-grain"
              width="80"
              height="28"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M0 10Q30 3 80 10M0 24Q30 18 80 24"
                fill="none"
                stroke="#192e27"
                strokeOpacity=".25"
                strokeWidth="2"
              />
            </pattern>
          </defs>
          <path d="M0 39L400 26V300H0Z" fill="#384d3c" />
          <path d="M0 39L400 26V300H0Z" fill="url(#bench-grain)" />
          <ellipse
            cx="205"
            cy="242"
            rx="163"
            ry="24"
            fill="#1b3028"
            opacity=".4"
          />
          <path
            d="M46 68L354 68L365 84V236L56 248L46 231Z"
            fill="#715333"
            stroke="#2c3b2b"
            strokeWidth="3"
          />
          <rect
            x="46"
            y="59"
            width="308"
            height="172"
            rx="7"
            fill="url(#plank-face)"
            stroke="#5d4b2d"
            strokeWidth="3"
          />
          <path
            d="M51 65H348M51 225H349"
            stroke="#f0cf92"
            strokeWidth="3"
            opacity=".6"
          />
          {Array.from({ length: 9 }, (_, i) => (
            <path
              key={i}
              d={`M57 ${78 + i * 17}Q${130 + i * 4} ${68 + i * 17} 344 ${77 + i * 17}`}
              fill="none"
              stroke={i % 2 ? "#e0b278" : "#8e623a"}
              strokeWidth={i % 3 ? 1.5 : 2.5}
              opacity=".65"
            />
          ))}
          <ellipse
            cx="280"
            cy="176"
            rx="19"
            ry="6"
            fill="none"
            stroke="#9b6c3c"
            strokeWidth="2"
          />
          <ellipse cx="280" cy="176" rx="9" ry="3" fill="#a47742" />
          <g fill="#728373" stroke="#253f32" strokeWidth="2">
            <path d="M24 91H54V106H36V146H24Z" />
            <path d="M345 185H375V235H363V201H345Z" />
          </g>
          {stage === 0 && (
            <>
              <rect
                x={a.cutX * 400 - 14}
                y="43"
                width="28"
                height="202"
                rx="14"
                fill="#f9e5aa"
                opacity=".15"
              />
              <path
                d={`M${a.cutX * 400} 50V240`}
                stroke="#f7df9b"
                strokeWidth="3"
                strokeDasharray="7 7"
              />
              <path
                d={`M${a.cutX * 400} 64V${64 + fraction * 158}`}
                stroke="#65472c"
                strokeWidth="4"
              />
              <g
                fill="none"
                stroke="#f9e4a9"
                strokeWidth="3"
                strokeLinecap="round"
              >
                <path
                  d={`M${a.cutX * 400 - 8} 47l8-8 8 8M${a.cutX * 400 - 8} 250l8 8 8-8`}
                />
              </g>
            </>
          )}
          {stage === 1 && (
            <>
              <path
                d="M80 150H320M95 139L80 150L95 161M305 139L320 150L305 161"
                stroke="#ffdfa0"
                strokeWidth="4"
                fill="none"
                strokeLinecap="round"
              />
              <rect
                x="60"
                y="87"
                width="280"
                height="125"
                rx="5"
                fill="#f9dfa4"
                opacity={0.04 + fraction * 0.12}
              />
              {[0, 1, 2].map((i) => (
                <path
                  key={i}
                  d={`M${95 + i * 35} 244q-15-12 1-15t0 13`}
                  fill="none"
                  stroke="#edc383"
                  strokeWidth="4"
                />
              ))}
            </>
          )}
          {stage < 2 && (
            <g
              ref={tool}
              transform={pose(at)}
              className="carpentry-tool"
              aria-hidden="true"
            >
              {stage === 0 ? (
                <>
                  <path
                    d="M-17-3L-10 88L-2 80L7 85L9 73L18 77L19 65L26 69L25-6Z"
                    fill="url(#saw-steel)"
                    stroke="#40594b"
                    strokeWidth="2"
                  />
                  <path
                    d="M-34-29Q-39-43-21-44H20Q36-42 35-28L28-5H-24Z"
                    fill="#9d6139"
                    stroke="#4c3e29"
                    strokeWidth="4"
                  />
                  <path
                    d="M-22-30Q-24-36-15-36H13Q23-35 20-28L14-17H-17Z"
                    fill="#2e4436"
                    stroke="#edbd77"
                    strokeWidth="3"
                  />
                  <circle cx="24" cy="-10" r="3" fill="#e7cb86" />
                </>
              ) : (
                <>
                  <path
                    d="M-42 6L30 12L49-2L42-16L-30-22L-45-9Z"
                    fill="#bd864b"
                    stroke="#4c4b30"
                    strokeWidth="3"
                  />
                  <path
                    d="M-43 8L29 16L49 0"
                    stroke="#dfdfb4"
                    strokeWidth="5"
                  />
                  <path
                    d="M-9-21L-4-52L11-47L8-19"
                    fill="#859d90"
                    stroke="#334c3f"
                    strokeWidth="3"
                  />
                  <path
                    d="M-28-19Q-40-53-18-51Q-6-44-16-24M20-16Q39-42 39-15"
                    fill="#7f522f"
                    stroke="#503e27"
                    strokeWidth="5"
                  />
                </>
              )}
            </g>
          )}
          {stage === 2 &&
            [
              [94, 100],
              [306, 100],
              [94, 197],
              [306, 197],
            ].map(([x, y], i) => (
              <g
                key={i}
                role="button"
                tabIndex={locked ? -1 : 0}
                aria-label={`Hammer nail ${i + 1}`}
                aria-disabled={locked || !s.nailHP[i]}
                className={`carpentry-nail ${s.nailHP[i] ? (gold ? "gold" : "") : "seated"}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (!locked) action(6, i);
                }}
                onKeyDown={(e) => {
                  if (["Enter", " "].includes(e.key)) {
                    e.preventDefault();
                    if (!locked) action(6, i);
                  }
                }}
              >
                <circle cx={x} cy={y} r="36" className="nail-target" />
                <ellipse
                  cx={x}
                  cy={y + 11}
                  rx="16"
                  ry="5"
                  fill="#3e4a31"
                  opacity=".35"
                />
                <path
                  d={`M${x} ${y + 12}V${y - 9 - s.nailHP[i] * 7}`}
                  stroke="#afc2b2"
                  strokeWidth="6"
                />
                <ellipse
                  cx={x}
                  cy={y - 9 - s.nailHP[i] * 7}
                  rx={s.nailHP[i] ? 15 : 10}
                  ry="7"
                  className="nail-head"
                />
                {!s.nailHP[i] && (
                  <path
                    d={`M${x - 5} ${y - 9}l4 4 7-8`}
                    fill="none"
                    stroke="#344f3c"
                    strokeWidth="2"
                  />
                )}
              </g>
            ))}
          {s.flash && s.t - s.flash.t < 450 && (
            <g className="carpentry-chips" key={s.flash.t}>
              {Array.from({ length: 6 }, (_, i) => (
                <path
                  key={i}
                  d={`M${a.cutX * 400 + (i - 3) * 12} ${195 + (i % 2) * 22}l${i % 2 ? 8 : -9} -5`}
                  stroke="#f1d3a0"
                  strokeWidth="3"
                />
              ))}
            </g>
          )}
        </svg>
        {!g.started && (
          <div className="carpentry-intro">
            <span>FROM ROUGH WOOD TO A STRONG PLANK</span>
            <h4>Cut. Smooth. Fasten.</h4>
            <p>
              Move the saw back and forth along its rail. Plane the surface,
              then drive four nails. Progress appears as you work.
            </p>
            <button onClick={g.start} disabled={props.disabled}>
              Take the tools →
            </button>
          </div>
        )}
        {s.done && (
          <div className="carpentry-result" role="status">
            <span>{g.grade.passed ? "✓" : "↻"}</span>
            <h4>
              {g.grade.passed ? "A job well made" : "Give it another try"}
            </h4>
            <p>
              {g.grade.passed
                ? "Your plank is ready for the community"
                : "Completed rounds are kept"}
            </p>
          </div>
        )}
      </div>
      <footer>
        <div className="carpentry-progress">
          <div
            style={{ width: `${(stage === 2 ? nails / 4 : fraction) * 100}%` }}
          />
        </div>
        <div className="carpentry-status">
          <b>{prompt}</b>
          <span>
            {stage === 2
              ? `${nails}/4 nails`
              : guided
                ? `${passes}/${required} passes`
                : "Follow the guide"}
          </span>
        </div>
        <p role="status">
          {s.message ||
            (stage === 0
              ? "Grip the handle · short back-and-forth strokes"
              : stage === 1
                ? "Drag the plane across the wood"
                : "Tap a nail again if it is still raised")}
        </p>
        {g.failed && <button onClick={g.retry}>Retry saving this round</button>}
      </footer>
    </section>
  );
}
