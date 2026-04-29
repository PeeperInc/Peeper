/**
 * PEEPER GAME MECHANICS — v6 (simplified)
 *
 * HP depends ONLY on hunger/time. Nothing else.
 *
 * HUNGER: drains 100→0 over 8h from last_fed.
 *
 * HP rules:
 *   hunger > 0  → regen: hp_at_last_fed + elapsed_since_feed / 12h * 100  (capped 100)
 *   hunger = 0  → drain: hp_when_depleted - elapsed_starving / 36h * 100  (floor 0)
 *
 * p.hp stores the HP value AT THE MOMENT last_fed was set.
 * liveStats() derives current HP purely from p.hp + p.last_fed + time.
 * play() NEVER touches p.hp or p.last_fed.
 *
 * FUN: drains 100→0 in 100min. Only affects energy for mini-games.
 * ENERGY: floor((100 - fun) / 20)
 */

const HUNGER_DRAIN      = 8  * 3600;  // 28800s
const FUN_DRAIN         = 100 * 60;   // 6000s
const HP_DRAIN_HUNGER   = 36 * 3600;  // 129600s — starvation kills over 36h
const HP_REGEN_DURATION = 12 * 3600;  // 43200s  — full regen in 12h

const FOOD_TYPES = {
  apple:   { cost: 1, hunger: 30,  label: 'Apple',  emoji: '🍎' },
  chicken: { cost: 2, hunger: 60,  label: 'Tendies', emoji: '🍗' },
  pizza:   { cost: 3, hunger: 100, label: 'Pidser',  emoji: '🍕' },
};

function calcEnergy(fun) {
  return Math.floor((100 - Math.max(0, Math.min(100, fun))) / 20);
}

function ts() { return Math.floor(Date.now() / 1000); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function r1(n) { return Math.round(n * 10) / 10; }

function getFridgeFoodUntil(p) {
  return Math.max(0, Math.floor(Number(p?.fridge_food_until) || 0));
}

/**
 * Pure computation — no DB access.
 *
 * p.hp   = HP value at the moment p.last_fed was set (feed or revive).
 * p.last_fed = Unix timestamp of last feed / revive.
 */
function liveStats(p, nowTs = ts()) {
  if (!p.alive) return { hunger: 0, fun: 0, hp: 0, alive: false };

  const now     = nowTs;
  const lastFed = Math.floor(Number(p.last_fed) || now);
  const fridgeFoodUntil = getFridgeFoodUntil(p);
  const fridgeActive = fridgeFoodUntil > now;
  const hungerAnchor = fridgeActive ? now : Math.max(lastFed, fridgeFoodUntil);
  const elapsed = Math.max(0, now - hungerAnchor);
  const hunger  = fridgeActive ? 100 : r1(clamp(100 * (1 - elapsed / HUNGER_DRAIN), 0, 100));
  const fun     = r1(clamp(100 * (1 - (now - p.last_played) / FUN_DRAIN), 0, 100));

  let hp;

  if (fridgeActive) {
    hp = clamp(p.hp + 100 * (Math.max(0, now - lastFed) / HP_REGEN_DURATION), 0, 100);
  } else if (hunger > 0) {
    // Still fed — HP regens from p.hp toward 100
    const hpBase = fridgeFoodUntil > lastFed ? 100 : p.hp;
    hp = clamp(hpBase + 100 * (elapsed / HP_REGEN_DURATION), 0, 100);
  } else {
    // Starving:
    //   1. How much did HP regen during the fed period (last_fed → hunger_depleted_at)?
    const fedDuration       = HUNGER_DRAIN;                         // full 8h fed window
    const hpBase            = fridgeFoodUntil > lastFed ? 100 : p.hp;
    const hpWhenDepleted    = clamp(hpBase + 100 * (fedDuration / HP_REGEN_DURATION), 0, 100);
    //   2. How long have we been starving?
    const hungerDepletedAt  = hungerAnchor + HUNGER_DRAIN;
    const starvingFor       = Math.max(0, now - hungerDepletedAt);
    //   3. Drain HP from hpWhenDepleted
    hp = clamp(hpWhenDepleted - 100 * (starvingFor / HP_DRAIN_HUNGER), 0, 100);
  }

  hp = r1(hp);
  return { hunger, fun, hp, alive: hp > 0 };
}

function feedCooldownRemaining()   { return 0; }
function playCooldownRemaining()   { return 0; }
function actionCooldownRemaining() { return 0; }

module.exports = {
  liveStats, calcEnergy,
  feedCooldownRemaining, playCooldownRemaining, actionCooldownRemaining,
  FOOD_TYPES, HUNGER_DRAIN, FUN_DRAIN, HP_DRAIN_HUNGER,
};
