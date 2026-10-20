"use strict";
const balance = require("./balance.json");
const definitions = {
  wood: {
    name: "Gather timber",
    hint: "Complete a timber extraction at Mosswood Mill",
    location: "sawmill",
    icon: "wood",
  },
  ore: {
    name: "Mine iron",
    hint: "Complete an iron extraction at Pebble Quarry",
    location: "quarry",
    icon: "ore",
  },
  planks: {
    name: "Make planks",
    hint: "Make a plank at Crooked Post",
    location: "village",
    icon: "planks",
  },
  delivery: {
    name: "Deliver planks",
    hint: "Complete a delivery from Crooked Post",
    location: "village",
    icon: "cart",
  },
  work: {
    name: "Complete work",
    hint: "Complete a gathering or crafting game",
    location: "sawmill",
    icon: "tools",
  },
  team: {
    name: "Deliver together",
    hint: "Complete a delivery with 2 or 3 active players",
    location: "village",
    icon: "party",
  },
  driver: {
    name: "Drive the cart",
    hint: "Clear the driving task in a successful delivery",
    location: "village",
    icon: "cart",
  },
  guard: {
    name: "Protect cargo",
    hint: "Clear the guard task in a successful delivery",
    location: "village",
    icon: "shield",
  },
  mechanic: {
    name: "Repair the cart",
    hint: "Clear the repair task in a successful delivery",
    location: "village",
    icon: "tools",
  },
};
function createCampaign(db, now, grant) {
  db.exec(`CREATE TABLE IF NOT EXISTS frontier_personal_quests(
    cycle INTEGER NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),started_at INTEGER,
    layout TEXT NOT NULL,points INTEGER NOT NULL DEFAULT 0,paid_stages INTEGER NOT NULL DEFAULT 0,
    legacy_credit INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(cycle,user_id));`);
  const hasOldBoards = !!db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='frontier_personal_boards'",
    )
    .get();
  const current = () =>
    db.prepare("SELECT cycle,phase FROM frontier_boss WHERE id=1").get();
  function board(uid) {
    const { cycle } = current();
    const saved = db
      .prepare(
        "SELECT * FROM frontier_personal_quests WHERE cycle=? AND user_id=?",
      )
      .get(cycle, uid);
    if (saved) return { ...saved, layout: JSON.parse(saved.layout) };
    const old = hasOldBoards
      ? db
          .prepare(
            "SELECT * FROM frontier_personal_boards WHERE cycle=? AND user_id=?",
          )
          .get(cycle, uid)
      : null;
    const prior = old ? JSON.parse(old.layout) : [];
    return {
      cycle,
      user_id: uid,
      started_at: old?.started_at ?? null,
      points: old?.points || 0,
      paid_stages: Math.min(3, old?.paid_lines || 0),
      legacy_credit: (old?.paid_lines || 0) * 100,
      layout: Object.keys(definitions).map((kind) => ({
        kind,
        target: balance.boardTargets[kind],
        progress: Math.min(
          balance.boardTargets[kind],
          prior.find((t) => t.kind === kind)?.progress || 0,
        ),
      })),
    };
  }
  const completedQuests = (b) =>
    b.layout.filter((t) => t.progress >= t.target).length;
  function save(b) {
    db.prepare(
      "INSERT INTO frontier_personal_quests VALUES(?,?,?,?,?,?,?) ON CONFLICT(cycle,user_id) DO UPDATE SET layout=excluded.layout,points=excluded.points,paid_stages=excluded.paid_stages",
    ).run(
      b.cycle,
      b.user_id,
      b.started_at,
      JSON.stringify(b.layout),
      b.points,
      b.paid_stages,
      b.legacy_credit,
    );
  }
  function settle(b) {
    const stages = balance.questMilestones.filter(
      (n) => completedQuests(b) >= n,
    ).length;
    for (let i = b.paid_stages + 1; i <= stages; i++)
      grant(
        b.user_id,
        `quests:${b.cycle}:${b.user_id}:${i}`,
        balance.questRewardCoins,
        0,
        `Journey ${b.cycle} · ${balance.questMilestones[i - 1]} quests complete`,
      );
    b.paid_stages = Math.max(b.paid_stages, stages);
  }
  function record(
    uid,
    { job, mission, role, roles = role ? [role] : [], partySize = 1 },
  ) {
    if (current().phase === "defeated" || (!job && mission !== "delivery"))
      return;
    const b = board(uid);
    b.started_at ??= now();
    b.points++;
    for (const tile of b.layout) {
      const match =
        (job && (tile.kind === job || tile.kind === "work")) ||
        (mission === "delivery" &&
          (tile.kind === "delivery" ||
            roles.includes(tile.kind) ||
            (tile.kind === "team" && partySize >= 2)));
      if (match) tile.progress = Math.min(tile.target, tile.progress + 1);
    }
    settle(b);
    save(b);
  }
  function view(uid) {
    const b = board(uid);
    if (b.started_at !== null)
      db.transaction(() => {
        settle(b);
        save(b);
      })();
    return {
      cycle: b.cycle,
      personal: true,
      started_at: b.started_at,
      ends_at: null,
      closed: current().phase === "defeated",
      completed: completedQuests(b),
      total: b.layout.length,
      rewardCoins: balance.questRewardCoins,
      paidStages: b.paid_stages,
      maxCoins: balance.questMilestones.length * balance.questRewardCoins,
      legacyCredit: b.legacy_credit,
      milestones: balance.questMilestones.map((at, i) => ({
        at,
        coins: balance.questRewardCoins,
        paid: i < b.paid_stages,
      })),
      points: b.points,
      tiles: b.layout.map((t) => ({ ...t, ...definitions[t.kind] })),
    };
  }
  return {
    record,
    view,
    weather: () => ({
      id: "clear",
      name: "Reedbank",
      hint: "",
      symbol: "leaf",
    }),
  };
}
module.exports = { createCampaign };
