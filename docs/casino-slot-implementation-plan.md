# caSino Mini-Game — Full Implementation Plan

Status: approved for implementation  
Last updated: 2026-04-03

## 1. Goal

Add a new lighthearted profit-focused mini-game called `caSino`.

Design goals:

- always feels rewarding
- no losing outcomes
- rewards are server-authoritative
- jackpot is shared across all players
- the game is readable even though the symbols themselves do not have visible rarity tiers

The player should feel:

- “every spin gives me something”
- “matching symbols still matters”
- “Sino is the special symbol”
- “the jackpot keeps growing because everyone is feeding it”

## 2. Core Rules

Each spin:

- costs `1` energy
- costs `5` coins from the player
- contributes `1` coin into the shared jackpot pool
- always returns a guaranteed payout

No losing spins exist.

## 3. Symbols

The slot uses exactly `10` symbols:

- `game_toy_1`
- `game_toy_2`
- `game_toy_3`
- `game_toy_4`
- `game_toy_6`
- `game_toy_7`
- `game_toy_8`
- `game_toy_9`
- `game_toy_10`
- `sino`

Notes:

- `game_toy_5` is intentionally excluded
- `sino` is the only special symbol
- symbol visuals are loaded from `html/sprites/`

## 4. Shared Jackpot

Shared jackpot behavior:

- pool starts at `0`
- every spin adds `1` coin to the pool before the result is resolved
- `Sino-Sino-Sino` wins the current full pool
- after jackpot is won, pool resets to `0`

UI requirements:

- jackpot must be visible in the mini-game list for `caSino`
- jackpot must be visible on the game screen itself
- after the user spins, they should immediately see that their own spin changed the jackpot value

Initial implementation approach:

- backend stores the pool in `app_settings`
- frontend receives the current jackpot from normal state sync and from spin responses
- while the `caSino` screen is open, frontend can poll the latest jackpot every few seconds so it feels alive

## 5. Reward Logic

There are no losses.

The server does **not** roll a random screen and then derive payout from it.

Instead:

1. server chooses an outcome tier
2. server constructs a valid 3-symbol result for that tier
3. client animates those exact symbols

This guarantees:

- controlled economy
- exact jackpot odds
- no client cheating
- clear, human-readable combination rules

## 6. Winning Combinations

The game uses a single 3-symbol line.

Approved payout table:

- `A A B` → `8`
  - two matching ordinary toys
  - `A` must be an ordinary toy
  - `B` must be a different ordinary toy

- `S A B` → `10`
  - one `sino`
  - two different ordinary toys
  - symbols can be visually shuffled across the 3 slots

- `A A A` → `12`
  - three matching ordinary toys

- `A A S` → `13`
  - a matching pair of ordinary toys plus one `sino`

- `S S A` → `15`
  - two `sino` plus one ordinary toy

- `S S S` → `jackpot`
  - payout equals the full current shared jackpot pool

Legend:

- `A` = any ordinary toy from the 9 regular toys
- `B` = any other ordinary toy, different from `A`
- `S` = `sino`

These are the only generated outcomes.

That keeps the logic readable:

- pair = good
- triple = better
- `sino` upgrades the line
- `3 sino` = jackpot

In the `3x3` visual reel view:

- only the center row is allowed to resolve into one of the approved payout patterns
- the top and bottom rows should be precomputed as harmless random-looking ordinary toy rows
- those decorative rows must never accidentally form another visible payout pattern
- the final stopped `3x3` grid must already match what the player saw at the end of the spin, with no post-stop row swap

## 7. Jackpot Odds

Required jackpot chance:

- `0.01%`
- i.e. `1 in 10,000` spins on average

Implementation note:

- jackpot must be chosen by weighted server RNG
- it must not depend on equal-probability reel physics

Expected pool size:

- if each spin contributes `1`
- average jackpot before hit ≈ `10,000` coins

## 8. Non-Jackpot Weights

Since the user wants this to be a fun earning game, the non-jackpot outcomes should stay generous.

