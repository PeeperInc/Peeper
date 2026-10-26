'use strict';

const { ROOM_TEMPLATES } = require('./catalog');
const { CARD_MODE } = require('./cardCatalog');

// Shared family HP. One turn means one paid hand, regardless of who draws it.
// Targets for a mixed party: normal 8–10, elite 12–14, boss 20–25 across all phases.
// These are pacing targets, not minimum turns: combinations and supplies matter.
const CARD_ENEMY_HP = Object.freeze({
  bone_rat: 72, grave_slime: 74, crypt_spider: 76,
  lantern_skull: 74, hollow_archer: 76, thorn_hound: 78,
  moss_wraith: 78, root_cultist: 80, vine_mimic: 80,
  rootbound_guard: 104, ossuary_golem: 108, rootbound_champion: 112,
});
const CARD_BOSS_PHASE_HP = Object.freeze([56, 64, 72]);

function cardBossPhase(phase) {
  const template = ROOM_TEMPLATES.boss.find(candidate => candidate.phase === Number(phase));
  return template ? { ...template, progressTarget: CARD_BOSS_PHASE_HP[Number(phase) - 1] } : null;
}

// Also tune Scout Ahead's choices so the preview and the selected room agree.
// Unknown/custom encounters keep their authored HP; legacy maps use catalog.js.
function balanceCardRoom(room) {
  let progressTarget = room.progressTarget;
  if (room.type === 'boss') progressTarget = cardBossPhase(room.phase || 1)?.progressTarget ?? progressTarget;
  else if (room.type === 'combat') progressTarget = CARD_ENEMY_HP[room.enemyId] ?? progressTarget;
  return {
    ...room,
    ...(progressTarget == null ? {} : { progressTarget }),
    ...(room.actions ? { actions: room.actions.map(action => ({ ...action, progressTarget })) } : {}),
    ...(room.scoutChoices ? { scoutChoices: room.scoutChoices.map(choice => ({ ...choice,
      ...(choice.room ? { room: balanceCardRoom(choice.room) } : {}),
    })) } : {}),
  };
}

function balanceCardMap(map) {
  return map?.combatMode === CARD_MODE ? { ...map, rooms: (map.rooms || []).map(balanceCardRoom) } : map;
}

module.exports = { CARD_ENEMY_HP, CARD_BOSS_PHASE_HP, cardBossPhase, balanceCardRoom, balanceCardMap };
