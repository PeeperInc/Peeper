"use strict";
const { createEngine } = require("./engine");
const { createRealtime } = require("./realtime");
const { createRouter } = require("./routes");
function createFrontier(db) {
  const engine = createEngine(db);
  const live = createRealtime(engine);
  return { engine, live, router: createRouter(engine, live) };
}
module.exports = { createFrontier };
