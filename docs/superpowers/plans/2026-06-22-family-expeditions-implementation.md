# Family Expeditions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete asynchronous Family Expeditions dungeon crawler with procedural maps, personal AP, four roles, d20 resolution, 54 artifacts, farm provisions, rewards, notifications, history, and the full Crypt of the Root King mobile UI.

**Architecture:** SQLite and pure CommonJS engine modules own all persistent and gameplay state. Express routes expose transactional, idempotent mutations and serialized snapshots. React lazy-loads an isolated expedition feature inside Family Screen, with server snapshots as truth and pure frontend helpers for display-only state.

**Tech Stack:** Node.js 20, Express, better-sqlite3, node:test, React 18, Vite 5, CSS/SVG, existing Peeper asset renderer.

---

## File Map

### Backend

- `backend/database.js`: expedition tables, indexes, and notification setting migration.
- `backend/expeditions/catalog.js`: roles, room templates, provisions, artifacts, and loot configuration.
- `backend/expeditions/generator.js`: deterministic valid node-map generation.
- `backend/expeditions/artifactEffects.js`: all artifact trigger evaluation and charge changes.
- `backend/expeditions/loot.js`: personal coin and artifact rolls.
- `backend/expeditions/engine.js`: AP, d20, support, preparation, actions, room unlocking, boss phases, and finish rules.
- `backend/expeditions/serializer.js`: public response shape and lazy AP synchronization.
- `backend/routes/expeditions.js`: authenticated public API.
- `backend/notificationSettings.js`: `expedition_notifications` toggle.
- `backend/notifier.js`: one-shot AP, boss, reward, and completion alerts.
- `backend/server.js`: route registration.
- `backend/expeditions/*.test.mjs`: focused engine, generator, loot, effects, and route-contract tests.

### Frontend

- `frontend/src/api.js`: expedition API wrappers.
- `frontend/src/expeditions/expeditionCatalog.js`: asset URLs and display metadata.
- `frontend/src/expeditions/expeditionState.mjs`: pure snapshot/view helpers.
- `frontend/src/expeditions/expeditionState.test.mjs`: frontend state tests.
- `frontend/src/expeditions/ExpeditionTab.jsx`: feature controller and polling.
- `frontend/src/expeditions/ExpeditionContractBoard.jsx`: start and history entry.
- `frontend/src/expeditions/ExpeditionPreparation.jsx`: role, artifact, and provision loadout.
- `frontend/src/expeditions/ExpeditionVault.jsx`: personal artifact collection.
- `frontend/src/expeditions/ExpeditionMap.jsx`: responsive vertical node-map.
- `frontend/src/expeditions/ExpeditionRoom.jsx`: room actions, support, and progress.
- `frontend/src/expeditions/ExpeditionRollOverlay.jsx`: d20 result presentation.
- `frontend/src/expeditions/ExpeditionResults.jsx`: boss chest, contribution, archive, and history.
- `frontend/src/expeditions/expedition.css`: complete mobile UI and reduced motion.
- `frontend/src/screens/FamilyScreen.jsx`: lazy Expedition tab integration only.
- `frontend/src/assets/expeditions/root-king/`: approved production asset pack and catalog.

---

### Task 1: Persist Expedition State

**Files:**
- Modify: `backend/database.js`
- Modify: `backend/notificationSettings.js`
- Test: `backend/notificationSettings.test.mjs`

- [ ] **Step 1: Extend the notification default test**

```js
test('expedition notifications default to enabled', () => {
  const settings = notifications.getNotificationSettings(-999999);
  assert.equal(settings.expedition_notifications, 1);
  assert.equal(
    notifications.NOTIFICATION_SETTING_META.expedition_notifications.label,
    'Expedition alerts',
  );
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd backend && node --test notificationSettings.test.mjs`

Expected: FAIL because `expedition_notifications` is absent.

- [ ] **Step 3: Add tables, indexes, and setting migration**

Add the five tables from the approved spec to the main `db.exec` schema block. Use these exact constraints:

