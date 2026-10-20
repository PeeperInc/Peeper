import React, { useEffect, useState } from "react";
import { frontierEvent } from "../api";
import WorldIcon from "./WorldIcon";
import "./FrontierEventCard.css";

function BridgeEmblem() {
  return (
    <svg className="frontier-event-bridge" viewBox="0 0 48 48" fill="none">
      <path className="event-water" d="M5 31 29 10l14 7-24 22Z" />
      <path
        className="event-bank"
        d="m4 17 10-7 8 4-10 8Zm23 19 9-8 9 5-10 8Z"
      />
      <path className="event-deck" d="m11 19 7-6 21 15-7 6Z" />
      <path
        className="event-planks"
        d="m16 16 21 15m-15-9-4 4m9 0-4 4m-5-12-4 4"
      />
      <path className="event-rail" d="M11 19v-7l21 15v7M18 13V6l21 15v7" />
      <path className="event-ripple" d="m8 29 4-3m17-9 4-3m-8 24 4-3" />
    </svg>
  );
}

export default function FrontierEventCard({ active, onOpen }) {
  const [event, setEvent] = useState(null);
  useEffect(() => {
    if (!active) return;
    let closed = false,
      loading = false;
    async function refresh() {
      if (document.hidden || loading) return;
      loading = true;
      try {
        const summary = await frontierEvent();
        if (!closed) setEvent(summary);
      } catch {
        // The entry stays usable when a summary refresh is temporarily offline.
      } finally {
        loading = false;
      }
    }
    refresh();
    const timer = setInterval(refresh, 30000);
    const visible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      closed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [active]);
  useEffect(() => {
    if (event?.phase !== "results") return;
    const timer = setTimeout(
      () => setEvent({ active: false }),
      Math.max(0, (event.endsAt - event.serverTime) * 1000),
    );
    return () => clearTimeout(timer);
  }, [event?.phase, event?.endsAt, event?.serverTime]);
  if (event?.active === false) return null;
  let detail = "Open the shared journey",
    caption = detail,
    value = null,
    progress = null,
    icon = "map";
  if (event?.phase === "bridge") {
    caption = "Rebuild the crossing";
    value = `${event.progress}/${event.target} planks`;
    detail = `${caption} · ${value}`;
    progress = event.progress / Math.max(1, event.target);
    icon = "planks";
  } else if (event?.phase === "preparing") {
    detail = `Kits ${event.kits}/${event.kitsTarget} · Weapons ${event.weapons}/${event.weaponsTarget}`;
    caption = detail;
    progress =
      (event.kits + event.weapons) /
      Math.max(1, event.kitsTarget + event.weaponsTarget);
    icon = "supplies";
  } else if (event?.phase === "battle") {
    caption = "Shared battle";
    value = `${event.hp.toLocaleString()} HP`;
    detail = `${caption} · ${value}`;
    progress = event.hp / Math.max(1, event.maxHp);
    icon = "boss";
  } else if (event?.phase === "results") {
    const hours = Math.max(
      0,
      Math.ceil((event.endsAt - event.serverTime) / 3600),
    );
    caption = "View your results";
    value = `${hours}h left`;
    detail = `${caption} ${value}`;
    icon = "orders";
  }
  return (
    <button
      type="button"
      className={`frontier-event-card ${event?.phase || "loading"}`}
      onClick={onOpen}
      aria-label={`${event?.name || "Beyond the Fog"}. ${detail}. Open event`}
    >
      <span className="frontier-event-art" aria-hidden="true">
        {event?.phase === "bridge" ? (
          <BridgeEmblem />
        ) : (
          <WorldIcon name={icon} size={34} />
        )}
      </span>
      <span className="frontier-event-copy">
        <span className="frontier-event-heading">
          <b>{event?.name || "Beyond the Fog"}</b>
          <small>{event?.phase === "results" ? "RESULTS" : "EVENT"}</small>
        </span>
        <span className="frontier-event-detail">
          <span>{caption}</span>
          {value && <strong>{value}</strong>}
        </span>
        {progress !== null && (
          <span className="frontier-event-track" aria-hidden="true">
            <i
              style={{
                width: `${Math.min(100, Math.max(0, progress * 100))}%`,
              }}
            />
          </span>
        )}
      </span>
      <span className="frontier-event-arrow" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <path d="m6 4 4 4-4 4" />
        </svg>
      </span>
    </button>
  );
}
