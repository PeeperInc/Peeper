import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import core from "@peeper/frontier-core";
import ArcadeStage from "../src/frontier/ArcadeStage";
import WorldIcon from "../src/frontier/WorldIcon";
import "./frontier-playroom.css";
const games = {
  forge: [
    "Forge",
    "weapons",
    "Hold the bellows to heat the blank. Release, then hammer each section twice while it is in the gold band. Reheat when needed. Quench the shaped blade in the blue band.",
  ],
  plane: [
    "Planks",
    "planks",
    "Stop five moving boards over the stack. Missed edges are cut away, leaving less room for the next board.",
  ],
  steer: [
    "Caravan",
    "cart",
    "Steer between three lanes. Recover at least three crates and avoid stumps. Three collisions wreck the cargo.",
  ],
  guard: [
    "Guard",
    "shield",
    "Sweep through dark spore beetles. Leave golden lantern bugs flying. Aim your swipes; don't just scrub the screen.",
  ],
  crank: [
    "Repair",
    "tools",
    "Tap pipe tiles to rotate them. Connect the oil tank on the left to the axle on the right before your turns run out.",
  ],
  dodge: [
    "Boss",
    "boss",
    "Watch the charge warning. Move into the clear lane, then hit Strike while Mirewake recovers. Dodge twice and counter at least once.",
  ],
  rune: [
    "Remedy",
    "leaf",
    "Drag through matching herbs sharing an edge. Release a chain of three or more to brew it. Collect nine ingredients in four brews.",
  ],
};
function Playroom() {
  const [kind, setKind] = useState("plane"),
    [weather, setWeather] = useState("clear"),
    [round, setRound] = useState(null),
    [result, setResult] = useState(null);
  function start() {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    setResult(null);
    setRound({
      version: 3,
      kind,
      seed,
      nonce: crypto.randomUUID(),
      arcade: core.make(kind, seed, weather),
      issued_at: Date.now() / 1000,
      weather,
    });
  }
  return (
    <main className="playroom">
      <header>
        <b>
          Reedbank <span>PLAYROOM · LOCAL ONLY</span>
        </b>
        <a href="/?devUser=999999&devName=Mira">Open the world →</a>
      </header>
      <nav aria-label="Choose a mini-game">
        {Object.entries(games).map(([id, [name, icon]]) => (
          <button
            key={id}
            aria-pressed={kind === id}
            onClick={() => {
              setKind(id);
              setRound(null);
              setResult(null);
            }}
          >
            <WorldIcon name={icon} size={26} />
            {name}
          </button>
        ))}
      </nav>
      {!round ? (
        <section className="playroom-ready">
          <WorldIcon name={games[kind][1]} size={90} />
          <h1>{games[kind][0]}</h1>
          <p>{games[kind][2]}</p>
          <label>
            Conditions{" "}
            <select
              value={weather}
              onChange={(e) => setWeather(e.target.value)}
            >
              <option value="clear">Clear trails</option>
              <option value="rain">Rain · slower steering</option>
              <option value="wind">Wind · drifting beetles</option>
              <option value="harvest">Harvest · eight herbs</option>
            </select>
          </label>
          <button className="playroom-start" onClick={start}>
            Play a round
          </button>
          <small>
            Same game rules and controls as expeditions. Practice earns no
            coins.
          </small>
        </section>
      ) : (
        <ArcadeStage
          challenge={round}
          onComplete={(g) => {
            const grade = core.replay(round, g, 60);
            setResult(grade);
            return grade;
          }}
        />
      )}
      {result && (
        <div className="playroom-result" role="status">
          <b>
            {result.passed ? "Round cleared" : "Round missed"} ·{" "}
            {result.quality}%
          </b>
          <button onClick={start}>New round</button>
          <button
            onClick={() => {
              setRound(null);
              setResult(null);
            }}
          >
            Instructions
          </button>
        </div>
      )}
    </main>
  );
}
if (import.meta.env.DEV) {
  const root =
    import.meta.hot?.data.root || createRoot(document.getElementById("root"));
  if (import.meta.hot) import.meta.hot.data.root = root;
  root.render(<Playroom />);
}
