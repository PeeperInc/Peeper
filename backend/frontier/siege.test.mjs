import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { gesture } from "./gesture-fixtures.mjs";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3"),
  { createEngine } = require("./engine");

test("victory pays offline contributors once, shows results for one day and never restarts", () => {
  const f = fixture();
  try {
    f.db
      .prepare("UPDATE frontier_players SET location='sawmill' WHERE user_id=3")
      .run();
    const job = f.e.startJob(3, "wood", randomUUID());
    f.advance(15);
    f.e.actJob(3, job.id, 0, job.challenge.nonce, gesture(job.challenge));
    f.e.actJob(3, job.id, 0, job.challenge.nonce, gesture(job.challenge));
    f.e.cancelJob(3, job.id);
    f.open();
    assert.equal(f.e.bossView(3).actions, 1);
    f.db
      .prepare("UPDATE frontier_boss SET hp=5,max_hp=5,reward_pool=101")
      .run();
    const before = f.e.state(3).player.coins;
    f.e.hitBoss(1, "strike", randomUUID());
    const key = randomUUID();
    f.counter(2, key);
    assert.equal(f.e.bossView(3).payout, 3);
    assert.equal(f.e.bossView(3).payoutXp, 1);
    assert.equal(f.e.state(3).player.coins, before + 3);
    assert.equal(f.e.bossView(2).actions, 2);
    f.e.hitBoss(2, "strike", key);
    f.restart();
    assert.equal(f.e.bossView(2).actions, 2);
    assert.throws(
      () => f.e.startJob(3, "wood", randomUUID()),
      /event has ended/,
    );
    f.advance(86399);
    assert.equal(f.e.bossView(1).phase, "defeated");
    assert.equal(f.e.eventSummary().phase, "results");
    f.advance(1);
    const state = f.e.state(3);
    assert.deepEqual(state.event, { active: false });
    assert.equal(state.boss.phase, "defeated");
    assert.equal(state.journey.earnedCoins, 3);
    assert.ok(state.projects.every((p) => p.completed_at));
    assert.equal(state.player.location, "pool");
    assert.equal(state.player.coins, before + 3);
    const boss = f.db.prepare("SELECT * FROM frontier_boss").get();
    assert.equal(boss.cycle, 1);
    assert.equal(boss.hp, 0);
    assert.equal(boss.supplies_filled, 500);
    const settled = f.db
      .prepare("SELECT * FROM frontier_boss_cycles WHERE cycle=1")
      .get();
    assert.equal(settled.defeated_at, boss.defeated_at);
    f.advance(30 * 86400);
    f.restart();
    assert.equal(f.e.state(3).player.coins, before + 3);
    assert.deepEqual(f.e.eventSummary(), { active: false });
    assert.equal(
      f.db.prepare("SELECT cycle FROM frontier_boss").get().cycle,
      1,
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM frontier_journey_members WHERE cycle=2",
        )
        .get().n,
      0,
    );
  } finally {
    f.db.close();
  }
});

test("splitting preparation and retrying cannot inflate journey actions", () => {
  const f = fixture();
  try {
    f.unlock();
    f.db
      .prepare("UPDATE frontier_stock SET quantity=1000 WHERE item='supplies'")
      .run();
    const key = randomUUID();
    f.e.prepareBoss(1, "supplies", 1, key);
    f.e.prepareBoss(1, "supplies", 1, key);
    f.e.prepareBoss(1, "supplies", 2, randomUUID());
    assert.equal(f.e.bossView(1).actions, 1);
    assert.equal(f.e.bossView(1).earnedCoins, 0);
    f.restart();
    assert.equal(f.e.bossView(1).actions, 1);
  } finally {
    f.db.close();
  }
});

