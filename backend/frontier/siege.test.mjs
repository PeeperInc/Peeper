import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { gesture } from "./gesture-fixtures.mjs";
const require = createRequire(import.meta.url),
  Database = require("better-sqlite3"),
  { createEngine } = require("./engine");
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
      e.prepareBoss(1, "supplies", 900, randomUUID());
      e.prepareBoss(2, "weapons", 900, randomUUID());
      db.prepare("UPDATE frontier_players SET location='pool'").run();
    },
    hit(uid) {
      const a = e.startAssault(uid, randomUUID());
      this.advance(11);
      return e.actAssault(uid, a.id, a.challenge.nonce, gesture(a.challenge));
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
    assert.equal(f.e.prepareBoss(1, "supplies", 1000, key).accepted, 900);
    assert.equal(f.e.prepareBoss(1, "supplies", 1000, key).accepted, 900);
    assert.equal(f.e.state(1).stock.supplies, 100);
    assert.throws(
      () => f.e.prepareBoss(1, "weapons", 1000, key),
      /another contribution/,
    );
    assert.equal(f.e.state(1).boss.phase, "preparing");
    f.e.prepareBoss(2, "weapons", 1000, randomUUID());
    assert.equal(f.e.state(1).boss.phase, "open");
    assert.equal(f.e.state(1).stock.weapons, 100);
    f.restart();
    assert.equal(f.e.state(1).boss.phase, "open");
  } finally {
    f.db.close();
  }
});
test("damage persists between attempts; offline payouts exhaust the exact pool once, without last-hit bonuses", () => {
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
    assert.equal(f.e.state(1).player.coins, 151);
    assert.equal(f.e.state(2).player.coins, 150);
    const old = f.e.actAssault(
      3,
      late.id,
      late.challenge.nonce,
      gesture(late.challenge),
    );
    assert.equal(old.result.damage, 0);
    f.e.actAssault(2, last.id, "ignored", {});
    f.restart();
    assert.equal(f.e.state(2).player.coins, 150);
    assert.equal(f.e.state(3).boss.contribution, 0);
    assert.equal(f.e.state(1).boss.payout, 51);
    assert.equal(f.e.state(1).stock.supplies, 100);
    f.advance(86400);
    assert.equal(f.e.state(1).boss.phase, "preparing");
    assert.equal(f.e.state(1).boss.cycle, 2);
    assert.equal(f.e.state(1).boss.previousPayouts[0].coins, 51);
  } finally {
    f.db.close();
  }
});
test("overkill is capped and settlement rolls back all payouts if one credit fails", () => {
  const f = fixture();
  try {
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
    assert.equal(f.e.state(1).player.coins, 100);
    assert.equal(f.e.state(2).boss.contribution, 0);
    f.db.exec("DROP TRIGGER reject_payout");
    const done = f.e.actAssault(
      2,
      a.id,
      a.challenge.nonce,
      gesture(a.challenge),
    );
    assert.equal(done.result.damage, 3);
    assert.equal(f.e.state(1).player.coins, 180);
    assert.equal(f.e.state(2).player.coins, 120);
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
