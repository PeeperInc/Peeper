# Sausage Quest integration

The supplied game keeps its procedural three-level quests, controls, physics,
checkpoints, enemies, biomes, models and audio. Five daily rewarded levels can
span multiple quests. Level retries do not count as completions. Further play
after the fifth daily award remains available without rewards or energy costs.

The host adds a back button, daily progress and a reward acknowledgement to the
original completion card. Level titles omit quest numbers so repeated quests
do not appear to reset daily progress. Small viewport adjustments prevent HUD collisions and
allow tall cards to scroll. On a network interruption, starting a rewarded level
can be retried or explicitly continued as practice.

## Rewards

- The first five completed levels each day award 5 coins; collecting every
  sausage awards 10 coins instead. Daily total: 25–50 coins.
- Days reset at 00:00 UTC, matching the existing daily energy drink quota.
- Rewards update `users.coins` only; they never update Peeper energy or fun.
- Authenticated `/api/game/sausage-quest/start` issues an owner-bound random
  ticket with a six-hour lifetime. Its request ID makes start retries safe.
- `/api/game/sausage-quest/finish` computes the reward and applies the daily
  counter and balance in one SQLite transaction. A finished ticket replays its
  result without paying again, including after midnight.
- The server verifies level parameters, regenerates the original collectible
  layout, bounds collection counts and rejects implausibly fast completions.
  This is not full server simulation of the platformer; movement and collection
  still run in the client, as in the supplied game.
- The per-account client outbox retries interrupted completions after closing
  the iframe, reloading the app or restoring connectivity.

`sausage_quest_daily` stores one compact current-day row per account.
`sausage_quest_attempts` stores only tickets, level descriptors and small results;
entries older than two days are removed when a new level starts. No complete
game state, binary assets or full HTTP responses are stored in SQLite.

## Menu and assets

Sausage Quest is available only in the main Games tab, which opens by default
even at zero energy. When rewards remain, it leads Games with a subtle
pulse (disabled for reduced motion). Once all five awards are received, it sits
immediately below Sniper in Games. It is still playable
at zero energy.

The iframe is a separate Vite HTML entry. Three.js 0.147.0 and its original
GLTFLoader/SkeletonUtils are bundled locally with their MIT license. Original
GLB, MP3 and fly image bytes are extracted unchanged from the supplied HTML;
the original Google Fonts families and fallback fonts are retained. These
assets load only on opening Sausage Quest.

Original supplied HTML SHA-256:
`4decfb74667119e78ec9362a1905b203dc081af9f049d6dbabef3e924644403f`.

## Validation

Run from the repository root:

```sh
node --test backend/sausageQuest/*.test.mjs frontend/test/sausageQuestMenu.test.mjs
cd frontend
npm run build
```

Tests cover the 25/50-coin limits, partial/all collection, ticket replay and
ownership, concurrent tickets, UTC rollover, expiry, cleanup, zero-energy HTTP
routes, login/state persistence, menu order and exact server/client layout parity
across 300 generated layouts. Browser checks additionally exercise mobile
controls, reward acknowledgements, menu transitions and interrupted saves across
a reload. Accelerated completion fixtures belong only to local QA scripts and
are not included in the shipped game.
