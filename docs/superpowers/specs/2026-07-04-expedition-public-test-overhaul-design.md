# Expedition Public Test Overhaul

## Goal

Prepare Family Expeditions for a first public test by replacing legacy artifacts and role abilities with clear, useful decisions; making combat and mini-games moderately harder; doubling expedition income; preserving unclaimed rewards; and making HP, shields, healing, and reward outcomes visually explicit.

The expedition remains asynchronous and solo-completable. Family participation accelerates progress and creates shared room advantages, but no mechanic requires another player to be online.

## Core Rules

- Maximum AP remains `5`.
- One AP regenerates every `3 hours`.
- Combat, event attempts, support actions, and other AP-funded actions contribute to personal expedition activity.
- HP persists across rooms and never refreshes merely because a room was cleared or entered.
- At `0/3 HP`, a hero is knocked out for `6 hours` and cannot perform expedition actions.
- After recovery, the hero returns with `3/3 HP`.
- Expedition coin sources are doubled relative to the current build.
- Personal final rewards increase with useful participation. The exact formula is server-only and is not exposed to the client.
- Player-facing reward copy says: `The more you contribute, the greater your personal reward.`

## Combat Difficulty

Combat uses one d20 and the following result bands:

| Roll | Result |
|---|---|
| `1-5` | Hero takes `1 damage`; enemy takes none |
| `6-8` | No damage on either side |
| `9-15` | Enemy takes `1 damage` |
| `16-19` | Enemy takes `2 damage` |
| `20` | Enemy takes `3 damage` |

Current combat targets of `5` and `6` become `6` and `7`; each boss-phase target becomes `9` instead of `8`. Room templates remain completable by one player over time.

## Role Abilities

Each prepared member starts with one role charge. A spent charge regenerates after that member spends another `3 AP`; charge capacity is one. Charge progress is visible as `0/3`, `1/3`, `2/3`, or `Ready`.

### Knight: Hold the Line

- Places one shared shield on the current room.
- The shield blocks the next point of damage that any family member would receive in that room.
- The failed action still fails; only damage is prevented.
- A room cannot hold two Knight shields.
- The room displays `Knight shield ready · placed by <name>` until triggered.
- On trigger, the acting client plays a shield impact and shatter animation and the status disappears.

### Mage: Bend Fate

- Places one shared Fate charge on the current room.
- On combat, the next family combat action rolls two animated d20 dice and uses the higher result.
- On a mini-game failure, it grants one immediate retry without additional AP or HP damage.
- A room cannot hold two Fate charges.
- The room displays `Bend Fate ready · placed by <name>` until triggered.

### Cleric: Warding Prayer

- Immediately heals every prepared, non-knocked-out member by `1 HP`, capped at `3 HP`.
- Reduces active knockout recovery timers by `2 hours`, but does not instantly revive a member unless this reaches the recovery time.
- Each affected member receives a durable personal visual event.
- If the member was offline, the heal animation and `+1 HP` result play once when they next open Expeditions.

### Scout: Find the Path

- Offers three server-generated candidates for the next room and lets the Scout choose one.
- Once the next room has been chosen, another Scout cannot choose again from the same room.
- The ability becomes usable again only after the family reaches the chosen room and the Scout recharges it.

## Shared Room Effects

Room effects are stored server-side with type, room, owner, remaining uses, and creation time. They are displayed directly below the room scene so all family members can see them.

Effects are consumed transactionally with the action they modify. The API response includes a visual event so the client can play the correct animation before removing the effect from the HUD.

## Mini-Game Attempt Sessions

Mini-games use server-side attempt sessions rather than spending AP only after a client result arrives.

- A session records expedition, room, user, mini-game type, seed, start time, expiry, status, and whether a Mage retry is available.
- AP is spent when gameplay actually starts.
- Only one unresolved attempt per user and room is allowed.
- Closing the app does not refund AP.
- Completion and failure are idempotent.
- Failure applies `1 HP` damage unless blocked by a room shield or converted into a Mage retry.
- Client-reported results are validated against attempt type, duration, seed, and allowed score bounds.

### Root Crossing

- The field contains safe horizontal rows separated by continuously moving root traffic.
- Controls are two large buttons: `UP` and `DOWN`.
- Each press moves the hero exactly one row.
- The player can observe traffic before starting.
- The first `UP` creates/starts the server attempt, spends `1 AP`, and starts a `15-second` timer.
- Collision immediately fails the attempt and applies damage.
- Reaching the final row succeeds.
- Timeout fails the attempt.
- A new attempt starts from the bottom and costs another AP.

