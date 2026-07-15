# Family Expeditions Design

## Objective

Add a production-quality asynchronous family dungeon crawler to Peeper. A family explores one procedurally generated dungeon at a time. Every member can contribute when convenient, while a one-person family remains able to finish every expedition without failure.

The first complete content season is **Crypt of the Root King**. It ships with a full room set, enemies, a three-phase boss, provisions, four roles, 54 personal artifacts, procedural maps, progression, rewards, history, notifications, and mobile-first UI.

## Product Principles

1. Expeditions never fail permanently and never expire before completion.
2. More active family members make progress faster, but do not unlock exclusive mechanical access.
3. All gameplay is asynchronous. No member must wait for another member to come online.
4. Shared progress and support create cooperation; coins and artifacts remain personal.
5. Expedition power never affects Arena, Blackjack, other mini-games, pet survival, or the general economy outside explicitly awarded coins.
6. Every state-changing action is server-authoritative, transactional, and idempotent.
7. The complete first release is not a prototype: all roles, room types, artifacts, preparation, history, notifications, and responsive states ship together.

## Entry Point

Family Screen gains a permanent `Expedition` tab. The tab displays one of four states:

- no family: existing family onboarding remains unchanged;
- no active expedition: contract board and Artifact Vault;
- active expedition, player not prepared: preparation screen;
- active expedition, player prepared: node-map and current progress;
- completed boss: epilogue, optional cleanup, results, and finish controls.

Home may show a compact expedition notification badge when AP is full, the boss is unlocked, or a personal reward is waiting. The full feature remains owned by Family Screen.

## Expedition Lifecycle

Only one expedition may be active per family.

1. Any current family member may start an expedition when none is active.
2. The server generates and persists the complete map from a random seed.
3. Each family member prepares independently the first time they enter.
4. Prepared members spend personal AP on available rooms.
5. Cleared rooms unlock connected rooms until the boss becomes available.
6. Defeating the boss changes the expedition to `boss_defeated` but does not immediately close optional rooms.
7. The founder may finish the expedition at any point after the boss. Any member may finish it after every reachable optional room is cleared.
8. Finishing archives the map and contribution summary, distributes unclaimed final rewards, and allows a new contract.

An expedition has no failure state and no pre-boss deadline. Leaving the family immediately prevents further actions in that family's expedition, but already earned personal loot remains owned by the player. A player joining a family during an active expedition may prepare and participate normally.

## Daily Action Points

- Each prepared member regenerates `3 AP` at `00:00 UTC`.
- AP is stored up to a maximum of `6`.
- Preparation grants the current regenerated balance, never bonus AP.
- One room attempt costs `1 AP`.
- One Assist action costs `1 AP`.
- The server lazily applies missed daily regeneration before every read or action.
- AP cannot be bought with coins or Telegram Stars.

A standard dungeon requires approximately `45-60` total progress. Expected completion time is `7-10 days` for one active member, `3-4 days` for three active members, and about one day for ten highly active members.

## Roles

Roles are selected during preparation, allow duplicates, and remain fixed until the expedition is finished.

### Knight

- Primary stat: `Might`, `+3` to matching checks.
- Daily ability: `Shield Wall` converts one zero-progress result into `+1 progress`.

### Scout

- Primary stat: `Agility`, `+3` to matching checks.
- Daily ability: reveal one connected hidden room and its category.

### Mage

- Primary stat: `Arcana`, `+3` to matching checks.
- Daily ability: reroll one personal roll and keep the better result.

### Cleric

- Primary stat: `Spirit`, `+3` to matching checks.
- Daily ability: leave a `+3` blessing for the next chosen family roll in a room.

Any role can attempt any action. A mixed family is more efficient, but no composition is required. Roles are represented by a badge and aura; they never replace the player's real outfit.

## Preparation

Preparation is personal and may happen after the family expedition has already started.

The player confirms:

