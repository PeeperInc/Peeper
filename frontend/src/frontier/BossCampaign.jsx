import React from "react";
import dragon from "../assets/frontier/marsh-dragon.png";
import { Meter, resourceNames } from "./components";
import WorldIcon from "./WorldIcon";
import ArcadeStage from "./ArcadeStage";
export function BossCampaign({ state, busy, onPrepare, onGo, onAttack, now }) {
  const b = state.boss,
    resultsMinutes = Math.max(0, Math.ceil((b.results_until - now) / 60)),
    atPool = state.player.location === "pool" && !state.player.travel;
  return (
    <div className="boss-campaign">
      <div className="dragon-portrait">
        <img src={dragon} alt="Mirewake, the marsh dragon" />
        <span>WORLD BOSS · EXPEDITION {b.cycle}</span>
      </div>
      <div className="boss-campaign-body">
        <span className="plan-eyebrow">
          {b.phase === "preparing"
            ? "EQUIP THE EXPEDITION"
            : b.phase === "open"
              ? "THE BATTLE IS OPEN TO EVERYONE"
              : "VICTORY · REWARDS PAID"}
        </span>
        <h2>{b.name}</h2>
        {b.phase === "preparing" ? (
          <>
            <p>
              Fill both reserves to unlock the battle for everyone. Attacks are
              free after that.
            </p>
            <div className="siege-reserves">
              {["supplies", "weapons"].map((item) => {
                const remaining = b[item + "_required"] - b[item + "_filled"],
                  amount = Math.min(state.stock[item], remaining);
                return (
                  <article key={item}>
                    <WorldIcon name={item} size={34} />
                    <div>
                      <h3>{resourceNames[item]}</h3>
                      <Meter
                        value={b[item + "_filled"]}
                        max={b[item + "_required"]}
                        label={resourceNames[item]}
                      />
                      <b>
                        {b[item + "_filled"]} / {b[item + "_required"]}
                      </b>
                      <small>{state.stock[item]} in shared stores</small>
                    </div>
                    <button
                      className="frontier-primary"
                      disabled={busy || !amount}
                      onClick={() => onPrepare(item, amount)}
                    >
                      {remaining === 0
                        ? "Reserve filled"
                        : amount
                          ? `Contribute ${amount}`
                          : "Nothing in stores yet"}
                    </button>
                    <button
                      className="frontier-text-button"
                      onClick={() =>
                        onGo(item === "supplies" ? "mill" : "workshop")
                      }
                    >
                      Go to {item === "supplies" ? "Supply Mill" : "Armory"} →
                    </button>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="dragon-health">
              <b>
                {b.hp.toLocaleString()} / {b.max_hp.toLocaleString()} HP
              </b>
              <Meter value={b.hp} max={b.max_hp} label="Dragon health" />
            </div>
            <div className="siege-personal">
              <span>
                Your journey actions
                <strong>{(b.actions ?? 0).toLocaleString()}</strong>
              </span>
              <span>
                {b.phase === "defeated" ? "Coins paid to you" : "Your damage"}
                <strong>
                  {b.phase === "defeated"
                    ? (b.payout ?? 0)
                    : (b.contribution ?? 0).toLocaleString()}
                  {b.phase === "defeated" ? " ✦" : ""}
                </strong>
              </span>
            </div>
            {b.phase === "open" ? (
              <>
                <p>
                  Tap to combo. Swipe sideways to dodge. A last-moment dodge
                  opens a powerful counter. Getting hit stuns you for 10
                  seconds.
                </p>
                <button
                  className="frontier-primary"
                  disabled={
                    busy || !!(state.job || state.mission || state.assault)
                  }
                  onClick={atPool ? onAttack : () => onGo("pool")}
                >
                  {atPool
                    ? "Join the battle"
                    : "Follow the trail to Mirewake →"}
                </button>
              </>
            ) : (
              <p>
                Rewards are paid, including to offline contributors. Results
                close in{" "}
                {resultsMinutes >= 60
                  ? `${Math.floor(resultsMinutes / 60)}h ${resultsMinutes % 60}m`
                  : `${resultsMinutes}m`}
                .
              </p>
            )}
          </>
        )}
        {b.leaders.length > 0 && (
          <div className="siege-leaders">
            <h3>
              {b.contributors}{" "}
              {b.contributors === 1 ? "contributor" : "contributors"}
            </h3>
            {b.leaders.map((p, i) => (
              <div key={p.user_id}>
                <span>
                  {i + 1}. {p.name}
                </span>
                <b>{(p.actions ?? 0).toLocaleString()} actions</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
export function AssaultScene({
  attempt,
  boss,
  busy,
  onAct,
  onAgain,
  onCancel,
  onReturn,
}) {
  const done = attempt.status !== "active";
  return (
    <div className="assault-scene">
      <div className="work-hud">
        <span>
          <b>MIREWAKE · EXPEDITION {attempt.cycle}</b>
          {boss
            ? `${boss.hp.toLocaleString()} shared HP remaining`
            : "Damage is saved after each attempt"}
        </span>
        <span>{boss?.contribution || 0} damage by you</span>
      </div>
      {done ? (
        <div className="assault-receipt">
          <div className="assault-receipt-art">
            <img src={dragon} alt="" />
            <span>
              {attempt.result?.killed
                ? "MIREWAKE HAS FALLEN"
                : "THE SHARED BATTLE"}
            </span>
          </div>
          <div className="assault-receipt-body">
            <span>
              {attempt.result?.damage ? "DAMAGE SAVED" : "ATTEMPT COMPLETE"}
            </span>
            <h2>
              {attempt.result?.damage
                ? `−${attempt.result.damage} dragon HP`
                : "Regroup and try again"}
            </h2>
            {attempt.result?.damage > 0 && (
              <div className="assault-receipt-stats">
                <span>
                  Round quality<b>{attempt.result.quality}%</b>
                </span>
                <span>
                  Your expedition damage
                  <b>{boss?.contribution || attempt.result.damage}</b>
                </span>
              </div>
            )}
            <p>
              {attempt.result?.reason ||
                "Your damage stays with this expedition. Coins are paid when the dragon falls."}
            </p>
            {boss?.phase === "open" && (
              <button
                className="frontier-primary"
                disabled={busy}
                onClick={onAgain}
              >
                Attack again · free
              </button>
            )}
            <button className="frontier-secondary" onClick={onReturn}>
              View the shared battle
            </button>
          </div>
        </div>
      ) : (
        <>
          <ArcadeStage
            challenge={attempt.challenge}
            disabled={busy}
            onComplete={(g) =>
              onAct({ nonce: attempt.challenge.nonce, gesture: g })
            }
          />
          <button
            className="frontier-text-button"
            disabled={busy}
            onClick={onCancel}
          >
            End this attempt · earlier damage is safe
          </button>
        </>
      )}
    </div>
  );
}
