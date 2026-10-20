import { gesture } from "./gesture-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { createEngine } = require("./engine");

test("planks retain their explicit recipe yield and coin emission rate", () => {
  const f = fixture();
  try {
    seed(f);
    f.db
      .prepare(
        "UPDATE frontier_projects SET progress=6400,completed_at=1 WHERE id='mill'",
      )
      .run();
    const j = completeJob(f, 1, "planks");
    assert.equal(j.result.quantity, 2);
    assert.equal(j.result.coins, 1);
    assert.equal(f.e.state(1).stock.planks, 22);
  } finally {
    f.close();
  }
});

test("delivery overflow returns to stores without teleporting to the next site and completed worlds retain a paid maintenance loop", () => {
  const f = fixture();
  try {
    seed(f);
    f.db
      .prepare("UPDATE frontier_projects SET progress=799 WHERE id='bridge'")
      .run();
    completeMission(
      f,
      f.e.createMission(1, "delivery", "driver", randomUUID()),
    );
    assert.equal(
      f.e.state(1).projects.find((p) => p.id === "bridge").progress,
      800,
    );
    assert.equal(f.e.state(1).boss.phase, "preparing");
    f.db
      .prepare(
        "UPDATE frontier_projects SET progress=6400,completed_at=1 WHERE id='mill'",
      )
      .run();
    go(f, 1, "village");
    const maintenance = f.e.createMission(
      1,
      "delivery",
      "driver",
      randomUUID(),
    );
    assert.equal(maintenance.project_id, null);
    assert.equal(completeMission(f, maintenance).result.passed, true);
    assert.equal(f.e.state(1).player.coins, 101);
  } finally {
    f.close();
  }
});

test("retired boss lobbies cannot reserve kits or bypass expedition preparation", () => {
  const f = fixture();
  try {
    seed(f);
    assert.throws(
      () => f.e.createMission(1, "boss", "driver", randomUUID()),
      /retired/,
    );
    assert.equal(f.e.state(1).stock.supplies, 20);
    assert.equal(f.e.state(1).mission, null);
  } finally {
    f.close();
  }
});
function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(
    `CREATE TABLE users(id INTEGER PRIMARY KEY,telegram_id TEXT UNIQUE,first_name TEXT,coins INTEGER); CREATE TABLE peepers(id INTEGER PRIMARY KEY,user_id INTEGER,slot_head TEXT,slot_body TEXT,slot_face TEXT,slot_hands TEXT,slot_fren TEXT,alive INTEGER); CREATE TABLE global_messages(id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1,'old','Mira',100),(2,'other','Boggy',100),(3,'third','Fern',100),(4,'fourth','Reed',100);`,
  );
  let time = 1700000000000;
  const engine = createEngine(db, () => time);
  for (let i = 1; i <= 4; i++) engine.state(i);
  return {
    db,
    e: engine,
    set: (t) => (time = t * 1000),
    advance: (s) => (time += s * 1000),
    close: () => db.close(),
  };
}
function go(f, uid, to) {
  const trip = f.e.travel(uid, to);
  if (trip) f.set(trip.arrives_at);
  f.e.state(uid);
}
function startWork(f, uid, kind, key) {
  if (!f.e.state(uid).job && !f.e.state(uid).mission)
    go(f, uid, f.e.content.jobs[kind].location);
  return f.e.startJob(uid, kind, key);
}
function unlock(f) {
  f.db
    .prepare(
      "UPDATE frontier_projects SET completed_at=1,progress=CASE id WHEN 'bridge' THEN 800 ELSE 6400 END",
    )
    .run();
}
function completeJob(f, uid, kind) {
  let j = startWork(f, uid, kind, randomUUID());
  for (let i = 0; i < 15 && j.status === "active"; i++) {
    f.set(j.started_at + i * 12 + 11);
    j = f.e.actJob(uid, j.id, i, j.challenge.nonce, gesture(j.challenge));
    if (j.continuous && j.successes >= (kind === "planks" ? 2 : 3)) {
      j = f.e.cancelJob(uid, j.id);
      break;
    }
  }
  return f.e.resumeJob(uid, j.id);
}
function seed(f) {
  f.db.prepare("UPDATE frontier_stock SET quantity=20").run();
}

