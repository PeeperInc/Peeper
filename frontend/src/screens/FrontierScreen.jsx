import React, { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import * as api from "../api";
import content from "../../../backend/frontier/content.json";
import { useFrontier } from "../frontier/useFrontier";
import WorldHud from "../frontier/WorldHud";
import GlobalChatScreen from "./GlobalChatScreen";
import "./FrontierScreen.css";
import "../frontier/MarshGame.css";
import "../frontier/StrategyHud.css";
import CommonsBoard from "../frontier/CommonsBoard";
import ConstructionPlan, {
  nextContribution,
} from "../frontier/ConstructionPlan";
import DeliverySetup from "../frontier/DeliverySetup";
import { BossCampaign, AssaultScene } from "../frontier/BossCampaign";
import "../frontier/BossCampaign.css";

import { WorkScene, MissionScene } from "../frontier/Activities";
import {
  Meter,
  Resources,
  Dialog,
  resourceNames,
  resourceIcons,
  duration,
} from "../frontier/components";
const requestId = () => crypto.randomUUID();
export default function FrontierScreen({
  onClose,
  onViewProfile,
  onSendGift,
  onOpenFamily,
  initialMissionId = null,
}) {
  const { user, peeper, showToast, refreshGameState } = useApp();
  const { state, error, connected, players, refresh } = useFrontier();
  const [selected, setSelected] = useState("village"),
    [panel, setPanel] = useState(null),
    [activity, setActivity] = useState(null),
    [activityData, setActivityData] = useState(null),
    [busy, setBusy] = useState(false),
    [localError, setLocalError] = useState(null),
    [now, setNow] = useState(Date.now() / 1000),
    [role, setRole] = useState("driver"),
    [confirm, setConfirm] = useState(null);
  const clockOffset = useRef(0),
    initial = useRef(false),
    pendingKey = useRef(null),
    alive = useRef(true),
    commandLock = useRef(false),
    commandEpoch = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (state) {
      clockOffset.current = state.serverTime - Date.now() / 1000;
      setNow(state.serverTime);
      if (!initial.current) {
        initial.current = true;
        setSelected(
          state.player.travel?.to || state.player.location || "village",
        );
        if (initialMissionId) {
          setActivity({ kind: "mission", id: initialMissionId });
        } else if (state.assault) {
          setActivity({ kind: "assault", id: state.assault.id });
          setActivityData(state.assault);
        } else if (state.job) {
          setActivity({ kind: "job", id: state.job.id });
          setActivityData(state.job);
        } else if (state.mission) {
          setActivity({ kind: "mission", id: state.mission.id });
          setActivityData(state.mission);
        }
      }
    }
  }, [state, initialMissionId]);
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Date.now() / 1000 + clockOffset.current),
      250,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const trip = state?.player.travel;
    if (!trip) return;
    let disposed = false,
      timer;
    async function arrive() {
      const latest = await refresh();
      if (!disposed && (!latest || latest.player.travel))
        timer = setTimeout(arrive, 1000);
    }
    timer = setTimeout(
      arrive,
      Math.max(
        0,
        (trip.arrives_at - Date.now() / 1000 - clockOffset.current) * 1000 +
          100,
      ),
    );
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [state?.player.travel?.arrives_at, refresh]);
  useEffect(() => {
    setLocalError(null);
    setActivityData((old) => (old?.id === activity?.id ? old : null));
    if (!activity) {
      setActivityData(null);
      return;
    }
    let disposed = false,
      inFlight = false;
    const load = async () => {
      if (inFlight || document.hidden || commandLock.current) return;
      inFlight = true;
      const epoch = commandEpoch.current;
      try {
        const data = await (activity.kind === "assault"
          ? api.frontierAssault(activity.id)
          : activity.kind === "job"
            ? api.frontierJob(activity.id)
            : api.frontierMission(activity.id));
        if (!disposed && epoch === commandEpoch.current) {
          setActivityData((old) => ({
            ...data,
            // Polls carry durable state, while the last gesture grade is ephemeral.
            feedback:
              data.feedback ??
              (old?.id === data.id && old?.step === data.step
                ? old.feedback
                : undefined),
          }));
          setLocalError(null);
          if (
            ["done", "abandoned", "cancelled", "expired"].includes(data.status)
          ) {
            refresh();
          }
        }
      } catch (e) {
        if (!disposed) setLocalError(e.message);
      } finally {
        inFlight = false;
      }
    };
    load();
    const timer = setInterval(load, activity.kind === "mission" ? 1000 : 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [activity?.kind, activity?.id, refresh]);
  const perform = useCallback(
    async (fn, after) => {
      if (commandLock.current) return;
      commandLock.current = true;
      commandEpoch.current++;
      setBusy(true);
      setLocalError(null);
      try {
        const result = await fn();
        if (alive.current) {
          after?.(result);
          await refresh();
        }
        return result;
      } catch (e) {
        if (alive.current) {
          setLocalError(
            e.message || "Could not complete that action. Try again.",
          );
          showToast(e.message || "Try again");
        }
      } finally {
        commandLock.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [refresh, showToast],
  );
  function choose(id) {
    const loc = content.locations.find((l) => l.id === id);
    if (
      !loc ||
      (loc.requires &&
        !state?.projects.find((p) => p.id === loc.requires)?.completed_at)
    )
      return;
    setSelected(id);
  }
  function startJob(kind) {
    const scope = `job:${kind}`;
    const id =
      pendingKey.current?.scope === scope ? pendingKey.current.id : requestId();
    pendingKey.current = { scope, id };
    perform(
      () => api.frontierStartJob(kind, id),
      (j) => {
        pendingKey.current = null;
        setActivityData(j);
        setActivity({ kind: "job", id: j.id });
      },
    );
  }
  function startAssault() {
    const id =
      pendingKey.current?.scope === "assault"
        ? pendingKey.current.id
        : requestId();
    pendingKey.current = { scope: "assault", id };
    perform(
      () => api.frontierStartAssault(id),
      (a) => {
        pendingKey.current = null;
        setPanel(null);
        setActivityData(a);
        setActivity({ kind: "assault", id: a.id });
      },
    );
  }
  function prepareBoss(item, amount) {
    const scope = `prepare:${item}:${amount}`,
      id =
        pendingKey.current?.scope === scope
          ? pendingKey.current.id
          : requestId();
    pendingKey.current = { scope, id };
    perform(
      () => api.frontierBossPrepare(item, amount, id),
      () => {
        pendingKey.current = null;
      },
    );
  }
  function createMission(kind, load) {
    if (kind === "boss") {
      setPanel("boss");
      return;
    }

    if (!load) {
      setPanel("dispatch");
      return;
    }
    const scope = `mission:${kind}:${role}:${load || "cart"}`;
    const id =
      pendingKey.current?.scope === scope ? pendingKey.current.id : requestId();
    pendingKey.current = { scope, id };
    perform(
      () => api.frontierCreateMission(kind, role, id, load),
      (m) => {
        pendingKey.current = null;
        setActivityData(m);
        setPanel(null);
        setActivity({ kind: "mission", id: m.id });
      },
    );
  }
  function missionCommand(command, payload) {
    return perform(
      () => api.frontierMissionAction(activity.id, command, payload),
      (m) => {
        if (command === "leave") {
          setActivity(null);
        } else if (command === "recruit") {
          showToast("Invitation posted in Global Chat");
        } else setActivityData(m);
      },
    );
  }
  function returnToMap() {
    setActivity(null);
    refresh();
    refreshGameState();
  }
  const rank = [...content.ranks]
    .reverse()
    .find((r) => (state?.player.xp || 0) >= r.xp);
  return (
    <div className="frontier-screen">
      {state ? (
        <WorldHud
          state={state}
          selected={selected}
          onSelect={choose}
          onTravel={(id) => perform(() => api.frontierTravel(id))}
          user={user}
          peeper={peeper}
          players={players}
          connected={connected}
          busy={busy}
          now={now}
          error={localError || error}
          onClose={() => {
            refreshGameState();
            onClose();
          }}
          onPanel={setPanel}
          onWork={startJob}
          onMission={createMission}
          role={role}
          onRole={setRole}
          onResume={() => {
            const item = state.assault || state.job || state.mission;
            setActivityData(item);
            setActivity({
              kind: state.assault ? "assault" : state.job ? "job" : "mission",
              id: item.id,
            });
          }}
          onParty={(id) => setActivity({ kind: "mission", id })}
        />
      ) : (
        <div className="marsh-loading">
          <span>BEYOND THE FOG</span>
          <h1>Reedbank</h1>
          <p>{error || "Following the trail home…"}</p>
          {error && <button onClick={refresh}>Reconnect</button>}
        </div>
      )}
      {panel === "orders" && state?.commons && (
        <Dialog title="The community board" onClose={() => setPanel(null)}>
          <CommonsBoard
            commons={state.commons}
            now={now}
            onChoose={(id) => {
              choose(id);
              setPanel(null);
            }}
            onChat={() => setPanel("chat")}
          />
        </Dialog>
      )}
      {panel === "stores" && state && (
        <Dialog title="Community stores" onClose={() => setPanel(null)}>
          <ConstructionPlan
            state={state}
            onGo={(id) => {
              choose(id);
              setPanel(null);
              if (
                !state.job &&
                !state.mission &&
                !state.assault &&
                !state.player.travel
              )
                perform(() => api.frontierTravel(id));
            }}
          />
        </Dialog>
      )}
      {panel === "weather" && state?.commons && (
        <Dialog
          title={state.commons.weather.name}
          onClose={() => setPanel(null)}
        >
          <div className="frontier-panel-body weather-explanation">
            <h3>On the trails today</h3>
            <p>{state.commons.weather.hint}</p>
            <p>
              {state.commons.weather.id === "clear"
                ? "Normal steering, light insect drift and the usual herb recipe. There is no difficulty modifier today."
                : state.commons.weather.id === "rain"
                  ? "During caravan driving, steering is 30% slower. Watch the mud and start turns earlier. Work inside the workshops is unchanged."
                  : state.commons.weather.id === "wind"
                    ? "During guard encounters, gusts bend insect flight paths. Read their movement and swipe in short bursts. Other tasks keep their usual rules."
                    : "In the healer's herb puzzle, a remedy needs 8 herbs instead of 9. This benefit applies to herb-gathering tasks."}
            </p>
          </div>
        </Dialog>
      )}
      {panel === "parties" && state && (
        <Dialog title="Find a party" onClose={() => setPanel(null)}>
          <div className="frontier-panel-body">
            {state.lobbies.length ? (
              state.lobbies.map((m) => (
                <button
                  className="hud-party-row"
                  key={m.id}
                  onClick={() => {
                    setPanel(null);
                    setActivity({ kind: "mission", id: m.id });
                  }}
                >
                  <b>
                    {m.kind === "boss"
                      ? "Reedlands patrol"
                      : "Construction delivery"}
                  </b>
                  <span>
                    {m.members.map((p) => p.name).join(", ")} ·{" "}
                    {m.members.length}/3
                  </span>
                  <small>Join the group →</small>
                </button>
              ))
            ) : (
              <div>
                <h3>The next caravan could be yours.</h3>
                <p>
                  One drives, one protects the cargo, one keeps the wheels
                  turning. Everyone earns their own reward.
                </p>
                <button
                  className="frontier-primary"
                  onClick={() => {
                    choose("village");
                    setPanel(null);
                  }}
                >
                  Go to Crooked Post →
                </button>
              </div>
            )}
          </div>
        </Dialog>
      )}
      {panel === "boss" && state?.boss && (
        <Dialog title="The shared expedition" onClose={() => setPanel(null)}>
          <BossCampaign
            state={state}
            busy={busy}
            now={now}
            onPrepare={prepareBoss}
            onAttack={startAssault}
            onGo={(id) => {
              setPanel(null);
              choose(id);
              if (
                !state.job &&
                !state.mission &&
                !state.assault &&
                !state.player.travel
              )
                perform(() => api.frontierTravel(id));
            }}
          />
        </Dialog>
      )}
      {panel === "dispatch" && state && (
        <Dialog title="Prepare a delivery" onClose={() => setPanel(null)}>
          <DeliverySetup
            state={state}
            role={role}
            onRole={setRole}
            busy={busy}
            onCreate={(load) => createMission("delivery", load)}
          />
        </Dialog>
      )}
      {activity && (
        <Dialog
          title={
            activity.kind === "job"
              ? content.jobs[activityData?.kind]?.name || "Work order"
              : activity.kind === "assault"
                ? "Mirewake · world battle"
                : "On the trail"
          }
          onClose={() => setActivity(null)}
          className="frontier-activity-dialog"
        >
          {localError && (
            <div className="frontier-warning" role="alert">
              {localError}
            </div>
          )}
          {activityData ? (
            activity.kind === "assault" ? (
              <AssaultScene
                attempt={activityData}
                boss={state?.boss}
                busy={busy}
                onAct={(p) =>
                  perform(
                    () => api.frontierAssaultAction(activity.id, p),
                    setActivityData,
                  )
                }
                onCancel={() =>
                  perform(
                    () => api.frontierCancelAssault(activity.id),
                    setActivityData,
                  )
                }
                onAgain={startAssault}
                onReturn={() => {
                  returnToMap();
                  setPanel("boss");
                }}
              />
            ) : activity.kind === "job" ? (
              <WorkScene
                job={activityData}
                nextTask={
                  ["wood", "ore", "supplies", "weapons"].includes(
                    activityData.kind,
                  )
                    ? nextContribution(state)
                    : null
                }
                now={now}
                busy={busy}
                onAct={(payload) =>
                  perform(
                    () => api.frontierJobAction(activity.id, payload),
                    setActivityData,
                  )
                }
                onCancel={() =>
                  perform(
                    () => api.frontierCancelJob(activity.id),
                    setActivityData,
                  )
                }
                onReturn={returnToMap}
                onAgain={() => startJob(activityData.kind)}
                onNext={(id) => {
                  returnToMap();
                  if (id === "boss") {
                    setPanel("boss");
                    return;
                  }
                  choose(id);
                  perform(() => api.frontierTravel(id));
                }}
              />
            ) : (
              <MissionScene
                mission={activityData}
                user={user}
                peeper={peeper}
                now={now}
                busy={busy}
                onCommand={missionCommand}
                onOpenChat={() => setPanel("chat")}
                onReturn={returnToMap}
              />
            )
          ) : (
            <div className="frontier-panel-body">Finding your party…</div>
          )}
        </Dialog>
      )}
      {panel === "guide" && (
        <Dialog
          title="A field guide to the commons"
          onClose={() => setPanel(null)}
        >
          <div className="frontier-panel-body frontier-guide">
            <p className="frontier-lead">
              A place built by the people who pass through it.
            </p>
            <ol>
              <li>
                <b>Gather.</b> Work at the sawmill or quarry. Complete the
                physical tasks to earn experience and add resources to the
                shared stores.
              </li>
              <li>
                <b>Make.</b> Stack and trim construction planks at Crooked Post.
              </li>
              <li>
                <b>Travel together.</b> Gather a public caravan at Crooked Post.
                Pick a role and invite others in Global Chat.
              </li>
              <li>
                <b>Open the world.</b> Delivered planks build permanent
                structures for everyone. The repaired bridge opens the far bank.
                The dragon becomes visible. Craft expedition kits at the mill
                and weapons at the armory. Fill both shared reserves to open the
                battle.
              </li>
              <li>
                <b>Fight together.</b> Both reserves open the dragon for every
                player. Attack without spending kits or energy. Your accumulated
                damage earns a proportional share of the fixed coin fund when
                the dragon falls, even if you are offline.
              </li>
            </ol>
            <p>
              A work batch finishes after 3 good rounds. Misses keep your
              progress. Gathered timber and iron go straight into the shared
              stores, including pieces collected before leaving early.
              Unfinished recipes return their ingredients.
            </p>
            <p>
              A journey has 3 encounters over 45 seconds. Clear at least 2 for
              an individual reward. A handcart carries 2 planks; a wagon carries
              6 and needs at least two crewmates to clear 2 encounters each. On
              a solo journey, you drive, defend and repair in turn.
            </p>
            <p>
              Materials and experience can be earned continuously. Successful
              work and journeys share one coin payment every 3 minutes. No
              energy or daily quota is used. Keep your Peeper cared for as
              usual.
            </p>
            <p>
              One activity at a time. Reopen it after a connection drop.
              Journeys already underway continue on the server; failed or
              cancelled journeys return their reserved cargo.
            </p>
          </div>
        </Dialog>
      )}
      {panel === "journal" && state && (
        <Dialog title="Your field journal" onClose={() => setPanel(null)}>
          <div className="frontier-panel-body">
            <span className="frontier-eyebrow">{rank.name}</span>
            <h3>{user.first_name}, of Reedbank</h3>
            {state.commons && (
              <div className="commons-journal">
                <b>{state.commons.totalSeals} community seals</b>
                <p>
                  {state.commons.points} contributions this week. Complete
                  shared rows for seals and trail experience.
                </p>
                <button
                  className="frontier-secondary"
                  onClick={() => setPanel("orders")}
                >
                  Open this week’s board →
                </button>
              </div>
            )}
            <button
              className="frontier-secondary"
              onClick={() => setPanel("guide")}
            >
              How the commons works →
            </button>
            <div className="frontier-journal-stats">
              <span>
                <b>{state.player.jobs}</b> orders
              </span>
              <span>
                <b>{state.player.deliveries}</b> deliveries
              </span>
              {state.boss && (
                <span>
                  <b>{state.player.boss_contribution}</b> total dragon damage
                </span>
              )}
            </div>
            <p>
              {state.player.xp} experience.{" "}
              {content.ranks.find((r) => r.xp > state.player.xp)
                ? `${content.ranks.find((r) => r.xp > state.player.xp).xp - state.player.xp} to the next trail rank.`
                : "A familiar face across the marsh."}
            </p>
            {state.player.honors.map((h) => (
              <p key={h.cycle}>
                ♛ World expedition {h.cycle} · {h.contribution} contribution
              </p>
            ))}
            <h3>Recent earnings</h3>
            {state.history.length ? (
              state.history.map((h) => (
                <div className="frontier-journal-entry" key={h.ref}>
                  <span>{h.reason}</span>
                  <b>{h.coins ? `+${h.coins} ✦` : `+${h.xp} XP`}</b>
                </div>
              ))
            ) : (
              <p className="frontier-fine">
                Your first completed order starts the story.
              </p>
            )}
            <h3>News from the marsh</h3>
            {state.events.length ? (
              state.events.map((e) => (
                <p className="frontier-event" key={e.id}>
                  {e.message}
                </p>
              ))
            ) : (
              <p className="frontier-fine">
                The first chapter is still being written.
              </p>
            )}
          </div>
        </Dialog>
      )}
      {panel === "shop" && state && (
        <Dialog title="Trail keepsakes" onClose={() => setPanel(null)}>
          <div className="frontier-panel-body">
            <p>
              Small things for your life in the commons. Keepsakes appear beside
              your Peeper on the world map.
            </p>
            {content.cosmetics.map((c) => (
              <div className="frontier-keepsake" key={c.id}>
                <span style={{ color: c.color }}>
                  {c.type === "pennant"
                    ? "⚑"
                    : c.type === "lantern"
                      ? "✧"
                      : "♛"}
                </span>
                <div>
                  <h3>{c.name}</h3>
                  <p>{c.description}</p>
                  <button
                    className="frontier-secondary"
                    disabled={busy}
                    onClick={() =>
                      state.player.owned.includes(c.id)
                        ? perform(() =>
                            api.frontierCosmetic(
                              "equip",
                              state.player.equipped === c.id ? null : c.id,
                            ),
                          )
                        : setConfirm({
                            title: `Buy ${c.name.toLowerCase()}?`,
                            body: `Spend ${c.price} coins from your Peeper balance. This is a permanent keepsake.`,
                            action: () =>
                              perform(
                                () => api.frontierCosmetic("buy", c.id),
                                () => refreshGameState(),
                              ),
                          })
                    }
                  >
                    {state.player.equipped === c.id
                      ? "Put away"
                      : state.player.owned.includes(c.id)
                        ? "Equip"
                        : `${c.price} ✦ · Buy`}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Dialog>
      )}
      {panel === "chat" && (
        <Dialog
          title="Global Chat"
          onClose={() => setPanel(null)}
          className="frontier-chat-dialog"
        >
          <GlobalChatScreen
            onSendGift={(recipient) => {
              setPanel(null);
              onSendGift?.(recipient);
            }}
            onOpenFamily={(family) => {
              setPanel(null);
              onOpenFamily?.(family);
            }}
            onViewProfile={(id) => {
              setPanel(null);
              onViewProfile?.(id);
            }}
            onOpenFrontier={(id) => {
              setPanel(null);
              setActivity({ kind: "mission", id });
            }}
          />
        </Dialog>
      )}
      {confirm && (
        <Dialog
          title={confirm.title}
          onClose={() => setConfirm(null)}
          className="frontier-confirm"
        >
          <div className="frontier-panel-body">
            <p>{confirm.body}</p>
            <button
              className="frontier-primary"
              onClick={() => {
                const action = confirm.action;
                setConfirm(null);
                action();
              }}
            >
              Confirm
            </button>
            <button
              className="frontier-secondary"
              onClick={() => setConfirm(null)}
            >
              Keep playing
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
