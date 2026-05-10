const express = require('express');
const router  = express.Router();
const db      = require('../database');
const { validateTelegramInit } = require('../auth');
const { liveStats, calcEnergy, FOOD_TYPES, HUNGER_DRAIN, FUN_DRAIN } = require('../gameLogic');
const {
  DIRTY_STATES,
  ts,
  getPeeper,
  applyDeath,
  completeCleaning,
  isDirty,
  removePoop,
  syncOwnedPeeper,
  syncPeeperRow,
} = require('../peeperState');
const { getHomeSummary, grantFridgeHomeDecor } = require('../homeState');
const {
  getPublicAppSettings,
  getCasinoJackpot,
  setCasinoJackpot,
} = require('../appSettings');
const { resolveCasinoSpinCredits, resolveCasinoSpinUsage, normalizeFreeSpins } = require('../casinoFreeSpins');
const {
  ENERGY_DRINK_COST,
  ENERGY_DRINK_DAILY_LIMIT,
  ENERGY_DRINK_ENERGY_THRESHOLD,
  getEnergyDrinkDayKey,
  getEnergyDrinkState,
  getEnergyDrinkUsage,
} = require('../energyDrinkState');
const {
  FRIDGE_PURCHASE_COST,
  getFridgePlan,
  getFridgeState,
  extendFridgeFoodUntil,
} = require('../fridgeState');
const { getFarmSummary } = require('../farmState');
const { getSupporterSummary } = require('../supportState');
const { getNextDirtyAt } = require('../dirtyCycle');
const { isNotificationEnabled } = require('../notificationSettings');
const APP_URL = 'https://peeper.frenzyradio.online';
function getUser(req)      { return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(req.telegramUser.id)); }
const GAME_REWARD_LIMITS = {
  catch: 10,
  reaction: 10,
  bubble: 10,
  flappy: 10,
  dodge: 10,
  sniper: 10,
};
const CASINO_SPIN_COST = 5;
const CASINO_JACKPOT_CONTRIBUTION = 1;
const CASINO_JACKPOT_ODDS_DENOMINATOR = 10000;
const COIN_SYMBOL = '\u2726';
const SLOT_MACHINE_SYMBOL = '\u{1F3B0}';
const CRYING_FACE_SYMBOL = '\u{1F622}';
const CASINO_PATTERNS = [
  { key: 'pair', weight: 3448, payout: 8 },
  { key: 'single_sino', weight: 2500, payout: 10 },
  { key: 'triple', weight: 2000, payout: 12 },
  { key: 'pair_plus_sino', weight: 1400, payout: 13 },
  { key: 'double_sino', weight: 649, payout: 15 },
  { key: 'jackpot', weight: 3, payout: null },
];
const CASINO_NORMAL_SYMBOLS = [
  'game_toy_1',
  'game_toy_2',
  'game_toy_3',
  'game_toy_4',
  'game_toy_6',
  'game_toy_7',
  'game_toy_8',
  'game_toy_9',
  'game_toy_10',
];
const CASINO_SPECIAL_SYMBOL = 'sino';

// Convert desired hunger% back to a last_fed timestamp
function hungerToLastFed(newHunger, now) {
  return now - Math.round(HUNGER_DRAIN * (1 - newHunger / 100));
}
// Convert desired fun% back to a last_played timestamp
function funToLastPlayed(newFun, now) {
  return now - Math.round(FUN_DRAIN * (1 - newFun / 100));
}

