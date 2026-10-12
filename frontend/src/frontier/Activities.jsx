import React, { useState } from "react";
import content from "../../../backend/frontier/content.json";
import PeeperSprite from "../components/PeeperSprite";
import bossArt from "../assets/frontier/leech-king.webp";
import mapArt from "../assets/frontier/marsh-world.webp";
import { Meter, resourceNames, duration } from "./components";
import GestureStage from "./GestureStage";
function MissionEncounter({ mission, now, busy, onCommand, boss }) {
  const [ready] = useState(
    () =>
      !mission.challenge.arcade ||
      mission.nextAt - now >= mission.challenge.arcade.duration / 1000 + 1,
  );
  if (!ready)
    return (
      <div className="journey-breather">
        <span>JOINING THE PARTY</span>
        <h2>Next encounter ahead.</h2>
        <p>
          This encounter is already underway. Your next full round starts in{" "}
          {duration(mission.nextAt - now)}.
        </p>
      </div>
    );
  return (
    <GestureStage
      challenge={mission.challenge}
      disabled={busy}
      boss={boss}
      onComplete={(gesture) =>
        onCommand("action", {
          round: mission.round,
          nonce: mission.challenge.nonce,
          gesture,
        })
      }
    />
  );
}
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
}) {
  const def = content.jobs[job.kind],
    done = job.status !== "active";
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
  const next = nextTask
    ? [
        nextTask.title,
        "Your materials are already in the shared stores. This is the next step needed by the expedition.",
      ]
    : {
        wood: [
          "Make planks at the post",
          "Your timber is in the shared stores. At Crooked Post, turn it into construction planks.",
        ],
        ore: [
          "Help with the bridge",
          "Iron is already in the shared stores. After the bridge opens, it is used for expedition kits and weapons. The bridge needs timber and planks.",
        ],
        planks: [
          "Load a delivery",
          "Your planks are in the shared stores. Load 2 onto a caravan at Crooked Post and deliver them to the construction site.",
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
              <b>+{job.result.xp} experience</b>
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
export function MissionScene({
  mission,
  user,
  peeper,
  now,
  busy,
  onCommand,
  onReturn,
  onOpenChat,
}) {
  const member = mission.members.find((m) => m.user_id === user.id),
    isOwner = mission.owner_id === user.id;
  const done = ["done", "cancelled"].includes(mission.status),
    boss = mission.kind === "boss";
  const openRoles = Object.keys(content.roles).filter(
    (role) => !mission.members.some((m) => m.role === role),
  );
  if (mission.status === "active")
    return (
      <div className="journey-play">
        {mission.totalRounds === 3 && (
          <div className="journey-checkpoints" aria-label="Journey checkpoints">
            {(boss
              ? ["Approach", "Hold the line", "Final push"]
              : ["Outskirts", "Reed trail", "Landing"]
            ).map((name, i) => (
              <span
                key={name}
                className={
                  mission.round === i
                    ? "current"
                    : mission.round > i
                      ? "cleared"
                      : ""
                }
              >
                {mission.round > i ? "✓" : i + 1} · {name}
              </span>
            ))}
          </div>
        )}
        <div className="work-hud">
          <span>
            {boss
              ? "DEFEND THE MARSH"
              : mission.project_id === "mill"
                ? "DELIVERY TO THE FAR MILL"
                : "DELIVERY TO THE WEST LANDING"}
            <b>
              {member
                ? boss
                  ? {
                      driver: "Striker",
                      guard: "Defender",
                      mechanic: "Healer",
                    }[mission.activeRole || member.role]
                  : content.roles[mission.activeRole || member.role].name
                : "Observer"}
            </b>
          </span>
          <span>
            {mission.round + 1} / {mission.totalRounds}
          </span>
          <span className="work-clock">{duration(mission.nextAt - now)}</span>
        </div>
        {member && mission.acted === null ? (
          <MissionEncounter
            key={mission.challenge.nonce}
            mission={mission}
            now={now}
            busy={busy}
            boss={boss}
            onCommand={onCommand}
          />
        ) : (
          <div className="journey-breather">
            <span>{mission.acted ? "ENCOUNTER CLEARED" : "REGROUPING"}</span>
            <h2>
              {mission.acted
                ? "Keep your party together."
                : "Another chance ahead."}
            </h2>
            <p>Next encounter in {duration(mission.nextAt - now)}</p>
            <div className="journey-crew">
              {mission.members.map((m) => (
                <div key={m.user_id}>
                  <PeeperSprite peeper={m} size={100} showDead={false} />
                  <span>{m.name}</span>
                  <small>
                    {m.round_action
                      ? "Ready"
                      : m.round_action === false
                        ? "Missed"
                        : "Working…"}
                  </small>
                </div>
              ))}
            </div>
            <button className="frontier-secondary" onClick={onOpenChat}>
              Talk in Global Chat
            </button>
          </div>
        )}
        <footer className="journey-status">
          <div>
            <span>
              {boss ? "Party resolve" : "Cargo condition"} ·{" "}
              {member?.successes || 0}/{mission.requiredSuccesses} encounters
              cleared
            </span>
            <strong>{mission.health}%</strong>
            <Meter value={mission.health} max={100} label="Party condition" />
          </div>
          <button onClick={onOpenChat}>Chat ↗</button>
        </footer>
      </div>
    );
  return (
    <>
      <div
        className={`frontier-mission-scene ${boss ? "boss" : ""}`}
        style={{ "--work-map": `url(${mapArt})` }}
      >
        {boss ? (
          <img
            className="frontier-boss-art"
            src={bossArt}
            alt="The Leech King, wearing an extremely crooked crown"
          />
        ) : (
          <div className="frontier-cart-scene">
            <div className="frontier-cart-art" />
            <span className="frontier-dust" />
          </div>
        )}
        <div className="frontier-party-sprites">
          {mission.members.map((m) => (
            <div key={m.user_id}>
              <PeeperSprite peeper={m} size={120} showDead={false} />
              <span>{m.name}</span>
              <small>
                {boss
                  ? {
                      driver: "Striker",
                      guard: "Defender",
                      mechanic: "Healer",
                    }[m.role]
                  : content.roles[m.role].name}
                {mission.status === "active" &&
                  (m.round_action == null
                    ? " · lining up"
                    : m.round_action
                      ? " · ready ✓"
                      : " · missed")}
              </small>
            </div>
          ))}
        </div>
        <span className="frontier-scene-label">
          {mission.status === "lobby"
            ? "Gathering at the trailhead"
            : done
              ? "Journey complete"
              : `Trail encounter ${mission.round + 1} / ${mission.totalRounds}`}
        </span>
      </div>
      <div className="frontier-panel-body">
        {!done && (
          <button className="frontier-party-chat" onClick={onOpenChat}>
            Talk in Global Chat ↗
          </button>
        )}
        {mission.status === "lobby" ? (
          <>
            <div className="frontier-between">
              <h3>
                {boss ? "Stand against the King" : "A delivery worth making"}
              </h3>
              <span>{mission.members.length} / 3</span>
            </div>
            <p className="mission-load-summary">
              <b>
                {mission.cargo} {boss ? "field kits" : "planks"} loaded
              </b>
              <span>
                {mission.min_crew > 1
                  ? "Two crewmates must each clear 2 encounters"
                  : "One active player can complete the journey"}
              </span>
            </p>
            <p className="frontier-instruction">
              {boss
                ? "Dodge charges and counterattack, clear spore beetles and brew remedies. Field kits equip the party for the fight."
                : mission.project_id === "mill"
                  ? "Carry construction planks across the restored bridge to the far-bank workshop."
                  : mission.project_id === "bridge"
                    ? "Load planks at Crooked Post and follow the west-bank trail. Unload at the bridge landing; the caravan never crosses the broken bridge."
                    : "Deliver replacement planks along the restored route. Maintenance keeps the workshops and trails running."}{" "}
              {mission.totalRounds} encounters ·{" "}
              {mission.totalRounds * content.mission.roundSeconds} seconds.
              Clear at least {mission.requiredSuccesses} to earn{" "}
              {content.mission.xp} experience.{" "}
              {mission.coinReadyAt <= now
                ? "Your next success also earns 1 coin."
                : "Materials and experience still count while the coin payment is recharging."}
            </p>
            {!member && (
              <div className="frontier-role-list">
                {openRoles.map((r) => (
                  <button
                    disabled={busy}
                    key={r}
                    onClick={() => onCommand("join", { role: r })}
                  >
                    <b>
                      Join as{" "}
                      {boss
                        ? {
                            driver: "Striker",
                            guard: "Defender",
                            mechanic: "Healer",
                          }[r]
                        : content.roles[r].name}
                    </b>
                    <small>
                      {boss
                        ? {
                            driver: "Dodge the charge, then counterattack",
                            guard: "Cut spore beetles; spare lantern bugs",
                            mechanic: "Match herbs to brew field remedies",
                          }[r]
                        : content.roles[r].verb}
                    </small>
                  </button>
                ))}
              </div>
            )}
            {member && (
              <p className="frontier-role-note">
                Your role:{" "}
                <b>
                  {boss
                    ? {
                        driver: "Striker",
                        guard: "Defender",
                        mechanic: "Healer",
                      }[mission.activeRole || member.role]
                    : content.roles[mission.activeRole || member.role].name}
                </b>
                .{" "}
                {mission.members.some((m) => m.arrives_at > now)
                  ? "Your party is walking to the meeting point. "
                  : ""}
                {openRoles.length
                  ? mission.members.length < mission.min_crew
                    ? "This wagon needs another active crewmate. Invite someone from Global Chat."
                    : mission.members.length === 1
                      ? "Going solo? You will drive, defend and repair in turn. Invite friends to share the roles."
                      : "A smaller party can still depart. Misses do less damage when others help."
                  : "Everyone is here."}
              </p>
            )}
            {isOwner && (
              <>
                <button
                  className="frontier-primary"
                  disabled={
                    busy ||
                    mission.members.length < mission.min_crew ||
                    mission.members.some((m) => m.arrives_at > now)
                  }
                  onClick={() => onCommand("depart")}
                >
                  {mission.members.length < mission.min_crew
                    ? "Waiting for a second crewmate…"
                    : mission.members.some((m) => m.arrives_at > now)
                      ? "Waiting for the party…"
                      : `Set off ${mission.members.length === 1 ? "solo" : "together"} · ${mission.totalRounds * content.mission.roundSeconds}s`}
                </button>
                <button
                  className="frontier-secondary"
                  disabled={busy}
                  onClick={() => onCommand("recruit")}
                >
                  Invite players in Global Chat
                </button>
              </>
            )}
            {member && (
              <button
                className="frontier-text-button"
                disabled={busy}
                onClick={() => onCommand("leave")}
              >
                {isOwner
                  ? boss
                    ? "Cancel patrol & return field kits"
                    : "Cancel departure & return cargo"
                  : "Leave party"}
              </button>
            )}
            <p className="frontier-fine">
              Departure closes in{" "}
              {duration(
                mission.created_at + content.mission.lobbySeconds - now,
              )}
              . Reserved cargo is returned if cancelled.
            </p>
          </>
        ) : done ? (
          <div className="frontier-result" role="status">
            <h3>
              {mission.result?.passed
                ? boss
                  ? "The marsh fights back"
                  : "Cargo delivered!"
                : "Back at the trailhead"}
            </h3>
            <p>
              {mission.result?.passed
                ? mission.result.eligible.includes(user.id)
                  ? `Your contribution earned ${mission.result.xp} experience${(mission.result.payments?.[user.id] ?? mission.result.coins) ? ` and ${mission.result.payments?.[user.id] ?? mission.result.coins} coin` : ". Your coin payment was still recharging"}.`
                  : `The party completed its journey. ${mission.requiredSuccesses} successful encounters are needed for an individual reward.`
                : mission.result?.reason ||
                  "The journey failed. Reserved supplies were recovered. Your own coins are safe."}
            </p>
            {!boss && mission.result?.delivered > 0 && (
              <p className="delivery-contribution">
                +{mission.result.delivered} planks built into{" "}
                {mission.project_id === "mill" ? "the Far Mill" : "the bridge"}.
                Everyone keeps this progress.
              </p>
            )}
            {boss && mission.result?.damage > 0 && (
              <p>{mission.result.damage} contribution against the world boss</p>
            )}
            <button className="frontier-primary" onClick={onReturn}>
              Return to the commons
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
