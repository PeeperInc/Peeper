# Expedition Public Test Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved public-test Expedition update with persistent HP, asynchronous family role powers, AP-safe mini-games, 24 useful consumable artifacts, contribution rewards, and polished mobile animations.

**Architecture:** Keep SQLite as the source of truth and put every AP, HP, inventory, room-effect, attempt, and reward mutation inside one transaction. Split new responsibilities into focused Expedition modules while retaining `engine.js` as the orchestration boundary and `FamilyExpeditionTab.jsx` as the screen coordinator. Server responses carry deterministic state plus explicit visual events; the frontend renders effects but never decides rewards or damage.

**Tech Stack:** Node.js, Express, better-sqlite3, Node test runner, React, Vite, CSS animations.

---

### Task 1: Add Persistent Expedition Tables And Member State

**Files:**
- Modify: `backend/database.js`
- Modify: `backend/expeditions/schema.test.mjs`

- [ ] **Step 1: Write failing schema assertions**

Assert these additive tables and columns exist:

```js
assertColumns('family_expedition_members', [
  'role_charge', 'role_charge_progress', 'room_coins_earned'
]);
assertColumns('family_expedition_room_effects', [
  'id', 'expedition_id', 'room_id', 'effect_type', 'placed_by',
  'remaining_uses', 'payload_json', 'created_at', 'consumed_at'
]);
assertColumns('family_expedition_minigame_attempts', [
  'id', 'attempt_token', 'expedition_id', 'room_id', 'user_id',
  'game_type', 'seed', 'status', 'ap_spent', 'retry_available',
  'started_at', 'expires_at', 'finished_at', 'result_json'
]);
assertColumns('family_expedition_pending_rewards', [
  'id', 'expedition_id', 'user_id', 'payload_json', 'created_at', 'claimed_at'
]);
assertColumns('family_expedition_member_events', [
  'id', 'expedition_id', 'user_id', 'event_type', 'payload_json',
  'created_at', 'acknowledged_at'
]);
```

- [ ] **Step 2: Run the schema test and verify RED**

Run: `node --test backend/expeditions/schema.test.mjs`

Expected: failure reporting the first missing table/column.

- [ ] **Step 3: Add idempotent startup migrations**

Use `CREATE TABLE IF NOT EXISTS`, `addColumnIfMissing`, foreign keys, and these uniqueness rules:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_expedition_room_effect_active
ON family_expedition_room_effects(expedition_id, room_id, effect_type)
WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expedition_attempt_token
ON family_expedition_minigame_attempts(attempt_token);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expedition_open_attempt
ON family_expedition_minigame_attempts(expedition_id, room_id, user_id)
WHERE status IN ('ready', 'active', 'retry');

CREATE UNIQUE INDEX IF NOT EXISTS idx_expedition_pending_reward
ON family_expedition_pending_rewards(expedition_id, user_id);
```

Member defaults are `role_charge = 1`, `role_charge_progress = 0`, and `room_coins_earned = 0`.

- [ ] **Step 4: Run schema tests and verify GREEN**

Run: `node --test backend/expeditions/schema.test.mjs`

Expected: all schema tests pass.

- [ ] **Step 5: Commit the schema unit**

```powershell
git add backend/database.js backend/expeditions/schema.test.mjs
git commit -m "feat: add expedition public test state tables"
```

### Task 2: Correct Persistent HP And Increase Combat Difficulty

**Files:**
- Modify: `backend/expeditions/catalog.js`
- Modify: `backend/expeditions/engine.js`
- Modify: `backend/expeditions/engine.test.mjs`

- [ ] **Step 1: Add failing HP and combat tests**

Cover the exact combat bands and persistent HP:

```js
assert.deepEqual(combatRollOutcome(5), { label: 'hero_hit', heroDamage: 1, progress: 0 });
assert.deepEqual(combatRollOutcome(8), { label: 'standoff', heroDamage: 0, progress: 0 });
assert.deepEqual(combatRollOutcome(9), { label: 'enemy_hit', heroDamage: 0, progress: 1 });
assert.equal(combatRollOutcome(16).progress, 2);
assert.equal(combatRollOutcome(20).progress, 3);