test("continuous gathering banks every round, stays open after three and never double-pays on exit", () => {
  const f = fixture();
  try {
    let j = startWork(f, 1, "wood", randomUUID());
    for (let i = 0; i < 4; i++) {
      f.advance(15);
      // A complete, idle recording is valid input but cannot earn timber.
      const bad = { events: [[300, 7, 0, 0]] };
      j = f.e.actJob(1, j.id, j.step, j.challenge.nonce, bad);
      assert.equal(j.target, 1);
      assert.equal(j.successes, 0);
    }
    for (let i = 0; i < 3; i++) {
      f.advance(11);
      const before = j;
      j = f.e.actJob(1, j.id, j.step, j.challenge.nonce, gesture(j.challenge));
      f.e.actJob(
        1,
        j.id,
        before.step,
        before.challenge.nonce,
        gesture(before.challenge),
      );
    }
    assert.equal(j.status, "active");
    assert.equal(f.e.state(1).stock.wood, 3);
    assert.equal(f.e.state(1).player.coins, 103);
    j = f.e.cancelJob(1, j.id);
    assert.equal(j.result.quantity, 3);
    assert.equal(f.e.state(1).job, null);
    f.e.cancelJob(1, j.id);
    assert.equal(f.e.state(1).stock.wood, 3);
    assert.equal(f.e.state(1).player.coins, 103);
  } finally {
    f.close();
  }
});

test("gathering pays per extraction with no coin interval and keeps already banked ore on expiry", () => {
  const f = fixture();
  try {
    let j = startWork(f, 1, "ore", randomUUID());
    f.advance(11);
    j = f.e.actJob(1, j.id, 0, j.challenge.nonce, gesture(j.challenge));
    j = f.e.cancelJob(1, j.id);
    assert.equal(j.result.quantity, 1);
    assert.equal(j.result.coins, 1);
    assert.equal(f.e.state(1).stock.ore, 1);
    const next = completeJob(f, 1, "ore");
    assert.equal(next.result.quantity, 3);
    assert.equal(next.result.coins, 3);
    assert.equal(f.e.state(1).stock.ore, 4);
    assert.equal(completeJob(f, 1, "ore").result.coins, 3);
    j = startWork(f, 1, "ore", randomUUID());
    f.advance(11);
    j = f.e.actJob(1, j.id, 0, j.challenge.nonce, gesture(j.challenge));
    f.set(j.ends_at);
    assert.equal(f.e.resumeJob(1, j.id).result.quantity, 1);
    assert.equal(f.e.state(1).stock.ore, 8);
  } finally {
    f.close();
  }
});

test("short production loop transforms gathered timber into delivered bridge progress", () => {
  const f = fixture();
  try {
    completeJob(f, 1, "wood");
    completeJob(f, 1, "wood");
    completeJob(f, 1, "ore");
    assert.equal(f.e.state(1).stock.wood, 6);
    const crafted = completeJob(f, 1, "planks");
    assert.equal(crafted.result.quantity, 2);
    assert.equal(f.e.state(1).stock.wood, 0);
    const party = f.e.createMission(1, "delivery", "driver", randomUUID());
    assert.equal(f.e.state(1).stock.planks, 0);
    assert.equal(completeMission(f, party).result.passed, true);
    const state = f.e.state(1);
    assert.equal(state.projects.find((p) => p.id === "bridge").progress, 2);
    assert.equal(state.player.location, "bridge");
    assert.equal(state.boss, null);
    assert.throws(() => f.e.travel(1, "mill"), /blocked/);
  } finally {
    f.close();
  }
});
function completeMission(f, m, uids = [1]) {
  m = f.e.depart(m.owner_id, m.id);
  for (let i = 0; i < 5 && m.status === "active"; i++) {
    const round = m.round;
    f.advance(11);
    for (const uid of uids) {
      const v = f.e.mission(uid, m.id);
      if (
        v.status === "active" &&
        v.round === round &&
        v.challenge &&
        v.acted === null
      )
        f.e.actMission(
          uid,
          m.id,
          round,
          v.challenge.nonce,
          gesture(v.challenge),
        );
    }
    m = f.e.mission(m.owner_id, m.id);
    if (m.status === "active" && m.round === round) {
      f.set(m.nextAt);
      m = f.e.mission(m.owner_id, m.id);
    }
  }
  return m;
}

