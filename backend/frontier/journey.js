"use strict";
const rules = require("./content.json").siege.rewards;
// Keep the action history for stats, and cache only paid work/delivery actions.
function createJourney(db, now) {
  db.exec(`CREATE TABLE IF NOT EXISTS frontier_journey_actions(cycle INTEGER NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),ref TEXT NOT NULL,kind TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(cycle,user_id,ref));
    CREATE INDEX IF NOT EXISTS frontier_journey_score ON frontier_journey_actions(cycle,user_id);
    CREATE TABLE IF NOT EXISTS frontier_journey_members(cycle INTEGER NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),actions INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(cycle,user_id));
    CREATE TABLE IF NOT EXISTS frontier_journey_migrations(cycle INTEGER PRIMARY KEY);`);
  db.transaction(() => {
    if (
      !db
        .prepare("PRAGMA table_info(frontier_journey_members)")
        .all()
        .some((c) => c.name === "activity_actions")
    ) {
      db.exec(
        "ALTER TABLE frontier_journey_members ADD COLUMN activity_actions INTEGER NOT NULL DEFAULT 0",
      );
      db.exec(
        "UPDATE frontier_journey_members SET activity_actions=(SELECT COUNT(*) FROM frontier_journey_actions a WHERE a.cycle=frontier_journey_members.cycle AND a.user_id=frontier_journey_members.user_id AND a.kind IN ('work','caravan'))",
      );
    }
    db.exec(
      "INSERT OR IGNORE INTO frontier_journey_members(cycle,user_id,actions,activity_actions) SELECT cycle,user_id,COUNT(*),SUM(CASE WHEN kind IN ('work','caravan') THEN 1 ELSE 0 END) FROM frontier_journey_actions GROUP BY cycle,user_id",
    );
  })();
  function record(uid, ref, kind) {
    const b = db
      .prepare("SELECT cycle,phase FROM frontier_boss WHERE id=1")
      .get();
    if (b.phase === "defeated") return;
    if (
      db
        .prepare(
          "INSERT OR IGNORE INTO frontier_journey_actions VALUES(?,?,?,?,?)",
        )
        .run(b.cycle, uid, ref, kind, now()).changes
    )
      db.prepare(
        "INSERT INTO frontier_journey_members(cycle,user_id,actions,activity_actions) VALUES(?,?,1,?) ON CONFLICT(cycle,user_id) DO UPDATE SET actions=actions+1,activity_actions=activity_actions+excluded.activity_actions",
      ).run(b.cycle, uid, ["work", "caravan"].includes(kind) ? 1 : 0);
  }
  function valued(row) {
    return {
      ...row,
      earnedCoins:
        row.activityActions * rules.activityCoins +
        Math.floor(row.damage / rules.damageStep) * rules.damageCoins,
    };
  }
  const memberSelect =
    "SELECT a.user_id,u.first_name AS name,a.actions,a.activity_actions AS activityActions,COALESCE(h.contribution,0) AS damage FROM frontier_journey_members a JOIN users u ON u.id=a.user_id LEFT JOIN frontier_boss_honors h ON h.cycle=a.cycle AND h.user_id=a.user_id";
  function rows(cycle) {
    return db
      .prepare(
        `${memberSelect} WHERE a.cycle=? ORDER BY a.actions DESC,a.user_id`,
      )
      .all(cycle)
      .map(valued);
  }
  function member(cycle, uid) {
    return valued(
      db
        .prepare(`${memberSelect} WHERE a.cycle=? AND a.user_id=?`)
        .get(cycle, uid) || {
        user_id: uid,
        actions: 0,
        activityActions: 0,
        damage: 0,
      },
    );
  }
  // Recover the current unfinished journey once when upgrading. Settled cycles stay settled.
  const b = db
    .prepare("SELECT cycle,phase FROM frontier_boss WHERE id=1")
    .get();
  if (
    !db
      .prepare("SELECT 1 FROM frontier_journey_migrations WHERE cycle=?")
      .get(b.cycle)
  )
    db.transaction(() => {
      const since = db
        .prepare(
          "SELECT COALESCE(MAX(defeated_at),0) n FROM frontier_boss_cycles WHERE cycle<?",
        )
        .get(b.cycle).n;
      if (b.phase !== "defeated") {
        for (const j of db
          .prepare(
            "SELECT id,user_id,successes FROM frontier_jobs WHERE started_at>=? AND successes>0",
          )
          .all(since))
          for (let i = 0; i < j.successes; i++)
            record(j.user_id, `job:${j.id}:${i}`, "work");
        for (const a of db
          .prepare(
            "SELECT a.* FROM frontier_actions a JOIN frontier_missions m ON m.id=a.mission_id WHERE m.created_at>=? AND a.correct=1",
          )
          .all(since))
          record(a.user_id, `mission:${a.mission_id}:${a.round}`, "caravan");
        for (const a of db
          .prepare(
            "SELECT * FROM frontier_boss_hits WHERE cycle=? AND damage>0",
          )
          .all(b.cycle))
          record(a.user_id, `hit:${a.request_key}`, "battle");
        for (const a of db
          .prepare(
            "SELECT id,user_id FROM frontier_assaults WHERE cycle=? AND status='done' AND json_extract(result,'$.damage')>0",
          )
          .all(b.cycle))
          record(a.user_id, `assault:${a.id}`, "battle");
        for (const a of db
          .prepare(
            "SELECT DISTINCT user_id,item FROM frontier_preparation_receipts WHERE cycle=? AND accepted>0",
          )
          .all(b.cycle))
          record(a.user_id, `prepare:${a.item}`, "preparation");
      }
      db.prepare("INSERT INTO frontier_journey_migrations VALUES(?)").run(
        b.cycle,
      );
    })();
  return { record, rows, member };
}
module.exports = { createJourney };
