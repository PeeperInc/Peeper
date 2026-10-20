import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  combat = require("./combat.cjs");
const boss = { phase: "open", hp: 600000, max_hp: 600000 };
const fresh = () => combat.reset({}, 0);
test("three paced taps finish a combo; waiting or getting hit resets it", () => {
  const f = fresh();
  assert.equal(combat.input(f, boss, "strike", 0.1).damage, 2);
  assert.equal(combat.input(f, boss, "strike", 0.2).status, 429);
  assert.equal(combat.input(f, boss, "strike", 0.5).combo, 2);
  const finish = combat.input(f, boss, "strike", 0.9);
  assert.equal(finish.finisher, true);
  assert.equal(finish.damage, 5);
  assert.equal(f.combo, 0);
  assert.equal(combat.input(f, boss, "strike", 2.4).combo, 1);
  combat.advance(f, boss, 3.2);
  assert.equal(f.combo, 0);
  assert.ok(combat.input(f, boss, "strike", 3.3).error);
});
test("a timely sideways swipe avoids the targeted lane and opens one counter", () => {
  const f = fresh();
  const dodge = combat.input(f, boss, "dodge", 2.8, "right");
  assert.equal(dodge.perfect, true);
  assert.equal(f.lane, 1);
  assert.equal(combat.advance(f, boss, 3.2).incoming, 0);
  assert.equal(f.last_evade, 3);
  const counter = combat.input(f, boss, "strike", 3.21);
  assert.equal(counter.counter, true);
  assert.equal(counter.damage, 20);
  assert.equal(combat.input(f, boss, "strike", 3.61).counter, false);
});
test("an early dodge is safe but not perfect; a roll into the same side cannot avoid a hit", () => {
  const early = fresh();
  assert.equal(combat.input(early, boss, "dodge", 1.2, "right").perfect, false);
  assert.equal(combat.advance(early, boss, 3.2).incoming, 0);
  assert.equal(early.counter_until, 0);
  const same = fresh();
  assert.equal(combat.input(same, boss, "dodge", 2.8, "left").moved, false);
  assert.equal(combat.advance(same, boss, 3.2).incoming, 1);
});
test("double lunge retargets the landing position and requires a second swipe", () => {
  const f = fresh();
  combat.input(f, boss, "dodge", 2.8, "right");
  combat.advance(f, boss, 3.2);
  combat.input(f, boss, "dodge", 6.8, "left");
  combat.advance(f, boss, 7.2);
  assert.equal(combat.attack(f, boss, 9.8).kind, "double");
  combat.input(f, boss, "dodge", 10.2, "right");
  combat.advance(f, boss, 10.6);
  assert.equal(combat.attack(f, boss, 10.7).followup, true);
  assert.equal(f.attack_target, 1);
  assert.equal(combat.input(f, boss, "dodge", 11.15, "left").perfect, true);
  assert.equal(combat.advance(f, boss, 11.55).evaded, 1);
});
test("telegraphs are explicit and enrage shortens future attack gaps", () => {
  const f = fresh();
  assert.equal(combat.attack(f, boss, 1).telegraph, false);
  assert.equal(combat.attack(f, boss, 2.2).telegraph, true);
  const calm = fresh(),
    angry = fresh(),
    b = { ...boss, hp: 100000 };
  combat.input(calm, boss, "dodge", 2.8, "right");
  combat.input(angry, b, "dodge", 2.8, "right");
  combat.advance(calm, boss, 3.2);
  combat.advance(angry, b, 3.2);
  assert.ok(angry.next_attack < calm.next_attack);
  assert.equal(combat.attack(angry, b, 4).enraged, true);
});
test("a hit stuns for exactly ten seconds, blocks both inputs and cannot chain-stun or reset on rejoin", () => {
  const f = fresh();
  combat.input(f, boss, "strike", 2.6);
  assert.equal(combat.advance(f, boss, 3.2).incoming, 1);
  assert.equal(f.stagger_until, 13);
  assert.equal(f.next_attack, 16);
  assert.equal(f.combo, 0);
  for (const t of [3.3, 8, 12.999]) {
    assert.match(combat.input(f, boss, "strike", t).error, /Stunned/);
    assert.match(combat.input(f, boss, "dodge", t, "right").error, /Stunned/);
    assert.equal(combat.attack(f, boss, t).telegraph, false);
  }
  // More than eight seconds without polling used to reset the fighter pose.
  assert.equal(combat.advance(f, boss, 12.1).incoming, 0);
  assert.equal(f.stagger_until, 13);
  assert.equal(f.last_hurt, 3);
  assert.equal(combat.input(f, boss, "strike", 13).damage, 2);
  assert.equal(combat.input(f, boss, "dodge", 13, "right").moved, true);
  combat.advance(f, boss, 16.2);
  assert.equal(f.last_hurt, 3);
});
test("malformed directions, old guard controls and backwards input cannot grant damage", () => {
  const f = fresh();
  assert.equal(combat.input(f, boss, "dodge", 1, "up").status, 400);
  assert.equal(combat.input(f, boss, "guard", 1).status, 409);
  combat.input(f, boss, "strike", 1);
  assert.equal(combat.input(f, boss, "strike", 0.5).status, 409);
});
test("overkill is capped and no action can damage a settled boss", () => {
  const f = fresh();
  f.counter_until = 4;
  assert.equal(combat.input(f, { ...boss, hp: 1 }, "strike", 1).damage, 1);
  assert.equal(
    combat.input(f, { ...boss, phase: "defeated", hp: 0 }, "strike", 2).status,
    409,
  );
});
