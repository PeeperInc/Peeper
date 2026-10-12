# Beyond the Fog — local implementation

Branch: `astraupdate`. No deployment or production data changes. Built without subagents.

## Play loop and world rules

A fresh world starts at Crooked Post, with empty shared stores and a broken river crossing. The full-screen map shows one community objective and contextual actions at the selected location. Selecting a location moves the camera; the player walks only after choosing Follow the trail. Existing dressed Peeper sprites appear on the map.

1. Walk to Mosswood Mill and saw timber. The quarry supplies iron.
2. Return to Crooked Post to stack and trim construction planks.
3. Reserve two planks for a handcart or six for a two-player wagon, assemble a public caravan at Crooked Post, and invite players through Global Chat. Joining a party starts an actual walk to its assembly point. Departure waits for everyone to arrive.
4. The first caravans stop on the west bank. 3200 delivered planks rebuild the bridge for everyone. The road graph has exactly one river-crossing edge and the server keeps it closed until completion.
5. The bridge reveals Mirewake's hollow, the Supply Mill and Reedbank Armory. The dragon is visible but cannot be attacked during preparation. No second construction project is required.
6. Complete three workshop rounds to pack **3 expedition kits from 1 timber + 1 iron**, or forge **3 weapons from 1 timber + 3 iron**. Both outputs enter shared stores.
7. Contribute crafted items to two distinct expedition reserves: **900 kits and 900 weapons**. The server caps each contribution at the missing amount and available stock. Filling both reserves opens the dragon for everyone.
8. Walk to the hollow. Launch free 9.5-second attempts, dodge the three charges and counter during recovery. An accepted successful recording removes up to 12 HP. Damage persists after every attempt, even when the player leaves. Kits, weapons, coins and energy are not spent per attack.
9. On zero HP, a fixed **3000-coin pool** is distributed by actual accumulated damage, including to offline contributors. No last-hit bonus. Integer payouts use largest remainders with deterministic user-ID tie-breaking; total paid equals the entire pool exactly.
10. After 24 hours a new expedition starts in preparation. Past payouts remain visible. The bridge stays open; the new cycle requires fresh kits and weapons.

A completed delivery leaves its party at the delivery site. Failed deliveries refund cargo. After bridge completion, caravans become maintenance work. Preparation resources are consumed once per cycle; there is no automatic regeneration of boss HP during battle. Cycle HP, pool and preparation targets are snapshotted in SQLite, so editing configuration does not silently change an active expedition.

## Hands-on activities

`GestureStage.jsx` dispatches workshop gestures and the six new `ArcadeStage.jsx` modes. Canvas preserves object proportions; DOM controls provide instructions and accessible buttons. The pure `backend/frontier/core/index.cjs` module owns arcade simulation and scoring, shared by client and server. Vite exposes its single static export as ESM and watches the original source, avoiding a stale optimized copy in local development. Existing workshop gesture validators remain in `gestures.js`.

| Activity        | Input and evaluation                                                                                                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saw timber      | Six full reciprocating strokes inside two high-contrast rails drawn over the tool. The central ±5% of canvas width has no precision penalty; average deviation up to 9.8% passes, allowing hand wobble. An alignment marker remains above the blade.                                                                  |
| Mine iron       | Pick up the bottom-right grip, drag the hammer head onto the active fracture, and release in a moving gold power window. The head sits above the finger. Three cracks must break within five swings; misses spend a swing and reset the visible series. The server evaluates aim, timing and minimum travel distance. |
| Make planks     | Stop five moving boards. Overhang is removed; close alignment snaps flush.                                                                                                                                                                                                                                            |
| Pack expedition kits | Drag and rotate shaped bandages, rope and remedies into a 4×3 satchel without overlap.                                                                                                                                                                                                                                |
| Drive caravan   | Change lanes, avoid stumps and recover three crates. Staying in one lane cannot clear a generated round.                                                                                                                                                                                                              |
| Guard party     | Sweep through moving spore beetles and avoid friendly golden lantern bugs.                                                                                                                                                                                                                                            |
| Repair axle     | Rotate a variable 3×3 pipe network to connect the tank and axle within a turn budget.                                                                                                                                                                                                                                 |
| Strike boss     | Dodge telegraphed attacks and counter during recovery. At least two dodges and one counter are required.                                                                                                                                                                                                              |
| Heal party      | Connect adjacent matching herbs, brew chains and manage four moves across changing boards.                                                                                                                                                                                                                            |

