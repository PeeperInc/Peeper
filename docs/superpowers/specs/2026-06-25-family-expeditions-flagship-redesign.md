# Family Expeditions Flagship Redesign

## Goal
Turn Family Expeditions from a daily progress-button into Peeper's flagship family activity: a mobile-first dark fantasy dungeon crawler where family members cooperate asynchronously, create openings for each other, and feel like they are fighting through encounters together.

The expedition must never hard-fail. A solo player can finish slowly. A coordinated 10-player family finishes much faster and earns more satisfying moments.

## Non-Negotiables
- AP cap is `5`.
- AP regenerates at `+1 AP every 3 hours`.
- A full expedition clear should pay an active participant about `300 coins`.
- Each room has one primary roll button, not 2-4 class-specific roll buttons.
- Gameplay must include meaningful decisions beyond pressing one button.
- Room art, enemy sprites, boss art, dice animation, progress reactions, and role moments must be visually front-and-center.

## Core Loop
1. Family opens an expedition and prepares roles/artifacts.
2. Family chooses a Rally Room: the main room everyone is encouraged to push.
3. A player opens the current encounter.
4. Player reads the room mini-mechanic: trap choice, shrine blessing, mimic tell, puzzle clue, enemy intent, or boss phase rule.
5. Player can optionally use a preparation slot or activate an artifact.
6. Player taps one large `Roll d20` button.
7. Result advances progress, changes threat, triggers role effects, may create an Opening for the family.
8. Other family members return while the Opening is active to combo.
9. Room clears, reward/chest moment plays, next rooms open.
10. Boss phases use the same system but with stronger phase-specific mechanics and more dramatic visuals.

## Room Model
Each room becomes an encounter:

```js
room: {
  progress,
  progressTarget,
  threat,
  threatMax,
  enemyId,
  primaryRole,
  secondaryRole,
  enemyIntent,
  opening,
  rally,
  reward
}
```

### Progress
Progress is permanent and never goes backwards.

### Threat
Threat is pressure, not failure. It makes the next roll harder or causes temporary effects:
- `Guarded`: next roll has `-1`.
- `Cursed`: role effects are weaker until Cleric contributes.
- `Hidden`: Scout can expose the enemy for bonus.
- `Shielded`: Mage can crack shield.
- `Enraged`: Knight can reduce threat.

Threat decays when the room is cleared. It does not brick an expedition.

### Enemy Intent
Every encounter shows what the enemy is about to do:
- `Guard`: progress is harder unless Knight/Mage answers.
- `Curse`: Cleric can cleanse.
- `Hide`: Scout can reveal.
- `Strike`: Knight can control threat.
- `Channel`: Mage can interrupt.

The intent makes the next roll choice meaningful.

## One Roll Button With Room Mini-Mechanics
There is one main button:

`Roll d20 as Scout`

The player does not choose between four class actions or abstract modes. Gameplay variety comes from room-specific rules, preparation slots, boss mechanics, and active artifacts.

### Room Mini-Mechanics
Each room type has a small, readable mechanic:

`Combat`
- Shows an enemy sprite and enemy intent.
- The room has one or two weak roles.
- Correct role gets a bonus effect, but any role can progress.

`Trap`
- Shows 2-3 visible route choices before roll.
- Choices are not class actions; they are room options such as `Safe Path`, `Fast Path`, `Greedy Path`.
- Safe path lowers threat risk, fast path raises progress variance, greedy path improves clear reward but adds threat on low roll.

`Treasure / Mimic`
- Shows a tell/guess moment before roll, such as choosing the real chest or baiting the mimic.
- Correct read gives bonus progress or better chest.
- Wrong read never fails the room, but raises threat or removes chest bonus.

`Shrine`
- Offers a family blessing choice before the roll.
- Examples: `Bless next roll`, `Restore 1 AP to lowest AP member`, `Reduce threat in Rally Room`.
- The roll determines blessing strength.

`Puzzle`
- Each roll reveals a symbol/clue.
- Family members can combine clues; matching role may reveal two clues.
- Progress still accumulates, so solo play is always possible.

The CTA remains one button. The decision is not "which class action do I press?", but "how do we handle this room's mechanic before the roll?"

