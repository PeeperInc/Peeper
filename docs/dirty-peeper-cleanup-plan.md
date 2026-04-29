# Dirty Peeper Cleanup Plan

## Goal

Add a new dirt/poop care mechanic to the main Home screen.

If a Peeper stays unfed until hunger reaches `0`, the player must clean them before mini-games can be played again.

The mechanic should feel cozy and readable:

1. Peeper starves fully.
2. `poop` overlay appears.
3. `dirt` overlay appears.
4. Player taps poop away first.
5. Player enters sponge mode.
6. Player scrubs dirt off the Peeper.
7. Play button unlocks with a small visual release animation.

## Asset Assumptions

The following sprite files are expected in `html/sprites`:

- `poop.png`
- `dirt.png`

They are rendered as full transparent overlays on top of the existing Peeper sprite.

## Trigger Rules

- Hunger already drains to `0` over `8h`.
- The dirty mechanic triggers once per starvation cycle, not continuously.
- A starvation cycle is keyed by `peeper.last_fed`.

Why this matters:

- If the player cleans the Peeper while hunger is still `0`, the dirt must **not** instantly reappear.
- If the player feeds first and cleans later, the dirty state should remain until cleaning is completed.
- A new dirty event should only happen after a future feed causes a new `last_fed`, and that new cycle later reaches `0` hunger again.

## Backend State Model

Store state directly on the `peepers` row.

New fields:

- `dirty_state TEXT NOT NULL DEFAULT 'clean'`
- `dirty_cycle_key INTEGER DEFAULT NULL`

Allowed `dirty_state` values:

- `clean`
- `poop`
- `scrubbing`

Meaning:

- `clean`: normal state, games allowed.
- `poop`: poop is still present, sponge is not active yet.
- `scrubbing`: poop was removed, dirt still needs to be scrubbed.

## Dirty Cycle Logic

For a synced alive peeper:

1. Compute live hunger with the existing server logic.
2. If `live.hunger > 0`, do nothing.
3. If `live.hunger <= 0` and:
   - `dirty_state === 'clean'`
   - `dirty_cycle_key !== last_fed`
   then start a new dirty cycle:
   - `dirty_state = 'poop'`
   - `dirty_cycle_key = last_fed`

Important:

- Cleaning completion sets `dirty_state = 'clean'` but keeps `dirty_cycle_key` unchanged.
- This prevents immediate retrigger while the same starvation cycle is still active.
- Revive clears everything:
  - `dirty_state = 'clean'`
  - `dirty_cycle_key = NULL`

## Backend Responsibilities

Backend must remain the source of truth for game access.

Responsibilities:

- Persist dirty state.
- Include dirty state in every synced peeper payload.
- Trigger dirty state when starvation hits.
- Block mini-game reward/play route while dirty.
- Expose explicit endpoints for:
  - removing poop
  - finishing scrub cleaning

## Backend Files To Change

### `backend/database.js`

Add migrations:

- `dirty_state`
- `dirty_cycle_key`

Also normalize existing rows if needed:

- `dirty_state` defaults to `clean`

### `backend/peeperState.js`

Add shared helper logic:

- `syncDirtyState(userId, nowTs?)`
- `setDirtyState(userId, state, cycleKey?)`
- `removePoop(userId, nowTs?)`
- `completeCleaning(userId, nowTs?)`
- optionally `isPeeperDirty(peeper)`

`syncOwnedPeeper()` should:

1. Load peeper
2. Apply death if live HP already reached `0`
3. Apply dirty-cycle sync for alive peepers
4. Return serialized peeper including dirty fields

### `backend/routes/game.js`

Add dirty-state gating:

- `POST /api/game/play` must reject if `dirty_state !== 'clean'`

Add endpoints:

- `POST /api/game/cleanup/poop`
- `POST /api/game/cleanup/complete`

Expected behavior:

- `/cleanup/poop`
  - valid only when state is `poop`
  - transitions to `scrubbing`
- `/cleanup/complete`
  - valid when state is `scrubbing`
  - transitions to `clean`

Return payload should reuse the existing game response shape:

- `coins`
- `peeper`
- `cooldowns`
- `homeSummary`
- `assetVersion`
- `message`

### `backend/routes/auth.js`

No separate mechanic here, but login must continue returning synced peeper state via `syncOwnedPeeper()`.

## Frontend Responsibilities

Frontend owns:

- visual overlays
- coaching/hints
- scrub interaction
- local scratch progress
- release animation on the Play button

Frontend does **not** decide whether games are allowed.

## Frontend Flow

### State from server

Use `peeper.dirty_state` to derive:

- `isDirty`
- `needsPoopTap`
- `needsScrub`

### Step 1: poop state

When `dirty_state === 'poop'`:

- render `dirt.png` on top of the Peeper
- render `poop.png` on top of the Peeper
- animate the poop out with a quick spin + shrink when tapped
- show a small coach bubble in the free middle zone under the Peeper:
  - `Tap the poop first`
- tapping poop calls `POST /api/game/cleanup/poop`

### Step 2: scrubbing state

When `dirty_state === 'scrubbing'`:

- `poop` disappears
- `dirt` remains
- show a `Sponge` button as a separate control below the coach bubble with a small gap
- host both the hint and the button in a dedicated cleanup dock between the top Home glass stack and the bottom action panel
- the cleanup dock must be absolutely positioned inside the free middle zone so the Home layout does not jump
- tapping `Sponge` enables scrub mode

### Step 3: scrub mode

