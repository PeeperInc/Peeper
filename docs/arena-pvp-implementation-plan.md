# PvP Arena — Full Implementation Plan

Status: planning
Last updated: 2026-05-03

## 1. Goal

Add a new PvP mini-game where two players' Peepers fight each other in a turn-based elemental combat system.

Design goals:

- fast, readable PvP fights (3-5 rounds typical)
- strategic depth through element rock-paper-scissors
- visual spectacle with armor sprites, projectile animations, and hit effects
- server-authoritative — client never decides damage or outcomes
- cozy competitive — stakes are meaningful but not devastating

## 2. Core Rules

### 2.1 Stake

- each player pays `25` coins to enter a fight
- winner takes `50` coins
- if both die simultaneously — stakes are returned to both players

### 2.2 Energy

- fights do **not** cost energy
- only the coin stake is required
- dirty / dead Peepers cannot fight

### 2.3 Elements

Four elements in a cycle:

```
Fire > Air > Earth > Water > Fire
```

Mnemonic:

- Fire burns Air
- Air erodes Earth
- Earth absorbs Water
- Water extinguishes Fire

### 2.4 Combat Stats

| Parameter | Value |
|-----------|-------|
| HP per fighter | 100 |
| Base damage | 20 |
| Weak hit (armor resists attack) | x0.5 = 10 |
| Neutral hit (no interaction) | x1 = 20 |
| Strong hit (attack beats armor) | x2 = 40 |

### 2.5 Damage Matrix

Attack vs Defense:

| Attack \ Defense | Fire Armor | Air Armor | Earth Armor | Water Armor |
|------------------|-----------|-----------|-------------|-------------|
| Fire Attack | x1 (20) | **x2 (40)** | x1 (20) | *x0.5 (10)* |
| Air Attack | *x0.5 (10)* | x1 (20) | **x2 (40)** | x1 (20) |
| Earth Attack | x1 (20) | *x0.5 (10)* | x1 (20) | **x2 (40)** |
| Water Attack | **x2 (40)** | x1 (20) | *x0.5 (10)* | x1 (20) |

Rule: if attack element beats defense element in the cycle, x2. If defense beats attack, x0.5. Otherwise x1.

### 2.6 Round Flow

Each round:

1. **Choice phase** (10 seconds) — both players simultaneously choose:
   - one element for **defense** (armor)
   - one element for **attack** (projectile)
2. If a player does not choose in time — server picks random elements for them
3. **Combat phase** — animations play sequentially:
   - Player 1 attacks Player 2 (attack animation + projectile + hit effect)
   - Player 2 attacks Player 1 (attack animation + projectile + hit effect)
4. Damage is applied simultaneously (both attacks resolve before checking death)
5. HP bars update
6. If one or both fighters reach 0 HP — fight ends
7. Otherwise — next round begins

### 2.7 Round Limit

No round limit. Fight continues until at least one Peeper reaches 0 HP.

With 100 HP and minimum damage of 10, the theoretical maximum is 10 rounds. Typical fights last 3-5 rounds.

### 2.8 Win Conditions

- One player reaches 0 HP — the other wins
- Both reach 0 HP simultaneously — draw, stakes returned
- A player explicitly taps "Forfeit" / "Surrender" — opponent wins
- A player disconnects, closes the app, or stops responding — **not a forfeit**; server keeps resolving their turns with random choices when the round timer expires

## 3. Matchmaking

Two modes:

### 3.1 Quick Queue

- player taps "Find Fight"
- enters a server-side queue
- when two players are in the queue — match starts automatically
- queue has a timeout (60 seconds) — if no opponent found, player is removed; no coins are deducted while waiting
- while in queue, player sees a searching animation with cancel button

### 3.2 Private Room

- player creates a private fight room
- gets a 6-character alphanumeric code
- shares code with friend
- friend enters code to join
- once both players are in — fight starts after a 3-second countdown
- room expires after 120 seconds if no one joins
- creator can also invite a player by search (sends Telegram DM with deep link)
- invite implementation reuses the Blackjack private-table invite pattern:
  - token is scoped to one invitee and one private room
  - invited player can join without entering the room code
  - wrong user cannot use someone else's invite token
  - if the invited user is already in another arena match/queue, join is rejected

## 4. Element Cycle Visualization

```
        Fire
       /    \
      /  x2  \
   Water ---- Air
      \  x2  /
       \    /
       Earth
```

Each element beats the next clockwise:
Fire -> Air -> Earth -> Water -> Fire

## 5. Asset Specifications