### Hunt the Shade

- Six shadows move continuously before, during, and after the start transition.
- Shadows never teleport on start, react to hover, or overlap one another.
- Pressing Start spends AP and briefly illuminates only the target's eyes for `0.3 seconds`.
- After the flash, all targets are visually identical.
- The player must tap the remembered moving target before the timer expires.
- Wrong target or timeout fails the attempt.

### Existing Mini-Games

- Rune Memory and Focus remain. Moving elements run at `1.1x` speed and timing windows shrink to `90%` of their current size; Rune Memory keeps its approved nine-rune board and three-rune sequence.
- All mini-games share the same attempt, AP, HP, shield, Mage retry, and idempotency rules.

## Artifact System

The legacy catalog is replaced by 24 curated artifacts. Every artifact occupies one of three personal expedition slots and is consumed during that expedition.

- **Active:** manually used and consumed immediately when its effect is successfully armed or applied.
- **Expedition passive:** reserved when equipped, remains active for the expedition, and is consumed when the expedition finishes.
- A found artifact may be equipped into an empty slot during the expedition.
- Occupied slots cannot be replaced mid-expedition.
- Failed or inapplicable active uses do not consume the artifact.
- Reserved inventory quantities cannot be equipped into another expedition state.

### Common

| Artifact | Type | Effect |
|---|---|---|
| Old Torch | Passive | Adds `10%` to mini-game time limits and timing windows |
| Bent Sword | Passive | Non-boss combat rolls of `16-19` deal `+1 damage` |
| Chalk Rune | Active | Adds `3 seconds` to the next mini-game attempt in the current room |
| Rabbit Foot | Passive | Blocks the first combat damage the wearer would take |
| Bone Die | Active | The wearer's next combat d20 cannot resolve below `9` |
| Wooden Shield | Active | Blocks the next damage dealt to the wearer in the current room |
| Tiny Shovel | Active | Adds `2 progress` to the current non-boss room |
| Ration Box | Active | Restores `1 HP` to the wearer |

### Rare

| Artifact | Type | Effect |
|---|---|---|
| Rusty Lockpick | Active | Guarantees one successful non-combat mini-game attempt; AP is still spent |
| Loaded Die | Active | The next combat action rolls two d20 and keeps the higher result |
| Family Banner | Passive | The wearer's role charge regenerates after `2 AP` instead of `3 AP` |
| Rootcutter's Axe | Passive | Boss combat rolls of `16-20` deal `+1 damage` |
| Warding Nail | Active | Places a Knight-style shared shield in the current room |
| Second Chance Coin | Active | Places a Mage-style free mini-game retry in the current room |
| Campfire Charm | Active | Immediately restores the wearer's role charge |

### Epic

| Artifact | Type | Effect |
|---|---|---|
| Phoenix Feather | Active | Immediately ends the wearer's knockout and restores `3 HP` |
| Hourglass Shard | Active | Restores `2 AP`, capped at the normal AP maximum |
| Banner of Last Stand | Passive | The first lethal hit leaves the wearer at `1 HP` instead |
| Emerald Heart | Passive | A natural `20` heals the wearer by `1 HP` |
| Crooked Compass | Active | Opens a Scout-style three-room choice regardless of role |
| Mimic Tooth | Passive | Increases the wearer's room coin drops by `50%`, after the global reward increase |

### Legendary

| Artifact | Type | Effect |
|---|---|---|
| Fate's Broken Die | Active | The wearer's next three combat actions roll two d20 and keep the higher result |
| Crown of Twenty | Passive | Natural `19` is treated as natural `20` |
| Root King's Signet | Passive | Every successful boss combat roll deals `+1 damage` |

Items removed from the active catalog remain safely ignored during migration. Each removed artifact stack is deterministically converted to a curated artifact of the same rarity using `user_id + old_artifact_id` as the stable selector; legacy charges become at least one replacement copy. This preserves player value without making deployment depend on randomness.

## Artifact Interaction UI

Tapping any artifact opens the existing application BottomSheet pattern.

The sheet contains:

- large artifact image;
- name and rarity;
- `Active` or `Expedition passive` label;
- exact plain-language effect;
- when and how it is consumed;
- current quantity or reserved state;
- contextual primary action: `Take`, `Use`, or disabled reason;
- `Cancel`.

