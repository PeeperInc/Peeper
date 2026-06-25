# Family Expeditions Flagship Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Family Expeditions into a mobile-first dark fantasy dungeon crawler with one clear d20 roll per room, room-specific mini-mechanics, preparation slots, boss phases, and active artifacts as meaningful decisions. Solo families must always be able to finish slowly; active families finish faster and get better moments.

**Architecture:** Keep the existing expedition backend route family and SQLite storage, but evolve room state into encounter state: progress, threat, mini-mechanic choice/state, opening, preparation effects, boss phase state, and active artifact usage. Frontend becomes a full-screen expedition game surface with room-first presentation, overlays for map/vault/guide, animated roll resolution, and a single sticky roll CTA.

**Tech Stack:** Node/Express + better-sqlite3 backend, React/Vite frontend, CSS animations, existing PNG/WebP dungeon assets, existing family/user economy systems.

---

## Phase 0: Safety And Current-State Audit

- [ ] Inspect current expedition schema, migration helpers, route handlers, engine tests, and current dirty UI changes.
- [ ] Confirm whether the existing interim `FamilyExpeditionTab` patch should be kept as the visual base or replaced during this implementation.
- [ ] Add/keep focused regression tests for the already fixed loot bug: room rewards only grant when the room is actually cleared.
- [ ] Do not touch unrelated tracked deletions (`README.md`, `README_OWNER.md`) unless the user explicitly approves.

## Phase 1: AP Regeneration And Encounter Data Model

- [ ] Change expedition AP rules to `MAX_AP = 5` and `+1 AP every 3 hours`.
- [ ] Replace daily refill-only logic with timestamp-based regeneration while preserving any legacy day-key fields for backward compatibility if needed.
- [ ] Add tests for AP regen: no over-cap, partial intervals do not grant AP, multiple intervals grant multiple AP, cap stops at 5.
- [ ] Extend room template/catalog shape with encounter fields:
  - `encounterType`: `combat | trap | treasure | shrine | puzzle | boss`
  - `enemyId` or `objectId`
  - `weakRoles`
  - `enemyIntent`
  - `threatMax`
  - `miniMechanic`
  - `bossPhase`
  - reward metadata
- [ ] Ensure serializers expose these fields safely to frontend without leaking hidden room data.

## Phase 2: One-Roll Resolution Engine

- [ ] Replace multi-action room resolution with one primary `Roll d20 as <role>` path.
- [ ] Implement shared roll bands:
  - `1`: setback, no progress, threat increase.
  - `2-5`: no progress, small threat increase.
  - `6-10`: small progress.
  - `11-15`: medium progress.
  - `16-19`: strong progress plus room/role effect.
  - `20`: critical progress, cinematic reward chance, stronger effect.
- [ ] Keep no-hard-fail rule: every role can progress every room, but weak-role matches get speed/utility bonuses.
- [ ] Implement threat as pressure, not failure:
  - threat can apply temporary `Guarded`, `Cursed`, `Hidden`, `Shielded`, or `Enraged` room state.
  - threat never bricks the expedition.
- [ ] Add tests for wrong-role solo progress, correct-role bonus, threat growth, threat decay on room clear, and idempotent attempt replay.

## Phase 3: Room Mini-Mechanics

- [ ] Add mini-mechanic state and request payload support to the attempt endpoint.
- [ ] Implement `combat` rooms:
  - show enemy intent.
  - weak role adds bonus effect.
  - any role can finish.
- [ ] Implement `trap` rooms:
  - room choice before roll: `Safe Path`, `Fast Path`, `Greedy Path`.
  - safe reduces threat risk.
  - fast increases progress variance.
  - greedy improves clear reward but punishes low rolls with threat.
- [ ] Implement `treasure/mimic` rooms:
  - one visible tell/guess choice before roll.
  - correct read gives progress/chest bonus.
  - wrong read never fails the room, but removes bonus or adds threat.
- [ ] Implement `shrine` rooms:
  - choose one family blessing before roll.
  - examples: next roll bonus, restore 1 AP to lowest AP member, reduce threat in Rally Room.
  - roll controls blessing strength.
- [ ] Implement `puzzle` rooms:
  - rolls reveal symbols/clues.
  - matching role may reveal extra clue.
  - progress still accumulates for solo completion.
- [ ] Add backend tests for each mini-mechanic path.

## Phase 4: Preparation Slots

- [ ] Add per-member preparation charge state with `1 prep charge`, refreshing every `6 hours`.
- [ ] Add an endpoint for using prep on a room without spending AP.
- [ ] Implement role prep effects:
  - Knight `Raise Banner`: next roll reduces threat gain.
  - Scout `Mark Target`: next matching weak-role roll gets a small modifier.
  - Mage `Charge Rune`: chance to upgrade one roll band.
  - Cleric `Bless Party`: softens next setback.
- [ ] Prep cannot clear a room by itself and cannot replace AP rolls.
- [ ] Add tests for prep refresh, prep consumption, prep effect application, and no room clear from prep alone.

