# Reedbank: replayable commons redesign

Updated 2026-09-29. Local development only; no deployment. The working direction is a repeatable cooperative world, with permanent construction as its opening chapter. A compulsory month of resource collection is deliberately not the retention mechanism.

## References and adaptations

- **Clash of Clans / Whiteout Survival:** resource counters at the edge, a visible world in the middle, contextual building actions and thumb-accessible navigation. Reedbank uses painted timber, olive controls, parchment panels and irregular frog illustrations. It does not inherit the promotional sidebars. Visual reference inspected: [Whiteout Survival screenshots](https://www.levelwinner.com/whiteout-survival-beginners-guide-tips-tricks-strategies/).
- **Hay Day Bingo Derby:** shared objectives arranged in a grid; rows encourage people to coordinate different kinds of work. [Supercell's rules](https://support.supercell.com/hay-day/en/articles/bingo-derby.html). Reedbank uses a global 3×3 board open to everyone, with no family membership requirement. Its orders count each eligible participant's completed activity, not just party departures.
- **Fruit Ninja:** selective swipes, friendly objects to avoid, and multiple targets in one sweep. [Halfbrick's guide](https://www.halfbrick.com/blog/the-ultimate-beginners-guide-to-fruit-ninja). Adapted as clearing spore beetles while sparing lantern bugs; no copied game artwork.
- **Stack:** timing a moving piece and losing its overhang. [Publisher page](https://www.ketchappgames.com/game-stack). Adapted as a five-board construction batch, with generous alignment snapping and persistent loss of usable width.
- **Mini Motorways:** familiar rules with changing conditions and repeatable challenges. [Developer's daily-challenge update](https://dinopoloclub.com/2023/05/04/buckle-up-for-new-daily-challenges-with-the-extra-for-experts-update/). Reedbank rotates clear weather, rain, wind and fresh herbs; these affect steering, insect drift or recipe requirements.
- **Last Meadow Online:** Discord announced it as a short event, April 1–7, 2026, with cooperative classes and a common boss. That is useful inspiration for a clear shared goal, but not evidence of a month-long retention loop. [Discord announcement](https://discord.com/blog/last-meadow-online-announcement).

These are design references, not claims that our game has equivalent polish or measured retention. New local skills installed: `web-game-foundations`, `game-ui-frontend`, `game-playtest` from OpenAI's game-studio plugin; `game-designer` from FMG-Studio/codex_skills. Their guidance informed simulation/render separation, protected playfields and explicit playtest limitations.

## Play and decisions

| Activity         | Input and decision                                                                     | Failure / recovery                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Timber           | Six back-and-forth saw strokes; keep the cut broadly within visible guide rails        | Lateral drift reduces cut quality. The saw does not cover the guides; minor wobble is tolerated                  |
| Ore              | Drag the hammer from its dock, aim at a crack, release in the power window             | Five strikes to break three cracks. Weak, overpowered and misplaced hits consume a strike                        |
| Planks           | Stop five moving boards over the stack                                                 | Overhang is cut away; the next board has less room. Close alignment snaps flush                                  |
| Expedition kits       | Fit and rotate three shaped items in the satchel                                       | Rearrange freely before submitting                                                                               |
| Weapons | Hold bellows to heat a blade, hammer each section twice while hot, then quench in water | 18 seconds after an explicit start. Cold strikes do not shape steel; overheating reduces quality. Reheat as needed; a missed round keeps earlier completed rounds. |
| Driver           | Steer the cart across three lanes; collect at least three crates while avoiding stumps | Three collisions wreck the cargo. Generated crate lanes prevent clearing a round by standing still               |
| Guard / Defender | Swipe through flying beetles; choose safe timing and trajectories around lantern bugs  | Hitting friendly bugs reduces quality; repeated indiscriminate sweeps fail                                       |
| Mechanic         | Rotate a 3×3 pipe network to connect tank and axle                                     | Limited turns and time. Routes vary; connected flow is evaluated, not a prescribed sequence of taps              |
| Striker          | Read the charge telegraph, move into a safe lane, counter during recovery              | Requires at least two dodges and one counter; button spamming alone cannot clear it                              |
| Healer           | Connect adjacent matching herbs, release to brew, exploit longer chains                | Nine ingredients in four brews (eight during harvest). Refill guarantees a legal chain, not a highlighted answer |

All seven arcade modes use the same pure rules module on the client and server. The server replays timestamped input and rejects accelerated, malformed or oversized recordings. Collision timestamps are independent of rendering frame rate. This is outcome validation, not a claim that browser automation or bots are impossible.

## Global loop

Gather timber → make planks → deliver 3200 planks → restore the bridge → reveal dragon and both workshops → craft 900 kits + 900 weapons → open unrestricted shared battle → pay the fixed coin pool on death. Only the bridge is constructed. Kits and weapons equip each expedition once; subsequent attacks use no resources or energy.

The first **successful activity**, not the first map view, starts the shared weekly clock. The 3×3 board is then fixed for that week. Completing rows, columns or diagonals grants up to three seals. A player qualifies with three successful contributions that week; each seal grants 10 trail XP, no coins. Eligible players can collect earned seals after returning later. Stored seals, buildings and boss honors persist. Cancellation, failed work and repeated requests do not add contributions.

Weekly boards rotate their arrangement; after the bridge opens, new weeks can include kit production and dragon counterattacks. Weather changes daily. Global Chat is reachable directly from the order board; expedition lobbies support public recruitment. No automatic messages are sent on the player's behalf.

After construction, caravans remain paid maintenance work. A new expedition begins in preparation 24 hours after defeat. Weekly boards, weather, personal seals, trail ranks, cosmetic purchases and boss-cycle honors remain available without needing an immediate second map. This is repeatability in the implementation; sustained player interest still needs playtesting.

## Pacing model for 200 daily players

Run `node backend/frontier/pacing.mjs`. Configuration lives in `backend/frontier/balance.json` and `content.json`. Launch candidates: **3200 bridge planks, 900 kits, 900 weapons, 300000 dragon HP, 3000 coins per victory**.

| Scenario | Participants × minutes/day | Bridge | Battle opens | First victory | Repeated cycle including rest |
| --- | ---: | ---: | ---: | ---: | ---: |
| Quiet | 40 × 6 | day 41.4 | day 50.3 | day 132.5 | 92.1 days |
| Expected assumption | 70 × 12 | day 9.5 | day 11.3 | day 27.8 | 19.3 days |
| Busy | 140 × 18 | day 3.1 | day 3.6 | day 7.9 | 5.8 days |

The model assumes 45-second successful workshop batches, two-plank cargo, 15 seconds per boss attempt including navigation, and 9 average damage per successful attempt. Productive minutes discount retries and time spent travelling/chatting. The quiet scenario remains far too slow; 200 DAU alone cannot establish participation. Measure real batch times, player participation and attack quality before final launch tuning. The month is a target under one assumption, not an enforced calendar lock. Strong participation can kill the boss earlier; repeated expeditions keep the location playable.

Each active cycle snapshots its HP, pool and reserve targets. Tune future cycles without silently changing the value of damage already earned. Ordinary activity coins still pay at most once per 180 seconds; the separate boss pool is distributed only at death by actual damage, never by last-hit ownership.

The weekly board currently retains its previous targets (112 timber batches, 84 ore, 84 plank batches, 56 deliveries, 350 work batches, 42 team contributions, 28 per role). Short batches will complete these faster than the former three-minute shifts. Seals provide recognition and XP, not a reliable week-long time gate; weekly target tuning also awaits measured throughput.

## Short batches and cooperative dispatch

Three good workshop rounds finish a batch immediately. Misses do not raise the target. Gathering collected before an early exit is banked; unfinished recipes refund their inputs. Materials are deposited directly into shared stores, and a receipt points to the next useful location. The 180-second job deadline is an expiry safeguard, not a required play duration.

Journeys contain three 15-second encounters. Solo players rotate through driving, guarding and repairs; groups keep their chosen roles. Two successful encounters qualify a contributor. The small cart reserves two planks and needs one qualified player. The six-plank wagon needs two players both at departure and at successful settlement. A disconnected passenger cannot multiply a solo player's cargo. Failed trips return all reserved cargo; construction overflow returns to stores.

Coins use a single persisted 180-second payment interval shared by work and journeys. Switching activity cannot bypass it. Materials and XP still accumulate between payments, without energy or a daily cap. A failed activity does not consume the next coin opportunity.

Roads now use authored waypoints on the painted paths. A boardwalk connects the eastern mill across its watery approach, using the same geometry as movement. Player positions interpolate against a monotonic clock anchored to precise server time. Arrival refreshes its available actions immediately. Mobile camera framing reserves space for the objective and action panels; desktop scaling fills the viewport. Expedition reserves and dragon progress live in a separate panel, while the map shows a concise objective.

Saw progress and server scoring now consume the same recorded strokes, including release endpoints; compression preserves direction changes. Insects launch in seeded shuffled groups from the sides and below, following curved paths with readable spawn cues. Weather's panel states its actual effects: rain slows cart steering, wind increases insect drift, harvest lowers herb demand; clear weather has no modifier.

## Verification and limits

- Rule tests cover 100 seeds for each new mode across four weather conditions, stationary convoy input, invalid recordings, insect penalties, connected pipes, herb adjacency, boss counter requirements and frame-rate parity.
- Persistence tests cover week activation, rollover, restart, frozen layouts, offline seals, per-user rewards, qualification, capped XP, cancellation and duplicate finalization.
- Browser review uses the actual React/canvas components in `frontend/dev/frontier-playroom.html`, a development-only entry outside the production bundle. It provides instructions, fresh seeds, weather selection and repeatable local rounds; it awards no currency.
- Browser screenshots and basic inputs establish rendering and control response, not fun. Full timed success on each mode and physical iOS/Android playtests are not claimed. Load and live-economy measurements are also not yet available.

The largest remaining design uncertainty is whether short batches and optional crew deliveries sustain interest after the first few sessions. The rules and rewards are testable locally; engagement, physical touch controls and a month of retention require actual players.