### 5.1 Arena Background

One full-scene PNG file containing both the background and the floor.

| Parameter | Value |
|-----------|-------|
| Canvas size | 600 x 360 px |
| Aspect ratio | 5:3 (landscape) |
| Background zone (top) | 70% of height = top 252px |
| Floor zone (bottom) | 30% of height = bottom 108px |
| Floor line | y = 252 |
| File name | arena_bg_default.png |
| Storage path | html/sprites/ |

Proportions inside the canvas:

| Zone | Share | Pixels (from top) | Purpose |
|------|-------|--------------------|---------|
| Background (top) | 70% | y: 0-252 | Sky, arena walls, decorations |
| Floor (bottom) | 30% | y: 252-360 | Surface where Peepers stand |
| Floor line | — | y = 252 | Visual boundary between background and floor |

Future arenas:

- arena_bg_default.png is the starter arena
- future arenas: arena_bg_volcano.png, arena_bg_forest.png, etc.
- all arenas must be exactly 600 x 360 with floor in the bottom 30%
- Peepers always stand at the same coordinates regardless of background

### 5.2 Armor Sprites

4 separate PNG files, one per element. Rendered as an overlay on the Peeper between the body and hands layers.

Sprite dimensions: 500x500 (same as clothing sprites).

File names:

- arena_armor_fire.png
- arena_armor_water.png
- arena_armor_earth.png
- arena_armor_air.png

Storage path: html/sprites/

Render order in fight scene:

1. body
2. **arena armor** (new layer)
3. face
4. head
5. hands
6. fren

### 5.3 Projectile Sprites

4 separate PNG or GIF files. Used for the flying projectile animation.

File names:

- arena_projectile_fire.png
- arena_projectile_water.png
- arena_projectile_earth.png
- arena_projectile_air.png

Recommended size: 120x120 or smaller.

Storage path: html/sprites/

Fallback: if sprite file is not found, render emoji instead:

- Fire: U+1F525
- Water: U+1F4A7
- Earth: U+1F30D
- Air: U+1F4A8

### 5.4 Hit Effect Sprites (optional, phase 2)

- arena_hit_x2.png or arena_hit_x2.gif — super effective hit flash
- arena_hit_x05.png — weak hit / shield block
- arena_hit_x1.png — neutral hit

Fallback: CSS-only flash effects (screen shake, color overlay).

## 6. Fight Scene Layout

Two Peepers facing each other on a battle stage.

```
+----------------------------------+
|  [P1 HP bar]     [P2 HP bar]    |
|  [P1 name]       [P2 name]      |
|                                  |
|          BACKGROUND (70%)        |
|                                  |
|----------------------------------| <- floor line y=252
|   +-----+          +-----+      |
|   | P1  |  <- ->   | P2  |      |
|   |160px| projectile|(mirror)    |
|   +-----+          +-----+      |
|           FLOOR (30%)            |
+----------------------------------+

[Round N]        [Timer: 10s]

+-- Defense -----+ +-- Attack -----+
| fire water     | | fire water    |
| earth air      | | earth air     |
+----------------+ +---------------+
          [ Ready ]
```

Peeper positions inside the 600x360 canvas:

| | Player 1 (self, left) | Player 2 (opponent, right) |
|---|---|---|
| Render width | 160px | 160px |
| Center X | 155 | 445 |
| Base Y (feet on floor line) | 252 | 252 |
| Direction | Faces right | Faces left (CSS scaleX(-1)) |

Projectile flight zone: x 235-365 (~130px gap between Peepers).

### 6.1 UI Scaling

The entire fight screen — arena scene, HP bars, names, timer, element selection panel, and buttons — is rendered as a single scalable layout block.

Scaling approach:

- the layout is authored at a fixed base width (e.g. 480px)
- at runtime, the available viewport width and height are measured
- a uniform scale() CSS transform is applied to the whole layout so it fits the screen
- transform-origin: top center
- this is the same pattern used in BlackjackGame.jsx via useScaledLayout()

Result:

- on a wide phone, the layout renders at or near 1:1
- on a narrow phone, the entire UI shrinks proportionally — like dragging a corner handle in Photoshop
- no element is ever clipped or pushed off-screen
- aspect ratios of all elements are preserved
- the arena scene, HP bars, element buttons, and timer all scale together as one unit

Recommended base dimensions:

```js
const ARENA_LAYOUT_BASE_WIDTH = 480;
const ARENA_LAYOUT_MAX_WIDTH = 600;
```

