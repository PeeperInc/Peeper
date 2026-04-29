const { liveStats } = require('./gameLogic');

function serializeFamilyMemberStats(member, nowTs) {
  const hasPeeper = Boolean(member?.last_fed);
  const live = hasPeeper ? liveStats(member, nowTs) : { hunger: 0, hp: 0, alive: false };

  return {
    ...member,
    liveHunger: live.hunger,
    liveHp: live.hp,
    liveAlive: live.alive,
  };
}

module.exports = {
  serializeFamilyMemberStats,
};