function buildResponse(userId) {
  const peeper = syncOwnedPeeper(userId);
  const user   = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return {
    coins: user.coins,
    supporter: getSupporterSummary(user),
    casinoFreeSpins: normalizeFreeSpins(user.casino_free_spins),
    peeper,
    energyDrink: getEnergyDrinkState(userId, peeper),
    fridge: getFridgeState(peeper),
    cooldowns: { feed: 0, play: 0, action: 0 },
    homeSummary: getHomeSummary(userId),
    farmSummary: getFarmSummary(userId),
    ...getPublicAppSettings(),
  };
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function pickRandom(arr) {
  return arr[randomInt(arr.length)];
}

function shuffle(arr) {
  const next = [...arr];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function pickDistinctNormalPair() {
  const first = pickRandom(CASINO_NORMAL_SYMBOLS);
  let second = pickRandom(CASINO_NORMAL_SYMBOLS);
  while (second === first) {
    second = pickRandom(CASINO_NORMAL_SYMBOLS);
  }
  return [first, second];
}

function rollCasinoPattern() {
  const roll = randomInt(CASINO_JACKPOT_ODDS_DENOMINATOR) + 1;
  let cursor = 0;
  for (const pattern of CASINO_PATTERNS) {
    cursor += pattern.weight;
    if (roll <= cursor) return pattern;
  }
  return CASINO_PATTERNS[CASINO_PATTERNS.length - 1];
}

function buildCasinoSymbols(patternKey) {
  switch (patternKey) {
    case 'pair': {
      const [a, b] = pickDistinctNormalPair();
      return shuffle([a, a, b]);
    }
    case 'single_sino': {
      const [a, b] = pickDistinctNormalPair();
      return shuffle([CASINO_SPECIAL_SYMBOL, a, b]);
    }
    case 'triple': {
      const a = pickRandom(CASINO_NORMAL_SYMBOLS);
      return [a, a, a];
    }
    case 'pair_plus_sino': {
      const a = pickRandom(CASINO_NORMAL_SYMBOLS);
      return shuffle([a, a, CASINO_SPECIAL_SYMBOL]);
    }
    case 'double_sino': {
      const a = pickRandom(CASINO_NORMAL_SYMBOLS);
      return shuffle([CASINO_SPECIAL_SYMBOL, CASINO_SPECIAL_SYMBOL, a]);
    }
    case 'jackpot':
      return [CASINO_SPECIAL_SYMBOL, CASINO_SPECIAL_SYMBOL, CASINO_SPECIAL_SYMBOL];
    default: {
      const [a, b] = pickDistinctNormalPair();
      return shuffle([a, a, b]);
    }
  }
}

function casinoPatternLabel(patternKey) {
  switch (patternKey) {
    case 'pair':
      return 'Toy Pair';
    case 'single_sino':
      return 'Lucky Sino';
    case 'triple':
      return 'Toy Triple';
    case 'pair_plus_sino':
      return 'Sino Upgrade';
    case 'double_sino':
      return 'Double Sino';
    case 'jackpot':
      return 'caSino Jackpot';
    default:
      return 'Spin Win';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCoins(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(Number(value) || 0)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function broadcastCasinoJackpotWin(winner, amount) {
  const token = process.env.BOT_TOKEN;
  if (!token || token === 'dev') return;

  const displayName = escapeHtml(winner.first_name || winner.username || 'A lucky player');
  const text = [
    '🎰 <b>caSino Jackpot hit!</b>',
    '',
    `<b>${displayName}</b> won <b>${formatCoins(amount)} ✦</b> from the shared jackpot.`,
    '',
    'Open Peeper and chase the next jackpot.',
  ].join('\n');

  const recipients = db.prepare(`
    SELECT DISTINCT telegram_id
    FROM users
    WHERE telegram_id IS NOT NULL
    ORDER BY id ASC
  `).all();

  for (const recipient of recipients) {
    const targetUser = db.prepare('SELECT id, first_name FROM users WHERE telegram_id = ?').get(String(recipient.telegram_id));
    if (!targetUser || !isNotificationEnabled(targetUser.id, 'jackpot_notifications')) {
      continue;
    }
    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(recipient.telegram_id),
          text,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{
              text: '🐸 Open Peeper',
              web_app: { url: APP_URL },
              style: 'success',
            }]],
          },
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        if (err.error_code !== 403) {
          console.warn('[casino] jackpot notification failed:', err.description || resp.status);
        }
      }
    } catch (error) {
      console.warn('[casino] jackpot notification error:', error.message);
    }

    await sleep(90);
  }
}

// ── GET /api/game/state ──────────────────────────────────────────────────────
router.get('/state', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const peeper = syncOwnedPeeper(user.id);
  if (!peeper) return res.status(404).json({ error: 'Peeper not found' });
  const fresh = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  res.json({
    coins: fresh.coins,
    supporter: getSupporterSummary(fresh),
    peeper,
    energyDrink: getEnergyDrinkState(user.id, peeper),
    fridge: getFridgeState(peeper),
    cooldowns: { feed: 0, play: 0, action: 0 },
    homeSummary: getHomeSummary(user.id),
    farmSummary: getFarmSummary(user.id),
    ...getPublicAppSettings(),
  });
});

router.get('/casino/state', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    casinoJackpot: getCasinoJackpot(),
    casinoFreeSpins: normalizeFreeSpins(user.casino_free_spins),
    spinCost: CASINO_SPIN_COST,
    jackpotContribution: CASINO_JACKPOT_CONTRIBUTION,
  });
});

