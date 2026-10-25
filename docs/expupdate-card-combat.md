# ExpUpdate: asynchronous card combat

Working implementation on `ExpUpdate`. New expeditions use `map.combatMode = cards_v1`.
On the first deployment, unfinished dice expeditions are closed with rewards for
their actual progress. Existing reward payloads stay unchanged; remaining packed
relics and unused meal ingredients are returned. New card expeditions are never
closed by a repeat restart. The farm/pantry patch is not included.
Release behavior and verification: [expupdate-release.md](expupdate-release.md).

## Rules

- One AP buys a saved four-card hand with three energy. Playing and ending the hand cost no additional AP.
- AP is debited transactionally when drawing; contribution AP increases exactly once.
- Enemy HP and boss phases are shared. Enemy responses affect only the hero ending their own turn.
- An interrupted hand preserves its cards, energy and class resource across reconnects and server restarts.
- A living target cannot be abandoned to avoid its response. After an ally defeats it, the exact remaining hand can transfer to another open combat room for free.
- Replayed requests are idempotent. Expected revisions reject stale tabs and concurrent hand mutations.
- Cards, energy, AP, HP, damage and random deck order are server-owned. Other players never receive your hand or draw order.
- A hero knocked out by a card battle recovers in 30 minutes. Overheat damage cannot be dodged.
- Boss phase damage is capped to the remaining phase HP. Cards cannot repeatedly claim the same kill or reward.
- Existing room challenges remain in noncombat rooms. They cannot overlap a paid card turn.

## Classes

Knight builds block, spends it on shield attacks, retains it with Shield Throw,
and counters fully blocked responses through Challenge. Standfast is free but
draws only if the hero was already blocking. Bulwark retains two block.
Scout builds turn-local combo, spends it on finishers or Preparation's two-card
draw, and keeps it with Flurry. Venom Blade deals two poison damage at the end of
its owner's next three turns in that room. Allies and offline time never advance
poison. A killing poison tick prevents the enemy response.
Ambush now uses the same stable card ID for **Venom Finish**, a second finisher
in the existing twelve-card Scout deck and its room reward pool. It costs one
energy, requires at least one combo, spends up to two combo and deals three
immediate damage. Its poison deals `1 + combo spent` damage on the owner's next
three turn ends. Extra combo is kept. Reapplying either poison card refreshes
three ticks and keeps the stronger dose, without stacking streams. Each Scout
owns a separate poison; the old saved numeric duration still defaults to two
damage. Expiry, enemy death and boss phase transitions clear the associated dose.
Mage builds persistent heat, doubles the next damaging card through Arcane Echo,
and cools through Frost Armor or Deep Breath. Echo expires at turn end and doubles
damage, not heat or other card effects. Inferno scales with existing heat and keeps
it. Ending a turn at four or more heat costs one HP; Vent converts cooling to energy.
Cleric's **Faith** grants one block for the first light-generating card of each
paid hand, including at the light cap. It triggers once, survives reconnects and
free retargets, and refreshes only on the next paid draw. Sanctuary grants two
block itself, plus Faith when ready. Mend spends two light to heal up to two HP
and draw a card. Mercy spends one light for one HP and one block; it can be played
at full HP for its protection. Other healing still respects the three-HP cap.
Cleric earns persistent light through combat or Prayer. Offering trades one HP for
three light and one energy, and requires at least two HP. Beacon adds two shared
charges: a damaging family card heals its wounded attacker one HP and consumes
one charge. Attacks at full HP preserve the charge, including when a relic has
already restored the attacker to full health before Beacon resolves.

Each class starts with twelve distinct cards: **one Strike, one Guard and ten
class cards**. There are forty class cards plus two neutral cards in the catalog.
Existing saved decks are preserved; the local training fixture has been refreshed.
Helping clear a combat room offers three class cards. The player can add one to discard or skip; maximum deck size is sixteen. Rewards never replace an already paid hand.
Expose has two shared hit charges. A ward protects one other family member's response.

- Knight: Shield Bash, Bulwark, Riposte, Hold the Line, Fortress, Shield Crash,
  Vanguard, Standfast, Challenge, Shield Throw.
- Scout: Quick Cut, Expose, Finisher, Sidestep, Venom Finish, Death Mark, Vanish,
  Preparation, Venom Blade, Flurry.
- Mage: Spark, Fireball, Vent, Discharge, Inferno, Ice Bolt, Deep Breath,
  Frost Armor, Overchannel, Arcane Echo.
- Cleric: Smite, Mend, Judgement, Sanctuary, Radiance, Mercy, Holy Fire,
  Prayer, Offering, Beacon.

