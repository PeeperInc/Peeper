import React from "react";
import content from "../../../backend/frontier/content.json";
import WorldIcon from "./WorldIcon";
import { Meter, resourceNames } from "./components";

export function nextContribution(state) {
  if (state.boss) {
    const b = state.boss;
    if (b.phase !== "preparing")
      return {
        location: "pool",
        title:
          b.phase === "defeated"
            ? "View the victory rewards"
            : "Join the shared battle",
        step: 2,
        kind: "boss",
      };
    const item =
        b.supplies_filled < b.supplies_required ? "supplies" : "weapons",
      job = content.jobs[item];
    if (state.stock[item] > 0)
      return {
        location: "pool",
        title: "Fill the expedition reserves",
        step: 2,
        kind: "boss",
      };
    if (state.stock.wood < job.inputs.wood)
      return {
        location: "sawmill",
        title: "Gather timber for the expedition",
        step: 0,
        kind: "wood",
      };
    if (state.stock.ore < job.inputs.ore)
      return {
        location: "quarry",
        title: "Mine iron for the expedition",
        step: 0,
        kind: "ore",
      };
    return { location: job.location, title: job.name, step: 1, kind: item };
  }
  if (state.stock.planks >= 2)
    return {
      location: "village",
      title: "Load a caravan",
      step: 2,
      detail: "2 planks ready in the shared stores",
      kind: "delivery",
    };
  if (state.stock.wood >= 3)
    return {
      location: "village",
      title: "Make construction planks",
      step: 1,
      detail: "Use 3 shared timber to make 2 planks",
      kind: "planks",
    };
  return {
    location: "sawmill",
    title: "Gather timber",
    step: 0,
    detail: "One short batch supplies the next workbench",
    kind: "wood",
  };
}

export default function ConstructionPlan({ state, onGo }) {
  const project = content.projects.find(
    (p) => !state.projects.find((v) => v.id === p.id)?.completed_at,
  );
  const next = nextContribution(state),
    progress = state.projects.find((p) => p.id === project?.id)?.progress || 0;
  return (
    <div className="construction-plan">
      <span className="plan-eyebrow">ONE WORLD · EVERYONE CONTRIBUTES</span>
      <h2>{project ? project.name : "Equip the expedition"}</h2>
      <p>
        {project?.id === "bridge"
          ? "Rebuild the crossing to open the far shore for every player. Gather timber, make planks and deliver them to the landing."
          : project?.id === "mill"
            ? "The crossing is open. Rebuild the workshop to make patrol supplies and reach the deep pool."
            : "Fill both expedition reserves, then attack the dragon as often as you like. Every hit counts toward your share of the victory fund."}
      </p>
      {project && (
        <>
          <Meter
            value={progress}
            max={project.target}
            label="Shared construction"
          />
          <div className="plan-progress">
            <b>
              {progress} / {project.target} planks
            </b>
            <span>{state.player.deliveries} deliveries by you</span>
          </div>
        </>
      )}
      {project?.stages && (
        <div className="plan-stages">
          {project.stages.map((name, i) => (
            <span
              key={name}
              className={
                progress >= (project.target / 4) * (i + 1)
                  ? "done"
                  : Math.floor(progress / (project.target / 4)) === i
                    ? "current"
                    : ""
              }
            >
              {i + 1}. {name}
            </span>
          ))}
        </div>
      )}
      <ol className="construction-chain">
        {(project
          ? [
              {
                icon: "wood",
                title: "Gather timber",
                detail: "3 good rounds → 3 timber in the shared stores",
                where: "Mosswood Mill",
                location: "sawmill",
                amount: state.stock.wood,
              },
              {
                icon: "planks",
                title: "Craft the planks",
                detail: "3 timber → 2 planks at the workbench",
                where: "Crooked Post",
                location: "village",
                amount: state.stock.planks,
              },
              {
                icon: "cart",
                title: "Deliver together",
                detail:
                  "Take 2 planks solo, or load a 6-plank wagon for at least two active players. Three encounters advance the construction.",
                where: "Crooked Post → construction site",
                location: "village",
                amount: null,
              },
            ]
          : [
              {
                icon: "ore",
                title: "Supply the workshop",
                detail:
                  "Kits: 1 timber + 1 iron → 3 kits. Weapons: 1 timber + 3 iron → 3 weapons. Materials come from shared stores.",
                where: "Mosswood Mill + Pebble Quarry",
                location: next.step === 0 ? next.location : "quarry",
                amount: null,
              },
              {
                icon: "supplies",
                title: "Kits and weapons",
                detail:
                  "Pack kits at the Supply Mill and forge weapons at the Armory. Both reserves must be filled to open the battle.",
                where: "Supply Mill + Armory",
                location: "mill",
                amount: state.stock.supplies,
              },
              {
                icon: "boss",
                title: "Fight Mirewake",
                detail:
                  "Once equipped, attack freely. No kits or energy per attempt. On death, the fixed coin fund is split by accumulated damage.",
                where: "The Dragon's Hollow",
                location: "pool",
                amount: null,
              },
            ]
        ).map((step, i) => (
          <li key={step.icon} className={next.step === i ? "recommended" : ""}>
            <div className="plan-step-icon">
              <WorldIcon name={step.icon} size={32} />
              <small>{i + 1}</small>
            </div>
            <div>
              <span>{step.where}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
              {step.amount !== null && (
                <b>{step.amount} available to everyone</b>
              )}
              <button onClick={() => onGo(step.location)}>
                {next.step === i ? "Needed now — go" : "Show this workshop"} →
              </button>
            </div>
          </li>
        ))}
      </ol>
      {state.recentWork?.some((j) => j.result?.passed) && (
        <div className="plan-receipts">
          <b>Your recent contributions</b>
          {state.recentWork
            .filter((j) => j.result?.passed)
            .map((j) => (
              <p key={j.id}>
                <WorldIcon name={j.result.output} size={20} /> +
                {j.result.quantity}{" "}
                {resourceNames[j.result.output].toLowerCase()} added to the
                community stores
              </p>
            ))}
        </div>
      )}
      {project ? (
        <div className="plan-note">
          <WorldIcon name="ore" size={28} />
          <p>
            <b>What about iron?</b> Iron stays in the shared stores for future
            expedition kits and weapons. It does not build the bridge. Nothing
            needs to be carried by hand.
          </p>
        </div>
      ) : (
        <div className="plan-note">
          <WorldIcon name="cart" size={28} />
          <p>
            <b>Keep building together.</b> Plank deliveries at Crooked Post now
            maintain the trails. They still earn experience and count toward the
            weekly board.
          </p>
        </div>
      )}
      <p className="plan-footnote">
        Materials are shared; coins and experience are yours. Successful work
        and journeys pay at most one coin every 3 minutes. You can keep
        producing and delivering between payments.
      </p>
    </div>
  );
}