The useScaledLayout() hook from BlackjackGame.jsx can be reused directly.

## 7. Animation Sequences

### 7.1 Attack Animation

When a Peeper attacks:

1. **Wind-up** (0.3s): Peeper leans back slightly (translateX(-8px) for left, +8px for right)
2. **Strike** (0.2s): Peeper lunges forward (translateX(+16px) / -16px) with a slight scale-up (scale(1.05))
3. **Projectile launch** (0.6s): projectile sprite flies from attacker to defender along a slight arc (CSS @keyframes with translateX + slight translateY parabola)
4. **Return** (0.2s): Peeper returns to neutral position

### 7.2 Hit Animations

Depend on damage multiplier:

**x0.5 (armor resists):**
- Small shield flash on the defender (brief white/blue overlay, 0.2s)
- Defender barely moves (tiny translateX(2px) shake)
- Muted damage number floats up: dim color, smaller font
- Armor sprite briefly glows

**x1 (neutral):**
- Standard hit flash (brief white overlay, 0.15s)
- Defender shakes (translateX oscillation, 0.3s)
- Normal damage number floats up

**x2 (super effective):**
- Screen shake (whole fight container shakes, 0.4s)
- Bright flash on defender (red/orange overlay, 0.25s)
- Defender recoils significantly (translateX(12px) + slight rotate)
- Large damage number floats up with emphasis color
- Optional: armor crack visual (CSS filter or overlay)

### 7.3 Death Animation

When HP reaches 0:

- Peeper falls over (rotate + translateY down, 0.5s)
- Fade to grayscale
- Small poof/dust cloud (CSS pseudo-element)

### 7.4 Round Sequence Timing

Total combat phase per round: ~3.5 seconds

```
P1 attacks P2:  wind-up(0.3) + strike(0.2) + projectile(0.6) + hit(0.4) = 1.5s
Brief pause:    0.5s
P2 attacks P1:  wind-up(0.3) + strike(0.2) + projectile(0.6) + hit(0.4) = 1.5s
```

After both attacks: 1s pause to show updated HP, then next choice phase begins.

## 8. Choice Phase UI

### 8.1 Layout

Bottom section of the fight screen, two rows:

**Defense row:** "Choose Armor" label + 4 element buttons
**Attack row:** "Choose Attack" label + 4 element buttons

Each button shows the element emoji/icon and name:
- Fire
- Water
- Earth
- Air

Selected button gets a highlight border + glow.

Player can change selection until the timer runs out or they confirm.

### 8.2 Confirm

- Once both defense and attack are selected, a "Ready" button appears
- Tapping "Ready" locks in the choice and shows "Waiting for opponent..."
- If timer expires without pressing Ready — current selection is submitted (or random if nothing selected)

### 8.3 Visibility

- Both players' choices are completely hidden until combat phase begins
- During choice phase, opponent's Peeper shows no armor (or shows a "?" placeholder)
- When combat phase starts, armor sprites appear on both Peepers simultaneously

### 8.4 Timer

- 10-second countdown bar (same pattern as blackjack turn timer)
- Visual urgency at 3 seconds (bar turns red, subtle pulse)

## 9. Data Model

### 9.1 arena_matches

```sql
CREATE TABLE IF NOT EXISTS arena_matches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  status          TEXT NOT NULL DEFAULT 'waiting'
    CHECK(status IN ('waiting', 'countdown', 'active', 'finished', 'cancelled')),
  visibility      TEXT NOT NULL DEFAULT 'open'
    CHECK(visibility IN ('open', 'private')),
  join_code       TEXT UNIQUE DEFAULT NULL,
  player1_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player2_id      INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE CASCADE,
  stake           INTEGER NOT NULL DEFAULT 25,
  current_round   INTEGER NOT NULL DEFAULT 0,
  player1_hp      INTEGER NOT NULL DEFAULT 100,
  player2_hp      INTEGER NOT NULL DEFAULT 100,
  winner_id       INTEGER DEFAULT NULL REFERENCES users(id),
  result          TEXT DEFAULT NULL
    CHECK(result IN ('p1_win', 'p2_win', 'draw', 'forfeit', NULL)),
  round_deadline  INTEGER DEFAULT NULL,
  created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  finished_at     INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_arena_matches_status
  ON arena_matches(status, created_at);
```

### 9.2 arena_rounds