## Roll Bands
Base d20 outcome:
- `1`: 0 progress, +2 threat, dramatic setback.
- `2-5`: 0 progress, +1 threat.
- `6-10`: +1 progress.
- `11-15`: +2 progress.
- `16-19`: +3 progress and room/role effect.
- `20`: +5 progress, strong room/role effect, cinematic critical, bonus reward chance.

Modifiers still exist from role, artifacts, support, opening, preparation, and room mini-mechanics.

## Role Identity
Roles are automatic. The room decides who is especially useful.

### Knight
Fantasy: breaks guards, tanks danger, stabilizes bad rooms.
- Strong vs `armored`, `brute`, `guard`.
- Role effect: reduce threat, break guard, protect a failed roll once.

### Scout
Fantasy: finds weak spots, reveals routes, creates openings.
- Strong vs `hidden`, `trap`, `evasive`.
- Role effect: creates Opening, improves map/reveal, marks target.

### Mage
Fantasy: cracks shields, interrupts channels, manipulates dice.
- Strong vs `arcane`, `shielded`, `rune`.
- Role effect: removes shield, improves roll band, amplifies opening.

### Cleric
Fantasy: cleanses curses, fights undead, saves the family from debuffs.
- Strong vs `undead`, `cursed`, `spirit`.
- Role effect: cleanse debuff, lower corruption/threat, convert setback to partial.

## Openings
Openings are the key return mechanic.

Example:
```js
opening: {
  role: 'knight',
  bonus: 3,
  expiresAt: now + 3h,
  createdBy: userId,
  label: 'Exposed root heart'
}
```

When Scout rolls well, the room may show:
`Opening: Knight +3 for 2h 48m`

This creates a reason to ping or return. If nobody uses it, the expedition still continues, just slower.

## Preparation Slots
Preparation slots are lightweight help actions that can be used between AP rolls.

Rules:
- Each prepared member has `1 prep charge` that refreshes every `6 hours`.
- Prep does not spend AP.
- Prep cannot clear a room by itself.
- Prep creates small tactical value for the next AP roll.

Role prep examples:
- Knight: `Raise Banner` gives next roll `-1 threat gain`.
- Scout: `Mark Target` gives next matching weak-role roll `+1`.
- Mage: `Charge Rune` gives next roll a chance to upgrade one roll band.
- Cleric: `Bless Party` softens the next setback in the room.

This gives players a reason to open expeditions even when AP is empty.

## Family Mechanics
### Rally Room
One room can be marked as family focus.
- The map and family tab show `Rally here`.
- Rolls in Rally Room get small bonus progress or support.
- Prevents family from scattering randomly.
- Any prepared family member can set Rally Room.
- Rally can be changed, but not spammed: `15 minute` family-wide cooldown.

### Role Relay
If different roles contribute to the same room within a short window, the room gains a combo:
- 2 different roles: `+1 support`.
- 3 different roles: next successful roll gets `+1 progress`.
- 4 roles: `Family Combo` animation and chest bonus.

### Assist Tokens
Assist is not anonymous support. It shows who helped:
`Anna prepared +2 support`
`Vivor used Anna's support`

### Need Role Badges
Room UI displays:
- `Need Scout`
- `Cleric can cleanse`
- `Mage can break shield`
- `Any role can finish`

## Boss Mechanics
Boss fights are not role-locked. A solo player can clear every phase, but correct roles reduce penalties and speed up the phase.

Phase examples:
- Phase 1 `Break the Bark Armor`: boss is `Guarding`; Knight and Mage reduce armor faster.
- Phase 2 `Survive the Root Tide`: boss is `Striking/Hiding`; Scout and Cleric reduce threat and prevent curse.
- Phase 3 `Expose the Root Heart`: all roles can finish; role relay and openings produce larger progress spikes.

Boss roll penalties:
- Wrong role never blocks progress.
- Wrong role may roll with `-1` or miss the secondary effect.
- Correct role may get `+1`, reduce threat, or create Opening.

Boss visuals:
- Always render `boss_sanctum` background behind phase art.
- Boss art uses full contain rendering and never crops to belly/legs.
- Each phase has a short intro copy and result animation.

