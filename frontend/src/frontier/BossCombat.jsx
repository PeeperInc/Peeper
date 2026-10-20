import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import * as api from "../api";
import { modelKit } from "./lowPolyWorld.mjs";
import { createBossArena } from "./bossArena.mjs";
import { createBattleVfx } from "./bossBattleVfx.mjs";
import fallbackDragon from "../assets/frontier/marsh-dragon.png";
import "./BossCombat.css";
import ScenePeeper from "./ScenePeeper";
import useBossBattle from "./useBossBattle";
export default function BossCombat({
  onExit,
  onVictory,
  load = api.frontierBossCombat,
  hit = api.frontierBossHit,
}) {
  const battle = useBossBattle(load, hit),
    { data, frame: pose, error, notice, impact, act } = battle;
  const [flat, setFlat] = useState(false),
    [slash, setSlash] = useState(null);
  const host = useRef(null),
    avatar = useRef(null),
    live = useRef(null),
    weakPoint = useRef(null),
    dangerMark = useRef(null),
    finger = useRef(null);
  const paidCycle = useRef(null);
  useEffect(() => {
    if (
      data?.boss.phase === "defeated" &&
      paidCycle.current !== data.boss.cycle
    ) {
      paidCycle.current = data.boss.cycle;
      onVictory?.(data.boss);
    }
  }, [data?.boss.phase, data?.boss.cycle, onVictory]);
  live.current = { data, pose, impact, visual: battle.visual.current };
  function strike() {
    const before = battle.visual.current.swingAt;
    act("strike");
    if (battle.visual.current.swingAt !== before)
      setSlash({
        at: performance.now(),
        kind: battle.visual.current.swingKind,
      });
  }
  useEffect(() => {
    let renderer,
      frame,
      observer,
      kit,
      disposed = false;
    const mount = host.current;
    let lost3D = false;
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
      mount.prepend(renderer.domElement);
      const contextLost = (e) => {
        e.preventDefault();
        lost3D = true;
        setFlat(true);
      };
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#17434e");
      scene.fog = new THREE.Fog("#17434e", 17, 36);
      scene.add(new THREE.HemisphereLight("#dbe9dc", "#193d38", 2.1));
      const sun = new THREE.DirectionalLight("#ffe0ac", 2.8);
      sun.position.set(-5, 9, 7);
      scene.add(sun);
      const rim = new THREE.DirectionalLight("#a6d4d2", 2.3);
      rim.position.set(5, 6, -7);
      scene.add(rim);
      kit = modelKit();
      const dragon = kit.dragon(scene, [0, 0, -0.5]);
      dragon.rotation.y = 0.85;
      dragon.scale.setScalar(1.25);
      const lanes = [
        new THREE.Vector3(-1.9, 0, 3.6),
        new THREE.Vector3(2.2, 0, 3.5),
      ];
      const arena = createBossArena(scene, kit, lanes),
        effects = createBattleVfx(scene);
      const heroPoint = lanes[0].clone(),
        projected = new THREE.Vector3(),
        heroDisplay = new THREE.Vector3();
      const warning = new THREE.Mesh(
        new THREE.RingGeometry(1.1, 1.25, 40),
        new THREE.MeshBasicMaterial({
          color: "#f6cf81",
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0,
        }),
      );
      warning.rotation.x = -Math.PI / 2;
      warning.position.set(heroPoint.x, 0.04, heroPoint.z);
      scene.add(warning);
      const dangerFill = new THREE.Mesh(
        new THREE.CircleGeometry(1, 32),
        new THREE.MeshBasicMaterial({
          color: "#ef794e",
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      dangerFill.rotation.x = -Math.PI / 2;
      dangerFill.position.y = 0.06;
      scene.add(dangerFill);
      const headPoint = new THREE.Vector3(),
        cameraRight = new THREE.Vector3();
      const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 70);
      const direction = new THREE.Vector3(-3, 4.7, 10).normalize();
      const points = [...arena.framingPoints];
      // Include both the spread wings and the forward lunge in the frame.
      for (const pose of [{ windup: 1 }, { attack: 1 }]) {
        dragon.position.z = pose.attack ? 0.4 : -0.5;
        dragon.userData.animate(0, { reduced: true, ...pose });
        dragon.updateMatrixWorld(true);
        dragon.traverse((o) => {
          if (!o.isMesh || o.material.transparent) return;
          const vertices = o.geometry.attributes.position;
          for (let i = 0; i < vertices.count; i++)
            points.push(
              new THREE.Vector3()
                .fromBufferAttribute(vertices, i)
                .applyMatrix4(o.matrixWorld),
            );
        });
      }
      const bounds = new THREE.Box3().setFromPoints(points);
      const center = bounds.getCenter(new THREE.Vector3());
      dragon.position.z = -0.5;
      dragon.userData.animate(0, { reduced: true });
      const reduced = matchMedia("(prefers-reduced-motion: reduce)");
      function resize() {
        if (disposed) return;
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
        camera.position.copy(center).add(direction);
        camera.lookAt(center);
        const inverse = camera.quaternion.clone().invert(),
          tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
          // Keep the court clear of the attack banner and bottom gesture hint.
          insetX = Math.min(0.18, 16 / Math.max(1, mount.clientWidth)),
          insetY = Math.min(0.24, 54 / Math.max(1, mount.clientHeight)),
          horizontal = tan * camera.aspect * (1 - insetX * 2),
          vertical = tan * (1 - insetY * 2);
        const target = center.clone(),
          viewUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
            camera.quaternion,
          ),
          corner = new THREE.Vector3();
        cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        let pullback = 0,
          frameBounds;
        // Center the projected court too: its foreground pads otherwise leave
        // a large empty area above the dragon on tall screens.
        for (let pass = 0; pass < 3; pass++) {
          let distance = 0;
          for (const point of points) {
            corner.copy(point).sub(target).applyQuaternion(inverse);
            distance = Math.max(
              distance,
              corner.z + Math.abs(corner.x) / horizontal,
              corner.z + Math.abs(corner.y) / vertical,
            );
          }
          pullback = distance * 1.08;
          camera.position.copy(target).addScaledVector(direction, pullback);
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld(true);
          frameBounds = {
            left: Infinity,
            right: -Infinity,
            top: -Infinity,
            bottom: Infinity,
          };
          for (const point of points) {
            corner.copy(point).project(camera);
            frameBounds.left = Math.min(frameBounds.left, corner.x);
            frameBounds.right = Math.max(frameBounds.right, corner.x);
            frameBounds.top = Math.max(frameBounds.top, corner.y);
            frameBounds.bottom = Math.min(frameBounds.bottom, corner.y);
          }
          if (pass < 2)
            target
              .addScaledVector(
                cameraRight,
                (frameBounds.left + frameBounds.right) *
                  0.5 *
                  pullback *
                  tan *
                  camera.aspect,
              )
              .addScaledVector(
                viewUp,
                (frameBounds.top + frameBounds.bottom) * 0.5 * pullback * tan,
              );
        }
        // Keep the playable court clear as the camera moves farther away.
        scene.fog.near = pullback + 5;
        scene.fog.far = pullback + 25;
        if (import.meta.env.DEV) {
          mount.dataset.frameBounds = JSON.stringify(frameBounds);
        }
      }
      observer = new ResizeObserver(resize);
      observer.observe(mount);
      resize();
      let previous = performance.now();
      function draw(now) {
        if (disposed) return;
        frame = requestAnimationFrame(draw);
        if (document.hidden || lost3D) return;
        const v = live.current,
          f = v.pose?.fighter,
          a = v.pose?.attack,
          fx = v.visual;
        const dt = Math.min(0.08, (now - previous) / 1000);
        previous = now;
        const remaining = a?.remaining ?? 4,
          stunned = f?.stagger_until > v.pose?.time,
          windup = !!a?.telegraph,
          charge = windup
            ? Math.max(0, Math.min(1, 1 - remaining / a.windup))
            : 0,
          striking =
            remaining <= 0.04 &&
            remaining >= -0.4 &&
            v.data?.boss.phase === "open";
        const target = lanes[a?.target ?? 0];
        heroPoint.lerp(
          lanes[f?.lane ?? 0],
          reduced.matches ? 1 : 1 - Math.exp(-dt * 19),
        );
        warning.position.set(target.x, 0.07, target.z);
        warning.visible = dangerFill.visible = windup;
        warning.material.opacity = windup ? 0.3 + charge * 0.65 : 0;
        warning.material.color.set(
          a?.kind === "breath" ? "#ffd16f" : "#f7835e",
        );
        warning.scale.setScalar(0.7 + charge * 0.35);
        dangerFill.position.set(target.x, 0.065, target.z);
        dangerFill.material.opacity = windup ? 0.08 + charge * 0.2 : 0;
        dangerFill.scale.setScalar(1.05);
        dragon.position.z =
          -0.5 +
          (striking && a?.kind !== "breath"
            ? Math.sin(Math.max(0, (0.04 - remaining) / 0.44) * Math.PI) * 0.9
            : 0);
        const age = (now - fx.swingAt) / 1000,
          swingDuration = fx.swingKind === "counter" ? 0.5 : 0.34,
          swingPower =
            age >= 0 && age < swingDuration
              ? Math.sin((age / swingDuration) * Math.PI)
              : 0,
          hurtAge = (now - fx.hurtAt) / 1000,
          knockback =
            hurtAge >= 0 && hurtAge < 0.55
              ? Math.sin((hurtAge / 0.55) * Math.PI)
              : 0,
          rollAge = (now - fx.rollAt) / 1000,
          jump =
            rollAge >= 0 && rollAge < 0.32
              ? Math.sin((rollAge / 0.32) * Math.PI)
              : 0;
        dragon.rotation.z =
          age < 0.22 ? Math.sin((age / 0.22) * Math.PI) * 0.06 : 0;
        dragon.userData.animate?.(now / 1000, {
          reduced: reduced.matches,
          windup: charge,
          impact: age < 0.22 ? Math.sin((age / 0.22) * Math.PI) : 0,
          attack: striking ? 1 : 0,
          kind: a?.kind,
        });
        dragon.updateMatrixWorld(true);
        dragon.userData.head.getWorldPosition(headPoint);
        arena.animate(now / 1000, reduced.matches);
        effects.animate(
          now,
          v.pose?.time ?? 0,
          a,
          lanes,
          headPoint,
          fx,
          reduced.matches,
        );
        renderer.render(scene, camera);
        if (import.meta.env.DEV) {
          mount.dataset.drawCalls = renderer.info.render.calls;
          mount.dataset.triangles = renderer.info.render.triangles;
        }
        if (avatar.current) {
          avatar.current.style.setProperty(
            "--roll-direction",
            fx.rollDirection * (f?.lane === 1 ? -1 : 1),
          );
          heroDisplay.copy(heroPoint);
          if (!reduced.matches) {
            heroDisplay.z +=
              knockback * 0.6 - (!stunned ? swingPower * 0.48 : 0);
            heroDisplay.y = jump * 0.55 + (!stunned ? swingPower * 0.28 : 0);
          }
          projected.copy(heroDisplay).project(camera);
          const screenX = projected.x;
          projected
            .copy(heroDisplay)
            .addScaledVector(cameraRight, 1.8)
            .project(camera);
          const avatarSize = Math.max(
            32,
            Math.min(
              78,
              (Math.abs(projected.x - screenX) * mount.clientWidth) / 2,
            ),
          );
          avatar.current.style.width =
            avatar.current.style.height = `${avatarSize}px`;
          projected.copy(heroDisplay).project(camera);
          avatar.current.style.setProperty(
            "--attack-lean",
            `${reduced.matches ? 0 : swingPower * 18}deg`,
          );
          avatar.current.style.setProperty(
            "--attack-squash",
            1 - swingPower * 0.12,
          );
          avatar.current.style.setProperty(
            "--hurt-tilt",
            `${reduced.matches ? 0 : knockback * -22}deg`,
          );
          const inset = avatar.current.offsetWidth / 2 + 8;
          avatar.current.style.left = `${Math.max(inset, Math.min(mount.clientWidth - inset, ((projected.x + 1) * mount.clientWidth) / 2))}px`;
          avatar.current.style.top = `${(1 - projected.y) * 50}%`;
        }
        if (weakPoint.current) {
          projected.copy(headPoint).project(camera);
          weakPoint.current.style.left = `${(projected.x + 1) * 50}%`;
          weakPoint.current.style.top = `${(1 - projected.y) * 50}%`;
        }
        if (dangerMark.current) {
          projected.copy(target).project(camera);
          dangerMark.current.style.left = `${(projected.x + 1) * 50}%`;
          dangerMark.current.style.top = `${(1 - projected.y) * 50}%`;
        }
      }
      frame = requestAnimationFrame(draw);
      return () => {
        disposed = true;
        cancelAnimationFrame(frame);
        observer.disconnect();
        kit.dispose(scene);
        renderer.domElement.removeEventListener(
          "webglcontextlost",
          contextLost,
        );
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch {
      setFlat(true);
      observer?.disconnect();
      renderer?.dispose();
      renderer?.domElement.remove();
    }
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, []);
  const b = data?.boss,
    f = pose?.fighter,
    victory = b?.phase === "defeated",
    a = pose?.attack,
    warn = a?.telegraph && !victory,
    stunned = !victory && f?.stagger_until > pose?.time,
    stunLeft = stunned ? Math.max(0, f.stagger_until - pose.time) : 0,
    counter = f?.counter_until > pose?.time,
    rolling = f?.dodge_until > pose?.time,
    hurt = performance.now() - battle.visual.current.hurtAt < 550,
    cue = stunned
      ? `Stunned · ${Math.ceil(stunLeft)}s`
      : counter
        ? "Weak spot open · tap to counter"
        : warn
          ? `${a.kind === "breath" ? "Fire breath" : a.followup ? "Second lunge" : a.kind === "double" ? "Double lunge" : "Claw strike"} · ${f.lane !== a.target ? "clear!" : `swipe ${a.target === 0 ? "right →" : "← left"}`}`
          : notice?.text || "Tap to combo · swipe to dodge";
  return (
    <section
      className="boss-combat action-battle"
      data-combat-version={f?.combat_version}
      data-lane={f?.lane ?? 0}
      data-stunned={stunned ? "true" : "false"}
      data-counter={counter ? "open" : "closed"}
      aria-label="Shared battle with Mirewake"
    >
      <header>
        <div>
          <small>WORLD BOSS · SHARED HEALTH</small>
          <h3>{b?.name || "Mirewake"}</h3>
        </div>
        <b>{b?.hp.toLocaleString() ?? "…"} HP</b>
        <div
          className="boss-shared-health"
          role="progressbar"
          aria-label="Shared dragon health"
          aria-valuenow={b?.hp || 0}
          aria-valuemin={0}
          aria-valuemax={b?.max_hp || 1}
        >
          <i style={{ width: `${b ? (b.hp / b.max_hp) * 100 : 100}%` }} />
        </div>
      </header>
      <div
        className={`boss-combat-scene ${warn ? "danger" : ""} ${flat ? "flat" : ""} ${hurt ? "hurt" : ""} ${stunned ? "stunned" : ""}`}
        ref={host}
        style={{
          "--lane-x": f?.lane === 1 ? "72%" : "28%",
          "--danger-x": a?.target === 1 ? "72%" : "28%",
        }}
      >
        <ScenePeeper
          ref={avatar}
          className={`${rolling ? "dodging" : ""} ${hurt ? "hurt" : ""} ${stunned ? "stunned" : ""} ${slash && performance.now() - slash.at < 350 ? `attacking ${slash.kind}` : ""}`}
        >
          {stunned && (
            <div className="boss-stun-stars" aria-hidden="true">
              <i>✦</i>
              <i>✧</i>
              <i>✦</i>
            </div>
          )}
          {slash && performance.now() - slash.at < 350 && !stunned && (
            <svg
              key={slash.at}
              className={`peeper-strike-arc ${slash.kind}`}
              viewBox="0 0 100 100"
              aria-hidden="true"
            >
              <path d="M12 80Q20 4 91 18Q52 18 12 80Z" />
              <path d="M20 91Q42 30 95 37" />
            </svg>
          )}
        </ScenePeeper>
        {flat && (
          <img className="boss-fallback-art" src={fallbackDragon} alt="" />
        )}
        <button
          className="boss-hit-target"
          aria-label="Strike Mirewake"
          aria-describedby="boss-gesture-help"
          disabled={!f || victory || stunned}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            finger.current = {
              id: e.pointerId,
              x: e.clientX,
              y: e.clientY,
              swiped: false,
            };
          }}
          onPointerMove={(e) => {
            const p = finger.current;
            if (!p || p.id !== e.pointerId || p.swiped) return;
            const dx = e.clientX - p.x,
              dy = e.clientY - p.y;
            if (Math.abs(dx) >= 24 && Math.abs(dx) > Math.abs(dy) * 1.1) {
              p.swiped = true;
              act("dodge", dx < 0 ? "left" : "right");
            }
          }}
          onPointerUp={(e) => {
            const p = finger.current;
            finger.current = null;
            if (
              p &&
              p.id === e.pointerId &&
              !p.swiped &&
              Math.hypot(e.clientX - p.x, e.clientY - p.y) < 18
            )
              strike();
          }}
          onPointerCancel={() => {
            finger.current = null;
          }}
          onClick={(e) => {
            if (e.detail === 0) strike();
          }}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight"].includes(e.code)) {
              e.preventDefault();
              act("dodge", e.code === "ArrowLeft" ? "left" : "right");
            }
          }}
        >
          <span>
            {stunned
              ? "Recovering · attacks and dodges paused"
              : "Tap to strike · swipe ← → to dodge"}
          </span>
        </button>
        <div
          ref={dangerMark}
          className={`boss-danger-mark ${warn ? "visible" : ""} ${a?.kind || ""}`}
          aria-hidden="true"
        >
          <span>{a?.target === 0 ? "→" : "←"}</span>
        </div>
        <div ref={weakPoint} className="boss-weak-anchor" aria-hidden="true">
          {counter && (
            <div className="boss-weak-spot">
              <span>TAP!</span>
            </div>
          )}
          {slash && performance.now() - slash.at < 300 && (
            <svg
              key={slash.at}
              className={`boss-slash ${slash.kind}`}
              viewBox="0 0 160 160"
            >
              <path d="M22 133Q66 25 142 24M35 145Q78 50 148 38" />
            </svg>
          )}
        </div>
        <div
          className={`boss-attack-banner ${warn ? "warning" : ""} ${counter ? "counter" : ""} ${stunned ? "stunned" : ""}`}
          role="status"
        >
          {victory ? "Victory!" : cue}
          {stunned && (
            <i
              className="boss-stun-progress"
              style={{ transform: `scaleX(${stunLeft / 10})` }}
            />
          )}
        </div>
        {impact && performance.now() - impact.at < 850 && (
          <div
            key={impact.at}
            className={`boss-impact ${impact.counter ? "counter" : impact.finisher ? "finisher" : ""}`}
            aria-live="polite"
          >
            {impact.counter ? "COUNTER " : impact.finisher ? "FINISH " : ""}−
            {impact.amount}
          </div>
        )}
        {victory && (
          <div className="boss-combat-card">
            <h4>Mirewake has fallen</h4>
            <p>Your reward: {b.payout ?? 0} coins</p>
            <p>{b.actions ?? 0} journey actions · results available for 24 hours</p>
            <button onClick={onExit}>Return to the expedition</button>
          </div>
        )}
        {!data && (
          <div className="boss-combat-card">
            <p>{error || "Joining the battle…"}</p>
          </div>
        )}
      </div>
      <footer>
        <div className="boss-action-hud">
          <div
            className="boss-combo"
            aria-label={`Combo ${f?.combo || 0} of 3`}
          >
            {[1, 2, 3].map((n) => (
              <i key={n} className={n <= (f?.combo || 0) ? "filled" : ""}>
                {n === 3 ? "✦" : n}
              </i>
            ))}
            <span>COMBO</span>
          </div>
          <span className={a?.enraged ? "boss-enraged" : ""}>
            {stunned
              ? `Recovering · ${Math.ceil(stunLeft)}s`
              : a?.enraged
                ? "Dragon enraged"
                : "Tap · tap · finish"}
          </span>
        </div>
        <div className="boss-journey-score">
          <span>
            {victory ? (
              <>
                Reward paid: <b>{b.payout ?? 0} coins</b>
              </>
            ) : (
              "Your damage"
            )}
          </span>
          <span>{b?.contribution?.toLocaleString() ?? 0} damage</span>
        </div>
        <p id="boss-gesture-help" className="boss-gesture-help">
          Tap the arena to attack. Swipe sideways to dodge.
          <span>Keyboard: Space to strike · ← → to dodge</span>
        </p>
        {error && data && (
          <p className="boss-combat-error" role="alert">
            {error} <button onClick={battle.retry}>Retry</button>
          </p>
        )}
      </footer>
    </section>
  );
}