## Phase 5: Artifacts As Decisions

- [ ] Audit current artifact inventory/loadout model and charge support.
- [ ] Keep 3 equipped artifact slots.
- [ ] Split artifacts into passive and active effects.
- [ ] Add active artifact use before roll, either through the roll endpoint payload or a dedicated endpoint when state changes before rolling.
- [ ] Implement first active artifact set:
  - `Loaded Die`: reroll once per expedition.
  - `Map Scrap`: reveal a hidden connected room.
  - `Warding Nail`: prevent next threat gain.
  - `Mimic Whistle`: identify mimic tell.
  - `Silver Lantern`: remove dark/dim penalty for this room.
- [ ] Show charges and clear result feedback.
- [ ] Add tests for active charges, duplicate artifacts, charge consumption, and inactive artifact denial.

## Phase 6: Boss Mechanics

- [ ] Replace generic boss room with phased boss state.
- [ ] Implement boss phases:
  - Phase 1 `Break the Bark Armor`: Knight/Mage reduce armor faster.
  - Phase 2 `Survive the Root Tide`: Scout/Cleric reduce threat and prevent curse.
  - Phase 3 `Expose the Root Heart`: any role can finish; openings and relay create larger progress spikes.
- [ ] Ensure wrong roles are never blocked; they may get `-1` or miss a secondary effect.
- [ ] Ensure boss art uses contain rendering with a proper background and never crops to only belly/legs.
- [ ] Add boss tests for solo completion, correct-role speedup, phase transitions, and final reward.

## Phase 7: Family Cooperation Systems

- [ ] Add Rally Room state with `15 minute` family-wide cooldown.
- [ ] Add Role Relay tracking:
  - 2 different roles: support bonus.
  - 3 different roles: next successful roll gets bonus progress.
  - 4 roles: family combo and chest bonus.
- [ ] Add Need Role badges derived from encounter state:
  - `Need Scout`
  - `Cleric can cleanse`
  - `Mage can break shield`
  - `Any role can finish`
- [ ] Upgrade combat log copy to explain who created support/opening and who used it.
- [ ] Add tests for rally selection, cooldown, relay bonuses, and family support attribution.

## Phase 8: Frontend Full-Screen Expedition Game

- [ ] Move expedition into a full-screen game-like panel from Family screen, with no dashboard-first layout.
- [ ] Make persistent HUD:
  - top: `Back`, AP, AP timer, `Map`, `Vault`, `Guide`.
  - center: room scene with art/enemy/boss.
  - lower: progress, threat, mechanic hint, weak roles, opening.
  - bottom: one sticky `Roll d20` CTA.
- [ ] Map is opened by button, not always visible.
- [ ] Vault/artifacts are opened by button, not always visible.
- [ ] Remove refresh button from expedition gameplay.
- [ ] Replace cryptic tags with explained chips/tooltips or plain readable labels.
- [ ] Add mobile-safe layout for smallest Telegram WebView screens.

## Phase 9: Frontend Mini-Mechanics, Prep, Artifacts

- [ ] Render room-specific mini-mechanic controls above the roll CTA.
- [ ] Render prep slots as small tactical buttons with charges and cooldowns.
- [ ] Render active artifacts as deliberate pre-roll choices with charges and confirmation if destructive/rare.
- [ ] Show exact effect preview before rolling:
  - why current role is strong/normal.
  - what room choice changes.
  - what artifact/prep will do.
- [ ] Keep the screen readable enough that a new player understands why they rolled and what happened.

## Phase 10: Animation And Feedback

- [ ] Add d20 roll animation with rolling number, final number, modifier line, and result band.
- [ ] Add enemy hit/shake, threat pulse, opening glow, critical flash, clear/chest animation.
- [ ] Add boss phase intro and phase transition animation.
- [ ] Add room clear reward moment that does not imply loot dropped on every failed/partial roll.
- [ ] Keep all animations CSS/React-driven and performant on mobile.

## Phase 11: Rewards And Balance

- [ ] Tune full clear expected payout so an active participant gets about `300 coins`.
- [ ] Separate low participation from full boss chest eligibility.
- [ ] Preserve solo viability:
  - solo can clear slowly.
  - active family clears faster.
  - no room requires a specific role to continue.
- [ ] Tune AP pacing around cap `5` and regen `1 / 3h`.
- [ ] Add tests or deterministic simulations for expected coins, solo completion speed, and active family completion speed.

## Phase 12: Verification And Rollout

- [ ] Run `node --check` on changed backend files.
- [ ] Run backend expedition tests and full backend test suite.
- [ ] Run frontend production build.
- [ ] Use browser playtest for:
  - solo family path.
  - multi-role family path.
  - map overlay.
  - artifact/prep decisions.
  - boss fight.
  - smallest mobile viewport.
- [ ] Prepare changelog and deploy archive only after verification passes.

