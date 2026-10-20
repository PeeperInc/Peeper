import React, { useEffect, useRef, useState } from "react";
import core from "@peeper/frontier-core";
import "./ForgeStage.css";

const names = ["Heel", "Edge", "Tip"];
export default function ForgeStage({
  challenge,
  disabled,
  onComplete,
  feedback,
  autoStart = false,
}) {
  const run = useRef(null),
    send = useRef(onComplete),
    blocked = useRef(disabled);
  const [view, setView] = useState(null),
    [retry, setRetry] = useState(0),
    [failed, setFailed] = useState(false),
    [started, setStarted] = useState(false);
  const recipe = challenge.arcade.recipe,
    required = recipe?.sections || [2, 2, 2];
  send.current = onComplete;
  blocked.current = disabled;
  function action(type, x = 0) {
    const r = run.current;
    if (!r || r.sent || blocked.current || performance.now() < r.start) return;
    const e = [
      Math.min(
        challenge.arcade.duration,
        Math.round(performance.now() - r.start),
      ),
      type,
      x,
      0,
    ];
    if (r.events.length >= 250) return;
    r.events.push(e);
    core.act(r.s, e);
    setView({ ...r.s, sections: [...r.s.sections], ready: true });
  }
  useEffect(() => {
    const r = {
      s: core.create(challenge),
      events: [],
      start: autoStart ? performance.now() : Infinity,
      sent: false,
    };
    run.current = r;
    setFailed(false);
    setStarted(autoStart);
    setView(null);
    let frame,
      gone = false,
      last = 0;
    function draw(now) {
      core.advance(r.s, Math.max(0, now - r.start));
      if (now - last > 50 || r.s.done) {
        setView({ ...r.s, sections: [...r.s.sections], ready: now >= r.start });
        last = now;
      }
      if (r.s.done && !r.sent) {
        r.sent = true;
        if (!r.events.length) r.events.push([Math.round(r.s.t), 7, 0, 0]);
        // The server still replays all recorded input against its own clock.
        r.pending = setTimeout(
          async () => {
            try {
              const result = await send.current({ events: r.events });
              if (!gone && !result) setFailed(true);
            } catch {
              if (!gone) setFailed(true);
            }
          },
          Math.max(650, 2300 - (now - r.start)),
        );
      }
      if (!r.s.done && Number.isFinite(r.start))
        frame = requestAnimationFrame(draw);
    }
    function release() {
      if (r.s.heating) action(7);
    }
    function visibility() {
      if (document.hidden) release();
    }
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", visibility);
    r.animate = () => {
      frame = requestAnimationFrame(draw);
    };
    r.animate();
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      clearTimeout(r.pending);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [challenge.nonce, retry]);
  const s = view || { heat: 0.25, sections: [0, 0, 0], t: 0 },
    formed = s.sections.every((n, i) => n === required[i]),
    hot =
      s.heat >= (recipe?.hot[0] ?? 0.45) &&
      s.heat <= (recipe?.hot[1] ?? 0.9) &&
      (!recipe?.thermal || s.heatBatchHits < 2),
    quenchable =
      formed &&
      s.heat >= (recipe?.quench[0] ?? 0.35) &&
      s.heat <= (recipe?.quench[1] ?? 0.7),
    locked = disabled || s.done || !s.ready,
    cue = s.done
      ? s.quenched
        ? "Steel tempered"
        : "The blade needs another try"
      : formed
        ? quenchable
          ? "Quench the blade"
          : s.heat > 0.7
            ? "Let it cool into blue"
            : "Warm it into blue"
        : s.heating
          ? "Release in the gold band"
          : hot
            ? "Hammer the glowing section"
            : recipe?.thermal && s.heatBatchHits >= 2
              ? "Reheat for the next two strikes"
              : s.heat > 0.9
                ? "Too hot — let it cool"
                : "Hold the bellows to reheat",
    fill = s.quenched
      ? "#cad9cf"
      : `hsl(${12 + s.heat * 34} 85% ${28 + s.heat * 39}%)`;
  return (
    <section className="forge-stage" aria-label="Forge an expedition blade">
      <header className="forge-heading">
        <div>
          <small>REEDBANK ARMORY</small>
          <h3>
            {recipe
              ? `Forge a ${recipe.name.toLowerCase()}`
              : "From iron to steel"}
          </h3>
        </div>
        <b>
          {Math.max(0, Math.ceil((challenge.arcade.duration - s.t) / 1000))}s
        </b>
      </header>
      <ol className="forge-steps" aria-label="Forging steps">
        <li className={!formed && (s.heating || !hot) ? "current" : ""}>
          Heat
        </li>
        <li className={!formed && !s.heating && hot ? "current" : ""}>Shape</li>
        <li className={formed ? "current" : ""}>Quench</li>
      </ol>
      <div className="forge-scene">
        {!started && (
          <div className="forge-ready">
            <p>
              {feedback && !feedback.passed
                ? "Try again — earlier rounds are kept."
                : "Heat, shape, then quench."}
              <small>
                {recipe
                  ? "Two strikes per heat. Reheat, shape the next marks, then quench in blue."
                  : "Hold the bellows. Hammer each section twice in the gold band."}
              </small>
            </p>
            <button
              disabled={disabled}
              onClick={() => {
                run.current.start = performance.now();
                run.current.animate();
                setStarted(true);
              }}
            >
              Begin forging
            </button>
          </div>
        )}
        <svg
          viewBox="0 0 400 290"
          role="img"
          aria-label={
            s.quenched
              ? "Finished silver blade above the anvil"
              : "Glowing blade on a hand drawn anvil"
          }
        >
          <defs>
            <radialGradient id="forge-fire-glow">
              <stop stopColor="#ffc75e" stopOpacity=".6" />
              <stop offset="1" stopColor="#e7812e" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="forge-steel">
              <stop stopColor="#b3bdac" />
              <stop offset=".5" stopColor="#7e9186" />
              <stop offset="1" stopColor="#455e55" />
            </linearGradient>
          </defs>
          <ellipse
            cx="95"
            cy="154"
            rx={s.heating ? 135 : 85}
            ry="105"
            fill="url(#forge-fire-glow)"
          />
          <path d="M0 234L400 227V290H0Z" fill="#3d392d" />
          <path
            d="M22 227V35L121 31L124 232Z"
            fill="#564e3b"
            stroke="#262c24"
            strokeWidth="3"
          />
          <path d="M37 144Q32 62 99 64L110 146Z" fill="#252b24" />
          {[0, 1, 2, 3, 4].map((i) => (
            <path
              key={i}
              d={`M${40 + i * 13} 138q-8 -${25 + (s.heating ? Math.sin(s.t / 100 + i) * 12 + 25 : 10)} 6 -${40 + (s.heating ? 20 : 0)}q20 35 8 40Z`}
              fill={i % 2 ? "#edb64e" : "#cd733d"}
            />
          ))}
          <path
            d="M28 51L57 49M69 47L110 46M24 166L74 164M83 163L119 161M27 197L51 195M62 195L118 193"
            fill="none"
            stroke="#7d7358"
            strokeWidth="3"
          />
          <path
            d="M124 254L138 191L284 184L300 254Z"
            fill="#766043"
            stroke="#262c24"
            strokeWidth="3"
          />
          <path
            d="M106 155L312 150L365 159L317 182L266 184L269 213L157 215L165 180L118 180Z"
            fill="url(#forge-steel)"
            stroke="#26372d"
            strokeWidth="4"
          />
          <path
            d="M132 165L298 162M178 192L253 190M181 200L249 198"
            fill="none"
            stroke="#b7bda5"
            strokeWidth="2"
          />
          <path
            d={
              recipe?.name === "Hatchet"
                ? "M126 132L180 119L223 105L245 147L224 179L181 160L126 157Z"
                : recipe?.name === "Spearhead"
                  ? "M126 139L166 131L260 131L338 145L260 159L166 159L126 151Z"
                  : "M126 139L154 132L291 132L326 145L291 157L154 157L126 151Z"
            }
            fill={fill}
            stroke="#372d24"
            strokeWidth="3"
          />
          {s.sections.map((n, i) => (
            <g key={i}>
              <path
                d={`M${157 + i * 50} ${140 - n * 2}l31 ${3 - n}M${160 + i * 50} 149l27 -1`}
                stroke={n === required[i] ? "#ffe5a3" : "#894931"}
                strokeWidth="2"
              />
              <text
                x={172 + i * 50}
                y="118"
                textAnchor="middle"
                fill="#f1dec0"
                fontSize="12"
              >
                {["I", "II", "III"][i]}
              </text>
            </g>
          ))}
          <path
            d="M17 250L20 215Q43 197 68 215L73 250Q48 265 17 250Z"
            fill="#746447"
            stroke="#282e26"
            strokeWidth="3"
          />
          <ellipse
            cx="45"
            cy="215"
            rx="25"
            ry="10"
            fill="#83b6b5"
            stroke="#293c32"
            strokeWidth="3"
          />
          <path
            d="M27 216Q36 211 43 217T62 216"
            fill="none"
            stroke="#d3e5cc"
            strokeWidth="2"
          />
          {s.flash &&
            s.t - s.flash.t < 280 &&
            !s.flash.bad &&
            [0, 1, 2, 3].map((i) => (
              <path
                key={i}
                d={`M${173 + s.flash.section * 50} 140l${Math.cos(i * 1.7) * 30} ${-15 - Math.sin(i) * 25}`}
                stroke="#ffe49a"
                strokeWidth="3"
              />
            ))}
          <g
            className={
              s.flash && s.t - s.flash.t < 320
                ? "forge-hammer striking"
                : "forge-hammer"
            }
            style={{
              transformOrigin: `${173 + (s.flash?.section ?? 0) * 50}px 140px`,
            }}
            transform={`translate(${173 + (recipe?.order[s.sections.reduce((n, v) => n + v, 0)] ?? s.flash?.section ?? 0) * 50} 82) rotate(-28)`}
          >
            <path d="M0-15V43" stroke="#b58b55" strokeWidth="9" />
            <rect
              x="-24"
              y="-30"
              width="48"
              height="23"
              rx="4"
              fill="#a7bab0"
              stroke="#324c42"
              strokeWidth="3"
            />
            <path d="M-19-24H18" stroke="#d7dfc7" strokeWidth="3" />
          </g>
          {s.quenched && (
            <path
              d="M40 202Q20 187 41 175T38 147M57 204Q73 185 56 167"
              fill="none"
              stroke="#deead199"
              strokeWidth="5"
              strokeLinecap="round"
            />
          )}
        </svg>
      </div>
      <div className="forge-console">
        <div className="forge-cue" aria-live="polite">
          {cue}
        </div>
        {recipe?.thermal && (
          <div className="forge-heat-batch">
            <span>
              {Math.floor(s.sections.reduce((n, v) => n + v, 0) / 2) + 1 > 3
                ? "Shaping complete"
                : `Heat ${Math.floor(s.sections.reduce((n, v) => n + v, 0) / 2) + 1} of 3`}
            </span>
            <span>
              {formed
                ? "Finish in the blue band"
                : `${Math.max(0, 2 - (s.heatBatchHits || 0))} strikes before reheating`}
            </span>
          </div>
        )}
        <div
          className="forge-temperature"
          role="meter"
          aria-label="Metal temperature"
          aria-valuenow={Math.round(s.heat * 100)}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <i
            className={formed ? "quench-band" : "hammer-band"}
            style={
              recipe
                ? {
                    left: `${(formed ? recipe.quench[0] : recipe.hot[0]) * 100}%`,
                    width: `${((formed ? recipe.quench[1] : recipe.hot[1]) - (formed ? recipe.quench[0] : recipe.hot[0])) * 100}%`,
                  }
                : undefined
            }
          />
          <b style={{ left: `${s.heat * 100}%` }} />
        </div>
        <div className="forge-scale">
          <span>Cold</span>
          <span>{formed ? "Blue · quench" : "Gold · hammer"}</span>
          <span>Too hot</span>
        </div>
        <div className="forge-sections">
          {names.map((name, i) => (
            <button
              key={name}
              className={
                recipe &&
                recipe.order[s.sections.reduce((sum, n) => sum + n, 0)] === i
                  ? "forge-next"
                  : ""
              }
              disabled={
                locked ||
                s.heating ||
                s.t - s.lastStrike < 320 ||
                s.sections[i] === required[i]
              }
              onClick={() => action(6, i)}
              aria-label={`Hammer ${name.toLowerCase()}`}
            >
              <span>{name}</span>
              <b>
                {s.sections[i] === required[i]
                  ? "✓"
                  : `${s.sections[i]} / ${required[i]}`}
              </b>
            </button>
          ))}
        </div>
        <div className="forge-tools">
          <button
            className={s.heating ? "heating" : ""}
            aria-pressed={!!s.heating}
            title="Hold with a finger or Space. Enter toggles the bellows."
            disabled={locked}
            onPointerDown={(e) => {
              if (e.isPrimary === false) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              action(0);
            }}
            onPointerUp={() => action(2)}
            onPointerCancel={() => action(7)}
            onLostPointerCapture={() => {
              if (run.current?.s.heating) action(7);
            }}
            onKeyDown={(e) => {
              if (["Space", "Enter"].includes(e.code)) {
                e.preventDefault();
                if (!e.repeat)
                  action(e.code === "Enter" && run.current?.s.heating ? 2 : 0);
              }
            }}
            onKeyUp={(e) => {
              if (e.code === "Space") {
                e.preventDefault();
                action(2);
              }
            }}
            onBlur={() => {
              if (run.current?.s.heating) action(7);
            }}
          >
            Hold bellows<span>Space · hold / Enter · toggle</span>
          </button>
          <button
            className="forge-quench"
            disabled={locked || !quenchable || s.heating}
            onClick={() => action(5)}
          >
            Quench<span>Finish the blade</span>
          </button>
        </div>
        <p className="forge-feedback" role="status">
          {disabled
            ? "Saving your blade…"
            : s.message ||
              (recipe
                ? "Hammer the glowing section. Reheat when needed."
                : "Two strikes per section. Reheat whenever the metal cools.")}
        </p>
        {failed && (
          <button onClick={() => setRetry((n) => n + 1)}>
            Connection interrupted · Retry
          </button>
        )}
      </div>
    </section>
  );
}