test("work pays once, adds community materials, and preserves unrelated account data", () => {
  const f = fixture();
  try {
    let j = completeJob(f, 1, "wood");
    assert.equal(j.result.coins, 3);
    assert.equal(f.e.state(1).stock.wood, 3);
    assert.equal(f.e.state(1).player.coins, 103);
    f.e.actJob(1, j.id, 14, "old", "OAK");
    assert.equal(f.e.state(1).player.coins, 103);
    assert.equal(
      f.db.prepare("SELECT telegram_id FROM users WHERE id=1").get()
        .telegram_id,
      "old",
    );
  } finally {
    f.close();
  }
});
test("premature, forged, cross-account and replayed work actions cannot mint coins", () => {
  const f = fixture();
  try {
    let j = startWork(f, 1, "wood", randomUUID());
    assert.throws(
      () => f.e.actJob(1, j.id, 0, j.challenge.nonce, gesture(j.challenge)),
      /moment/,
    );
    assert.throws(
      () => f.e.actJob(2, j.id, 0, j.challenge.nonce, gesture(j.challenge)),
      /not found/,
    );
    f.advance(2);
    assert.throws(() => f.e.actJob(1, j.id, 0, "forged", "OAK"), /expired/);
    assert.throws(
      () => f.e.actJob(1, j.id, 0, j.challenge.nonce, gesture(j.challenge)),
      /gesture/,
    );
    f.advance(9);
    const n = f.e.actJob(1, j.id, 0, j.challenge.nonce, gesture(j.challenge));
    assert.equal(
      f.e.actJob(1, j.id, 0, j.challenge.nonce, gesture(j.challenge)).step,
      1,
    );
    assert.throws(
      () => f.e.actJob(1, j.id, 1, n.challenge.nonce, gesture(n.challenge)),
      /moment/,
    );
    assert.equal(f.e.state(1).player.coins, 101);
  } finally {
    f.close();
  }
});
test("craft reservations refund on cancellation and unattended expiry", () => {
  const f = fixture();
  try {
    seed(f);
    unlock(f);
    const j = startWork(f, 1, "supplies", randomUUID());
    assert.equal(f.e.state(1).stock.ore, 19);
    f.e.cancelJob(1, j.id);
    f.e.cancelJob(1, j.id);
    assert.equal(f.e.state(1).stock.ore, 20);
    const k = startWork(f, 1, "planks", randomUUID());
    f.advance(181);
    assert.equal(f.e.resumeJob(1, k.id).result.passed, false);
    assert.equal(f.e.state(1).stock.wood, 20);
  } finally {
    f.close();
  }
});
test("request identity and single commitment prevent duplicate material reservations", () => {
  const f = fixture();
  try {
    seed(f);
    const key = randomUUID();
    const j = startWork(f, 1, "planks", key);
    assert.equal(startWork(f, 1, "planks", key).id, j.id);
    assert.equal(f.e.state(1).stock.wood, 17);
    assert.equal(f.e.state(1).stock.ore, 19);
    assert.throws(
      () => f.e.createMission(1, "delivery", "driver", randomUUID()),
      /current activity/,
    );
    f.e.cancelJob(1, j.id);
    assert.equal(startWork(f, 1, "planks", key).status, "abandoned");
  } finally {
    f.close();
  }
});
test("public roles are exclusive and a cancelled organizer refunds exactly once", () => {
  const f = fixture();
  try {
    seed(f);
    const m = f.e.createMission(1, "delivery", "driver", randomUUID());
    f.e.joinMission(2, m.id, "guard");
    assert.throws(() => f.e.joinMission(3, m.id, "guard"), /taken/);
    f.e.joinMission(3, m.id, "mechanic");
    assert.throws(() => f.e.depart(2, m.id), /organizer/);
    f.e.leave(1, m.id);
    assert.equal(f.e.state(1).stock.planks, 20);
    assert.equal(f.e.state(2).mission, null);
    f.advance(1000);
    f.e.tick();
    assert.equal(f.e.state(1).stock.planks, 20);
  } finally {
    f.close();
  }
});
test("cooperative delivery settles shared progression and individual rewards once", () => {
  const f = fixture();
  try {
    seed(f);
    const m = f.e.createMission(1, "delivery", "driver", randomUUID());
    f.e.joinMission(2, m.id, "guard");
    f.e.joinMission(3, m.id, "mechanic");
    const result = completeMission(f, m, [1, 2, 3]);
    assert.equal(result.result.passed, true);
    assert.equal(f.e.state(1).projects[0].progress, 10);
    for (const uid of [1, 2, 3]) assert.equal(f.e.state(uid).player.coins, 101);
    f.e.tick();
    assert.equal(f.e.state(1).projects[0].progress, 10);
  } finally {
    f.close();
  }
});
test("offline missions expire without an AFK payout and preserve reservations", () => {
  const f = fixture();
  try {
    seed(f);
    const m = f.e.createMission(1, "delivery", "driver", randomUUID());
    f.e.depart(1, m.id);
    f.advance(500);
    const result = f.e.mission(1, m.id);
    assert.equal(result.result.passed, false);
    assert.equal(f.e.state(1).player.coins, 100);
    assert.equal(f.e.state(1).stock.planks, 20);
    assert.equal(f.e.state(1).mission, null);
  } finally {
    f.close();
  }
});
test("restart resumes a persisted mission and account transfer preserves world ownership", () => {
  const f = fixture();
  try {
    seed(f);
    let m = f.e.createMission(1, "delivery", "driver", randomUUID());
    m = f.e.depart(1, m.id);
    f.advance(11);
    let v = f.e.mission(1, m.id);
    f.e.actMission(1, m.id, 0, v.challenge.nonce, gesture(v.challenge));
    f.db.prepare("UPDATE users SET telegram_id='replacement' WHERE id=1").run();
    const restart = createEngine(f.db, () => (m.started_at + 17) * 1000);
    const state = restart.state(1);
    assert.equal(state.mission.id, m.id);
    assert.equal(state.mission.round, 1);
    assert.equal(state.mission.members[0].successes, 1);
  } finally {
    f.close();
  }
});
test("retired map accessories cannot charge or equip anything", () => {
  const f = fixture();
  try {
    for (const item of ["blue-pennant", "reed-crown", null])
      assert.throws(
        () => f.e.cosmetic(1, item),
        (e) => e.status === 410,
      );
    assert.equal(f.e.state(1).player.coins, 100);
  } finally {
    f.close();
  }
});

