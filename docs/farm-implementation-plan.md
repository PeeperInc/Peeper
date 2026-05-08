# Peeper Farm: 3x3 Farm, Products, Animals, and Free Fridge Stock

## Summary
Add a farm as a long-term economy feature. Players buy a Farm for `1000 ✦`, then use a `3x3` grid to build crop plots or animal pens. Farm products can be sold for coins or converted into free Fridge stock.

The Farm does not replace the current Fridge. It gives players another path:
`seeds/feed + time + care = cheaper Fridge days`.

Fast cycles are intentionally more profitable because they require more frequent player attention. Slow crops and animals are convenience choices, not optimal profit choices.

## Core Concept
- Farm purchase cost: `1000 ✦`.
- Farm screen: full-screen view.
- Grid: `3x3`, all 9 slots available immediately after buying the Farm.
- Each slot can become:
  - `Plot` for crops, cost `30 ✦`.
  - `Pen` for animals, cost `50 ✦`.
- Slots can be rebuilt later with confirmation.
- Rebuilding deletes the current crop/animal in that slot.

## Home UI Update
To make room for Farm:
- Move `Home` and `Farm` buttons into the main action area, above `Feed` and `Play`.
- Move `Guide` and `Age` up near the coins area.
- Reduce visual height of the status block.

## Crops
Crops are concrete products, but each crop also has visible `vegetable value` for Fridge recipes.

| Crop | Seed Cost | Grow Time | Yield | Veg Value Each | Sell Price Each | Net Profit / Day / Plot |
|---|---:|---:|---:|---:|---:|---:|
| Carrot | `1 ✦` | `5h` | `10` | `1` | `1 ✦` | `+43.2 ✦` |
| Tomato | `3 ✦` | `10h` | `9` | `2` | `2 ✦` | `+36 ✦` |
| Potato | `5 ✦` | `15h` | `8` | `3` | `3 ✦` | `+30.4 ✦` |

### Crop Balance Intent
- Carrot is best for active players.
- Tomato is the middle ground.
- Potato is slower, requires fewer logins, has worse profit per day, but gives a larger single harvest.

### Watering
- Watering is optional.
- Watering does not block growth.
- Every 6 hours, a plot can be watered.
- Watering reduces remaining grow time by `10%`.

### Crop Slot Behavior
- Empty plot: opens plant menu.
- Growing crop: opens details/water menu.
- Ready crop: click collects harvest into Farm inventory.

## Animals
Animals are concrete units in pens. They produce animal products only after being fed.

Feeding starts a production cycle. When the cycle ends, the product can be collected. If an animal is not fed, it does not die early; it simply does not produce.

| Animal | Buy Cost | Feed Interval | Feed Cost | Product | Yield | Animal Value Each | Sell Price Each | Net Profit / Day / Pen |
|---|---:|---:|---:|---|---:|---:|---:|---:|
| Chicken | `50 ✦` | `8h` | `3 ✦` | Egg | `5` | `2` | `2 ✦` | `+13.9 ✦` |
| Cow | `100 ✦` | `16h` | `7 ✦` | Milk | `5` | `3` | `8 ✦` | `+35.2 ✦` |
| Pig | `150 ✦` | `24h` | `10 ✦` | Truffle | `3` | `5` | `25 ✦` | `+43.6 ✦` |

### Animal Balance Intent
- Chickens are weak for coin profit but strong for Fridge value.
- Cows are balanced.
- Pigs are best for coin profit because truffles sell well, but truffles are less efficient for Fridge value than eggs.

### Animal Rules
- Animals do not reproduce in v1.
- Animals do not die early.
- Animals live `7 days`, then “retire” and free the pen.
- Feeding uses coins only, so vegetables stay dedicated to selling or Fridge stock.

## Inventory
Farm has its own internal inventory.

Inventory stores:
- Carrot
- Tomato
- Potato
- Egg
- Milk
- Truffle

Rules:
- Products do not spoil.
- Products can be sold.
- Products can be used to fill the Fridge.
- Products can be accumulated even if the player does not own a Fridge yet.

## Fridge Integration
Farm products can create free Fridge stock only if the player already owns the Fridge.

Fridge stock always requires both vegetables and animal products. There is no vegetables-only Fridge stock path.

### Recipes
| Fridge Stock | Requirement |
|---|---|
| `3 days` | `400 vegetable value + 120 animal value` |
| `7 days` | `900 vegetable value + 350 animal value` |

