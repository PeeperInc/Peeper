import React from "react";
import content from "../../../backend/frontier/content.json";
import WorldIcon from "./WorldIcon";
export function DeliveryBonus({ count }) {
  return (
    <div className="delivery-bonus" aria-label="Team delivery bonuses">
      {[1, 2, 3].map((n) => (
        <div className={n === count ? "chosen" : ""} key={n}>
          <span>{n === 1 ? "Solo" : `${n} players`}</span>
          <b>
            {n * 2} → {content.mission.deliveryYield[n]}
          </b>
          <small>
            {n === 1
              ? "3 tasks"
              : n === 2
                ? "+2 bonus planks"
                : "+4 bonus planks"}
          </small>
        </div>
      ))}
    </div>
  );
}
export default function DeliverySetup({ state, role, onRole, onCreate, busy }) {
  const site = content.projects.find(
    (p) => !state.projects.find((v) => v.id === p.id)?.completed_at,
  );
  return (
    <div className="delivery-setup">
      <span className="plan-eyebrow">
        {site ? `TO ${site.name.toUpperCase()}` : "TRAIL MAINTENANCE"}
      </span>
      <h2>More players. More planks.</h2>
      <DeliveryBonus />
      <p>
        <b>2 planks per player from shared stores.</b> Team bonus is added on
        arrival. Everyone must clear a task.
      </p>
      <div className="delivery-loads">
        {[
          {
            id: "wagon",
            title: "Gather a crew",
            desc: "2–3 players share 3 tasks. With two, the organiser takes the extra task.",
          },
          {
            id: "cart",
            title: "Go solo",
            desc: "Drive, protect and repair. You can still invite friends.",
          },
        ].map((load) => (
          <article key={load.id}>
            <WorldIcon name="cart" size={32} />
            <div>
              <h3>{load.title}</h3>
              <p>{load.desc}</p>
            </div>
            <button
              className="frontier-primary"
              disabled={busy || state.stock.planks < 2}
              onClick={() => onCreate(load.id)}
            >
              {state.stock.planks < 2
                ? "Need 2 shared planks"
                : load.id === "cart"
                  ? "Reserve 2 & create"
                  : "Create team · reserve 2"}
            </button>
          </article>
        ))}
      </div>
      <h3>Your first task with a crew</h3>
      <div className="dispatch-roles">
        {Object.entries(content.roles).map(([id, value]) => (
          <button
            key={id}
            aria-pressed={role === id}
            onClick={() => onRole(id)}
          >
            <WorldIcon name={value.symbol} size={23} />
            <b>{value.name}</b>
          </button>
        ))}
      </div>
      <p className="dispatch-role-hint">{content.roles[role].verb}</p>
      <small>
        {state.stock.planks} planks in shared stores. Leaving before departure
        returns your 2.
      </small>
    </div>
  );
}
