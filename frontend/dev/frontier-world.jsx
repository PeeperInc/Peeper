import { ScenePeeperContext } from "../src/frontier/ScenePeeper";
import '../src/browserInteractions';
// Development-only visual fixtures. No API, currency, or saved player state.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import BossCombat from "../src/frontier/BossCombat";
import { practiceBattle } from "./practiceBattle.mjs";
import WorldHud from "../src/frontier/WorldHud";
import { WorkScene } from "../src/frontier/Activities";
import core from "@peeper/frontier-core";
import { BossCampaign } from "../src/frontier/BossCampaign";
import "../src/frontier/BossCampaign.css";
import { Dialog } from "../src/frontier/components";
import content from "../../backend/frontier/content.json";
import "../src/screens/FrontierScreen.css";
import "../src/frontier/MarshGame.css";
import "../src/frontier/StrategyHud.css";
function LayoutChecks() {
  const [stage, setStage] = useState(1),
    [selected, select] = useState("mill"),
    [role, setRole] = useState("driver"),
    [patrol, setPatrol] = useState(false),
    [practice, setPractice] = useState(null),
    [combat, setCombat] = useState(false),
    [battle] = useState(() => practiceBattle());
  function practiceChallenge(kind) {
    const mechanic = content.jobs[kind].mechanic,
      seed = crypto.getRandomValues(new Uint32Array(1))[0];
    return {
      kind: mechanic,
      version: 3,
      seed,
      nonce: crypto.randomUUID(),
      issued_at: Date.now() / 1000,
      ...(core.modes[mechanic]
        ? { arcade: core.make(mechanic, seed) }
        : {
            shapes: [
              [
                [0, 0],
                [1, 0],
              ],
              [
                [0, 0],
                [0, 1],
                [1, 1],
              ],
              [
                [0, 0],
                [1, 0],
                [0, 1],
                [1, 1],
              ],
            ],
          }),
    };
  }
  function startPractice(kind) {
    setPractice({
      kind,
      status: "active",
      successes: 0,
      step: 0,
      target: 1,
      continuous: ["wood", "ore"].includes(kind) ? 1 : 2,
      quantity: ["wood", "ore"].includes(kind)
        ? 1
        : content.jobs[kind].quantity,
      coinReadyAt: Date.now() / 1000 + 180,
      challenge: practiceChallenge(kind),
    });
  }
  const projects = content.projects.map((p, i) => ({
    id: p.id,
    progress: i < stage ? p.target : 0,
    completed_at: i < stage ? 1 : null,
  }));
  const user = { id: 1, first_name: "Layout check" };
  const state = {
    projects,
    lobbies: [],
    stock: { wood: 12, ore: 12, planks: 12, supplies: 12, weapons: 12 },
    journey: { cycle: 1, actions: 124, earnedCoins: 390 },
    player: {
      location: selected,
      xp: 0,
      coins: 50,
      equipped: null,
      deliveries: 0,
    },
    serverTime: Date.now() / 1000,
    boss: stage
      ? {
          name: "Mirewake",
          cycle: 1,
          phase: stage === 1 ? "preparing" : stage === 2 ? "open" : "defeated",
          hp: stage === 3 ? 0 : 245600,
          max_hp: content.siege.maxHp,
          supplies_filled: content.siege.suppliesRequired - 13,
          supplies_required: content.siege.suppliesRequired,
          weapons_filled: content.siege.weaponsRequired - 3,
          weapons_required: content.siege.weaponsRequired,
          contribution: 480,
          actions: 124,
          estimatedCoins: 4,
          earnedCoins: 390,
          payout: 5,
          payoutXp: 100,
          defeated_at: Date.now() / 1000,
          contributors: 42,
          leaders: [{ user_id: 1, name: "Reed", actions: 124 }],
          previousPayouts: [],
        }
      : null,
  };
  return (
    <>
      <style>{`.frontier-shade { top: 44px !important; } @media(max-width:400px){.world-fixture-bar{gap:4px!important;padding:0 5px!important}.world-fixture-bar small{font-size:8px}.world-fixture-bar button{font-size:10px}}`}</style>
      <div
        className="world-fixture-bar"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 44,
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: "0 12px",
          color: "#eee1bc",
          zIndex: 100,
          background: "#162a23",
        }}
      >
        <small>LOCAL PRACTICE</small>
        {[0, 1, 2, 3].map((n) => (
          <button
            key={n}
            onClick={() => {
              setStage(n);
              select(n === 0 ? "village" : n === 1 ? "mill" : "pool");
            }}
          >
            {["Bridge", "Prepare", "Battle", "Victory"][n]}
          </button>
        ))}
      </div>
      <main
        className="frontier-screen"
        style={{ position: "fixed", inset: "44px 0 0" }}
      >
        <WorldHud
          state={state}
          selected={selected}
          onSelect={select}
          onTravel={select}
          user={user}
          peeper={{ alive: 1 }}
          players={[]}
          connected={false}
          busy={false}
          now={state.serverTime}
          onClose={() => {}}
          onPanel={(id) => {
            if (id === "boss") setPatrol(true);
          }}
          onWork={startPractice}
          onMission={() => setPatrol(true)}
          onResume={() => {}}
          onParty={() => {}}
          role={role}
          onRole={setRole}
        />
      </main>
      {combat && (
        <div className="frontier-screen">
          <Dialog
            title="Mirewake · local practice"
            className="frontier-activity-dialog"
            onClose={() => setCombat(false)}
          >
            <BossCombat
              load={battle.load}
              hit={battle.hit}
              onExit={() => setCombat(false)}
            />
          </Dialog>
        </div>
      )}
      {practice && (
        <div className="frontier-screen">
          <Dialog
            title="Workbench · local practice"
            className="frontier-activity-dialog"
            onClose={() => setPractice(null)}
          >
            <WorkScene
              job={practice}
              now={Date.now() / 1000}
              busy={false}
              onAct={({ gesture }) => {
                // This fixture is isolated from accounts and rewards. The production
                // server remains the authority for real batches.
                const grade = practice.challenge.arcade
                  ? core.replay(practice.challenge, gesture, 60)
                  : { passed: true, quality: 100 };
                const successes = practice.successes + (grade.passed ? 1 : 0),
                  done = !practice.continuous && successes >= 3;
                setPractice({
                  ...practice,
                  successes,
                  step: practice.step + 1,
                  feedback: grade,
                  status: done ? "done" : "active",
                  challenge: practiceChallenge(practice.kind),
                  result: done
                    ? {
                        passed: true,
                        output: content.jobs[practice.kind].output,
                        quantity: practice.quantity,
                        xp: 0,
                        coins: 0,
                      }
                    : null,
                });
                return grade;
              }}
              onCancel={() => setPractice(null)}
              onLeave={() => setPractice(null)}
              onReturn={() => setPractice(null)}
              onAgain={() => startPractice(practice.kind)}
              onNext={(id) => {
                select(id === "boss" ? "pool" : id);
                setPractice(null);
              }}
            />
          </Dialog>
        </div>
      )}
      {patrol && (
        <div className="frontier-screen">
          <Dialog
            title="The shared expedition"
            onClose={() => setPatrol(false)}
          >
            <BossCampaign
              state={state}
              now={state.serverTime}
              busy={false}
              onPrepare={() => {}}
              onGo={(id) => {
                select(id);
                setPatrol(false);
              }}
              onAttack={() => {
                setPatrol(false);
                setCombat(true);
              }}
            />
          </Dialog>
        </div>
      )}
    </>
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
      <LayoutChecks />
    </ScenePeeperContext.Provider>,
  );
}
