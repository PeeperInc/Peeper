import React from "react";
import content from "../../../backend/frontier/content.json";
import { Meter, resourceNames, duration } from "./components";
import GestureStage from "./GestureStage";
import "./GatheringLoop.css";
export function WorkScene({
  job,
  now,
  busy,
  onAct,
  onCancel,
  onReturn,
  onNext,
  nextTask,
  onAgain,
  onLeave,
}) {
  const def = content.jobs[job.kind],
    done = job.status !== "active",
    crafting = job.continuous === 2,
    unit = { planks: "plank", supplies: "kit", weapons: "weapon" }[job.kind],
    madeName =
      job.kind === "supplies"
        ? "kits"
        : resourceNames[def.output].toLowerCase(),
    recipe = Object.entries(def.inputs)
      .map(([r, n]) => `${n} ${r === "wood" ? "timber" : "iron"}`)
      .join(" + ");
  const required = job.target || def.steps,
    gathering = !Object.keys(def.inputs).length,
    quantity = job.quantity ?? def.quantity;
  const earned = Math.min(
    def.quantity,
    Math.floor((def.quantity * job.successes) / required),
  );
  const destination = nextTask
    ? nextTask.kind === "boss"
      ? "boss"
      : nextTask.location
    : ["supplies", "weapons"].includes(job.kind)
      ? "boss"
      : "village";
  if (job.continuous)
    return (
      <div className="work-play gathering-loop">
        <div className="gathering-hud">
          <div>
            <span>
              {crafting
                ? `MAKE ${madeName.toUpperCase()}`
                : job.kind === "wood"
                  ? "GATHER TIMBER"
                  : "MINE IRON"}
            </span>
            <b>
              {crafting
                ? `1 game → 1 ${unit} · ${recipe}`
                : `+1 ${resourceNames[def.output].toLowerCase()} + 1 coin per round`}
            </b>
          </div>
          <strong>
            {job.successes}
            <small>{crafting ? "made" : "collected"}</small>
          </strong>
        </div>
        {done ? (
          <div className="work-complete">
            <h2>
              {crafting
                ? `${madeName[0].toUpperCase() + madeName.slice(1)} saved`
                : "Gathering finished"}
            </h2>
            <p>
              {job.successes}{" "}
              {crafting && job.successes === 1 ? unit : madeName} saved ·{" "}
              {job.earnedCoins ?? job.successes} coins earned
            </p>
            <button className="frontier-primary" onClick={onReturn}>
              Return to map
            </button>
          </div>
        ) : (
          <GestureStage
            key={job.challenge.nonce}
            challenge={job.challenge}
            autoStart={job.step > 0}
            disabled={busy}
            feedback={job.feedback}
            onComplete={(gesture) =>
              onAct({ step: job.step, nonce: job.challenge.nonce, gesture })
            }
          />
        )}
        {!done && (
          <footer className="gathering-exit">
            <span>
              {busy
                ? "Saving…"
                : crafting
                  ? `Next ${unit} starts automatically while materials remain.`
                  : "Resources and coins save after every round."}
            </span>
            <button disabled={busy} onClick={onLeave || onCancel}>
              {crafting
                ? "Leave workshop · return to map →"
                : "Leave gathering · return to map →"}
            </button>
          </footer>
        )}
      </div>
    );
  const next = nextTask
    ? [nextTask.title, "Materials saved to shared stores."]
    : {
        wood: [
          "Make planks at the post",
          "At Crooked Post: 3 timber + 1 iron per plank.",
        ],
        ore: [
          "Help with the bridge",
          "Iron is in shared stores. Each plank needs 3 timber and 1 iron.",
        ],
        planks: [
          "Load a delivery",
          "Deliver from Crooked Post. Teams of 2 deliver 6; teams of 3 deliver 10.",
        ],
        weapons: [
          "Fill the expedition reserves",
          "Your weapons are in the shared stores. Contribute them alongside kits to unlock the dragon for everyone.",
        ],
        supplies: [
          "Fill the expedition reserves",
          "Your kits are in the shared stores. Contribute them to the expedition to unlock the shared dragon battle.",
        ],
      }[job.kind];
  return (
    <div className="work-play">
      <div className="work-hud batch-hud">
        <span>
          <b>
            {done
              ? "BATCH RECEIPT"
              : `MAKE ${quantity} ${resourceNames[def.output].toUpperCase()}`}
          </b>
          {done
            ? job.result?.passed
              ? "Saved to community stores"
              : "No materials lost"
            : "Three good rounds · misses keep your progress"}
        </span>
        <div
          className="batch-slots"
          aria-label={`${job.successes} of ${required} rounds complete`}
        >
          {Array.from({ length: required }, (_, i) => (
            <i key={i} className={i < job.successes ? "filled" : ""}>
              {i < job.successes ? "✓" : i + 1}
            </i>
          ))}
        </div>
      </div>
      {done ? (
        <div className="work-complete batch-receipt">
          <span>
            {job.result?.passed
              ? "DELIVERED TO THE STORES"
              : gathering
                ? "BATCH ENDED"
                : "INGREDIENTS RETURNED"}
          </span>
          <h2>
            {job.result?.passed
              ? `+${job.result.quantity} ${resourceNames[job.result.output].toLowerCase()}`
              : "No finished batch yet"}
          </h2>
          <p>
            {job.result?.passed
              ? next[1]
              : "Unfinished recipes return their ingredients. You can try again; completed gathering is always kept."}
          </p>
          {job.result?.passed && (
            <div className="batch-payment">
              <b>Contribution saved</b>
              <span>
                {job.result.coins
                  ? `+${job.result.coins} coin`
                  : job.coinReadyAt > now
                    ? `Next coin available in ${duration(job.coinReadyAt - now)}`
                    : "Your next successful activity can earn a coin"}
              </span>
            </div>
          )}
          {job.result?.passed && (
            <button
              className="frontier-primary"
              onClick={() => onNext(destination)}
              disabled={busy}
            >
              {next[0]} →
            </button>
          )}
          <button className="batch-secondary" onClick={onAgain} disabled={busy}>
            Make another batch
          </button>
          <button className="frontier-text-button" onClick={onReturn}>
            Return to map
          </button>
        </div>
      ) : (
        <GestureStage
          challenge={job.challenge}
          disabled={busy}
          feedback={job.feedback}
          onComplete={(gesture) =>
            onAct({ step: job.step, nonce: job.challenge.nonce, gesture })
          }
        />
      )}
      {!done && (
        <footer className="work-footer">
          <div>
            <strong>
              {job.successes} / {required} rounds ·{" "}
              {gathering
                ? `${earned} ${resourceNames[def.output].toLowerCase()} secured`
                : `Batch yields ${quantity} ${resourceNames[def.output].toLowerCase()}`}
            </strong>
            <small>
              {job.coinReadyAt <= now
                ? "+1 coin on collection"
                : `Materials every batch · next coin in ${duration(job.coinReadyAt - now)}`}
            </small>
          </div>
          <button
            className="frontier-text-button"
            disabled={busy}
            onClick={onCancel}
          >
            {gathering && earned ? `Collect ${earned} & leave` : "Leave batch"}
          </button>
        </footer>
      )}
    </div>
  );
}
export { default as MissionScene } from "./MissionScene";