```sql
CREATE TABLE IF NOT EXISTS family_expeditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL,
  seed TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','boss_defeated','finished')),
  map_json TEXT NOT NULL,
  shared_buffs_json TEXT NOT NULL DEFAULT '{}',
  started_by INTEGER NOT NULL REFERENCES users(id),
  started_at INTEGER NOT NULL,
  boss_defeated_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS family_expedition_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expedition_id INTEGER NOT NULL REFERENCES family_expeditions(id) ON DELETE CASCADE,
  room_key TEXT NOT NULL,
  room_type TEXT NOT NULL,
  state TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  progress_target INTEGER NOT NULL,
  support INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  unlocked_at INTEGER,
  cleared_at INTEGER,
  UNIQUE(expedition_id, room_key)
);

CREATE TABLE IF NOT EXISTS family_expedition_members (
  expedition_id INTEGER NOT NULL REFERENCES family_expeditions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  ap INTEGER NOT NULL DEFAULT 3,
  ap_regen_day INTEGER NOT NULL,
  role_ability_day INTEGER NOT NULL,
  role_ability_used INTEGER NOT NULL DEFAULT 0,
  provision_id TEXT,
  provision_state_json TEXT NOT NULL DEFAULT '{}',
  loadout_json TEXT NOT NULL DEFAULT '[]',
  debuff_json TEXT NOT NULL DEFAULT '{}',
  contribution_ap INTEGER NOT NULL DEFAULT 0,
  contribution_progress INTEGER NOT NULL DEFAULT 0,
  prepared_at INTEGER NOT NULL,
  boss_reward_claimed_at INTEGER,
  PRIMARY KEY(expedition_id, user_id)
);

CREATE TABLE IF NOT EXISTS expedition_artifact_inventory (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  charges INTEGER NOT NULL DEFAULT 0,
  first_acquired_at INTEGER NOT NULL,
  last_acquired_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS family_expedition_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL,
  expedition_id INTEGER NOT NULL REFERENCES family_expeditions(id) ON DELETE CASCADE,
  room_id INTEGER NOT NULL REFERENCES family_expedition_rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  stat TEXT,
  raw_roll INTEGER,
  modifier_json TEXT NOT NULL DEFAULT '{}',
  modified_roll INTEGER,
  progress_awarded INTEGER NOT NULL DEFAULT 0,
  loot_json TEXT NOT NULL DEFAULT '{}',
  narration_key TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, idempotency_key)
);
```

Add indexes on active family expeditions, expedition rooms, action chronology, and artifact ownership. Add `family_expedition_history` exactly as specified. Add:

```js
addColumnIfMissing(
  'user_notification_settings',
  'expedition_notifications',
  'INTEGER NOT NULL DEFAULT 1',
);
```

Update `NOTIFICATION_SETTING_KEYS`, metadata, getter, and defaults.

- [ ] **Step 4: Run syntax and notification tests**

Run: `node --check database.js && node --check notificationSettings.js && node --test notificationSettings.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit schema foundation**

```bash
git add backend/database.js backend/notificationSettings.js backend/notificationSettings.test.mjs
git commit -m "feat: add expedition persistence schema"
```

### Task 2: Define The Authoritative Catalog

**Files:**
- Create: `backend/expeditions/catalog.js`
- Create: `backend/expeditions/catalog.test.mjs`
- Modify: `frontend/src/assets/expeditions/root-king/asset-catalog.json`

- [ ] **Step 1: Test catalog completeness and identifiers**

```js
test('root king catalog is complete and internally consistent', () => {
  assert.equal(Object.keys(ROLES).length, 4);
  assert.equal(Object.keys(ARTIFACTS).length, 54);
  assert.equal(Object.keys(PROVISIONS).length, 7);
  assert.equal(new Set(Object.keys(ARTIFACTS)).size, 54);
  for (const artifact of Object.values(ARTIFACTS)) {
    assert.match(artifact.rarity, /^(common|rare|epic|legendary)$/);
    assert.equal(typeof artifact.effect.type, 'string');
  }
});
```

- [ ] **Step 2: Verify the test fails**

Run: `cd backend && node --test expeditions/catalog.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement data-only catalog exports**

Export exact stable objects:

```js
const ROLES = Object.freeze({
  knight: { stat: 'might', bonus: 3, ability: 'shield_wall' },
  scout: { stat: 'agility', bonus: 3, ability: 'reveal_room' },
  mage: { stat: 'arcana', bonus: 3, ability: 'reroll' },
  cleric: { stat: 'spirit', bonus: 3, ability: 'blessing' },
});

const PROGRESS_BANDS = Object.freeze([
  { max: 5, progress: 0 },
  { max: 10, progress: 1 },
  { max: 15, progress: 2 },
  { max: 19, progress: 3 },
  { max: Infinity, progress: 5 },
]);

module.exports = {
  THEME_ID: 'root_king',
  DAILY_AP: 3,
  MAX_AP: 6,
  ROLES,
  PROVISIONS,
  ARTIFACTS,
  ROOM_TEMPLATES,
  PROGRESS_BANDS,
  RARITY_WEIGHTS,
};
```