test("personal work rewards exceed 3000, ignore other players and pay offline once", () => {
  const f = fixture();
  try {
    f.db
      .prepare("UPDATE frontier_players SET location='sawmill' WHERE user_id=3")
      .run();
    let j = f.e.startJob(3, "wood", randomUUID());
    for (let i = 0; i < 1001; i++) {
      f.advance(11);
      j = f.e.actJob(3, j.id, j.step, j.challenge.nonce, gesture(j.challenge));
    }
    f.e.cancelJob(3, j.id);
    assert.equal(f.e.state(3).journey.earnedCoins, 3003);
    assert.equal(f.e.state(3).journey.activityActions, 1001);
    f.work(2);
    f.open();
    assert.equal(f.e.bossView(3).earnedCoins, 3003);
    assert.equal(f.e.bossView(2).earnedCoins, 3);
    const before = f.e.state(3).player.coins;
    f.db.prepare("UPDATE frontier_boss SET hp=1,reward_pool=1").run();
    const key = randomUUID();
    f.counter(1, key);
    assert.equal(f.e.state(3).player.coins, before + 3003);
    assert.equal(f.e.bossView(3).payout, 3003);
    f.e.hitBoss(1, "strike", key);
    f.restart();
    assert.equal(f.e.state(3).player.coins, before + 3003);
  } finally {
    f.db.close();
  }
});

test("battle reward accumulates actual damage across hits and reconnects, with no rounding per hit", () => {
  const f = fixture();
  try {
    f.open();
    for (let i = 0; i < 18; i++) {
      f.advance(9);
      f.e.hitBoss(3, "strike", randomUUID());
    }
    assert.equal(f.e.bossView(3).contribution, 36);
    assert.equal(f.e.bossView(3).earnedCoins, 0);
    f.advance(6);
    const key = randomUUID();
    f.counter(3, key);
    assert.equal(f.e.bossView(3).earnedCoins, 3);
    assert.equal(f.e.bossView(3).damageProgress, 16);
    f.e.hitBoss(3, "strike", key);
    f.restart();
    assert.equal(f.e.bossView(3).contribution, 56);
    for (let i = 0; i < 12; i++) {
      f.advance(9);
      f.e.hitBoss(3, "strike", randomUUID());
    }
    assert.equal(f.e.bossView(3).contribution, 80);
    assert.equal(f.e.bossView(3).earnedCoins, 6);
    assert.equal(f.e.state(3).player.coins, 100);
    f.advance(14);
    f.e.hitBoss(3, "dodge", randomUUID(), { direction: "right" });
    assert.equal(f.e.bossView(3).earnedCoins, 6);
  } finally {
    f.db.close();
  }
});

test("upgrading the reward cache recovers saved work and damage exactly once", () => {
  const f = fixture();
  try {
    f.work(3);
    f.work(3);
    f.open();
    f.counter(1);
    const before = f.e.state(3).player.coins;
    f.db.exec(
      "ALTER TABLE frontier_journey_members DROP COLUMN activity_actions",
    );
    f.restart();
    f.restart();
    assert.equal(f.e.bossView(3).earnedCoins, 6);
    assert.equal(f.e.bossView(3).activityActions, 2);
    assert.equal(f.e.bossView(1).contribution, 20);
    assert.equal(f.e.bossView(1).earnedCoins, 0);
    assert.equal(f.e.state(3).player.coins, before);
  } finally {
    f.db.close();
  }
});