Active artifacts used in a room play a short item animation and update the room/member state only after server confirmation.

## Persistent Personal Rewards

Finishing an expedition creates an immutable pending reward for every prepared member with at least `1 contribution AP`. Rewards are rolled exactly once at finish time and stored as a payload.

The server calculates personal coins and artifact quality from contribution AP, useful progress, room clears, and participation in the boss. Exact weights are private server constants so balance can be tuned without teaching players an exploitable formula.

- More contribution always produces at least as much final coin reward as less contribution under the same expedition result.
- Zero-contribution members receive no pending reward.
- Room coins are awarded during play and summarized separately.
- Pending rewards never expire.
- Starting or finishing later expeditions cannot overwrite old rewards.
- Claims are idempotent and independent of current family membership.

The Expedition entry point shows `Claim Rewards · N` whenever pending rewards exist. Claiming opens a result sheet containing:

- expedition name and completion date;
- AP contributed;
- room coins;
- final coins;
- total expedition coins;
- artifact cards and rarities.

A startup migration/backfill creates deterministic pending payloads for eligible, finished, unclaimed legacy expeditions.

## Durable Visual Events

A personal event queue stores visual events that must survive offline time. Initial event types are:

- `cleric_heal`;
- `cleric_recovery_reduced`;
- `pending_reward_ready`.

Events are delivered with expedition state and acknowledged by a dedicated endpoint after their animation completes. Re-fetching before acknowledgement is safe; acknowledgement is idempotent.

Immediate action effects such as shield block, double d20, artifact activation, damage, and mini-game success are returned directly by the mutation response and do not require offline delivery.

## Data Model

New or extended persistence includes:

- role charge and recharge progress on `family_expedition_members`;
- `family_expedition_room_effects` for shared shield/Fate states;
- `family_expedition_minigame_attempts` for AP-safe attempts;
- `family_expedition_pending_rewards` for immutable unclaimed rewards;
- `family_expedition_member_events` for offline visual events;
- artifact reservation/consumption state in member loadout JSON and inventory transactions.

All schema changes use additive startup migrations and idempotent unique constraints.

## API Surface

The existing expedition state is extended with:

- role charge state;
- active room effects and owner display names;
- pending reward count/summaries;
- pending personal visual events;
- artifact metadata required by detail sheets.

New mutations cover:

- use role ability;
- use active artifact;
- start mini-game attempt;
- complete/fail mini-game attempt;
- claim pending reward;
- acknowledge personal visual events.

Every mutation requires an idempotency key and executes related AP, HP, inventory, effect, and reward changes in one SQLite transaction.

## Animation Requirements

- Mage combat displays two physical d20 dice rolling simultaneously; the chosen higher die remains lit and the lower die dims.
- Shield block draws a shield over the hero, flashes on impact, then cracks/shatters before disappearing.
- Cleric healing uses green-gold particles, a rising `+1 HP`, and an HP-bar fill animation.
- Offline healing plays once on opening Expeditions before normal interaction resumes.
- Artifact use animates the selected card into the relevant HUD target.
- Reward claiming reveals coins first and artifacts one at a time by rarity.
- `prefers-reduced-motion` receives short fades and immediate state transitions without losing information.

## Failure And Recovery Handling

- A network interruption after mini-game start does not refund AP or duplicate damage.
- A stale client cannot consume an already-consumed room effect or artifact.
- A reward cannot be rerolled, claimed twice, or lost by starting another expedition.
- A knocked-out hero cannot bypass recovery through room transitions, page reload, or ordinary healing.
- Cleric recovery reduction and Phoenix Feather are explicit exceptions handled transactionally.
- Legacy unsupported artifacts never crash serialization or loadout rendering.

## Verification

Backend tests cover combat bands, persistent HP, six-hour recovery, every role ability, effect consumption, mini-game attempt lifecycle, all 24 artifacts, inventory migration, reward monotonicity, immutable reward claims, and visual event delivery/acknowledgement.

Frontend tests and manual playtests cover artifact sheets, three-slot constraints, two-die animation, shield/heal animations, offline heal playback, reward reveal, Root Crossing controls/timing, Shade tracking, mobile viewport fit, reconnect behavior, and reduced motion.

Production build and the complete backend test suite must pass before deployment packaging.