## Artifacts As Decisions
Artifacts should not all be passive stat sticks. A subset becomes active decisions.

Rules:
- Player still equips up to 3 artifacts.
- Some artifacts are passive.
- Some artifacts have active charges.
- Active artifacts are used before rolling and can change the room state or roll result.

Examples:
- `Loaded Die`: active reroll once per expedition.
- `Map Scrap`: active reveal a hidden connected room.
- `Warding Nail`: active prevent next threat gain.
- `Mimic Whistle`: active identify mimic tell.
- `Silver Lantern`: active remove dark penalty for this room.

Active artifacts must have clear buttons, charges, and result feedback.

## Rewards
Target: an active participant earns about `300 coins` per full expedition.

Reward model:
- Room clear coins are mostly family-visible but personally granted to contributors.
- Boss chest is the major reward.
- Active participant target:
  - Room contribution rewards: `80-120 coins`.
  - Boss clear chest: `160-220 coins`.
  - Bonus chest/crit/relic duplicate coins: variable.
- Total expected active clear: about `300 coins`.

Eligibility:
- Full boss chest requires meaningful participation, for example `3 AP contribution`.
- Low participation can still get small room rewards, but not full boss payout.

Artifacts remain personal and expedition-only. They are not tradeable.

## Visual Direction
70% serious dark fantasy dungeon crawler, 30% Peeper dark humor.

Main room scene:
- Large room background.
- Enemy sprite centered or slightly above center.
- Boss uses `boss_sanctum` background plus phase-specific boss sprite.
- Enemy always uses `object-fit: contain` and focal positioning, never cropped to just belly/legs.
- Room state uses effects:
  - Threat: red pulse and smoke.
  - Opening: green/gold weak spot glow.
  - Critical: d20 flash, slash beam, enemy hit shake.
  - Clear: chest animation.

Persistent HUD:
- Top: Back, AP timer, Map, Vault.
- Center: encounter scene.
- Lower: progress/threat bars, weakness chips, mechanic hint, and artifact/prep buttons.
- Bottom sticky: one big roll button.

Avoid:
- Dashboard panels as the main game.
- Four equal roll cards.
- Always-open map.
- Tiny unreadable tags without explanation.
- Cropped boss art.

## Asset Use
Existing enemy assets should be wired:
- `bone_rat`
- `crypt_spider`
- `grave_slime`
- `hollow_archer`
- `lantern_skull`
- `moss_wraith`
- `ossuary_golem`
- `rootbound_champion`
- `rootbound_guard`
- `root_cultist`
- `thorn_hound`
- `vine_mimic`

Every combat/treasure/mystery room should have either an enemy or a special object sprite.

## Implementation Phases
### Phase 1: Encounter Foundation
- Add encounter fields to room templates.
- Collapse each room to one primary role-based action.
- Add threat and opening state.
- Add AP regen: cap 5, +1 every 3h.
- Do not add AP-ready Telegram notifications in this phase.
- Add room mini-mechanic metadata.
- Add preparation charges.
- Keep old APIs stable where possible.
- Preserve no-hard-fail rule.

### Phase 2: Room Scene UI
- Replace card actions with one room encounter scene.
- Render enemy sprites and boss backgrounds correctly.
- Add room mini-mechanic UI and one roll CTA.
- Add dice/result animation.
- Add clear/chest animation.

### Phase 3: Family Cooperation
- Rally Room.
- Role Relay.
- Assist token attribution.
- Need Role badges.
- Better family combat log.

### Phase 4: Active Artifacts And Boss Polish
- Add active artifact buttons and charges.
- Add boss phase mechanics and phase intros.
- Add stronger boss result animations.

### Phase 5: Economy And Tuning
- Tune room progress and threat values.
- Tune rewards to about 300 coins per active clear.
- Tune expedition duration:
  - Solo: slow but steady.
  - Active family: much faster and more rewarding.

### Phase 6: Polish
- More enemy intents.
- Better boss phase presentation.
- Seasonal dungeon packs.
- Weekly family highlights.

## Deferred Decisions
- AP-ready Telegram notifications may be added after playtesting the new AP rhythm.
- Seasonal dungeon packs are intentionally outside the first redesign.
