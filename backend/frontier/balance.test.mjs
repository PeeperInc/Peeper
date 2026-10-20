import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3"),
  { createEngine } = require("./engine");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(
    "CREATE TABLE users(id INTEGER PRIMARY KEY,telegram_id TEXT UNIQUE,first_name TEXT,coins INTEGER);CREATE TABLE peepers(user_id INTEGER,alive INTEGER);CREATE TABLE global_messages(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1,'1','Mira',100),(2,'2','Reed',100);INSERT INTO peepers VALUES(1,1),(2,1)",
  );
  let time = 1700000000000,
    e = createEngine(db, () => time);
  e.state(1);
  e.state(2);
  return {
    db,
    get e() {
      return e;
    },
    restart() {
      e = createEngine(db, () => time);
    },
    advance(s) {
      time += s * 1000;
    },
    old() {
      db.prepare(
        "DELETE FROM frontier_balance_migrations WHERE id='2026-10-19-shorter-journey'",
      ).run();
      db.prepare(
        "UPDATE frontier_boss SET max_hp=600000,hp=600000,supplies_required=900,weapons_required=900",
      ).run();
    },
  };
}
test("fresh journeys use an 800-plank bridge, 500-item reserves and 300000 HP", () => {
  const f = fixture();
  try {
    assert.equal(
      f.e.content.projects.find((p) => p.id === "bridge").target,
      800,
    );
    const b = f.db.prepare("SELECT * FROM frontier_boss").get();
    assert.equal(b.hp, 300000);
    assert.equal(b.max_hp, 300000);
    assert.equal(b.supplies_required, 500);
    assert.equal(b.weapons_required, 500);
  } finally {
    f.db.close();
  }
});
test("home event summary reveals only the current shared objective and no reward or hidden boss", () => {
  const f = fixture();
  try {
    const initial = f.e.eventSummary();
    assert.equal(initial.phase, "bridge");
    assert.equal(initial.target, 800);
    assert.deepEqual(Object.keys(initial).sort(), [
      "active",
      "cycle",
      "name",
      "phase",
      "progress",
      "serverTime",
      "target",
    ]);
    f.db
      .prepare("UPDATE frontier_projects SET progress=200 WHERE id='bridge'")
      .run();
    assert.equal(f.e.eventSummary().progress, 200);
    f.db
      .prepare(
        "UPDATE frontier_projects SET completed_at=1,progress=800 WHERE id='bridge'",
      )
      .run();
    assert.equal(f.e.eventSummary().phase, "preparing");
    assert.equal(f.e.eventSummary().kitsTarget, 500);
    assert.equal(f.e.eventSummary().weaponsTarget, 500);
    f.db.prepare("UPDATE frontier_boss SET phase='open',hp=250000").run();
    assert.equal(f.e.eventSummary().phase, "battle");
    assert.equal(f.e.eventSummary().hp, 250000);
    f.db
      .prepare(
        "UPDATE frontier_boss SET phase='defeated',hp=0,defeated_at=1700000000",
      )
      .run();
    assert.equal(f.e.eventSummary().phase, "results");
    assert.equal(f.e.eventSummary().endsAt, 1700086400);
    assert.doesNotMatch(
      JSON.stringify(f.e.eventSummary()),
      /reward|payout|earned|coins|honors/i,
    );
    f.advance(86399);
    assert.equal(f.e.eventSummary().phase, "results");
    f.advance(1);
    assert.deepEqual(f.e.eventSummary(), { active: false });
    assert.equal(f.e.state(1).boss.phase, "defeated");
    assert.equal(f.e.state(1).projects[0].progress, 800);
  } finally {
    f.db.close();
  }
});
test("an inactive temporary event has no home-card metadata", () => {
  const f = fixture(),
    settings = f.e.content.event;
  try {
    settings.active = false;
    assert.deepEqual(f.e.eventSummary(), { active: false });
  } finally {
    settings.active = true;
    f.db.close();
  }
});
test("a live legacy journey preserves damage and receipts, caps bridge progress and refunds excess reserves only once", () => {
  const f = fixture();
  try {
    f.old();
    f.db
      .prepare(
        "UPDATE frontier_projects SET progress=3200,completed_at=42 WHERE id='bridge'",
      )
      .run();
    f.db
      .prepare(
        "UPDATE frontier_stock SET quantity=1000 WHERE item IN ('supplies','weapons')",
      )
      .run();
    const key = randomUUID();
    assert.equal(f.e.prepareBoss(1, "supplies", 900, key).accepted, 900);
    f.e.prepareBoss(2, "weapons", 900, randomUUID());
    f.db.prepare("UPDATE frontier_boss SET hp=598931").run();
    f.db.prepare("INSERT INTO frontier_boss_honors VALUES(1,1,1069)").run();
    const before = f.e.state(1);
    f.restart();
    const s = f.e.state(1);
    assert.equal(s.boss.max_hp, 300000);
    assert.equal(s.boss.hp, 298931);
    assert.equal(s.boss.phase, "open");
    assert.equal(s.boss.supplies_filled, 500);
    assert.equal(s.boss.weapons_filled, 500);
    assert.equal(s.stock.supplies, 500);
    assert.equal(s.stock.weapons, 500);
    assert.equal(s.projects.find((p) => p.id === "bridge").progress, 800);
    assert.equal(s.projects.find((p) => p.id === "bridge").completed_at, 42);
    assert.equal(s.boss.contribution, 1069);
    assert.equal(s.journey.earnedCoins, before.journey.earnedCoins);
    assert.equal(s.player.coins, before.player.coins);
    assert.equal(f.e.prepareBoss(1, "supplies", 900, key).accepted, 900);
    f.restart();
    assert.equal(f.e.state(1).stock.supplies, 500);
    assert.equal(f.e.bossView(1).hp, 298931);
  } finally {
    f.db.close();
  }
});
test("existing partial bridge progress stays absolute; meeting the smaller target completes it and opens ready reserves", () => {
  for (const progress of [799, 800, 1200]) {
    const f = fixture();
    try {
      f.old();
      f.db
        .prepare(
          "UPDATE frontier_projects SET progress=?,completed_at=NULL WHERE id='bridge'",
        )
        .run(progress);
      f.db
        .prepare(
          "UPDATE frontier_boss SET supplies_filled=500,weapons_filled=500",
        )
        .run();
      f.restart();
      const s = f.e.state(1),
        bridge = s.projects.find((p) => p.id === "bridge");
      assert.equal(bridge.progress, Math.min(800, progress));
      if (progress >= 800) {
        assert.equal(bridge.completed_at, 1700000000);
        assert.equal(s.boss.phase, "open");
        assert.equal(s.boss.opened_at, 1700000000);
      } else assert.equal(bridge.completed_at, null);
      assert.equal(s.stock.supplies, 0);
      assert.equal(s.stock.weapons, 0);
    } finally {
      f.db.close();
    }
  }
});
test("rebalance never pays by itself when saved damage already exceeds the new HP; a real final hit settles once", () => {
  const f = fixture();
  try {
    f.old();
    f.db
      .prepare(
        "UPDATE frontier_projects SET progress=3200,completed_at=1 WHERE id='bridge'",
      )
      .run();
    f.db.prepare("UPDATE frontier_boss SET phase='open',hp=200000").run();
    f.db.prepare("INSERT INTO frontier_boss_honors VALUES(1,1,400000)").run();
    f.db
      .prepare(
        "INSERT INTO frontier_journey_members(cycle,user_id,actions,activity_actions) VALUES(1,1,1,0)",
      )
      .run();
    f.db.prepare("UPDATE frontier_players SET location='pool'").run();
    f.restart();
    assert.equal(f.e.bossView(1).hp, 1);
    assert.equal(f.e.state(1).player.coins, 100);
    const key = randomUUID();
    assert.equal(f.e.hitBoss(2, "strike", key).damage, 1);
    assert.equal(f.e.bossView(1).payout, 30000);
    assert.equal(f.e.state(1).player.coins, 30100);
    assert.equal(f.e.hitBoss(2, "strike", key).duplicate, true);
    assert.equal(f.e.state(1).player.coins, 30100);
  } finally {
    f.db.close();
  }
});
test("settled legacy journeys retain paid history and never start a new cycle automatically", () => {
  const f = fixture();
  try {
    f.old();
    f.db
      .prepare(
        "UPDATE frontier_boss SET phase='defeated',hp=0,defeated_at=1700000000",
      )
      .run();
    f.db
      .prepare(
        "INSERT INTO frontier_rewards VALUES('dragon:1:1',1,77,1,'Legacy victory',1700000000)",
      )
      .run();
    f.restart();
    assert.equal(f.e.state(1).journey.payout, 77);
    assert.equal(
      f.db.prepare("SELECT max_hp FROM frontier_boss").get().max_hp,
      600000,
    );
    f.advance(259200);
    f.e.state(1);
    const b = f.db.prepare("SELECT * FROM frontier_boss").get();
    assert.equal(b.cycle, 1);
    assert.equal(b.hp, 0);
    assert.equal(b.supplies_required, 900);
    assert.equal(b.weapons_required, 900);
    assert.deepEqual(f.e.eventSummary(), { active: false });
    assert.equal(f.e.state(1).journey.payout, 77);
  } finally {
    f.db.close();
  }
});
