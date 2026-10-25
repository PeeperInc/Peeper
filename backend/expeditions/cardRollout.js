'use strict';

const crypto = require('node:crypto');
const { ARTIFACTS, PROVISIONS } = require('./catalog');
const { CARD_MODE } = require('./cardCatalog');
const { createPendingRewards } = require('./rewards');

const ROLLOUT_KEY = 'expupdate_card_rollout_v1';
const parse = (text, fallback) => {
  try { return JSON.parse(text || 'null') ?? fallback; } catch { return fallback; }
};

// Run after schema installation and before the HTTP server/notifier starts.
// No engine/database imports: startup must not introduce a circular DB require.
function finishLegacyExpeditionsForCardRollout(db, {
  now = Math.floor(Date.now() / 1000),
  rng = () => crypto.randomInt(1_000_000) / 1_000_000,
} = {}) {
  if (!Number.isInteger(now) || now <= 0) throw new TypeError('A rollout timestamp in seconds is required');
  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM app_settings WHERE key=?').get(ROLLOUT_KEY)) {
      return { alreadyApplied: true, closed: 0, rewards: 0 };
    }
    const expeditions = db.prepare(`SELECT * FROM family_expeditions
      WHERE status IN ('active','boss_defeated') ORDER BY id`).all()
      .filter(expedition => parse(expedition.map_json, {}).combatMode !== CARD_MODE);
    let rewardCount = 0;
    for (const expedition of expeditions) {
      // Use actual AP, cleared rooms, provisions and equipped passives. Never
      // invent a boss victory or change existing/claimed reward payloads.
      const rewards = createPendingRewards(db, { expeditionId: expedition.id, now, completedAt: now, rng });
      rewardCount += rewards.length;
      const members = db.prepare('SELECT * FROM family_expedition_members WHERE expedition_id=?').all(expedition.id);
      for (const member of members) {
        const packed = parse(member.loadout_json, []);
        const packedSlots = Array.isArray(packed) ? packed : packed.slots || packed.loadout;
        const slots = Array.isArray(packedSlots) ? packedSlots : [];
        // An involuntary version transition returns all still-equipped relics,
        // including passives. Already consumed active relics have empty slots.
        for (const slot of slots) {
          if (!slot?.artifactId || !ARTIFACTS[slot.artifactId]) continue;
          db.prepare(`INSERT INTO expedition_artifact_inventory
            (user_id,artifact_id,quantity,charges,first_acquired_at,last_acquired_at) VALUES (?,?,1,0,?,?)
            ON CONFLICT(user_id,artifact_id) DO UPDATE SET quantity=quantity+1,last_acquired_at=excluded.last_acquired_at`)
            .run(member.user_id,slot.artifactId,now,now);
        }
        const provision = parse(member.provision_state_json, {});
        const recipe = PROVISIONS[member.provision_id]?.recipe;
        if (recipe && provision.available && !provision.used) {
          db.prepare(`INSERT INTO farm_inventory(user_id,product_id,quantity,updated_at) VALUES (?,?,?,?)
            ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=excluded.updated_at`)
            .run(member.user_id,recipe.productId,recipe.quantity,now);
        }
        db.prepare(`UPDATE family_expedition_members SET loadout_json=?, provision_state_json=?
          WHERE expedition_id=? AND user_id=?`)
          .run(JSON.stringify({ slots:[null,null,null], triggerHistory:Array.isArray(packed.triggerHistory)?packed.triggerHistory:[] }),
            JSON.stringify({ ...provision, available:false, ...(recipe && provision.available && !provision.used ? { returnedAt:now } : {}) }),
            expedition.id,member.user_id);
      }
      db.prepare(`UPDATE family_expedition_minigame_attempts SET status='superseded',finished_at=?
        WHERE expedition_id=? AND status IN ('ready','active','retry')`).run(now,expedition.id);
      db.prepare(`UPDATE family_expeditions SET status='finished',finished_at=? WHERE id=?`).run(now,expedition.id);
      const roomsCleared = db.prepare("SELECT COUNT(*) AS count FROM family_expedition_rooms WHERE expedition_id=? AND state='cleared'").get(expedition.id).count;
      const summary = { expeditionId:expedition.id, finishedBy:null, finishReason:'expupdate_rollout',
        bossDefeated:expedition.status === 'boss_defeated', roomsCleared,
        members:members.map(member=>({userId:member.user_id,progress:member.contribution_progress})) };
      db.prepare(`INSERT INTO family_expedition_history(expedition_id,family_id,summary_json,finished_at)
        SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM family_expedition_history WHERE expedition_id=?)`)
        .run(expedition.id,expedition.family_id,JSON.stringify(summary),now,expedition.id);
    }
    const result = { alreadyApplied:false, closed:expeditions.length, rewards:rewardCount, appliedAt:now };
    db.prepare('INSERT INTO app_settings(key,value) VALUES (?,?)').run(ROLLOUT_KEY,JSON.stringify(result));
    return result;
  }).immediate();
}

module.exports = { ROLLOUT_KEY, finishLegacyExpeditionsForCardRollout };
