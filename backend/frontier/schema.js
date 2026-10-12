"use strict";
const content = require("./content.json");
function install(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS frontier_players (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      xp INTEGER NOT NULL DEFAULT 0, jobs INTEGER NOT NULL DEFAULT 0,
      deliveries INTEGER NOT NULL DEFAULT 0, boss_contribution INTEGER NOT NULL DEFAULT 0,
      equipped TEXT, joined_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS frontier_stock (item TEXT PRIMARY KEY, quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0));
    CREATE TABLE IF NOT EXISTS frontier_projects (id TEXT PRIMARY KEY, progress INTEGER NOT NULL DEFAULT 0, completed_at INTEGER);
    CREATE TABLE IF NOT EXISTS frontier_jobs (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
      kind TEXT NOT NULL, started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', step INTEGER NOT NULL DEFAULT 0,
      successes INTEGER NOT NULL DEFAULT 0, challenge TEXT NOT NULL, result TEXT,
      UNIQUE(user_id, request_key)
    );
    CREATE TABLE IF NOT EXISTS frontier_missions (
      id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
      kind TEXT NOT NULL, project_id TEXT, status TEXT NOT NULL DEFAULT 'lobby',
      created_at INTEGER NOT NULL, started_at INTEGER, ends_at INTEGER,
      round INTEGER NOT NULL DEFAULT 0, health INTEGER NOT NULL DEFAULT 100,
      challenge TEXT NOT NULL, result TEXT, boss_cycle INTEGER,
      UNIQUE(owner_id,request_key)
    );
    CREATE TABLE IF NOT EXISTS frontier_members (
      mission_id TEXT NOT NULL REFERENCES frontier_missions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id), role TEXT NOT NULL,
      actions INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(mission_id,user_id), UNIQUE(mission_id,role)
    );
    CREATE TABLE IF NOT EXISTS frontier_actions (
      mission_id TEXT NOT NULL REFERENCES frontier_missions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id), round INTEGER NOT NULL, correct INTEGER NOT NULL,
      PRIMARY KEY(mission_id,user_id,round)
    );
    CREATE TABLE IF NOT EXISTS frontier_commitments (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, ref TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS frontier_rewards (
      ref TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), coins INTEGER NOT NULL,
      xp INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(ref,user_id)
    );
    CREATE TABLE IF NOT EXISTS frontier_cosmetics (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, item TEXT NOT NULL,
      PRIMARY KEY(user_id,item)
    );
    CREATE TABLE IF NOT EXISTS frontier_boss (
      id INTEGER PRIMARY KEY CHECK(id=1), cycle INTEGER NOT NULL DEFAULT 1, hp INTEGER NOT NULL,
      defeated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS frontier_boss_honors (
      cycle INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), contribution INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(cycle,user_id)
    );
    CREATE TABLE IF NOT EXISTS frontier_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS frontier_recruitment (
      message_id INTEGER PRIMARY KEY REFERENCES global_messages(id) ON DELETE CASCADE,
      mission_id TEXT NOT NULL REFERENCES frontier_missions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS frontier_active_jobs ON frontier_jobs(status,ends_at);
    CREATE INDEX IF NOT EXISTS frontier_active_missions ON frontier_missions(status,ends_at);
    CREATE INDEX IF NOT EXISTS frontier_reward_history ON frontier_rewards(user_id,created_at);
  `);
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(frontier_players)")
      .all()
      .map((c) => c.name),
  );
  for (const [name, type] of [
    ["location", "TEXT NOT NULL DEFAULT 'village'"],
    ["travel", "TEXT"],
    ["next_work_coin_at", "INTEGER NOT NULL DEFAULT 0"],
  ])
    if (!columns.has(name))
      db.exec(`ALTER TABLE frontier_players ADD COLUMN ${name} ${type}`);
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS frontier_assaults (
      id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,
      cycle INTEGER NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
      challenge TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',result TEXT,UNIQUE(user_id,request_key));
      CREATE INDEX IF NOT EXISTS frontier_assault_expiry ON frontier_assaults(status,expires_at);
      CREATE TABLE IF NOT EXISTS frontier_preparation_receipts(user_id INTEGER NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,cycle INTEGER NOT NULL,item TEXT NOT NULL,requested INTEGER NOT NULL,accepted INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,request_key));
      CREATE TABLE IF NOT EXISTS frontier_boss_cycles(cycle INTEGER PRIMARY KEY,max_hp INTEGER NOT NULL,reward_pool INTEGER NOT NULL,defeated_at INTEGER NOT NULL);`);
    const bossColumns = new Set(
      db
        .prepare("PRAGMA table_info(frontier_boss)")
        .all()
        .map((c) => c.name),
    );
    for (const [name, type] of Object.entries({
      phase: "TEXT NOT NULL DEFAULT 'preparing'",
      max_hp: "INTEGER NOT NULL DEFAULT 0",
      reward_pool: "INTEGER NOT NULL DEFAULT 0",
      supplies_required: "INTEGER NOT NULL DEFAULT 0",
      weapons_required: "INTEGER NOT NULL DEFAULT 0",
      supplies_filled: "INTEGER NOT NULL DEFAULT 0",
      weapons_filled: "INTEGER NOT NULL DEFAULT 0",
      opened_at: "INTEGER",
      siege_version: "INTEGER NOT NULL DEFAULT 0",
    }))
      if (!bossColumns.has(name))
        db.exec(`ALTER TABLE frontier_boss ADD COLUMN ${name} ${type}`);
    const missionColumns = new Set(
      db
        .prepare("PRAGMA table_info(frontier_missions)")
        .all()
        .map((c) => c.name),
    );
    for (const [name, type] of [
      ["round_count", "INTEGER NOT NULL DEFAULT 12"],
      ["required_successes", "INTEGER NOT NULL DEFAULT 4"],
      ["cargo", "INTEGER NOT NULL DEFAULT 2"],
      ["min_crew", "INTEGER NOT NULL DEFAULT 1"],
    ])
      if (!missionColumns.has(name))
        db.exec(`ALTER TABLE frontier_missions ADD COLUMN ${name} ${type}`);
    for (const item of ["wood", "ore", "planks", "supplies", "weapons"])
      db.prepare("INSERT OR IGNORE INTO frontier_stock(item) VALUES (?)").run(
        item,
      );
    for (const p of content.projects)
      db.prepare("INSERT OR IGNORE INTO frontier_projects(id) VALUES (?)").run(
        p.id,
      );
    db.prepare("INSERT OR IGNORE INTO frontier_boss(id,hp) VALUES (1,?)").run(
      content.siege.maxHp,
    );
    if (
      !db.prepare("SELECT siege_version FROM frontier_boss WHERE id=1").get()
        .siege_version
    ) {
      // Preserve old honors; never convert old patrol points into paid dragon damage.
      const old = db
        .prepare("SELECT cycle FROM frontier_boss WHERE id=1")
        .get();
      const hasHonors = db
        .prepare("SELECT 1 FROM frontier_boss_honors WHERE cycle=? LIMIT 1")
        .get(old.cycle);
      const cfg = content.siege;
      db.prepare(
        "UPDATE frontier_boss SET cycle=cycle+?,hp=?,max_hp=?,reward_pool=?,supplies_required=?,weapons_required=?,phase='preparing',defeated_at=NULL,siege_version=1 WHERE id=1",
      ).run(
        hasHonors ? 1 : 0,
        cfg.maxHp,
        cfg.maxHp,
        cfg.rewardPool,
        cfg.suppliesRequired,
        cfg.weaponsRequired,
      );
      // Old field-kit batches reserved 1 timber + 2 iron; return that exact recipe once.
      for (const j of db
        .prepare(
          "SELECT id FROM frontier_jobs WHERE kind='supplies' AND status='active'",
        )
        .all()) {
        db.prepare(
          "UPDATE frontier_stock SET quantity=quantity+? WHERE item=?",
        ).run(1, "wood");
        db.prepare(
          "UPDATE frontier_stock SET quantity=quantity+? WHERE item=?",
        ).run(2, "ore");
        db.prepare(
          "UPDATE frontier_jobs SET status='cancelled',result=? WHERE id=?",
        ).run(
          JSON.stringify({
            passed: false,
            reason: "Recipe updated. Original ingredients returned.",
          }),
          j.id,
        );
        db.prepare("DELETE FROM frontier_commitments WHERE ref=?").run(j.id);
      }
      for (const m of db
        .prepare(
          "SELECT id,cargo FROM frontier_missions WHERE kind='boss' AND status IN ('lobby','active')",
        )
        .all()) {
        db.prepare(
          "UPDATE frontier_stock SET quantity=quantity+? WHERE item='supplies'",
        ).run(m.cargo);
        db.prepare(
          "UPDATE frontier_missions SET status='cancelled',result=? WHERE id=?",
        ).run(
          JSON.stringify({
            passed: false,
            reason: "The expedition rules changed. Reserved kits returned.",
          }),
          m.id,
        );
        db.prepare("DELETE FROM frontier_commitments WHERE ref=?").run(m.id);
      }
    }
  })();
}
module.exports = { install };
