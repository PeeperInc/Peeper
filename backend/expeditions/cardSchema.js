'use strict';

function installCardCombat(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS family_expedition_card_states (
    expedition_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (expedition_id, user_id),
    FOREIGN KEY (expedition_id, user_id)
      REFERENCES family_expedition_members(expedition_id, user_id) ON DELETE CASCADE
  )`);
}

module.exports = { installCardCombat };