```sql
CREATE TABLE IF NOT EXISTS arena_rounds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id        INTEGER NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  round_number    INTEGER NOT NULL,
  p1_attack       TEXT DEFAULT NULL CHECK(p1_attack IN ('fire','water','earth','air', NULL)),
  p1_defense      TEXT DEFAULT NULL CHECK(p1_defense IN ('fire','water','earth','air', NULL)),
  p2_attack       TEXT DEFAULT NULL CHECK(p2_attack IN ('fire','water','earth','air', NULL)),
  p2_defense      TEXT DEFAULT NULL CHECK(p2_defense IN ('fire','water','earth','air', NULL)),
  p1_damage_dealt INTEGER DEFAULT NULL,
  p2_damage_dealt INTEGER DEFAULT NULL,
  p1_multiplier   REAL DEFAULT NULL,
  p2_multiplier   REAL DEFAULT NULL,
  p1_hp_after     INTEGER DEFAULT NULL,
  p2_hp_after     INTEGER DEFAULT NULL,
  resolved        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(match_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_arena_rounds_match
  ON arena_rounds(match_id, round_number);
```

### 9.3 arena_queue

```sql
CREATE TABLE IF NOT EXISTS arena_queue (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  queued_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
```

### 9.4 arena_match_invites

Same concept as `blackjack_lobby_invites`, but scoped to arena private rooms.

```sql
CREATE TABLE IF NOT EXISTS arena_match_invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id    INTEGER NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  inviter_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'accepted', 'cancelled')),
  created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  used_at     INTEGER DEFAULT NULL,
  UNIQUE(match_id, invitee_id)
);

CREATE INDEX IF NOT EXISTS idx_arena_invites_match
  ON arena_match_invites(match_id, invitee_id, status);

CREATE INDEX IF NOT EXISTS idx_arena_invites_token
  ON arena_match_invites(token);
```

### 9.5 Single active arena invariant

Hard rule: one user can only be in one arena-related state at a time.

Blocked states:

- `arena_queue`
- `arena_matches.status IN ('waiting', 'countdown', 'active')` where user is `player1_id` or `player2_id`

Implementation:

- every mutating endpoint runs inside a DB transaction
- before queue/create/join/invite-join, call a shared helper like `assertUserAvailableForArena(userId)`
- queue matching removes both queue rows and creates the match in the same transaction
- private join sets `player2_id`, deducts stakes, and starts countdown in the same transaction
- no partial state should leave a user both queued and matched

## 10. Backend API

New route file: backend/routes/arena.js

Register in backend/server.js:

```js
app.use('/api/arena', require('./routes/arena'));
```

### 10.1 POST /api/arena/queue

Join the quick matchmaking queue.

Validation:
- user exists
- Peeper alive and clean
- user has >= 25 coins
- user not already in queue, waiting room, countdown, or active match

Behavior:
1. Run availability checks in a transaction
2. Add user to arena_queue
3. Check if another user is waiting
4. If yes — create match, deduct 25 coins from both, remove both from queue, return match state
5. If no — return { queued: true }

### 10.2 DELETE /api/arena/queue

Leave the queue. No coins lost (coins are only deducted when a match is created).

### 10.3 POST /api/arena/create

Create a private room.

Body: {}

Behavior:
1. Validate user (alive, clean, >= 25 coins)
2. Validate user is not already queued or in any unfinished arena match
3. Create match with visibility = 'private', status = 'waiting', generate 6-char join_code
4. Set player1_id
5. Do NOT deduct coins yet (deduct when both players are in and match starts)
6. Return match state + join code

### 10.4 POST /api/arena/join

Join a private room by code.

Body: { "code": "ABC123" }

Behavior:
1. Find match by code, status = 'waiting'
2. Validate user (alive, clean, >= 25 coins, not player1)
3. Validate user is not already queued or in any unfinished arena match
4. Set player2_id
5. Deduct 25 coins from both players
6. Set status = 'countdown', start 3-second countdown
7. Return match state

### 10.5 GET /api/arena/state/:matchId

Get current match state. Used for polling.

Returns full serialized match state (see section 12).

### 10.6 POST /api/arena/choose/:matchId

Submit element choices for the current round.

Body: { "attack": "fire", "defense": "water" }

Validation:
- match is active
- user is a participant
- current round exists and is not yet resolved
- user has not already submitted for this round

Behavior:
1. Store choices in arena_rounds
2. If both players have submitted — resolve the round immediately
3. Return updated match state

### 10.7 POST /api/arena/forfeit/:matchId

Explicitly surrender the match. Opponent wins.

Important: closing the app, losing connection, or missing a choice timer does not call this endpoint and does not count as surrender.

### 10.8 GET /api/arena/queue/status

