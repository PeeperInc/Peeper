import { ScenePeeperContext } from "../src/frontier/ScenePeeper";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import core from "@peeper/frontier-core";
import BossCombat from "../src/frontier/BossCombat";
import { practiceBattle } from "./practiceBattle.mjs";
import ArcadeStage from "../src/frontier/ArcadeStage";
import WorldIcon from "../src/frontier/WorldIcon";
import "./frontier-playroom.css";
const games = {
  split: [
    "Timber",
    "wood",
    "Hold the glowing notch directly on the timber. Release when its ring turns gold.",
  ],
  chip: [
    "Quarry",
    "ore",
    "Tap the glowing crack. A gold ring makes a clean fracture and breaks more iron.",
  ],
  smith: [
    "Forge",
    "weapons",
    "Heat the metal, hammer the highlighted section, then quench in water. Hatchets, spearheads and short blades need different strikes.",
  ],
  board: [
    "Planks",
    "planks",
    "Saw back and forth along the guide, plane the surface both ways, then drive four nails. Watch the progress bar as you work.",
  ],
  drive: [
    "Caravan",
    "cart",
    "Drag to steer. Swipe up to hop over stumps. Collect three crates.",
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
  battle: [
    "Boss",
    "boss",
    "Tap Mirewake to strike. Use heavy hits and guard against charges. No short rounds.",
  ],
  brew: [
    "Remedy",
    "leaf",
    "Swap neighbouring ingredients to match three. Collect eight of each recipe ingredient in eight moves.",
  ],
};
function Playroom() {
  const [kind, setKind] = useState("split"),
    [round, setRound] = useState(null),
    [result, setResult] = useState(null),
    [battle, setBattle] = useState(() => practiceBattle());
  function start() {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    setResult(null);
    if (kind === "battle") {
      setBattle(practiceBattle());
      setRound({ kind: "battle" });
      return;
    }
    setRound({
      version: 3,
      kind,
      seed,
      nonce: crypto.randomUUID(),
      arcade: core.make(kind, seed),
      issued_at: Date.now() / 1000,
    });
  }
  return (
    <main className="playroom">
      <header>
        <b>
          Reedbank <span>PLAYROOM · LOCAL ONLY</span>
        </b>
        <a href="/dev/frontier-world.html">Open the world →</a>
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
          <button className="playroom-start" onClick={start}>
            Play a round
          </button>
          <small>
            Same game rules and controls as expeditions. Practice earns no
            coins.
          </small>
        </section>
      ) : round.kind === "battle" ? (
        <BossCombat
          load={battle.load}
          hit={battle.hit}
          onExit={() => setRound(null)}
        />
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
  root.render(
    <ScenePeeperContext.Provider
      value={{
        alive: 1,
        slot_head: "head_knight_helmet",
        slot_body: "body_knight_armor",
      }}
    >
      <Playroom />
    </ScenePeeperContext.Provider>,
  );
}
