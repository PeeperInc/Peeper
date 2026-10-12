import { gesture } from "./gesture-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const express = require("express");
const { WebSocket } = require("ws");
const { createEngine } = require("./engine");
const { createRouter } = require("./routes");
const { createRealtime } = require("./realtime");

test(
  "authenticated HTTP and WebSocket lifecycle, concurrent roles, moderation and rate limits",
  { timeout: 15000 },
  async () => {
    const previous = {
      token: process.env.BOT_TOKEN,
      mode: process.env.NODE_ENV,
    };
    const token = "frontier-integration-token";
    process.env.BOT_TOKEN = token;
    process.env.NODE_ENV = "test";
    const db = new Database(":memory:");
    db.pragma("foreign_keys=ON");
    db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY,telegram_id TEXT UNIQUE,first_name TEXT,coins INTEGER);
    CREATE TABLE peepers(user_id INTEGER,slot_head TEXT,slot_body TEXT,slot_face TEXT,slot_hands TEXT,slot_fren TEXT,alive INTEGER);
    CREATE TABLE global_messages(id INTEGER PRIMARY KEY,user_id INTEGER,message TEXT,message_type TEXT,reply_to_id INTEGER,family_id INTEGER,sent_at INTEGER);
    CREATE TABLE global_chat_mutes(user_id INTEGER PRIMARY KEY,muted_by INTEGER,muted_until INTEGER,created_at INTEGER);
    INSERT INTO users VALUES(1,'111','Mira',100),(2,'222','Boggy',100),(3,'333','Fern',100),(4,'444','Reed',100);
  `);
    let time = Date.now();
    const engine = createEngine(db, () => time);
    db.prepare("UPDATE frontier_stock SET quantity=100").run();
    const live = createRealtime(engine);
    const app = express();
    app.use(express.json({ limit: "8kb" }));
    app.use("/api/frontier", createRouter(engine, live));
    const server = app.listen(0, "127.0.0.1");
    live.attach(server);
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}/api/frontier`;
    const sockets = [];
    function signed(id) {
      const params = new URLSearchParams({
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: id * 111 }),
      });
      const text = [...params]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      const secret = createHmac("sha256", "WebAppData").update(token).digest();
      params.set(
        "hash",
        createHmac("sha256", secret).update(text).digest("hex"),
      );
      return params.toString();
    }
    async function request(path, uid = 1, body) {
      const response = await fetch(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(uid ? { "x-telegram-init-data": signed(uid) } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      });
      return {
        status: response.status,
        data: await response.json(),
        retry: response.headers.get("retry-after"),
      };
    }
    async function socket(ticket) {
      const ws = new WebSocket(origin.replace("http", "ws") + "/live");
      sockets.push(ws);
      await once(ws, "open");
      ws.send(JSON.stringify({ type: "auth", ticket }));
      return ws;
    }
    function packet(ws, predicate) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off("message", receive);
          reject(new Error("WebSocket packet timeout"));
        }, 4000);
        function receive(raw) {
          const value = JSON.parse(raw.toString());
          if (predicate(value)) {
            clearTimeout(timer);
            ws.off("message", receive);
            resolve(value);
          }
        }
        ws.on("message", receive);
      });
    }
    try {
      assert.equal((await request("/state", 0)).status, 401);
      const forged = await fetch(origin + "/state", {
        headers: {
          "x-telegram-init-data":
            "user=%7B%22id%22%3A111%7D&hash=0000000000000000000000000000000000000000000000000000000000000000",
        },
      });
      assert.equal(forged.status, 401);
      assert.equal((await request("/state", 9)).status, 404);
      for (const id of [1, 2, 3, 4])
        assert.equal((await request("/state", id)).status, 200);
      assert.equal((await request("/travel", 1, { to: "pool" })).status, 409);
      const walk = await request("/travel", 1, { to: "sawmill" });
      assert.equal(walk.status, 200);
      time = walk.data.arrives_at * 1000;
      const job = (
        await request("/jobs", 1, { kind: "wood", requestId: randomUUID() })
      ).data;
      assert.equal((await request(`/jobs/${job.id}`, 2)).status, 404);
      assert.equal(
        (
          await request(`/jobs/${job.id}/action`, 1, {
            step: 0,
            nonce: job.challenge.nonce,
            answer: job.challenge.target,
          })
        ).status,
        429,
      );
      time += 3000;
      const performed = await request(`/jobs/${job.id}/action`, 1, {
        step: 0,
        nonce: job.challenge.nonce,
        gesture: gesture(job.challenge),
      });
      assert.equal(performed.status, 200);
      assert.equal(performed.data.successes, 1);
      const collected = await request(`/jobs/${job.id}/cancel`, 1, {});
      assert.equal(collected.data.result.quantity, 1);
      assert.equal((await request("/state", 1)).data.stock.wood, 101);
      const back = await request("/travel", 1, { to: "village" });
      time = back.data.arrives_at * 1000;
      const lobby = (
        await request("/missions", 1, {
          kind: "delivery",
          role: "driver",
          requestId: randomUUID(),
        })
      ).data;
      const joined = await Promise.all(
        [2, 3].map((uid) =>
          request(`/missions/${lobby.id}/join`, uid, { role: "guard" }),
        ),
      );
      assert.deepEqual(joined.map((x) => x.status).sort(), [200, 409]);
      assert.equal(
        db
          .prepare("SELECT COUNT(*) n FROM frontier_members WHERE mission_id=?")
          .get(lobby.id).n,
        2,
      );
      assert.equal(
        (await request(`/missions/${lobby.id}/depart`, 2, {})).status,
        403,
      );
      db.prepare("INSERT INTO global_chat_mutes VALUES(1,2,NULL,?)").run(
        engine.now(),
      );
      assert.equal(
        (await request(`/missions/${lobby.id}/recruit`, 1, {})).status,
        403,
      );
      db.prepare("DELETE FROM global_chat_mutes").run();
      assert.equal(
        (await request(`/missions/${lobby.id}/recruit`, 1, {})).status,
        200,
      );
      assert.equal(
        (await request(`/missions/${lobby.id}/recruit`, 1, {})).status,
        429,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM frontier_recruitment").get().n,
        1,
      );
      const ticket = (await request("/ticket", 1, {})).data.ticket;
      const ws = await socket(ticket);
      const ready = await packet(ws, (p) => p.type === "ready");
      assert.equal(ready.players[0].name, "Mira");
      assert.equal(ready.players[0].telegram_id, undefined);
      const replay = await socket(ticket);
      const [code] = await once(replay, "close");
      assert.equal(code, 1008);
      const nextTicket = (await request("/ticket", 2, {})).data.ticket;
      const other = await socket(nextTicket);
      await packet(other, (p) => p.type === "ready");
      const arrival = packet(ws, (p) =>
        p.players?.some((x) => x.id === 2 && x.location === "village"),
      );
      other.send(JSON.stringify({ type: "presence", location: "quarry" }));
      const authoritative = await arrival;
      assert.equal(
        authoritative.players.find((p) => p.id === 2).location,
        "village",
      );
      const outfit = packet(ws, (p) =>
        p.players?.some((x) => x.id === 1 && x.equipped === "blue-pennant"),
      );
      assert.equal(
        (await request("/cosmetics/buy", 1, { item: "blue-pennant" })).status,
        200,
      );
      await outfit;
      await request(`/missions/${lobby.id}/depart`, 1, {});
      time += 181000;
      assert.equal(
        (await request(`/missions/${lobby.id}`, 1)).data.result.passed,
        false,
      );
      assert.equal((await request("/state", 1)).data.stock.planks, 100);
      // Real authenticated HTTP requests race for the last HP; no client can pick its own damage.
      db.prepare(
        "UPDATE frontier_projects SET completed_at=1 WHERE id='bridge'",
      ).run();
      db.prepare(
        "UPDATE frontier_stock SET quantity=900 WHERE item IN ('supplies','weapons')",
      ).run();
      assert.equal(
        (await request("/boss/attacks", 1, { requestId: randomUUID() })).status,
        409,
      );
      for (const item of ["supplies", "weapons"])
        assert.equal(
          (
            await request("/boss/prepare", 1, {
              item,
              amount: 900,
              requestId: randomUUID(),
            })
          ).status,
          200,
        );
      db.prepare(
        "UPDATE frontier_players SET location='pool',travel=NULL",
      ).run();
      db.prepare(
        "UPDATE frontier_boss SET hp=15,max_hp=15,reward_pool=101",
      ).run();
      const attacks = await Promise.all(
        [1, 2].map((uid) =>
          request("/boss/attacks", uid, { requestId: randomUUID() }),
        ),
      );
      assert.ok(attacks.every((r) => r.status === 200));
      time += 11000;
      const payload = (a) => ({
        nonce: a.challenge.nonce,
        gesture: gesture(a.challenge),
        damage: 999999,
      });
      assert.equal(
        (
          await request(
            `/boss/attacks/${attacks[0].data.id}/action`,
            3,
            payload(attacks[0].data),
          )
        ).status,
        404,
      );
      const hits = await Promise.all(
        attacks.map((r, i) =>
          request(`/boss/attacks/${r.data.id}/action`, i + 1, payload(r.data)),
        ),
      );
      assert.ok(hits.every((r) => r.status === 200));
      assert.equal(
        hits.reduce((sum, r) => sum + r.data.result.damage, 0),
        15,
      );
      assert.equal(
        db
          .prepare(
            "SELECT SUM(coins) n FROM frontier_rewards WHERE ref LIKE 'dragon:%'",
          )
          .get().n,
        101,
      );
      const replayHit = await request(
        `/boss/attacks/${attacks[0].data.id}/action`,
        1,
        payload(attacks[0].data),
      );
      assert.equal(replayHit.status, 200);
      assert.equal(
        db
          .prepare(
            "SELECT SUM(coins) n FROM frontier_rewards WHERE ref LIKE 'dragon:%'",
          )
          .get().n,
        101,
      );
      assert.equal((await request("/boss", 1)).data.phase, "defeated");
      const burst = await Promise.all(
        Array.from({ length: 55 }, () => request("/ticket", 4, {})),
      );
      assert.ok(burst.some((r) => r.status === 429 && Number(r.retry) > 0));
      assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    } finally {
      for (const ws of sockets) ws.terminate();
      await new Promise((resolve) => server.close(resolve));
      db.close();
      if (previous.token === undefined) delete process.env.BOT_TOKEN;
      else process.env.BOT_TOKEN = previous.token;
      if (previous.mode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.mode;
    }
  },
);