Rules:
- Farm-stocked Fridge costs `0 ✦`.
- It consumes products from inventory.
- It uses the same `fridge_food_until` logic as paid stock.
- If Fridge is active, new days extend current expiry.
- If Fridge is empty/expired, new days start from now.
- If player has no Fridge, show “Buy Fridge first”.

### Fridge Economy Notes
- A single carrot plot needs about `8.3 days` to produce enough vegetable value for one `3-day` Fridge recipe, and still cannot complete it without animal products.
- `5 carrot plots + 4 chicken pens` can make a `3-day` Fridge stock roughly every `2 days`.
- The same `5 carrot plots + 4 chicken pens` setup can make a `7-day` Fridge stock roughly every `4 days`.
- `5 carrot plots + 2 chicken pens + 2 pig pens` lets active players fill Fridge stock and still sell some high-value truffles.
- `4 carrot plots + 2 cow pens + 3 pig pens` is better for coins, but slower for Fridge stock.

## Profit Economy Notes
If all 9 slots are optimized only for coin profit:
- `9 carrot plots`: about `+388.8 ✦ / day`, high activity.
- `9 pig pens`: about `+392.1 ✦ / day` after animal purchase amortization, lower activity.
- `9 cow pens`: about `+316.8 ✦ / day` after animal purchase amortization.
- `9 chicken pens`: about `+125.1 ✦ / day` after animal purchase amortization, but excellent Fridge value.

## Backend Plan
Add Farm DB state:
- Farm ownership.
- Farm slots.
- Crop state.
- Animal state.
- Inventory quantities.
- Water cooldowns.
- Animal feed/production timers.

Suggested API:
- `GET /api/farm/state`
- `POST /api/farm/buy`
- `POST /api/farm/slots/:index/build`
- `POST /api/farm/slots/:index/plant`
- `POST /api/farm/slots/:index/water`
- `POST /api/farm/slots/:index/harvest`
- `POST /api/farm/slots/:index/buy-animal`
- `POST /api/farm/slots/:index/feed-animal`
- `POST /api/farm/slots/:index/collect-animal`
- `POST /api/farm/inventory/sell`
- `POST /api/farm/inventory/stock-fridge`

## Frontend Plan
Add:
- Farm full-screen view.
- 3x3 grid.
- Slot states:
  - Empty
  - Plot empty
  - Crop growing
  - Crop ready
  - Pen empty
  - Animal hungry
  - Animal fed/producing
  - Product ready
  - Retired/free slot
- Inventory panel.
- Sell controls.
- Fridge stock controls.
- Farm purchase screen/sheet.
- Home UI changes for `Home/Farm/Feed/Play`.

## Visual Direction
V1 uses emoji/CSS placeholders:
- Crops and products can use emoji.
- Animals can use emoji.
- Slots can be simple tile blocks.
- Sprites can be added later without changing backend logic.

## Rules And Constraints
- Farm works even if Peeper is dirty or dead.
- Farm does not consume energy.
- Farm should fit the 1-2 visits per day rhythm, while still rewarding more frequent visits.
- Farm should be slightly profitable, but not become the main money printer.
- Main value should be cheaper Fridge days through time investment.

## Test Plan
- Buying Farm costs `1000 ✦` and creates 9 slots.
- Building plot/pen costs correct amount.
- Planting validates plot and seed cost.
- Crops grow correctly over time.
- Watering respects 6h cooldown and reduces remaining time by 10%.
- Ready crop click harvests into inventory.
- Buying animals validates pen and coin cost.
- Feeding animals works with coins only.
- Fed animals produce correct products after their feed interval.
- Animal feed intervals are correct:
  - Chicken every `8h`.
  - Cow every `16h`.
  - Pig every `24h`.
- Animals retire after 7 days and free the pen.
- Inventory selling gives correct coins.
- Fridge stock always requires both vegetable and animal value.
- One plot alone cannot create Fridge stock quickly.
- Fridge stock fails if Fridge is not owned.
- Farm-stocked Fridge extends `fridge_food_until` correctly.
- Carrot/pig active play has higher profit per day than slow cow-only play.
- Chicken remains useful for Fridge value despite weak coin profit.
- Pig truffles sell well but are not the best Fridge product.
- Existing paid Fridge, food, Energy Drink, hunger, and death logic still work.

## Open Balance Notes
Initial values are v1 balance and should be tuned after testing:
- Crop yields and sell prices.
- Animal product yields.
- Fridge recipe values.
- Feed costs.
- Whether 3-day and 7-day Fridge stock are too easy or too hard.
