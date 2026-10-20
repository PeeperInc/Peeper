import React from "react";
import content from "../../../backend/frontier/content.json";
import WorldIcon from "./WorldIcon";
import { DeliveryBonus } from "./DeliverySetup";
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
  if (
    state.stock.wood >= content.jobs.planks.inputs.wood &&
    state.stock.ore >= content.jobs.planks.inputs.ore
  )
    return {
      location: "village",
      title: "Make construction planks",
      step: 1,
      detail: "3 timber + 1 iron → 1 plank",
      kind: "planks",
    };
  if (state.stock.wood >= content.jobs.planks.inputs.wood)
    return {
      location: "quarry",
      title: "Mine iron for the nails",
      step: 0,
      detail: "1 iron per plank",
      kind: "ore",
    };
  return {
    location: "sawmill",
    title: "Gather timber",
    step: 0,
    detail: "3 timber and 1 iron per plank",
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
          ? "Rebuild the crossing to open the far shore for every player. Gather timber and iron, make planks, then deliver them."
          : "Fill both reserves to unlock the shared battle."}
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
      <ol className="construction-chain">
        {(project
          ? [
              {
                icon: "wood",
                title: "Gather timber and iron",
                detail:
                  "Timber at Mosswood Mill. Iron at Pebble Quarry. Both go to shared stores.",
                where: "Mosswood Mill + Pebble Quarry",
                location: next.kind === "ore" ? "quarry" : "sawmill",
                amount: state.stock.wood,
              },
              {
                icon: "planks",
                title: "Craft the planks",
                detail: "1 game → 1 plank. Cost: 3 timber + 1 iron.",
                where: "Crooked Post",
                location: "village",
                amount: state.stock.planks,
              },
              {
                icon: "cart",
                title: "Deliver together",
                detail:
                  "Solo: 2 → 2 planks. Two players: 4 → 6. Three: 6 → 10. Three tasks shared across the crew.",
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
                  "1 kit: 1 timber + 1 iron. 1 weapon: 1 timber + 3 iron. One game makes one item from shared materials.",
                where: "Mosswood Mill + Pebble Quarry",
                location: next.step === 0 ? next.location : "quarry",
                amount: null,
              },
              {
                icon: "supplies",
                title: "Kits and weapons",
                detail:
                  "Match supplies at Supply Mill for kits. Forge weapons at the Armory. Fill both reserves to open the battle.",
                where: "Supply Mill + Armory",
                location: "mill",
                amount: state.stock.supplies,
              },
              {
                icon: "boss",
                title: "Fight Mirewake",
                detail:
                  "Every hit reduces the shared health bar. The battle stays open until Mirewake falls.",
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
                {next.step === i ? "Go here" : "Go here"} →
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
      {project && <DeliveryBonus />}
      <p className="plan-footnote">
        Materials come from shared stores. Unfinished recipes and failed
        deliveries return their reservations.
      </p>
    </div>
  );
}
