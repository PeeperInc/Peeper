import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import core from "@peeper/frontier-core";
import useArcadeRun from "./useArcadeRun";
import { createFieldScene } from "./fieldScene.mjs";
import "./TouchStage.css";
import ScenePeeper from "./ScenePeeper";

const copy = {
  chopping: [
    "Split the timber",
    "Hold the marked notch. Release inside its gold arc — every cut has a different window. Four misses end this attempt.",
  ],
  quarrying: [
    "Crack the iron vein",
    "Hit the marked crack only when its ring turns gold. Bright gold breaks more rock. Five misses end this attempt.",
  ],
  trail: [
    "Bring the cargo home",
    "Drag to steer. Swipe up to hop over stumps. Collect 3 crates.",
  ],
};
export default function TouchStage(props) {
  const { challenge, disabled } = props,
    a = challenge.arcade,
    mode = a.mode,
    trail = mode === "trail",
    mining = mode === "quarrying";
  const game = useArcadeRun(props, trail || props.autoStart),
    { view: s, run, action, locked } = game;
  const host = useRef(null),
    targets = useRef(null),
    avatar = useRef(null),
    drag = useRef(null),
    steeringRange = useRef(null),
    [flat, setFlat] = useState(false);
  useEffect(() => {
    let renderer,
      world,
      raf,
      observer,
      disposed = false,
      last = 0,
      idlePainted = false;
    const el = host.current,
      sceneMode = trail ? "convoy" : mining ? "mining" : "logging";
    try {
      if (import.meta.env.DEV && location.search.includes("no3d"))
        throw Error("Simple view");
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.domElement.setAttribute("aria-hidden", "true");
      el.prepend(renderer.domElement);
      world = createFieldScene(sceneMode, {
        ...challenge,
        arcade: { ...a, mode: sceneMode },
      });
      const resize = () => {
        if (disposed) return;
        const w = el.clientWidth,
          h = el.clientHeight;
        renderer.setSize(w, h);
        world.camera.aspect = w / Math.max(1, h);
        world.camera.zoom = trail
          ? 0.74
          : Math.max(1.1, Math.min(mining ? 1.8 : 2, (w / h) * 0.95));
        world.camera.updateProjectionMatrix();
        if (trail) {
          world.camera.updateMatrixWorld();
          const left = new THREE.Vector3(-3, 0.75, 0).project(world.camera),
            right = new THREE.Vector3(3, 0.75, 0).project(world.camera);
          steeringRange.current = {
            left: ((left.x + 1) * w) / 2,
            right: ((right.x + 1) * w) / 2,
          };
        }
        idlePainted = false;
      };
      observer = new ResizeObserver(resize);
      observer.observe(el);
      resize();
      setFlat(false);
      const v = new THREE.Vector3(),
        reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      const lost = (e) => {
        e.preventDefault();
        steeringRange.current = null;
        setFlat(true);
      };
      renderer.domElement.addEventListener("webglcontextlost", lost);
      function draw(now) {
        if (disposed) return;
        raf = requestAnimationFrame(draw);
        if (document.hidden) return;
        const state = run.current?.s;
        if (!state) return;
        const idle = !Number.isFinite(run.current.start) || state.done;
        if (idle && idlePainted) return;
        idlePainted = idle;
        const visual = {
          ...state,
          selectedNode: mining ? (a.order[state.oreFound] ?? 0) : 0,
          stamina: 1,
        };
        world.update(visual, state.t / 1000, reduced.matches);
        if (trail) {
          const age = state.t - state.jumpAt;
          if (age >= 0 && age < 650)
            world.hop?.(Math.sin((age / 650) * Math.PI) * 1.5);
        }
        renderer.render(world.scene, world.camera);
        if (trail && avatar.current && world.peeperAnchor) {
          world.peeperAnchor.getWorldPosition(v).project(world.camera);
          avatar.current.style.left = `${(v.x + 1) * 50}%`;
          avatar.current.style.top = `${(1 - v.y) * 50}%`;
        }
        if (targets.current && now - last > 80) {
          last = now;
          targets.current
            .querySelectorAll("[data-target]")
            .forEach((button) => {
              const i = Number(button.dataset.target),
                point = mining
                  ? world.nodes[i]?.position
                  : { x: i === 0 ? -0.7 : 0.7, y: 1.5, z: 0.15 };
              if (!point) return;
              v.set(point.x, mining ? point.y + 0.7 : point.y, point.z).project(
                world.camera,
              );
              button.style.left = `${(v.x + 1) * 50}%`;
              button.style.top = `${(1 - v.y) * 50}%`;
            });
        }
      }
      raf = requestAnimationFrame(draw);
      return () => {
        steeringRange.current = null;
        disposed = true;
        cancelAnimationFrame(raf);
        observer.disconnect();
        world.dispose();
        renderer.domElement.removeEventListener("webglcontextlost", lost);
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch (error) {
      observer?.disconnect();
      world?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
      setFlat(true);
    }
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [challenge.nonce]);
  const active = mining ? a.order[s.oreFound] : a.notches?.[s.cutsMade],
    power = s.charging ? Math.min(1.2, (s.t - s.chargeStarted) / 1000) : 0,
    pulse = mining ? core.toolPulse(s) : power;
  const chargeWindow = a.windows?.[s.cutsMade] || [350, 1100],
    gold = mining
      ? pulse > (a.precision ? 0.66 : 0.72)
      : power * 1000 >= chargeWindow[0] && power * 1000 <= chargeWindow[1];
  const title = copy[mode][0],
    cue = s.done
      ? game.grade.passed
        ? "Ready for the stores"
        : "Try again"
      : trail
        ? "Drag to steer · swipe up to hop"
        : mining
          ? gold
            ? "Strike now"
            : "Wait for gold"
          : s.charging
            ? gold
              ? "Release now"
              : power * 1000 > chargeWindow[1]
                ? "Too late — try again"
                : "Keep holding"
            : "Hold the glowing notch";
  function beginHold(e, index) {
    if (locked) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    action(6, index);
    action(0);
  }
  function steer(e) {
    const r = host.current.getBoundingClientRect();
    const range = steeringRange.current || {
      left: r.width * 0.22,
      right: r.width * 0.78,
    };
    return [
      Math.max(
        0.22,
        Math.min(
          0.78,
          0.22 +
            ((e.clientX - r.left - range.left) /
              Math.max(1, range.right - range.left)) *
              0.56,
        ),
      ),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    ];
  }
  return (
    <section className={`touch-stage touch-${mode}`} aria-label={title}>
      <header>
        <h3>{title}</h3>
        <b>
          {trail
            ? `${s.crates} / 3 cargo`
            : mining
              ? `${s.oreFound} / 3 cracks`
              : `${s.cutsMade} / 6 splits`}
        </b>
      </header>
      <div
        className="touch-scene"
        ref={host}
        onPointerDown={
          trail
            ? (e) => {
                if (locked) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, last: -1000 };
                action(0, ...steer(e));
              }
            : undefined
        }
        onPointerMove={
          trail
            ? (e) => {
                if (!drag.current || locked) return;
                const now = performance.now();
                if (drag.current.y - e.clientY > 40) {
                  action(5);
                  drag.current.y = e.clientY;
                }
                if (now - drag.current.last > 45) {
                  action(1, ...steer(e));
                  drag.current.last = now;
                }
              }
            : undefined
        }
        onPointerUp={
          trail
            ? (e) => {
                if (drag.current) action(2, ...steer(e));
                drag.current = null;
              }
            : undefined
        }
        onPointerCancel={() => {
          drag.current = null;
          action(7);
        }}
      >
        {!mining && (
          <ScenePeeper ref={avatar} className={s.charging ? "working" : ""} />
        )}
        {!trail && (
          <div className="field-round-track" aria-label="Round progress">
            <div>
              {Array.from({ length: mining ? 3 : 6 }, (_, i) => (
                <i
                  key={i}
                  className={
                    i < (mining ? s.oreFound : s.cutsMade)
                      ? "complete"
                      : i === (mining ? s.oreFound : s.cutsMade)
                        ? "current"
                        : ""
                  }
                />
              ))}
            </div>
            <span>
              {Math.ceil((a.duration - s.t) / 1000)}s ·{" "}
              {Math.max(0, (a.mistakeLimit || 99) - s.faults)} misses left
            </span>
          </div>
        )}
        {trail ? (
          <>
            {flat && (
              <div className="flat-trail" aria-label="Trail view">
                {a.rows.map((row, i) => {
                  const age = (s.t - row.at) / 1800;
                  return !s.crossed.includes(i) && age >= 0 && age < 1.2 ? (
                    <React.Fragment key={i}>
                      <span
                        className="flat-stump"
                        aria-label="Stump"
                        style={{
                          left: `${22 + row.obstacle * 28}%`,
                          top: `${12 + age * 68}%`,
                        }}
                      >
                        ▥
                      </span>
                      <span
                        className="flat-crate"
                        aria-label="Cargo crate"
                        style={{
                          left: `${22 + row.crate * 28}%`,
                          top: `${12 + age * 68}%`,
                        }}
                      >
                        ✦
                      </span>
                    </React.Fragment>
                  ) : null;
                })}
                <span
                  className="flat-cart"
                  style={{
                    left: `${s.x * 100}%`,
                    transform: `translate(-50%,${s.t - s.jumpAt >= 0 && s.t - s.jumpAt < 650 ? -28 : 0}px)`,
                  }}
                >
                  ▣
                </span>
              </div>
            )}
            <div className="touch-condition">
              {"●".repeat(Math.max(0, s.health))}
              {"○".repeat(3 - Math.max(0, s.health))}
            </div>
            {game.started && s.t < 2000 && (
              <div className="touch-drag-hint">
                ↔<span>Drag your cart</span>
              </div>
            )}
          </>
        ) : (
          <div className={`touch-targets ${flat ? "flat" : ""}`} ref={targets}>
            {Array.from({ length: mining ? 3 : 2 }, (_, index) => (
              <button
                key={index}
                data-target={index}
                aria-label={
                  mining
                    ? `Strike crack ${index + 1}`
                    : `Hold ${index ? "right" : "left"} notch`
                }
                disabled={
                  locked ||
                  index !== active ||
                  (mining && s.t - s.lastStrike < 380)
                }
                className={`touch-hit ${active === index ? "active" : ""} ${gold ? "gold" : ""}`}
                style={{ "--ring": `${Math.max(0.25, 1 - pulse * 0.7)}` }}
                onPointerDown={
                  mining
                    ? (e) => {
                        e.preventDefault();
                        action(6, index);
                      }
                    : (e) => beginHold(e, index)
                }
                onPointerUp={!mining ? () => action(2) : undefined}
                onPointerCancel={() => action(7)}
                onLostPointerCapture={() => {
                  if (run.current?.s.charging) action(7);
                }}
                onClick={(e) => {
                  if (e.detail === 0) {
                    if (mining) action(6, index);
                    else if (run.current?.s.charging) action(2);
                    else {
                      action(6, index);
                      action(0);
                    }
                  }
                }}
              >
                <i />
                {mining && (
                  <em
                    className="fracture-pips"
                    aria-label={`${s.rockHP[index]} fracture strength remaining`}
                  >
                    {Array.from({ length: 3 }, (_, i) => (
                      <b
                        key={i}
                        className={i < s.rockHP[index] ? "" : "broken"}
                      />
                    ))}
                  </em>
                )}
                {!mining && (
                  <svg
                    className="timing-dial"
                    viewBox="0 0 100 100"
                    aria-hidden="true"
                  >
                    <circle
                      cx="50"
                      cy="50"
                      r="44"
                      pathLength="1200"
                      strokeDasharray={`${chargeWindow[1] - chargeWindow[0]} ${1200 - (chargeWindow[1] - chargeWindow[0])}`}
                      strokeDashoffset={-chargeWindow[0]}
                    />
                    <path
                      d="M50 50V9"
                      style={{ transform: `rotate(${power * 300}deg)` }}
                    />
                  </svg>
                )}
                <span>{mining ? "✦" : s.charging ? "↑" : "☝"}</span>
                <small>
                  {mining
                    ? gold
                      ? "Strike!"
                      : "Wait for gold"
                    : s.charging
                      ? "Release in gold"
                      : "Hold here"}
                </small>
              </button>
            ))}
          </div>
        )}
        {s.flash && s.t - s.flash.t < 600 && (
          <div
            key={s.flash.t}
            className={`field-impact ${s.flash.bad ? "miss" : ""}`}
          >
            {s.flash.bad
              ? "Glancing hit"
              : mining
                ? "Fracture!"
                : "Clean split!"}
          </div>
        )}
        {!game.started && (
          <div className="touch-intro">
            <h4>{title}</h4>
            <p>{copy[mode][1]}</p>
            <button onClick={game.start} disabled={disabled}>
              Start →
            </button>
          </div>
        )}
        {s.done && (
          <div className="touch-result" role="status">
            <b>
              {game.grade.passed
                ? mining
                  ? "Iron secured"
                  : trail
                    ? "Delivery saved"
                    : "Timber ready"
                : "Another try"}
            </b>
            <span>{game.grade.quality}%</span>
          </div>
        )}
      </div>
      <footer>
        <b role="status">{cue}</b>
        {s.message && <p>{s.message}</p>}
        {game.failed && (
          <button onClick={game.retry}>Connection lost · Retry</button>
        )}
      </footer>
    </section>
  );
}