test("already paid legacy rewards remain unchanged when the formula upgrades", () => {
  const f = fixture();
  try {
    f.work(1);
    f.open();
    f.db
      .prepare("UPDATE frontier_boss SET phase='defeated',hp=0,defeated_at=?")
      .run(f.e.now());
    f.db
      .prepare(
        "INSERT INTO frontier_rewards VALUES('dragon:1:1',1,77,1,'Legacy payout',?)",
      )
      .run(f.e.now());
    f.db.prepare("UPDATE users SET coins=coins+77 WHERE id=1").run();
    const before = f.e.state(1).player.coins;
    f.db.exec(
      "ALTER TABLE frontier_journey_members DROP COLUMN activity_actions",
    );
    f.restart();
    f.restart();
    assert.equal(f.e.bossView(1).payout, 77);
    assert.equal(f.e.bossView(1).earnedCoins, 77);
    assert.equal(f.e.state(1).player.coins, before);
  } finally {
    f.db.close();
  }
});
test("hit request identities stay idempotent after a day and across server restarts", () => {
  const f = fixture();
  try {
    f.open();
    const key = randomUUID(),
      before = f.e.bossView(1).hp;
    f.e.hitBoss(1, "strike", key);
    f.advance(86401);
    // A different accepted hit used to purge the first receipt.
    f.e.hitBoss(2, "strike", randomUUID());
    f.restart();
    const replay = f.e.hitBoss(1, "strike", key);
    assert.equal(replay.duplicate, true);
    assert.equal(f.e.bossView(1).hp, before - 4);
    assert.equal(f.e.bossView(1).actions, 2);
    f.db.prepare("UPDATE frontier_boss SET hp=1").run();
    f.advance(1.2);
    f.e.hitBoss(2, "strike", randomUUID());
    f.advance(259200);
    f.e.state(1);
    assert.equal(f.e.hitBoss(1, "strike", key).duplicate, true);
    assert.equal(f.e.bossView(1).hp, 0);
    assert.equal(f.e.bossView(1).actions, 2);
  } finally {
    f.db.close();
  }
});
test("continuous battle persists real hits, enforces cooldowns and replays requests once", () => {
  const f = fixture();
  try {
    f.open();
    const key = randomUUID(),
      before = f.e.bossView(1).hp;
    assert.equal(f.e.hitBoss(1, "strike", key).damage, 2);
    assert.equal(f.e.hitBoss(1, "strike", key).duplicate, true);
    assert.equal(f.e.bossView(1).hp, before - 2);
    assert.throws(() => f.e.hitBoss(1, "strike", randomUUID()), /recovering/);
    assert.throws(() => f.e.hitBoss(1, "heavy", key), /another action/);
    f.advance(0.42);
    assert.equal(f.e.hitBoss(1, "strike", randomUUID()).damage, 2);
    f.advance(0.42);
    assert.equal(f.e.hitBoss(1, "strike", randomUUID()).damage, 5);
    f.restart();
    assert.equal(f.e.bossView(1).contribution, 9);
    assert.throws(() => f.e.hitBoss(1, "strike", randomUUID()), /recovering/);
    f.db
      .prepare("UPDATE frontier_players SET location='village' WHERE user_id=2")
      .run();
    assert.throws(() => f.e.hitBoss(2, "strike", randomUUID()), /trail/);
  } finally {
    f.db.close();
  }
});
test("dodge receipts bind direction, allow bounded late input and preserve damage through pose migration", () => {
  const f = fixture();
  try {
    f.open();
    f.e.hitBoss(1, "strike", randomUUID());
    f.advance(3.07);
    const key = randomUUID(),
      r = f.e.hitBoss(1, "dodge", key, {
        direction: "right",
        at: f.clock() - 0.17,
      });
    assert.equal(r.perfect, true);
    assert.equal(r.fighter.lane, 1);
    assert.equal(
      f.e.hitBoss(1, "dodge", key, { direction: "right" }).duplicate,
      true,
    );
    assert.throws(
      () => f.e.hitBoss(1, "dodge", key, { direction: "left" }),
      /another action/,
    );
    f.advance(0.2);
    assert.equal(f.e.bossCombat(1).fighter.last_hurt, 0);
    f.db
      .prepare(
        "UPDATE frontier_boss_fighters SET combat_version=0 WHERE user_id=1",
      )
      .run();
    f.restart();
    assert.equal(f.e.bossCombat(1).fighter.combatVersion, 3);
    assert.equal(f.e.bossView(1).contribution, 2);
    assert.throws(
      () => f.e.hitBoss(1, "guard", randomUUID()),
      /controls changed/,
    );
  } finally {
    f.db.close();
  }
});
test("swiping avoids hits, counters deal damage and a saved ten-second stun survives restart", () => {
  const f = fixture();
  try {
    f.open();
    f.e.bossCombat(1);
    f.advance(2.8);
    const dodge = f.e.hitBoss(1, "dodge", randomUUID(), { direction: "right" });
    assert.equal(dodge.perfect, true);
    assert.equal(f.e.hitBoss(1, "strike", randomUUID()).damage, 20);
    f.advance(0.5);
    assert.equal(f.e.bossCombat(1).fighter.stagger_until, 0);
    const next = f.e.bossCombat(1).fighter.next_attack;
    f.advance(next - f.clock() + 0.2);
    assert.equal(f.e.bossCombat(1).fighter.incoming, 1);
    assert.throws(() => f.e.hitBoss(1, "strike", randomUUID()), /Stunned/);
    assert.throws(
      () => f.e.hitBoss(1, "dodge", randomUUID(), { direction: "left" }),
      /Stunned/,
    );
    const until = f.e.bossCombat(1).fighter.stagger_until;
    const damage = f.e.bossView(1).contribution;
    f.advance(8.1);
    f.restart();
    assert.equal(f.e.bossCombat(1).fighter.stagger_until, until);
    assert.equal(f.e.bossView(1).contribution, damage);
    assert.throws(() => f.e.hitBoss(1, "strike", randomUUID()), /Stunned/);
    f.advance(until - f.clock() - 0.001);
    assert.throws(() => f.e.hitBoss(1, "strike", randomUUID()), /Stunned/);
    f.advance(0.002);
    assert.equal(f.e.bossCombat(1).fighter.hp, 100);
    assert.equal(f.e.hitBoss(1, "strike", randomUUID()).damage, 2);
  } finally {
    f.db.close();
  }
});