// ── POST /api/game/feed ──────────────────────────────────────────────────────
router.post('/feed', validateTelegramInit, (req, res) => {
  const requestedType = req.body.foodType;
  const fridgePlan = getFridgePlan(requestedType);
  const isFridgeAction = requestedType === 'fridge_buy' || Boolean(fridgePlan);
  if (requestedType !== 'energy_drink' && !FOOD_TYPES[requestedType] && !isFridgeAction) {
    return res.status(400).json({ error: 'Invalid food type' });
  }

  const user   = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const peeper = syncPeeperRow(user.id);
  if (!peeper) return res.status(404).json({ error: 'Peeper not found' });
  if (!peeper.alive) return res.status(400).json({ error: `Your Peeper has passed away ${CRYING_FACE_SYMBOL}` });

  const live = liveStats(peeper);
  if (!live.alive) {
    applyDeath(user.id, true);
    return res.status(400).json({ error: `Your Peeper has passed away ${CRYING_FACE_SYMBOL}` });
  }

  if (requestedType === 'fridge_buy') {
    if (Number(peeper.fridge_owned) === 1) {
      return res.status(400).json({ error: 'You already own a Fridge.', ...buildResponse(user.id) });
    }

    if (user.coins < FRIDGE_PURCHASE_COST) {
      return res.status(400).json({
        error: `Not enough coins! Need ${FRIDGE_PURCHASE_COST} ${COIN_SYMBOL}`,
        ...buildResponse(user.id),
      });
    }

    const now = ts();
    db.transaction(() => {
      db.prepare(`
        UPDATE peepers
        SET fridge_owned = 1,
            fridge_purchased_at = ?
        WHERE user_id = ?
      `).run(now, user.id);
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(FRIDGE_PURCHASE_COST, user.id);
      grantFridgeHomeDecor(user.id);
    })();

    return res.json({
      message: `Fridge purchased! Stock it with food to keep ${peeper.name || 'Peeper'} full while you are away.`,
      coinsSpent: FRIDGE_PURCHASE_COST,
      ...buildResponse(user.id),
    });
  }

  if (fridgePlan) {
    if (Number(peeper.fridge_owned) !== 1) {
      return res.status(400).json({ error: 'Buy a Fridge first.', ...buildResponse(user.id) });
    }

    if (user.coins < fridgePlan.cost) {
      return res.status(400).json({
        error: `Not enough coins! Need ${fridgePlan.cost} ${COIN_SYMBOL}`,
        ...buildResponse(user.id),
      });
    }

    const now = ts();
    const newFoodUntil = extendFridgeFoodUntil(peeper.fridge_food_until, fridgePlan.days, now);

    db.transaction(() => {
      db.prepare(`
        UPDATE peepers
        SET hp = ?,
            last_fed = ?,
            fridge_food_until = ?
        WHERE user_id = ?
      `).run(live.hp, now, newFoodUntil, user.id);
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(fridgePlan.cost, user.id);
    })();

    return res.json({
      message: `Fridge stocked for ${fridgePlan.days} days.`,
      coinsSpent: fridgePlan.cost,
      ...buildResponse(user.id),
    });
  }

  if (requestedType === 'energy_drink') {
    const energy = calcEnergy(live.fun);
    const dayKey = getEnergyDrinkDayKey();
    const usedToday = getEnergyDrinkUsage(user.id, dayKey);
    const remainingToday = Math.max(0, ENERGY_DRINK_DAILY_LIMIT - usedToday);

    if (energy > ENERGY_DRINK_ENERGY_THRESHOLD) {
      return res.status(400).json({
        error: `Energy Drink can only be used at 0-1 energy. You currently have ${energy}.`,
        ...buildResponse(user.id),
      });
    }

    if (remainingToday <= 0) {
      return res.status(400).json({
        error: 'Daily Energy Drink limit reached. Try again tomorrow.',
        ...buildResponse(user.id),
      });
    }

    if (user.coins < ENERGY_DRINK_COST) {
      return res.status(400).json({
        error: `Not enough coins! Need ${ENERGY_DRINK_COST} ${COIN_SYMBOL}`,
        ...buildResponse(user.id),
      });
    }

    const now = ts();
    const newLastPlayed = funToLastPlayed(0, now);

    db.transaction(() => {
      db.prepare('UPDATE peepers SET last_played = ? WHERE user_id = ?').run(newLastPlayed, user.id);
      db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(ENERGY_DRINK_COST, user.id);
      db.prepare(`
        INSERT INTO energy_drink_usage (user_id, day_key, used_count, updated_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(user_id, day_key) DO UPDATE SET
          used_count = used_count + 1,
          updated_at = excluded.updated_at
      `).run(user.id, dayKey, now);
    })();

    return res.json({
      message: `⚡ Energy restored! ${peeper.name || 'Peeper'} is ready to play again.`,
      coinsSpent: ENERGY_DRINK_COST,
      ...buildResponse(user.id),
    });
  }

  const food = FOOD_TYPES[requestedType];
  if (live.hunger > 70) return res.status(400).json({ error: `${peeper.name || 'Peeper'} is not hungry yet! (${Math.round(live.hunger)}%)` });
  if (user.coins < food.cost) return res.status(400).json({ error: `Not enough coins! Need ${food.cost} ${COIN_SYMBOL}` });

  const now        = ts();
  const newHunger  = Math.min(100, live.hunger + food.hunger);
  const newLastFed = hungerToLastFed(newHunger, now);

  // Save current live HP as the new snapshot (hp = HP at new last_fed)
  db.transaction(() => {
    db.prepare('UPDATE peepers SET hp=?, last_fed=? WHERE user_id=?').run(live.hp, newLastFed, user.id);
    db.prepare('UPDATE users SET coins=coins-? WHERE id=?').run(food.cost, user.id);
  })();

  res.json({ message: `${food.emoji} Yum! ${peeper.name || 'Peeper'} enjoyed the ${food.label}!`, coinsSpent: food.cost, ...buildResponse(user.id) });
});

