"use strict";
const { randomUUID } = require("node:crypto");
const content = require("./content.json");
const { eventStatus } = require("./lifecycle");

function installNotifications(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS frontier_notifications (
      id INTEGER PRIMARY KEY,
      cycle INTEGER NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('bridge','battle_ready','victory')),
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0,
      claim TEXT,
      sent_at INTEGER,
      UNIQUE(cycle,user_id,kind)
    );
    CREATE INDEX IF NOT EXISTS frontier_notification_pending
      ON frontier_notifications(status,next_attempt_at);
    CREATE TABLE IF NOT EXISTS frontier_notification_control (
      id INTEGER PRIMARY KEY CHECK(id=1),
      paused_until INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO frontier_notification_control(id) VALUES(1);
  `);
}

// Called only by real milestone transitions, inside the gameplay transaction.
// Installation and reads intentionally never backfill old announcements.
function queueMilestone(db, kind, now) {
  if (!content.event.active) return;
  if (!["bridge", "battle_ready", "victory"].includes(kind))
    throw new Error("Unknown event notification");
  const boss = db.prepare("SELECT * FROM frontier_boss WHERE id=1").get();
  const members = db
    .prepare(
      "SELECT user_id FROM frontier_journey_members WHERE cycle=? AND actions>0",
    )
    .all(boss.cycle);
  const expiresAt =
    kind === "victory"
      ? boss.defeated_at + content.event.resultsSeconds
      : now + 86400;
  for (const member of members) {
    const coins =
      kind === "victory"
        ? db
            .prepare(
              "SELECT coins FROM frontier_rewards WHERE ref=? AND user_id=?",
            )
            .get(`dragon:${boss.cycle}:${member.user_id}`, member.user_id)
            ?.coins
        : null;
    if (kind === "victory" && coins == null) continue;
    db.prepare(
      `INSERT OR IGNORE INTO frontier_notifications
      (cycle,user_id,kind,payload,created_at,expires_at,next_attempt_at)
      VALUES(?,?,?,?,?,?,?)`,
    ).run(
      boss.cycle,
      member.user_id,
      kind,
      JSON.stringify({
        eventName: content.event.name,
        bossName: content.siege.name,
        coins,
      }),
      now,
      expiresAt,
      now,
    );
  }
}

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
function notificationText(job) {
  const payload = JSON.parse(job.payload),
    name = escapeHtml(payload.eventName);
  if (job.kind === "bridge")
    return `🌉 <b>${name}: the bridge is rebuilt!</b>\n\nThe far shore is open. Help craft and collect weapons and expedition kits for the battle.`;
  if (job.kind === "battle_ready")
    return `⚔️ <b>${name}: weapons and kits are ready!</b>\n\nThe shared battle against ${escapeHtml(payload.bossName)} is open. Join the fight — every hit counts.`;
  return `🏆 <b>${name}: ${escapeHtml(payload.bossName)} has fallen!</b>\n\nYour journey reward: <b>+${payload.coins} coins</b>. Already added to your balance.\n\nOpen Peeper to view the results.`;
}

function createNotificationWorker(
  db,
  {
    now = () => Math.floor(Date.now() / 1000),
    send,
    isEnabled,
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
) {
  let running = false;
  const claim = db.transaction(() => {
    const time = now();
    if (
      db
        .prepare(
          "SELECT paused_until FROM frontier_notification_control WHERE id=1",
        )
        .get().paused_until > time
    )
      return null;
    const job = db
      .prepare(
        `SELECT * FROM frontier_notifications
      WHERE (status='pending' AND next_attempt_at<=?)
        OR (status='sending' AND locked_until<=?)
      ORDER BY id LIMIT 1`,
      )
      .get(time, time);
    if (!job) return null;
    const token = randomUUID();
    db.prepare(
      `UPDATE frontier_notifications SET status='sending',claim=?,
      locked_until=?,attempts=attempts+1 WHERE id=?`,
    ).run(token, time + 60, job.id);
    return { ...job, claim: token, attempts: job.attempts + 1 };
  });
  function finish(job, status, nextAt = 0) {
    db.prepare(
      `UPDATE frontier_notifications SET status=?,next_attempt_at=?,
      locked_until=0,claim=NULL,sent_at=? WHERE id=? AND claim=?`,
    ).run(status, nextAt, status === "sent" ? now() : null, job.id, job.claim);
  }
  function current(job) {
    const boss = db.prepare("SELECT * FROM frontier_boss WHERE id=1").get();
    if (
      !boss ||
      boss.cycle !== job.cycle ||
      !eventStatus(boss, now()).active ||
      now() >= job.expires_at
    )
      return false;
    if (job.kind === "bridge") return boss.phase === "preparing";
    if (job.kind === "battle_ready") return boss.phase === "open";
    return boss.phase === "defeated";
  }
  async function dispatch({ limit = 200 } = {}) {
    if (running) return;
    running = true;
    try {
      for (let i = 0; i < limit; i++) {
        const job = claim();
        if (!job) break;
        const user = db
          .prepare("SELECT telegram_id FROM users WHERE id=?")
          .get(job.user_id);
        if (
          !current(job) ||
          !user?.telegram_id ||
          !isEnabled(job.user_id, "frontier_notifications")
        ) {
          finish(job, "skipped");
          continue;
        }
        let result;
        try {
          result = await send(user.telegram_id, notificationText(job));
        } catch {
          result = { ok: false };
        }
        if (result?.ok) finish(job, "sent");
        else if (result?.permanent) finish(job, "failed");
        else {
          const delay =
            result?.retryAfter ||
            Math.min(3600, 30 * 2 ** Math.min(7, job.attempts - 1));
          finish(job, "pending", now() + delay);
          if (result?.retryAfter) {
            db.prepare(
              "UPDATE frontier_notification_control SET paused_until=MAX(paused_until,?) WHERE id=1",
            ).run(now() + delay);
            break;
          }
        }
        // Keep milestone delivery below Telegram's global send rate.
        await pause(50);
      }
    } finally {
      running = false;
    }
  }
  return { dispatch };
}

module.exports = {
  installNotifications,
  queueMilestone,
  createNotificationWorker,
};