test("travel and assembly cannot bypass world progression or teleport a party", () => {
  const f = fixture();
  try {
    assert.equal(f.e.state(1).boss, null);
    assert.throws(() => f.e.travel(1, "mill"), /blocked/);
    assert.throws(() => f.e.travel(1, "pool"), /blocked/);
    assert.throws(() => f.e.startJob(1, "wood", randomUUID()), /workshop/);
    let trip = f.e.travel(1, "sawmill");
    assert.throws(() => f.e.startJob(1, "wood", randomUUID()), /travelling/);
    f.set(trip.arrives_at);
    assert.equal(f.e.state(1).player.location, "sawmill");
    seed(f);
    assert.throws(
      () => f.e.createMission(1, "delivery", "driver", randomUUID()),
      /Crooked Post/,
    );
    const m = f.e.createMission(2, "delivery", "driver", randomUUID());
    f.e.joinMission(1, m.id, "guard");
    assert.equal(f.e.state(1).player.travel.to, "village");
    assert.throws(() => f.e.depart(2, m.id), /arrive/);
    f.set(f.e.state(1).player.travel.arrives_at);
    f.e.depart(2, m.id);
    assert.equal(f.e.state(1).player.travel.to, "bridge");
    assert.ok(f.e.state(1).player.travel.path.every((p) => p[0] <= 0.589));
  } finally {
    f.close();
  }
});
test("bridge reveals dragon and both craft shops; attacking requires both reserves", () => {
  const f = fixture();
  try {
    seed(f);
    unlock(f);
    go(f, 1, "mill");
    assert.equal(f.e.state(1).boss.phase, "preparing");
    const kits = completeJob(f, 1, "supplies");
    assert.equal(kits.result.quantity, 3);
    const weapons = completeJob(f, 1, "weapons");
    assert.equal(weapons.result.quantity, 3);
    assert.equal(f.e.state(1).stock.ore, 8);
    go(f, 1, "pool");
    assert.throws(() => f.e.startAssault(1, randomUUID()), /equipped/);
  } finally {
    f.close();
  }
});

test("distant completed delivery leaves contributors at its actual destination", () => {
  const f = fixture();
  try {
    seed(f);
    const m = f.e.createMission(1, "delivery", "driver", randomUUID());
    completeMission(f, m);
    assert.equal(f.e.state(1).player.location, "bridge");
    assert.equal(f.e.state(1).player.travel, null);
    assert.throws(
      () => f.e.createMission(1, "delivery", "driver", randomUUID()),
      /Crooked Post/,
    );
  } finally {
    f.close();
  }
});
test("community contributions are awarded once for successful work, never for cancellation or idle expiry", () => {
  const f = fixture();
  try {
    const finished = completeJob(f, 1, "wood");
    assert.equal(f.e.state(1).commons.points, 3);
    f.e.resumeJob(1, finished.id);
    f.e.tick();
    f.e.state(1);
    assert.equal(f.e.state(1).commons.points, 3);
    const cancelled = startWork(f, 1, "wood", randomUUID());
    f.e.cancelJob(1, cancelled.id);
    const idle = startWork(f, 1, "wood", randomUUID());
    f.set(idle.ends_at);
    f.e.tick();
    assert.equal(f.e.state(1).commons.points, 3);
    assert.equal(f.e.state(1).player.coins, 103);
  } finally {
    f.close();
  }
});
test("a successful two-person caravan contributes once for each eligible role", () => {
  const f = fixture();
  try {
    seed(f);
    const m = f.e.createMission(1, "delivery", "driver", randomUUID());
    f.e.joinMission(2, m.id, "guard");
    completeMission(f, m, [1, 2]);
    f.e.tick();
    for (const uid of [1, 2]) assert.equal(f.e.state(uid).commons.points, 1);
    const tiles = f.e.state(1).commons.tiles;
    assert.equal(tiles.find((t) => t.kind === "team").progress, 1);
    assert.equal(tiles.find((t) => t.kind === "delivery").progress, 1);
    assert.equal(tiles.find((t) => t.kind === "driver").progress, 1);
    assert.equal(tiles.find((t) => t.kind === "guard").progress, 0);
  } finally {
    f.close();
  }
});