// ── POST /api/game/play ──────────────────────────────────────────────────────
// play() does NOT touch hp or last_fed — HP is purely time-based.
router.post('/play', validateTelegramInit, (req, res) => {
  const { gameId = null, coinsEarned = 0, gameWon = false } = req.body;

  const user   = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const peeper = syncPeeperRow(user.id);
  if (!peeper) return res.status(404).json({ error: 'Peeper not found' });
  if (!peeper.alive) return res.status(400).json({ error: 'Your Peeper has passed away 😢' });

  const live = liveStats(peeper);
  if (!live.alive) { applyDeath(user.id, true); return res.status(400).json({ error: 'Your Peeper has passed away 😢' }); }

  if (isDirty(peeper)) {
    return res.status(400).json({ error: 'Clean your Peeper first!', ...buildResponse(user.id) });
  }

  const energy = calcEnergy(live.fun);
  if (energy <= 0) return res.status(400).json({ error: 'No energy! Fun bar is too full.' });

  if (!gameWon) return res.json({ message: '😔 Better luck next time!', coinsEarned: 0, ...buildResponse(user.id) });

  const normalizedGameId = typeof gameId === 'string' ? gameId.trim().toLowerCase() : '';
  const maxReward        = GAME_REWARD_LIMITS[normalizedGameId] ?? 10;
  const claimedCoins     = Math.round(Number(coinsEarned) || 0);
  const safeCoins        = Math.min(maxReward, Math.max(0, claimedCoins));
  const now          = ts();
  const newFun       = Math.min(100, live.fun + 20);
  const newLastPlayed = funToLastPlayed(newFun, now);

  if (claimedCoins > maxReward) {
    console.warn(`[play] Clamped suspicious reward claim for user ${user.id}: game=${normalizedGameId || 'unknown'} claimed=${claimedCoins} max=${maxReward}`);
  }

  // Only update last_played and coins — never hp or last_fed
  db.transaction(() => {
    db.prepare('UPDATE peepers SET last_played=? WHERE user_id=?').run(newLastPlayed, user.id);
    if (safeCoins > 0) db.prepare('UPDATE users SET coins=coins+? WHERE id=?').run(safeCoins, user.id);
  })();

  res.json({ message: `🎮 Great game! +${safeCoins} ✦ earned!`, coinsEarned: safeCoins, ...buildResponse(user.id) });
});

