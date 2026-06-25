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
4. Player chooses a tactical stance.
5. Player taps one large `Roll d20` button.
6. Result advances progress, changes threat, triggers role effects, may create an Opening for the family.
7. Other family members return while the Opening is active to combo.
8. Room clears, reward/chest moment plays, next rooms open.
9. Boss phases use the same system but with stronger enemy intents and more dramatic visuals.

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

## One Roll Button With Tactical Choices
There is one main button:

`Roll d20 as Scout`

The player still chooses a stance before rolling. This is the main gameplay decision.

### Stances
`Advance`
- Best for raw progress.
- Normal threat risk.
- Good when the room is close to clearing.

`Control`
- Less progress.
- Reduces threat or blocks enemy intent on decent rolls.
- Good when threat is high.

`Setup`
- Less immediate progress.
- Better chance to create an Opening for another role.
- Good for family coordination.

`Loot`
- Riskier.
- Less reliable progress.
- Improves clear reward or chest quality if the room is finished soon.
- Available only in treasure and mystery rooms for the first implementation.
- Not available in boss phases.

The CTA remains one button. The decision is not "which class action do I press?", but "what is my plan for this roll?"

## Roll Bands
Base d20 outcome:
- `1`: 0 progress, +2 threat, dramatic setback.
- `2-5`: 0 progress, +1 threat.
- `6-10`: +1 progress.
- `11-15`: +2 progress.
- `16-19`: +3 progress and role/stance effect.
- `20`: +5 progress, strong role effect, cinematic critical, bonus reward chance.

Modifiers still exist from role, artifacts, support, opening, and stance.

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
- Lower: progress/threat bars, weakness chips, stance chips.
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
- Keep old APIs stable where possible.
- Preserve no-hard-fail rule.

### Phase 2: Room Scene UI
- Replace card actions with one room encounter scene.
- Render enemy sprites and boss backgrounds correctly.
- Add stance selector and one roll CTA.
- Add dice/result animation.
- Add clear/chest animation.

### Phase 3: Family Cooperation
- Rally Room.
- Role Relay.
- Assist token attribution.
- Need Role badges.
- Better family combat log.

### Phase 4: Economy And Tuning
- Tune room progress and threat values.
- Tune rewards to about 300 coins per active clear.
- Tune expedition duration:
  - Solo: slow but steady.
  - Active family: much faster and more rewarding.

### Phase 5: Polish
- More enemy intents.
- Better boss phase presentation.
- Seasonal dungeon packs.
- Weekly family highlights.

## Deferred Decisions
- AP-ready Telegram notifications may be added after playtesting the new AP rhythm.
- Seasonal dungeon packs are intentionally outside the first redesign.
