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
import DeliverySetup, { DeliveryBonus } from "../frontier/DeliverySetup";
import { JourneyGuide } from "../frontier/JourneyPanels";
import "../frontier/JourneyMenus.css";
import { BossCampaign, AssaultScene } from "../frontier/BossCampaign";
import BossCombat from "../frontier/BossCombat";
import { ScenePeeperContext } from "../frontier/ScenePeeper";
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
    [role, setRole] = useState("driver");

  const clockOffset = useRef(0),
    paidCycle = useRef(null),
    journeyCycle = useRef(null),
    initial = useRef(false),
    pendingKey = useRef(null),
    alive = useRef(true),
    commandLock = useRef(false),
    commandEpoch = useRef(0);
  useEffect(() => {
    const cycle = state?.journey?.cycle;
    if (cycle === undefined) return;
    if (journeyCycle.current !== null && journeyCycle.current !== cycle) {
      setSelected("village");
      setPanel(null);
      setActivity(null);
      setActivityData(null);
    }
    journeyCycle.current = cycle;
  }, [state?.journey?.cycle]);
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
    if (state?.event?.phase !== "results" && state?.event?.active !== false)
      return;
    setPanel(null);
    setActivity(null);
    setActivityData(null);
    if (
      state.boss?.phase === "defeated" &&
      paidCycle.current !== state.boss.cycle
    ) {
      paidCycle.current = state.boss.cycle;
      refreshGameState();
    }
  }, [
    state?.event?.phase,
    state?.event?.active,
    state?.boss?.cycle,
    refreshGameState,
  ]);
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
  const closed =
    state?.event?.active === false ||
    (state?.event?.endsAt != null && now >= state.event.endsAt);
  if (closed || state?.event?.phase === "results") {
    const leaveResults = () => {
      refreshGameState();
      onClose();
    };
    return (
      <div className="frontier-screen">
        <section
          className="frontier-results"
          aria-label={closed ? "Event ended" : "Event results"}
        >
          <header>
            <button type="button" onClick={leaveResults}>
              ‹ Back
            </button>
            <strong>{closed ? "Event ended" : "Event results"}</strong>
          </header>
          {closed ? (
            <div className="frontier-ended">
              <h1>Beyond the Fog has ended</h1>
              <p>
                The results window has closed. Your coins and outfits are saved.
              </p>
              <button className="frontier-primary" onClick={leaveResults}>
                Back to Peeper
              </button>
            </div>
          ) : (
            <div className="frontier-results-scroll">
              <BossCampaign state={state} busy={false} now={now} />
            </div>
          )}
        </section>
      </div>
    );
  }
  return (
    <ScenePeeperContext.Provider value={peeper}>
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
            mapPaused={!!(panel || activity)}
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
          <Dialog title="Your quests" onClose={() => setPanel(null)}>
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
        {panel === "parties" && state && (
          <Dialog title="Team deliveries" onClose={() => setPanel(null)}>
            <div className="frontier-panel-body delivery-party-list">
              <DeliveryBonus />
              <p>2 shared planks per player. Teams split the three tasks.</p>
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
                      {m.members.length}/3 · {m.plannedCargo ?? m.cargo} planks
                      on arrival
                    </span>
                    <small>Join · reserve 2 shared planks →</small>
                  </button>
                ))
              ) : (
                <div>
                  <h3>No crews waiting yet.</h3>
                  <p>Create a delivery at Crooked Post and invite teammates.</p>
                  <button
                    className="frontier-primary"
                    onClick={() => {
                      if (
                        state.player.location === "village" &&
                        !state.player.travel
                      )
                        setPanel("dispatch");
                      else {
                        choose("village");
                        setPanel(null);
                      }
                    }}
                  >
                    {state.player.location === "village" && !state.player.travel
                      ? "Create a delivery →"
                      : "Go to Crooked Post →"}
                  </button>
                </div>
              )}
            </div>
          </Dialog>
        )}
        {panel === "combat" && (
          <Dialog
            title="Mirewake · shared battle"
            className="frontier-activity-dialog"
            onClose={() => {
              setPanel(null);
              refresh();
            }}
          >
            <BossCombat
              onVictory={() => {
                refresh();
                refreshGameState();
              }}
              onExit={() => {
                setPanel("boss");
                refresh();
              }}
            />
          </Dialog>
        )}
        {panel === "boss" && state?.boss && (
          <Dialog title="The shared expedition" onClose={() => setPanel(null)}>
            <BossCampaign
              state={state}
              busy={busy}
              now={now}
              onPrepare={prepareBoss}
              onAttack={() => setPanel("combat")}
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
            onClose={() =>
              activity.kind === "job" && activityData?.continuous
                ? perform(() => api.frontierCancelJob(activity.id), returnToMap)
                : setActivity(null)
            }
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
                  onLeave={() =>
                    perform(
                      () => api.frontierCancelJob(activity.id),
                      returnToMap,
                    )
                  }
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
          <Dialog title="How to play" onClose={() => setPanel(null)}>
            <JourneyGuide state={state} />
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
      </div>
    </ScenePeeperContext.Provider>
  );
}
