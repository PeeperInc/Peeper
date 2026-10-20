"use strict";
// Shared input/timing rules for the server and immediate client prediction.
const VERSION = 3;
const STUN = 10;
const GRACE = 0.18;
const STRIKE_GAP = 0.38;
const DODGE_GAP = 0.55;
const PERFECT = 0.34;
function reset(f, t) {
  Object.assign(f, {
    combat_version: VERSION,
    lane: 0,
    attack_index: 0,
    attack_target: 0,
    next_attack: t + 3,
    combo: 0,
    combo_until: 0,
    counter_until: 0,
    perfect_index: -1,
    dodge_ready: 0,
    dodge_until: 0,
    last_dodge: 0,
    last_hurt: 0,
    last_evade: 0,
    strike_ready: 0,
    stagger_until: 0,
    input_at: 0,
    last_seen: t,
    hp: 100,
    revive_at: 0,
  });
  return f;
}
function attack(f, boss, t) {
  const index = f.attack_index || 0,
    n = index % 4,
    kind = n === 1 ? "breath" : n >= 2 ? "double" : "claw",
    enraged = boss.hp <= boss.max_hp / 3,
    windup =
      (kind === "breath" ? 1.45 : n === 3 ? 0.76 : 1.05) * (enraged ? 0.88 : 1),
    remaining = f.next_attack - t;
  return {
    id: index,
    kind,
    target: f.attack_target,
    at: f.next_attack,
    windup,
    remaining,
    telegraph:
      boss.phase === "open" &&
      t >= f.stagger_until &&
      remaining <= windup &&
      remaining >= -GRACE,
    followup: n === 3,
    enraged,
  };
}
function advance(f, boss, t) {
  let incoming = 0,
    evaded = 0;
  // Rejoining or hiding the tab cannot clear an unfinished stun.
  if (
    f.combat_version !== VERSION ||
    (t - f.last_seen > 8 && t >= f.stagger_until)
  )
    reset(f, t);
  while (boss.phase === "open" && t >= f.next_attack + GRACE) {
    const at = f.next_attack,
      hit = f.lane === f.attack_target;
    if (hit) {
      incoming++;
      f.last_hurt = at;
      f.stagger_until = at + STUN;
      f.combo = 0;
      f.combo_until = 0;
      f.counter_until = 0;
    } else {
      evaded++;
      f.last_evade = at;
    }
    const next = (f.attack_index + 1) % 4;
    const delay =
      (next === 3 ? 0.95 : next === 1 ? 4 : next === 2 ? 3.4 : 3.1) *
      (boss.hp <= boss.max_hp / 3 ? 0.88 : 1);
    f.attack_index++;
    f.attack_target = f.lane;
    // Leave a fresh reaction window after recovery; no repeated hits in stun.
    f.next_attack = hit ? f.stagger_until + 3 : at + delay;
  }
  f.last_seen = t;
  if (t > f.combo_until) f.combo = 0;
  return { incoming, evaded };
}
function input(f, boss, kind, t, direction) {
  if (boss.phase !== "open" || boss.hp <= 0)
    return { error: "The dragon is already defeated", status: 409 };
  if (t < f.input_at - 0.001)
    return { error: "Input arrived out of order", status: 409 };
  if (t < f.stagger_until)
    return { error: "Stunned · wait to recover", status: 429 };
  if (kind === "dodge") {
    if (!["left", "right"].includes(direction))
      return { error: "Swipe left or right", status: 400 };
    if (t < f.dodge_ready) return { error: "Dodge is recovering", status: 429 };
    const lane = direction === "left" ? 0 : 1,
      from = f.lane;
    const perfect =
      lane !== from &&
      from === f.attack_target &&
      t >= f.next_attack - PERFECT &&
      t <= f.next_attack + 0.08 &&
      f.perfect_index !== f.attack_index;
    f.lane = lane;
    f.dodge_ready = t + DODGE_GAP;
    f.dodge_until = t + 0.32;
    f.last_dodge = t;
    if (perfect) {
      f.counter_until = Math.max(t + 1.2, f.next_attack + 1.25);
      f.perfect_index = f.attack_index;
    }
    f.input_at = t;
    return { damage: 0, perfect, moved: lane !== from, direction };
  }
  if (kind !== "strike")
    return {
      error: "Battle controls changed. Reload and use taps and swipes.",
      status: 409,
    };
  if (t < Math.max(f.strike_ready, f.stagger_until))
    return { error: "Strike is recovering", status: 429 };
  const counter = f.counter_until > t;
  const combo = counter ? 0 : (f.combo_until > t ? f.combo : 0) + 1;
  const finisher = combo === 3;
  const damage = Math.min(boss.hp, counter ? 20 : finisher ? 5 : 2);
  f.combo = finisher || counter ? 0 : combo;
  f.combo_until = t + 1.3;
  f.strike_ready = t + STRIKE_GAP;
  f.input_at = t;
  if (counter) f.counter_until = 0;
  return { damage, counter, finisher, combo: finisher ? 3 : combo };
}
module.exports = {
  VERSION,
  STUN,
  GRACE,
  STRIKE_GAP,
  DODGE_GAP,
  PERFECT,
  reset,
  attack,
  advance,
  input,
};
