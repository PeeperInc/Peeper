import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const directory = mkdtempSync(
  path.join(tmpdir(), "peeper-frontier-notifications-"),
);
process.env.PEEPER_DB_PATH = path.join(directory, "test.db");
const {
  checkFrontierNotifications,
  _notificationInternals: { sendMessage },
} = require("../notifier");
const db = require("../database");
delete process.env.PEEPER_DB_PATH;
after(() => {
  db.close();
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(
    path.basename(directory).startsWith("peeper-frontier-notifications-"),
  );
  rmSync(directory, { recursive: true, force: true });
});

function mock(t, handler) {
  const fetch = globalThis.fetch,
    warn = console.warn,
    warnings = [];
  globalThis.fetch = handler;
  console.warn = (...args) => warnings.push(args.join(" "));
  t.after(() => {
    globalThis.fetch = fetch;
    console.warn = warn;
  });
  return warnings;
}
const response = (status, data) => ({
  status,
  ok: status < 400,
  json: async () => data,
});

test("Telegram acknowledgements are explicit and the existing Open Peeper button is preserved", async (t) => {
  let request;
  mock(t, async (url, options) => {
    request = { url, ...options };
    return response(200, { ok: true });
  });
  assert.deepEqual(await sendMessage("123", "Test message", "test-token"), {
    ok: true,
  });
  const body = JSON.parse(request.body);
  assert.equal(body.chat_id, "123");
  assert.equal(body.text, "Test message");
  assert.equal(
    body.reply_markup.inline_keyboard[0][0].web_app.url,
    "https://peeper.frenzyradio.online",
  );
  assert.ok(request.signal instanceof AbortSignal);
});

test("blocked bots are permanent failures and do not leak recipient identifiers or tokens to logs", async (t) => {
  const warnings = mock(t, async () =>
    response(403, {
      ok: false,
      error_code: 403,
      description: "blocked test-token 12345",
    }),
  );
  assert.deepEqual(await sendMessage("12345", "Text", "test-token"), {
    ok: false,
    permanent: true,
  });
  assert.doesNotMatch(warnings.join(" "), /test-token|12345/);
});

test("Telegram retry_after is returned to the durable queue", async (t) => {
  mock(t, async () =>
    response(429, {
      ok: false,
      error_code: 429,
      parameters: { retry_after: 123 },
    }),
  );
  assert.deepEqual(await sendMessage("123", "Text", "test-token"), {
    ok: false,
    permanent: false,
    retryAfter: 123,
  });
});

test("Telegram server failures remain retryable", async (t) => {
  mock(t, async () => response(503, { ok: false }));
  assert.deepEqual(await sendMessage("123", "Text", "test-token"), {
    ok: false,
    permanent: false,
  });
});

test("a successful HTTP response without a Telegram acknowledgement is not marked delivered", async (t) => {
  mock(t, async () => ({
    status: 200,
    ok: true,
    json: async () => {
      throw new Error("Invalid JSON");
    },
  }));
  assert.deepEqual(await sendMessage("123", "Text", "test-token"), {
    ok: false,
    permanent: false,
  });
});

test("a stalled Telegram request aborts after its deadline and remains retryable", async (t) => {
  const timers = [],
    cleared = [],
    timeout = globalThis.setTimeout,
    clear = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => cleared.push(timer);
  t.after(() => {
    globalThis.setTimeout = timeout;
    globalThis.clearTimeout = clear;
  });
  mock(
    t,
    async (url, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        ),
      ),
  );
  const pending = sendMessage("123", "Text", "test-token");
  assert.equal(timers[0].delay, 10000);
  timers[0].callback();
  assert.deepEqual(await pending, { ok: false });
  assert.deepEqual(cleared, timers);
});

test("without a bot token no Telegram request is attempted", async (t) => {
  mock(t, async () => {
    assert.fail("No real Telegram delivery in development tests");
  });
  assert.deepEqual(await sendMessage("123", "Text", ""), { ok: false });
});

test("the shared notification worker remains usable before event tables are initialized", async () => {
  await checkFrontierNotifications({
    send: async () => assert.fail("No milestones exist"),
    pause: async () => {},
  });
});

test("the notifier dispatches event messages through the real persistent preference", async () => {
  const { createEngine } = require("./engine");
  const { queueMilestone } = require("./notifications");
  const settings = require("../notificationSettings");
  const now = 1800000000;
  const engine = createEngine(db, () => now * 1000);
  const uid = Number(
    db
      .prepare(
        "INSERT INTO users(telegram_id,first_name) VALUES('889901','Contributor')",
      )
      .run().lastInsertRowid,
  );
  engine.state(uid);
  db.prepare("INSERT INTO frontier_journey_members VALUES(1,?,2,2)").run(uid);
  db.prepare(
    "UPDATE frontier_projects SET completed_at=?,progress=800 WHERE id='bridge'",
  ).run(now);
  queueMilestone(db, "bridge", now);
  settings.toggleNotificationSetting(uid, "frontier_notifications");
  const sent = [];
  const options = {
    now,
    send: async (id, text) => {
      sent.push({ id, text });
      return { ok: true };
    },
    pause: async () => {},
  };
  await checkFrontierNotifications(options);
  assert.equal(sent.length, 0);
  assert.equal(
    db.prepare("SELECT status FROM frontier_notifications").get().status,
    "skipped",
  );
  settings.toggleNotificationSetting(uid, "frontier_notifications");
  db.prepare("UPDATE frontier_boss SET phase='open'").run();
  queueMilestone(db, "battle_ready", now);
  await checkFrontierNotifications(options);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, "889901");
  assert.match(sent[0].text, /weapons and kits are ready/);
});
