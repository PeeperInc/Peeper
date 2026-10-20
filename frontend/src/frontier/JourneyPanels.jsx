import React from "react";
import WorldIcon from "./WorldIcon";
import { DeliveryBonus } from "./DeliverySetup";
export function JourneyGuide({ state }) {
  return (
    <div className="frontier-panel-body journey-guide">
      <span className="plan-eyebrow">
        ONE SHARED JOURNEY · NO WEEKLY DEADLINE
      </span>
      <h2>
        {state?.boss ? "Build. Prepare. Fight." : "Rebuild the crossing."}
      </h2>
      <div className="guide-step">
        <WorldIcon name="wood" size={32} />
        <div>
          <h3>Gather materials</h3>
          <p>
            Timber at Mosswood Mill. Iron at Pebble Quarry. Everything goes into
            shared stores.
          </p>
        </div>
      </div>
      <div className="guide-step">
        <WorldIcon name="planks" size={32} />
        <div>
          <h3>Make planks at Crooked Post</h3>
          <p>
            1 game makes 1 plank: 3 timber + 1 iron. Keep crafting while
            materials remain.
          </p>
        </div>
      </div>
      <div className="guide-step">
        <WorldIcon name="cart" size={32} />
        <div>
          <h3>Deliver to the bridge</h3>
          <p>
            Reserve 2 planks per player. Split three tasks: drive, protect,
            repair. Teams get bonus planks on arrival.
          </p>
        </div>
      </div>
      <DeliveryBonus />
      {state?.boss && (
        <div className="guide-step">
          <WorldIcon name="boss" size={32} />
          <div>
            <h3>Prepare, then fight together</h3>
            <p>
              Fill the kit and weapon reserves to unlock the shared battle.
              Every hit reduces the same health bar. Victory pays the journey
              rewards. Results stay available for 24 hours, then the event ends.
            </p>
          </div>
        </div>
      )}
      <details>
        <summary>Coins and rewards</summary>
        <p>
          Each timber or iron extraction earns 1 coin immediately. Crafting and
          deliveries earn at most 1 coin every 3 minutes.
        </p>
        <p>
          Complete any 3 quests for 100 coins, then 3 more for another 100. All
          9 quests earn 300 coins in total.
        </p>
      </details>
      <details>
        <summary>Leaving or losing connection</summary>
        <p>
          Reopen your current activity to continue. Failed deliveries and
          unfinished recipes return their reserved materials. Gathered pieces
          stay in shared stores.
        </p>
      </details>
    </div>
  );
}
export function JourneyProgress({ state, onPanel }) {
  const b = state.boss,
    victory = b?.phase === "defeated";
  return (
    <div className="frontier-panel-body journey-progress">
      <span className="plan-eyebrow">JOURNEY {state.journey?.cycle || 1}</span>
      <h2>{victory ? "Your journey reward" : "Your contribution"}</h2>
      <div className="journey-score">
        <strong>
          {victory
            ? `${(b.payout ?? 0).toLocaleString()} ✦`
            : (state.journey?.actions ?? b?.actions ?? 0).toLocaleString()}
        </strong>
        <span>{victory ? "coins paid to you" : "completed actions"}</span>
      </div>
      {victory && <p>Paid automatically. Results are available for 24 hours.</p>}
      {b && !victory && (
        <p className="progress-share">
          Your damage: {(b.contribution ?? 0).toLocaleString()}.
        </p>
      )}
      <button className="journey-menu-link" onClick={() => onPanel("orders")}>
        <WorldIcon name="orders" size={28} />
        <span>
          <b>Your quests</b>
          <small>
            {state.commons?.points || 0} completed activities · rewards at 3, 6
            and 9 quests
          </small>
        </span>
        <i>→</i>
      </button>
      <button className="journey-menu-link" onClick={() => onPanel("guide")}>
        <WorldIcon name="map" size={28} />
        <span>
          <b>How to play</b>
          <small>Recipes and deliveries</small>
        </span>
        <i>→</i>
      </button>
      {state.history.some(
        (h) => h.coins > 0 && (victory || !h.ref.startsWith("dragon:")),
      ) && (
        <>
          <h3>Recent coins</h3>
          {state.history
            .filter(
              (h) => h.coins > 0 && (victory || !h.ref.startsWith("dragon:")),
            )
            .map((h) => (
              <div className="frontier-journal-entry" key={h.ref}>
                <span>{h.reason}</span>
                <b>+{h.coins} ✦</b>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