Represent every artifact effect as structured data rather than parsing display text. Keep frontend JSON IDs, names, rarity, effects, and backend IDs identical.

- [ ] **Step 4: Run catalog tests**

Run: `node --test expeditions/catalog.test.mjs`

Expected: PASS with 54 artifacts and seven provisions.

- [ ] **Step 5: Commit catalog**

```bash
git add backend/expeditions/catalog.js backend/expeditions/catalog.test.mjs frontend/src/assets/expeditions/root-king/asset-catalog.json
git commit -m "feat: define expedition content catalog"
```

### Task 3: Generate Valid Procedural Maps

**Files:**
- Create: `backend/expeditions/generator.js`
- Create: `backend/expeditions/generator.test.mjs`

- [ ] **Step 1: Test determinism, reachability, and distribution**

```js
test('generator creates deterministic reachable root king maps', () => {
  const first = generateExpeditionMap('seed-123');
  const second = generateExpeditionMap('seed-123');
  assert.deepEqual(first, second);
  assert.equal(first.rooms[0].type, 'camp');
  assert.equal(first.rooms.at(-1).type, 'boss');
  assert.equal(isBossReachable(first), true);
  assert.equal(first.rooms.filter(room => room.optional).length >= 3, true);
  assert.deepEqual(
    new Set(first.rooms.flatMap(room => room.actions.map(action => action.stat))),
    new Set(['might', 'agility', 'arcana', 'spirit']),
  );
});
```

Add a loop over 500 seeds asserting 8-12 required rooms, 3-5 optional rooms, 1-2 treasure rooms, unique keys, no cycles, and reachable boss.

- [ ] **Step 2: Verify tests fail**

Run: `node --test expeditions/generator.test.mjs`

Expected: FAIL because generator exports are absent.

- [ ] **Step 3: Implement a seeded DAG generator**

Use a local deterministic PRNG and return serializable map data:

```js
function generateExpeditionMap(seed) {
  const rng = createSeededRandom(seed);
  const spineLength = randomInt(rng, 8, 12);
  const rooms = buildRequiredSpine(rng, spineLength);
  attachOptionalBranches(rng, rooms, randomInt(rng, 3, 5));
  appendBoss(rooms);
  enforceStatCoverage(rng, rooms);
  return { version: 1, seed: String(seed), themeId: THEME_ID, rooms };
}
```

The generator chooses only authored `ROOM_TEMPLATES`; it never synthesizes action rules at runtime.

- [ ] **Step 4: Run generator tests**

Run: `node --test expeditions/generator.test.mjs`

Expected: PASS for all seeds.

- [ ] **Step 5: Commit generator**

```bash
git add backend/expeditions/generator.js backend/expeditions/generator.test.mjs
git commit -m "feat: generate expedition dungeon maps"
```

### Task 4: Implement Artifact And Loot Engines

**Files:**
- Create: `backend/expeditions/artifactEffects.js`
- Create: `backend/expeditions/artifactEffects.test.mjs`
- Create: `backend/expeditions/loot.js`
- Create: `backend/expeditions/loot.test.mjs`

- [ ] **Step 1: Test effect phases and charge consumption**

```js
test('only equipped artifacts modify a roll and triggered charges are consumed', () => {
  const result = applyArtifactEffects({
    phase: 'before_roll',
    stat: 'agility',
    rawRoll: 12,
    roomTags: ['lock'],
    loadout: [{ artifactId: 'rusty_lockpick', charges: 2 }],
    inventoryOnly: ['endless_candle'],
  });
  assert.equal(result.modifier, 4);
  assert.equal(result.loadout[0].charges, 1);
  assert.deepEqual(result.triggered, ['rusty_lockpick']);
});
```

Add table-driven tests for all 54 artifact IDs, including no-op conditions, daily/expedition limits, duplicate prevention, and consumable removal.

- [ ] **Step 2: Test deterministic personal loot**

```js
test('permanent duplicate rerolls and charged duplicates stack', () => {
  const permanent = grantArtifact({ userId, artifactId: 'old_torch', rng });
  assert.notEqual(permanent.artifactId, 'old_torch');
  const charged = grantArtifact({ userId, artifactId: 'rusty_lockpick', rng });
  assert.equal(charged.addedCharges, ARTIFACTS.rusty_lockpick.initialCharges);
});
```

- [ ] **Step 3: Verify tests fail**

Run: `node --test expeditions/artifactEffects.test.mjs expeditions/loot.test.mjs`

Expected: FAIL because modules do not exist.