Check if user is in queue and for how long.

### 10.9 POST /api/arena/matches/:matchId/invite

Invite a player to a private waiting room by user search result.

Body: { "targetUserId": 123 }

Rules:
- match must be `visibility = 'private'` and `status = 'waiting'`
- inviter must be `player1_id`
- target cannot be the inviter
- target cannot already be queued or in any unfinished arena match
- target can join this room without entering the room code

Behavior:
1. Create or reuse a pending invite token for `(matchId, targetUserId)`
2. Send Telegram DM with a `Join Arena` button and `?arenaInvite=<token>` Mini App parameter
3. If Telegram DM fails, keep the invite token and return a warning state for toast

### 10.10 POST /api/arena/invites/join

Join a private room by invite token.

Body: { "token": "..." }

Rules:
- token must exist and be `pending`
- authenticated user must match `invitee_id`
- match must still be `private` and `waiting`
- user must pass alive/clean/coins checks
- user must not be queued or in another unfinished arena match

Behavior mirrors joining by room code:
1. Set `player2_id`
2. Deduct 25 coins from both players
3. Mark invite `accepted`
4. Set match status to `countdown`
5. Return match state

## 11. Backend Engine: backend/arenaEngine.js

Core functions:

```
ELEMENTS = ['fire', 'air', 'earth', 'water']
ELEMENT_BEATS = { fire: 'air', air: 'earth', earth: 'water', water: 'fire' }
ARENA_STAKE = 25
ARENA_HP = 100
ARENA_BASE_DAMAGE = 20
ARENA_CHOICE_SECONDS = 10
ARENA_QUEUE_TIMEOUT_SECONDS = 60
ARENA_PRIVATE_ROOM_TIMEOUT_SECONDS = 120

calcDamageMultiplier(attack, defense)
  -> if ELEMENT_BEATS[attack] === defense -> 2.0
  -> if ELEMENT_BEATS[defense] === attack -> 0.5
  -> else -> 1.0

calcDamage(attack, defense)
  -> ARENA_BASE_DAMAGE * calcDamageMultiplier(attack, defense)

resolveRound(matchId, roundNumber)
  -> load round data
  -> fill random choices for any missing submissions
  -> calculate p1 damage to p2 and p2 damage to p1
  -> apply damage simultaneously
  -> update HP in arena_matches
  -> check win/draw conditions
  -> if match over: pay winner, set result
  -> if match continues: create next round row, set new deadline

syncMatch(matchId)
  -> check round deadline expiry
  -> if expired: fill random choices, resolve round
  -> check queue/room timeouts
  -> return current state

assertUserAvailableForArena(userId)
  -> reject if user is in arena_queue
  -> reject if user is player1/player2 in an arena match with status waiting/countdown/active
  -> used by queue, private room create, room join, and invite join

serializeMatchState(matchId, userId)
  -> return state visible to this specific user
  -> hide opponent choices for unresolved rounds
  -> include animation data for last resolved round

createArenaInvite(matchId, inviterId, inviteeId)
  -> same pattern as blackjack invites
  -> create or reuse pending token
  -> send Telegram DM with ?arenaInvite=<token>

joinArenaInvite(token, inviteeId)
  -> validate token owner and match state
  -> run the same transaction path as joining by code
```

## 12. Match State Serialization

```json
{
  "match": {
    "id": 42,
    "status": "active",
    "visibility": "open",
    "joinCode": null,
    "currentRound": 3,
    "stake": 25
  },
  "players": {
    "self": {
      "userId": 1,
      "firstName": "Alex",
      "username": "alex",
      "photoUrl": "/avatars/1.jpg",
      "hp": 60,
      "maxHp": 100,
      "outfit": { "slot_head": "...", "slot_body": "...", "slot_hands": "...", "slot_fren": "...", "slot_face": "..." }
    },
    "opponent": {
      "userId": 2,
      "firstName": "Bob",
      "username": "bob",
      "photoUrl": "/avatars/2.jpg",
      "hp": 40,
      "maxHp": 100,
      "outfit": { "slot_head": "...", "slot_body": "...", "slot_hands": "...", "slot_fren": "...", "slot_face": "..." }
    }
  },
  "currentRound": {
    "roundNumber": 3,
    "deadline": 1746200000,
    "selfSubmitted": false,
    "opponentSubmitted": false
  },
  "lastRound": {
    "roundNumber": 2,
    "self": {
      "attack": "fire",
      "defense": "water",
      "damageDealt": 40,
      "multiplier": 2.0
    },
    "opponent": {
      "attack": "earth",
      "defense": "air",
      "damageDealt": 20,
      "multiplier": 1.0
    }
  },
  "result": null,
  "winnerId": null
}
```

