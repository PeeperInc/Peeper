# Card expedition supplies

Card mode keeps all 24 inventory IDs, existing quantities, recipes and three
relic slots. One optional meal is packed per expedition. Active relics and meals
are consumed once on successful use; a rejected action consumes nothing. Neither
costs AP or energy. Passive copies of the same relic do not stack and retain the
existing expedition reservation/consumption lifecycle.

The canonical card catalog is `backend/expeditions/cardSupplies.js`. The API
overlays these rules for card expeditions and the pre-expedition inventory.
Preparation and in-room sheets use server descriptions. Legacy dice expeditions
keep their original catalog and behavior.

## Meals

| Meal | Effect |
| --- | --- |
| Carrot Rations | Restore 2 AP, capped at 5. |
| Tomato Soup | Restore all HP; cannot revive a knocked-out hero. |
| Hearty Potato Meal | Gain 1 block on each new paid hand in the current combat room. Eating during a hand does not immediately add block. |
| Lucky Breakfast | Draw 2 cards into the current hand, capped at 8. |
| Warm Milk | Gain 1 energy in the current hand, capped at 6. |
| Truffle Treat | Upgrade the first awarded expedition relic by one actual rarity tier, capped at legendary. Does not guarantee a relic drop. |
| Magic Squash Pie | First damaging card of each paid hand deals +1 damage for the rest of the expedition. Eating after that attack takes effect next hand. |

Potato and pie require an open combat room. Breakfast and milk require an active
hand. Recovery meals cannot be wasted at the corresponding cap. Meals cannot be
used while knocked out. Previously eaten potato/pie effects are interpreted using
current card rules instead of retaining old +2/+3 damage on every card.

## Relics

| Relic | Category | Effect |
| --- | --- | --- |
| Old Torch | Trials, passive | +10% trial time and timing windows. |
| Bent Sword | Combat, passive | First damaging card each hand: +1 damage outside boss rooms. |
| Chalk Rune | Trials, active | +3 seconds on the next attempt in this room. |
| Rabbit Foot | Combat, passive | Prevent the first enemy hit that gets through other defenses this expedition. |
| Bone Die | Combat, active | Next damaging card in this room deals at least 5 damage. |
| Wooden Shield | Combat, active | Prevent the next unblocked enemy response in this room. |
| Tiny Shovel | Trials, active | Up to 2 room progress; cannot damage enemies or skip the starting camp. |
| Ration Box | Recovery, active | Heal 1 HP; cannot revive. |
| Rusty Lockpick | Trials, active | Next attempt automatically succeeds; normal AP cost still applies. |
| Loaded Die | Combat, active | Next damaging card in this room: +3 damage. |
| Family Banner | Combat, passive | Start each paid hand with +1 block. |
| Rootcutter's Axe | Combat, passive | First damaging card each hand against the boss: +2 damage. |
| Warding Nail | Combat, active | Shared shield prevents the next unblocked enemy response in this room. |
| Second Chance Coin | Trials, active | One free retry for the family after a failed attempt in this room. |
| Campfire Charm | Combat, active | Choose one card from your discard and return it to your hand at its normal energy cost. |
| Phoenix Feather | Recovery, active | End knockout recovery and return at 3 HP. |
| Hourglass Shard | Recovery, active | Restore 2 AP, capped at 5. |
| Banner of Last Stand | Combat, passive | Once per expedition, lethal enemy damage leaves the wearer at 1 HP. |
| Emerald Heart | Combat, passive | Once per paid hand, a last-card attack heals 1 HP. Full HP does not spend this trigger. |
| Crooked Compass | Loot, active | Add one relic roll for this cleared room to final rewards, within the four-relic cap; requires spending at least 1 AP here. |
| Mimic Tooth | Loot, passive | +50% to the wearer's share of room coins in final rewards. |
| Fate's Broken Die | Combat, active | Next three damaging cards in this room: +3 damage each. |
| Crown of Twenty | Combat, passive | Once per paid hand, a last-card attack deals +2 damage. |
| Root King's Signet | Combat, passive | Every damaging card against the boss: +1 damage. |

Relic protection does not prevent Mage overheat or self-damage. Trial relics must
be used before starting an attempt; an active attempt cannot be changed under the
player. Combat/recovery/loot relics may be used during a saved hand in its own
open room. A curse disables relic use for that hand without consuming the item.

## Hand and concurrency rules

- Extra draw/recovery caps the hand at eight and preserves card instances already
  held. Campfire chooses a specific card ID from the current private discard and
  requires the expected hand revision. The returned card gets a fresh instance.
- Supply use advances the hand revision. A stale play from a second tab is
  rejected rather than resolving with old HP, energy or defenses.
- Item consumption, hand changes and the action log share the caller's SQLite
  transaction. Retries use the original idempotency key and do not grant twice.
- A free carry after an ally kills the enemy does not refresh first-attack or
  last-card bonuses. Only a new AP-paid hand refreshes them.
- Returning a card with Campfire cannot repeatedly trigger Emerald Heart or Crown
  in one hand. Restore AP never grants contribution credit; spending it does.
- Existing reward activity recognizes paid card draws. Compass requires paid
  participation in its room; Truffle changes one rarity, and Mimic changes only
  room coins. Final reward payloads remain immutable on replay.

## Validation

Automated coverage includes all meal effects/caps, all inventory IDs, live-hand
use, replay and stale revisions, Campfire selection/cost, last-card repeat guards,
personal/shared protection forecasts, trial scope, curse rejection, legacy
behavior and final loot modifiers. The full suite passes 567 tests.

Browser QA uses a separate temporary local family and cleans it up afterwards.
It covers preparing food and relics from real inventory, ingredient reservation,
Campfire selection, food/relic activation during a hand, real damage and reload.
All four classes fit 320x568, 375x667, 390x844 and 1280x850 with a meal and three
relics. Supply touch targets are 44x44. Existing training players' HP, AP,
inventory and expedition progress are preserved. These checks establish rules
and usability; the proposed numerical balance still needs player feedback.
