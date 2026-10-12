"use strict";
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");
function createRealtime(engine) {
  const tickets = new Map(),
    clients = new Map();
  let server, interval, pendingBroadcast;
  const send = (ws, data) => {
    if (ws.readyState === 1) {
      if (ws.bufferedAmount > 65536) ws.close(1013, "Connection too slow");
      else ws.send(typeof data === "string" ? data : JSON.stringify(data));
    }
  };
  const presence = () => [
    ...new Map(
      [...clients.values()]
        .filter((p) => p.public)
        .map((p) => {
          const row = engine.db
            .prepare(
              "SELECT location,travel FROM frontier_players WHERE user_id=?",
            )
            .get(p.uid);
          const travel = row?.travel ? JSON.parse(row.travel) : null;
          return [
            p.uid,
            {
              ...p.public,
              location:
                travel && travel.arrives_at <= engine.now()
                  ? travel.to
                  : row?.location || "village",
              travel:
                travel && travel.arrives_at > engine.now() ? travel : null,
            },
          ];
        }),
    ).values(),
  ];
  function broadcast(uid) {
    if (uid) {
      const outfit = engine.db
        .prepare("SELECT equipped FROM frontier_players WHERE user_id=?")
        .get(uid);
      for (const p of clients.values())
        if (p.uid === uid && p.public)
          p.public.equipped = outfit?.equipped || null;
    }
    if (pendingBroadcast || !clients.size) return;
    // Coalesce simultaneous party actions and encode the world snapshot once.
    pendingBroadcast = setTimeout(flushBroadcast, 250);
    pendingBroadcast.unref();
  }
  function flushBroadcast() {
    pendingBroadcast = null;
    const packet = JSON.stringify({
      type: "changed",
      serverTime: engine.now(),
      players: presence(),
    });
    for (const [ws, p] of clients) if (p.public) send(ws, packet);
  }
  function issue(uid) {
    const t = Date.now();
    for (const [key, v] of tickets)
      if (v.expires < t || v.uid === uid) tickets.delete(key);
    if (tickets.size >= 2000)
      throw new Error("Live updates are busy; try again shortly");
    const ticket = crypto.randomBytes(32).toString("hex");
    tickets.set(ticket, { uid, expires: t + 30000 });
    return ticket;
  }
  function attach(httpServer) {
    server = new WebSocketServer({
      noServer: true,
      maxPayload: 2048,
      perMessageDeflate: false,
    });
    httpServer.on("upgrade", (req, socket, head) => {
      if (req.url !== "/api/frontier/live") {
        socket.destroy();
        return;
      }
      if (clients.size >= 500) {
        socket.destroy();
        return;
      }
      server.handleUpgrade(req, socket, head, (ws) =>
        server.emit("connection", ws, req),
      );
    });
    server.on("connection", (ws) => {
      const p = { uid: null, last: 0, alive: true, public: null };
      clients.set(ws, p);
      const deadline = setTimeout(() => {
        if (!p.uid) ws.close(1008, "Authentication required");
      }, 5000);
      deadline.unref();
      ws.on("pong", () => {
        p.alive = true;
      });
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (!p.uid) {
            const ticket = tickets.get(msg.ticket);
            tickets.delete(msg.ticket);
            if (msg.type !== "auth" || !ticket || ticket.expires < Date.now()) {
              ws.close(1008, "Ticket expired");
              return;
            }
            p.uid = ticket.uid;
            clearTimeout(deadline);
            if (
              [...clients.values()].filter((x) => x.uid === p.uid).length > 3
            ) {
              ws.close(1008, "Too many open maps");
              return;
            }
            const row = engine.db
              .prepare(
                "SELECT u.id,u.first_name AS name,p.slot_head,p.slot_body,p.slot_hands,p.slot_face,p.slot_fren,p.alive,fp.equipped FROM users u LEFT JOIN peepers p ON p.user_id=u.id LEFT JOIN frontier_players fp ON fp.user_id=u.id WHERE u.id=?",
              )
              .get(p.uid);
            if (!row) {
              ws.close(1008, "Account unavailable");
              return;
            }
            p.public = { ...row, location: "village" };
            send(ws, { type: "ready", players: presence() });
            broadcast();
          } else if (msg.type === "presence" && Date.now() - p.last >= 1000) {
            if (!engine.content.locations.some((x) => x.id === msg.location))
              return;
            p.last = Date.now();
            // Position is persisted by the authenticated travel command, never by this message.
            broadcast();
          }
        } catch {
          ws.close(1008, "Invalid live message");
        }
      });
      ws.on("error", () => {});
      ws.on("close", () => {
        clearTimeout(deadline);
        clients.delete(ws);
        broadcast();
      });
    });
    let beats = 0;
    interval = setInterval(() => {
      try {
        engine.tick();
      } catch (e) {
        console.error("[frontier] world tick:", e.message);
      }
      if (++beats % 10 === 0) {
        for (const [ws, p] of clients) {
          if (!p.alive) {
            ws.terminate();
            continue;
          }
          p.alive = false;
          ws.ping();
        }
      }
      const t = Date.now();
      for (const [key, v] of tickets) if (v.expires < t) tickets.delete(key);
      if (clients.size) broadcast();
    }, 2500);
    interval.unref();
    httpServer.once("close", () => {
      clearInterval(interval);
      clearTimeout(pendingBroadcast);
      for (const ws of clients.keys()) ws.terminate();
      server.close();
      tickets.clear();
    });
  }
  return { issue, attach, broadcast };
}
module.exports = { createRealtime };
