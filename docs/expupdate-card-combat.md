# ExpUpdate: asynchronous card combat

Working implementation on `ExpUpdate`. New expeditions use `map.combatMode = cards_v1`.
Existing expeditions retain dice combat, prepared items, progress and unclaimed rewards.
The separate farm/pantry patch is not included. No production rollout is part of this development step.

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

Knight builds block, spends it on shield attacks, and leaves wards for allies.
Scout builds turn-local combo, spends it on finishers, dodges and exposes enemies.
Mage builds persistent heat through spells and consumes it through Discharge. Ending a turn at four or more heat costs one HP; Vent converts cooling into energy.
Cleric earns persistent light through attacks and protection, then chooses healing or Judgement.

Each class starts with eight cards: two Strikes, two Guards, four class cards.
Helping clear a combat room offers three class cards. The player can add one to discard or skip; maximum deck size is sixteen. Rewards never replace an already paid hand.
Expose has two shared hit charges. A ward protects one other family member's response.

## Presentation and validation

Mobile-first two-column hand, readable costs, large Draw/End buttons, enemy intent,
shared HP, visible class resource, layered equipped Peeper, attack/hit animations,
reduced-motion support and a deck inspection drawer.

`frontend/dev/expedition-cards.html` runs the real expedition screen against the local backend.
The isolated local fixture uses `tmp/expupdate-local.db`; no production data is copied or modified.

Core regression tests: `backend/expeditions/cardCombat.test.mjs`.
Before release, playtest pacing and class balance with multiple family members;
automated correctness does not establish fun or economic balance.

Validation of this iteration: 481 automated backend/frontend tests passed;
production frontend build passed. Browser checks played a hand with each of the
four classes, reloaded paid hands, and ended turns without an extra AP debit.
Layout checks covered 320x568, 375x667, 390x844 and 1280x850, including the normal
Home -> Family -> Expedition entry and reduced-motion rendering.

Existing combat relics have card-mode descriptions and effects: first-hit weapon
bonuses, last-card attack bonuses, armed damage floors/boosts, personal and family
shields, Rabbit Foot and Last Stand. Dice-mode descriptions and effects remain
unchanged. Relics are activated before drawing a hand; provisions may be used
during a saved hand. Noncombat relic effects retain their existing rules.