Key rules:
- currentRound choices are never exposed to the opponent
- lastRound is fully revealed (both sides) — used for combat animation replay
- opponent.outfit is always visible (for rendering their Peeper)

## 13. Frontend Architecture

### 13.1 New Files

```
frontend/src/games/ArenaGame.jsx          — main fight screen
frontend/src/games/ArenaLobby.jsx         — queue + private room UI
frontend/src/games/ArenaFightScene.jsx    — two-peeper battle stage
frontend/src/games/ArenaChoicePanel.jsx   — element selection UI
frontend/src/games/ArenaCombatReplay.jsx  — animation sequencer
```

### 13.2 API Methods (frontend/src/api.js)

```js
export const arenaJoinQueue = () => post('/arena/queue', {});
export const arenaLeaveQueue = () => request('DELETE', '/arena/queue');
export const arenaQueueStatus = () => get('/arena/queue/status');
export const arenaCreateRoom = () => post('/arena/create', {});
export const arenaJoinRoom = (code) => post('/arena/join', { code });
export const arenaGetState = (matchId) => get('/arena/state/' + matchId);
export const arenaChoose = (matchId, attack, defense) =>
  post('/arena/choose/' + matchId, { attack, defense });
export const arenaForfeit = (matchId) => post('/arena/forfeit/' + matchId, {});
export const arenaInvitePlayer = (matchId, targetUserId) =>
  post('/arena/matches/' + matchId + '/invite', { targetUserId });
export const arenaJoinInvite = (token) => post('/arena/invites/join', { token });
```

### 13.3 HomeScreen Integration

Add to GAMES array:

```js
{
  id: 'arena',
  emoji: '\u2694\uFE0F',
  name: 'Arena',
  desc: 'PvP elemental battles \u00B7 25 \u2726 stake.',
  reward: 'Win 50 \u2726',
  color: '#e05555',
  energy: 0,
}
```

### 13.4 Polling Strategy

During an active match, the client polls GET /api/arena/state/:matchId every 1.5 seconds.

When both players have submitted choices, the server resolves the round immediately. The next poll picks up the resolved round data and triggers the combat animation.

After the animation finishes, the client shows the choice UI for the next round.

## 14. Fight Flow — Step by Step

### 14.1 Quick Queue

1. Player taps "Arena" in game menu
2. ArenaLobby opens: "Find Fight" button + "Create Private Room" button
3. Player taps "Find Fight"
4. Client calls POST /api/arena/queue
5. If matched immediately — receive match state, transition to fight
6. If queued — show searching animation, poll GET /api/arena/queue/status every 2s
7. When matched — transition to fight screen
8. Cancel button removes from queue via DELETE /api/arena/queue

### 14.2 Private Room

1. Player taps "Create Private Room"
2. Client calls POST /api/arena/create
3. Shows room code + "Waiting for opponent..." + invite button
4. Opponent either enters code — POST /api/arena/join — or opens invite deep link — POST /api/arena/invites/join
5. Both players see 3-second countdown
6. Fight begins

### 14.3 Fight

1. Choice phase: 10s timer, pick defense + attack
2. Submit via POST /api/arena/choose/:matchId
3. Poll until round is resolved
4. Play combat animation sequence (~3.5s)
5. Show updated HP
6. If fight over — show result screen (winner celebration / draw)
7. If fight continues — next choice phase

### 14.4 Result Screen

- Winner: "Victory!" + Peeper celebration pose + "+50 coins" animation
- Loser: "Defeat" + fallen Peeper
- Draw: "Draw!" + both Peepers fallen + "25 coins returned"
- Forfeit: winner gets 50 coins, forfeiter loses stake

## 15. Backend Files to Change

### New files

- backend/arenaEngine.js — core match logic, damage calc, round resolution
- backend/arenaConstants.js — ARENA_STAKE, ARENA_HP, elements, cycle
- backend/routes/arena.js — all arena API endpoints

### Modified files

- backend/database.js — add arena tables
- backend/server.js — register /api/arena routes

## 16. Frontend Files to Change

### New files

- frontend/src/games/ArenaGame.jsx
- frontend/src/games/ArenaLobby.jsx
- frontend/src/games/ArenaFightScene.jsx
- frontend/src/games/ArenaChoicePanel.jsx
- frontend/src/games/ArenaCombatReplay.jsx

