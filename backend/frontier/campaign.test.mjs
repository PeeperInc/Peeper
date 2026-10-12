import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3");
const { createCampaign } = require("./campaign"),
  balance = require("./balance.json");
function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2); CREATE TABLE grants(uid INTEGER,ref TEXT PRIMARY KEY,coins INTEGER,xp INTEGER);",
  );
  let time = 1700000000;
  const now = () => time,
    grant = (uid, ref, coins, xp) =>
      db
        .prepare("INSERT OR IGNORE INTO grants VALUES(?,?,?,?)")
        .run(uid, ref, coins, xp);
  const make = () => createCampaign(db, now, grant);
  return {
    db,
    c: make(),
    make,
    advance: (s) => (time += s),
    close: () => db.close(),
  };
}
test("viewing does not start the first week; first contribution fixes its deadline", () => {
  const f = fixture();
  try {
    assert.equal(f.c.view(1, []).ends_at, null);
    f.advance(1000);
    f.c.record(1, { job: "wood" }, []);
    const initial = f.c.view(1, []);
    assert.equal(initial.ends_at - initial.started_at, balance.weekSeconds);
    assert.equal(initial.points, 1);
    assert.equal(initial.tiles.find((t) => t.kind === "wood").progress, 1);
    assert.equal(initial.tiles.find((t) => t.kind === "work").progress, 1);
    f.advance(300);
    assert.equal(f.c.view(2, []).ends_at, initial.ends_at);
  } finally {
    f.close();
  }
});
test("weekly layouts are frozen, unlock-aware next week, and survive engine restart", () => {
  const f = fixture();
  try {
    f.c.record(1, { job: "wood" }, []);
    const first = f.c.view(1, []);
    assert.deepEqual(f.c.view(1, ["bridge", "mill"]).tiles, first.tiles);
    f.c = f.make();
    assert.deepEqual(f.c.view(1, []).tiles, first.tiles);
    f.advance(balance.weekSeconds);
    const second = f.c.view(1, ["bridge", "mill"]);
    assert.equal(second.week, 2);
    assert.equal(second.points, 0);
    assert.ok(second.tiles.some((t) => t.kind === "boss"));
    assert.ok(second.tiles.some((t) => t.kind === "supplies"));
    assert.ok(second.tiles.every((t) => t.progress === 0));
    f.advance(balance.weekSeconds * 3);
    assert.equal(f.c.view(1, []).season, 2);
  } finally {
    f.close();
  }
});
test("team orders require two eligible contributors and count each person's completed activity", () => {
  const f = fixture();
  try {
    f.c.record(1, { mission: "delivery", role: "guard", partySize: 1 }, []);
    let v = f.c.view(1, []);
    assert.equal(v.tiles.find((t) => t.kind === "team").progress, 0);
    f.c.record(2, { mission: "delivery", role: "mechanic", partySize: 2 }, []);
    v = f.c.view(2, []);
    assert.equal(v.tiles.find((t) => t.kind === "team").progress, 1);
    assert.equal(v.tiles.find((t) => t.kind === "delivery").progress, 2);
    assert.equal(v.tiles.find((t) => t.kind === "guard").progress, 1);
    assert.equal(v.contributors, 2);
  } finally {
    f.close();
  }
});
test("three contributions qualify; offline seals settle once, cap at three, and mint no coins", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 3; i++) f.c.record(1, { job: "wood" }, []);
    for (let i = 0; i < 2; i++) f.c.record(2, { job: "ore" }, []);
    f.db.prepare("UPDATE frontier_weeks SET completed_lines=8").run();
    assert.equal(f.c.view(2, []).seals, 0);
    f.advance(balance.weekSeconds);
    assert.equal(f.c.view(1, []).totalSeals, 3);
    f.c = f.make();
    f.c.view(1, []);
    f.c.view(1, []);
    assert.deepEqual(
      f.db
        .prepare("SELECT COUNT(*) n,SUM(coins) coins,SUM(xp) xp FROM grants")
        .get(),
      { n: 3, coins: 0, xp: 30 },
    );
    assert.equal(f.c.view(1, []).seals, 0);
  } finally {
    f.close();
  }
});
test("completed rows are derived from actual tile progress and daily weather rotates independently of views", () => {
  const f = fixture();
  try {
    for (const job of ["wood", "ore", "planks"])
      for (let i = 0; i < balance.weeklyTargets[job]; i++)
        f.c.record(1, { job }, []);
    const v = f.c.view(1, []);
    assert.equal(v.lines, 1);
    assert.equal(v.seals, 1);
    assert.equal(f.c.weather().id, "clear");
    f.advance(86400);
    assert.equal(f.c.weather().id, "rain");
    f.advance(86400);
    assert.equal(f.c.weather().id, "wind");
    f.advance(86400);
    assert.equal(f.c.weather().id, "harvest");
  } finally {
    f.close();
  }
});
test("each eligible player receives their own seal reward", () => {
  const f = fixture();
  try {
    for (const uid of [1, 2])
      for (let i = 0; i < 3; i++) f.c.record(uid, { job: "wood" }, []);
    f.db.prepare("UPDATE frontier_weeks SET completed_lines=3").run();
    for (const uid of [1, 2]) assert.equal(f.c.view(uid, []).seals, 3);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM grants").get().n, 6);
  } finally {
    f.close();
  }
});