- [ ] **Step 4: Implement explicit effect hooks**

Use pure hooks with no database access:

```js
function applyArtifactEffects(context) {
  return context.loadout.reduce((state, slot) => {
    const artifact = ARTIFACTS[slot.artifactId];
    const handler = EFFECT_HANDLERS[artifact.effect.type];
    return handler ? handler(state, slot, artifact.effect) : state;
  }, createEffectState(context));
}
```

Use hooks `before_roll`, `after_roll`, `before_progress`, `after_progress`, `before_loot`, and `room_reveal`. Never execute effect code from JSON strings.

- [ ] **Step 5: Implement loot with injected RNG**

```js
function rollArtifactRarity(rng, table = RARITY_WEIGHTS) {
  const value = rng() * 100;
  if (value < table.legendary) return 'legendary';
  if (value < table.legendary + table.epic) return 'epic';
  if (value < table.legendary + table.epic + table.rare) return 'rare';
  return 'common';
}
```

Database grant functions run only inside a caller-provided transaction.

- [ ] **Step 6: Run focused tests**

Run: `node --test expeditions/artifactEffects.test.mjs expeditions/loot.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit effects and loot**

```bash
git add backend/expeditions/artifactEffects.js backend/expeditions/artifactEffects.test.mjs backend/expeditions/loot.js backend/expeditions/loot.test.mjs
git commit -m "feat: add expedition artifacts and loot"
```

### Task 5: Implement The Core Expedition Engine

**Files:**
- Create: `backend/expeditions/engine.js`
- Create: `backend/expeditions/engine.test.mjs`

- [ ] **Step 1: Write AP and d20 tests**

```js
test('lazy AP regeneration adds three per UTC day and caps at six', () => {
  assert.deepEqual(regenerateAp({ ap: 1, apRegenDay: 100 }, 102), {
    ap: 6,
    apRegenDay: 102,
  });
});

test('modified roll maps to the approved progress bands', () => {
  assert.equal(progressForRoll({ rawRoll: 1, modifiedRoll: 30 }), 0);
  assert.equal(progressForRoll({ rawRoll: 10, modifiedRoll: 10 }), 1);
  assert.equal(progressForRoll({ rawRoll: 15, modifiedRoll: 15 }), 2);
  assert.equal(progressForRoll({ rawRoll: 19, modifiedRoll: 19 }), 3);
  assert.equal(progressForRoll({ rawRoll: 20, modifiedRoll: 20 }), 5);
});
```

Add tests for role bonuses, role daily abilities, provisions, debuffs, support cap/consumption, room unlocks, three boss phases, solo completion, finish permissions, and no progress regression.

- [ ] **Step 2: Verify engine tests fail**

Run: `node --test expeditions/engine.test.mjs`

Expected: FAIL because engine module is missing.

- [ ] **Step 3: Implement pure rules before database orchestration**

Export:

```js
module.exports = {
  utcDayKey,
  regenerateAp,
  progressForRoll,
  buildRollModifiers,
  resolveAttempt,
  resolveAssist,
  unlockConnectedRooms,
  canFinishExpedition,
  prepareMemberLoadout,
  equipFoundArtifact,
};
```

`resolveAttempt` accepts injected `roll` and `rng`, returns a complete immutable result object, and never reads the database.

- [ ] **Step 4: Add transactional orchestration**

Create `createExpedition`, `prepareMember`, `attemptRoom`, `assistRoom`, `revealRoom`, `equipFoundArtifactForMember`, and `finishExpedition`. Every mutation receives `idempotencyKey` and returns a fresh serialized state.

- [ ] **Step 5: Run engine tests**

Run: `node --test expeditions/engine.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit engine**

```bash
git add backend/expeditions/engine.js backend/expeditions/engine.test.mjs
git commit -m "feat: implement expedition game engine"
```

### Task 6: Serialize State And Expose The API

**Files:**
- Create: `backend/expeditions/serializer.js`
- Create: `backend/routes/expeditions.js`
- Create: `backend/expeditions/routes.test.mjs`
- Modify: `backend/server.js`

- [ ] **Step 1: Test authentication and mutation contracts**

Test current-state behavior without a family, start authorization, preparation validation, stale-room `409`, idempotent duplicate attempts, former-member rejection, and founder/all-rooms finish rules.

```js
test('duplicate attempt returns the stored action without another AP spend', async () => {
  const first = await requestAttempt({ idempotencyKey: 'same-key' });
  const second = await requestAttempt({ idempotencyKey: 'same-key' });
  assert.equal(second.action.id, first.action.id);
  assert.equal(second.member.ap, first.member.ap);
});
```