// ── POST /api/game/revive ────────────────────────────────────────────────────
router.post('/casino/spin', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const peeper = syncPeeperRow(user.id);
  if (!peeper) return res.status(404).json({ error: 'Peeper not found' });
  if (!peeper.alive) return res.status(400).json({ error: `Your Peeper has passed away ${CRYING_FACE_SYMBOL}` });

  const live = liveStats(peeper);
  if (!live.alive) {
    applyDeath(user.id, true);
    return res.status(400).json({ error: `Your Peeper has passed away ${CRYING_FACE_SYMBOL}` });
  }

  if (isDirty(peeper)) {
    return res.status(400).json({ error: 'Clean your Peeper first!', ...buildResponse(user.id) });
  }

  const energy = calcEnergy(live.fun);
  const freeSpinsBefore = normalizeFreeSpins(user.casino_free_spins);
  const spinUsage = resolveCasinoSpinUsage({
    freeSpinsBefore,
    currentEnergy: energy,
  });

  if (spinUsage.requiresEnergy && energy <= 0) {
    return res.status(400).json({ error: 'No energy! Fun bar is too full.', ...buildResponse(user.id) });
  }
  const hasFreeSpin = spinUsage.hasFreeSpin;

  if (!hasFreeSpin && user.coins < CASINO_SPIN_COST) {
    return res.status(400).json({
      error: `Not enough coins! Need ${CASINO_SPIN_COST} ${COIN_SYMBOL}`,
      ...buildResponse(user.id),
    });
  }

  const pattern = rollCasinoPattern();
  const symbols = buildCasinoSymbols(pattern.key);
  const creditState = resolveCasinoSpinCredits({
    patternKey: pattern.key,
    freeSpinsBefore,
    spinCost: CASINO_SPIN_COST,
  });
  const poolBefore = getCasinoJackpot();
  const poolAfterContribution = poolBefore + (creditState.jackpotContributionApplied ? CASINO_JACKPOT_CONTRIBUTION : 0);
  const jackpotWon = pattern.key === 'jackpot';
  const payout = jackpotWon ? poolAfterContribution : pattern.payout;
  const poolAfterPayout = jackpotWon ? 0 : poolAfterContribution;

  const now = ts();
  const newFun = spinUsage.energyConsumed ? Math.min(100, live.fun + 20) : live.fun;
  const newLastPlayed = spinUsage.energyConsumed ? funToLastPlayed(newFun, now) : peeper.last_played;

  db.transaction(() => {
    db.prepare('UPDATE peepers SET last_played = ? WHERE user_id = ?').run(newLastPlayed, user.id);
    db.prepare('UPDATE users SET coins = coins - ? + ?, casino_free_spins = ? WHERE id = ?')
      .run(creditState.spinCostPaid, payout, creditState.freeSpinsAfter, user.id);
    setCasinoJackpot(poolAfterPayout);
  })();

  const response = buildResponse(user.id);
  const freeSpinSuffix = creditState.freeSpinAwarded ? ' + Free Spin' : '';
  res.json({
    ...response,
    message: jackpotWon
      ? `${SLOT_MACHINE_SYMBOL} JACKPOT! You won ${payout} ${COIN_SYMBOL}!`
      : `${SLOT_MACHINE_SYMBOL} ${casinoPatternLabel(pattern.key)}! +${payout} ${COIN_SYMBOL}${freeSpinSuffix}`,
    spin: {
      symbols,
      pattern: pattern.key,
      patternLabel: casinoPatternLabel(pattern.key),
      payout,
      jackpotWon,
      poolBefore,
      poolAfterContribution,
      poolAfterPayout,
      spinCost: CASINO_SPIN_COST,
      spinCostPaid: creditState.spinCostPaid,
      freeSpinUsed: creditState.freeSpinUsed,
      freeSpinAwarded: creditState.freeSpinAwarded,
      freeSpinsAfter: creditState.freeSpinsAfter,
      energyConsumed: spinUsage.energyConsumed,
      jackpotContributionApplied: creditState.jackpotContributionApplied,
      jackpotContribution: CASINO_JACKPOT_CONTRIBUTION,
    },
  });

  if (jackpotWon) {
    setTimeout(() => {
      broadcastCasinoJackpotWin(user, payout).catch((error) => {
        console.warn('[casino] jackpot broadcast error:', error.message);
      });
    }, 0);
  }
});