Suggested first balancing pass:

- `A A B` → `8` → `34.5%`
- `S A B` → `10` → `25%`
- `A A A` → `12` → `20%`
- `A A S` → `13` → `14%`
- `S S A` → `15` → `6.49%`
- `S S S` → jackpot → `0.01%`

Total:

- `100%`

This is intentionally generous and profit-positive, matching the approved “fun farm” direction.

## 9. Expected Economy

Per spin:

- player pays `5`
- jackpot pool gets `+1`
- player always wins at least `8`

Approximate average non-jackpot payout with the suggested weights:

- `8 * 0.345 = 2.76`
- `10 * 0.25 = 2.50`
- `12 * 0.20 = 2.40`
- `13 * 0.14 = 1.82`
- `15 * 0.0649 = 0.9735`

Average non-jackpot payout:

- about `10.45`

Expected jackpot contribution:

- about `1` coin of pool per spin on average

This means the game is strongly positive EV, which is acceptable here because the user explicitly wants a cheerful earning mini-game rather than a sink.

## 10. Backend Responsibilities

Backend must own:

- the shared jackpot pool
- caSino RNG
- payout calculation
- coin deduction and coin grant
- energy spending through the normal fun/energy system
- returned reel symbols

The client must never choose the reward.

## 11. Backend Data

Use `app_settings` for the shared pool:

- key: `casino_jackpot_pool`
- value: integer string

Helpers to add in `backend/appSettings.js`:

- `getCasinoJackpot()`
- `setCasinoJackpot(value)`
- `addCasinoJackpot(amount)`
- `resetCasinoJackpot()`

No extra table is required for v1.

## 12. Backend API

### Extend existing synced responses

Include `casinoJackpot` in:

- `POST /api/auth/login`
- `GET /api/game/state`
- normal game response builder in `backend/routes/game.js`

This lets the Home screen and game menu show the current jackpot without a dedicated bootstrap call.

### New endpoint

Add:

- `POST /api/game/casino/spin`

Request body:

- empty for v1

Behavior:

1. validate player exists
2. sync peeper state
3. reject if dead
4. reject if dirty
5. reject if not enough coins for the spin cost
6. reject if no energy
7. add `1` coin to jackpot pool
8. roll weighted outcome tier
9. generate concrete 3-symbol result
10. compute payout
11. deduct `5` coins
12. add payout coins
13. spend one energy using the same fun system as other mini-games
14. if jackpot hit:
   - pay current pool after the contribution
   - reset jackpot to `0`
15. return updated game state plus caSino result payload

Response shape:

- `message`
- `coins`
- `peeper`
- `cooldowns`
- `homeSummary`
- `assetVersion`
- `casinoJackpot`
- `spin`
  - `symbols`
  - `pattern`
  - `payout`
  - `jackpotWon`
  - `poolBefore`
  - `poolAfterContribution`
  - `poolAfterPayout`

## 13. Outcome Generation Rules

### `A A B`

- choose one ordinary toy `A`
- choose another different ordinary toy `B`
- shuffle `[A, A, B]`

### `S A B`

- choose two different ordinary toys `A`, `B`
- shuffle `[sino, A, B]`

### `A A A`

- choose one ordinary toy `A`
- return `[A, A, A]`

### `A A S`

- choose one ordinary toy `A`
- shuffle `[A, A, sino]`

### `S S A`

- choose one ordinary toy `A`
- shuffle `[sino, sino, A]`

### `S S S`

- return `[sino, sino, sino]`

## 14. Frontend Responsibilities

Frontend owns:

- reel animation
- visuals
- spin button states
- jackpot display animation
- result announcement

Frontend does **not** decide reward.

## 15. Game Screen UX

The caSino screen should have:

- top logo area that prefers `sinofull` and falls back to `sino`
- title text: `caSino`
- jackpot label with live number
- center reel area with 3 slots
- a `Combos` button that opens a readable payout sheet
- a draggable pull-down lever that clearly communicates the `5 ✦` spin cost
- close/back control like other games