test("solo delivery rotates tasks and settles immediately after its final submitted result", () => {
  const f = fixture();
  try {
    seed(f);
    let m = f.e.depart(
      1,
      f.e.createMission(1, "delivery", "mechanic", randomUUID()).id,
    );
    const started = m.started_at;
    for (let round = 0; round < 3; round++) {
      assert.equal(m.activeRole, ["driver", "guard", "mechanic"][round]);
      assert.equal(m.challenge.kind, ["drive", "guard", "crank"][round]);
      f.advance(11);
      m = f.e.actMission(
        1,
        m.id,
        round,
        m.challenge.nonce,
        gesture(m.challenge),
      );
    }
    assert.equal(m.status, "done");
    assert.equal(m.result.delivered, 2);
    assert.equal(f.e.now() - started, 33);
    assert.equal(m.result.payments[1], 1);
  } finally {
    f.close();
  }
});

test("two players reserve four, split three tasks and deliver six; idle crewmates cannot earn a bonus", () => {
  const f = fixture();
  try {
    seed(f);
    let m = f.e.createMission(1, "delivery", "driver", randomUUID(), "wagon");
    assert.equal(m.cargo, 2);
    assert.equal(f.e.state(1).stock.planks, 18);
    assert.throws(() => f.e.depart(1, m.id), /two people/);
    m = f.e.joinMission(2, m.id, "guard");
    assert.equal(m.reservedPlanks, 4);
    assert.equal(m.plannedCargo, 6);
    assert.deepEqual(m.members.find((p) => p.user_id === 1).tasks, [
      "driver",
      "mechanic",
    ]);
    assert.deepEqual(m.members.find((p) => p.user_id === 2).tasks, ["guard"]);
    assert.equal(completeMission(f, m, [1]).result.passed, false);
    assert.equal(f.e.state(1).stock.planks, 20);
    assert.equal(f.e.state(1).player.coins, 100);
    m = f.e.createMission(1, "delivery", "driver", randomUUID(), "wagon");
    f.e.joinMission(2, m.id, "guard");
    const delivered = completeMission(f, m, [1, 2]);
    assert.equal(delivered.result.delivered, 6);
    assert.equal(delivered.result.spent, 4);
    assert.equal(delivered.result.bonus, 2);
    assert.equal(f.e.state(1).stock.planks, 16);
    assert.equal(
      delivered.members.reduce((s, p) => s + p.actions, 0),
      3,
    );
    assert.equal(f.e.state(1).projects[0].progress, 6);
  } finally {
    f.close();
  }
});

test("three players each play once, spend six and deliver ten without a final wait", () => {
  const f = fixture();
  try {
    seed(f);
    const m = f.e.createMission(1, "delivery", "driver", randomUUID(), "wagon");
    f.e.joinMission(2, m.id, "guard");
    f.e.joinMission(3, m.id, "mechanic");
    const result = completeMission(f, m, [1, 2, 3]);
    assert.equal(result.status, "done");
    assert.equal(result.totalRounds, 1);
    assert.equal(result.result.delivered, 10);
    assert.equal(result.result.spent, 6);
    assert.equal(result.result.bonus, 4);
    assert.ok(result.members.every((p) => p.actions === 1));
    assert.equal(f.e.state(1).stock.planks, 14);
    f.e.tick();
    assert.equal(f.e.state(1).projects[0].progress, 10);
  } finally {
    f.close();
  }
});

test("joining and leaving reserve exactly two; retries, capacity and insufficient stores cannot mint planks", () => {
  const f = fixture();
  try {
    seed(f);
    const request = randomUUID();
    const m = f.e.createMission(1, "delivery", "driver", request, "wagon");
    f.e.joinMission(2, m.id, "guard");
    f.e.joinMission(2, m.id, "guard");
    assert.equal(
      f.e.createMission(1, "delivery", "driver", request, "wagon").id,
      m.id,
    );
    assert.throws(
      () => f.e.createMission(1, "delivery", "driver", request, "cart"),
      /different journey/,
    );
    assert.equal(f.e.state(1).stock.planks, 16);
    f.e.leave(2, m.id);
    assert.equal(f.e.state(1).stock.planks, 18);
    assert.equal(f.e.mission(1, m.id).plannedCargo, 2);
    f.db
      .prepare("UPDATE frontier_stock SET quantity=1 WHERE item='planks'")
      .run();
    assert.throws(() => f.e.joinMission(2, m.id, "guard"), /more planks/);
    assert.equal(f.e.state(2).mission, null);
    f.e.leave(1, m.id);
    assert.equal(f.e.state(1).stock.planks, 3);
    f.advance(1000);
    f.e.tick();
    assert.equal(f.e.state(1).stock.planks, 3);
  } finally {
    f.close();
  }
});