const cleared = resolveAttempt({ member: member({ heroHp: 2 }), room: almostClearedRoom(), roll: 20, now: 1000 });
assert.equal(cleared.member.heroHp, 2);

const knockedOut = resolveAttempt({ member: member({ heroHp: 1 }), room: combatRoom(), roll: 1, now: 1000 });
assert.equal(knockedOut.member.heroHp, 0);
assert.equal(knockedOut.member.heroRecoverAt, 1000 + 6 * 60 * 60);
```

- [ ] **Step 2: Verify RED**

Run: `node --test backend/expeditions/engine.test.mjs`

Expected: old `1-4/5-7/8+` bands or room-clear healing fail assertions.

- [ ] **Step 3: Implement the combat bands and remove room healing**

Export one pure `combatRollOutcome` helper. Remove every branch that sets living members to `3 HP` when a room or mini-game clears. Keep only `recoverHeroIfReady` as ordinary automatic healing.

Set generated combat targets from `5 -> 6`, `6 -> 7`, and boss phase target `8 -> 9` without changing non-combat progress targets.

- [ ] **Step 4: Verify engine and generator tests**

Run: `node --test backend/expeditions/engine.test.mjs backend/expeditions/generator.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit HP/combat**

```powershell
git add backend/expeditions/catalog.js backend/expeditions/engine.js backend/expeditions/engine.test.mjs backend/expeditions/generator.test.mjs
git commit -m "feat: persist expedition hp and rebalance combat"
```

### Task 3: Add Asynchronous Family Role Powers

**Files:**
- Create: `backend/expeditions/roleEffects.js`
- Create: `backend/expeditions/roleEffects.test.mjs`
- Modify: `backend/expeditions/engine.js`
- Modify: `backend/routes/expeditions.js`
- Modify: `backend/expeditions/serializer.js`
- Modify: `backend/expeditions/routes.test.mjs`

- [ ] **Step 1: Test room effect placement and role recharge**

Use a temporary SQLite schema and verify:

```js
const shield = placeRoleEffect(db, {
  expeditionId: 1, roomId: 2, userId: 10, role: 'knight', now: 1000
});
assert.equal(shield.effectType, 'knight_shield');
assert.throws(() => placeRoleEffect(db, {
  expeditionId: 1, roomId: 2, userId: 11, role: 'knight', now: 1001
}), /already active/);

assert.deepEqual(advanceRoleCharge({ roleCharge: 0, roleChargeProgress: 2 }, 1, 3), {
  roleCharge: 1,
  roleChargeProgress: 0,
});
```

Test shield consumption, Mage combat advantage, Mage mini-game retry, Cleric healing/recovery reduction, and Scout single-choice enforcement.

- [ ] **Step 2: Verify RED**

Run: `node --test backend/expeditions/roleEffects.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement focused role helpers**

Export:

```js
module.exports = {
  ROLE_EFFECT_TYPES,
  advanceRoleCharge,
  consumeRoomEffect,
  listActiveRoomEffects,
  placeRoleEffect,
  useClericPrayer,
};
```

All helpers accept a transaction and return explicit event payloads such as:

```js
{ type: 'shield_blocked', effectId, placedBy, preventedDamage: 1 }
{ type: 'cleric_heal', placedBy, amount: 1, heroHp: 3 }
{ type: 'mage_advantage', rolls: [7, 16], chosen: 16, placedBy }
```

- [ ] **Step 4: Add the role mutation route**

Add `POST /api/expeditions/:id/rooms/:roomKey/role-ability` with `idempotencyKey`. Derive the role from the authenticated member; never accept a client role. Return serialized room effects and visual events.

- [ ] **Step 5: Integrate charge progress with every spent AP**

Replace direct contribution increments with one helper that increments contribution AP and charge progress. `Family Banner` can pass recharge threshold `2`; default is `3`.

- [ ] **Step 6: Verify role tests and route tests**

Run: `node --test backend/expeditions/roleEffects.test.mjs backend/expeditions/routes.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: Commit role powers**