## Presentation and validation

Horizontal illustrated cards, readable costs, large Draw/End buttons, and a
three-part console beneath the hand: HP hearts, a class crest with resource count,
and energy. Enemy intent uses a damage medallion beside the enemy's shared HP.
The deck drawer includes a ten-card class collection with the exact current rules.
All forty-two cards have individually composed SVG illustrations without external
image requests. Short event-driven effects cover flying shields, counters, dagger
chains, poison, targeting, lightning, fire, frost, arcane runes, light and healing.
Equipped Peeper attacks, casts and reacts to incoming hits. Effects do not replay
on reconnect or periodic polling; reduced motion suppresses the effects.

`frontend/dev/expedition-cards.html` runs the real expedition screen against the local backend.
The isolated local fixture uses `tmp/expupdate-local.db`; no production data is copied or modified.

Core regression tests: `backend/expeditions/cardCombat.test.mjs`.
Before release, playtest pacing and class balance with multiple family members;
automated correctness does not establish fun or economic balance.

Validation of the first iteration: 481 automated backend/frontend tests passed;
production frontend build passed. Browser checks played a hand with each of the
four classes, reloaded paid hands, and ended turns without an extra AP debit.
Layout checks covered 320x568, 375x667, 390x844 and 1280x850, including the normal
Home -> Family -> Expedition entry and reduced-motion rendering.

The twelve-card/presentation iteration passes **532 automated tests**, including
legal execution of every catalog card, resource prerequisites, retained block,
counter attribution, poison ownership/expiry/killing ticks, bounded draws, Echo
consumption and shared Beacon charges. The production frontend build passes.
Browser checks verify class libraries (12 deck cards / 10 class cards), visible
turn controls at the four viewport sizes above, card-specific VFX for all four
classes, effect expiry and no replay after reload. Full class turns preserve AP
until the next draw, which spends exactly one; reloaded hands remain identical.
The normal application entry is also checked at 375x667. These are correctness
and presentation checks; pacing and class balance still need player feedback.

Cleric survivability follow-up: 117 card/route tests pass, covering once-per-hand
Faith, replay safety, carried hands, capped two-HP Mend, Mercy at full health,
and two previously lethal hand sequences. Production build passes. A separate
temporary local QA family confirms healing and Faith/Mercy protection through
real browser actions, without resetting the player's expedition. The training
cleric's HP and AP are restored for another player test.

Response forecast follow-up: the server publishes `turn.response` using the same
response plan as End Turn, including block spending, weaken, dodge, ally wards,
room shields, relics, poison kills/phase changes and separate overheat damage.
Reading a forecast never consumes protection. The arena damage number and End
Turn use this result and explain zero damage instead of calling every prevention
a block. Shield Crash spends all block but weakens the response by one; Shield
Throw keeps its block. Tests cover both and compare forecast with actual HP loss.
126 card/route tests pass. Browser reproduction verifies spent block takes two
damage, Shield Crash reduces ordinary/heavy hits to zero/one, an ally ward can
still prevent a hit, and a deliberately delayed older poll cannot restore spent
block. Controls fit 320x568, 375x667, 390x844 and 1280x850; production build passes.

Visual refinement: enemy name and shared HP now form one engraved header with a
small damage-trail health gauge. Prepared attacks show the base sword damage,
an arrow and the actual incoming damage, plus the protection reason. The class
resource has one named counter; duplicate pips and the Knight's duplicate block
caption are removed. Tapping the crest opens a short class explanation. Dungeon
background/navigation use the battle palette instead of the previous neon grid.
Scout daggers are drawn as straight, symmetric, bevelled steel blades with brass
guards and wrapped grips; each attack has its own composition. Hood, mark, boots,
venom and preparation art are also refined. Browser QA covers all four classes at
320x568, 375x667, 390x844 and 1280x850, class help and all ten Scout illustrations.
Turn controls fit without horizontal overflow. A real Scout attack updates HP and
plays its effect; reduced motion, blocked hits and spent-block forecasts are also
checked. Temporary QA families are deleted without resetting player progress.

All seven meals and 24 relics now have card-mode rules, categories, descriptions
and eligibility. Combat relics can be used during a saved hand. Campfire Charm
recovers a chosen discard at its normal card cost; first/last-card bonuses refresh
only on paid hands. Trial relics retain their noncombat purpose. Dice rules remain
supported for historical data; inventory IDs/quantities are preserved. Complete rules,
balance values and validation are in [expupdate-supplies.md](expupdate-supplies.md).
