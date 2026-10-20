import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import PeeperSprite from "../components/PeeperSprite";
import content from "../../../backend/frontier/content.json";
import { createWorldScene, worldPoint } from "./worldScene.mjs";
import { ribbon } from "./lowPolyWorld.mjs";
import "./World3D.css";

const position = (id) => {
  const l = content.locations.find((l) => l.id === id) || content.locations[0];
  return [l.x, l.y];
};
export function travelPosition(location, travel, now) {
  if (!travel?.path?.length) return position(location);
  const path = travel.path,
    ratio = Math.max(
      0,
      Math.min(
        1,
        (now - travel.started_at) /
          Math.max(0.001, travel.arrives_at - travel.started_at),
      ),
    );
  const lengths = path
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
  let d = ratio * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (d <= lengths[i]) {
      const t = lengths[i] ? d / lengths[i] : 1;
      return [
        path[i][0] + (path[i + 1][0] - path[i][0]) * t,
        path[i][1] + (path[i + 1][1] - path[i][1]) * t,
      ];
    }
    d -= lengths[i];
  }
  return path.at(-1);
}

export default function GameWorld({
  selected,
  onSelect,
  players = [],
  user,
  peeper,
  projects = [],
  location = "village",
  travel,
  serverTime,
  paused = false,
}) {
  const host = useRef(null),
    overlay = useRef(null),
    live = useRef(null),
    controls = useRef(null),
    drag = useRef(null);
  const [failed, setFailed] = useState(false);
  const bridge = Boolean(projects.find((p) => p.id === "bridge")?.completed_at);
  const accessible = content.locations.filter(
    (l) =>
      !l.requires || projects.find((p) => p.id === l.requires)?.completed_at,
  );
  live.current = {
    paused,
    selected,
    location,
    travel,
    serverTime,
    players,
    user,
    onSelect,
  };
  useEffect(() => {
    const mount = host.current;
    let renderer,
      world,
      frame,
      observer,
      dead = false,
      route,
      routeKey;
    setFailed(false);
    try {
      // Development-only fixture for devices without a WebGL context.
      if (
        import.meta.env.DEV &&
        new URLSearchParams(window.location.search).has("no3d")
      )
        throw new Error("Local fallback check");
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.domElement.setAttribute("aria-hidden", "true");
      mount.prepend(renderer.domElement);
      world = createWorldScene(bridge);
      const camera = new THREE.OrthographicCamera(-18, 18, 18, -18, 0.1, 160),
        focus = new THREE.Vector3(),
        target = new THREE.Vector3();
      const start = worldPoint(position(live.current.selected));
      focus.set(start[0], 0, start[1]);
      const state = {
        zoom: 1,
        follow: true,
        dx: 0,
        dz: 0,
        width: 1,
        height: 1,
        camera,
        dirty: true,
      };
      controls.current = state;
      const raycaster = new THREE.Raycaster(),
        pointer = new THREE.Vector2();
      const pickGeometry = new THREE.BoxGeometry(4, 3.5, 4),
        pickMaterial = new THREE.MeshBasicMaterial();
      const pickTargets = content.locations
        .filter((l) => !l.requires || bridge)
        .map((l) => {
          const m = new THREE.Mesh(pickGeometry, pickMaterial),
            [x, z] = worldPoint([l.x, l.y]);
          m.position.set(x, 1.5, z);
          m.userData.location = l.id;
          m.updateMatrixWorld();
          return m;
        });
      state.pick = (x, y) => {
        const bounds = mount.getBoundingClientRect();
        pointer.set(
          ((x - bounds.left) / bounds.width) * 2 - 1,
          (-(y - bounds.top) / bounds.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(pickTargets, false)[0];
        if (hit) live.current.onSelect(hit.object.userData.location);
      };
      const vector = new THREE.Vector3(),
        reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      const mark = new THREE.Mesh(
        new THREE.RingGeometry(1.35, 1.44, 40),
        new THREE.MeshBasicMaterial({
          color: "#f8d890",
          side: THREE.DoubleSide,
        }),
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.y = 0.13;
      world.scene.add(mark);
      let clock = {
          sample: serverTime,
          server: serverTime,
          local: performance.now(),
        },
        previous = performance.now(),
        lastRender = 0,
        lastPlayers = null,
        lastSelected = null;
      const cameraOffset = new THREE.Vector3(8, 30, 24);
      let layout = { cx: 0, cy: 0 },
        projectionKey = "";
      function resize() {
        if (dead) return;
        const width = mount.clientWidth,
          height = mount.clientHeight;
        if (state.width !== width || state.height !== height) {
          state.width = width;
          state.height = height;
          renderer.setSize(width, height);
        }
        const root = mount.parentElement,
          bounds = mount.getBoundingClientRect(),
          dock = root.querySelector(".world-dock")?.getBoundingClientRect(),
          stocks = root
            .querySelector(".commons-stock")
            ?.getBoundingClientRect(),
          mobile = width < 700;
        const top = mobile
            ? (stocks?.bottom ?? bounds.top + 118) - bounds.top + 32
            : 125,
          bottom = mobile
            ? (dock?.top ?? bounds.bottom - 230) - bounds.top
            : height - 80;
        layout = {
          cx: mobile ? width * 0.48 : (width + Math.min(360, width * 0.3)) / 2,
          cy: (top + Math.max(top + 80, bottom)) / 2,
        };
        const lens = mount.querySelector(".world-lens");
        if (lens) lens.style.top = mobile ? `${bottom - 52}px` : "";
        state.dirty = true;
      }
      observer = new ResizeObserver(resize);
      observer.observe(mount);
      mount.parentElement
        .querySelectorAll(".world-dock,.commons-stock")
        .forEach((el) => observer.observe(el, { box: "border-box" }));
      resize();
      function project(node, p, height, scale = 1) {
        const [x, z] = worldPoint(p);
        vector.set(x, height, z).project(camera);
        node.style.transform = `translate3d(${((vector.x + 1) * state.width) / 2}px,${((1 - vector.y) * state.height) / 2}px,0) scale(${scale})`;
        node.style.visibility = vector.z > 1 || vector.z < -1 ? "hidden" : "";
      }
      function draw(now) {
        if (dead) return;
        frame = requestAnimationFrame(draw);
        if (document.hidden || live.current.paused) return;
        const p = live.current,
          dt = Math.min(0.08, (now - previous) / 1000);
        previous = now;
        if (clock.sample !== p.serverTime) {
          clock = {
            sample: p.serverTime,
            server: Math.max(
              clock.server + (now - clock.local) / 1000,
              p.serverTime,
            ),
            local: now,
          };
        }
        const time = clock.server + (now - clock.local) / 1000,
          point = travelPosition(p.location, p.travel, time);
        const current = worldPoint(
          p.travel
            ? point
            : state.playerFocus
              ? position(p.location)
              : position(p.selected),
        );
        if (state.follow) target.set(current[0], 0, current[1]);
        else target.set(state.dx, 0, state.dz);
        const moving =
          focus.distanceToSquared(target) > 0.00001 ||
          p.travel ||
          p.players.some((player) => player.travel);
        if (
          !state.dirty &&
          !moving &&
          lastSelected === p.selected &&
          lastPlayers === p.players
        )
          return;
        const renderStart = performance.now();
        if (now - lastRender < 100)
          mount.dataset.renderIntervalMs = (now - lastRender).toFixed(1);
        lastSelected = p.selected;
        lastPlayers = p.players;
        state.dirty = false;
        lastRender = now;
        focus.lerp(target, reduced.matches ? 1 : 1 - Math.exp(-dt * 5));
        const aspect = state.width / Math.max(1, state.height),
          view = (state.width < 700 ? 21 : 32) / state.zoom;
        const nextProjection = [
          state.width,
          state.height,
          state.zoom,
          layout.cx,
          layout.cy,
        ].join(":");
        if (projectionKey !== nextProjection) {
          projectionKey = nextProjection;
          camera.clearViewOffset();
          camera.left = (-view * aspect) / 2;
          camera.right = (view * aspect) / 2;
          camera.top = view / 2;
          camera.bottom = -view / 2;
          camera.updateProjectionMatrix();
          camera.setViewOffset(
            state.width,
            state.height,
            state.width / 2 - layout.cx,
            state.height / 2 - layout.cy,
            state.width,
            state.height,
          );
        }
        camera.position.copy(focus).add(cameraOffset);
        camera.lookAt(focus);
        camera.updateMatrixWorld();
        const [mx, mz] = worldPoint(position(p.selected));
        mark.position.set(mx, 0.13, mz);
        const key = JSON.stringify(p.travel?.path || null);
        if (key !== routeKey) {
          if (route) {
            world.scene.remove(route);
            route.geometry.dispose();
          }
          routeKey = key;
          route = p.travel
            ? ribbon(
                p.travel.path.map(worldPoint),
                0.13,
                "#ffe3a1",
                world.kit,
                0.24,
              )
            : null;
          if (route) world.scene.add(route);
        }
        overlay.current
          ?.querySelectorAll("[data-location]")
          .forEach((el) => project(el, position(el.dataset.location), 2.8));
        overlay.current?.querySelectorAll("[data-person]").forEach((el) => {
          const self = el.dataset.person === "self",
            other = self
              ? p
              : p.players.find(
                  (player) => String(player.id) === el.dataset.person,
                );
          if (!other) return;
          project(
            el,
            self ? point : travelPosition(other.location, other.travel, time),
            0.1,
            state.height / view / (667 / 21),
          );
          el.classList.toggle(
            "walking",
            Boolean(other.travel && time < other.travel.arrives_at),
          );
        });
        if (overlay.current) {
          const cloud = overlay.current.querySelector(".world-unknown");
          if (cloud) project(cloud, [0.85, 0.4], 0.5);
        }
        world.update(0, true);
        renderer.render(world.scene, camera);
        mount.dataset.drawCalls = String(renderer.info.render.calls);
        mount.dataset.triangles = String(renderer.info.render.triangles);
        mount.dataset.renderCpuMs = (performance.now() - renderStart).toFixed(
          2,
        );
        mount.dataset.renderFrames = String(
          Number(mount.dataset.renderFrames || 0) + 1,
        );
      }
      controls.current.pan = (dx, dy) => {
        state.dirty = true;
        if (state.follow) {
          state.dx = focus.x;
          state.dz = focus.z;
          state.follow = false;
        }
        const units = (state.width < 700 ? 21 : 32) / state.zoom / state.height;
        state.dx = Math.max(
          -22,
          Math.min(22, state.dx - dx * units * 0.967 - dy * units * 0.42),
        );
        state.dz = Math.max(
          -22,
          Math.min(22, state.dz + dx * units * 0.26 - dy * units * 1.2),
        );
      };
      const lost = (e) => {
        e.preventDefault();
        setFailed(true);
      };
      renderer.domElement.addEventListener("webglcontextlost", lost);
      frame = requestAnimationFrame(draw);
      return () => {
        dead = true;
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.current = null;
        renderer.domElement.removeEventListener("webglcontextlost", lost);
        world.dispose();
        pickGeometry.dispose();
        pickMaterial.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch (error) {
      console.warn("Reedbank 3D map unavailable", error);
      setFailed(true);
      controls.current = null;
      observer?.disconnect();
      world?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
    }
    return () => {
      dead = true;
      cancelAnimationFrame(frame);
    };
  }, [bridge]);
  useEffect(() => {
    if (!paused && controls.current) controls.current.dirty = true;
  }, [paused]);
  useEffect(() => {
    if (controls.current) {
      controls.current.follow = true;
      controls.current.playerFocus = false;
      controls.current.dirty = true;
    }
  }, [selected, travel?.started_at]);
  const zoom = (factor) => {
    if (controls.current) {
      controls.current.dirty = true;
      controls.current.zoom = Math.max(
        0.55,
        Math.min(2.1, controls.current.zoom * factor),
      );
    }
  };
  return (
    <div
      className={`game-world world-three ${failed ? "world-three-failed" : ""}`}
      ref={host}
      onWheel={(e) => {
        if (!e.target.closest("button")) zoom(e.deltaY < 0 ? 1.06 : 0.94);
      }}
      onPointerDown={(e) => {
        if (e.target.closest("button")) return;
        drag.current = { x: e.clientX, y: e.clientY, distance: 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        controls.current?.pan(
          e.clientX - drag.current.x,
          e.clientY - drag.current.y,
        );
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          distance:
            drag.current.distance +
            Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y),
        };
      }}
      onPointerUp={(e) => {
        if (drag.current && drag.current.distance < 6)
          controls.current?.pick(e.clientX, e.clientY);
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <div className="world-three-overlay" ref={overlay}>
        {accessible.map((l) => (
          <div className="world-pin-anchor" data-location={l.id} key={l.id}>
            <button
              className={`world-three-pin ${selected === l.id ? "selected" : ""}`}
              onClick={() => onSelect(l.id)}
              aria-label={l.name}
              aria-pressed={selected === l.id}
            >
              <span>{l.name}</span>
              {selected === l.id && (
                <small>
                  {l.id === "bridge" && !bridge
                    ? "CROSSING CLOSED"
                    : "SELECTED"}
                </small>
              )}
            </button>
          </div>
        ))}
        {!bridge && (
          <div className="world-unknown">
            THE UNCHARTED MARSH<span>Restore the crossing to explore</span>
          </div>
        )}
        {players
          .filter((p) => p.id !== user.id)
          .slice(0, 20)
          .map((p) => (
            <div className="world-person other" data-person={p.id} key={p.id}>
              <PeeperSprite peeper={p} size={65} showDead={false} />
              <span>{p.name}</span>
            </div>
          ))}
        <div className="world-person" data-person="self">
          <PeeperSprite peeper={peeper} size={84} showDead={false} />
          <span>{user.first_name}</span>
        </div>
      </div>
      {failed && (
        <div className="world-three-fallback">
          <b>Trail map</b>
          <p>
            3D is unavailable on this device. Choose a destination to keep
            exploring.
          </p>
          {accessible.map((l) => (
            <button key={l.id} onClick={() => onSelect(l.id)}>
              {l.name}
              {selected === l.id ? " · selected" : ""}
            </button>
          ))}
        </div>
      )}
      <div className="world-lens">
        <button onClick={() => zoom(1.2)} aria-label="Zoom in">
          ＋
        </button>
        <button onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">
          −
        </button>
        <button
          onClick={() => {
            if (controls.current) {
              controls.current.follow = true;
              controls.current.playerFocus = true;
            }
          }}
          aria-label="Find my Peeper"
        >
          ⌖
        </button>
      </div>
    </div>
  );
}
