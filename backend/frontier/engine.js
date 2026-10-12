"use strict";
const crypto = require("node:crypto");
const content = require("./content.json");
const { install } = require("./schema");
const { makeChallenge, inspect } = require("./gestures");
const { findRoute } = require("./travel");
const { createCampaign } = require("./campaign");
const { createSiege } = require("./siege");
class FrontierError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (ok, message, status) => {
  if (!ok) throw new FrontierError(message, status);
};
const parse = (value) => (value ? JSON.parse(value) : null);
const M = content.mission;
function createEngine(db, clock = () => Date.now()) {
  install(db);
  const now = () => Math.floor(clock() / 1000);
  const campaign = createCampaign(db, now, reward);
  const newChallenge = (kind) =>
    makeChallenge(kind, now(), campaign.weather().id);
  const event = (message) => {
    db.prepare(
      "INSERT INTO frontier_events(message,created_at) VALUES (?,?)",
    ).run(message, now());
    db.prepare(
      "DELETE FROM frontier_events WHERE id NOT IN (SELECT id FROM frontier_events ORDER BY id DESC LIMIT 60)",
    ).run();
  };
  const ensure = (uid) => {
    fail(
      db.prepare("SELECT 1 FROM users WHERE id=?").get(uid),
      "Account not found",
      404,
    );
    db.prepare(
      "INSERT OR IGNORE INTO frontier_players(user_id,joined_at) VALUES (?,?)",
    ).run(uid, now());
  };
  const key = (value) => {
    fail(
      typeof value === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(value),
      "Invalid request identity",
    );
    return value;
  };
  const free = (uid) =>
    fail(
      !db
        .prepare("SELECT 1 FROM frontier_commitments WHERE user_id=?")
        .get(uid),
      "Finish or leave your current activity first",
      409,
    );
  const reserve = (uid, kind, ref) =>
    db
      .prepare("INSERT INTO frontier_commitments VALUES (?,?,?)")
      .run(uid, kind, ref);
  const release = (ref) =>
    db.prepare("DELETE FROM frontier_commitments WHERE ref=?").run(ref);
  function stock(item, delta) {
    fail(
      db
        .prepare(
          "UPDATE frontier_stock SET quantity=quantity+? WHERE item=? AND quantity+?>=0",
        )
        .run(delta, item, delta).changes === 1,
      `The community needs more ${item}`,
      409,
    );
  }
  function reward(uid, ref, coins, xp, reason) {
    const inserted = db
      .prepare("INSERT OR IGNORE INTO frontier_rewards VALUES (?,?,?,?,?,?)")
      .run(ref, uid, coins, xp, reason, now());
    if (inserted.changes) {
      db.prepare("UPDATE users SET coins=coins+? WHERE id=?").run(coins, uid);
      db.prepare("UPDATE frontier_players SET xp=xp+? WHERE user_id=?").run(
        xp,
        uid,
      );
    }
  }
  function activityCoins(uid, amount) {
    const player = db
      .prepare("SELECT next_work_coin_at FROM frontier_players WHERE user_id=?")
      .get(uid);
    if (now() < player.next_work_coin_at) return 0;
    db.prepare(
      "UPDATE frontier_players SET next_work_coin_at=? WHERE user_id=?",
    ).run(now() + 180, uid);
    return amount;
  }
  function activeRole(m, member, count) {
    return count === 1 && m.round_count === 3
      ? ["driver", "guard", "mechanic"][m.round % 3]
      : member.role;
  }
  function missionChallenge(kind = "delivery") {
    return kind === "boss"
      ? {
          driver: newChallenge("dodge"),
          guard: newChallenge("guard"),
          mechanic: newChallenge("rune"),
        }
      : {
          driver: newChallenge("steer"),
          guard: newChallenge("guard"),
          mechanic: newChallenge("crank"),
        };
  }
  function settleTravel(uid) {
    const row = db
      .prepare("SELECT location,travel FROM frontier_players WHERE user_id=?")
      .get(uid);
    const trip = parse(row?.travel);
    if (trip && trip.arrives_at <= now())
      db.prepare(
        "UPDATE frontier_players SET location=?,travel=NULL WHERE user_id=?",
      ).run(trip.to, uid);
  }
  function completed() {
    return db
      .prepare(
        "SELECT id FROM frontier_projects WHERE completed_at IS NOT NULL",
      )
      .all()
      .map((p) => p.id);
  }
  function walk(uid, to, seconds) {
    settleTravel(uid);
    const p = db
      .prepare("SELECT location,travel FROM frontier_players WHERE user_id=?")
      .get(uid);
    if (p.travel) {
      fail(parse(p.travel).to === to, "You are already on the trail", 409);
      return parse(p.travel);
    }
    const path = findRoute(p.location, to, completed());
    fail(path, "The route is blocked. Help restore the crossing first.", 409);
    const distance = path
      .slice(1)
      .reduce(
        (sum, p, i) => sum + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]),
        0,
      );
    if (!distance) return null;
    const trip = {
      from: p.location,
      to,
      path,
      started_at: now(),
      arrives_at: now() + (seconds || Math.max(1, Math.ceil(distance * 12))),
    };
    db.prepare("UPDATE frontier_players SET travel=? WHERE user_id=?").run(
      JSON.stringify(trip),
      uid,
    );
    return trip;
  }
  function assembly(uid, kind) {
    settleTravel(uid);
    const p = db
      .prepare("SELECT location,travel FROM frontier_players WHERE user_id=?")
      .get(uid);
    fail(!p.travel, "Wait for everyone to arrive at the meeting point", 409);
    fail(
      p.location === (kind === "boss" ? "pool" : "village"),
      kind === "boss"
        ? "Gather at the deep pool first"
        : "Gather at Crooked Post first",
      409,
    );
  }
  function atWork(uid, def) {
    settleTravel(uid);
    const p = db
      .prepare("SELECT location,travel FROM frontier_players WHERE user_id=?")
      .get(uid);
    fail(!p.travel, "Finish travelling before starting work", 409);
    fail(
      p.location === def.location ||
        (def.location === "village" && p.location === "mill"),
      "Travel to the workshop first",
      409,
    );
    if (p.location === "mill")
      fail(
        completed().includes("bridge"),
        "Restore the bridge to reach the supply mill",
        409,
      );
    if (def.requires)
      fail(
        db
          .prepare("SELECT completed_at FROM frontier_projects WHERE id=?")
          .get(def.requires)?.completed_at,
        "Restore the bridge to reach this workshop",
        409,
      );
  }
  function finishJob(j, abandoned = false) {
    const def = content.jobs[j.kind];
    const complete = j.successes >= def.steps;
    const gathering = Object.keys(def.inputs).length === 0;
    // Gathered pieces survive an early exit. A recipe consumes ingredients only
    // when the entire batch is finished; missed attempts never increase its target.
    const quantity = complete
      ? def.quantity
      : gathering
        ? Math.floor((def.quantity * j.successes) / def.steps)
        : 0;
    const passed = quantity > 0;
    const coins = passed ? activityCoins(j.user_id, def.coins) : 0;
    const xp = passed
      ? Math.ceil(def.xp * Math.min(1, j.successes / def.steps))
      : 0;
    if (passed) {
      stock(def.output, quantity);
      reward(j.user_id, j.id, coins, xp, def.name);
      if (complete) campaign.record(j.user_id, { job: j.kind }, completed());
      db.prepare("UPDATE frontier_players SET jobs=jobs+1 WHERE user_id=?").run(
        j.user_id,
      );
    } else {
      // Crafting ingredients are reservations until a successful batch is produced.
      for (const [item, qty] of Object.entries(def.inputs)) stock(item, qty);
    }
    const result = {
      passed,
      complete,
      coins,
      xp,
      output: passed ? def.output : null,
      quantity: passed ? quantity : 0,
      successes: j.successes,
    };
    db.prepare("UPDATE frontier_jobs SET status=?,result=? WHERE id=?").run(
      abandoned && !passed ? "abandoned" : "done",
      JSON.stringify(result),
      j.id,
    );
    release(j.id);
    return result;
  }
  function refundMission(m) {
    stock(m.kind === "boss" ? "supplies" : "planks", m.cargo);
    db.prepare(
      "UPDATE frontier_missions SET status='cancelled',result=? WHERE id=?",
    ).run(
      JSON.stringify({
        passed: false,
        reason: "Departure cancelled; supplies returned.",
      }),
      m.id,
    );
    release(m.id);
  }
  function finishMission(m) {
    const members = db
      .prepare("SELECT * FROM frontier_members WHERE mission_id=?")
      .all(m.id);
    const eligible = members.filter((x) => x.successes >= m.required_successes);
    const passed = m.health > 0 && eligible.length >= m.min_crew;
    let delivered = 0;
    if (passed && m.kind === "delivery") {
      const project = content.projects.find((p) => p.id === m.project_id);
      if (project) {
        const before = db
          .prepare("SELECT * FROM frontier_projects WHERE id=?")
          .get(project.id);
        const used = before.completed_at
          ? 0
          : Math.min(m.cargo, project.target - before.progress);
        const progress = before.progress + used;
        delivered = used;
        db.prepare(
          "UPDATE frontier_projects SET progress=?,completed_at=CASE WHEN completed_at IS NOT NULL THEN completed_at WHEN ?>=? THEN ? ELSE NULL END WHERE id=?",
        ).run(progress, progress, project.target, now(), project.id);
        if (m.cargo > used) stock("planks", m.cargo - used);
        if (used && progress === project.target)
          event(`${project.name} is complete. Built by all of us.`);
        else if (used)
          event(`A caravan delivered ${used} planks to ${project.name}.`);
        else
          event(
            `The site is complete. A returning caravan restocked ${m.cargo} planks.`,
          );
      } else
        event(
          "A maintenance caravan repaired the boardwalks and kept the commons open.",
        );
    }

    const payments = {};
    for (const p of eligible)
      if (passed) {
        payments[p.user_id] = activityCoins(p.user_id, M.coins);
        campaign.record(
          p.user_id,
          { mission: m.kind, role: p.role, partySize: eligible.length },
          completed(),
        );
        reward(
          p.user_id,
          m.id,
          payments[p.user_id],
          M.xp,
          m.kind === "boss" ? "Defend the marsh" : "Caravan delivery",
        );
        if (m.kind === "delivery")
          db.prepare(
            "UPDATE frontier_players SET deliveries=deliveries+1 WHERE user_id=?",
          ).run(p.user_id);
      }
    if (!passed) stock(m.kind === "boss" ? "supplies" : "planks", m.cargo);
    const result = {
      passed,
      damage: 0,
      delivered,
      reason: passed
        ? null
        : m.health <= 0
          ? "The party could not protect the cargo. Reserved supplies returned to the shared stores."
          : `This journey needed ${m.min_crew} ${m.min_crew === 1 ? "player" : "players"} to clear ${m.required_successes} encounters each; ${eligible.length} qualified. Reserved supplies returned to the shared stores.`,
      health: m.health,
      eligible: passed ? eligible.map((x) => x.user_id) : [],
      coins: M.coins,
      payments,
      xp: M.xp,
    };
    db.prepare(
      "UPDATE frontier_missions SET status='done',health=?,round=?,result=? WHERE id=?",
    ).run(m.health, m.round, JSON.stringify(result), m.id);
    for (const p of members) {
      if (m.kind === "delivery")
        db.prepare(
          "UPDATE frontier_players SET location=?,travel=NULL WHERE user_id=?",
        ).run(
          passed ? (m.project_id === "mill" ? "mill" : "bridge") : "village",
          p.user_id,
        );
    }
    release(m.id);
  }
  function tickInside() {
    const t = now();
    for (const j of db
      .prepare(
        "SELECT * FROM frontier_jobs WHERE status='active' AND ends_at<=?",
      )
      .all(t))
      finishJob(j);
    for (const m of db
      .prepare(
        "SELECT * FROM frontier_missions WHERE (status='lobby' AND created_at+?<=?) OR (status='active' AND started_at+(round+1)*?<=?)",
      )
      .all(M.lobbySeconds, t, M.roundSeconds, t)) {
      if (m.status === "lobby") {
        if (t >= m.created_at + M.lobbySeconds) refundMission(m);
        continue;
      }
      const count = db
        .prepare(
          "SELECT COUNT(*) AS n FROM frontier_members WHERE mission_id=?",
        )
        .get(m.id).n;
      const due = Math.min(
        m.round_count,
        Math.floor((t - m.started_at) / M.roundSeconds),
      );
      while (m.round < due) {
        const correct = db
          .prepare(
            "SELECT COUNT(*) AS n FROM frontier_actions WHERE mission_id=? AND round=? AND correct=1",
          )
          .get(m.id, m.round).n;
        m.health = Math.min(
          100,
          Math.max(
            0,
            m.health -
              (count - correct) *
                Math.ceil((m.round_count === 3 ? 30 : 10) / count) +
              (correct === count ? 2 : 0),
          ),
        );
        m.round++;
      }
      if (m.round >= m.round_count) finishMission(m);
      else if (
        m.round !==
        db.prepare("SELECT round FROM frontier_missions WHERE id=?").get(m.id)
          .round
      ) {
        db.prepare(
          "UPDATE frontier_missions SET round=?,health=?,challenge=? WHERE id=?",
        ).run(
          m.round,
          m.health,
          JSON.stringify(missionChallenge(m.kind)),
          m.id,
        );
      }
    }
    siege.tick();
  }
  const siege = createSiege(db, {
    now,
    fail,
    ensure,
    free,
    reserve,
    release,
    reward,
    event,
    weather: () => campaign.weather().id,
    onDamage: (uid) => campaign.record(uid, { mission: "boss" }, completed()),
  });
  const tick = db.transaction(tickInside);
  const transact =
    (fn) =>
    (...args) =>
      db.transaction(() => {
        tickInside();
        return fn(...args);
      })();
  function jobView(j) {
    if (!j) return null;
    if (j.status === "active" && parse(j.challenge)?.version !== 3) {
      j.challenge = JSON.stringify(newChallenge(content.jobs[j.kind].mechanic));
      db.prepare("UPDATE frontier_jobs SET challenge=? WHERE id=?").run(
        j.challenge,
        j.id,
      );
    }
    return {
      ...j,
      request_key: undefined,
      challenge: j.status === "active" ? parse(j.challenge) : null,
      result: parse(j.result),
      target: content.jobs[j.kind].steps,
      quantity: content.jobs[j.kind].quantity,
      coinReadyAt: db
        .prepare(
          "SELECT next_work_coin_at FROM frontier_players WHERE user_id=?",
        )
        .get(j.user_id).next_work_coin_at,
      nextAt:
        j.started_at +
        ((j.step + 1) * content.jobs[j.kind].seconds) /
          content.jobs[j.kind].steps,
    };
  }
  function missionView(m, uid) {
    if (!m) return null;
    const members = db
      .prepare(
        "SELECT fm.*,u.first_name AS name,p.slot_head,p.slot_body,p.slot_face,p.slot_hands,p.slot_fren,p.alive FROM frontier_members fm JOIN users u ON u.id=fm.user_id LEFT JOIN peepers p ON p.user_id=u.id WHERE mission_id=? ORDER BY fm.user_id",
      )
      .all(m.id);
    for (const p of members) {
      settleTravel(p.user_id);
      const location = db
        .prepare("SELECT location,travel FROM frontier_players WHERE user_id=?")
        .get(p.user_id);
      p.arrives_at = parse(location.travel)?.arrives_at || null;
    }
    const member = members.find((x) => x.user_id === uid);
    if (m.status === "active" && parse(m.challenge)?.driver?.version !== 3) {
      m.challenge = JSON.stringify(missionChallenge(m.kind));
      db.prepare("UPDATE frontier_missions SET challenge=? WHERE id=?").run(
        m.challenge,
        m.id,
      );
    }
    const roundActions = new Map(
      db
        .prepare(
          "SELECT user_id,correct FROM frontier_actions WHERE mission_id=? AND round=?",
        )
        .all(m.id, m.round)
        .map((a) => [a.user_id, Boolean(a.correct)]),
    );
    for (const p of members)
      p.round_action = roundActions.has(p.user_id)
        ? roundActions.get(p.user_id)
        : null;
    const acted =
      member &&
      db
        .prepare(
          "SELECT correct FROM frontier_actions WHERE mission_id=? AND user_id=? AND round=?",
        )
        .get(m.id, uid, m.round);
    return {
      ...m,
      request_key: undefined,
      challenge:
        m.status === "active" && member
          ? parse(m.challenge)[activeRole(m, member, members.length)]
          : null,
      activeRole: member ? activeRole(m, member, members.length) : null,
      totalRounds: m.round_count,
      requiredSuccesses: m.required_successes,
      coinReadyAt: member
        ? db
            .prepare(
              "SELECT next_work_coin_at FROM frontier_players WHERE user_id=?",
            )
            .get(uid).next_work_coin_at
        : null,
      members,
      acted: acted ? Boolean(acted.correct) : null,
      result: parse(m.result),
      nextAt: m.started_at
        ? m.started_at + (m.round + 1) * M.roundSeconds
        : null,
    };
  }
  const state = transact((uid) => {
    ensure(uid);
    settleTravel(uid);
    const commons = campaign.view(uid, completed());
    const player = db
      .prepare(
        "SELECT fp.*,u.coins FROM frontier_players fp JOIN users u ON u.id=fp.user_id WHERE user_id=?",
      )
      .get(uid);
    player.travel = parse(player.travel);
    player.owned = db
      .prepare("SELECT item FROM frontier_cosmetics WHERE user_id=?")
      .all(uid)
      .map((x) => x.item);
    player.honors = db
      .prepare(
        "SELECT h.cycle,h.contribution FROM frontier_boss_honors h JOIN frontier_boss b ON h.cycle<b.cycle OR (h.cycle=b.cycle AND b.hp=0) WHERE h.user_id=? ORDER BY h.cycle DESC LIMIT 10",
      )
      .all(uid);
    const commitment = db
      .prepare("SELECT * FROM frontier_commitments WHERE user_id=?")
      .get(uid);
    return {
      serverTime: clock() / 1000,
      commons,
      player,
      stock: Object.fromEntries(
        db
          .prepare("SELECT * FROM frontier_stock")
          .all()
          .map((x) => [x.item, x.quantity]),
      ),
      projects: db.prepare("SELECT * FROM frontier_projects").all(),
      boss: siege.snapshot(uid),
      assault:
        commitment?.kind === "assault" ? siege.view(uid, commitment.ref) : null,
      job:
        commitment?.kind === "job"
          ? jobView(
              db
                .prepare("SELECT * FROM frontier_jobs WHERE id=?")
                .get(commitment.ref),
            )
          : null,
      mission:
        commitment?.kind === "mission"
          ? missionView(
              db
                .prepare("SELECT * FROM frontier_missions WHERE id=?")
                .get(commitment.ref),
              uid,
            )
          : null,
      lobbies: db
        .prepare(
          "SELECT * FROM frontier_missions WHERE status='lobby' ORDER BY created_at DESC LIMIT 20",
        )
        .all()
        .map((m) => missionView(m, uid)),
      events: db
        .prepare("SELECT * FROM frontier_events ORDER BY id DESC LIMIT 10")
        .all(),
      history: db
        .prepare(
          "SELECT * FROM frontier_rewards WHERE user_id=? ORDER BY created_at DESC LIMIT 8",
        )
        .all(uid),
      recentWork: db
        .prepare(
          "SELECT id,kind,result FROM frontier_jobs WHERE user_id=? AND status='done' ORDER BY started_at DESC LIMIT 3",
        )
        .all(uid)
        .map((j) => ({ ...j, result: parse(j.result) })),
    };
  });
  const startJob = transact((uid, kind, requestKey) => {
    ensure(uid);
    key(requestKey);
    const old = db
      .prepare("SELECT * FROM frontier_jobs WHERE user_id=? AND request_key=?")
      .get(uid, requestKey);
    if (old) {
      fail(
        old.kind === kind,
        "This request belongs to a different work order",
        409,
      );
      return jobView(old);
    }
    fail(Object.hasOwn(content.jobs, kind), "Unknown work order");
    const def = content.jobs[kind];
    free(uid);
    atWork(uid, def);
    for (const [item, qty] of Object.entries(def.inputs)) stock(item, -qty);
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO frontier_jobs(id,user_id,request_key,kind,started_at,ends_at,challenge) VALUES (?,?,?,?,?,?,?)",
    ).run(
      id,
      uid,
      requestKey,
      kind,
      now(),
      now() + def.seconds,
      JSON.stringify(newChallenge(def.mechanic)),
    );
    reserve(uid, "job", id);
    return jobView(
      db.prepare("SELECT * FROM frontier_jobs WHERE id=?").get(id),
    );
  });
  const actJob = transact((uid, id, step, nonce, gesture) => {
    const j = db
      .prepare("SELECT * FROM frontier_jobs WHERE id=? AND user_id=?")
      .get(id, uid);
    fail(j, "Work order not found", 404);
    if (j.status !== "active") return jobView(j);
    if (Number.isInteger(step) && step < j.step) return jobView(j);
    fail(step === j.step, "Work order changed; refresh and try again", 409);
    const def = content.jobs[j.kind],
      c = parse(j.challenge);
    fail(nonce === c.nonce, "Challenge expired", 409);
    fail(now() >= c.issued_at + 2, "Take a moment to line up the work", 429);
    const result = inspect(c, gesture, now() - c.issued_at);
    fail(result.valid, "A complete touch gesture is required");
    db.prepare(
      "UPDATE frontier_jobs SET step=step+1,successes=successes+?,challenge=? WHERE id=?",
    ).run(
      result.passed ? 1 : 0,
      JSON.stringify(newChallenge(def.mechanic)),
      id,
    );
    const updated = db
      .prepare("SELECT * FROM frontier_jobs WHERE id=?")
      .get(id);
    if (updated.successes >= def.steps) finishJob(updated);
    return {
      ...jobView(db.prepare("SELECT * FROM frontier_jobs WHERE id=?").get(id)),
      feedback: result,
    };
  });
  const resumeJob = transact((uid, id) => {
    const j = db
      .prepare("SELECT * FROM frontier_jobs WHERE id=? AND user_id=?")
      .get(id, uid);
    fail(j, "Work order not found", 404);
    if (j.status === "active" && parse(j.challenge)?.version !== 3) {
      j.challenge = JSON.stringify(newChallenge(content.jobs[j.kind].mechanic));
      db.prepare("UPDATE frontier_jobs SET challenge=? WHERE id=?").run(
        j.challenge,
        id,
      );
    }
    return jobView(j);
  });
  const travel = transact((uid, to) => {
    ensure(uid);
    settleTravel(uid);
    fail(
      content.locations.some((l) => l.id === to),
      "Unknown destination",
    );
    const p = db
      .prepare("SELECT location,travel FROM frontier_players WHERE user_id=?")
      .get(uid);
    if (p.travel) {
      fail(parse(p.travel).to === to, "You are already on the trail", 409);
      return parse(p.travel);
    }
    free(uid);
    return walk(uid, to);
  });
  const cancelJob = transact((uid, id) => {
    const j = db
      .prepare("SELECT * FROM frontier_jobs WHERE id=? AND user_id=?")
      .get(id, uid);
    fail(j, "Work order not found", 404);
    if (j.status === "active") finishJob(j, true);
    return jobView(
      db.prepare("SELECT * FROM frontier_jobs WHERE id=?").get(id),
    );
  });
  const createMission = transact(
    (uid, kind, role, requestKey, load = "cart") => {
      ensure(uid);
      key(requestKey);
      fail(
        kind !== "boss",
        "Attack the dragon directly from its hollow; patrol lobbies are retired",
        409,
      );
      fail(
        load === "cart" || (load === "wagon" && kind === "delivery"),
        "Unknown caravan load",
      );
      const cargo = load === "wagon" ? 6 : M.deliveryPlanks;
      const old = db
        .prepare(
          "SELECT * FROM frontier_missions WHERE owner_id=? AND request_key=?",
        )
        .get(uid, requestKey);
      if (old) {
        fail(
          old.kind === kind && old.cargo === cargo,
          "This request belongs to a different journey",
          409,
        );
        return missionView(old, uid);
      }
      fail(
        kind === "delivery" && Object.hasOwn(content.roles, role),
        "Choose a mission and role",
      );
      free(uid);
      const projects = db.prepare("SELECT * FROM frontier_projects").all();
      const project = content.projects.find(
        (p) =>
          !projects.find((x) => x.id === p.id).completed_at &&
          (!p.requires ||
            projects.find((x) => x.id === p.requires).completed_at),
      );
      assembly(uid, kind);
      stock(kind === "boss" ? "supplies" : "planks", -cargo);
      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO frontier_missions(id,owner_id,request_key,kind,project_id,created_at,challenge,boss_cycle,round_count,required_successes,cargo,min_crew) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        uid,
        requestKey,
        kind,
        kind === "delivery" ? project?.id || null : null,
        now(),
        JSON.stringify(missionChallenge(kind)),
        null,
        M.rounds,
        M.requiredSuccesses,
        cargo,
        load === "wagon" ? 2 : 1,
      );
      db.prepare(
        "INSERT INTO frontier_members(mission_id,user_id,role) VALUES (?,?,?)",
      ).run(id, uid, role);
      reserve(uid, "mission", id);
      return missionView(
        db.prepare("SELECT * FROM frontier_missions WHERE id=?").get(id),
        uid,
      );
    },
  );
  const joinMission = transact((uid, id, role) => {
    ensure(uid);
    fail(Object.hasOwn(content.roles, role), "Choose a role");
    const m = db.prepare("SELECT * FROM frontier_missions WHERE id=?").get(id);
    fail(m && m.status === "lobby", "This party has already departed", 409);
    const existing = db
      .prepare(
        "SELECT * FROM frontier_members WHERE mission_id=? AND user_id=?",
      )
      .get(id, uid);
    if (existing) return missionView(m, uid);
    free(uid);
    fail(
      !db
        .prepare("SELECT 1 FROM frontier_members WHERE mission_id=? AND role=?")
        .get(id, role),
      "This role is already taken",
      409,
    );
    fail(
      db
        .prepare("SELECT COUNT(*) n FROM frontier_members WHERE mission_id=?")
        .get(id).n < M.capacity,
      "This party is full",
      409,
    );
    walk(uid, m.kind === "boss" ? "pool" : "village");
    db.prepare(
      "INSERT INTO frontier_members(mission_id,user_id,role) VALUES (?,?,?)",
    ).run(id, uid, role);
    reserve(uid, "mission", id);
    return missionView(m, uid);
  });
  const depart = transact((uid, id) => {
    const m = db
      .prepare("SELECT * FROM frontier_missions WHERE id=? AND owner_id=?")
      .get(id, uid);
    fail(m, "Only the organizer can depart", 403);
    if (m.status === "active") return missionView(m, uid);
    fail(m.status === "lobby", "This party has ended", 409);
    if (m.kind === "boss")
      fail(
        db
          .prepare("SELECT hp>0 AND cycle=? AS valid FROM frontier_boss")
          .get(m.boss_cycle).valid,
        "The encounter has ended. Cancel to return supplies.",
        409,
      );
    const members = db
      .prepare("SELECT user_id FROM frontier_members WHERE mission_id=?")
      .all(id);
    fail(
      members.length >= m.min_crew,
      "A loaded wagon needs at least two people. Invite a crewmate or cancel to recover the cargo.",
      409,
    );
    for (const p of members) assembly(p.user_id, m.kind);
    if (m.kind === "delivery")
      for (const p of members)
        walk(
          p.user_id,
          m.project_id === "mill" ? "mill" : "bridge",
          m.round_count * M.roundSeconds,
        );
    db.prepare(
      "UPDATE frontier_missions SET status='active',started_at=?,ends_at=?,challenge=? WHERE id=?",
    ).run(
      now(),
      now() + m.round_count * M.roundSeconds,
      JSON.stringify(missionChallenge(m.kind)),
      id,
    );
    return missionView(
      db.prepare("SELECT * FROM frontier_missions WHERE id=?").get(id),
      uid,
    );
  });
  const leave = transact((uid, id) => {
    const m = db.prepare("SELECT * FROM frontier_missions WHERE id=?").get(id);
    fail(m, "Party not found", 404);
    const member = db
      .prepare(
        "SELECT * FROM frontier_members WHERE mission_id=? AND user_id=?",
      )
      .get(id, uid);
    fail(member, "You are not in this party", 403);
    fail(
      m.status === "lobby",
      "A journey already underway must finish before taking another job",
      409,
    );
    if (m.owner_id === uid) refundMission(m);
    else {
      db.prepare(
        "DELETE FROM frontier_members WHERE mission_id=? AND user_id=?",
      ).run(id, uid);
      db.prepare(
        "DELETE FROM frontier_commitments WHERE user_id=? AND ref=?",
      ).run(uid, id);
    }
    return { ok: true };
  });
  const actMission = transact((uid, id, round, nonce, gesture) => {
    const m = db.prepare("SELECT * FROM frontier_missions WHERE id=?").get(id);
    fail(m, "Party not found", 404);
    const p = db
      .prepare(
        "SELECT * FROM frontier_members WHERE mission_id=? AND user_id=?",
      )
      .get(id, uid);
    fail(p, "Join this party first", 403);
    if (m.status === "done") return missionView(m, uid);
    fail(
      m.status === "active" && Number.isInteger(round) && round === m.round,
      "This encounter has moved on",
      409,
    );
    if (
      db
        .prepare(
          "SELECT 1 FROM frontier_actions WHERE mission_id=? AND user_id=? AND round=?",
        )
        .get(id, uid, round)
    )
      return missionView(m, uid);
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM frontier_members WHERE mission_id=?")
      .get(id).n;
    const c = parse(m.challenge)[activeRole(m, p, count)];
    fail(nonce === c.nonce, "Challenge expired", 409);

    fail(
      now() >= m.started_at + round * M.roundSeconds + 2,
      "Line up your action first",
      429,
    );
    const result = inspect(c, gesture, now() - c.issued_at);
    fail(result.valid, "A complete touch gesture is required");
    const correct = result.passed ? 1 : 0;
    db.prepare("INSERT INTO frontier_actions VALUES (?,?,?,?)").run(
      id,
      uid,
      round,
      correct,
    );
    db.prepare(
      "UPDATE frontier_members SET actions=actions+1,successes=successes+? WHERE mission_id=? AND user_id=?",
    ).run(correct, id, uid);
    return missionView(m, uid);
  });
  const cosmetic = transact((uid, item, equip = false) => {
    ensure(uid);
    const def = content.cosmetics.find((x) => x.id === item);
    fail(def || item === null, "Unknown keepsake");
    if (!equip) {
      fail(def, "Choose a keepsake");
      if (
        !db
          .prepare(
            "SELECT 1 FROM frontier_cosmetics WHERE user_id=? AND item=?",
          )
          .get(uid, item)
      ) {
        fail(
          db
            .prepare("UPDATE users SET coins=coins-? WHERE id=? AND coins>=?")
            .run(def.price, uid, def.price).changes === 1,
          "Not enough coins",
          409,
        );
        db.prepare("INSERT INTO frontier_cosmetics VALUES (?,?)").run(
          uid,
          item,
        );
      }
    } else
      fail(
        item === null ||
          db
            .prepare(
              "SELECT 1 FROM frontier_cosmetics WHERE user_id=? AND item=?",
            )
            .get(uid, item),
        "You do not own this keepsake",
        403,
      );
    db.prepare("UPDATE frontier_players SET equipped=? WHERE user_id=?").run(
      item,
      uid,
    );
    return { ok: true };
  });
  return {
    db,
    content,
    now,
    tick,
    state,
    startJob,
    actJob,
    resumeJob,
    travel,
    cancelJob,
    createMission,
    bossView: transact((uid) => {
      ensure(uid);
      return siege.snapshot(uid);
    }),
    startAssault: transact((uid, key) => {
      settleTravel(uid);
      return siege.start(uid, key);
    }),
    assault: transact((uid, id) => siege.view(uid, id)),
    actAssault: transact((uid, id, nonce, gesture) =>
      siege.act(uid, id, nonce, gesture),
    ),
    cancelAssault: transact((uid, id) => siege.cancel(uid, id)),
    prepareBoss: transact((uid, item, amount, key) =>
      siege.contribute(uid, item, amount, key),
    ),
    joinMission,
    depart,
    leave,
    actMission,
    cosmetic,
    mission: (uid, id) => {
      tick();
      const m = db
        .prepare("SELECT * FROM frontier_missions WHERE id=?")
        .get(id);
      fail(m, "Party not found", 404);
      return missionView(m, uid);
    },
  };
}
module.exports = { createEngine, FrontierError };
