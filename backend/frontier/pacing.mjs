// Planning assumptions, not live telemetry. Run: node backend/frontier/pacing.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  content = require("./content.json"),
  balance = require("./balance.json");
export function estimate(s) {
  const players = balance.audience.dailyPlayers * s.participation,
    minutes = players * s.minutes * s.success * s.focus,
    batch = s.batchMinutes ?? 0.75,
    journey = (content.mission.rounds * content.mission.roundSeconds) / 60,
    cargo = s.cargo ?? 2;
  const craft = cargo / content.jobs.planks.quantity,
    timber =
      (craft * content.jobs.planks.inputs.wood) / content.jobs.wood.quantity;
  const bridgeMinutes =
    (content.projects[0].target / cargo) *
    ((timber + craft) * batch + s.party * journey);
  const prepMinutes = ["supplies", "weapons"].reduce((sum, item) => {
    const j = content.jobs[item];
    return (
      sum +
      (content.siege[item + "Required"] / j.quantity) *
        (1 +
          j.inputs.wood / content.jobs.wood.quantity +
          j.inputs.ore / content.jobs.ore.quantity) *
        batch
    );
  }, 0);
  const attackSeconds = s.attackSeconds ?? 15,
    averageDamage = content.siege.maxDamage * (s.damageQuality ?? 0.75),
    bossMinutes = ((content.siege.maxHp / averageDamage) * attackSeconds) / 60;
  return {
    scenario: s.name,
    participants: players,
    productivePlayerMinutesPerDay: Math.round(minutes),
    assumedBatchSeconds: batch * 60,
    assumedAttackSeconds: attackSeconds,
    averageDamage,
    bridgeDay: +(bridgeMinutes / minutes).toFixed(1),
    battleOpensDay: +((bridgeMinutes + prepMinutes) / minutes).toFixed(1),
    firstBossDay: +(
      (bridgeMinutes + prepMinutes + bossMinutes) /
      minutes
    ).toFixed(1),
    resultsWindowHours: content.event.resultsSeconds / 3600,
    automaticRestart: false,
    victoryCoinsPerActivity: content.siege.rewards.activityCoins,
    battleCoinsPerDamageStep: content.siege.rewards.damageCoins,
    battleDamageStep: content.siege.rewards.damageStep,
  };
}
const scenarios = [
  {
    name: "Quiet",
    participation: 0.2,
    minutes: 6,
    success: 0.65,
    focus: 0.65,
    party: 1.5,
  },
  {
    name: "Expected",
    participation: balance.audience.participation,
    minutes: balance.audience.minutesPerParticipant,
    success: balance.audience.successfulOrderRate,
    focus: 0.75,
    party: balance.audience.averagePartySize,
  },
  {
    name: "Busy",
    participation: 0.7,
    minutes: 18,
    success: 0.9,
    focus: 0.85,
    party: 3,
  },
];
console.log(
  JSON.stringify(
    {
      assumptions: {
        dailyPlayers: 200,
        bridgePlanks: content.projects[0].target,
        kits: content.siege.suppliesRequired,
        weapons: content.siege.weaponsRequired,
        dragonHp: content.siege.maxHp,
        notes: [
          "Perfectly allocated shared production; travel, retries and chat represented by success/focus assumptions.",
          "15 seconds per attempt includes 9.5 seconds of combat and navigation between attempts.",
          "More participation means an earlier kill. Results remain for 24 hours; future events are launched manually.",
          "Kit and weapon preparation is consumed once per cycle. Attacks consume no materials or energy.",
          "Gathering pays 1 coin immediately per extraction; crafting/delivery coins use a 180-second cooldown. Personal victory rewards pay 3 per successful game and 3 per 40 damage, with no shared pool.",
        ],
      },
      scenarios: scenarios.map(estimate),
    },
    null,
    2,
  ),
);
