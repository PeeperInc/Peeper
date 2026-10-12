import React, { useState } from "react";
import content from "../../../backend/frontier/content.json";
import GameWorld from "./GameWorld";
import WorldIcon from "./WorldIcon";
import { nextContribution } from "./ConstructionPlan";
import { Meter, resourceNames, duration } from "./components";
export default function WorldHud({
  state,
  selected,
  onSelect,
  onTravel,
  user,
  peeper,
  players,
  connected,
  busy,
  now,
  error,
  onClose,
  onPanel,
  onWork,
  onMission,
  onResume,
}) {
  const [places, setPlaces] = useState(false),
    [recipes, setRecipes] = useState(false);
  const built = (id) => state.projects.find((p) => p.id === id)?.completed_at;
  const place =
      content.locations.find((p) => p.id === selected) || content.locations[0],
    location = state.player.location || "village",
    trip = state.player.travel,
    here = selected === location && !trip;
  const project = content.projects.find((p) => !built(p.id)),
    progress = state.projects.find((p) => p.id === project?.id)?.progress || 0,
    commitment = state.job || state.mission || state.assault;
  const jobs = Object.entries(content.jobs).filter(
    ([, j]) =>
      (j.location === selected ||
        (selected === "mill" && built("bridge") && j.location === "village")) &&
      (!j.requires || built(j.requires)),
  );
  const objective = project
    ? "Reopen the crossing"
    : state.boss?.phase === "preparing"
      ? "Equip the expedition"
      : state.boss?.phase === "open"
        ? "Bring down Mirewake"
        : "The dragon has fallen";
  const next = nextContribution(state),
    stageSize = project ? project.target / 4 : 1,
    stageIndex = Math.min(3, Math.floor(progress / stageSize));
  const choose = (id) => {
    onSelect(id);
    setPlaces(false);
    setRecipes(false);
  };
  const go = (id = selected) => {
    onSelect(id);
    onTravel(id);
    setPlaces(false);
    setRecipes(false);
  };
  const jobButton = ([kind, job]) => {
    const missing = Object.entries(job.inputs).find(
      ([r, n]) => state.stock[r] < n,
    );
    return (
      <button
        className="hud-recipe"
        key={kind}
        onClick={() =>
          missing
            ? go(missing[0] === "ore" ? "quarry" : "sawmill")
            : onWork(kind)
        }
        disabled={busy || !!commitment}
      >
        <span>
          <b>
            {missing
              ? `Gather ${resourceNames[missing[0]].toLowerCase()}`
              : job.name}
          </b>
          <small>
            {missing
              ? `Need ${missing[1]} ${resourceNames[missing[0]].toLowerCase()}`
              : Object.entries(job.inputs)
                  .map(([r, n]) => `${n} ${resourceNames[r].toLowerCase()}`)
                  .join(" + ") || "3 good rounds → 3 shared materials"}
          </small>
        </span>
        <i>↗</i>
      </button>
    );
  };
  return (
    <div className="marsh-game strategy-hud">
      <GameWorld
        selected={selected}
        onSelect={choose}
        players={players}
        user={user}
        peeper={peeper}
        projects={state.projects}
        equipped={state.player.equipped}
        location={location}
        travel={trip}
        serverTime={state.serverTime}
      />
      <div className="game-vignette" />
      <header className="marsh-top">
        <button
          className="hud-icon"
          onClick={onClose}
          aria-label="Back to Peeper"
        >
          ‹
        </button>
        <div>
          <span>
            SEASON {state.commons?.season || 1} · WEEK{" "}
            {state.commons?.week || 1}
          </span>
          <b>Reedbank</b>
        </div>
        <button className="hud-wallet" onClick={() => onPanel("shop")}>
          ✦ {state.player.coins}
        </button>
      </header>
      <div className="commons-stock" aria-label="Shared resources">
        {(built("bridge")
          ? ["wood", "ore", "planks", "supplies", "weapons"]
          : ["wood", "ore", "planks"]
        ).map((r) => (
          <button
            key={r}
            onClick={() =>
              onPanel(["supplies", "weapons"].includes(r) ? "boss" : "stores")
            }
            aria-label={`${resourceNames[r]}: ${state.stock[r]}`}
          >
            <WorldIcon name={r} size={27} />
            <b>
              {state.stock[r] >= 1000
                ? `${Math.floor(state.stock[r] / 100) / 10}k`
                : state.stock[r]}
            </b>
            <small>{r === "supplies" ? "Kits" : resourceNames[r]}</small>
          </button>
        ))}
      </div>
      <button
        className="world-objective"
        onClick={() => onPanel(project ? "stores" : "boss")}
      >
        <span className="objective-mark">
          <WorldIcon name={project ? "planks" : "boss"} size={31} />
        </span>
        <div>
          <small>
            {project
              ? `BUILD IT TOGETHER · STAGE ${stageIndex + 1}/4`
              : "ONE WORLD · ONE EXPEDITION"}
          </small>
          <strong>{objective}</strong>
          {project ? (
            <>
              <Meter
                value={progress % stageSize}
                max={stageSize}
                label={project.stages?.[stageIndex] || objective}
              />
              <span>
                {project.stages?.[stageIndex]} · {progress % stageSize}/
                {stageSize} · Help →
              </span>
            </>
          ) : (
            <span>
              {state.boss?.phase === "preparing"
                ? `${state.boss.supplies_filled}/${state.boss.supplies_required} kits · ${state.boss.weapons_filled}/${state.boss.weapons_required} weapons →`
                : state.boss?.phase === "open"
                  ? `${state.boss.hp.toLocaleString()} shared HP · Join the battle →`
                  : "Damage rewards paid · View victory →"}
            </span>
          )}
        </div>
      </button>
      {state.commons && (
        <button
          className="world-weather-chip"
          onClick={() => onPanel("weather")}
          aria-label={state.commons.weather.name}
        >
          <WorldIcon name={state.commons.weather.symbol} size={24} />
          <span>{state.commons.weather.name}</span>
        </button>
      )}
      <div className="world-presence">
        <i className={connected ? "online" : ""} />
        {connected ? `${players.length} on the trails` : "Reconnecting…"}
      </div>
      <button
        className="hud-map-button"
        aria-label="Known locations"
        onClick={() => setPlaces(!places)}
      >
        <WorldIcon name="map" size={22} />
        <span>Places</span>
      </button>
      {places && (
        <section className="hud-places" aria-label="Known locations">
          <div>
            <strong>Known trails</strong>
            <button onClick={() => setPlaces(false)} aria-label="Close places">
              ×
            </button>
          </div>
          {content.locations
            .filter((l) => !l.requires || built(l.requires))
            .map((l) => (
              <button key={l.id} onClick={() => choose(l.id)}>
                <span>{l.name}</span>
                <small>
                  {l.id === location
                    ? "You are here"
                    : l.id === "bridge" && !built("bridge")
                      ? "West landing · crossing blocked"
                      : "Follow the trail"}
                </small>
              </button>
            ))}
          {!built("bridge") && (
            <p>The far shore is hidden until the crossing is restored.</p>
          )}
        </section>
      )}
      <section className="hud-location" aria-label="Current destination">
        {!trip &&
          !commitment &&
          project &&
          here &&
          selected !== "bridge" &&
          selected !== next.location && (
            <button
              className="hud-next-task"
              onClick={() => go(next.location)}
              disabled={busy}
            >
              <WorldIcon
                name={
                  next.step === 0 ? "wood" : next.step === 1 ? "planks" : "cart"
                }
                size={26}
              />
              <span>
                <small>HELP THE CONSTRUCTION</small>
                <b>{next.title} →</b>
              </span>
            </button>
          )}
        {trip ? (
          <>
            <span className="hud-kicker">ON THE TRAIL</span>
            <h2>{content.locations.find((l) => l.id === trip.to)?.name}</h2>
            <div className="hud-travel">
              <span>Following the road</span>
              <b>{duration(trip.arrives_at - now)}</b>
            </div>
            <Meter
              value={now - trip.started_at}
              max={trip.arrives_at - trip.started_at}
              label="Walking to destination"
            />
          </>
        ) : (
          <>
            <div className="hud-location-heading">
              <div>
                <span className="hud-kicker">
                  {here ? "YOU ARE HERE" : "DESTINATION"}
                </span>
                <h2>{place.name}</h2>
              </div>
              <span className="hud-location-symbol">
                <WorldIcon
                  name={
                    {
                      village: "camp",
                      sawmill: "wood",
                      quarry: "ore",
                      bridge: "planks",
                      mill: "supplies",
                      workshop: "weapons",
                      pool: "boss",
                    }[place.id]
                  }
                  size={38}
                />
              </span>
            </div>
            {error && (
              <p className="hud-error" role="alert">
                {error}
              </p>
            )}
            {commitment ? (
              <button className="hud-action" onClick={onResume}>
                Return to your{" "}
                {state.assault ? "battle" : state.job ? "work" : "party"} ↗
              </button>
            ) : !here ? (
              <>
                <p>
                  {place.id === "bridge" && !built("bridge")
                    ? "You can reach the west landing. The broken bridge blocks the river."
                    : place.subtitle}
                </p>
                <button
                  className="hud-action"
                  disabled={busy}
                  onClick={() => go()}
                >
                  Follow the trail <span>→</span>
                </button>
              </>
            ) : (
              <>
                {jobs.length > 0 &&
                  (jobs.length === 1 ? (
                    jobButton(jobs[0])
                  ) : (
                    <>
                      <button
                        className="hud-action"
                        onClick={() => setRecipes(!recipes)}
                      >
                        Open the workbench <span>↗</span>
                      </button>
                      {recipes && (
                        <div className="hud-recipes">{jobs.map(jobButton)}</div>
                      )}
                    </>
                  ))}
                {place.id === "village" && (
                  <div className="hud-delivery-action">
                    <button
                      disabled={busy || state.stock.planks < 2}
                      onClick={() => onMission("delivery")}
                    >
                      Organize a delivery <span>2 planks</span>
                    </button>
                    {state.stock.planks < 2 && (
                      <small>
                        Gather timber, make planks, then load a caravan.
                      </small>
                    )}
                  </div>
                )}
                {place.id === "bridge" && (
                  <>
                    <p>
                      {built("bridge")
                        ? "The crossing is open. Equip the expedition at the Supply Mill and Armory."
                        : "Deliver planks from the post to rebuild this crossing for everyone."}
                    </p>
                    <button
                      className="hud-action"
                      disabled={busy}
                      onClick={() =>
                        built("bridge") ? onPanel("boss") : go(next.location)
                      }
                    >
                      {built("bridge")
                        ? "View expedition reserves"
                        : next.title}{" "}
                      <span>→</span>
                    </button>
                  </>
                )}
                {place.id === "pool" && state.boss && (
                  <>
                    <p>
                      {state.boss.phase === "preparing"
                        ? "Mirewake is visible. Fill the kit and weapon reserves before anyone can attack."
                        : state.boss.phase === "open"
                          ? `${state.boss.hp.toLocaleString()} shared HP remaining. Your damage is saved after every attempt.`
                          : "Mirewake has fallen. Damage rewards have been paid to all contributors."}
                    </p>
                    <button
                      className="hud-action"
                      disabled={busy}
                      onClick={() => onPanel("boss")}
                    >
                      {state.boss.phase === "preparing"
                        ? "View expedition reserves"
                        : state.boss.phase === "defeated"
                          ? "View victory rewards"
                          : "Open the shared battle"}{" "}
                      <span>→</span>
                    </button>
                  </>
                )}
              </>
            )}
          </>
        )}
      </section>
      <nav className="marsh-toolbar">
        <button onClick={() => onPanel("orders")}>
          <WorldIcon name="orders" />
          Weekly board
        </button>
        <button
          className="toolbar-expedition"
          onClick={() => onPanel(built("bridge") ? "boss" : "parties")}
        >
          <WorldIcon name={built("bridge") ? "boss" : "cart"} />
          {built("bridge") ? "World boss" : "Expeditions"}
        </button>
        <button onClick={() => onPanel("chat")}>
          <WorldIcon name="chat" />
          Chat
        </button>
        <button onClick={() => onPanel("journal")}>
          <WorldIcon name="camp" />
          Camp
        </button>
      </nav>
      {state.lobbies.length > 0 && (
        <button className="hud-party-beacon" onClick={() => onPanel("parties")}>
          <i>◉</i>
          {state.lobbies.length} open{" "}
          {state.lobbies.length === 1 ? "party" : "parties"}
          <span>Join players →</span>
        </button>
      )}
    </div>
  );
}
