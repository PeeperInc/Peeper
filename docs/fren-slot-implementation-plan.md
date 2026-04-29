# Fren Slot Implementation Plan

## Goal

Add a new outfit slot named `fren` without breaking existing player wardrobes, purchases, or renders.

The `fren` slot is a new topmost outfit layer:

1. `body`
2. `face`
3. `head`
4. `hands`
5. `fren`

`fren` must render after `hands`.

## Phase 1: Infrastructure

This phase introduces the slot everywhere it needs to exist before any items are migrated.

### Backend

- Add `slot_fren` to `peepers`
- Allow `fren` in `shop_items.slot`
- Accept `slot_fren` in outfit save/update routes
- Include `slot_fren` in death cleanup logic
- Include `slot_fren` in family and bot renders
- Render `slot_fren` after `slot_hands`

### Frontend

- Add `fren` tab to Shop
- Add `fren` tab to Wardrobe
- Add `slot_fren` to wardrobe state/save flow
- Render `slot_fren` in `PeeperSprite`
- Add `fren` to Admin clothing slot creation/filtering

### Docs

- Document the new slot and render order
- Keep migration plan separate from infrastructure rollout

## Phase 2: Item Migration

This phase happens only after the final item list is confirmed.

### Migration inputs

- Exact list of `item_id` values that should move from `hands` to `fren`

### Migration work

- Update matching `shop_items.slot` from `hands` to `fren`
- Move equipped player items from `peepers.slot_hands` to `peepers.slot_fren` only for those migrated `item_id`s
- Leave all other `hands` items untouched

### Safety rules

- Only migrate approved `item_id`s
- Do not clear unrelated `slot_hands` items
- Run migration only once per item list

## Testing Checklist

- Shop shows a `fren` tab
- Wardrobe shows a `fren` tab
- Admin can create `fren` items
- Outfit save accepts `slot_fren`
- `fren` renders after `hands`
- Death clears `slot_fren`
- Family and bot renders include `fren`
- Existing `hands` items still work before migration

## Deferred Until Item List Arrives

- Data migration SQL/script for selected `item_id`s
- Optional UI copy polish for `fren`
- Any slot-specific balancing or art pass