```powershell
git add backend/expeditions/roleEffects.js backend/expeditions/roleEffects.test.mjs backend/expeditions/engine.js backend/routes/expeditions.js backend/expeditions/serializer.js backend/expeditions/routes.test.mjs
git commit -m "feat: add shared expedition role powers"
```

### Task 4: Make Mini-Game Attempts Spend AP At Start

**Files:**
- Create: `backend/expeditions/minigameAttempts.js`
- Create: `backend/expeditions/minigameAttempts.test.mjs`
- Modify: `backend/routes/expeditions.js`
- Modify: `backend/expeditions/engine.js`
- Modify: `backend/expeditions/routes.test.mjs`

- [ ] **Step 1: Test the attempt state machine**

Test `ready -> active -> succeeded/failed`, timeout, idempotent start/finish, one open attempt, AP spending once, one point of failure damage, shield consumption, and Mage `retry` without AP/damage.

The public return shape is:

```js
{
  attemptToken: 'opaque-token',
  gameType: 'root_crossing',
  seed: 'public-attempt-seed',
  startedAt: 1000,
  expiresAt: 1015,
  retry: false
}
```

- [ ] **Step 2: Verify RED**

Run: `node --test backend/expeditions/minigameAttempts.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement mini-game session transactions**

Export `startAttempt`, `finishAttempt`, `expireAttempt`, and `readOpenAttempt`. Root Crossing starts on first `UP`; other games start on their Start control. `finishAttempt` accepts only normalized outcome data and computes HP/effect changes server-side.

- [ ] **Step 4: Replace the old event endpoint contract**

Add:

```text
POST /:id/rooms/:roomKey/minigame/start
POST /:id/rooms/:roomKey/minigame/:attemptToken/finish
```

Keep the old endpoint temporarily returning `410` with `Mini-game client update required` so stale clients cannot bypass AP-at-start.

- [ ] **Step 5: Verify routes and state machine**

Run: `node --test backend/expeditions/minigameAttempts.test.mjs backend/expeditions/routes.test.mjs`

Expected: all tests pass.

- [ ] **Step 6: Commit mini-game persistence**

```powershell
git add backend/expeditions/minigameAttempts.js backend/expeditions/minigameAttempts.test.mjs backend/expeditions/engine.js backend/routes/expeditions.js backend/expeditions/routes.test.mjs
git commit -m "feat: persist expedition minigame attempts"
```

### Task 5: Replace The Artifact Catalog And Consumption Model

**Files:**
- Modify: `backend/expeditions/catalog.js`
- Rewrite: `backend/expeditions/artifactEffects.js`
- Modify: `backend/expeditions/artifactEffects.test.mjs`
- Modify: `backend/expeditions/loot.js`
- Modify: `backend/expeditions/loot.test.mjs`
- Modify: `backend/expeditions/engine.js`
- Modify: `backend/routes/expeditions.js`

- [ ] **Step 1: Replace legacy catalog expectations with the approved 24 IDs**

Assert exact IDs, rarity, use type, and effect kind. The expected split is `14 active` and `10 expedition_passive`.

- [ ] **Step 2: Verify RED**

Run: `node --test backend/expeditions/catalog.test.mjs backend/expeditions/artifactEffects.test.mjs`

Expected: legacy catalog mismatch.

- [ ] **Step 3: Implement explicit effect handlers**

Use effect kinds tied only to current systems:

```js
const EFFECT_KINDS = new Set([
  'minigame_time', 'combat_damage_bonus', 'minigame_time_once',
  'prevent_personal_damage', 'combat_roll_floor', 'room_progress',
  'heal_self', 'minigame_auto_success', 'combat_advantage',
  'role_recharge_threshold', 'boss_damage_bonus', 'place_room_shield',
  'place_room_retry', 'restore_role_charge', 'revive_self', 'restore_ap',
  'prevent_knockout', 'critical_heal', 'scout_choice', 'coin_multiplier',
  'multi_combat_advantage', 'critical_threshold'
]);
```

Do not retain tag-driven `dark`, `undead`, `mimic`, shrine, hidden-path, or complication handlers.

- [ ] **Step 4: Add active artifact use route**

Add `POST /api/expeditions/:id/rooms/:roomKey/artifacts/:artifactId/use`. Validate ownership in the equipped slot, applicability, active type, and idempotency before consuming quantity/reservation.

- [ ] **Step 5: Add deterministic legacy conversion migration**

Map removed stacks to same-rarity curated IDs using a stable hash of `user_id:old_artifact_id`; merge quantities with `INSERT ... ON CONFLICT DO UPDATE`. Record a migration key so conversion runs once.

- [ ] **Step 6: Run artifact, loot, engine, and route tests**

Run: `node --test backend/expeditions/catalog.test.mjs backend/expeditions/artifactEffects.test.mjs backend/expeditions/loot.test.mjs backend/expeditions/engine.test.mjs backend/expeditions/routes.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: Commit the artifact rewrite**