test("plank recipe requires iron and refunds both ingredients exactly once", () => {
  const f = fixture();
  try {
    f.db
      .prepare("UPDATE frontier_stock SET quantity=6 WHERE item='wood'")
      .run();
    assert.throws(() => f.e.startJob(1, "planks", randomUUID()), /more ore/);
    assert.equal(f.e.state(1).stock.wood, 6);
    f.db.prepare("UPDATE frontier_stock SET quantity=2 WHERE item='ore'").run();
    const j = f.e.startJob(1, "planks", randomUUID());
    assert.equal(f.e.state(1).stock.wood, 3);
    assert.equal(f.e.state(1).stock.ore, 1);
    f.e.cancelJob(1, j.id);
    f.e.cancelJob(1, j.id);
    assert.equal(f.e.state(1).stock.wood, 6);
    assert.equal(f.e.state(1).stock.ore, 2);
  } finally {
    f.close();
  }
});

test("recipe migration refunds the original reservation of a pre-update plank batch", () => {
  const f = fixture();
  try {
    seed(f);
    const job = f.e.startJob(1, "planks", randomUUID());
    // Reconstruct a saved database from before recipe snapshots existed.
    f.db.exec("ALTER TABLE frontier_jobs DROP COLUMN recipe_inputs");
    f.db
      .prepare("UPDATE frontier_stock SET quantity=17 WHERE item='wood'")
      .run();
    f.db
      .prepare("UPDATE frontier_stock SET quantity=20 WHERE item='ore'")
      .run();
    const restarted = createEngine(f.db, () => f.e.now() * 1000);
    restarted.cancelJob(1, job.id);
    assert.equal(restarted.state(1).stock.wood, 20);
    assert.equal(restarted.state(1).stock.ore, 20);
  } finally {
    f.close();
  }
});

test("replaying an accepted task after early advancement returns current state without counting twice", () => {
  const f = fixture();
  try {
    seed(f);
    const m = f.e.depart(
      1,
      f.e.createMission(1, "delivery", "driver", randomUUID()).id,
    );
    f.advance(11);
    const recorded = gesture(m.challenge);
    f.e.actMission(1, m.id, 0, m.challenge.nonce, recorded);
    const replay = f.e.actMission(1, m.id, 0, m.challenge.nonce, recorded);
    assert.equal(replay.round, 1);
    assert.equal(replay.members[0].successes, 1);
    assert.equal(f.e.state(1).journey.actions, 1);
  } finally {
    f.close();
  }
});

test("continuous extraction has no three-item or three-minute cap and misses earn nothing", () => {
  const f = fixture();
  try {
    let j = startWork(f, 1, "wood", randomUUID());
    for (let i = 0; i < 20; i++) {
      f.advance(11);
      j = f.e.actJob(1, j.id, j.step, j.challenge.nonce, gesture(j.challenge));
    }
    assert.equal(j.status, "active");
    assert.equal(j.successes, 20);
    assert.equal(f.e.state(1).stock.wood, 20);
    assert.equal(f.e.state(1).player.coins, 120);
    f.advance(15);
    j = f.e.actJob(1, j.id, j.step, j.challenge.nonce, {
      events: [[300, 7, 0, 0]],
    });
    assert.equal(j.successes, 20);
    assert.equal(f.e.state(1).player.coins, 120);
    f.e.cancelJob(1, j.id);
    f.e.cancelJob(1, j.id);
    assert.equal(f.e.state(1).stock.wood, 20);
    assert.equal(f.e.state(1).player.coins, 120);
  } finally {
    f.close();
  }
});

test("unfinished legacy gathering upgrades once and keeps its earned resource and coin", () => {
  const f = fixture();
  try {
    let j = startWork(f, 1, "wood", randomUUID());
    f.advance(11);
    j = f.e.actJob(1, j.id, 0, j.challenge.nonce, gesture(j.challenge));
    f.db.prepare("UPDATE frontier_jobs SET continuous=0 WHERE id=?").run(j.id);
    f.db
      .prepare("UPDATE frontier_stock SET quantity=0 WHERE item='wood'")
      .run();
    f.db.prepare("UPDATE users SET coins=100 WHERE id=1").run();
    f.db.prepare("UPDATE frontier_players SET jobs=0 WHERE user_id=1").run();
    f.db
      .prepare("DELETE FROM frontier_rewards WHERE ref LIKE 'gather:%'")
      .run();
    f.db.prepare("DELETE FROM frontier_personal_quests WHERE user_id=1").run();
    const restarted = createEngine(f.db, () => f.e.now() * 1000);
    assert.equal(restarted.resumeJob(1, j.id).continuous, 1);
    createEngine(f.db, () => f.e.now() * 1000);
    restarted.cancelJob(1, j.id);
    assert.equal(restarted.state(1).stock.wood, 1);
    assert.equal(restarted.state(1).player.coins, 101);
    assert.equal(restarted.state(1).commons.points, 1);
  } finally {
    f.close();
  }
});

