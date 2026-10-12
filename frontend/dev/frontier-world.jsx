// Development-only visual fixtures. No API, currency, or saved player state.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import WorldHud from "../src/frontier/WorldHud";
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
    [patrol, setPatrol] = useState(false);
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
          max_hp: 300000,
          reward_pool: 3000,
          supplies_filled: 887,
          supplies_required: 900,
          weapons_filled: 897,
          weapons_required: 900,
          contribution: 480,
          estimatedCoins: 4,
          payout: 5,
          defeated_at: Date.now() / 1000,
          contributors: 42,
          leaders: [{ user_id: 1, name: "Reed", contribution: 480 }],
          previousPayouts: [],
        }
      : null,
  };
  return (
    <>
      <style>{`.frontier-shade { top: 44px !important; }`}</style>
      <div
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
        <small>LAYOUT ONLY</small>
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
          onWork={() => {}}
          onMission={() => setPatrol(true)}
          onResume={() => {}}
          onParty={() => {}}
          role={role}
          onRole={setRole}
        />
      </main>
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
              onAttack={() => {}}
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
  root.render(<LayoutChecks />);
}
