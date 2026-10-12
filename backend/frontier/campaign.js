"use strict";
const balance = require("./balance.json");
const lines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];
const definitions = {
  wood: {
    name: "Timber crews",
    hint: "Complete sawmill orders",
    location: "sawmill",
    icon: "wood",
  },
  ore: {
    name: "Iron hands",
    hint: "Complete quarry orders",
    location: "quarry",
    icon: "ore",
  },
  planks: {
    name: "Workshop shifts",
    hint: "Make construction planks",
    location: "village",
    icon: "planks",
  },
  delivery: {
    name: "Keep supplies moving",
    hint: "Finish a caravan delivery",
    location: "village",
    icon: "cart",
  },
  work: {
    name: "A working commons",
    hint: "Complete any work order",
    location: "sawmill",
    icon: "tools",
  },
  team: {
    name: "Better together",
    hint: "Finish journeys with at least two players",
    location: "village",
    icon: "party",
  },
  driver: {
    name: "Steady wheels",
    hint: "Finish a journey as Driver or Striker",
    location: "village",
    icon: "cart",
  },
  guard: {
    name: "Watch the skies",
    hint: "Finish a journey as Guard or Defender",
    location: "village",
    icon: "shield",
  },
  mechanic: {
    name: "Helping hands",
    hint: "Finish a journey as Mechanic or Healer",
    location: "village",
    icon: "tools",
  },
  supplies: {
    name: "Ready for the marsh",
    hint: "Pack expedition kits at the Supply Mill",
    location: "mill",
    icon: "supplies",
  },
  boss: {
    name: "Push back the blight",
    hint: "Land a clean counterattack on Mirewake",
    location: "pool",
    icon: "boss",
  },
};
function createCampaign(db, now, grant) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS frontier_campaign (id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS frontier_weeks (period INTEGER PRIMARY KEY, started_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, layout TEXT NOT NULL, completed_lines INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS frontier_week_members (period INTEGER NOT NULL REFERENCES frontier_weeks(period), user_id INTEGER NOT NULL REFERENCES users(id), points INTEGER NOT NULL DEFAULT 0, seals INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(period,user_id));
  `);
  const start = () =>
    db.prepare("SELECT started_at FROM frontier_campaign WHERE id=1").get()
      ?.started_at;
  function period() {
    const began = start();
    return began === undefined
      ? 0
      : Math.max(0, Math.floor((now() - began) / balance.weekSeconds));
  }
  function weather() {
    const day = Math.floor((now() - (start() ?? now())) / 86400);
    return balance.weather[Math.max(0, day) % balance.weather.length];
  }
  function layout(n, unlocked) {
    const kinds = [
      "wood",
      "ore",
      "planks",
      "delivery",
      "work",
      "team",
      "driver",
      "guard",
      "mechanic",
    ];
    if (unlocked.includes("bridge")) {
      kinds[n % 3] = "supplies";
      kinds[6 + (n % 3)] = "boss";
    }
    // Rotate the board so different pairs of professions share a row each week.
    const shift = (n * 2) % 9;
    return [...kinds.slice(shift), ...kinds.slice(0, shift)].map((kind) => ({
      kind,
      progress: 0,
      target: balance.weeklyTargets[kind],
    }));
  }
  function week(unlocked, activate = false) {
    if (activate)
      db.prepare("INSERT OR IGNORE INTO frontier_campaign VALUES(1,?)").run(
        now(),
      );
    const began = start(),
      n = period(),
      old = db.prepare("SELECT * FROM frontier_weeks WHERE period=?").get(n);
    if (old) return { ...old, layout: JSON.parse(old.layout) };
    const data = {
      period: n,
      started_at: began === undefined ? null : began + n * balance.weekSeconds,
      ends_at:
        began === undefined ? null : began + (n + 1) * balance.weekSeconds,
      layout: layout(n, unlocked),
      completed_lines: 0,
    };
    if (began !== undefined)
      db.prepare(
        "INSERT INTO frontier_weeks(period,started_at,ends_at,layout) VALUES(?,?,?,?)",
      ).run(n, data.started_at, data.ends_at, JSON.stringify(data.layout));
    return data;
  }
  function settle(uid) {
    for (const row of db
      .prepare(
        "SELECT m.*,w.completed_lines FROM frontier_week_members m JOIN frontier_weeks w ON w.period=m.period WHERE m.user_id=? AND m.points>=? AND m.seals<MIN(3,w.completed_lines)",
      )
      .all(uid, balance.sealMinimumContributions)) {
      const count = Math.min(3, row.completed_lines);
      for (let i = row.seals + 1; i <= count; i++)
        grant(
          uid,
          `commons:${row.period}:${uid}:${i}`,
          0,
          balance.sealXp,
          `Commons week ${row.period + 1} · seal ${i}`,
        );
      db.prepare(
        "UPDATE frontier_week_members SET seals=? WHERE period=? AND user_id=?",
      ).run(count, row.period, uid);
    }
  }
  function record(uid, { job, mission, role, partySize = 1 }, unlocked) {
    const w = week(unlocked, true);
    for (const tile of w.layout) {
      const match =
        (job && (tile.kind === job || tile.kind === "work")) ||
        (mission &&
          (tile.kind === mission ||
            tile.kind === role ||
            (tile.kind === "team" && partySize >= 2)));
      if (match) tile.progress = Math.min(tile.target, tile.progress + 1);
    }
    const completed = lines.filter((line) =>
      line.every((i) => w.layout[i].progress >= w.layout[i].target),
    ).length;
    db.prepare(
      "UPDATE frontier_weeks SET layout=?,completed_lines=? WHERE period=?",
    ).run(JSON.stringify(w.layout), completed, w.period);
    db.prepare(
      "INSERT INTO frontier_week_members(period,user_id,points) VALUES(?,?,1) ON CONFLICT(period,user_id) DO UPDATE SET points=points+1",
    ).run(w.period, uid);
    settle(uid);
  }
  function view(uid, unlocked) {
    const w = week(unlocked);
    db.transaction(() => settle(uid))();
    const member = db
      .prepare(
        "SELECT points,seals FROM frontier_week_members WHERE period=? AND user_id=?",
      )
      .get(w.period, uid) || { points: 0, seals: 0 };
    const total = db
      .prepare(
        "SELECT COALESCE(SUM(seals),0) AS n FROM frontier_week_members WHERE user_id=?",
      )
      .get(uid).n;
    return {
      season: Math.floor(w.period / 4) + 1,
      week: (w.period % 4) + 1,
      period: w.period,
      ends_at: w.ends_at,
      started_at: w.started_at,
      weather: weather(),
      lines: w.completed_lines,
      maxSeals: 3,
      minimumContributions: balance.sealMinimumContributions,
      ...member,
      totalSeals: total,
      tiles: w.layout.map((tile) => ({ ...tile, ...definitions[tile.kind] })),
      contributors: db
        .prepare(
          "SELECT COUNT(*) AS n FROM frontier_week_members WHERE period=?",
        )
        .get(w.period).n,
    };
  }
  return { record, view, weather };
}
module.exports = { createCampaign, lines };