Visual direction:

- cozy arcade
- slightly shiny casino look
- not real-gambling dark grim aesthetic
- more toy machine / friendly fun than harsh casino realism

## 16. Spin UX

When player taps `Spin`:

1. the user pulls the lever downward
2. the 3 vertical reels begin spinning behind a masked slot window
3. request is sent to backend
4. backend returns exact outcome
5. reels stop sequentially at about `1s`, `2s`, and `3s`
6. result banner shows:
   - combination name
   - payout
   - jackpot text if hit
7. jackpot number animates to the returned value
8. button re-enables

Important:

- the user should see their spin contribute `+1` to the jackpot unless they won and reset it
- if jackpot is won, show a bigger celebration layer
- the reels should feel like a real slot machine, not a simple symbol swap
- if jackpot is won, the backend should also broadcast a Telegram notification to all users with the winner name and jackpot amount
- the lever hint should make it obvious that each pull costs `5 ✦`

## 17. Home Menu Integration

Add new entry to the mini-game list:

- id: `casino`
- name: `caSino`
- emoji/icon can use `sino` sprite in the actual screen, but the menu card may use `🎰` or `✨`
- reward label should mention:
  - `8–15 ✦ + Jackpot`

The mini-game list card should also show current jackpot under the description or inside the reward chip.

## 18. Frontend Files To Change

### `frontend/src/games/CasinoGame.jsx`

New component for:

- slot screen layout
- reel animation
- spin request
- result display
- jackpot display

### `frontend/src/screens/HomeScreen.jsx`

Add:

- new game entry in `GAMES`
- lazy import for `CasinoGame`
- pass `casinoJackpot`
- pass dedicated `spinCasino` callback

### `frontend/src/api.js`

Add:

- `spinCasino()`

### `frontend/src/context/AppContext.jsx`

Add:

- `casinoJackpot` to global state
- `spinCasino()` action
- reducer support for jackpot updates

### Optional helper

- `frontend/src/utils/casinoSymbols.js`

Could centralize:

- symbol IDs
- label helpers
- sprite fallback helpers

## 19. Backend Files To Change

### `backend/appSettings.js`

Add jackpot helpers.

### `backend/routes/auth.js`

Return `casinoJackpot` in login payload.

### `backend/routes/game.js`

Add:

- jackpot response plumbing
- `POST /casino/spin`
- symbol generation
- weighted RNG

### `backend/database.js`

No new table required, but ensure the default app setting for the jackpot exists.

## 20. Anti-Cheat / Correctness

- never accept client-submitted slot rewards
- never let client choose symbols
- server resolves everything
- spin endpoint must reject when player lacks:
  - coins
  - energy
  - alive state
  - clean state

## 21. MVP Implementation Order

1. Add plan doc
2. Add jackpot helpers to backend
3. Add caSino spin endpoint
4. Add jackpot to login/game-state responses
5. Add frontend API/context plumbing
6. Build `CasinoGame.jsx`
7. Wire into Home menu
8. Update README files
9. Test in dev

## 22. Manual Test Checklist

### Basic

- game appears in mini-game list
- jackpot visible before opening
- jackpot visible on the game screen
- `Combos` sheet opens and clearly shows every approved payout pattern
- spin consumes `5` coins
- spin consumes `1` energy

### Rewards

- non-jackpot spins only return the approved payout tiers
- symbols always visually match the payout tier
- user always wins at least `8`

### Jackpot

- each spin visibly adds `+1` to the pool
- jackpot hit pays the whole pool
- jackpot resets to `0` after payout

### Blocking

- dead Peeper cannot spin
- dirty Peeper cannot spin
- insufficient coins blocks the spin
- insufficient energy blocks the spin

### Sync

- Home menu jackpot updates after returning from the game
- game screen jackpot updates after each spin
- the current spin visually adds `+1` to the displayed jackpot before the final server value settles