test("live final hit credits actual damage and pays completed damage blocks once", () => {
  const f = fixture();
  try {
    f.open();
    f.db
      .prepare("UPDATE frontier_boss SET hp=41,max_hp=41,reward_pool=101")
      .run();
    f.counter(1);
    f.advance(7.2);
    f.counter(1);
    const key = randomUUID();
    assert.equal(f.counter(2, key).damage, 1);
    assert.equal(f.e.bossView(1).phase, "defeated");
    assert.equal(f.db.prepare("SELECT SUM(coins) n FROM users").get().n, 303);
    assert.equal(f.e.hitBoss(2, "strike", key).duplicate, true);
    assert.equal(f.db.prepare("SELECT SUM(coins) n FROM users").get().n, 303);
  } finally {
    f.db.close();
  }
});
function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(
    `CREATE TABLE users(id INTEGER PRIMARY KEY,telegram_id TEXT,first_name TEXT,coins INTEGER);CREATE TABLE peepers(user_id INTEGER,slot_head TEXT,slot_body TEXT,slot_face TEXT,slot_hands TEXT,slot_fren TEXT,alive INTEGER);CREATE TABLE global_messages(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1,'1','A',100),(2,'2','B',100),(3,'3','C',100);`,
  );
  let t = 1700000000000;
  let e = createEngine(db, () => t);
  for (let i = 1; i < 4; i++) e.state(i);
  return {
    db,
    get e() {
      return e;
    },
    advance(s) {
      t += s * 1000;
    },
    clock() {
      return t / 1000;
    },
    counter(uid, key = randomUUID()) {
      const f = e.bossCombat(uid).fighter;
      db.prepare(
        "UPDATE frontier_boss_fighters SET attack_target=lane,next_attack=?,last_seen=?,dodge_ready=0,perfect_index=-1,stagger_until=0 WHERE user_id=?",
      ).run(t / 1000 + 1, t / 1000, uid);
      this.advance(0.8);
      const dodge = e.hitBoss(uid, "dodge", randomUUID(), {
        direction: f.lane === 0 ? "right" : "left",
      });
      assert.equal(dodge.perfect, true);
      return e.hitBoss(uid, "strike", key);
    },
    restart() {
      e = createEngine(db, () => t);
    },
    unlock() {
      db.prepare(
        "UPDATE frontier_projects SET completed_at=1 WHERE id='bridge'",
      ).run();
    },
    open() {
      this.unlock();
      db.prepare(
        "UPDATE frontier_stock SET quantity=1000 WHERE item IN ('supplies','weapons')",
      ).run();
      e.prepareBoss(1, "supplies", 500, randomUUID());
      e.prepareBoss(2, "weapons", 500, randomUUID());
      db.prepare("UPDATE frontier_players SET location='pool'").run();
    },
    hit(uid) {
      const a = e.startAssault(uid, randomUUID());
      this.advance(11);
      return e.actAssault(uid, a.id, a.challenge.nonce, gesture(a.challenge));
    },
    work(uid) {
      db.prepare(
        "UPDATE frontier_players SET location='sawmill' WHERE user_id=?",
      ).run(uid);
      const j = e.startJob(uid, "wood", randomUUID());
      this.advance(15);
      e.actJob(uid, j.id, 0, j.challenge.nonce, gesture(j.challenge));
      e.cancelJob(uid, j.id);
    },
  };
}
test("bridge reveals preparation; both reserves are required, capped and idempotent", () => {
  const f = fixture();
  try {
    assert.equal(f.e.state(1).boss, null);
    assert.throws(() => f.e.startAssault(1, randomUUID()), /bridge/);
    f.unlock();
    assert.equal(f.e.state(1).boss.phase, "preparing");
    assert.throws(() => f.e.startAssault(1, randomUUID()), /equipped/);
    f.db
      .prepare(
        "UPDATE frontier_stock SET quantity=1000 WHERE item IN ('supplies','weapons')",
      )
      .run();
    const key = randomUUID();
    assert.equal(f.e.prepareBoss(1, "supplies", 1000, key).accepted, 500);
    assert.equal(f.e.prepareBoss(1, "supplies", 1000, key).accepted, 500);
    assert.equal(f.e.state(1).stock.supplies, 500);
    assert.throws(
      () => f.e.prepareBoss(1, "weapons", 1000, key),
      /another contribution/,
    );
    assert.equal(f.e.state(1).boss.phase, "preparing");
    f.e.prepareBoss(2, "weapons", 1000, randomUUID());
    assert.equal(f.e.state(1).boss.phase, "open");
    assert.equal(f.e.state(1).stock.weapons, 500);
    f.restart();
    assert.equal(f.e.state(1).boss.phase, "open");
  } finally {
    f.db.close();
  }
});
test("damage persists between attempts; small damage cannot mint a full block or a last-hit bonus", () => {
  const f = fixture();
  try {
    f.open();
    f.db
      .prepare("UPDATE frontier_boss SET hp=24,max_hp=24,reward_pool=101")
      .run();
    const late = f.e.startAssault(3, randomUUID());
    const first = f.hit(1);
    assert.equal(first.result.damage, 12);
    assert.equal(f.e.state(1).player.coins, 100);
    f.restart();
    assert.equal(f.e.state(1).boss.contribution, 12);
    const last = f.hit(2);
    assert.equal(last.result.damage, 12);
    assert.equal(last.result.killed, true);
    assert.equal(f.e.state(1).player.coins, 100);
    assert.equal(f.e.state(2).player.coins, 100);
    const old = f.e.actAssault(
      3,
      late.id,
      late.challenge.nonce,
      gesture(late.challenge),
    );
    assert.equal(old.result.damage, 0);
    f.e.actAssault(2, last.id, "ignored", {});
    f.restart();
    assert.equal(f.e.state(2).player.coins, 100);
    assert.equal(f.e.state(3).boss.contribution, 0);
    assert.equal(f.e.state(1).boss.payout, 0);
    assert.equal(f.e.state(1).stock.supplies, 500);
    f.advance(259200);
    assert.deepEqual(f.e.state(1).event, { active: false });
    assert.equal(f.e.state(1).boss.phase, "defeated");
    assert.equal(
      f.db.prepare("SELECT cycle FROM frontier_boss").get().cycle,
      1,
    );
    assert.equal(
      f.db
        .prepare("SELECT coins FROM frontier_rewards WHERE ref='dragon:1:1'")
        .get().coins,
      0,
    );
  } finally {
    f.db.close();
  }
});
test("overkill is capped and settlement rolls back all payouts if one credit fails", () => {
  const f = fixture();
  try {
    f.work(1);
    f.work(2);
    f.open();
    f.db
      .prepare("UPDATE frontier_boss SET hp=15,max_hp=15,reward_pool=100")
      .run();
    f.hit(1);
    const a = f.e.startAssault(2, randomUUID());
    f.advance(11);
    f.db.exec(
      "CREATE TRIGGER reject_payout BEFORE UPDATE OF coins ON users WHEN NEW.id=2 AND NEW.coins>OLD.coins BEGIN SELECT RAISE(ABORT,'credit unavailable'); END;",
    );
    assert.throws(
      () => f.e.actAssault(2, a.id, a.challenge.nonce, gesture(a.challenge)),
      /credit unavailable/,
    );
    assert.equal(f.e.state(1).boss.hp, 3);
    assert.equal(f.e.state(1).player.coins, 101);
    assert.equal(f.e.state(2).boss.contribution, 0);
    f.db.exec("DROP TRIGGER reject_payout");
    const done = f.e.actAssault(
      2,
      a.id,
      a.challenge.nonce,
      gesture(a.challenge),
    );
    assert.equal(done.result.damage, 3);
    assert.equal(f.e.state(1).player.coins, 104);
    assert.equal(f.e.state(2).player.coins, 104);
  } finally {
    f.db.close();
  }
});
test("abandoned, accelerated, foreign and expired attacks cannot add damage or strand a commitment", () => {
  const f = fixture();
  try {
    f.open();
    const a = f.e.startAssault(1, randomUUID());
    assert.throws(
      () => f.e.actAssault(2, a.id, a.challenge.nonce, gesture(a.challenge)),
      /not found/,
    );
    assert.throws(
      () => f.e.actAssault(1, a.id, a.challenge.nonce, gesture(a.challenge)),
      /gesture/,
    );
    assert.throws(() => f.e.startJob(1, "wood", randomUUID()), /Finish/);
    f.e.cancelAssault(1, a.id);
    assert.equal(f.e.state(1).assault, null);
    const b = f.e.startAssault(1, randomUUID());
    f.advance(61);
    assert.equal(f.e.assault(1, b.id).status, "expired");
    assert.equal(f.e.state(1).assault, null);
    assert.equal(f.e.state(1).boss.contribution, 0);
  } finally {
    f.db.close();
  }
});