### Modified files

- frontend/src/api.js — add arena endpoints
- frontend/src/screens/HomeScreen.jsx — add Arena to GAMES, GAME_LOADERS, GAME_COMPONENTS; redesign Play button with tabbed game menu at the end (see section 21)
- frontend/src/components/PeeperSprite.jsx — add optional armorElement prop for rendering armor layer between body and hands

## 17. Implementation Phases

### Phase 1 — Backend Foundation

- Add arena tables to database.js
- Create arenaConstants.js
- Create arenaEngine.js with damage calc, round resolution, match sync
- Create routes/arena.js with all endpoints
- Register routes in server.js

Deliverable: full fight logic works at API level

### Phase 2 — Matchmaking

- Implement quick queue (join, leave, auto-match)
- Implement private rooms (create, join by code)
- Implement invite-by-search using the Blackjack invite pattern
- Enforce one active arena state per user across queue, waiting room, countdown, and active match
- Queue timeout cleanup
- Room expiry cleanup

Deliverable: two players can be matched and a fight starts

### Phase 3 — Fight Screen MVP

- ArenaLobby UI (find fight + create room + join by code)
- ArenaFightScene with two Peepers
- ArenaChoicePanel with element buttons + timer
- Basic polling loop
- Round resolution display (text-only, no animations yet)
- Result screen

Deliverable: playable PvP fights with basic UI

### Phase 4 — Animations

- PeeperSprite armor layer support
- Attack wind-up + lunge animation
- Projectile flight animation (emoji fallback)
- Hit effects (x0.5 / x1 / x2)
- Death animation
- HP bar smooth transitions
- Screen shake for x2 hits

Deliverable: visually polished fights

### Phase 5 — Edge Cases & Polish

- Sprite fallback chain (sprite -> emoji)
- Sound/haptic feedback hooks (future)
- Small screen QA
- Edge case handling (disconnect, refresh mid-fight)
- README update

Deliverable: Arena itself is production-ready

### Phase 6 — Play Button Redesign

- Redesign the Play button game picker with two tabs (see section 21)
- Wire Arena into the "Free Games" tab
- Wire Blackjack into the "Free Games" tab
- Wire existing energy games into the "Energy Games" tab
- Default to Free tab when energy is 0

Deliverable: new tabbed game menu is live as the final integration step

## 18. Edge Cases

- **Player refreshes mid-fight:** poll picks up current state, if in combat phase — replay last round animation, then show choice UI for current round
- **Player closes app:** round deadline expires — server assigns random choices — fight continues. If player never returns, they keep getting random choices until they lose or win. This is not a forfeit.
- **Both players disconnect:** rounds keep resolving with random choices on deadline expiry until someone wins
- **Player tries to fight with < 25 coins:** rejected at queue/create/join
- **Player tries to fight while dirty/dead:** rejected
- **Player already queued, waiting, in countdown, or in active match tries any new arena action:** rejected
- **Private room expires:** match cancelled, no coins deducted (coins only deducted when both join)
- **Queue timeout:** player removed from queue, no coins lost
- **Player tries to choose after already submitting:** rejected, return current state
- **Player tries to choose for a resolved round:** rejected
- **Player forfeits during choice phase:** opponent wins immediately, receives 50 coins
- **Player misses choice timer:** server fills random choices; no surrender, no instant loss
- **Invited user opens someone else's invite token:** rejected
- **Invited user is already queued or fighting:** rejected

## 19. Testing Checklist

### Matchmaking

- Quick queue matches two players
- Queue timeout removes player after 60s
- Private room generates valid code
- Private room join works with correct code
- Private room expires after 120s
- Cannot join own room
- Cannot queue while in active match
- Cannot queue while waiting in private room
- Cannot create private room while queued
- Cannot join private room while queued or in another match
- Cannot queue while dirty or dead
- Cannot queue with < 25 coins
- Invite token lets the intended player join without code
- Wrong user cannot use another player's invite token
- Invite join respects one-active-arena-state rule

### Combat

- Damage multipliers are correct for all 16 element combinations
- Both players' damage applies simultaneously
- HP cannot go below 0
- Draw detected when both reach 0 HP simultaneously
- Winner receives 50 coins
- Draw returns 25 coins to each
- Forfeit pays opponent
- Random choices assigned on timeout
- Closing app / missing timer assigns random choices and does not forfeit
- Round resolves immediately when both submit

### Timing

- 10-second choice deadline enforced server-side
- 3-second countdown before private room fight starts
- Round deadline creates next round automatically