router.post('/cleanup/poop', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const peeper = syncPeeperRow(user.id);
  if (!peeper) return res.status(404).json({ error: 'Peeper not found' });
  if (!peeper.alive) return res.status(400).json({ error: `Your Peeper has passed away ${CRYING_FACE_SYMBOL}` });

  const dirtyState = peeper.dirty_state || DIRTY_STATES.CLEAN;
  if (dirtyState === DIRTY_STATES.CLEAN) {
    return res.json({ message: `${peeper.name || 'Peeper'} is already clean!`, ...buildResponse(user.id) });
  }
  if (dirtyState !== DIRTY_STATES.POOP) {
    return res.status(400).json({ error: 'Poop is already removed.', ...buildResponse(user.id) });
  }

  const nextPeeper = removePoop(user.id);
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({
    message: 'Poop removed! Grab the sponge to finish cleaning.',
    coins: userRow.coins,
    peeper: nextPeeper,
    cooldowns: { feed: 0, play: 0, action: 0 },
    homeSummary: getHomeSummary(user.id),
    ...getPublicAppSettings(),
  });
});

router.post('/cleanup/complete', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const peeper = syncPeeperRow(user.id);
  if (!peeper) return res.status(404).json({ error: 'Peeper not found' });
  if (!peeper.alive) return res.status(400).json({ error: `Your Peeper has passed away ${CRYING_FACE_SYMBOL}` });

  const dirtyState = peeper.dirty_state || DIRTY_STATES.CLEAN;
  if (dirtyState === DIRTY_STATES.CLEAN) {
    return res.json({ message: `${peeper.name || 'Peeper'} is already squeaky clean!`, ...buildResponse(user.id) });
  }
  if (dirtyState !== DIRTY_STATES.SCRUBBING) {
    return res.status(400).json({ error: 'Remove the poop first.', ...buildResponse(user.id) });
  }

  const nextPeeper = completeCleaning(user.id);
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.json({
    message: `${peeper.name || 'Peeper'} is clean again!`,
    coins: userRow.coins,
    peeper: nextPeeper,
    cooldowns: { feed: 0, play: 0, action: 0 },
    homeSummary: getHomeSummary(user.id),
    ...getPublicAppSettings(),
  });
});

router.post('/revive', validateTelegramInit, (req, res) => {
  const user   = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const peeper = getPeeper(user.id);
  if (!peeper) return res.status(404).json({ error: 'Peeper not found' });

  // If DB says alive but liveStats says dead — the death penalty hasn't been
  // applied yet (stale DB). Apply it now and tell the client to refresh state
  // rather than silently reviving — this prevents clothes being stripped AND
  // then immediately reviving in the same request.
  if (peeper.alive) {
    const live = liveStats(peeper);
    if (live.alive) {
      return res.status(400).json({ error: 'Peeper is still alive!' });
    }
    // liveStats confirms death — apply with force=true to bypass safety guard
    applyDeath(user.id, true);
    // Re-check: if applyDeath succeeded, show dead screen and ask to revive again
    const afterDeath = getPeeper(user.id);
    if (afterDeath && !afterDeath.alive) {
      return res.status(400).json({ error: 'Peeper just died. Press Revive again.', ...buildResponse(user.id) });
    }
    // applyDeath was still blocked somehow (e.g. clock skew) — just revive to unblock the user
  }

  const now = ts();
  // hp=100 at last_fed=now → hunger starts at 100%, full 8h before starving
  // 1 energy token ready: last_played = now - 20% of fun drain
  db.prepare(`UPDATE peepers SET
    alive=1, hp=100, hunger=100, fun=100,
    born_at=?, last_fed=?, last_played=?, last_action_at=0,
    dirty_state='clean', dirty_cycle_key=NULL, next_dirty_at=?
    WHERE user_id=?`).run(now, now, now - Math.round(FUN_DRAIN * 0.20), getNextDirtyAt(now), user.id);

  res.json({ message: '🌱 Your Peeper is reborn! Take good care of them!', ...buildResponse(user.id) });
});

// ── POST /api/game/outfit ────────────────────────────────────────────────────
router.post('/outfit', validateTelegramInit, (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { slot_head, slot_body, slot_hands, slot_fren, slot_face } = req.body;

  const owned = db.prepare('SELECT item_id FROM owned_items WHERE user_id=?').all(user.id).map(r => r.item_id);
  for (const id of [slot_head, slot_body, slot_hands, slot_fren, slot_face]) {
    if (id && id !== 'none' && !owned.includes(id)) return res.status(400).json({ error: `You don't own item: ${id}` });
  }

  db.prepare('UPDATE peepers SET slot_head=?,slot_body=?,slot_hands=?,slot_fren=?,slot_face=? WHERE user_id=?')
    .run(slot_head||null, slot_body||null, slot_hands||null, slot_fren||null, slot_face||null, user.id);
  res.json({ peeper: syncOwnedPeeper(user.id) });
});

module.exports = router;