test("gathering credits resource, coins, bingo and journey actions atomically", () => {
  const f = fixture();
  try {
    const j = startWork(f, 1, "ore", randomUUID());
    f.advance(11);
    const payload = gesture(j.challenge);
    f.db.exec(
      "CREATE TRIGGER reject_gather BEFORE UPDATE OF coins ON users BEGIN SELECT RAISE(ABORT,'credit failed'); END",
    );
    assert.throws(
      () => f.e.actJob(1, j.id, 0, j.challenge.nonce, payload),
      /credit failed/,
    );
    assert.equal(f.e.state(1).stock.ore, 0);
    assert.equal(f.e.state(1).commons.points, 0);
    assert.equal(f.e.state(1).journey.actions, 0);
    assert.equal(f.e.resumeJob(1, j.id).step, 0);
    f.db.exec("DROP TRIGGER reject_gather");
    f.e.actJob(1, j.id, 0, j.challenge.nonce, payload);
    f.e.actJob(1, j.id, 0, j.challenge.nonce, payload);
    assert.equal(f.e.state(1).stock.ore, 1);
    assert.equal(f.e.state(1).player.coins, 101);
    assert.equal(f.e.state(1).commons.points, 1);
    assert.equal(f.e.state(1).journey.actions, 1);
  } finally {
    f.close();
  }
});

test("one completed carpentry game makes exactly one plank and consumes one recipe", () => {
  const f = fixture();
  try {
    f.db
      .prepare(
        "UPDATE frontier_stock SET quantity=CASE item WHEN 'wood' THEN 3 WHEN 'ore' THEN 1 ELSE 0 END",
      )
      .run();
    let j = f.e.startJob(1, "planks", randomUUID());
    assert.equal(j.continuous, 2);
    assert.equal(j.target, 1);
    const payload = gesture(j.challenge);
    f.advance(11);
    j = f.e.actJob(1, j.id, 0, j.challenge.nonce, payload);
    assert.equal(j.status, "done");
    assert.equal(j.result.quantity, 1);
    assert.equal(j.result.coins, 1);
    assert.equal(f.e.state(1).stock.planks, 1);
    assert.equal(f.e.state(1).stock.wood, 0);
    assert.equal(f.e.state(1).stock.ore, 0);
    f.e.actJob(1, j.id, 0, "old", payload);
    f.e.cancelJob(1, j.id);
    assert.equal(f.e.state(1).stock.planks, 1);
    assert.equal(f.e.state(1).player.coins, 101);
  } finally {
    f.close();
  }
});

test("planks loop immediately, retain each finished plank and refund only the next reserved recipe", () => {
  const f = fixture();
  try {
    f.db
      .prepare(
        "UPDATE frontier_stock SET quantity=CASE item WHEN 'wood' THEN 6 WHEN 'ore' THEN 2 ELSE 0 END",
      )
      .run();
    let j = f.e.startJob(1, "planks", randomUUID());
    f.advance(11);
    const before = j;
    j = f.e.actJob(1, j.id, 0, j.challenge.nonce, gesture(j.challenge));
    assert.equal(j.status, "active");
    assert.equal(j.successes, 1);
    assert.equal(f.e.state(1).stock.planks, 1);
    assert.equal(f.e.state(1).stock.wood, 0);
    f.e.actJob(1, j.id, 0, before.challenge.nonce, gesture(before.challenge));
    assert.equal(f.e.state(1).stock.planks, 1);
    f.e.cancelJob(1, j.id);
    f.e.cancelJob(1, j.id);
    assert.equal(f.e.state(1).stock.wood, 3);
    assert.equal(f.e.state(1).stock.ore, 1);
    assert.equal(f.e.state(1).stock.planks, 1);
    assert.equal(
      f.e.state(1).commons.tiles.find((t) => t.kind === "planks").progress,
      1,
    );
  } finally {
    f.close();
  }
});

test("missed carpentry does not consume another recipe and expiry returns its pending ingredients", () => {
  const f = fixture();
  try {
    f.db
      .prepare(
        "UPDATE frontier_stock SET quantity=CASE item WHEN 'wood' THEN 6 WHEN 'ore' THEN 2 ELSE 0 END",
      )
      .run();
    let j = f.e.startJob(1, "planks", randomUUID());
    f.advance(40);
    j = f.e.actJob(1, j.id, 0, j.challenge.nonce, { events: [[300, 7, 0, 0]] });
    assert.equal(j.successes, 0);
    assert.equal(f.e.state(1).stock.wood, 3);
    assert.equal(f.e.state(1).stock.planks, 0);
    f.advance(11);
    j = f.e.actJob(1, j.id, 1, j.challenge.nonce, gesture(j.challenge));
    assert.equal(f.e.state(1).stock.planks, 1);
    f.set(j.ends_at);
    f.e.tick();
    assert.equal(f.e.state(1).stock.wood, 3);
    assert.equal(f.e.state(1).stock.ore, 1);
    assert.equal(f.e.state(1).stock.planks, 1);
  } finally {
    f.close();
  }
});