### UI

- Both Peepers render with correct outfits
- Armor sprite appears during combat phase only
- Projectile animation plays correctly (or emoji fallback)
- Hit effects match damage multiplier (x0.5 / x1 / x2)
- HP bars animate smoothly
- Timer bar shows correct countdown
- Element selection highlights work
- Result screen shows correct outcome
- Entire UI scales proportionally on all screen sizes
- No elements clipped or pushed off-screen on small phones

## 20. Constants Summary

```js
// backend/arenaConstants.js
const ARENA_STAKE = 25;
const ARENA_HP = 100;
const ARENA_BASE_DAMAGE = 20;
const ARENA_CHOICE_SECONDS = 10;
const ARENA_COUNTDOWN_SECONDS = 3;
const ARENA_QUEUE_TIMEOUT_SECONDS = 60;
const ARENA_PRIVATE_ROOM_TIMEOUT_SECONDS = 120;
const ARENA_POLL_INTERVAL_MS = 1500;

const ARENA_CANVAS_WIDTH = 600;
const ARENA_CANVAS_HEIGHT = 360;
const ARENA_FLOOR_PERCENT = 30;
const ARENA_FLOOR_LINE_Y = 252;
const ARENA_PEEPER_WIDTH = 160;
const ARENA_P1_CENTER_X = 155;
const ARENA_P2_CENTER_X = 445;

const ELEMENTS = ['fire', 'air', 'earth', 'water'];
const ELEMENT_BEATS = {
  fire: 'air',
  air: 'earth',
  earth: 'water',
  water: 'fire',
};

const ARMOR_SPRITES = {
  fire: 'arena_armor_fire',
  water: 'arena_armor_water',
  earth: 'arena_armor_earth',
  air: 'arena_armor_air',
};

const PROJECTILE_SPRITES = {
  fire: 'arena_projectile_fire',
  water: 'arena_projectile_water',
  earth: 'arena_projectile_earth',
  air: 'arena_projectile_air',
};

const ELEMENT_EMOJI = {
  fire: '\uD83D\uDD25',
  water: '\uD83D\uDCA7',
  earth: '\uD83C\uDF0D',
  air: '\uD83D\uDCA8',
};

const ELEMENT_COLORS = {
  fire: '#e05555',
  water: '#4a9eff',
  earth: '#7cb342',
  air: '#b0bec5',
};
```

## 21. Play Button Redesign — Tabbed Game Menu

The current Play button opens a flat list of all mini-games. With Arena added as a free (no energy) game alongside Blackjack, the game list now has two distinct categories. The Play button menu should be redesigned with two tabs.

### 21.1 Tabs

**Tab 1: "Energy Games"**
- Contains all games that cost 1 energy per play
- Games: caSino, Sniper, Flappy Frog, Quick Grab, Bubble Pop, Dodge, Catch Toys

**Tab 2: "Free Games"**
- Contains all games that do not cost energy (only coins)
- Games: Arena, Blackjack

### 21.2 Default Tab Logic

- If the player has energy > 0: open Tab 1 (Energy Games) by default
- If the player has energy = 0: open Tab 2 (Free Games) by default

This ensures the player always sees games they can actually play right now.

### 21.3 Tab UI

- Two tab buttons at the top of the game picker sheet/overlay
- Active tab has a highlighted underline or filled background
- Inactive tab is dimmed but still tappable
- Tab labels: "Energy" and "Free" (short, fits on one line)
- Optional: show energy count badge on the Energy tab, e.g. "Energy (3)"
- Optional: show a small coin icon on the Free tab

### 21.4 Behavior

- Switching tabs is instant (no loading)
- Both tabs use the same card layout as the current game list
- The dirty/dead Peeper lock still applies to all games regardless of tab
- Games that require energy still show the energy cost on their card
- Free games show the coin stake on their card (e.g. "25 coins" for Arena, "10 coins" for Blackjack)

### 21.5 Implementation

Derive tabs from the existing GAMES array:

```js
const ENERGY_GAMES = GAMES.filter(g => g.energy > 0);
const FREE_GAMES = GAMES.filter(g => g.energy === 0);
```

Default tab state:

```js
const [activeGameTab, setActiveGameTab] = useState(
  energy > 0 ? 'energy' : 'free'
);
```

Update the default tab when energy changes (e.g. after playing a game):

```js
useEffect(() => {
  if (energy === 0 && activeGameTab === 'energy') {
    setActiveGameTab('free');
  }
}, [energy]);
```
