# ExpUpdate release readiness

## First deployment

`backend/database.js` calls `finishLegacyExpeditionsForCardRollout` after schema
installation and before the HTTP server and notifier start. Its marker is
`expupdate_card_rollout_v1` in `app_settings`.

One immediate SQLite transaction:

1. Finds unfinished runs whose combat mode is not `cards_v1`.
2. Creates pending reward caches with the normal formula using actual AP,
   actually cleared rooms, meal effects and equipped reward passives. It does
   not mark additional rooms cleared or invent a boss kill. Zero contribution
   earns no reward. Former family members retain their personal earned rewards.
3. Preserves already-created and claimed reward payloads exactly.
4. Returns every remaining equipped relic, including passive relics, as
   compensation for the forced version transition. Consumed active relics are
   not recreated. Returns ingredients for an unused packed meal.
5. Supersedes open trial attempts, closes the run and records history with
   `finishReason: expupdate_rollout`.
6. Writes the completion marker. Any failure rolls back all six steps together.

Families can immediately start a new card expedition. Claiming the old reward
is independent of starting the new run. Rewards appear through the existing
Claim Rewards flow; rollout does not pay them directly to wallets. Existing
finished-expedition notifications use their normal behavior after deployment;
no separate rollout broadcast is added.

Restarting cannot repeat rewards or refunds. New card runs are excluded even on
the first run of the migration. Stale room mutations against a rollout-closed
run receive a refresh message. Ordinary paid trial finishes after a normal
expedition completion retain their existing safe resolution/replay behavior.

## Verification

- All 587 backend/frontend automated tests pass. Rollout tests cover rewards,
  refunds, zero contribution, former members, preexisting claimed caches,
  historical loadout shapes, rollback, real database startup, repeat restart,
  rejection of stale actions and starting a new card run.
- A generated 25-room journey with the updated HP was exercised with all four classes, 211 paid card
  hands, 31 valid trial submissions, all boss phases, final rewards and duplicate
  claims. All 25 rooms cleared. Time was accelerated to exercise AP regeneration
  and recovery without rewriting HP/AP; this is a rules simulation, not evidence
  of balanced real-world pacing.
- A separate 624-encounter rules simulation covers all enemy types, mixed classes,
  shuffled hands, defensive play and supplies. Baseline means are about 10 family
  hands for ordinary enemies, 14 for elites and 24–25 for the whole boss. Details
  and the supply comparison are in [expupdate-card-combat.md](expupdate-card-combat.md#shared-encounter-pacing).
- Browser checks cover four classes at 320x568, 375x667, 390x844 and 1280x850,
  actual card/supply interactions, animation expiry, reconnect and private hands.
- Old combat-ability buttons are hidden in card-mode noncombat rooms; Scout
  encounter previews show HP rather than obsolete dice AC.
- Production Vite build passes. The existing large-chunk warning remains.
- The local hero switcher, grant/reset scripts and local database are excluded
  from the production build/release. New card illustrations are bundled SVG.

## Rehearsal on a production snapshot, 2026-10-25

The migration was run against a separate SQLite backup of production. The live
production database was opened read-only for taking the snapshot.

| Check | Verified result |
| --- | --- |
| Unfinished legacy runs closed in the copy | 49 |
| Newly prepared personal reward caches | 96 |
| Existing reward caches preserved byte-for-byte | 1,635 |
| Remaining equipped relic copies returned | 104 |
| Unused packed meals refunded as ingredients | 24 |
| Room progress / boss kill timestamps | Unchanged |
| User wallet balances before Claim Rewards | Unchanged |
| Second startup | No repeated rewards or refunds |

Counts describe that snapshot, not a change already made in production. More
player activity before deployment can change the actual rollout counts.

## Remaining release work

The release is prepared on `ExpUpdate` and still needs PR review and merge;
deploying only the earlier prototype commit would omit the current cards, supply
rules, browser interaction fix and rollout module.

A real Telegram iOS/Android smoke test is still required. Desktop Chromium mobile
viewports do not establish WebView-specific hold/drag behavior or safe-area
behavior. Numerical class/supply balance still needs live player feedback.

The existing `peeper-deploy` procedure takes a consistent database backup before
updating code. Keep that backup for this rollout. A rollback after a failed
startup must include the rollout's database changes, not only the code revision.
No deployment or merge is performed by the readiness audit.
