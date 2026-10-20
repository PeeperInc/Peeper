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
    "CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2); CREATE TABLE frontier_boss(id INTEGER PRIMARY KEY,cycle INTEGER,phase TEXT); INSERT INTO frontier_boss VALUES(1,1,'preparing'); CREATE TABLE grants(uid INTEGER,ref TEXT PRIMARY KEY,coins INTEGER,xp INTEGER);",
  );
  let time = 1700000000;
  const make = () =>
    createCampaign(
      db,
      () => time,
      (uid, ref, coins, xp) =>
        db
          .prepare("INSERT OR IGNORE INTO grants VALUES(?,?,?,?)")
          .run(uid, ref, coins, xp),
    );
  return {
    db,
    c: make(),
    make,
    advance: (s) => (time += s),
    close: () => db.close(),
  };
}
test("personal quests survive calendar changes and restarts, then reset with the journey", () => {
  const f = fixture();
  try {
    assert.equal(f.c.view(1).started_at, null);
    f.c.record(1, { job: "wood" });
    const first = f.c.view(1);
    assert.equal(first.personal, true);
    assert.equal(first.ends_at, null);
    f.advance(604800 * 6);
    f.c = f.make();
    assert.deepEqual(f.c.view(1), first);
    f.db.prepare("UPDATE frontier_boss SET phase='defeated'").run();
    f.c.record(1, { job: "wood" });
    assert.equal(f.c.view(1).points, 1);
    f.db.prepare("UPDATE frontier_boss SET cycle=2,phase='preparing'").run();
    assert.equal(f.c.view(1).points, 0);
    assert.ok(f.c.view(1).tiles.every((t) => t.progress === 0));
  } finally {
    f.close();
  }
});
test("players advance only their own quests and only roles they cleared", () => {
  const f = fixture();
  try {
    f.c.record(1, { job: "wood" });
    f.c.record(1, {
      mission: "delivery",
      roles: ["driver", "mechanic"],
      partySize: 2,
    });
    const get = (b, k) => b.tiles.find((t) => t.kind === k).progress;
    assert.equal(get(f.c.view(1), "team"), 1);
    assert.equal(get(f.c.view(1), "mechanic"), 1);
    assert.ok(f.c.view(2).tiles.every((t) => t.progress === 0));
    f.c.record(2, { mission: "delivery", roles: ["guard"], partySize: 2 });
    assert.equal(get(f.c.view(1), "guard"), 0);
    assert.equal(get(f.c.view(2), "guard"), 1);
  } finally {
    f.close();
  }
});
test("any three, six and nine completed cards pay exactly 100 each, independent of rows or order", () => {
  const f = fixture();
  try {
    const work = (kind, n) => {
      for (let i = 0; i < n; i++) f.c.record(1, { job: kind });
    };
    const deliver = (role, n, partySize = 1) => {
      for (let i = 0; i < n; i++)
        f.c.record(1, { mission: "delivery", roles: [role], partySize });
    };
    work("wood", 150);
    work("ore", 120);
    assert.equal(f.c.view(1).completed, 2);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM grants").get().n, 0);
    deliver("mechanic", 24);
    assert.equal(f.c.view(1).completed, 3);
    assert.equal(f.c.view(1).paidStages, 1);
    work("planks", 45);
    deliver("driver", 24);
    assert.equal(f.c.view(1).completed, 6);
    assert.equal(f.c.view(1).paidStages, 2);
    deliver("guard", 24);
    deliver("driver", 12, 2);
    work("wood", 135);
    const q = f.c.view(1);
    assert.equal(q.completed, 9);
    assert.equal(q.paidStages, 3);
    assert.equal(q.maxCoins, 300);
    assert.deepEqual(
      f.db
        .prepare("SELECT COUNT(*) n,SUM(coins) coins,SUM(xp) xp FROM grants")
        .get(),
      { n: 3, coins: 300, xp: 0 },
    );
    f.c = f.make();
    f.c.view(1);
    work("wood", 20);
    f.c.view(1);
    assert.equal(f.db.prepare("SELECT SUM(coins) n FROM grants").get().n, 300);
    assert.equal(f.c.view(2).paidStages, 0);
  } finally {
    f.close();
  }
});
test("previous bingo keeps earned progress, raises targets and counts past rewards toward the new cap", () => {
  const f = fixture();
  try {
    f.db.exec(
      "CREATE TABLE frontier_personal_boards(cycle INTEGER,user_id INTEGER,started_at INTEGER,layout TEXT,points INTEGER,paid_lines INTEGER,PRIMARY KEY(cycle,user_id))",
    );
    const layout = f.c
      .view(1)
      .tiles.map((t) => ({ kind: t.kind, progress: 6, target: 6 }));
    f.db
      .prepare(
        "INSERT INTO frontier_personal_boards VALUES(1,1,1700000000,?,20,5)",
      )
      .run(JSON.stringify(layout));
    f.c = f.make();
    let q = f.c.view(1);
    assert.equal(q.tiles.find((t) => t.kind === "wood").progress, 6);
    assert.equal(q.tiles.find((t) => t.kind === "wood").target, 150);
    assert.equal(q.paidStages, 3);
    assert.equal(q.legacyCredit, 500);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM grants").get().n, 0);
    for (const tile of q.tiles)
      for (let i = tile.progress; i < tile.target; i++) {
        if (["wood", "ore", "planks", "work"].includes(tile.kind))
          f.c.record(1, { job: tile.kind === "work" ? "wood" : tile.kind });
        else
          f.c.record(1, {
            mission: "delivery",
            roles: [tile.kind],
            partySize: tile.kind === "team" ? 2 : 1,
          });
      }
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM grants").get().n, 0);
    f.db.prepare("UPDATE frontier_boss SET cycle=2").run();
    q = f.c.view(1);
    assert.equal(q.paidStages, 0);
    assert.equal(q.legacyCredit, 0);
  } finally {
    f.close();
  }
});
test("quest goals fit sustained play and do not reveal hidden stages", () => {
  const f = fixture();
  try {
    const q = f.c.view(1);
    assert.equal(q.tiles.length, 9);
    assert.ok(q.tiles.every((t) => t.target >= 12));
    assert.doesNotMatch(
      JSON.stringify(q),
      /dragon|Mirewake|striker|healer|defender|season|bingo/i,
    );
    assert.deepEqual(
      q.milestones.map((m) => m.at),
      [3, 6, 9],
    );
  } finally {
    f.close();
  }
});
