import React from "react";
import content from "../../../backend/frontier/content.json";
import PeeperSprite from "../components/PeeperSprite";
import GestureStage from "./GestureStage";
import { Meter, duration } from "./components";
import { DeliveryBonus } from "./DeliverySetup";
export default function MissionScene({
  mission: m,
  user,
  now,
  busy,
  onCommand,
  onReturn,
  onOpenChat,
}) {
  const member = m.members.find((p) => p.user_id === user.id),
    owner = m.owner_id === user.id;
  const done = ["done", "cancelled"].includes(m.status),
    n = m.members.length;
  const openRoles = Object.keys(content.roles).filter(
    (r) => !m.members.some((p) => p.role === r),
  );
  const pendingArrival = m.members.some((p) => p.arrives_at > now);
  const tasks = member?.tasks || m.yourTasks || [];
  if (m.status === "active")
    return (
      <div className="journey-play">
        <div className="work-hud">
          <span>
            DELIVER {m.cargo} PLANKS
            <b>
              {m.activeRole
                ? content.roles[m.activeRole].name
                : member
                  ? "Your tasks are complete"
                  : "Watching the crew"}
            </b>
          </span>
          <span>
            Stage {m.round + 1}/{m.totalRounds}
          </span>
          <span className="work-clock">{duration(m.nextAt - now)}</span>
        </div>
        {member && m.challenge && m.acted === null ? (
          <GestureStage
            key={m.challenge.nonce}
            challenge={m.challenge}
            disabled={busy}
            onComplete={(gesture) =>
              onCommand("action", {
                round: m.round,
                nonce: m.challenge.nonce,
                gesture,
              })
            }
          />
        ) : (
          <div className="journey-breather">
            <span>TEAM DELIVERY</span>
            <h2>{m.acted === false ? "Task missed" : "Your part is done"}</h2>
            <p>
              {n > 1
                ? "Waiting for your teammates to finish."
                : "Saving the delivery…"}
            </p>
            <div className="journey-crew">
              {m.members.map((p) => (
                <div key={p.user_id}>
                  <PeeperSprite peeper={p} size={68} showDead={false} />
                  <span>{p.name}</span>
                  <small>
                    {!p.active_role || p.round_action === true
                      ? "Done ✓"
                      : p.round_action === false
                        ? "Missed"
                        : `${content.roles[p.active_role || p.role].name}…`}
                  </small>
                </div>
              ))}
            </div>
          </div>
        )}
        <footer className="journey-status">
          <div>
            <span>
              Your tasks: {member?.successes || 0}/
              {tasks.length || m.totalRounds} cleared
            </span>
            <strong>{m.health}% cargo</strong>
            <Meter value={m.health} max={100} label="Cargo condition" />
          </div>
          <button onClick={onOpenChat}>Chat ↗</button>
        </footer>
      </div>
    );
  if (done)
    return (
      <div className="frontier-panel-body delivery-receipt" role="status">
        <span className="plan-eyebrow">
          {m.result?.passed ? "DELIVERY COMPLETE" : "PLANKS RETURNED"}
        </span>
        <h2>
          {m.result?.passed
            ? m.result.delivered
              ? `+${m.result.delivered} planks to the bridge`
              : "Route maintained"
            : "Back at the post"}
        </h2>
        {m.result?.passed ? (
          <>
            <div className="delivery-receipt-numbers">
              <span>
                Shared planks used<b>{m.result.spent ?? m.cargo}</b>
              </span>
              <span>
                Team bonus<b>+{m.result.bonus || 0}</b>
              </span>
            </div>
            <p>
              {m.result.payments?.[user.id]
                ? `+${m.result.payments[user.id]} coin for you.`
                : "Your completed tasks are saved."}
            </p>
          </>
        ) : (
          <p>
            {m.result?.reason ||
              "Delivery cancelled. Reserved planks returned."}
          </p>
        )}
        <button className="frontier-primary" onClick={onReturn}>
          Return to map
        </button>
      </div>
    );
  return (
    <div className="frontier-panel-body delivery-lobby">
      <span className="plan-eyebrow">DELIVERY CREW · {n}/3 PLAYERS</span>
      <h2>{m.plannedCargo ?? m.cargo} planks on arrival</h2>
      {m.delivery_version ? (
        <>
          <DeliveryBonus count={n} />
          <p>
            <b>{m.reservedPlanks} planks reserved</b> · 2 from shared stores per
            player.
          </p>
        </>
      ) : (
        <p>{m.cargo} planks loaded. This delivery uses the previous rules.</p>
      )}
      {owner && (
        <button
          className="frontier-primary"
          disabled={busy || n < m.min_crew || pendingArrival}
          onClick={() => onCommand("depart")}
        >
          {n < m.min_crew
            ? "Waiting for a second player"
            : pendingArrival
              ? "Waiting for arrivals"
              : `Depart · deliver ${m.plannedCargo ?? m.cargo} planks`}
        </button>
      )}
      <div className="delivery-crew-list">
        {m.members.map((p) => (
          <div key={p.user_id}>
            <PeeperSprite peeper={p} size={54} showDead={false} />
            <span>
              <b>
                {p.name}
                {p.user_id === user.id ? " · you" : ""}
              </b>
              <small>
                {(p.tasks || [p.role])
                  .map((r) => content.roles[r].name)
                  .join(" + ")}
                {p.arrives_at > now
                  ? ` · arrives in ${duration(p.arrives_at - now)}`
                  : ""}
              </small>
            </span>
            <i>2 planks</i>
          </div>
        ))}
      </div>
      <p className="delivery-task-rule">
        {n === 1
          ? "Solo: clear 2 of 3 tasks. Invite friends to split the work."
          : "Everyone must clear a task. Three tasks total; the organiser takes the extra one with a crew of two."}
      </p>
      {!member && (
        <div className="frontier-role-list">
          {openRoles.map((r) => (
            <button
              disabled={busy}
              key={r}
              onClick={() => onCommand("join", { role: r })}
            >
              <b>Join as {content.roles[r].name} · reserve 2 planks</b>
              <small>{content.roles[r].verb}</small>
            </button>
          ))}
        </div>
      )}
      {owner && (
        <>
          {n < 3 && (
            <button
              className="frontier-secondary"
              disabled={busy}
              onClick={() => onCommand("recruit")}
            >
              Invite players in Global Chat
            </button>
          )}
        </>
      )}
      {!owner && member && <p>The organiser starts the delivery.</p>}
      {member && (
        <button
          className="frontier-text-button"
          disabled={busy}
          onClick={() => onCommand("leave")}
        >
          {owner
            ? "Cancel delivery · return reserved planks"
            : "Leave crew · return 2 planks"}
        </button>
      )}
      <button className="frontier-text-button" onClick={onOpenChat}>
        Open chat →
      </button>
      <small>
        Lobby closes in{" "}
        {duration(m.created_at + content.mission.lobbySeconds - now)}. Failed
        deliveries return the reserved planks.
      </small>
    </div>
  );
}