- one role;
- zero to three artifacts from personal inventory;
- zero or one optional farm provision.

The role and selected home artifacts become locked for the expedition. A player may intentionally start with empty artifact slots.

If an artifact slot was empty at preparation or becomes empty after a consumable is exhausted, the player may equip an artifact found during the current expedition. Home inventory artifacts cannot be inserted or swapped after preparation. Equipping a newly found artifact locks it into that slot for the remainder of the expedition unless it is consumed.

## Provisions

Provisions are optional recipes made from the player's own farm inventory. They are consumed when preparation is confirmed and cannot make an expedition impossible when absent.

| Provision | Recipe | Expedition Effect |
|---|---:|---|
| Carrot Rations | 20 Carrot | Gain `+1 AP` after preparation |
| Tomato Soup | 12 Tomato | Remove the first received debuff |
| Hearty Potato Meal | 10 Potato | First zero-progress attempt grants `+1 progress` |
| Lucky Breakfast | 10 Egg | `+2` to the first d20 roll |
| Warm Milk | 8 Milk | Restore one spent role ability in a Camp room |
| Truffle Treat | 3 Truffle | Improve one personal loot roll by one tier |
| Magic Squash Pie | 1 Magic Squash | Once, raise a modified roll below 10 to 10 |

An unused provision expires when the expedition is archived. It is not returned.

## Procedural Node-Map

The generator creates a deterministic directed acyclic graph from the expedition seed.

A standard map contains:

- one starting Camp;
- `8-12` required rooms;
- `3-5` optional rooms;
- `1-2` Treasure rooms;
- at least one room favoring every stat;
- one three-phase boss;
- no dead path that prevents boss access.

Room states are:

`hidden -> revealed -> available -> in_progress -> cleared`

Completing a room unlocks connected rooms. Choosing one branch never permanently closes another branch. Optional rooms remain playable after the boss until the expedition is finished.

The map UI is a vertically scrolling illustrated node-map. SVG renders corridors, fog, selection states, and rarity treatments. Raster assets render room thumbnails and encounters. The current available region centers automatically on open.

## Room Types

### Combat

Monsters use a shared progress bar. Available actions target Might, Agility, Arcana, or Spirit depending on the enemy. Combat does not modify the home Peeper's HP.

### Trap

Examples include spikes, darts, falling stone, poison mechanisms, and runes. Agility is usually efficient, while Might, Arcana, or Spirit provide alternate approaches.

### Arcane

Runes, seals, cursed objects, and magical mechanisms. Arcana is efficient; other stats receive context-specific alternate actions.

### Exploration

Collapsed halls, hidden doors, blocked tunnels, and navigation challenges. Agility and Might are common, but every room exposes at least two approaches.

### Treasure

Optional rooms that award personal coins and artifact rolls. Mimics and trapped chests may add progress stages but never destroy earned loot.

### Shrine

Awards a shared temporary expedition blessing after clearing its check. Blessings affect one defined stat or room category and are stored server-side.

### Camp

Provides preparation information, expedition log access, and defined recovery effects. Camp never allows switching home artifacts or roles.

### Mystery

Short authored events with two or three choices. Choices change modifiers, room progress, buffs, debuffs, or personal loot; they cannot fail the expedition.

### Boss

A three-phase shared encounter described below.

## Room Actions And d20

Each available room exposes two to four authored actions. An action defines:

- stat;
- short label and description;
- difficulty modifier;
- applicable artifact tags;
- result narration table;
- progress target;
- possible complication;
- personal loot table.

The authoritative formula is:

`modified = d20 + role bonus + artifact bonuses + selected support + buffs - debuffs - difficulty`

Natural 20 is always a critical unless an explicit artifact changes the critical range. Natural 1 produces zero progress unless protected by a role, provision, or artifact.

Progress bands use the modified result:

