import React, { useEffect, useRef } from "react";
import { Application, Assets, Container, Sprite, Texture } from "pixi.js";
import PeeperSprite from "../components/PeeperSprite";
import WorldIcon from "./WorldIcon";
import Boardwalk from "./Boardwalk";
import { frameCamera } from "./camera.mjs";
import content from "../../../backend/frontier/content.json";
import original from "../assets/frontier/marsh-world.webp";
import armory from "../assets/frontier/armory.png";
import dragon from "../assets/frontier/marsh-dragon.png";
import restored from "../assets/frontier/marsh-restored.webp";
const SIZE = 1254;
function position(id) {
  const p = content.locations.find((l) => l.id === id) || content.locations[0];
  return [p.x, p.y];
}
export function travelPosition(location, travel, now) {
  if (!travel) return position(location);
  const path = travel.path,
    ratio = Math.max(
      0,
      Math.min(
        1,
        (now - travel.started_at) / (travel.arrives_at - travel.started_at),
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
  players,
  user,
  peeper,
  projects,
  equipped,
  location = "village",
  travel,
  serverTime,
}) {
  const host = useRef(null),
    overlay = useRef(null),
    avatar = useRef(null),
    world = useRef(null),
    props = useRef(null),
    drag = useRef(null),
    clock = useRef({ server: serverTime, local: performance.now() }),
    camera = useRef({ x: 0, y: 0, scale: 0.8, follow: true });
  // Updating the HUD every 250ms must not reset the animation's clock.
  if (clock.current.sample !== serverTime) {
    const t = performance.now();
    const predicted = clock.current.server + (t - clock.current.local) / 1000;
    clock.current = {
      sample: serverTime,
      server: Math.max(predicted, serverTime),
      local: t,
    };
  }
  props.current = { location, travel, players, user };
  const bridge = Boolean(projects.find((p) => p.id === "bridge")?.completed_at),
    art = bridge ? restored : original;
  const accessible = (l) =>
    !l.requires || projects.find((p) => p.id === l.requires)?.completed_at;
  function apply() {
    const v = camera.current;
    if (world.current) {
      world.current.position.set(v.x, v.y);
      world.current.scale.set(v.scale);
    }
    if (overlay.current) {
      overlay.current.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.scale})`;
      overlay.current.style.setProperty("--pin-scale", 1 / v.scale);
    }
  }
  function zoom(factor) {
    const el = host.current,
      v = camera.current,
      w = el.clientWidth,
      h = el.clientHeight,
      scale = Math.max(0.35, Math.min(1.7, v.scale * factor)),
      r = scale / v.scale;
    v.x = w / 2 - (w / 2 - v.x) * r;
    v.y = h * 0.43 - (h * 0.43 - v.y) * r;
    v.scale = scale;
    v.follow = false;
    apply();
  }
  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    let disposed = false,
      initialized = false,
      destroyed = false,
      app,
      observer,
      fogTexture,
      frame;
    function destroyApp() {
      if (initialized && !destroyed) {
        destroyed = true;
        app.destroy(true, { children: true });
      }
    }
    mount.classList.remove("map-failed");
    (async () => {
      try {
        app = new Application();
        await app.init({
          resizeTo: mount,
          background: 0x243b32,
          antialias: true,
          resolution: Math.min(devicePixelRatio || 1, 1.5),
          autoDensity: true,
          preference: "webgl",
        });
        initialized = true;
        if (disposed) {
          destroyApp();
          return;
        }
        mount.prepend(app.canvas);
        app.canvas.setAttribute("aria-hidden", "true");
        const layer = new Container();
        world.current = layer;
        app.stage.addChild(layer);
        const texture = await Assets.load(art);
        if (disposed) return;
        const sprite = new Sprite(texture);
        sprite.width = SIZE;
        sprite.height = SIZE;
        layer.addChild(sprite);
        app.ticker.maxFPS = 60;
        if (!bridge) {
          const points = bridge
            ? [
                [0.71, 0.56],
                [1, 0.5],
                [1, 1],
                [0.5, 1],
                [0.6, 0.78],
              ]
            : [
                [0.8, 0],
                [1, 0],
                [1, 1],
                [0.48, 1],
                [0.58, 0.68],
                [0.72, 0.46],
                [0.72, 0.28],
                [0.78, 0.15],
              ];
          const surface = document.createElement("canvas");
          surface.width = SIZE;
          surface.height = SIZE;
          const ink = surface.getContext("2d");
          ink.shadowColor = "#233c35";
          ink.shadowBlur = 50;
          ink.fillStyle = "#233c35";
          ink.beginPath();
          points.forEach(([x, y], i) =>
            i ? ink.lineTo(x * SIZE, y * SIZE) : ink.moveTo(x * SIZE, y * SIZE),
          );
          ink.closePath();
          ink.fill();
          ink.shadowBlur = 0;
          ink.globalCompositeOperation = "source-atop";
          for (let i = 0; i < 18; i++) {
            const x = (0.67 + ((i * 137) % 310) / 1000) * SIZE,
              y = (i * 193) % 1254,
              glow = ink.createRadialGradient(x, y, 5, x, y, 200);
            glow.addColorStop(0, "#91ab8e20");
            glow.addColorStop(1, "#91ab8e00");
            ink.fillStyle = glow;
            ink.fillRect(x - 200, y - 200, 400, 400);
          }
          fogTexture = Texture.from(surface);
          const fog = new Sprite(fogTexture);
          layer.addChild(fog);
        }
      } catch {
        if (!disposed) {
          mount.classList.add("map-failed");
          world.current = null;
        }
      }
    })();
    function resize() {
      // DOM refs can clear before React runs passive effect cleanup.
      if (disposed || host.current !== mount || !mount.isConnected) return;
      const el = mount,
        root = el.parentElement,
        bounds = el.getBoundingClientRect();
      const objective = root
        .querySelector(".world-objective")
        ?.getBoundingClientRect();
      const panel = root
        .querySelector(".hud-location")
        ?.getBoundingClientRect();
      const mobile = el.clientWidth <= 700;
      camera.current.area = {
        left: mobile
          ? 12
          : Math.min(
              (panel?.right || bounds.left + 350) - bounds.left + 24,
              el.clientWidth * 0.45,
            ),
        right: el.clientWidth - (mobile ? 60 : 80),
        top: mobile
          ? (objective?.bottom || bounds.top + 220) - bounds.top + 12
          : 120,
        bottom: mobile
          ? (panel?.top || bounds.bottom - 220) - bounds.top - 12
          : el.clientHeight - 50,
      };
      el.style.setProperty("--playfield-top", `${camera.current.area.top}px`);
      camera.current.scale =
        mount.clientWidth < 600
          ? 0.96
          : Math.max(
              0.96,
              (mount.clientWidth / SIZE) * 1.15,
              (mount.clientHeight / SIZE) * 1.3,
            );
      camera.current.follow = true;
    }
    resize();
    observer = new ResizeObserver(resize);
    observer.observe(mount);
    mount.parentElement
      .querySelectorAll(".hud-location,.world-objective")
      .forEach((el) => observer.observe(el));
    let previousFrame = performance.now();
    function animate() {
      if (disposed || host.current !== mount || !mount.isConnected) return;
      const p = props.current,
        now =
          clock.current.server +
          (performance.now() - clock.current.local) / 1000,
        pos = travelPosition(p.location, p.travel, now),
        focus =
          camera.current.focus && !p.travel
            ? position(camera.current.focus)
            : pos,
        v = camera.current,
        w = mount.clientWidth,
        h = mount.clientHeight;
      if (v.follow) {
        const target = frameCamera(focus, v.scale, v.area);
        const blend =
          1 - Math.exp(-Math.min(64, performance.now() - previousFrame) / 130);
        v.x += (target.x - v.x) * blend;
        v.y += (target.y - v.y) * blend;
      }
      previousFrame = performance.now();
      // Manual panning may use the whole screen; following uses HUD-aware bounds.
      if (!v.follow || w > 700) {
        v.x =
          SIZE * v.scale < w
            ? (w - SIZE * v.scale) / 2
            : Math.min(0, Math.max(w - SIZE * v.scale, v.x));
        v.y =
          SIZE * v.scale < h
            ? (h - SIZE * v.scale) / 2
            : Math.min(0, Math.max(h - SIZE * v.scale, v.y));
      }
      apply();
      if (avatar.current) {
        avatar.current.style.transform = `translate3d(${pos[0] * SIZE - 85}px,${pos[1] * SIZE - 128}px,0)`;
        avatar.current.classList.toggle(
          "walking",
          Boolean(p.travel && now < p.travel.arrives_at),
        );
      }
      overlay.current?.querySelectorAll("[data-player]").forEach((el) => {
        const other = p.players.find(
          (player) => String(player.id) === el.dataset.player,
        );
        if (!other) return;
        const point = travelPosition(other.location, other.travel, now);
        el.style.transform = `translate3d(${point[0] * SIZE - 60}px,${point[1] * SIZE - 90}px,0)`;
      });
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    function visibility() {
      if (document.hidden) app?.ticker?.stop();
      else app?.ticker?.start();
    }
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      world.current = null;
      destroyApp();
      fogTexture?.destroy(true);
    };
  }, [art, bridge]);
  useEffect(() => {
    if (travel) {
      camera.current.follow = true;
      camera.current.focus = null;
    }
  }, [travel?.started_at]);
  useEffect(() => {
    camera.current.focus = selected;
    camera.current.follow = true;
  }, [selected]);
  return (
    <div
      className="game-world"
      ref={host}
      style={{ "--world-art": `url(${art})` }}
      onPointerDown={(e) => {
        if (e.target.closest("button")) return;
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          cx: camera.current.x,
          cy: camera.current.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
        camera.current.follow = false;
      }}
      onPointerMove={(e) => {
        if (drag.current) {
          camera.current.x = drag.current.cx + e.clientX - drag.current.x;
          camera.current.y = drag.current.cy + e.clientY - drag.current.y;
          apply();
        }
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <div ref={overlay} className="game-map-overlay">
        <div
          className="fallback-world-art"
          style={{ backgroundImage: `url(${art})` }}
        >
          {!bridge && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "#263e37",
                clipPath: bridge
                  ? "polygon(71% 56%,100% 50%,100% 100%,50% 100%,60% 78%)"
                  : "polygon(80% 0,100% 0,100% 100%,48% 100%,58% 68%,72% 46%,72% 28%,78% 15%)",
              }}
            />
          )}
        </div>
        {bridge && (
          <>
            <Boardwalk />
            <img
              className="world-armory"
              src={armory}
              alt=""
              style={{ left: SIZE * 0.84, top: SIZE * 0.52 }}
            />
            <img
              className="world-dragon"
              src={dragon}
              alt=""
              style={{ left: SIZE * 0.84, top: SIZE * 0.77 }}
            />
          </>
        )}
        {travel && (
          <svg
            className="world-route"
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            aria-hidden="true"
          >
            <polyline
              points={travel.path
                .map((p) => `${p[0] * SIZE},${p[1] * SIZE}`)
                .join(" ")}
              fill="none"
              stroke="#29372dcc"
              strokeWidth="8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={travel.path
                .map((p) => `${p[0] * SIZE},${p[1] * SIZE}`)
                .join(" ")}
              fill="none"
              stroke="#f4d982"
              strokeWidth="3"
              strokeDasharray="3 10"
              strokeLinecap="round"
            />
          </svg>
        )}
        {!bridge && (
          <div
            className="uncharted-label"
            style={{ left: SIZE * 0.82, top: SIZE * (bridge ? 0.75 : 0.37) }}
          >
            UNCHARTED MARSH
          </div>
        )}
        {content.locations.filter(accessible).map((l) => (
          <button
            className={`game-location ${selected === l.id ? "selected" : ""}`}
            key={l.id}
            style={{ left: l.x * SIZE, top: l.y * SIZE - 75 }}
            onClick={() => onSelect(l.id)}
            aria-label={l.name}
          >
            <i>
              <WorldIcon
                name={
                  {
                    village: "camp",
                    sawmill: "wood",
                    quarry: "ore",
                    bridge: "planks",
                    mill: "supplies",
                    workshop: "weapons",
                    pool: "boss",
                  }[l.id]
                }
                size={28}
              />
            </i>
            <span>{l.name}</span>
            {l.id === "bridge" && !bridge && <small>Crossing closed</small>}
          </button>
        ))}
        {players
          .filter((p) => p.id !== user.id)
          .slice(0, 20)
          .map((p) => {
            const pos = travelPosition(p.location, p.travel, serverTime);
            return (
              <div
                className="game-avatar other"
                key={p.id}
                data-player={p.id}
                style={{
                  transform: `translate3d(${pos[0] * SIZE - 60}px,${pos[1] * SIZE - 90}px,0)`,
                }}
              >
                <PeeperSprite peeper={p} size={120} showDead={false} />
                <span>{p.name}</span>
              </div>
            );
          })}
        <div ref={avatar} className="game-avatar">
          <PeeperSprite peeper={peeper} size={170} showDead={false} />
          {equipped && (
            <i className="game-keepsake">
              {equipped === "blue-pennant"
                ? "⚑"
                : equipped === "amber-lantern"
                  ? "✧"
                  : "♛"}
            </i>
          )}
          <span>{user.first_name}</span>
        </div>
      </div>
      <div className="world-lens">
        <button onClick={() => zoom(1.25)} aria-label="Zoom in">
          ＋
        </button>
        <button onClick={() => zoom(0.8)} aria-label="Zoom out">
          −
        </button>
        <button
          onClick={() => {
            camera.current.follow = true;
            camera.current.focus = null;
          }}
          aria-label="Find my Peeper"
        >
          ⌖
        </button>
      </div>
    </div>
  );
}