test("saved two-plank batches return their exact reservation before switching to single-plank crafting", () => {
  const f = fixture();
  try {
    seed(f);
    let j = f.e.startJob(1, "planks", randomUUID());
    f.db
      .prepare(
        "UPDATE frontier_jobs SET continuous=0,recipe_inputs=? WHERE id=?",
      )
      .run(JSON.stringify({ wood: 6, ore: 2 }), j.id);
    f.db
      .prepare(
        "UPDATE frontier_stock SET quantity=CASE item WHEN 'wood' THEN 14 WHEN 'ore' THEN 18 ELSE quantity END",
      )
      .run();
    const restarted = createEngine(f.db, () => f.e.now() * 1000);
    createEngine(f.db, () => f.e.now() * 1000);
    assert.equal(restarted.resumeJob(1, j.id).status, "abandoned");
    assert.equal(restarted.state(1).stock.wood, 20);
    assert.equal(restarted.state(1).stock.ore, 20);
    assert.equal(restarted.state(1).job, null);
  } finally {
    f.close();
  }
});

for (const kind of ["supplies", "weapons"]) {
  test(`${kind}: one game banks one item, loops, and returns only the next reservation`, () => {
    const f = fixture();
    try {
      unlock(f);
      const inputs = f.e.content.jobs[kind].inputs;
      for (const [item, qty] of Object.entries(inputs))
        f.db
          .prepare("UPDATE frontier_stock SET quantity=? WHERE item=?")
          .run(qty * 2, item);
      let j = startWork(f, 1, kind, randomUUID());
      assert.equal(j.continuous, 2);
      assert.equal(j.target, 1);
      assert.equal(
        j.challenge.arcade.mode,
        kind === "supplies" ? "match3" : "forge",
      );
      const first = j;
      f.advance(80);
      j = f.e.actJob(1, j.id, j.step, j.challenge.nonce, gesture(j.challenge));
      assert.equal(j.status, "active");
      assert.equal(j.successes, 1);
      assert.equal(f.e.state(1).stock[kind], 1);
      assert.equal(f.e.state(1).stock.wood, 0);
      f.e.actJob(
        1,
        j.id,
        first.step,
        first.challenge.nonce,
        gesture(first.challenge),
      );
      assert.equal(f.e.state(1).stock[kind], 1);
      f.e.cancelJob(1, j.id);
      f.e.cancelJob(1, j.id);
      for (const [item, qty] of Object.entries(inputs))
        assert.equal(f.e.state(1).stock[item], qty);
      assert.equal(f.e.state(1).stock[kind], 1);
      j = f.e.startJob(1, kind, randomUUID());
      f.advance(80);
      j = f.e.actJob(1, j.id, j.step, j.challenge.nonce, gesture(j.challenge));
      assert.equal(j.status, "done");
      assert.equal(j.result.quantity, 1);
      assert.equal(f.e.state(1).stock[kind], 2);
      assert.equal(f.e.state(1).stock.ore, 0);
    } finally {
      f.close();
    }
  });
  test(`${kind}: saved multi-game batches refund once before new single-item games`, () => {
    const f = fixture();
    try {
      seed(f);
      unlock(f);
      const j = startWork(f, 1, kind, randomUUID());
      f.db
        .prepare("UPDATE frontier_jobs SET continuous=0,successes=1 WHERE id=?")
        .run(j.id);
      const restarted = createEngine(f.db, () => f.e.now() * 1000);
      createEngine(f.db, () => f.e.now() * 1000);
      assert.equal(restarted.resumeJob(1, j.id).status, "abandoned");
      assert.equal(restarted.state(1).stock.wood, 20);
      assert.equal(restarted.state(1).stock.ore, 20);
      assert.equal(restarted.state(1).stock[kind], 20);
      assert.equal(restarted.state(1).job, null);
    } finally {
      f.close();
    }
  });
}

test("planks are only made at Crooked Post, even after the bridge opens", () => {
  const f = fixture();
  try {
    seed(f);
    unlock(f);
    go(f, 1, "mill");
    assert.throws(() => f.e.startJob(1, "planks", randomUUID()), /workshop/);
    assert.equal(f.e.state(1).stock.wood, 20);
    assert.equal(f.e.state(1).stock.ore, 20);
  } finally {
    f.close();
  }
});