| Modified Result | Progress |
|---:|---:|
| 5 or lower | 0 |
| 6-10 | 1 |
| 11-15 | 2 |
| 16-19 | 3 |
| 20+ or critical | 5 plus a bonus loot roll |

Difficulty is communicated as `Easy`, `Risky`, or `Hard`; exact final odds are not shown. The result overlay shows raw roll, every modifier, final result, progress, triggered artifacts, rewards, and narration.

## Assist

Instead of rolling, a player may spend `1 AP` to add `+2 support` to an available room.

- A room stores at most `+6 support`.
- The rolling player explicitly chooses whether to consume stored support.
- Consumed support is removed transactionally with the roll.
- Cleric blessing is separate from normal support and may stack with it.
- Assist counts toward personal expedition contribution but does not directly award room loot.

## Debuffs And Complications

Expedition debuffs affect expedition actions only and normally expire after one personal action.

- `Frightened`: `-2` to the next roll.
- `Cursed`: equipped artifacts are disabled for one action.
- `Exhausted`: the next Assist contributes only `+1`.
- `Blinded`: the next action does not show its difficulty label.

Complications may apply a debuff, consume an applicable charge, reveal an extra obstacle, or grant zero progress. They never remove cleared progress, remove owned artifacts without an explicit consumable trigger, damage home stats, or end the expedition.

## Boss Design

The first boss is **The Root King**, with three persisted phases and separate art.

### Phase 1: Break The Armor

Might is efficient. Agility finds weak points, Arcana disrupts runes, and Spirit protects the party from retaliation.

### Phase 2: Survive The Roots

Agility and Spirit are efficient. Failed actions may add one-action debuffs.

### Phase 3: Final Strike

All stats have equally viable actions. Critical rolls receive an additional boss loot roll.

Boss progress never regresses. Phase completion persists and changes the encounter illustration. Defeating phase three unlocks one personal boss chest for every player who contributed at least `3 AP` during the expedition.

## Artifact Inventory

Artifacts are personal, cannot be traded, gifted, sold, or borrowed by family members, and function only in Expeditions.

Rarities and base drop weights are:

- Common: `65%`;
- Rare: `25%`;
- Epic: `8%`;
- Legendary: `2%`.

Elite encounters and bosses use improved tables. The first season contains 54 artifacts defined by `frontend/src/assets/expeditions/root-king/asset-catalog.json`.

Artifact behavior categories:

- permanent passive while equipped;
- limited charges consumed only when triggered;
- one-use consumable removed after activation;
- cursed artifact with a benefit and explicit drawback.

Permanent artifacts do not duplicate. If a drop selects an already owned permanent artifact, the server rerolls among missing artifacts of that rarity; if none remain, it awards a rarity-scaled coin substitute. Charged and consumable artifacts stack charges or quantity.

The Artifact Vault supports rarity filters, effect text, charge counts, equipped state, source history, and three preparation slots.

## Personal Rewards

Shared room progress does not create shared loot ownership.

- A player must spend AP in a room to become eligible for that room's personal rewards.
- A successful roll may award a small coin amount.
- Treasure and elite rooms add personal artifact rolls.
- Natural 20 adds a personal bonus roll.
- Boss chest requires at least `3 AP` contribution to the expedition.
- Inactive family members receive no coins or artifacts.

Target reward for a standard expedition is approximately `70-130 coins` and `1-3 artifacts` per meaningfully active participant. Loot configuration is data-driven and tested against current farm and mini-game income.

## Expedition Log And Social Feedback

Every action creates an expedition log entry with actor, room, role, roll, modifiers, progress, support, and notable loot.

The map displays recent participant portraits around rooms. The results screen shows contribution without ranking family members as winners or losers.

Family chat only receives high-signal system messages:

- Epic or Legendary artifact found;
- boss unlocked;
- boss defeated;
- expedition archived.

Normal rolls remain in the dedicated expedition log.

## Notifications

Add `expedition_notifications` to notification settings, enabled by default. Telegram and in-app notifications cover:

