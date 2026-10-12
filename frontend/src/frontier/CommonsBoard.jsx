import React, { useState } from "react";
import WorldIcon from "./WorldIcon";
export default function CommonsBoard({ commons, now, onChoose, onChat }) {
  const [selected, setSelected] = useState(0),
    tile = commons.tiles[selected];
  const left = commons.ends_at ? Math.max(0, commons.ends_at - now) : null;
  return (
    <div className="commons-board">
      <div className="commons-intro">
        <span>
          Season {commons.season} · Week {commons.week}
        </span>
        <h3>A little from each of us.</h3>
        <p>
          Finish a row, column or diagonal together. Each line earns a commons
          seal, up to three this week.
        </p>
      </div>
      <div className="commons-weather">
        <WorldIcon name={commons.weather.symbol} />
        <div>
          <b>{commons.weather.name}</b>
          <span>{commons.weather.hint}</span>
        </div>
      </div>
      <div className="commons-grid" aria-label="Weekly community orders">
        {commons.tiles.map((t, i) => (
          <button
            key={`${commons.period}:${i}`}
            className={`${i === selected ? "selected" : ""} ${t.progress >= t.target ? "complete" : ""}`}
            aria-pressed={i === selected}
            onClick={() => setSelected(i)}
          >
            <WorldIcon name={t.icon} size={40} />
            <strong>{t.name}</strong>
            <span>
              {t.progress} / {t.target}
            </span>
            <i>
              <em
                style={{
                  transform: `scaleX(${Math.min(1, t.progress / t.target)})`,
                }}
              />
            </i>
            {t.progress >= t.target && <small>✓</small>}
          </button>
        ))}
      </div>
      <section className="commons-detail">
        <div>
          <b>{tile.name}</b>
          <p>{tile.hint}. Each contributor's completed activity counts.</p>
        </div>
        <button
          className="frontier-primary"
          onClick={() => onChoose(tile.location)}
        >
          Show on map →
        </button>
      </section>
      <footer className="commons-footer">
        <div>
          <b>{commons.points} contributions from you</b>
          <span>
            {commons.points < commons.minimumContributions
              ? `${commons.minimumContributions - commons.points} more to qualify for this week's seals`
              : `${commons.seals} / 3 seals earned · 10 experience per seal`}
          </span>
        </div>
        <span>
          {left === null
            ? "Starts with the first order"
            : `${Math.ceil(left / 86400)} days left`}
        </span>
      </footer>
      <p className="commons-fine">
        {commons.contributors} people contributing · {commons.lines} lines
        completed. New orders next week. Your buildings and earned seals stay.
      </p>
      {onChat && (
        <button className="commons-chat" onClick={onChat}>
          <WorldIcon name="chat" size={24} />
          Coordinate in Global Chat →
        </button>
      )}
    </div>
  );
}
