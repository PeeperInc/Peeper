function ensureSausageQuestSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sausage_quest_daily (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      day_key INTEGER NOT NULL,
      completed_levels INTEGER NOT NULL DEFAULT 0 CHECK (completed_levels BETWEEN 0 AND 5),
      earned_coins INTEGER NOT NULL DEFAULT 0 CHECK (earned_coins BETWEEN 0 AND 50)
    );
    CREATE TABLE IF NOT EXISTS sausage_quest_attempts (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      level_json TEXT NOT NULL,
      total_sausages INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      collected INTEGER,
      reward INTEGER,
      UNIQUE (user_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS sausage_quest_attempts_started_at
      ON sausage_quest_attempts(started_at);
  `);
}

module.exports = { ensureSausageQuestSchema };
