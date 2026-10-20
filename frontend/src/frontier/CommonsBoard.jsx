import React, { useState } from "react";
import WorldIcon from "./WorldIcon";
export default function CommonsBoard({ commons: q, onChoose, onChat }) {
  const [selected, setSelected] = useState(-1);
  return (
    <div className="commons-board quest-board">
      <div className="commons-intro">
        <span>JOURNEY {q.cycle} · PERSONAL QUESTS</span>
        <h3>
          {q.completed} / {q.total} quests complete
        </h3>
        <p>
          Finish any 3 quests: +100 coins. Reach 6 and 9 for another 100 each.
        </p>
      </div>
      <div className="quest-milestones" aria-label="Quest rewards">
        {q.milestones.map((m) => (
          <div key={m.at} className={m.paid ? "paid" : ""}>
            <span>{m.at} quests</span>
            <b>{m.paid ? "✓ Paid" : `+${m.coins} ✦`}</b>
            <i>
              <em
                style={{
                  width: `${Math.min(100, (q.completed / m.at) * 100)}%`,
                }}
              />
            </i>
          </div>
        ))}
      </div>
      <p className="quest-rule">
        {q.paidStages * q.rewardCoins} / {q.maxCoins} reward coins received.
        Complete the cards in any order.
      </p>
      {q.legacyCredit > 0 && (
        <p className="commons-fine">
          Earlier task rewards count toward this journey’s reward cap.
        </p>
      )}
      <div className="quest-list" aria-label="Your journey quests">
        {q.tiles.map((t, i) => (
          <React.Fragment key={`${q.cycle}:${t.kind}`}>
            <button
              aria-pressed={selected === i}
              className={`${selected === i ? "selected" : ""} ${t.progress >= t.target ? "complete" : ""}`}
              aria-expanded={selected === i}
              onClick={() => setSelected(selected === i ? -1 : i)}
            >
              <WorldIcon name={t.icon} size={30} />
              <span>
                <b>{t.name}</b>
                <small>
                  {t.progress} / {t.target}
                  {t.progress >= t.target ? " · Complete ✓" : ""}
                </small>
                <i>
                  <em
                    style={{
                      width: `${Math.min(100, (t.progress / t.target) * 100)}%`,
                    }}
                  />
                </i>
              </span>
            </button>
            {selected === i && (
              <section className="commons-detail quest-inline">
                <p>{t.hint}.</p>
                <button
                  className="frontier-primary"
                  onClick={() => onChoose(t.location)}
                >
                  Show location →
                </button>
              </section>
            )}
          </React.Fragment>
        ))}
      </div>
      <p className="commons-fine">
        {q.closed
          ? "Journey complete. New quests next journey."
          : "Quests last the whole journey. Only your own actions count."}
      </p>
      {onChat && (
        <button className="commons-chat" onClick={onChat}>
          <WorldIcon name="chat" size={22} /> Find delivery teammates →
        </button>
      )}
    </div>
  );
}
