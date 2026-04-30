/**
 * useLiveStats
 *
 * Server remains the only authority for alive/dead state.
 * The frontend only renders a smooth preview for hunger/fun/hp between refreshes,
 * using server-aligned time when `peeper.server_now` is available.
 */
import { useState, useEffect, useRef } from 'react';
import { shouldPauseLiveStats } from '../utils/gameplayRuntime.mjs';

const HUNGER_DRAIN      = 8   * 3600;
const FUN_DRAIN         = 100 * 60;
const HP_DRAIN_HUNGER   = 36  * 3600;
const HP_REGEN_DURATION = 12  * 3600;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function r1(n) {
  return Math.round(n * 10) / 10;
}

function getFridgeFoodUntil(peeper) {
  return Math.max(0, Math.floor(Number(peeper?.fridge_food_until) || 0));
}

function computePreview(peeper, serverOffsetSeconds) {
  if (!peeper) {
    return {
      hunger: 0,
      fun: 0,
      hp: 0,
      energy: 0,
      alive: false,
      locallyDepleted: false,
      needsServerSync: false,
    };
  }

  const serverAlive = peeper.alive !== false;
  if (!serverAlive) {
    return {
      hunger: 0,
      fun: 0,
      hp: 0,
      energy: 0,
      alive: false,
      locallyDepleted: false,
      needsServerSync: false,
    };
  }

  const now    = Date.now() / 1000 - serverOffsetSeconds;
  const lastFed = Math.floor(Number(peeper.last_fed) || now);
  const fridgeFoodUntil = getFridgeFoodUntil(peeper);
  const fridgeActive = fridgeFoodUntil > now;
  const hungerAnchor = fridgeActive ? now : Math.max(lastFed, fridgeFoodUntil);
  const elapsedSinceFood = Math.max(0, now - hungerAnchor);
  const hunger = fridgeActive ? 100 : r1(clamp(100 * (1 - elapsedSinceFood / HUNGER_DRAIN), 0, 100));
  const fun    = r1(clamp(100 * (1 - (now - peeper.last_played) / FUN_DRAIN), 0, 100));

  let hp;
  if (fridgeActive) {
    const elapsed = Math.max(0, now - lastFed);
    hp = clamp(peeper.hp + 100 * (elapsed / HP_REGEN_DURATION), 0, 100);
  } else if (hunger > 0) {
    const hpBase = fridgeFoodUntil > lastFed ? 100 : peeper.hp;
    hp = clamp(hpBase + 100 * (elapsedSinceFood / HP_REGEN_DURATION), 0, 100);
  } else {
    const hungerDepletedAt = hungerAnchor + HUNGER_DRAIN;
    const starvingFor = Math.max(0, now - hungerDepletedAt);
    const hpBase = fridgeFoodUntil > lastFed ? 100 : peeper.hp;
    const hpWhenDepleted = clamp(hpBase + 100 * (HUNGER_DRAIN / HP_REGEN_DURATION), 0, 100);
    hp = clamp(hpWhenDepleted - 100 * (starvingFor / HP_DRAIN_HUNGER), 0, 100);
  }

  hp = r1(hp);
  const energy = Math.floor((100 - clamp(fun, 0, 100)) / 20);
  const locallyDepleted = hp <= 0;

  return {
    hunger,
    fun,
    hp,
    energy,
    alive: true,
    locallyDepleted,
    needsServerSync: locallyDepleted,
  };
}

export function useLiveStats(peeper, options = {}) {
  const { isActive = true, gameplayOpen = false } = options;
  const paused = shouldPauseLiveStats({ isActive, gameplayOpen });
  const peeperRef = useRef(peeper);
  const serverOffsetRef = useRef(0);
  const [stats, setStats] = useState(() => computePreview(peeper, serverOffsetRef.current));

  useEffect(() => {
    peeperRef.current = peeper;
    if (peeper?.server_now) {
      serverOffsetRef.current = Date.now() / 1000 - peeper.server_now;
    }
    setStats(computePreview(peeper, serverOffsetRef.current));
  }, [peeper]);

  useEffect(() => {
    const tick = () => {
      setStats(computePreview(peeperRef.current, serverOffsetRef.current));
    };
    tick();
    if (paused) return undefined;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [paused]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setStats(computePreview(peeperRef.current, serverOffsetRef.current));
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return stats;
}