test("legacy migration refunds old kit recipes and patrols once, retaining old honors without paying them", () => {
  const f = fixture();
  try {
    f.db
      .prepare("UPDATE frontier_boss SET siege_version=0,hp=800,cycle=7")
      .run();
    f.db.prepare("INSERT INTO frontier_boss_honors VALUES(7,1,99)").run();
    f.db
      .prepare(
        "INSERT INTO frontier_missions(id,owner_id,request_key,kind,created_at,challenge,cargo) VALUES('legacy',1,'old-patrol','boss',1,'{}',2)",
      )
      .run();
    f.db
      .prepare(
        "INSERT INTO frontier_jobs(id,user_id,request_key,kind,started_at,ends_at,challenge) VALUES('old-kit',2,'old-work','supplies',1,9999999999,'{}')",
      )
      .run();
    f.db
      .prepare(
        "INSERT INTO frontier_commitments VALUES(1,'mission','legacy'),(2,'job','old-kit')",
      )
      .run();
    f.restart();
    assert.equal(
      f.db.prepare("SELECT cycle FROM frontier_boss").get().cycle,
      8,
    );
    assert.equal(f.e.state(1).stock.supplies, 2);
    assert.equal(f.e.state(2).stock.ore, 2);
    assert.equal(f.e.state(2).stock.wood, 1);
    assert.equal(f.e.state(1).mission, null);
    assert.equal(f.e.state(2).job, null);
    assert.equal(
      f.db
        .prepare("SELECT contribution FROM frontier_boss_honors WHERE cycle=7")
        .get().contribution,
      99,
    );
    f.restart();
    assert.equal(f.e.state(1).stock.supplies, 2);
    assert.equal(f.e.state(1).player.coins, 100);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM frontier_rewards").get().n,
      0,
    );
  } finally {
    f.db.close();
  }
});
