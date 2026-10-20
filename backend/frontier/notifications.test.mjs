import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { gesture } from "./gesture-fixtures.mjs";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { createEngine } = require("./engine");
const { createNotificationWorker, queueMilestone } = require("./notifications");

function fixture(t) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,telegram_id TEXT,first_name TEXT,coins INTEGER);
    CREATE TABLE peepers(user_id INTEGER,slot_head TEXT,slot_body TEXT,slot_face TEXT,slot_hands TEXT,slot_fren TEXT,alive INTEGER);
    CREATE TABLE global_messages(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES(1,'101','One',100),(2,'202','Two',100),(3,'303','Observer',100);`);
  let time = 1700000000,
    e = createEngine(db, () => time * 1000);
  for (const id of [1, 2, 3]) e.state(id);
  db.exec("INSERT INTO frontier_journey_members VALUES(1,1,3,3)");
  t.after(() => db.close());
  const sent = [];
  const f = {
    db,
    sent,
    get e() {
      return e;
    },
    now: () => time,
    advance: (seconds) => {
      time += seconds;
    },
    restart: () => {
      e = createEngine(db, () => time * 1000);
    },
    jobs: () =>
      db.prepare("SELECT * FROM frontier_notifications ORDER BY id").all(),
    worker: (options) =>
      createNotificationWorker(db, {
        now: () => time,
        pause: async () => {},
        isEnabled: () => true,
        send: async (id, text) => {
          sent.push({ id, text });
          return { ok: true };
        },
        ...options,
      }),
    ready: (kind) => {
      db.prepare(
        "UPDATE frontier_projects SET progress=800,completed_at=? WHERE id='bridge'",
      ).run(time);
      if (kind === "battle_ready")
        db.prepare("UPDATE frontier_boss SET phase='open'").run();
      if (kind === "victory") {
        db.prepare(
          "UPDATE frontier_boss SET phase='defeated',hp=0,defeated_at=?",
        ).run(time);
        db.prepare(
          "INSERT INTO frontier_rewards VALUES('dragon:1:1',1,19,1,'Victory',?)",
        ).run(time);
      }
      queueMilestone(db, kind, time);
    },
  };
  return f;
}

test("real bridge, full reserves and victory queue only their current contributors and never a launch announcement", async (t) => {
  const f = fixture(t);
  assert.deepEqual(f.jobs(), []);
  f.db.exec("INSERT INTO frontier_journey_members VALUES(1,2,5,5)");
  f.db
    .prepare("UPDATE frontier_projects SET progress=798 WHERE id='bridge'")
    .run();
  f.db
    .prepare("UPDATE frontier_stock SET quantity=2 WHERE item='planks'")
    .run();
  let m = f.e.depart(
    1,
    f.e.createMission(1, "delivery", "driver", randomUUID()).id,
  );
  for (let round = 0; round < 3; round++) {
    f.advance(11);
    m = f.e.actMission(1, m.id, round, m.challenge.nonce, gesture(m.challenge));
  }
  assert.equal(m.result.delivered, 2);
  assert.deepEqual(
    f.jobs().map((j) => [j.user_id, j.kind]),
    [
      [1, "bridge"],
      [2, "bridge"],
    ],
  );
  await f.worker().dispatch();
  assert.ok(
    f.sent.every(
      (s) => /bridge is rebuilt/.test(s.text) && !/coins|Mirewake/.test(s.text),
    ),
  );
  f.db
    .prepare(
      "UPDATE frontier_stock SET quantity=500 WHERE item IN ('supplies','weapons')",
    )
    .run();
  f.db.prepare("UPDATE frontier_players SET location='pool'").run();
  const key = randomUUID();
  f.e.prepareBoss(3, "supplies", 500, key);
  assert.equal(f.jobs().filter((j) => j.kind === "battle_ready").length, 0);
  f.e.prepareBoss(2, "weapons", 500, randomUUID());
  f.e.prepareBoss(3, "supplies", 500, key);
  assert.equal(f.jobs().filter((j) => j.kind === "battle_ready").length, 3);
  await f.worker().dispatch();
  assert.equal(f.sent.filter((s) => /shared battle/.test(s.text)).length, 3);
  f.db.prepare("UPDATE frontier_boss SET hp=1").run();
  const hitKey = randomUUID();
  f.e.hitBoss(1, "strike", hitKey);
  assert.equal(f.jobs().filter((j) => j.kind === "victory").length, 3);
  for (const job of f.jobs().filter((j) => j.kind === "victory")) {
    const paid = f.db
      .prepare("SELECT coins FROM frontier_rewards WHERE ref=? AND user_id=?")
      .get(`dragon:1:${job.user_id}`, job.user_id);
    assert.equal(JSON.parse(job.payload).coins, paid.coins);
  }
  await f.worker().dispatch();
  assert.equal(f.sent.length, 8);
  assert.equal(
    f.sent.filter((s) => /Already added to your balance/.test(s.text)).length,
    3,
  );
  f.e.hitBoss(1, "strike", hitKey);
  f.restart();
  await f.worker().dispatch();
  assert.equal(f.sent.length, 8);
  assert.ok(f.jobs().every((j) => j.status === "sent"));
});

test("notification insertion rolls back together with victory and all payouts", (t) => {
  const f = fixture(t);
  f.ready("battle_ready");
  f.db.prepare("UPDATE frontier_boss SET hp=1").run();
  f.db
    .prepare("UPDATE frontier_players SET location='pool' WHERE user_id=1")
    .run();
  f.db
    .exec(`CREATE TRIGGER reject_victory_notification BEFORE INSERT ON frontier_notifications
    WHEN NEW.kind='victory' BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END;`);
  assert.throws(
    () => f.e.hitBoss(1, "strike", randomUUID()),
    /outbox unavailable/,
  );
  assert.equal(f.e.bossView(1).hp, 1);
  assert.equal(f.e.bossView(1).phase, "open");
  assert.equal(f.e.state(1).player.coins, 100);
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) n FROM frontier_rewards WHERE ref LIKE 'dragon:%'",
      )
      .get().n,
    0,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM frontier_boss_cycles").get().n,
    0,
  );
  assert.equal(f.jobs().filter((j) => j.kind === "victory").length, 0);
});

test("installing or reading an existing completed milestone does not backfill Telegram alerts", (t) => {
  const f = fixture(t);
  f.db
    .prepare(
      "UPDATE frontier_projects SET completed_at=1,progress=800 WHERE id='bridge'",
    )
    .run();
  f.db.prepare("UPDATE frontier_boss SET phase='open'").run();
  f.restart();
  f.e.state(1);
  f.e.eventSummary();
  assert.deepEqual(f.jobs(), []);
});

test("durable dedup survives dispatcher restarts and concurrent workers", async (t) => {
  const f = fixture(t);
  f.ready("battle_ready");
  queueMilestone(f.db, "battle_ready", f.now());
  assert.equal(f.jobs().length, 1);
  const send = async (id, text) => {
    f.sent.push({ id, text });
    await new Promise((resolve) => setImmediate(resolve));
    return { ok: true };
  };
  await Promise.all([
    f.worker({ send }).dispatch(),
    f.worker({ send }).dispatch(),
  ]);
  f.restart();
  await f.worker().dispatch();
  assert.equal(f.sent.length, 1);
  assert.equal(f.jobs()[0].status, "sent");
});

test("temporary delivery failures retain the same message for backoff and retry", async (t) => {
  const f = fixture(t);
  f.ready("battle_ready");
  await f
    .worker({
      send: async () => {
        throw new Error("Network down");
      },
    })
    .dispatch();
  assert.equal(f.jobs()[0].status, "pending");
  assert.equal(f.jobs()[0].next_attempt_at, f.now() + 30);
  f.restart();
  await f.worker().dispatch();
  assert.equal(f.sent.length, 0);
  f.advance(30);
  await f.worker().dispatch();
  assert.equal(f.sent.length, 1);
  assert.equal(f.jobs()[0].attempts, 2);
});

test("a Telegram rate limit pauses the entire persisted event queue, including after restart", async (t) => {
  const f = fixture(t);
  f.ready("battle_ready");
  f.db.exec("INSERT INTO frontier_journey_members VALUES(1,2,1,1)");
  queueMilestone(f.db, "battle_ready", f.now());
  let calls = 0;
  await f
    .worker({
      send: async () => {
        calls++;
        return { ok: false, retryAfter: 120 };
      },
    })
    .dispatch();
  assert.equal(calls, 1);
  f.advance(60);
  f.restart();
  await f.worker().dispatch();
  assert.equal(f.sent.length, 0);
  f.advance(60);
  await f.worker().dispatch();
  assert.equal(f.sent.length, 2);
});

test("disabled event alerts are skipped and enabling later does not replay the milestone", async (t) => {
  const f = fixture(t);
  f.ready("bridge");
  await f
    .worker({
      isEnabled: (uid, key) => {
        assert.equal(uid, 1);
        assert.equal(key, "frontier_notifications");
        return false;
      },
    })
    .dispatch();
  assert.equal(f.sent.length, 0);
  assert.equal(f.jobs()[0].status, "skipped");
  await f.worker().dispatch();
  assert.equal(f.sent.length, 0);
});

test("permanent Telegram rejections do not retry", async (t) => {
  const f = fixture(t);
  f.ready("bridge");
  await f
    .worker({ send: async () => ({ ok: false, permanent: true }) })
    .dispatch();
  assert.equal(f.jobs()[0].status, "failed");
  f.advance(3600);
  await f.worker().dispatch();
  assert.equal(f.sent.length, 0);
});

test("expired sending leases recover without duplicating a still-owned delivery", async (t) => {
  const f = fixture(t);
  f.ready("battle_ready");
  f.db
    .prepare(
      "UPDATE frontier_notifications SET status='sending',claim='crashed-worker',locked_until=?",
    )
    .run(f.now() + 10);
  await f.worker().dispatch();
  assert.equal(f.sent.length, 0);
  f.advance(10);
  await f.worker().dispatch();
  assert.equal(f.sent.length, 1);
  assert.equal(f.jobs()[0].status, "sent");
});

for (const [kind, nextPhase] of [
  ["bridge", "open"],
  ["battle_ready", "defeated"],
]) {
  test(`obsolete ${kind} notifications are skipped after the event advances`, async (t) => {
    const f = fixture(t);
    f.ready(kind);
    f.db
      .prepare("UPDATE frontier_boss SET phase=?,defeated_at=?")
      .run(nextPhase, f.now());
    await f.worker().dispatch();
    assert.equal(f.sent.length, 0);
    assert.equal(f.jobs()[0].status, "skipped");
  });
}

test("victory alerts expire with the one-day results window", async (t) => {
  const f = fixture(t);
  f.ready("victory");
  f.advance(86400);
  await f.worker().dispatch();
  assert.equal(f.sent.length, 0);
  assert.equal(f.jobs()[0].status, "skipped");
});

test("inactive events and previous cycles never send queued alerts", async (t) => {
  const f = fixture(t);
  f.ready("bridge");
  const settings = f.e.content.event;
  try {
    settings.active = false;
    await f.worker().dispatch();
    assert.equal(f.sent.length, 0);
  } finally {
    settings.active = true;
  }
  f.db.prepare("UPDATE frontier_notifications SET status='pending'").run();
  f.db.prepare("UPDATE frontier_boss SET cycle=cycle+1").run();
  await f.worker().dispatch();
  assert.equal(f.sent.length, 0);
});

test("notifications escape configured names and never include the user name", async (t) => {
  const f = fixture(t);
  f.ready("victory");
  f.db
    .prepare("UPDATE frontier_notifications SET payload=?")
    .run(JSON.stringify({ eventName: "A&B", bossName: "<Dragon>", coins: 19 }));
  await f.worker().dispatch();
  assert.match(f.sent[0].text, /A&amp;B/);
  assert.match(f.sent[0].text, /&lt;Dragon&gt;/);
  assert.match(f.sent[0].text, /\+19 coins/);
  assert.doesNotMatch(f.sent[0].text, /One|claim/i);
});
