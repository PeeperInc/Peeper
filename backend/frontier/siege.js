"use strict";
const { randomUUID } = require("node:crypto");
const { makeChallenge, inspect } = require("./gestures");
const config = require("./content.json").siege;
const eventConfig = require("./content.json").event;
const { createJourney } = require("./journey");
const combatRules = require("./combat.cjs");
// Runs inside the engine's transaction, including death and all offline payouts.
function createSiege(
  db,
  {
    now,
    fail,
    ensure,
    free,
    reserve,
    release,
    reward,
    event,
    weather,
    combatNow = now,
    onDamage = () => {},
    onDefeat = () => {},
  },
) {
  db.exec(`CREATE TABLE IF NOT EXISTS frontier_boss_fighters(user_id INTEGER PRIMARY KEY REFERENCES users(id),cycle INTEGER NOT NULL,hp INTEGER NOT NULL DEFAULT 100,last_seen REAL NOT NULL,next_attack REAL NOT NULL,strike_ready REAL NOT NULL DEFAULT 0,heavy_ready REAL NOT NULL DEFAULT 0,guard_ready REAL NOT NULL DEFAULT 0,guard_until REAL NOT NULL DEFAULT 0,revive_at REAL NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS frontier_boss_hits(user_id INTEGER NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,kind TEXT NOT NULL,damage INTEGER NOT NULL,cycle INTEGER NOT NULL,created_at REAL NOT NULL,PRIMARY KEY(user_id,request_key));CREATE INDEX IF NOT EXISTS frontier_boss_hits_time ON frontier_boss_hits(created_at);`);
  if (
    !db
      .prepare("PRAGMA table_info(frontier_boss_fighters)")
      .all()
      .some((c) => c.name === "stagger_until")
  )
    db.exec(
      "ALTER TABLE frontier_boss_fighters ADD COLUMN stagger_until REAL NOT NULL DEFAULT 0",
    );
  const journey = createJourney(db, now);
  const fighterColumns = new Set(
    db
      .prepare("PRAGMA table_info(frontier_boss_fighters)")
      .all()
      .map((c) => c.name),
  );
  const actionColumns = {
    combat_version: "INTEGER NOT NULL DEFAULT 0",
    lane: "INTEGER NOT NULL DEFAULT 0",
    attack_index: "INTEGER NOT NULL DEFAULT 0",
    attack_target: "INTEGER NOT NULL DEFAULT 0",
    combo: "INTEGER NOT NULL DEFAULT 0",
    combo_until: "REAL NOT NULL DEFAULT 0",
    counter_until: "REAL NOT NULL DEFAULT 0",
    perfect_index: "INTEGER NOT NULL DEFAULT -1",
    dodge_ready: "REAL NOT NULL DEFAULT 0",
    dodge_until: "REAL NOT NULL DEFAULT 0",
    last_dodge: "REAL NOT NULL DEFAULT 0",
    last_hurt: "REAL NOT NULL DEFAULT 0",
    last_evade: "REAL NOT NULL DEFAULT 0",
    input_at: "REAL NOT NULL DEFAULT 0",
  };
  db.transaction(() => {
    for (const [name, type] of Object.entries(actionColumns))
      if (!fighterColumns.has(name))
        db.exec(
          `ALTER TABLE frontier_boss_fighters ADD COLUMN ${name} ${type}`,
        );
    if (
      !db
        .prepare("PRAGMA table_info(frontier_boss_hits)")
        .all()
        .some((c) => c.name === "outcome")
    )
      db.exec("ALTER TABLE frontier_boss_hits ADD COLUMN outcome TEXT");
  })();
  const current = () =>
    db.prepare("SELECT * FROM frontier_boss WHERE id=1").get();
  const visible = () =>
    Boolean(
      db
        .prepare("SELECT completed_at FROM frontier_projects WHERE id='bridge'")
        .get()?.completed_at,
    );
  function progress(uid) {
    const b = current(),
      row = journey.member(b.cycle, uid);
    const paid = db
      .prepare(
        "SELECT coins,xp FROM frontier_rewards WHERE ref=? AND user_id=?",
      )
      .get(`dragon:${b.cycle}:${uid}`, uid);
    return {
      cycle: b.cycle,
      actions: row.actions,
      activityActions: row.activityActions,
      damage: row.damage,
      earnedCoins: paid?.coins ?? row.earnedCoins,
      payout: paid?.coins ?? null,
      payoutXp: paid?.xp ?? null,
      damageProgress: row.damage % config.rewards.damageStep,
      rewardRules: config.rewards,
    };
  }
  function snapshot(uid) {
    if (!visible()) return null;
    const b = current();
    const participants = journey.rows(b.cycle),
      actions = participants.find((p) => p.user_id === uid)?.actions || 0,
      totalActions = participants.reduce((n, p) => n + p.actions, 0);
    const contribution =
      db
        .prepare(
          "SELECT contribution FROM frontier_boss_honors WHERE cycle=? AND user_id=?",
        )
        .get(b.cycle, uid)?.contribution || 0;
    const personal = progress(uid);
    const { reward_pool: legacyPool, ...boss } = b;
    return {
      ...boss,
      ...personal,
      name: config.name,
      contribution,
      actions,
      totalActions,
      results_until: b.defeated_at
        ? b.defeated_at + eventConfig.resultsSeconds
        : null,
      estimatedCoins: personal.earnedCoins,
      contributors: participants.length,
      leaders: participants.slice(0, 10),
      previousPayouts: db
        .prepare(
          "SELECT coins,created_at,ref FROM frontier_rewards WHERE user_id=? AND ref LIKE 'dragon:%' ORDER BY created_at DESC LIMIT 5",
        )
        .all(uid),
    };
  }
  function view(uid, id) {
    const a = db
      .prepare("SELECT * FROM frontier_assaults WHERE id=? AND user_id=?")
      .get(id, uid);
    fail(a, "Attempt not found", 404);
    return {
      ...a,
      request_key: undefined,
      challenge: a.status === "active" ? JSON.parse(a.challenge) : null,
      result: a.result ? JSON.parse(a.result) : null,
    };
  }
  function start(uid, key) {
    ensure(uid);
    fail(
      typeof key === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(key),
      "Invalid request identity",
    );
    const old = db
      .prepare(
        "SELECT id FROM frontier_assaults WHERE user_id=? AND request_key=?",
      )
      .get(uid, key);
    if (old) return view(uid, old.id);
    free(uid);
    fail(visible(), "Restore the bridge first", 409);
    const b = current();
    fail(
      b.phase === "open" && b.hp > 0,
      "The expedition must be equipped before attacking",
      409,
    );
    const p = db
      .prepare("SELECT location,travel FROM frontier_players WHERE user_id=?")
      .get(uid);
    fail(
      !p.travel && p.location === "pool",
      "Follow the trail to the dragon first",
      409,
    );
    const id = randomUUID(),
      c = makeChallenge("dodge", now(), weather());
    db.prepare(
      "INSERT INTO frontier_assaults(id,user_id,request_key,cycle,created_at,expires_at,challenge) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      uid,
      key,
      b.cycle,
      now(),
      now() + config.attemptExpirySeconds,
      JSON.stringify(c),
    );
    reserve(uid, "assault", id);
    return view(uid, id);
  }
  function pay(b) {
    const rows = journey.rows(b.cycle);
    for (const r of rows)
      reward(
        r.user_id,
        `dragon:${b.cycle}:${r.user_id}`,
        r.earnedCoins,
        Math.min(100, r.actions),
        `${config.name} defeated · personal journey reward`,
      );
    db.prepare(
      "INSERT OR IGNORE INTO frontier_boss_cycles SELECT cycle,max_hp,reward_pool,defeated_at FROM frontier_boss WHERE id=1",
    ).run();
  }
  function act(uid, id, nonce, input) {
    const a = view(uid, id);
    if (a.status !== "active") return a;
    fail(a.challenge.nonce === nonce, "Challenge expired", 409);
    const grade = inspect(a.challenge, input, now() - a.challenge.issued_at);
    fail(grade.valid, "A complete touch gesture is required");
    const b = current();
    const damage =
      b.cycle === a.cycle && b.phase === "open"
        ? Math.min(
            b.hp,
            grade.passed
              ? Math.max(
                  1,
                  Math.round((config.maxDamage * grade.quality) / 100),
                )
              : 0,
          )
        : 0;
    if (damage) {
      db.prepare("UPDATE frontier_boss SET hp=hp-? WHERE id=1").run(damage);
      db.prepare(
        "INSERT INTO frontier_boss_honors(cycle,user_id,contribution) VALUES(?,?,?) ON CONFLICT(cycle,user_id) DO UPDATE SET contribution=contribution+excluded.contribution",
      ).run(a.cycle, uid, damage);
      db.prepare(
        "UPDATE frontier_players SET boss_contribution=boss_contribution+? WHERE user_id=?",
      ).run(damage, uid);
      reward(uid, `attack:${id}`, 0, 3, "Dragon assault");
      onDamage(uid);
      journey.record(uid, `assault:${id}`, "battle");
    }
    const killed = damage > 0 && damage === b.hp;
    if (killed) {
      db.prepare(
        "UPDATE frontier_boss SET hp=0,phase='defeated',defeated_at=? WHERE id=1",
      ).run(now());
      pay(b);
      onDefeat();
      event(
        `${config.name} has fallen. Journey rewards are paid. Results remain available for 24 hours.`,
      );
    }
    const result = {
      damage,
      quality: grade.quality,
      killed,
      passed: damage > 0,
      cycle: a.cycle,
      reason: damage
        ? null
        : grade.passed
          ? "The dragon was already defeated. No supplies or coins were spent."
          : "No clean counterattack. Your earlier damage is safe; try again.",
    };
    db.prepare(
      "UPDATE frontier_assaults SET status='done',result=? WHERE id=?",
    ).run(JSON.stringify(result), id);
    release(id);
    return view(uid, id);
  }
  function cancel(uid, id) {
    const a = view(uid, id);
    if (a.status === "active") {
      db.prepare(
        "UPDATE frontier_assaults SET status='cancelled',result=? WHERE id=?",
      ).run(
        JSON.stringify({
          damage: 0,
          reason: "Attempt ended. Earlier damage is safe.",
        }),
        id,
      );
      release(id);
    }
    return view(uid, id);
  }
  function contribute(uid, item, amount, key) {
    ensure(uid);
    fail(visible(), "Restore the bridge first", 409);
    fail(
      ["supplies", "weapons"].includes(item) &&
        Number.isSafeInteger(amount) &&
        amount > 0 &&
        amount <= 10000,
      "Choose a valid preparation amount",
    );
    fail(
      typeof key === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(key),
      "Invalid request identity",
    );
    const old = db
      .prepare(
        "SELECT * FROM frontier_preparation_receipts WHERE user_id=? AND request_key=?",
      )
      .get(uid, key);
    if (old) {
      fail(
        old.item === item && old.requested === amount,
        "This request belongs to another contribution",
        409,
      );
      return { accepted: old.accepted, boss: snapshot(uid) };
    }
    const b = current();
    fail(b.phase === "preparing", "Preparation is already complete", 409);
    const required = b[item + "_required"],
      remaining = required - b[item + "_filled"];
    const stock = db
      .prepare("SELECT quantity FROM frontier_stock WHERE item=?")
      .get(item).quantity;
    const accepted = Math.min(amount, remaining, stock);
    fail(
      accepted > 0,
      remaining
        ? "The shared stores need more crafted items"
        : "This reserve is already full",
      409,
    );
    db.prepare(
      "UPDATE frontier_stock SET quantity=quantity-? WHERE item=?",
    ).run(accepted, item);
    db.prepare(
      `UPDATE frontier_boss SET ${item}_filled=${item}_filled+? WHERE id=1`,
    ).run(accepted);
    db.prepare(
      "INSERT INTO frontier_preparation_receipts VALUES(?,?,?,?,?,?,?)",
    ).run(uid, key, b.cycle, item, amount, accepted, now());
    journey.record(uid, `prepare:${item}`, "preparation");
    const after = current();
    if (
      after.supplies_filled >= after.supplies_required &&
      after.weapons_filled >= after.weapons_required
    ) {
      db.prepare(
        "UPDATE frontier_boss SET phase='open',opened_at=? WHERE id=1",
      ).run(now());
      event("The expedition is equipped. Everyone can now attack Mirewake.");
    }
    return { accepted, boss: snapshot(uid) };
  }
  function tick() {
    for (const a of db
      .prepare(
        "SELECT id FROM frontier_assaults WHERE status='active' AND expires_at<=?",
      )
      .all(now())) {
      db.prepare(
        "UPDATE frontier_assaults SET status='expired',result=? WHERE id=?",
      ).run(
        JSON.stringify({
          damage: 0,
          reason: "Attempt expired. Earlier damage is safe.",
        }),
        a.id,
      );
      release(a.id);
    }
  }
  function fighter(uid) {
    ensure(uid);
    free(uid);
    fail(visible(), "Restore the bridge first", 409);
    const p = db
      .prepare("SELECT location,travel FROM frontier_players WHERE user_id=?")
      .get(uid);
    fail(
      p.location === "pool" && !p.travel,
      "Follow the trail to the dragon first",
      409,
    );
    const b = current(),
      t = combatNow();
    fail(
      b.phase !== "preparing",
      "The expedition must be equipped before attacking",
      409,
    );
    let f = db
      .prepare("SELECT * FROM frontier_boss_fighters WHERE user_id=?")
      .get(uid);
    if (!f || f.cycle !== b.cycle) {
      db.prepare(
        "INSERT OR REPLACE INTO frontier_boss_fighters(user_id,cycle,hp,last_seen,next_attack) VALUES(?,?,100,?,?)",
      ).run(uid, b.cycle, t, t + 4.2);
      f = db
        .prepare("SELECT * FROM frontier_boss_fighters WHERE user_id=?")
        .get(uid);
    }
    const outcome = combatRules.advance(f, b, t);
    saveFighter(f);
    return {
      ...f,
      ...outcome,
      attack: combatRules.attack(f, b, t),
      combatVersion: combatRules.VERSION,
    };
  }
  function saveFighter(f) {
    const fields = [
      ...Object.keys(actionColumns),
      "last_seen",
      "next_attack",
      "strike_ready",
      "stagger_until",
      "hp",
      "revive_at",
    ];
    db.prepare(
      `UPDATE frontier_boss_fighters SET ${fields.map((name) => `${name}=?`).join(",")} WHERE user_id=?`,
    ).run(...fields.map((name) => f[name]), f.user_id);
  }
  function combat(uid) {
    return {
      fighter: fighter(uid),
      boss: snapshot(uid),
      serverTime: combatNow(),
    };
  }
  function strike(uid, kind, key, options = {}) {
    fail(
      ["strike", "dodge", "heavy", "guard"].includes(kind),
      "Unknown combat action",
    );
    if (kind === "dodge")
      fail(
        ["left", "right"].includes(options.direction),
        "Swipe left or right",
      );
    const identity = kind === "dodge" ? `dodge:${options.direction}` : kind;
    fail(
      typeof key === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(key),
      "Invalid request identity",
    );
    const old = db
      .prepare(
        "SELECT * FROM frontier_boss_hits WHERE user_id=? AND request_key=?",
      )
      .get(uid, key);
    if (old) {
      fail(
        old.kind === identity,
        "This request belongs to another action",
        409,
      );
      return {
        ...combat(uid),
        ...JSON.parse(old.outcome || "{}"),
        damage: old.damage,
        duplicate: true,
      };
    }
    const f = fighter(uid),
      b = current(),
      t = combatNow();
    fail(b.phase === "open" && b.hp > 0, "The dragon is already defeated", 409);
    fail(
      options.at === undefined || Number.isFinite(options.at),
      "Invalid input time",
    );
    const at = Math.max(t - combatRules.GRACE, Math.min(t, options.at ?? t));
    const outcome = combatRules.input(f, b, kind, at, options.direction);
    fail(!outcome.error, outcome.error, outcome.status);
    saveFighter(f);
    const damage = outcome.damage;
    if (damage) {
      db.prepare("UPDATE frontier_boss SET hp=hp-? WHERE id=1").run(damage);
      db.prepare(
        "INSERT INTO frontier_boss_honors(cycle,user_id,contribution) VALUES(?,?,?) ON CONFLICT(cycle,user_id) DO UPDATE SET contribution=contribution+excluded.contribution",
      ).run(b.cycle, uid, damage);
      db.prepare(
        "UPDATE frontier_players SET boss_contribution=boss_contribution+? WHERE user_id=?",
      ).run(damage, uid);
      onDamage(uid);
      journey.record(uid, `hit:${key}`, "battle");
      if (damage === b.hp) {
        db.prepare(
          "UPDATE frontier_boss SET hp=0,phase='defeated',defeated_at=? WHERE id=1",
        ).run(now());
        pay(b);
        onDefeat();
        event(
          `${config.name} has fallen. Journey rewards are paid. Results remain available for 24 hours.`,
        );
      }
    }
    db.prepare(
      "INSERT INTO frontier_boss_hits(user_id,request_key,kind,damage,cycle,created_at,outcome) VALUES(?,?,?,?,?,?,?)",
    ).run(uid, key, identity, damage, b.cycle, t, JSON.stringify(outcome));
    return { ...combat(uid), ...outcome, damage, action: kind };
  }
  return {
    snapshot,
    start,
    view,
    act,
    cancel,
    contribute,
    tick,
    combat,
    strike,
    record: journey.record,
    progress,
  };
}
module.exports = { createSiege };
