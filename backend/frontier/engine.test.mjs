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
      .prepare("UPDATE frontier_projects SET progress=3199 WHERE id='bridge'")
      .run();
    completeMission(
      f,
      f.e.createMission(1, "delivery", "driver", randomUUID()),
    );
    assert.equal(
      f.e.state(1).projects.find((p) => p.id === "bridge").progress,
      3200,
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
      "UPDATE frontier_projects SET completed_at=1,progress=CASE id WHEN 'bridge' THEN 3200 ELSE 6400 END",
    )
    .run();
}
function completeJob(f, uid, kind) {
  let j = startWork(f, uid, kind, randomUUID());
  for (let i = 0; i < 15 && j.status === "active"; i++) {
    f.set(j.started_at + i * 12 + 11);
    j = f.e.actJob(uid, j.id, i, j.challenge.nonce, gesture(j.challenge));
  }
  return f.e.resumeJob(uid, j.id);
}
function seed(f) {
  f.db.prepare("UPDATE frontier_stock SET quantity=20").run();
}

test("three good rounds automatically bank a batch; retries and a late cancel cannot erase it", () => {
  const f = fixture();
  try {
    let j = startWork(f, 1, "wood", randomUUID());
    for (let i = 0; i < 4; i++) {
      f.advance(3);
      const bad = gesture(j.challenge);
      bad.trace.forEach((p) => (p[0] = 0.02));
      j = f.e.actJob(1, j.id, j.step, j.challenge.nonce, bad);
      assert.equal(j.target, 3);
      assert.equal(j.successes, 0);
    }
    for (let i = 0; i < 3; i++) {
      f.advance(3);
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
    assert.equal(j.status, "done");
    assert.equal(j.result.quantity, 3);
    assert.equal(f.e.state(1).job, null);
    f.e.cancelJob(1, j.id);
    assert.equal(f.e.state(1).stock.wood, 3);
    assert.equal(f.e.state(1).player.coins, 101);
  } finally {
    f.close();
  }
});

test("leaving or expiring a gathering batch keeps earned ore; coin interval never blocks materials", () => {
  const f = fixture();
  try {
    let j = startWork(f, 1, "ore", randomUUID());
    f.advance(3);
    j = f.e.actJob(1, j.id, 0, j.challenge.nonce, gesture(j.challenge));
    j = f.e.cancelJob(1, j.id);
    assert.equal(j.result.quantity, 1);
    assert.equal(j.result.coins, 1);
    assert.equal(f.e.state(1).stock.ore, 1);
    const next = completeJob(f, 1, "ore");
    assert.equal(next.result.quantity, 3);
    assert.equal(next.result.coins, 0);
    assert.equal(f.e.state(1).stock.ore, 4);
    f.set(next.coinReadyAt);
    assert.equal(completeJob(f, 1, "ore").result.coins, 1);
    j = startWork(f, 1, "ore", randomUUID());
    f.advance(3);
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
    assert.equal(f.e.state(1).stock.wood, 3);
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
  m = f.e.depart(1, m.id);
  for (let i = 0; i < 3; i++) {
    f.set(m.started_at + i * 15);
    f.e.tick();
    f.advance(11);
    for (const uid of uids) {
      const v = f.e.mission(uid, m.id);
      f.e.actMission(uid, m.id, i, v.challenge.nonce, gesture(v.challenge));
    }
  }
  f.set(m.ends_at);
  return f.e.mission(1, m.id);
}
test("work pays once, adds community materials, and preserves unrelated account data", () => {
  const f = fixture();
  try {
    let j = completeJob(f, 1, "wood");
    assert.equal(j.result.coins, 1);
    assert.equal(f.e.state(1).stock.wood, 3);
    assert.equal(f.e.state(1).player.coins, 101);
    f.e.actJob(1, j.id, 14, "old", "OAK");
    assert.equal(f.e.state(1).player.coins, 101);
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
    const n = f.e.actJob(1, j.id, 0, j.challenge.nonce, gesture(j.challenge));
    assert.equal(
      f.e.actJob(1, j.id, 0, j.challenge.nonce, gesture(j.challenge)).step,
      1,
    );
    assert.throws(
      () => f.e.actJob(1, j.id, 1, n.challenge.nonce, gesture(n.challenge)),
      /moment/,
    );
    assert.equal(f.e.state(1).player.coins, 100);
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
    assert.equal(f.e.state(1).projects[0].progress, 2);
    for (const uid of [1, 2, 3]) assert.equal(f.e.state(uid).player.coins, 101);
    f.e.tick();
    assert.equal(f.e.state(1).projects[0].progress, 2);
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
test("keepsake purchases are idempotent and cannot spend below zero", () => {
  const f = fixture();
  try {
    f.e.cosmetic(1, "blue-pennant");
    f.e.cosmetic(1, "blue-pennant");
    assert.equal(f.e.state(1).player.coins, 60);
    assert.throws(() => f.e.cosmetic(1, "reed-crown"), /enough/);
    assert.throws(() => f.e.cosmetic(2, "blue-pennant", true), /own/);
    f.e.cosmetic(1, null, true);
    assert.equal(f.e.state(1).player.equipped, null);
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
    assert.equal(f.e.state(1).stock.ore, 16);
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
    assert.equal(f.e.state(1).commons.points, 1);
    f.e.resumeJob(1, finished.id);
    f.e.tick();
    f.e.state(1);
    assert.equal(f.e.state(1).commons.points, 1);
    const cancelled = startWork(f, 1, "wood", randomUUID());
    f.e.cancelJob(1, cancelled.id);
    const idle = startWork(f, 1, "wood", randomUUID());
    f.set(idle.ends_at);
    f.e.tick();
    assert.equal(f.e.state(1).commons.points, 1);
    assert.equal(f.e.state(1).player.coins, 101);
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
    assert.equal(tiles.find((t) => t.kind === "team").progress, 2);
    assert.equal(tiles.find((t) => t.kind === "delivery").progress, 2);
    assert.equal(tiles.find((t) => t.kind === "driver").progress, 1);
    assert.equal(tiles.find((t) => t.kind === "guard").progress, 1);
  } finally {
    f.close();
  }
});

test("solo delivery rotates through three jobs; a party keeps its chosen roles", () => {
  for (const group of [false, true]) {
    const f = fixture();
    try {
      seed(f);
      let m = f.e.createMission(1, "delivery", "mechanic", randomUUID());
      if (group) f.e.joinMission(2, m.id, "driver");
      m = f.e.depart(1, m.id);
      assert.equal(m.ends_at - m.started_at, 45);
      assert.equal(m.requiredSuccesses, 2);
      for (let round = 0; round < 3; round++) {
        f.set(m.started_at + round * 15);
        const view = f.e.mission(1, m.id);
        assert.equal(
          view.activeRole,
          group ? "mechanic" : ["driver", "guard", "mechanic"][round],
        );
        assert.equal(
          view.challenge.kind,
          group ? "crank" : ["steer", "guard", "crank"][round],
        );
        f.advance(13);
        f.e.actMission(
          1,
          m.id,
          round,
          view.challenge.nonce,
          gesture(view.challenge),
        );
      }
      f.set(m.ends_at);
      const result = f.e.mission(1, m.id).result;
      assert.equal(result.passed, true);
      assert.equal(result.delivered, 2);
      assert.equal(result.payments[1], 1);
      assert.equal(result.payments[2], undefined);
      assert.equal(f.e.state(2).player.coins, 100);
    } finally {
      f.close();
    }
  }
});

test("crew wagons reserve six planks, require two active contributors and refund failures once", () => {
  const f = fixture();
  try {
    seed(f);
    const request = randomUUID();
    let m = f.e.createMission(1, "delivery", "driver", request, "wagon");
    assert.equal(m.cargo, 6);
    assert.equal(f.e.state(1).stock.planks, 14);
    assert.equal(
      f.e.createMission(1, "delivery", "driver", request, "wagon").id,
      m.id,
    );
    assert.throws(
      () => f.e.createMission(1, "delivery", "driver", request, "cart"),
      /different journey/,
    );
    assert.throws(() => f.e.depart(1, m.id), /two people/);
    f.e.joinMission(2, m.id, "guard");
    const failed = completeMission(f, m, [1]);
    assert.equal(failed.result.passed, false);
    assert.equal(f.e.state(1).stock.planks, 20);
    assert.equal(f.e.state(1).player.coins, 100);
    m = f.e.createMission(1, "delivery", "driver", randomUUID(), "wagon");
    f.e.joinMission(2, m.id, "guard");
    const delivered = completeMission(f, m, [1, 2]);
    assert.equal(delivered.result.delivered, 6);
    assert.equal(f.e.state(1).projects[0].progress, 6);
    assert.equal(f.e.state(1).stock.planks, 14);
    assert.equal(f.e.state(1).player.coins, 101);
    assert.equal(f.e.state(2).player.coins, 101);
    f.e.tick();
    assert.equal(f.e.state(1).stock.planks, 14);
    go(f, 1, "village");
    m = f.e.createMission(1, "delivery", "driver", randomUUID(), "wagon");
    f.e.leave(1, m.id);
    f.e.tick();
    assert.equal(f.e.state(1).stock.planks, 14);
  } finally {
    f.close();
  }
});
