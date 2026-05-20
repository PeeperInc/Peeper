const Database = require('better-sqlite3');
const path = require('path');
const {
  HOME_FRIDGE_DECOR_ITEM_ID,
  HOME_STARTER_WALL_ITEM_ID,
} = require('./homeConstants');
const DEFAULT_ASSET_VERSION = '20260330-1';

const db = new Database(path.join(__dirname, 'peeper.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id  TEXT    UNIQUE NOT NULL,
    username     TEXT,
    first_name   TEXT,
    photo_url        TEXT    DEFAULT NULL,
    photo_updated_at INTEGER DEFAULT 0,
    coins        INTEGER DEFAULT 50,
    created_at   INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS peepers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT    DEFAULT 'Peeper',
    hp              REAL    DEFAULT 100,
    hunger          REAL    DEFAULT 100,
    fun             REAL    DEFAULT 100,
    alive           INTEGER DEFAULT 1,
    born_at         INTEGER DEFAULT (strftime('%s','now')),
    last_fed        INTEGER DEFAULT (strftime('%s','now')),
    last_played     INTEGER DEFAULT (strftime('%s','now')),
    last_action_at  INTEGER DEFAULT 0,
    fridge_owned    INTEGER NOT NULL DEFAULT 0,
    fridge_food_until INTEGER DEFAULT NULL,
    fridge_purchased_at INTEGER DEFAULT NULL,
    next_dirty_at   INTEGER DEFAULT NULL,
    -- tracks when both bars hit 0 for HP drain calculation
    critical_start  INTEGER DEFAULT NULL,
    -- tracks when HP regen started and from what value
    regen_start     INTEGER DEFAULT NULL,
    hp_at_regen     REAL    DEFAULT NULL,
    slot_head       TEXT    DEFAULT NULL,
    slot_body       TEXT    DEFAULT NULL,
    slot_hands      TEXT    DEFAULT NULL,
    slot_fren       TEXT    DEFAULT NULL,
    slot_face       TEXT    DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS gifts_received (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    sender_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    gift_id      TEXT    NOT NULL,
    gift_price   INTEGER NOT NULL DEFAULT 0,
    message      TEXT    DEFAULT NULL,
    is_private   INTEGER DEFAULT 0,
    sent_at      INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS owned_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    item_id      TEXT    NOT NULL,
    purchased_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(user_id, item_id)
  );

  -- Admin-managed shop items (clothing & accessories)
  CREATE TABLE IF NOT EXISTS shop_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    TEXT    UNIQUE NOT NULL,
    name       TEXT    NOT NULL,
    slot       TEXT    NOT NULL CHECK(slot IN ('head','body','hands','fren','face')),
    price      INTEGER NOT NULL DEFAULT 100,
    is_free    INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  -- Admin-managed gift items (animated webp)
  CREATE TABLE IF NOT EXISTS gift_catalog (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    TEXT    UNIQUE NOT NULL,
    name       TEXT    NOT NULL,
    price      INTEGER NOT NULL DEFAULT 50,
    file_path  TEXT    DEFAULT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  -- Sprites uploaded via admin panel
  CREATE TABLE IF NOT EXISTS custom_sprites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     TEXT    UNIQUE NOT NULL,
    file_path   TEXT    NOT NULL,
    uploaded_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS energy_drink_usage (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_key    INTEGER NOT NULL,
    used_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, day_key)
  );

  CREATE TABLE IF NOT EXISTS support_donations (
    id                         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    telegram_payment_charge_id TEXT NOT NULL UNIQUE,
    provider_payment_charge_id TEXT DEFAULT '',
    stars_amount               INTEGER NOT NULL,
    payload                    TEXT DEFAULT '',
    created_at                 INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS personal_homes (
    user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    purchased_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    wall_base_item_id   TEXT DEFAULT NULL,
    floor_base_item_id  TEXT DEFAULT NULL,
    floor_cover_item_id TEXT DEFAULT NULL,
    foreground_item_id  TEXT DEFAULT NULL,
    updated_at          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS home_shop_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    slot       TEXT NOT NULL CHECK(slot IN (
      'wall_base',
      'floor_base',
      'floor_cover',
      'back_decor',
      'foreground_item'
    )),
    price      INTEGER NOT NULL DEFAULT 100,
    is_free    INTEGER NOT NULL DEFAULT 0,
    is_active  INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS owned_home_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id      TEXT NOT NULL,
    purchased_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(user_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS home_back_decor_enabled (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id    TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    enabled_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS home_custom_sprites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     TEXT UNIQUE NOT NULL,
    file_path   TEXT NOT NULL,
    uploaded_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- Add new columns to existing tables if upgrading
  -- (safe to run on fresh DB too — IF NOT EXISTS handles it)
  -- Notification deduplication with per-type cooldowns
  CREATE TABLE IF NOT EXISTS notifications_sent (
    user_id    INTEGER NOT NULL,
    type       TEXT    NOT NULL,
    sent_at    INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, type)
  );

  CREATE TABLE IF NOT EXISTS user_notification_settings (
    user_id                  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    care_notifications       INTEGER NOT NULL DEFAULT 1,
    family_notifications     INTEGER NOT NULL DEFAULT 1,
    gift_notifications       INTEGER NOT NULL DEFAULT 1,
    jackpot_notifications    INTEGER NOT NULL DEFAULT 1,
    farm_notifications       INTEGER NOT NULL DEFAULT 1,
    updated_at               INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_gifts_recipient ON gifts_received(recipient_id);
  CREATE INDEX IF NOT EXISTS idx_gifts_sent_at   ON gifts_received(sent_at DESC);
  CREATE INDEX IF NOT EXISTS idx_owned_user      ON owned_items(user_id);
  CREATE INDEX IF NOT EXISTS idx_support_donations_user ON support_donations(user_id);
  CREATE INDEX IF NOT EXISTS idx_owned_home_user ON owned_home_items(user_id);
  CREATE INDEX IF NOT EXISTS idx_home_back_decor_order ON home_back_decor_enabled(user_id, sort_order);
`);

// Safe column additions for existing databases (ALTER TABLE IF NOT EXISTS column doesn't exist)
const addColumnIfMissing = (table, column, definition) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
};

const getTableSql = (table) => {
  const row = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(table);
  return row?.sql || '';
};

const migrateShopItemsSlotConstraintIfNeeded = () => {
  const sql = getTableSql('shop_items');
  if (!sql || sql.includes("'fren'")) return;

  db.transaction(() => {
    db.exec(`
      ALTER TABLE shop_items RENAME TO shop_items_legacy_fren_migration;

      CREATE TABLE shop_items (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id    TEXT    UNIQUE NOT NULL,
        name       TEXT    NOT NULL,
        slot       TEXT    NOT NULL CHECK(slot IN ('head','body','hands','fren','face')),
        price      INTEGER NOT NULL DEFAULT 100,
        is_free    INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      );

      INSERT INTO shop_items (id, item_id, name, slot, price, is_free, created_at)
      SELECT id, item_id, name, slot, price, is_free, created_at
      FROM shop_items_legacy_fren_migration;

      DROP TABLE shop_items_legacy_fren_migration;
    `);
  })();
};

addColumnIfMissing('users',   'photo_url',       'TEXT DEFAULT NULL');
addColumnIfMissing('users',   'photo_updated_at', 'INTEGER DEFAULT 0');
addColumnIfMissing('users',   'supporter_since', 'INTEGER DEFAULT NULL');
addColumnIfMissing('users',   'supporter_stars', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users',   'casino_free_spins', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('user_notification_settings', 'farm_notifications', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('peepers', 'critical_start','INTEGER DEFAULT NULL');
addColumnIfMissing('peepers', 'regen_start',   'INTEGER DEFAULT NULL');
addColumnIfMissing('peepers', 'hp_at_regen',   'REAL DEFAULT NULL');
addColumnIfMissing('peepers', 'hp_saved_at',   'INTEGER DEFAULT 0');
addColumnIfMissing('peepers', 'dirty_state',   "TEXT DEFAULT 'clean'");
addColumnIfMissing('peepers', 'dirty_cycle_key', 'INTEGER DEFAULT NULL');
addColumnIfMissing('peepers', 'next_dirty_at', 'INTEGER DEFAULT NULL');
addColumnIfMissing('peepers', 'slot_fren',     'TEXT DEFAULT NULL');
addColumnIfMissing('peepers', 'fridge_owned',  'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('peepers', 'fridge_food_until', 'INTEGER DEFAULT NULL');
addColumnIfMissing('peepers', 'fridge_purchased_at', 'INTEGER DEFAULT NULL');
migrateShopItemsSlotConstraintIfNeeded();

// Migrate existing alive peepers: set hp_saved_at=now so liveStats doesn't double-count
db.prepare(`
  UPDATE peepers SET hp_saved_at = strftime('%s','now')
  WHERE alive = 1 AND (hp_saved_at IS NULL OR hp_saved_at = 0)
`).run();
db.prepare(`
  UPDATE peepers
  SET dirty_state = 'clean'
  WHERE dirty_state IS NULL
     OR dirty_state NOT IN ('clean', 'poop', 'scrubbing')
`).run();
db.prepare(`
  UPDATE peepers
  SET next_dirty_at = CAST(strftime('%s','now') AS INTEGER) + 3600 + (abs(random()) % 82801)
  WHERE alive = 1
    AND COALESCE(dirty_state, 'clean') = 'clean'
    AND (next_dirty_at IS NULL OR next_dirty_at <= 0)
`).run();
addColumnIfMissing('gifts_received', 'message',    'TEXT DEFAULT NULL');
addColumnIfMissing('gifts_received', 'is_private', 'INTEGER DEFAULT 0');
addColumnIfMissing('gifts_received', 'is_seen',    'INTEGER DEFAULT 0');
addColumnIfMissing('home_shop_items', 'is_free',   'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('home_shop_items', 'is_active', 'INTEGER NOT NULL DEFAULT 1');


// ── Family invites ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS family_invites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id   INTEGER REFERENCES families(id) ON DELETE CASCADE,
    inviter_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
    invitee_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT    DEFAULT 'pending',
    created_at  INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(family_id, invitee_id, status)
  );
  CREATE INDEX IF NOT EXISTS idx_family_invites_invitee ON family_invites(invitee_id, status);
`);

// ── Family system ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS families (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    founder_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
    invite_code TEXT    UNIQUE NOT NULL,
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS family_members (
    family_id  INTEGER REFERENCES families(id) ON DELETE CASCADE,
    user_id    INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    joined_at  INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (family_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS family_feeds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    feeder_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
    fed_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    fed_at     INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS family_big_feasts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id   INTEGER REFERENCES families(id) ON DELETE CASCADE,
    feaster_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
    cost        INTEGER NOT NULL DEFAULT 100,
    used_at     INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS family_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id  INTEGER REFERENCES families(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    message    TEXT NOT NULL,
    sent_at    INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS family_chat_reads (
    user_id               INTEGER REFERENCES users(id) ON DELETE CASCADE,
    family_id             INTEGER REFERENCES families(id) ON DELETE CASCADE,
    last_read_message_id  INTEGER,
    read_at               INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, family_id)
  );

  CREATE INDEX IF NOT EXISTS idx_family_members_user ON family_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_family_feeds_feeder ON family_feeds(feeder_id);
  CREATE INDEX IF NOT EXISTS idx_family_big_feasts_feaster ON family_big_feasts(feaster_id, used_at DESC);
  CREATE INDEX IF NOT EXISTS idx_family_messages     ON family_messages(family_id, sent_at);
  CREATE INDEX IF NOT EXISTS idx_family_chat_reads_family_user ON family_chat_reads(family_id, user_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS blackjack_lobbies (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    visibility           TEXT NOT NULL CHECK(visibility IN ('open', 'closed')),
    join_code            TEXT UNIQUE,
    status               TEXT NOT NULL DEFAULT 'betting' CHECK(status IN ('betting', 'active', 'settlement')),
    created_by           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    current_round_id     INTEGER DEFAULT NULL,
    carry_pot            INTEGER NOT NULL DEFAULT 0,
    countdown_started_at INTEGER DEFAULT NULL,
    settlement_ends_at   INTEGER DEFAULT NULL,
    created_at           INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at           INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS blackjack_lobby_members (
    lobby_id    INTEGER NOT NULL REFERENCES blackjack_lobbies(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    seat_index  INTEGER NOT NULL,
    joined_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (lobby_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS blackjack_lobby_bets (
    lobby_id     INTEGER NOT NULL REFERENCES blackjack_lobbies(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bet_amount   INTEGER NOT NULL,
    placed_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (lobby_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS blackjack_lobby_invites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lobby_id    INTEGER NOT NULL REFERENCES blackjack_lobbies(id) ON DELETE CASCADE,
    inviter_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'used', 'cancelled')),
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    used_at     INTEGER DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS blackjack_rounds (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    lobby_id          INTEGER NOT NULL REFERENCES blackjack_lobbies(id) ON DELETE CASCADE,
    mode              TEXT NOT NULL CHECK(mode IN ('dealer', 'pvp')),
    status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'settlement')),
    pot_total         INTEGER NOT NULL DEFAULT 0,
    carry_in          INTEGER NOT NULL DEFAULT 0,
    deck_json         TEXT NOT NULL,
    deck_position     INTEGER NOT NULL DEFAULT 0,
    dealer_cards_json TEXT DEFAULT NULL,
    current_turn_seat INTEGER DEFAULT NULL,
    turn_deadline_at  INTEGER DEFAULT NULL,
    started_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    finished_at       INTEGER DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS blackjack_round_players (
    round_id      INTEGER NOT NULL REFERENCES blackjack_rounds(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seat_index    INTEGER NOT NULL,
    bet_amount    INTEGER NOT NULL DEFAULT 10,
    cards_json    TEXT NOT NULL,
    stood         INTEGER NOT NULL DEFAULT 0,
    bust          INTEGER NOT NULL DEFAULT 0,
    blackjack     INTEGER NOT NULL DEFAULT 0,
    final_total   INTEGER DEFAULT NULL,
    result        TEXT DEFAULT NULL,
    PRIMARY KEY (round_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_blackjack_lobbies_status ON blackjack_lobbies(status, visibility, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_blackjack_members_lobby ON blackjack_lobby_members(lobby_id, seat_index);
  CREATE INDEX IF NOT EXISTS idx_blackjack_bets_lobby ON blackjack_lobby_bets(lobby_id, placed_at);
  CREATE INDEX IF NOT EXISTS idx_blackjack_invites_lobby ON blackjack_lobby_invites(lobby_id, invitee_id, status);
  CREATE INDEX IF NOT EXISTS idx_blackjack_invites_token ON blackjack_lobby_invites(token);
  CREATE INDEX IF NOT EXISTS idx_blackjack_rounds_lobby ON blackjack_rounds(lobby_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_blackjack_round_players_round ON blackjack_round_players(round_id, seat_index);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS arena_matches (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    status            TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting', 'countdown', 'active', 'finished', 'cancelled')),
    visibility        TEXT NOT NULL DEFAULT 'open' CHECK(visibility IN ('open', 'private')),
    join_code         TEXT UNIQUE DEFAULT NULL,
    player1_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player2_id        INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE,
    stake             INTEGER NOT NULL DEFAULT 25,
    current_round     INTEGER NOT NULL DEFAULT 0,
    player1_hp        INTEGER NOT NULL DEFAULT 100,
    player2_hp        INTEGER NOT NULL DEFAULT 100,
    winner_id         INTEGER DEFAULT NULL REFERENCES users(id),
    result            TEXT DEFAULT NULL CHECK(result IN ('p1_win', 'p2_win', 'draw', 'forfeit', NULL)),
    round_deadline    INTEGER DEFAULT NULL,
    countdown_ends_at INTEGER DEFAULT NULL,
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    finished_at       INTEGER DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS arena_rounds (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id          INTEGER NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
    round_number      INTEGER NOT NULL,
    p1_attack         TEXT DEFAULT NULL CHECK(p1_attack IN ('fire','water','earth','air', NULL)),
    p1_defense        TEXT DEFAULT NULL CHECK(p1_defense IN ('fire','water','earth','air', NULL)),
    p2_attack         TEXT DEFAULT NULL CHECK(p2_attack IN ('fire','water','earth','air', NULL)),
    p2_defense        TEXT DEFAULT NULL CHECK(p2_defense IN ('fire','water','earth','air', NULL)),
    p1_damage_dealt   INTEGER DEFAULT NULL,
    p2_damage_dealt   INTEGER DEFAULT NULL,
    p1_multiplier     REAL DEFAULT NULL,
    p2_multiplier     REAL DEFAULT NULL,
    p1_hp_after       INTEGER DEFAULT NULL,
    p2_hp_after       INTEGER DEFAULT NULL,
    resolved          INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(match_id, round_number)
  );

  CREATE TABLE IF NOT EXISTS arena_queue (
    user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    queued_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS arena_match_invites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id    INTEGER NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
    inviter_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'cancelled')),
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    used_at     INTEGER DEFAULT NULL,
    UNIQUE(match_id, invitee_id)
  );

  CREATE INDEX IF NOT EXISTS idx_arena_matches_status ON arena_matches(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_arena_matches_players ON arena_matches(player1_id, player2_id, status);
  CREATE INDEX IF NOT EXISTS idx_arena_rounds_match ON arena_rounds(match_id, round_number);
  CREATE INDEX IF NOT EXISTS idx_arena_queue_time ON arena_queue(queued_at);
  CREATE INDEX IF NOT EXISTS idx_arena_invites_match ON arena_match_invites(match_id, invitee_id, status);
  CREATE INDEX IF NOT EXISTS idx_arena_invites_token ON arena_match_invites(token);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS farms (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    purchased_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS farm_slots (
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot_index         INTEGER NOT NULL,
    slot_type          TEXT DEFAULT NULL CHECK(slot_type IN ('plot', 'pen', NULL)),
    crop_type          TEXT DEFAULT NULL,
    crop_result_product_id TEXT DEFAULT NULL,
    planted_at         INTEGER DEFAULT NULL,
    grow_seconds       INTEGER DEFAULT NULL,
    water_available_at INTEGER DEFAULT NULL,
    animal_type        TEXT DEFAULT NULL,
    animal_bought_at   INTEGER DEFAULT NULL,
    animal_ready_at    INTEGER DEFAULT NULL,
    animal_expires_at  INTEGER DEFAULT NULL,
    updated_at         INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, slot_index)
  );

  CREATE TABLE IF NOT EXISTS farm_inventory (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    quantity   INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, product_id)
  );

  CREATE INDEX IF NOT EXISTS idx_farm_slots_user ON farm_slots(user_id, slot_index);
  CREATE INDEX IF NOT EXISTS idx_farm_inventory_user ON farm_inventory(user_id, product_id);
`);

addColumnIfMissing('farm_slots', 'crop_result_product_id', 'TEXT DEFAULT NULL');

db.prepare(`
  INSERT OR IGNORE INTO home_shop_items (item_id, name, slot, price, is_free, is_active)
  VALUES (?, 'Starter Home', 'wall_base', 0, 1, 1)
`).run(HOME_STARTER_WALL_ITEM_ID);

db.prepare(`
  INSERT OR IGNORE INTO app_settings (key, value)
  VALUES ('asset_version', ?)
`).run(DEFAULT_ASSET_VERSION);

db.prepare(`
  INSERT OR IGNORE INTO app_settings (key, value)
  VALUES ('casino_jackpot_pool', '0')
`).run();

db.prepare(`
  UPDATE home_shop_items
  SET is_active = 0
  WHERE item_id = ?
`).run(HOME_STARTER_WALL_ITEM_ID);

addColumnIfMissing('blackjack_lobby_members', 'last_seen_at', 'INTEGER NOT NULL DEFAULT 0');
db.prepare(`
  UPDATE blackjack_lobby_members
  SET last_seen_at = COALESCE(NULLIF(last_seen_at, 0), joined_at, strftime('%s','now'))
  WHERE last_seen_at IS NULL OR last_seen_at = 0
`).run();

db.prepare(`
  UPDATE personal_homes
  SET wall_base_item_id = NULL,
      updated_at = strftime('%s','now')
  WHERE wall_base_item_id = ?
`).run(HOME_STARTER_WALL_ITEM_ID);

db.prepare(`
  DELETE FROM owned_home_items
  WHERE item_id = ?
`).run(HOME_STARTER_WALL_ITEM_ID);

db.prepare(`
  INSERT OR IGNORE INTO owned_home_items (user_id, item_id)
  SELECT p.user_id, h.item_id
  FROM peepers p
  JOIN home_shop_items h ON h.item_id = ?
  WHERE p.fridge_owned = 1
`).run(HOME_FRIDGE_DECOR_ITEM_ID);

addColumnIfMissing('shop_items', 'is_free', 'INTEGER NOT NULL DEFAULT 0');
db.prepare(`
  INSERT OR IGNORE INTO home_custom_sprites (item_id, file_path)
  VALUES (?, '/sprites/basewall.png')
`).run(HOME_STARTER_WALL_ITEM_ID);

db.prepare(`
  UPDATE home_custom_sprites
  SET file_path = '/sprites/basewall.png'
  WHERE item_id = ?
`).run(HOME_STARTER_WALL_ITEM_ID);

module.exports = db;
