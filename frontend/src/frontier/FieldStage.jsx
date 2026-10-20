import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import core from "@peeper/frontier-core";
import { createFieldScene } from "./fieldScene.mjs";
import "./FieldStage.css";
import ScenePeeper from "./ScenePeeper";

const labels = {
  logging: [
    "MOSSWOOD MILL",
    "Read the grain",
    "Six clean splits. Match the marked side, hold your swing and release in brass. Rest to recover stamina.",
  ],
  mining: [
    "PEBBLE QUARRY",
    "Take the iron. Keep the roof.",
    "Seat a wooden support before taking all three iron pockets. Light hits are safer; charged hits break ore faster. Avoid loose shale.",
  ],
  convoy: [
    "THE REED TRAIL",
    "Bring everyone home",
    "Recover three crates and steer around stumps. Hold Brace or Space before sharp turns to stop cargo spilling. Bracing slows steering.",
  ],
  duel: [
    "THE DRAGON’S HOLLOW",
    "Make the charge miss",
    "Move into the gold lane before the charge. Counter during the opening. Two dodges and one counter clear the round.",
  ],
};
const nodeName = {
  ore: "Iron pocket",
  brace: "Support",
  brittle: "Loose shale",
};
export default function FieldStage({
  challenge,
  disabled,
  onComplete,
  feedback,
}) {
  const host = useRef(null),
    avatar = useRef(null),
    anchors = useRef(null),
    run = useRef(null),
    send = useRef(onComplete),
    blocked = useRef(disabled),
    audio = useRef(null);
  send.current = onComplete;
  blocked.current = disabled;
  const mode = challenge.arcade.mode,
    gather = ["logging", "mining"].includes(mode),
    [kicker, title, hint] = labels[mode];
  const [view, setView] = useState(() => core.create(challenge)),
    [started, setStarted] = useState(!gather),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0),
    [no3D, setNo3D] = useState(false),
    [muted, setMuted] = useState(true);
  function sound(bad) {
    if (muted) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio.current) audio.current = new AC();
      const ac = audio.current;
      ac.resume();
      const osc = ac.createOscillator(),
        gain = ac.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(
        bad ? 100 : mode === "mining" ? 520 : 230,
        ac.currentTime,
      );
      osc.frequency.exponentialRampToValueAtTime(55, ac.currentTime + 0.12);
      gain.gain.setValueAtTime(0.05, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.14);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.15);
    } catch {
      /* Sound is optional; gameplay never depends on audio permissions. */
    }
  }
  function action(type, x = 0) {
    const r = run.current;
    if (
      !r ||
      r.sent ||
      r.s.done ||
      blocked.current ||
      performance.now() < r.start ||
      r.events.length >= 248
    )
      return;
    const event = [
      Math.min(
        challenge.arcade.duration,
        Math.max(Math.ceil(r.s.t), Math.round(performance.now() - r.start)),
      ),
      type,
      x,
      0,
    ];
    r.events.push(event);
    const revision = r.s.revision;
    core.act(r.s, event);
    if (revision !== r.s.revision) sound(r.s.flash?.bad);
    setView({ ...r.s });
  }
  useEffect(() => {
    const mount = host.current,
      r = {
        s: core.create(challenge),
        events: [],
        start: gather ? Infinity : performance.now() + 600,
        sent: false,
      };
    run.current = r;
    setStarted(!gather);
    setFailed(false);
    setNo3D(false);
    setView({ ...r.s });
    let renderer,
      world,
      observer,
      frame,
      dead = false,
      lastHUD = 0,
      lastRender = 0,
      pending;
    try {
      if (
        import.meta.env.DEV &&
        new URLSearchParams(window.location.search).has("no3d")
      )
        throw new Error("Local fallback check");
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.domElement.setAttribute("aria-hidden", "true");
      mount.prepend(renderer.domElement);
      world = createFieldScene(mode, challenge);
      const resize = () => {
        if (dead) return;
        const w = mount.clientWidth,
          h = mount.clientHeight;
        renderer.setSize(w, h);
        world.camera.aspect = w / Math.max(1, h);
        world.camera.zoom = gather
          ? Math.max(
              mode === "logging" ? 1.05 : 1,
              Math.min(
                mode === "logging" ? 1.9 : 1.45,
                (w / Math.max(1, h)) * 0.85,
              ),
            )
          : 1;
        world.camera.updateProjectionMatrix();
        r.wake?.();
      };
      observer = new ResizeObserver(resize);
      observer.observe(mount);
      resize();
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
    } catch (error) {
      console.warn("Reedbank field scene unavailable", error);
      observer?.disconnect();
      world?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
      world = null;
      renderer = null;
      setNo3D(true);
    }
    function contextLost(e) {
      e.preventDefault();
      setNo3D(true);
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)"),
      v = new THREE.Vector3();
    function draw(now) {
      if (dead) return;
      frame = requestAnimationFrame(draw);
      const t = Number.isFinite(r.start) ? Math.max(0, now - r.start) : 0;
      core.advance(r.s, t);
      if (now - lastHUD > 45) {
        lastHUD = now;
        setView({ ...r.s });
      }
      if (renderer && world && !document.hidden && now - lastRender >= 32) {
        lastRender = now;
        world.update(
          r.s,
          Number.isFinite(r.start) ? t / 1000 : 0,
          reduced.matches,
        );
        renderer.render(world.scene, world.camera);
        if (avatar.current && world.peeperAnchor) {
          world.peeperAnchor.getWorldPosition(v).project(world.camera);
          avatar.current.style.left = `${(v.x + 1) * 50}%`;
          avatar.current.style.top = `${(1 - v.y) * 50}%`;
        }
        anchors.current?.querySelectorAll("[data-node]").forEach((el) => {
          const n = world.nodes[Number(el.dataset.node)];
          if (!n?.position) return;
          v.copy(n.position);
          v.y = 1.95;
          v.project(world.camera);
          el.style.left = `${(v.x + 1) * 50}%`;
          el.style.top = `${(1 - v.y) * 50}%`;
        });
        mount.dataset.drawCalls = String(renderer.info.render.calls);
        mount.dataset.triangles = String(renderer.info.render.triangles);
      }
      if (r.s.done && !r.sent) {
        r.sent = true;
        if (!r.events.length) r.events.push([Math.round(r.s.t), 7, 0, 0]);
        pending = setTimeout(async () => {
          try {
            const result = await send.current({ events: r.events });
            if (!dead && !result) setFailed(true);
          } catch {
            if (!dead) setFailed(true);
          }
        }, 450);
        setView({ ...r.s });
      }
      // Idle scenes and completed rounds render once; input/start resumes them.
      if ((!Number.isFinite(r.start) || r.s.done) && !document.hidden) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    }
    r.wake = () => {
      if (frame === null) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    function cancel() {
      if (r.s.charging || r.s.bracing) action(7);
    }
    function visibility() {
      if (document.hidden) cancel();
      else r.wake();
    }
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      dead = true;
      cancelAnimationFrame(frame);
      clearTimeout(pending);
      observer?.disconnect();
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
      world?.dispose();
      renderer?.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [challenge.nonce, retry]);
  // The action ref lets input listeners see the latest callback and disabled state.
  const act = useRef(action);
  act.current = action;
  useEffect(() => {
    function key(e) {
      if (
        /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) ||
        e.target.isContentEditable
      )
        return;
      const down = e.type === "keydown";
      if (e.code === "Space") {
        if (!started || e.repeat) return;
        e.preventDefault();
        if (gather || mode === "convoy") act.current(down ? 0 : 2);
        else if (down && mode === "duel") act.current(5);
      }
      if (!down || e.repeat) return;
      if (
        mode === "logging" &&
        ["KeyA", "ArrowLeft", "KeyD", "ArrowRight"].includes(e.code)
      ) {
        e.preventDefault();
        act.current(6, ["KeyA", "ArrowLeft"].includes(e.code) ? 0 : 1);
      }
      if (mode === "mining" && /^Digit[1-6]$/.test(e.code))
        act.current(6, Number(e.code.slice(-1)) - 1);
      if (
        !gather &&
        [
          "ArrowLeft",
          "ArrowDown",
          "ArrowRight",
          "KeyA",
          "KeyS",
          "KeyD",
        ].includes(e.code)
      ) {
        e.preventDefault();
        act.current(
          4,
          {
            ArrowLeft: 0,
            ArrowDown: 1,
            ArrowRight: 2,
            KeyA: 0,
            KeyS: 1,
            KeyD: 2,
          }[e.code],
        );
      }
    }
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
    };
  }, [mode, started]);
  useEffect(
    () => () => {
      audio.current?.close();
    },
    [],
  );
  const s = view,
    lock = disabled || s.done || !started,
    remaining = Math.max(
      0,
      Math.ceil((challenge.arcade.duration - s.t) / 1000),
    ),
    power = s.charging ? Math.min(1, (s.t - s.chargeStarted) / 1000) : 0;
  const attack =
    mode === "duel"
      ? challenge.arcade.attacks.find(
          (a) => s.t >= a.at - 1100 && s.t <= a.at + 850,
        )
      : null;
  const nextCargo =
    mode === "convoy"
      ? challenge.arcade.rows.find(
          (row, i) =>
            !s.crossed.includes(i) && s.t >= row.at && s.t < row.at + 1800,
        )
      : null;
  const cue =
    mode === "logging"
      ? s.stamina < 0.25
        ? "Catch your breath"
        : `Notch on the ${challenge.arcade.notches[s.cutsMade] === 0 ? "left" : "right"}`
      : mode === "mining"
        ? s.stress > 0.75
          ? "Roof shifting — seat a support"
          : "Choose an iron pocket or a support"
        : mode === "duel"
          ? attack
            ? s.t < attack.at
              ? `Charge incoming · ${["LEFT", "MIDDLE", "RIGHT"][attack.safe]} is clear`
              : "Counter now"
            : "Read the next charge"
          : nextCargo
            ? `Cargo ${["LEFT", "MIDDLE", "RIGHT"][nextCargo.crate]} · stump ${["LEFT", "MIDDLE", "RIGHT"][nextCargo.obstacle]}`
            : "Read the trail · brace before sharp turns";
  const grade = core.grade(s),
    progress =
      mode === "logging"
        ? `${s.cutsMade}/6 splits`
        : mode === "mining"
          ? `${s.oreFound}/3 iron`
          : mode === "convoy"
            ? `${s.crates}/3 cargo`
            : `${s.dodges} dodges · ${s.counters} counters`;
  return (
    <section
      className={`field-stage field-${mode}`}
      aria-label={title}
      data-round-time={Math.round(s.t)}
    >
      <header className="field-heading">
        <div>
          <small>{kicker}</small>
          <h3>{title}</h3>
        </div>
        <span>{remaining}s</span>
        <button
          className="field-sound"
          aria-label={muted ? "Enable game sounds" : "Mute game sounds"}
          onClick={() => setMuted((v) => !v)}
        >
          {muted ? "♪ Off" : "♪ On"}
        </button>
      </header>
      <div className="field-scene" ref={host}>
        <ScenePeeper ref={avatar} />
        <div className="field-goal">
          <b>{progress}</b>
          <span>
            {gather
              ? mode === "logging"
                ? `${Math.round(s.stamina * 100)}% stamina`
                : `${Math.round(s.stress * 100)}% roof strain`
              : `${s.health}/3 condition`}
          </span>
        </div>
        {mode === "mining" && (
          <div
            className={`field-node-labels ${no3D ? "flat" : ""}`}
            ref={anchors}
          >
            {challenge.arcade.nodes.map((type, i) => (
              <button
                data-node={i}
                key={i}
                disabled={lock || !s.rockHP[i]}
                className={`${s.selectedNode === i ? "selected " : ""}${type}`}
                aria-label={`${nodeName[type]} ${i + 1}`}
                aria-pressed={s.selectedNode === i}
                onClick={() => action(6, i)}
              >
                <kbd>{i + 1}</kbd>
                {!s.rockHP[i]
                  ? type === "brace"
                    ? "Seated"
                    : "Clear"
                  : nodeName[type]}
              </button>
            ))}
          </div>
        )}
        {no3D && (
          <p className="field-render-fallback">
            Simple view · all game controls remain available below.
          </p>
        )}
        {!started && (
          <div className="field-ready">
            <span>FIELDWORK · 15 SECONDS</span>
            <h4>
              {mode === "logging"
                ? "A little patience. A clean split."
                : "Read the rock before you swing."}
            </h4>
            <p>{hint}</p>
            <button
              disabled={disabled}
              onClick={() => {
                run.current.start = performance.now() + 200;
                run.current.wake();
                setStarted(true);
              }}
            >
              Begin {mode === "logging" ? "woodcutting" : "mining"} →
            </button>
          </div>
        )}
        {started && s.done && (
          <div className="field-result" role="status">
            <small>
              {grade.passed ? "NICELY DONE" : "REGROUP & TRY AGAIN"}
            </small>
            <b>
              {grade.passed
                ? mode === "logging"
                  ? "Timber split"
                  : mode === "mining"
                    ? "Iron secured"
                    : mode === "convoy"
                      ? "Cargo recovered"
                      : "Opening taken"
                : mode === "mining" && s.stress >= 1
                  ? "The roof gave way"
                  : "Round missed"}
            </b>
            <span>
              {grade.passed
                ? `${grade.quality}% quality`
                : s.message || "Watch the timing and try again."}
            </span>
          </div>
        )}
      </div>
      <footer className="field-controls">
        <div
          className={`field-cue ${mode === "duel" && attack && s.t >= attack.at ? "opening" : ""}`}
          role="status"
        >
          {s.done ? s.message || "Recording complete" : cue}
        </div>
        {gather ? (
          <>
            {mode === "logging" && (
              <div className="field-sides">
                {["← Left notch", "Right notch →"].map((label, i) => (
                  <button
                    key={label}
                    disabled={lock || s.charging}
                    aria-pressed={s.toolSide === i}
                    onClick={() => action(6, i)}
                  >
                    {label}
                    <kbd>{i ? "D" : "A"}</kbd>
                  </button>
                ))}
              </div>
            )}
            <div
              className={`field-power ${mode}`}
              role="meter"
              aria-label="Swing power"
              aria-valuenow={Math.round(power * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i className="light-band" />
              <i className="gold-band" />
              <b style={{ left: `${power * 100}%` }} />
              <span>
                {mode === "logging"
                  ? "RELEASE IN BRASS"
                  : "LIGHT HIT · CHARGED HIT"}
              </span>
            </div>
            <button
              className={`field-hold ${s.charging ? "charging" : ""}`}
              disabled={lock}
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                action(0);
              }}
              onPointerUp={() => action(2)}
              onPointerCancel={() => action(7)}
              onLostPointerCapture={() => {
                if (run.current?.s.charging) action(7);
              }}
              onClick={(e) => {
                if (e.detail === 0) {
                  if (run.current?.s.charging) action(2);
                  else action(0);
                }
              }}
            >
              {s.charging
                ? "Release to strike"
                : "Hold to charge · release to strike"}
              <kbd>Space</kbd>
            </button>
            <div
              className="field-resource"
              aria-label={mode === "logging" ? "Stamina" : "Roof strain"}
            >
              <i
                style={{
                  width: `${(mode === "logging" ? s.stamina : s.stress) * 100}%`,
                  background:
                    mode === "mining" && s.stress > 0.75
                      ? "#e2956d"
                      : undefined,
                }}
              />
            </div>
          </>
        ) : (
          <div
            className={`field-lanes ${mode === "duel" ? "with-strike" : ""}`}
          >
            {["← Left", "Middle", "Right →"].map((l, i) => (
              <button
                key={l}
                disabled={lock}
                aria-pressed={Math.round((s.targetX - 0.22) / 0.28) === i}
                onClick={() => action(4, i)}
              >
                {l}
              </button>
            ))}
            {mode === "duel" && (
              <button
                className={attack && s.t >= attack.at ? "counter-ready" : ""}
                disabled={lock}
                onClick={() => action(5)}
              >
                Counter<kbd>Space</kbd>
              </button>
            )}
          </div>
        )}
        <p className="field-feedback">
          {disabled
            ? "Saving your result…"
            : s.message ||
              (mode === "mining"
                ? "Select a pocket above · 1–6 on keyboard"
                : gather
                  ? "Let the handle recover between swings."
                  : "Drag to steer.")}
        </p>
        {feedback && !feedback.passed && (
          <small className="field-previous">
            Earlier completed rounds are kept.
          </small>
        )}
        {failed && (
          <button
            className="field-retry"
            onClick={() => setRetry((n) => n + 1)}
          >
            Result could not be saved · Replay round
          </button>
        )}
        {mode === "convoy" && challenge.arcade.balance && (
          <div className="field-balance">
            <button
              disabled={lock}
              aria-pressed={s.bracing}
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                action(0);
              }}
              onPointerUp={() => action(2)}
              onPointerCancel={() => action(7)}
              onLostPointerCapture={() => {
                if (run.current?.s.bracing) action(7);
              }}
              onClick={(e) => {
                if (e.detail === 0) action(s.bracing ? 2 : 0);
              }}
            >
              Hold to brace cargo <kbd>Space</kbd>
            </button>
            <div
              role="meter"
              aria-label="Cargo lean"
              aria-valuenow={Math.round(Math.abs(s.balance) * 100)}
              aria-valuemin={0}
              aria-valuemax={150}
            >
              <i style={{ left: `${50 + s.balance * 30}%` }} />
            </div>
            <small>
              {s.bracing
                ? "Braced · slower steering"
                : "Sharp turns can spill cargo"}
            </small>
          </div>
        )}
      </footer>
    </section>
  );
}