These are gesture tasks, not multiple-choice word challenges. The path and packing validators have positive and negative tests. They are not a promise of bot-proof input: browser clients can fabricate trajectories. Rewards remain server-timed and transactional.

## Rewards and persistence

Work ends automatically on three successful rounds. A miss never raises the requirement. Gathering can be collected early in proportion to finished rounds; incomplete recipes return their reserved ingredients. Receipts state the actual materials, XP and coin paid, then offer the next useful location. The three-minute job deadline is a recovery/expiry safeguard. Recipe yields are explicit and do not depend on a legacy mill upgrade.

New journeys contain three 15-second encounters. Solo players rotate roles; groups keep their selected role. A contributor needs two successful encounters. A two-plank handcart needs one qualified player; a six-plank wagon requires two joined players before departure and two qualified contributors to deliver. Failed trips refund all cargo, and construction overflow returns to shared stores. Existing persisted missions retain their snapshotted round counts and success requirements.

Work and journeys share one persisted 180-second coin payment interval. Successful activities between payments still grant materials and XP. One commitment per account prevents simultaneous work or travel missions. No energy or daily earning quota is used.

SQLite transactions own reservations, settlements, construction, boss contributions, honors and cosmetics. Operation identities and action nonces prevent duplicate settlement. Travel, jobs and missions survive a process restart. Internal user IDs own progress, so a Telegram-ID account transfer does not orphan it. Schema installation adds location/travel, coin interval and mission cargo/crew/round snapshot columns idempotently. Old active challenges are upgraded on read.

## Interface and art

Olive, parchment and brass HUD; visible shared resources; custom rough-ink icons; contextual location actions; Orders, Expeditions, Chat and Camp as the four main destinations. Distant areas remain behind fog until the relevant community project is finished. Boss information is absent from the initial state payload and initial journal. The weekly board grants qualified contributors up to three persistent seals and 30 XP, with no extra coins. See `frontier-redesign.md` for references, rules and the pacing model.

Art is local in `frontend/src/assets/frontier/`: original/repaired marsh, workshop, cart, boss and the new transparent `workshop-props.png` atlas. The new atlas was generated with the built-in image tool and copied intact from Codex's generated-image directory. Canvas source rectangles isolate the six props at runtime; alpha is preserved. The first atlas generation was rejected by the image usage limit; the retry succeeded after the user renewed limits.

Atlas prompt: one transparent 1536×1024 sprite atlas containing a bark-covered horizontal log, an iron-bearing irregular boulder, a grainy wooden plank, a vertical hand saw, a hammer and a hand plane. Wonky Apu/Paint-inspired ink contours, flat earthy colors, uneven shadow tones and drawn texture. Isolated silhouettes, no scene, lettering, UI or grid. The generated object bounds vary from the requested grid, so the renderer uses inspected bounds rather than assuming equal tiles.

Pixi renders the world artwork; DOM controls remain accessible. A DOM art/fog fallback retains movement and destination controls if WebGL fails. The camera clamps to map bounds. Telegram top/bottom safe-area variables are respected. The main app tab bar sits behind the game overlay.

## Network and authentication

Existing Telegram init-data validation protects REST commands. WebSocket clients authenticate by posting a single-use 30-second ticket through the socket, not by placing credentials in a URL. Player positions come from persisted server travel, never from client presence messages. Presence broadcasts are coalesced and encoded once per batch.

Reads/writes are limited per account, tickets and sockets are bounded, slow sockets disconnect, and clients reconnect with bounded backoff. Existing Global Chat mute and slow-mode checks apply to recruitment. One Node process per SQLite world is currently supported; multiple processes need shared presence/ticket storage.

## Local preview