- AP reached the cap;
- boss unlocked;
- personal boss chest available;
- expedition finished.

Notifications are one-shot and reset when their underlying state changes. `/settings` exposes `Expedition alerts`.

## Visual Direction

The tone is 70% serious dark Dungeons & Dragons and 30% restrained Peeper dark fantasy. Production art uses broad forms, clean silhouettes, limited shading, low micro-detail, and readable mobile scale.

The first pack already contains 100 normalized assets under:

`frontend/src/assets/expeditions/root-king/`

- 8 room backgrounds in WebP;
- 12 transparent enemy sprites;
- 3 transparent boss phases;
- 54 transparent artifact icons;
- 7 transparent provision icons;
- 4 role icons;
- 4 chest sprites;
- 4 trap sprites;
- 4 shrine sprites.

Room backgrounds load at `1024x768`. Enemy and interaction sprites use normalized transparent PNG canvases. Artifact, role, and provision icons remain readable at `64-128px`. Chroma-key source files remain outside the production tree.

Map lines, fog masks, badges, rarity frames, progress bars, dice effects, particles, and selection states use SVG/CSS rather than additional raster images.

## Frontend Architecture

Create a focused feature directory rather than extending `FamilyScreen.jsx` into a monolith:

```text
frontend/src/expeditions/
  ExpeditionTab.jsx
  ExpeditionPreparation.jsx
  ExpeditionMap.jsx
  ExpeditionRoom.jsx
  ExpeditionRollOverlay.jsx
  ExpeditionVault.jsx
  ExpeditionHistory.jsx
  ExpeditionResults.jsx
  expeditionCatalog.js
  expeditionState.js
  expeditionEffects.js
  expedition.css
```

React owns UI state and server snapshots. Gameplay rules remain pure helpers mirrored by authoritative backend helpers. The feature lazy-loads from Family Screen. Room art loads only when needed, and map thumbnails use the existing optimized room assets.

While Expedition UI is open, Home timers and unrelated polling remain paused using the same gameplay pause boundary as existing games.

## Backend Architecture

Create isolated modules:

```text
backend/expeditions/
  catalog.js
  generator.js
  engine.js
  artifactEffects.js
  loot.js
  serializer.js
backend/routes/expeditions.js
```

The renderer never owns authoritative AP, progress, rolls, loot, support, or loadout state.

## Database Schema

### family_expeditions

- `id`
- `family_id`
- `theme_id`
- `seed`
- `status`: active, boss_defeated, finished
- `map_json`
- `shared_buffs_json`
- `started_by`
- `started_at`
- `boss_defeated_at`
- `finished_at`

Enforce one unfinished expedition per family with application-level transactional checks.

### family_expedition_rooms

- `id`
- `expedition_id`
- `room_key`
- `room_type`
- `state`
- `progress`
- `progress_target`
- `support`
- `payload_json`
- `unlocked_at`
- `cleared_at`

Unique key: `(expedition_id, room_key)`.

### family_expedition_members

- `expedition_id`
- `user_id`
- `role`
- `ap`
- `ap_regen_day`
- `role_ability_day`
- `role_ability_used`
- `provision_id`
- `provision_state_json`
- `loadout_json`
- `debuff_json`
- `contribution_ap`
- `contribution_progress`
- `prepared_at`
- `boss_reward_claimed_at`

Primary key: `(expedition_id, user_id)`.

### expedition_artifact_inventory

- `user_id`
- `artifact_id`
- `quantity`
- `charges`
- `first_acquired_at`
- `last_acquired_at`

Primary key: `(user_id, artifact_id)`.

### family_expedition_actions

- `id`
- `idempotency_key`
- `expedition_id`
- `room_id`
- `user_id`
- `action_type`
- `stat`
- `raw_roll`
- `modifier_json`
- `modified_roll`
- `progress_awarded`
- `loot_json`
- `narration_key`
- `created_at`