```powershell
git add backend/database.js backend/expeditions/catalog.js backend/expeditions/artifactEffects.js backend/expeditions/artifactEffects.test.mjs backend/expeditions/loot.js backend/expeditions/loot.test.mjs backend/expeditions/engine.js backend/routes/expeditions.js
git commit -m "feat: replace expedition artifact system"
```

### Task 6: Persist Contribution-Scaled Rewards

**Files:**
- Create: `backend/expeditions/rewards.js`
- Create: `backend/expeditions/rewards.test.mjs`
- Modify: `backend/expeditions/engine.js`
- Modify: `backend/routes/expeditions.js`
- Modify: `backend/expeditions/serializer.js`
- Modify: `backend/expeditions/routes.test.mjs`

- [ ] **Step 1: Test immutable pending rewards**

Verify zero contribution creates none, higher contribution never yields fewer coins under identical inputs, payload generation occurs once, multiple expeditions accumulate, claim is idempotent, and starting a new expedition does not hide old rewards.

- [ ] **Step 2: Verify RED**

Run: `node --test backend/expeditions/rewards.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement reward generation and claims**

Export:

```js
module.exports = {
  createPendingRewards,
  claimPendingReward,
  listPendingRewards,
  backfillLegacyRewards,
};
```

Payload includes `contributionAp`, `roomCoins`, `finalCoins`, `totalCoins`, artifacts, expedition title, and completion time. Keep weighting constants private. Double all room coin ranges and duplicate substitutions before final reward calculation.

- [ ] **Step 4: Generate rewards during finish transaction**

Create every eligible member payload before marking finish successful. Consume expedition-passive loadout reservations in the same transaction.

- [ ] **Step 5: Add independent claim route**

Add `POST /api/expeditions/rewards/:rewardId/claim`; authenticate by `user_id`, not current family. Return the immutable payload plus updated pending count.

- [ ] **Step 6: Verify reward and route tests**

Run: `node --test backend/expeditions/rewards.test.mjs backend/expeditions/routes.test.mjs backend/expeditions/engine.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: Commit rewards**

```powershell
git add backend/expeditions/rewards.js backend/expeditions/rewards.test.mjs backend/expeditions/engine.js backend/routes/expeditions.js backend/expeditions/serializer.js backend/expeditions/routes.test.mjs
git commit -m "feat: persist expedition contribution rewards"
```

### Task 7: Queue Offline Heal Events

