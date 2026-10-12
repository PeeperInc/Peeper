import React from "react";
import content from "../../../backend/frontier/content.json";
import WorldIcon from "./WorldIcon";

export default function DeliverySetup({ state, role, onRole, onCreate, busy }) {
  const site = content.projects.find(
    (p) => !state.projects.find((v) => v.id === p.id)?.completed_at,
  );
  return (
    <div className="delivery-setup">
      <span className="plan-eyebrow">
        CROOKED POST → {site?.name.toUpperCase() || "TRAIL MAINTENANCE"}
      </span>
      <h2>Choose your load</h2>
      <p>
        {state.stock.planks} planks in the community stores. Cargo is reserved
        when you create a party and returned if the trip fails or is cancelled.
      </p>
      <div className="delivery-loads">
        {[
          {
            id: "cart",
            n: 2,
            title: "Handcart",
            crew: "Solo or with friends",
            desc: "Go now. On your own, drive, defend and repair in turn.",
          },
          {
            id: "wagon",
            n: 6,
            title: "Crew wagon",
            crew: "2–3 active players",
            desc: "Move three times the cargo in one trip. At least two crewmates must clear 2 encounters each.",
          },
        ].map((load) => (
          <article key={load.id}>
            <WorldIcon name="cart" size={42} />
            <div>
              <h3>{load.title}</h3>
              <b>{load.n} planks · 45 seconds</b>
              <small>{load.crew}</small>
              <p>{load.desc}</p>
            </div>
            <button
              className="frontier-primary"
              disabled={busy || state.stock.planks < load.n}
              onClick={() => onCreate(load.id)}
            >
              {state.stock.planks < load.n
                ? `Need ${load.n - state.stock.planks} more planks`
                : `Load ${load.n} planks →`}
            </button>
          </article>
        ))}
      </div>
      <h3>Your role with a crew</h3>
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
    </div>
  );
}