Unique key: `(user_id, idempotency_key)`.

### family_expedition_history

- `id`
- `expedition_id`
- `family_id`
- `summary_json`
- `finished_at`

## Public API

- `GET /api/expeditions/current`
- `POST /api/expeditions/start`
- `POST /api/expeditions/:id/prepare`
- `POST /api/expeditions/:id/rooms/:roomKey/attempt`
- `POST /api/expeditions/:id/rooms/:roomKey/assist`
- `POST /api/expeditions/:id/rooms/:roomKey/reveal`
- `POST /api/expeditions/:id/equip-found-artifact`
- `POST /api/expeditions/:id/finish`
- `GET /api/expeditions/:id/log`
- `GET /api/expeditions/history`
- `GET /api/expeditions/artifacts`

Every mutation accepts an `idempotencyKey`. Authentication uses the existing Telegram middleware. Every route verifies current family membership, expedition ownership, room availability, AP, loadout state, and artifact ownership.

## Concurrency And Error Handling

All action resolution runs in a single `better-sqlite3` transaction:

1. apply lazy AP regeneration;
2. verify membership and active expedition;
3. check idempotency key;
4. verify room remains available;
5. verify AP and selected effects;
6. generate the server-side cryptographic roll;
7. apply support, artifacts, provision, buffs, and debuffs;
8. update progress and unlock rooms;
9. grant personal loot;
10. append immutable action log;
11. return a fresh serialized snapshot.

If another player clears the room first, the stale action returns `409 Room already cleared` without spending AP. Duplicate requests return the previously stored result. Client buttons lock while a mutation is pending.

The asynchronous feature does not require WebSockets. While open, the client polls the current snapshot every 10 seconds and immediately refreshes after local actions. Server notifications cover meaningful changes while closed.

## Mobile UX Requirements

- All primary actions fit at widths down to `320px`.
- The map scrolls vertically; no horizontal page overflow is allowed.
- Room action cards use compact rectangular tiles, not large cloud panels.
- A roll result never pushes the main action button below the viewport; it overlays the room and collapses afterward.
- Safe-area insets are applied to top navigation and bottom actions.
- Reduced-motion mode replaces dice spin and parallax with fades.
- Text maintains the current dark-theme contrast standard.
- Raster assets are lazy-loaded and decoded before reveal transitions.

## Testing

### Backend Unit Tests

- deterministic valid map generation across many seeds;
- required room distribution and reachable boss;
- AP regeneration and cap;
- role bonus and daily ability behavior;
- every d20 progress band;
- natural 1 and natural 20 rules;
- support storage, selection, cap, and consumption;
- provision consumption and effects;
- all 54 artifact effects and charge behavior;
- duplicate permanent artifact reroll;
- loot rarity distribution with deterministic RNG;
- three boss phases;
- no action can reduce cleared progress or fail an expedition;
- solo completion remains possible;
- idempotent duplicate mutation;
- simultaneous room completion does not double-spend AP or rewards;
- former family member cannot act;
- boss reward contribution threshold.

### Frontend Unit Tests

- serializer/state reducer behavior;
- action availability;
- loadout locking and found-artifact slot rules;
- AP countdown and cap display;
- map node state classes;
- result modifier breakdown;
- responsive helper calculations.

### Integration And Manual QA

- one-player family completes a seeded expedition;
- multiple dev users contribute asynchronously;
- refresh/reconnect from every screen;
- concurrent actions against one nearly cleared room;
- Telegram notification toggles;
- 320px Android and iOS safe-area layout;
- slow-network asset loading and retry;
- production build and existing backend suites remain green.

## Release Scope

The first release includes the complete Crypt of the Root King system described above. It does not include real-time movement, artifact trading, paid AP, permanent character classes, cross-family raids, PvP expedition combat, or a second dungeon theme. Those are separate future expansions and are not required for this build to be considered complete.