**Files:**
- Create: `backend/expeditions/memberEvents.js`
- Create: `backend/expeditions/memberEvents.test.mjs`
- Modify: `backend/expeditions/roleEffects.js`
- Modify: `backend/routes/expeditions.js`
- Modify: `backend/expeditions/serializer.js`

- [ ] **Step 1: Test event delivery and acknowledgement**

Verify Cleric inserts one event per affected member, GET state returns unacknowledged events only, and acknowledgement is user-scoped and idempotent.

- [ ] **Step 2: Implement event queue**

Export `enqueueMemberEvent`, `listPendingMemberEvents`, and `acknowledgeMemberEvents`. Return only sanitized payloads.

- [ ] **Step 3: Add acknowledgement route**

Add `POST /api/expeditions/events/ack` accepting `eventIds` and an idempotency key. Events belonging to another user remain untouched.

- [ ] **Step 4: Verify tests and commit**

Run: `node --test backend/expeditions/memberEvents.test.mjs backend/expeditions/roleEffects.test.mjs backend/expeditions/routes.test.mjs`

```powershell
git add backend/expeditions/memberEvents.js backend/expeditions/memberEvents.test.mjs backend/expeditions/roleEffects.js backend/routes/expeditions.js backend/expeditions/serializer.js
git commit -m "feat: deliver offline expedition events"
```

### Task 8: Add Frontend API And Artifact/Reward Sheets

**Files:**
- Modify: `frontend/src/api.js`
- Create: `frontend/src/components/expedition/ArtifactDetailSheet.jsx`
- Create: `frontend/src/components/expedition/RewardClaimSheet.jsx`
- Create: `frontend/src/components/expedition/ExpeditionSheets.css`
- Modify: `frontend/src/screens/FamilyExpeditionTab.jsx`

- [ ] **Step 1: Add API wrappers**

Add wrappers for role ability, artifact use, mini-game start/finish, pending reward claim, and event acknowledgement. Reuse the existing authenticated request and idempotency helpers.

- [ ] **Step 2: Implement artifact details with the existing BottomSheet**

The component accepts:

```jsx
<ArtifactDetailSheet
  artifact={artifact}
  mode="take|use|inspect"
  disabledReason={disabledReason}
  onConfirm={handleConfirm}
  onClose={handleClose}
/>
```

Render image, rarity, use type, exact effect, consumption copy, quantity, and one contextual primary button.

- [ ] **Step 3: Implement immutable reward reveal**

`RewardClaimSheet` shows contribution, room/final/total coins, then reveals artifact cards sequentially. It never calculates rewards locally.

- [ ] **Step 4: Wire three-slot selection and pending reward entry point**

Replace direct item selection with the detail sheet. Add `Claim Rewards · N` even when a new expedition is active.

- [ ] **Step 5: Build and commit**

Run: `cd frontend; npm.cmd run build`

Expected: Vite production build exits `0`.

```powershell
git add frontend/src/api.js frontend/src/components/expedition frontend/src/screens/FamilyExpeditionTab.jsx
git commit -m "feat: add expedition artifact and reward sheets"
```

### Task 9: Add Room Effect HUD And Combat Animations

**Files:**
- Create: `frontend/src/components/expedition/RoomEffectsBar.jsx`
- Create: `frontend/src/components/expedition/ExpeditionCombatFx.jsx`
- Create: `frontend/src/components/expedition/ExpeditionCombatFx.css`
- Modify: `frontend/src/screens/FamilyExpeditionTab.jsx`
- Modify: `frontend/src/screens/FamilyExpeditionTab.css`

- [ ] **Step 1: Render active effects beneath the room**

Display compact rows such as `Knight shield ready · placed by Vivor` and `Bend Fate ready · placed by Vivor`. Do not render consumed effects.

- [ ] **Step 2: Add two-die Mage animation**

Render two d20 elements, animate them simultaneously, then highlight `chosen` and dim the lower roll. Server-provided roll values are the only final source.

