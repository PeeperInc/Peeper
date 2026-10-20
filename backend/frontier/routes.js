"use strict";
const express = require("express");
const { validateTelegramInit } = require("../auth");
const { postGlobalMessage } = require("../globalChat");
const { FrontierError } = require("./engine");
function createRouter(engine, live) {
  const router = express.Router();
  const limits = new Map();
  router.use(validateTelegramInit, (req, res, next) => {
    const row = engine.db
      .prepare("SELECT id FROM users WHERE telegram_id=?")
      .get(String(req.telegramUser?.id || ""));
    if (!row)
      return res.status(404).json({ error: "Open Peeper again to sign in" });
    const t = Date.now();
    if (limits.size > 5000)
      for (const [id, v] of limits) if (t - v.at > 60000) limits.delete(id);
    let bucket = limits.get(row.id);
    if (!bucket || t - bucket.at >= 60000) {
      bucket = { at: t, reads: 0, writes: 0, combat: 0 };
      limits.set(row.id, bucket);
    }
    const type =
      req.method === "GET"
        ? "reads"
        : req.path === "/boss/combat/action"
          ? "combat"
          : "writes";
    if (
      ++bucket[type] > (type === "reads" ? 240 : type === "combat" ? 360 : 50)
    ) {
      res.set(
        "Retry-After",
        String(Math.ceil((60000 - (t - bucket.at)) / 1000)),
      );
      return res
        .status(429)
        .json({ error: "Too many requests. Please wait a moment." });
    }
    req.frontierUid = row.id;
    next();
  });
  const route = (fn) => (req, res) => {
    try {
      if (
        req.path !== "/event" &&
        req.path !== "/state" &&
        !engine.eventStatus().active
      )
        throw new FrontierError("The event has ended", 410);
      const result = fn(req.frontierUid, req.body || {}, req);
      if (req.method !== "GET" && req.path !== "/ticket")
        live.broadcast(req.frontierUid);
      res.json(result);
    } catch (e) {
      if (e instanceof FrontierError || e.statusCode)
        return res.status(e.status || e.statusCode).json({ error: e.message });
      console.error("[frontier]", e);
      res.status(500).json({
        error: "The marsh is unavailable. Your progress is saved; try again.",
      });
    }
  };
  router.post(
    "/travel",
    route((uid, b) => engine.travel(uid, b.to)),
  );
  router.get(
    "/event",
    route(() => engine.eventSummary()),
  );
  router.get(
    "/state",
    route((uid) => engine.state(uid)),
  );
  router.get(
    "/boss",
    route((uid) => engine.bossView(uid)),
  );
  router.get(
    "/boss/combat",
    route((uid) => engine.bossCombat(uid)),
  );
  router.post(
    "/boss/combat/action",
    route((uid, b) =>
      engine.hitBoss(uid, b.action, b.requestId, {
        direction: b.direction,
        at: b.at,
      }),
    ),
  );
  router.post(
    "/boss/prepare",
    route((uid, b) => engine.prepareBoss(uid, b.item, b.amount, b.requestId)),
  );
  router.post(
    "/boss/attacks",
    route((uid, b) => engine.startAssault(uid, b.requestId)),
  );
  router.get(
    "/boss/attacks/:id",
    route((uid, b, req) => engine.assault(uid, req.params.id)),
  );
  router.post(
    "/boss/attacks/:id/action",
    route((uid, b, req) =>
      engine.actAssault(uid, req.params.id, b.nonce, b.gesture),
    ),
  );
  router.post(
    "/boss/attacks/:id/cancel",
    route((uid, b, req) => engine.cancelAssault(uid, req.params.id)),
  );
  router.post(
    "/ticket",
    route((uid) => ({ ticket: live.issue(uid) })),
  );
  router.post(
    "/jobs",
    route((uid, b) => engine.startJob(uid, b.kind, b.requestId)),
  );
  router.get(
    "/jobs/:id",
    route((uid, b, req) => engine.resumeJob(uid, req.params.id)),
  );
  router.post(
    "/jobs/:id/action",
    route((uid, b, req) =>
      engine.actJob(uid, req.params.id, b.step, b.nonce, b.gesture),
    ),
  );
  router.post(
    "/jobs/:id/cancel",
    route((uid, b, req) => engine.cancelJob(uid, req.params.id)),
  );
  router.post(
    "/missions",
    route((uid, b) =>
      engine.createMission(uid, b.kind, b.role, b.requestId, b.load),
    ),
  );
  router.get(
    "/missions/:id",
    route((uid, b, req) => engine.mission(uid, req.params.id)),
  );
  router.post(
    "/missions/:id/join",
    route((uid, b, req) => engine.joinMission(uid, req.params.id, b.role)),
  );
  router.post(
    "/missions/:id/depart",
    route((uid, b, req) => engine.depart(uid, req.params.id)),
  );
  router.post(
    "/missions/:id/leave",
    route((uid, b, req) => engine.leave(uid, req.params.id)),
  );
  router.post(
    "/missions/:id/action",
    route((uid, b, req) =>
      engine.actMission(uid, req.params.id, b.round, b.nonce, b.gesture),
    ),
  );
  router.post(
    "/missions/:id/recruit",
    route((uid, b, req) => {
      const mission = engine.mission(uid, req.params.id);
      if (mission.status !== "lobby" || mission.owner_id !== uid)
        throw new FrontierError(
          "Only the organizer of an open party can recruit",
          403,
        );
      return engine.db.transaction(() => {
        const msg = postGlobalMessage(engine.db, {
          userId: uid,
          message:
            mission.kind === "boss"
              ? "Beyond the Fog: taking on the Leech King. Join my party!"
              : "Bridge delivery: 2 shared planks each. Two players deliver 6; three deliver 10. Join my crew!",
          nowTs: engine.now(),
        });
        engine.db
          .prepare("INSERT INTO frontier_recruitment VALUES (?,?)")
          .run(msg.id, mission.id);
        return { ok: true };
      })();
    }),
  );
  router.post(
    "/cosmetics/buy",
    route((uid, b) => engine.cosmetic(uid, b.item, false)),
  );
  router.post(
    "/cosmetics/equip",
    route((uid, b) => engine.cosmetic(uid, b.item, true)),
  );
  return router;
}
module.exports = { createRouter };
