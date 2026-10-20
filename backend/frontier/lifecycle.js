"use strict";
const { event } = require("./content.json");

// Completion is permanent. A later launch requires an explicit operator action.
function eventStatus(boss, now) {
  if (!event.active) return { active: false };
  if (boss.phase !== "defeated") return { active: true };
  const endsAt = boss.defeated_at + event.resultsSeconds;
  return now < endsAt
    ? { active: true, phase: "results", endsAt }
    : { active: false };
}

module.exports = { eventStatus };