- [ ] **Step 3: Add shield and heal animations**

Shield: overlay, impact flash, crack, fade. Heal: green-gold particles, rising `+1 HP`, smooth HP fill. Queue offline heal events and acknowledge only after playback.

- [ ] **Step 4: Add reduced-motion behavior**

Use `@media (prefers-reduced-motion: reduce)` to replace movement with short opacity transitions while preserving result text.

- [ ] **Step 5: Build and commit**

Run: `cd frontend; npm.cmd run build`

```powershell
git add frontend/src/components/expedition frontend/src/screens/FamilyExpeditionTab.jsx frontend/src/screens/FamilyExpeditionTab.css
git commit -m "feat: animate expedition family effects"
```

### Task 10: Rebuild Root Crossing And Hunt The Shade

**Files:**
- Create: `frontend/src/components/expedition/RootCrossingGame.jsx`
- Create: `frontend/src/components/expedition/ShadeHuntGame.jsx`
- Create: `frontend/src/components/expedition/ExpeditionMiniGames.css`
- Modify: `frontend/src/screens/FamilyExpeditionTab.jsx`
- Modify: `frontend/public/expedition-minigames-test.html`

- [ ] **Step 1: Implement Root Crossing from the server seed**

Use deterministic lane directions, speeds, and offsets. Keep the player on discrete rows. First `UP` awaits mini-game start API before moving. Disable controls while starting/finishing. Collision or timeout submits failure once; top row submits success once.

- [ ] **Step 2: Implement six-target Shade Hunt**

Initialize all six targets before Start. Move continuously with collision avoidance. Start API triggers a `300ms` eyes-only target flash; afterward remove every target-specific visual class. Wrong tap or timeout submits failure once.

- [ ] **Step 3: Integrate Mage retry**

When finish returns `retry`, reset only the playfield state, keep the same attempt token, show `Bend Fate grants another chance`, and do not request another AP spend.

- [ ] **Step 4: Update standalone test page**

Mirror controls and visual behavior without backend calls so both mini-games remain quickly testable from `frontend/public/expedition-minigames-test.html`.

- [ ] **Step 5: Build and commit**

Run: `cd frontend; npm.cmd run build`

```powershell
git add frontend/src/components/expedition frontend/src/screens/FamilyExpeditionTab.jsx frontend/public/expedition-minigames-test.html
git commit -m "feat: rebuild expedition skill games"
```

### Task 11: Full Verification And Mobile Playtest

**Files:**
- Modify only files required by defects found during verification.

- [ ] **Step 1: Run backend syntax checks**

```powershell
node --check backend/expeditions/engine.js
node --check backend/expeditions/roleEffects.js
node --check backend/expeditions/minigameAttempts.js
node --check backend/expeditions/rewards.js
node --check backend/routes/expeditions.js
```

- [ ] **Step 2: Run the full Expedition test suite**

Run:

```powershell
$tests = Get-ChildItem backend/expeditions -Filter *.test.mjs | ForEach-Object FullName
node --test $tests
```

Expected: zero failed tests.

- [ ] **Step 3: Build frontend production output**

Run: `cd frontend; npm.cmd run build`

Expected: Vite exits `0` with no unresolved imports.

- [ ] **Step 4: Playtest two dev users on mobile viewport**

Verify AP regeneration, persistent HP, knockout/recovery, all four roles, room effect visibility/consumption, two dice, shield/heal playback, offline heal replay, active/passive artifacts, Root Crossing, Shade Hunt, Mage retry, reward accumulation, claiming after a new expedition, and viewport fit at `320x568`.

- [ ] **Step 5: Review the final diff**

Run `git status --short` and `git diff --check`. If playtesting required fixes, stage only the exact Expedition files changed during Step 4 and commit them as `fix: harden expedition public test flow`; do not stage unrelated pre-existing worktree changes.