Use a canvas overlay positioned on top of the Peeper stage.

Canvas behavior:

- fill canvas with the `dirt` image
- erase brush circles using:
  - `globalCompositeOperation = 'destination-out'`
- track approximate cleaned progress
- once threshold is reached, mark cleaning complete

Completion threshold:

- `0.9` (90% of the original dirt mask must be scrubbed away to avoid stuck edge pixels)

Recommended brush radius:

- around `18px` to `26px`, scaled by rendered stage size

Desktop behavior:

- scrub while holding pointer down and moving
- render a sponge sprite/emoji that follows the pointer across the whole screen

Mobile behavior:

- scrub while finger is down and moving
- render the sponge under the finger path

Do not replace the system cursor globally. Instead, draw a separate sponge indicator layer that follows the live pointer position.

## Play Button Lock

When dirty:

- visually disable the Play button
- show crossed ribbons / tape in `X` shape over the button
- show a message under the button:
  - `Clean your Peeper first`
  - or
  - `Peeper is dirty and needs a bath`

If user still taps the disabled Play area:

- show a toast:
  - `Clean your Peeper first`

When cleaning completes:

- run a short unlock animation on the ribbons:
  - fade
  - slide away
  - scale down

Then Play returns to normal behavior.

## Suggested Frontend Files

### `frontend/src/api.js`

Add:

- `removePeeperPoop()`
- `completePeeperCleaning()`

### `frontend/src/context/AppContext.jsx`

Add actions:

- `removePeeperPoop`
- `completePeeperCleaning`

Each action should update:

- `peeper`
- `coins`
- `cooldowns`
- `homeSummary`
- `assetVersion`

### `frontend/src/screens/HomeScreen.jsx`

Add:

- dirty-state derived flags
- poop tap handling
- cleanup dock placement between the top glass stack and bottom action panel
- sponge mode button
- play-lock visuals
- unlock animation state
- overlay rendering around the main Peeper stage

### New component: `frontend/src/components/PeeperCleaningOverlay.jsx`

Responsibilities:

- load `dirt.png`
- manage scratch canvas
- track pointer/touch movement
- render sponge indicator
- call `onComplete()` once threshold reached

Props:

- `size`
- `active`
- `visible`
- `onComplete`
- `showCoachHint`

### Optional helper component

If the Home screen grows too much:

- `frontend/src/components/LockedPlayButton.jsx`

Responsibilities:

- button look
- tape ribbons
- lock message
- unlock animation

## Data Contract

Server peeper payload must now include:

- `dirty_state`
- `dirty_cycle_key`

Frontend derived flags:

- `isDirty = dirty_state !== 'clean'`
- `needsPoopTap = dirty_state === 'poop'`
- `needsScrub = dirty_state === 'scrubbing'`

## API Contract

### `POST /api/game/cleanup/poop`

Request body:

```json
{}
```

Success:

```json
{
  "message": "Poop removed!",
  "coins": 123,
  "peeper": { "...": "..." },
  "cooldowns": { "feed": 0, "play": 0, "action": 0 },
  "homeSummary": { "...": "..." },
  "assetVersion": "..."
}
```

### `POST /api/game/cleanup/complete`

Request body:

```json
{}
```

Success:

```json
{
  "message": "Peeper is clean again!",
  "coins": 123,
  "peeper": { "...": "..." },
  "cooldowns": { "feed": 0, "play": 0, "action": 0 },
  "homeSummary": { "...": "..." },
  "assetVersion": "..."
}
```

### `POST /api/game/play`

New failure case:

```json
{
  "error": "Clean your Peeper first!"
}
```

## Performance Notes

The scrub interaction should stay local until completion.

Do not:

- send pointer coordinates to the server
- re-render the whole Home screen on every brush point

Do:

- keep brush progress inside one overlay component
- only send one completion request when threshold is met

## Edge Cases

- If player refreshes the page during scrubbing:
  - state stays `scrubbing`
  - dirt returns fully
  - player can continue by pressing sponge again

- If player feeds while dirty:
  - dirty state remains
  - games stay blocked

- If player dies while dirty:
  - death flow wins
  - revive resets dirty state

- If player tries to remove poop twice:
  - backend should return current synced state or a safe error

- If player completes cleaning after state already became `clean`:
  - backend can return a safe no-op success or latest synced state

## Visual Defaults

Coach texts:

- poop step: `Tap to clean this first`
- scrub step: `Press Sponge and scrub`
- blocked play: `Clean your Peeper first`

Sponge button text:

- `🧽 Sponge`

Completion text:

- `All clean!`

## Implementation Order

1. Add DB fields and server dirty sync.
2. Block game route on backend.
3. Add cleanup endpoints.
4. Add AppContext/API hooks.
5. Add poop + dirt overlays on Home screen.
6. Add scrub overlay component.
7. Add play-lock ribbons and unlock animation.
8. Update README files.
9. Run targeted verification.

## Acceptance Criteria

- Hunger reaches `0` after the existing starvation timing.
- Peeper becomes dirty exactly once per starvation cycle.
- Games cannot be played while dirty.
- Poop must be tapped away before scrubbing.
- That poop tap target must remain clickable even when the cleanup overlay is rendered inside the decorative Home room scene wrapper.
- Transparent layout spacers above the room scene must not intercept pointer events in the cleanup zone.
- Dirt can be removed by dragging sponge over the Peeper.
- Cleaning completion unlocks Play again.
- Refreshing the page preserves dirty state.
- Feeding does not bypass cleaning.
- Revive clears dirty state.