Current isolated QA database: `tmp/frontier-siege-dev.db`. Original `tmp/frontier-v3-dev.db` is retained. API port 4013; Vite port 5179. `999999` is the original local Mira test account; `999998` is Reed, used for the new delivery checks. A genuinely fresh database starts with a broken bridge and empty stores. The siege QA database is deliberately advanced: bridge complete, reserves filled through the UI, battle open. `999997` / Fern is the current living QA player; earlier Peeper pets may have died during elapsed real time. Earlier local databases are retained; their boss HP is not automatically rescaled by content edits. `frontend/dev/frontier-playroom.html` is a development-only entry for the six new modes, with fresh seeds and weather selection. It is not part of the production build and awards no currency.

From `backend` in PowerShell:

```powershell
$env:NODE_ENV='development'
$env:PORT='4013'
$env:PEEPER_DB_PATH='C:/Users/Vivor/Desktop/peeper_v40/tmp/frontier-siege-dev.db'
node server.js
```

From `frontend`:

```powershell
$env:PEEPER_API_TARGET='http://127.0.0.1:4013'
npm run dev -- --host 127.0.0.1 --port 5179
```

Open `http://127.0.0.1:5179/?devUser=999999&devName=Mira`, then World. Direct practice room: `http://127.0.0.1:5179/dev/frontier-playroom.html`.

## Verification — 2026-09-29

322 backend and 25 frontend tests pass. Production compilation passes; existing main-app and fishing chunk-size warnings remain. Logs: `tmp/frontier-siege-backend-final.txt`, `tmp/frontier-siege-frontend-final.txt`, `tmp/frontier-siege-build-final.txt`.

New coverage includes both preparation gates, capped and idempotent contributions, correct crafting yields/refunds, persisted damage across restarts, foreign and accelerated recordings, abandoned attempts, overkill, exact proportional payouts, offline recipients, atomic rollback on failed credits, and cycle reset. Authenticated HTTP tests issue concurrent final attacks and verify exactly 15 actual damage and one 101-coin payout pool; an injected client damage field has no authority.

The one-time migration cancels legacy boss lobbies/attempts and refunds their kits, returns the old kit recipe's exact ingredients, releases commitments, and keeps old honors without turning them into new paid damage. A second schema install does not refund again.

Actual browser verification: filling only the kit reserve kept battle closed; filling weapons opened it; travel reached the hollow; a full round played through visible lane cues and buttons landed three counters, saved 12 damage, and reduced shared HP from 300000 to 299988. A later failed attempt retained that damage. The boss screen originally mounted a zero-sized canvas; its flex layout is now fixed and measured at desktop, 390×844 and 320×640. Small-screen controls remain in view. Result screen shows round quality, permanent damage and free retry.

New forge verification: at 320×640, completed all three weapon rounds through browser controls and received 3 weapons in the shared stock, 15 XP and 1 coin. The receipt opened the correct shared-battle panel and preserved earlier boss damage. Leaving an unfinished batch returned its ingredients. The new forge uses heat/cooling, six section strikes and water tempering; it starts only after the player presses Begin forging. Cold strikes, spam, interrupted heating, overheating recovery and frame-rate consistency have rule tests. Keyboard Enter toggles bellows; pointer/Space holds them. Physical touch remains unverified.

Separate development-only `frontend/dev/frontier-world.html` fixtures render bridge, preparation, battle and victory states with real components; they do not call the API. `frontend/dev/frontier-playroom.html` exercises arcade rules without currency.

September 29 follow-up: the forge idle screen does not spend round time or animate continuously, and completed tempering has a brief visible result before the next round. A fresh browser round scored 100%. Preparation and victory cards were inspected at mobile size. Fixed a map-unmount race in the animation/resize handlers and deferred Pixi destruction until initialization completes; four consecutive home/world transitions produced no new console errors.

Art includes generated transparent dragon/armory assets and a dedicated swamp arena backplate. These are local assets, not remote image dependencies.

Earlier work verified sawing with lateral wobble, partial gathering, plank crafting, a real-time 45-second solo delivery, recipe cancellation refunds, authored roads and the eastern boardwalk. Physical iOS/Android touch input, a 200-player load test, production-host performance and sustained fun remain unverified. Pacing is an explicit model, not player telemetry; see `frontier-redesign.md`.