- [ ] **Step 2: Verify route tests fail**

Run: `node --test expeditions/routes.test.mjs`

Expected: FAIL because route and serializer modules are absent.

- [ ] **Step 3: Implement serializer**

Return a stable camelCase response:

```js
{
  expedition,
  map: { rooms, edges },
  member,
  familyMembers,
  recentActions,
  artifactInventory,
  catalog: { roles, provisions, theme },
  permissions: { canStart, canPrepare, canFinish },
}
```

Do not expose hidden room payloads, future loot, RNG seeds used for rewards, other players' private inventories, or Telegram IDs.

- [ ] **Step 4: Implement authenticated routes**

Use the existing middleware pattern:

```js
router.use((req, res, next) => {
  const result = validateTelegramInit(req.headers['x-telegram-init-data']);
  if (!result.valid) return res.status(401).json({ error: result.error });
  req.telegramUser = result.user;
  next();
});
```

Implement every endpoint in the approved spec. Require `idempotencyKey` on mutations and return `400` when missing.

- [ ] **Step 5: Register routes**

```js
app.use('/api/expeditions', require('./routes/expeditions'));
```

- [ ] **Step 6: Run route and syntax tests**

Run: `node --check routes/expeditions.js && node --check expeditions/serializer.js && node --test expeditions/routes.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit API**

```bash
git add backend/expeditions/serializer.js backend/routes/expeditions.js backend/expeditions/routes.test.mjs backend/server.js
git commit -m "feat: expose family expedition api"
```

### Task 7: Add Expedition Notifications

**Files:**
- Modify: `backend/notifier.js`
- Modify: `backend/notificationSettings.js`
- Test: `backend/notificationSettings.test.mjs`
- Create: `backend/expeditions/notifications.test.mjs`

- [ ] **Step 1: Test one-shot readiness keys**

```js
test('expedition notification flags reset after state is acknowledged', () => {
  const keys = getExpeditionNotificationKeys({
    ap: 6,
    bossUnlocked: true,
    bossRewardAvailable: false,
    finished: false,
  });
  assert.deepEqual(keys, ['expedition_ap_full', 'expedition_boss_ready']);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --test expeditions/notifications.test.mjs notificationSettings.test.mjs`

Expected: FAIL because expedition notification helpers are absent.

- [ ] **Step 3: Implement notifier checks**

Only query prepared members with enabled settings. Send Telegram messages with the existing `Open Peeper` Web App button. Use distinct dedupe types:

```js
const EXPEDITION_NOTIFICATION_TYPES = [
  'expedition_ap_full',
  'expedition_boss_ready',
  'expedition_boss_reward',
  'expedition_finished',
];
```

Reset AP notification after AP falls below six, boss notification after boss state changes, reward notification after claim, and completion notification after archive.

- [ ] **Step 4: Run tests**

Run: `node --test expeditions/notifications.test.mjs notificationSettings.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit notifications**

```bash
git add backend/notifier.js backend/notificationSettings.js backend/notificationSettings.test.mjs backend/expeditions/notifications.test.mjs
git commit -m "feat: add expedition alerts"
```

### Task 8: Add Frontend API And Pure State Helpers

**Files:**
- Modify: `frontend/src/api.js`
- Create: `frontend/src/expeditions/expeditionState.mjs`
- Create: `frontend/src/expeditions/expeditionState.test.mjs`
- Create: `frontend/src/expeditions/expeditionCatalog.js`

- [ ] **Step 1: Test view-state helpers**

```js
test('expedition view selects preparation, map, and results states', () => {
  assert.equal(getExpeditionView({ expedition: null }), 'contracts');
  assert.equal(getExpeditionView({ expedition: { status: 'active' }, member: null }), 'prepare');
  assert.equal(getExpeditionView({ expedition: { status: 'active' }, member: {} }), 'map');
  assert.equal(getExpeditionView({ expedition: { status: 'boss_defeated' }, member: {} }), 'epilogue');
});
```

Test available actions, artifact slot locks, found-artifact insertion, AP labels, hidden room display, and modifier breakdown.

- [ ] **Step 2: Verify tests fail**

Run: `cd frontend && node --test src/expeditions/expeditionState.test.mjs`

Expected: FAIL because helpers are absent.

- [ ] **Step 3: Add API wrappers**

```js
export const getCurrentExpedition = () => get('/expeditions/current');
export const startExpedition = () => post('/expeditions/start', {});
export const prepareExpedition = (id, body) => post(`/expeditions/${id}/prepare`, body);
export const attemptExpeditionRoom = (id, roomKey, body) => post(`/expeditions/${id}/rooms/${roomKey}/attempt`, body);
export const assistExpeditionRoom = (id, roomKey, body) => post(`/expeditions/${id}/rooms/${roomKey}/assist`, body);
export const revealExpeditionRoom = (id, roomKey, body) => post(`/expeditions/${id}/rooms/${roomKey}/reveal`, body);
export const equipFoundExpeditionArtifact = (id, body) => post(`/expeditions/${id}/equip-found-artifact`, body);
export const finishExpedition = (id, body) => post(`/expeditions/${id}/finish`, body);
export const getExpeditionHistory = () => get('/expeditions/history');
export const getExpeditionArtifacts = () => get('/expeditions/artifacts');
```

- [ ] **Step 4: Implement helpers and asset manifest**

Use `new URL('../assets/...', import.meta.url).href` or static imports for the 100 approved assets. Export asset lookup functions that return safe fallbacks.

- [ ] **Step 5: Run frontend tests**

Run: `node --test src/expeditions/expeditionState.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit frontend foundation**

```bash
git add frontend/src/api.js frontend/src/expeditions/expeditionState.mjs frontend/src/expeditions/expeditionState.test.mjs frontend/src/expeditions/expeditionCatalog.js frontend/src/assets/expeditions/root-king
git commit -m "feat: add expedition frontend foundation"
```

### Task 9: Integrate The Expedition Feature Shell

**Files:**
- Create: `frontend/src/expeditions/ExpeditionTab.jsx`
- Create: `frontend/src/expeditions/ExpeditionContractBoard.jsx`
- Modify: `frontend/src/screens/FamilyScreen.jsx`

- [ ] **Step 1: Add a lazy Expedition tab**

```jsx
const ExpeditionTab = lazy(() => import('../expeditions/ExpeditionTab'));

{activeTab === 'expedition' && (
  <Suspense fallback={<div className="expedition-loading">Entering dungeon...</div>}>
    <ExpeditionTab family={family} currentUser={user} />
  </Suspense>
)}
```

Add the tab beside Members and Chat without changing existing family behavior.

- [ ] **Step 2: Implement feature controller**

`ExpeditionTab` loads current state, polls every ten seconds only while visible, aborts on unmount, exposes a shared mutation runner, and maps snapshots through `getExpeditionView`.

```jsx
const mutate = async (operation) => {
  if (pending) return;
  setPending(true);
  try {
    const next = await operation();
    setSnapshot(next);
  } catch (error) {
    showToast(error.message || 'Expedition action failed');
    if (error.status === 409) await reload();
  } finally {
    setPending(false);
  }
};
```

- [ ] **Step 3: Build contract board**

Use `crypt_gate.webp` as hero art. Show estimated solo/group duration, AP rules, reward range, artifact Vault entry, history entry, and `Begin Expedition` confirmation.

- [ ] **Step 4: Run build**

Run: `cd frontend && npm.cmd run build`

Expected: PASS and expedition code emitted as a lazy chunk.

- [ ] **Step 5: Commit shell**

```bash
git add frontend/src/expeditions/ExpeditionTab.jsx frontend/src/expeditions/ExpeditionContractBoard.jsx frontend/src/screens/FamilyScreen.jsx
git commit -m "feat: add expedition family tab"
```

### Task 10: Build Preparation And Artifact Vault

**Files:**
- Create: `frontend/src/expeditions/ExpeditionPreparation.jsx`
- Create: `frontend/src/expeditions/ExpeditionVault.jsx`
- Modify: `frontend/src/expeditions/ExpeditionTab.jsx`
- Modify: `frontend/src/expeditions/expedition.css`

- [ ] **Step 1: Build preparation state validation**

Role is required. Artifact slots accept at most three unique permanent artifacts or valid charged stacks. Provision is optional. Confirmation sends:

```js
{
  role,
  artifactIds: slots.filter(Boolean),
  provisionId: selectedProvision || null,
}
```

Show exact farm ingredient availability and disable only unavailable provision recipes.

- [ ] **Step 2: Build Vault grid and details panel**

Use rarity filter tiles, charge count, equipped marker, effect copy, and `64-128px` icon display. Do not render rarity frames from raster files; apply CSS borders by rarity.

- [ ] **Step 3: Add responsive styling**

At `320px`, role cards use a 2x2 grid, artifact slots remain one row of three square cells, and provision cards use a single compact column. Keep all confirm controls inside safe-area padding.

- [ ] **Step 4: Run frontend tests and build**

Run: `node --test src/expeditions/expeditionState.test.mjs && npm.cmd run build`

Expected: PASS.

- [ ] **Step 5: Commit preparation UI**

```bash
git add frontend/src/expeditions/ExpeditionPreparation.jsx frontend/src/expeditions/ExpeditionVault.jsx frontend/src/expeditions/ExpeditionTab.jsx frontend/src/expeditions/expedition.css
git commit -m "feat: add expedition preparation and vault"
```

### Task 11: Build The Procedural Node-Map

**Files:**
- Create: `frontend/src/expeditions/ExpeditionMap.jsx`
- Modify: `frontend/src/expeditions/ExpeditionTab.jsx`
- Modify: `frontend/src/expeditions/expedition.css`

- [ ] **Step 1: Render deterministic room positions**

Lay out each depth row from serialized map coordinates. Use an absolute SVG underneath nodes for edges:

```jsx
<svg className="expedition-map-edges" aria-hidden="true">
  {edges.map(edge => (
    <path key={`${edge.from}:${edge.to}`} d={edge.path} className={edge.state} />
  ))}
</svg>
```

Hidden nodes render fog silhouettes without leaked type or payload. Available nodes are keyboard/touch buttons. Cleared nodes display family seal and contribution portraits.

- [ ] **Step 2: Add map status rail**

Show current AP, role, three artifact slots, family progress, and Artifact Vault button. Use a sticky compact rail that does not cover nodes.

- [ ] **Step 3: Add focus and reconnect behavior**

On first load, center the shallowest available node. Preserve manual scroll during polling. If the selected room becomes cleared remotely, refresh and keep it readable rather than forcing a modal close without explanation.

- [ ] **Step 4: Build at mobile widths**

Run: `npm.cmd run build`

Expected: PASS with no CSS overflow warnings.

- [ ] **Step 5: Commit node-map**

```bash
git add frontend/src/expeditions/ExpeditionMap.jsx frontend/src/expeditions/ExpeditionTab.jsx frontend/src/expeditions/expedition.css
git commit -m "feat: add expedition dungeon map"
```

### Task 12: Build Room Actions And d20 Results

**Files:**
- Create: `frontend/src/expeditions/ExpeditionRoom.jsx`
- Create: `frontend/src/expeditions/ExpeditionRollOverlay.jsx`
- Modify: `frontend/src/expeditions/ExpeditionTab.jsx`
- Modify: `frontend/src/expeditions/expedition.css`

- [ ] **Step 1: Build room encounter composition**

Use room background as the base, selected enemy/trap/shrine as a separate transparent layer, and current `PeeperSprite` as the player layer. Never flatten characters into room backgrounds.

Show room title, progress, family support, recent actors, action cards, Assist, role ability, and AP cost. Difficulty labels must come from server data.

- [ ] **Step 2: Send idempotent actions**

Generate one UUID per tap and keep it stable across network retry:

```js
const idempotencyKey = crypto.randomUUID();
await api.attemptExpeditionRoom(expedition.id, room.roomKey, {
  actionId,
  useSupport,
  useRoleAbility,
  idempotencyKey,
});
```

- [ ] **Step 3: Build d20 overlay**

Animate anticipation, reveal raw roll, then modifier rows and progress. Natural 20 gets an emerald-gold burst; natural 1 uses a restrained shake. Respect `prefers-reduced-motion`.

- [ ] **Step 4: Implement empty-slot found artifact flow**

When loot includes an artifact and an empty slot exists, offer `Equip for this expedition` before dismissing results. Call `equip-found-artifact`; never offer home inventory substitutions.

- [ ] **Step 5: Run tests and build**

Run: `node --test src/expeditions/expeditionState.test.mjs && npm.cmd run build`

Expected: PASS.

- [ ] **Step 6: Commit encounters**

```bash
git add frontend/src/expeditions/ExpeditionRoom.jsx frontend/src/expeditions/ExpeditionRollOverlay.jsx frontend/src/expeditions/ExpeditionTab.jsx frontend/src/expeditions/expedition.css
git commit -m "feat: add expedition encounters and dice"
```

### Task 13: Add Boss, Results, And History

**Files:**
- Create: `frontend/src/expeditions/ExpeditionResults.jsx`
- Create: `frontend/src/expeditions/ExpeditionHistory.jsx`
- Modify: `frontend/src/expeditions/ExpeditionRoom.jsx`
- Modify: `frontend/src/expeditions/ExpeditionTab.jsx`
- Modify: `frontend/src/expeditions/expedition.css`

- [ ] **Step 1: Render all three boss phases**

Map phase state to `root_king_phase_1.png`, `root_king_phase_2.png`, and `root_king_phase_3.png`. Replace art only after the server confirms a phase transition.

- [ ] **Step 2: Add personal boss chest**

Eligible players see a claim state with the server-provided chest rarity. Ineligible players see their exact `contributionAp / 3` requirement until the boss is defeated, then a clear ineligible label.

- [ ] **Step 3: Build expedition epilogue**

Show family totals, each member's AP and progress, notable artifacts, uncleared optional room count, founder finish control, and all-rooms finish control. Do not rank members as losers.

- [ ] **Step 4: Build history cards**

History shows theme, completion date, rooms cleared, duration, participating members, and notable loot from archived `summary_json` without loading full action history.

- [ ] **Step 5: Run build**

Run: `npm.cmd run build`

Expected: PASS.

- [ ] **Step 6: Commit boss and results**

```bash
git add frontend/src/expeditions/ExpeditionResults.jsx frontend/src/expeditions/ExpeditionHistory.jsx frontend/src/expeditions/ExpeditionRoom.jsx frontend/src/expeditions/ExpeditionTab.jsx frontend/src/expeditions/expedition.css
git commit -m "feat: complete expedition boss and history"
```

### Task 14: Add Badges, Loading, And Performance Boundaries

**Files:**
- Modify: `backend/routes/family.js`
- Modify: `frontend/src/screens/FamilyScreen.jsx`
- Modify: `frontend/src/expeditions/ExpeditionTab.jsx`
- Modify: `frontend/src/expeditions/expedition.css`

- [ ] **Step 1: Extend family response with expedition summary**

Return only:

```js
expeditionSummary: {
  active: true,
  apFull: false,
  bossReady: false,
  rewardWaiting: false,
  status: 'active',
}
```

Do not serialize map data through `/api/family/me`.

- [ ] **Step 2: Add tab badge and asset loading states**

Badge priority is reward, boss, AP. Decode the selected room background and encounter sprite before fading out the loading skeleton. Failed assets use a styled room fallback and retry button.

- [ ] **Step 3: Pause unrelated refresh work**

Use the existing app gameplay-active boundary while Expedition Room or Map is open. Poll expedition state every ten seconds and stop polling when the app is hidden.

- [ ] **Step 4: Check bundle and asset budgets**

Run: `npm.cmd run build`

Expected: expedition JS is lazy, initial app bundle does not include every room image, and production assets remain under the approved pack size.

- [ ] **Step 5: Commit integration polish**

```bash
git add backend/routes/family.js frontend/src/screens/FamilyScreen.jsx frontend/src/expeditions/ExpeditionTab.jsx frontend/src/expeditions/expedition.css
git commit -m "feat: polish expedition integration"
```

### Task 15: Full Verification And Mobile Playtest

**Files:**
- Modify only files required by failures found during verification.

- [ ] **Step 1: Run backend syntax checks**

```powershell
node --check backend\database.js
node --check backend\routes\expeditions.js
Get-ChildItem backend\expeditions -Filter '*.js' | ForEach-Object { node --check $_.FullName }
```

Expected: all exit zero.

- [ ] **Step 2: Run all backend tests**

```powershell
$tests = Get-ChildItem backend -Recurse -Filter '*.test.mjs' | ForEach-Object { $_.FullName }
node --test $tests
```

Expected: all existing and expedition tests pass.

- [ ] **Step 3: Run all frontend tests and build**

```powershell
$tests = Get-ChildItem frontend\src -Recurse -Filter '*.test.mjs' | ForEach-Object { $_.FullName }
node --test $tests
cd frontend
npm.cmd run build
```

Expected: all tests pass and Vite build succeeds.

- [ ] **Step 4: Seed two dev users and playtest**

Use two browser sessions with distinct `devUser` parameters. Verify preparation, role duplicates, asynchronous support, concurrent room completion, artifact drops, empty-slot equip, AP cap, all boss phases, optional cleanup, finish permissions, history, and reconnect.

- [ ] **Step 5: Verify smallest mobile viewport**

Playtest at `320x568`, a modern iPhone viewport, and Android Telegram-like viewport. Confirm no horizontal overflow, hidden controls, safe-area collision, unreadable artifact icons, or persistent overlay after action completion.

- [ ] **Step 6: Run final repository checks**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only intentional tracked changes.

- [ ] **Step 7: Commit verification fixes**

```bash
git add -u
git commit -m "fix: harden family expeditions release"
```

Do not create an empty commit when verification requires no code changes.
