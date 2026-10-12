"use strict";
const { randomUUID } = require("node:crypto");
const { makeChallenge, inspect } = require("./gestures");
const config = require("./content.json").siege;
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
    onDamage = () => {},
  },
) {
  const current = () =>
    db.prepare("SELECT * FROM frontier_boss WHERE id=1").get();
  const visible = () =>
    Boolean(
      db
        .prepare("SELECT completed_at FROM frontier_projects WHERE id='bridge'")
        .get()?.completed_at,
    );
  function snapshot(uid) {
    if (!visible()) return null;
    const b = current();
    const contribution =
      db
        .prepare(
          "SELECT contribution FROM frontier_boss_honors WHERE cycle=? AND user_id=?",
        )
        .get(b.cycle, uid)?.contribution || 0;
    const payout = db
      .prepare("SELECT coins FROM frontier_rewards WHERE ref=? AND user_id=?")
      .get(`dragon:${b.cycle}:${uid}`, uid)?.coins;
    return {
      ...b,
      name: config.name,
      contribution,
      payout: payout ?? null,
      estimatedCoins:
        Math.floor((b.reward_pool * contribution * 100) / b.max_hp) / 100,
      contributors: db
        .prepare(
          "SELECT COUNT(*) n FROM frontier_boss_honors WHERE cycle=? AND contribution>0",
        )
        .get(b.cycle).n,
      leaders: db
        .prepare(
          "SELECT h.user_id,u.first_name AS name,h.contribution FROM frontier_boss_honors h JOIN users u ON u.id=h.user_id WHERE cycle=? ORDER BY contribution DESC,h.user_id LIMIT 10",
        )
        .all(b.cycle),
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
    const rows = db
      .prepare(
        "SELECT user_id,contribution FROM frontier_boss_honors WHERE cycle=? AND contribution>0 ORDER BY user_id",
      )
      .all(b.cycle);
    const total = rows.reduce((n, r) => n + r.contribution, 0);
    if (!total) return;
    let remainder = b.reward_pool;
    for (const r of rows) {
      const share = BigInt(b.reward_pool) * BigInt(r.contribution);
      r.coins = Number(share / BigInt(total));
      r.fraction = Number(share % BigInt(total));
      remainder -= r.coins;
    }
    rows.sort((a, b) => b.fraction - a.fraction || a.user_id - b.user_id);
    for (let i = 0; i < remainder; i++) rows[i].coins++;
    for (const r of rows)
      reward(
        r.user_id,
        `dragon:${b.cycle}:${r.user_id}`,
        r.coins,
        0,
        `${config.name} defeated · damage share`,
      );
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
    }
    const killed = damage > 0 && damage === b.hp;
    if (killed) {
      db.prepare(
        "UPDATE frontier_boss SET hp=0,phase='defeated',defeated_at=? WHERE id=1",
      ).run(now());
      pay(b);
      event(
        `${config.name} has fallen. Every damage contributor received their share.`,
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
    const b = current();
    if (b.phase === "defeated" && now() >= b.defeated_at + config.restSeconds) {
      db.prepare(
        "INSERT OR IGNORE INTO frontier_boss_cycles SELECT cycle,max_hp,reward_pool,defeated_at FROM frontier_boss WHERE id=1",
      ).run();
      db.prepare(
        "UPDATE frontier_boss SET cycle=cycle+1,hp=?,max_hp=?,reward_pool=?,phase='preparing',supplies_filled=0,weapons_filled=0,supplies_required=?,weapons_required=?,opened_at=NULL,defeated_at=NULL WHERE id=1",
      ).run(
        config.maxHp,
        config.maxHp,
        config.rewardPool,
        config.suppliesRequired,
        config.weaponsRequired,
      );
      event(
        "Mirewake stirs again. Prepare a new expedition; past damage rewards are preserved.",
      );
    }
  }
  return { snapshot, start, view, act, cancel, contribute, tick };
}
module.exports = { createSiege };
