const db = require('./database');
const { liveStats } = require('./gameLogic');
const {
  ARENA_STAKE,
  ARENA_HP,
  ARENA_BASE_DAMAGE,
  ARENA_CHOICE_SECONDS,
  ARENA_COUNTDOWN_SECONDS,
  ARENA_QUEUE_TIMEOUT_SECONDS,
  ARENA_PRIVATE_ROOM_TIMEOUT_SECONDS,
  ELEMENTS,
  ELEMENT_BEATS,
  ELEMENT_EMOJI,
  ELEMENT_COLORS,
} = require('./arenaConstants');
const {
  createArenaInviteToken,
  validateArenaInviteForUser,
} = require('./arenaInviteUtils');

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function randomElement() {
  return ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)];
}

function isElement(value) {
  return ELEMENTS.includes(value);
}

function normalizeElement(value) {
  const next = String(value || '').trim().toLowerCase();
  return isElement(next) ? next : null;
}

function createJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function calcDamageMultiplier(attack, defense) {
  if (!isElement(attack) || !isElement(defense)) {
    throw new Error('Invalid arena element.');
  }
  if (ELEMENT_BEATS[defense] === attack) return 0;
  if (ELEMENT_BEATS[attack] === defense) return 2;
  return 1;
}

function calcDamage(attack, defense) {
  return Math.round(ARENA_BASE_DAMAGE * calcDamageMultiplier(attack, defense));
}

function resolveCombatRound({
  player1Hp,
  player2Hp,
  player1Attack,
  player1Defense,
  player2Attack,
  player2Defense,
}) {
  const p1Multiplier = calcDamageMultiplier(player1Attack, player2Defense);
  const p2Multiplier = calcDamageMultiplier(player2Attack, player1Defense);
  const player1DamageDealt = Math.round(ARENA_BASE_DAMAGE * p1Multiplier);
  const player2DamageDealt = Math.round(ARENA_BASE_DAMAGE * p2Multiplier);
  const player1HpAfter = Math.max(0, Math.floor(player1Hp) - player2DamageDealt);
  const player2HpAfter = Math.max(0, Math.floor(player2Hp) - player1DamageDealt);

  let result = null;
  let winnerSide = null;
  if (player1HpAfter <= 0 && player2HpAfter <= 0) {
    result = 'draw';
  } else if (player2HpAfter <= 0) {
    result = 'p1_win';
    winnerSide = 'p1';
  } else if (player1HpAfter <= 0) {
    result = 'p2_win';
    winnerSide = 'p2';
  }

  return {
    player1DamageDealt,
    player2DamageDealt,
    player1Multiplier: p1Multiplier,
    player2Multiplier: p2Multiplier,
    player1HpAfter,
    player2HpAfter,
    result,
    winnerSide,
  };
}

function getMatch(matchId) {
  return db.prepare('SELECT * FROM arena_matches WHERE id = ?').get(matchId);
}

function getCurrentRound(matchId, roundNumber) {
  return db.prepare(`
    SELECT *
    FROM arena_rounds
    WHERE match_id = ? AND round_number = ?
  `).get(matchId, roundNumber);
}

function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function getPeeperForUser(userId) {
  return db.prepare('SELECT * FROM peepers WHERE user_id = ?').get(userId);
}

function assertPeeperCanFight(userId) {
  const peeper = getPeeperForUser(userId);
  if (!peeper) throw new Error('Peeper not found.');
  if (!peeper.alive || !liveStats(peeper).alive) throw new Error('Dead Peepers cannot fight.');
  if ((peeper.dirty_state || 'clean') !== 'clean') throw new Error('Clean your Peeper before fighting.');
  return peeper;
}

function assertUserHasCoins(userId) {
  const user = getUser(userId);
  if (!user) throw new Error('User not found.');
  if (Number(user.coins || 0) < ARENA_STAKE) {
    throw new Error(`Not enough coins. Need ${ARENA_STAKE} ✦.`);
  }
  return user;
}

function getActiveArenaMatchForUser(userId) {
  return db.prepare(`
    SELECT *
    FROM arena_matches
    WHERE status IN ('waiting', 'countdown', 'active')
      AND (player1_id = ? OR player2_id = ?)
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId, userId);
}

function assertUserAvailableForArena(userId) {
  const queued = db.prepare('SELECT 1 FROM arena_queue WHERE user_id = ?').get(userId);
  if (queued) throw new Error('You are already searching for an Arena fight.');
  const match = getActiveArenaMatchForUser(userId);
  if (match) throw new Error('You are already in an Arena fight.');
}

function createRound(matchId, roundNumber, now = nowTs()) {
  db.prepare(`
    INSERT OR IGNORE INTO arena_rounds (match_id, round_number, created_at)
    VALUES (?, ?, ?)
  `).run(matchId, roundNumber, now);
}

function startMatch(matchId, now = nowTs()) {
  db.prepare(`
    UPDATE arena_matches
    SET status = 'active',
        current_round = 1,
        round_deadline = ?,
        countdown_ends_at = NULL
    WHERE id = ?
  `).run(now + ARENA_CHOICE_SECONDS, matchId);
  createRound(matchId, 1, now);
}

function finishMatch(match, result, winnerId, now = nowTs()) {
  db.prepare(`
    UPDATE arena_matches
    SET status = 'finished',
        result = ?,
        winner_id = ?,
        round_deadline = NULL,
        finished_at = ?
    WHERE id = ?
  `).run(result, winnerId || null, now, match.id);

  if (result === 'draw') {
    db.prepare('UPDATE users SET coins = coins + ? WHERE id IN (?, ?)').run(
      ARENA_STAKE,
      match.player1_id,
      match.player2_id,
    );
  } else if (winnerId) {
    db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(ARENA_STAKE * 2, winnerId);
  }
}

function resolveRound(matchId, roundNumber, now = nowTs()) {
  const match = getMatch(matchId);
  if (!match || match.status !== 'active') return match;

  const round = getCurrentRound(matchId, roundNumber);
  if (!round || round.resolved) return getMatch(matchId);

  const p1Attack = normalizeElement(round.p1_attack) || randomElement();
  const p1Defense = normalizeElement(round.p1_defense) || randomElement();
  const p2Attack = normalizeElement(round.p2_attack) || randomElement();
  const p2Defense = normalizeElement(round.p2_defense) || randomElement();

  const result = resolveCombatRound({
    player1Hp: match.player1_hp,
    player2Hp: match.player2_hp,
    player1Attack: p1Attack,
    player1Defense: p1Defense,
    player2Attack: p2Attack,
    player2Defense: p2Defense,
  });

  db.prepare(`
    UPDATE arena_rounds
    SET p1_attack = ?,
        p1_defense = ?,
        p2_attack = ?,
        p2_defense = ?,
        p1_damage_dealt = ?,
        p2_damage_dealt = ?,
        p1_multiplier = ?,
        p2_multiplier = ?,
        p1_hp_after = ?,
        p2_hp_after = ?,
        resolved = 1
    WHERE match_id = ? AND round_number = ?
  `).run(
    p1Attack,
    p1Defense,
    p2Attack,
    p2Defense,
    result.player1DamageDealt,
    result.player2DamageDealt,
    result.player1Multiplier,
    result.player2Multiplier,
    result.player1HpAfter,
    result.player2HpAfter,
    matchId,
    roundNumber,
  );

  db.prepare(`
    UPDATE arena_matches
    SET player1_hp = ?,
        player2_hp = ?
    WHERE id = ?
  `).run(result.player1HpAfter, result.player2HpAfter, matchId);

  if (result.result) {
    const winnerId = result.winnerSide === 'p1'
      ? match.player1_id
      : result.winnerSide === 'p2'
        ? match.player2_id
        : null;
    finishMatch({ ...match, player1_hp: result.player1HpAfter, player2_hp: result.player2HpAfter }, result.result, winnerId, now);
    return getMatch(matchId);
  }

  const nextRound = roundNumber + 1;
  db.prepare(`
    UPDATE arena_matches
    SET current_round = ?,
        round_deadline = ?
    WHERE id = ?
  `).run(nextRound, now + ARENA_CHOICE_SECONDS, matchId);
  createRound(matchId, nextRound, now);
  return getMatch(matchId);
}

function syncExpiredArenaStates(now = nowTs()) {
  db.prepare(`
    DELETE FROM arena_queue
    WHERE queued_at <= ?
  `).run(now - ARENA_QUEUE_TIMEOUT_SECONDS);

  db.prepare(`
    UPDATE arena_matches
    SET status = 'cancelled',
        finished_at = ?
    WHERE status = 'waiting'
      AND visibility = 'private'
      AND created_at <= ?
  `).run(now, now - ARENA_PRIVATE_ROOM_TIMEOUT_SECONDS);
}

function syncMatch(matchId, now = nowTs()) {
  syncExpiredArenaStates(now);
  let match = getMatch(matchId);
  if (!match) return null;

  if (match.status === 'countdown' && match.countdown_ends_at && now >= match.countdown_ends_at) {
    startMatch(match.id, now);
    match = getMatch(matchId);
  }

  if (match.status === 'active' && match.round_deadline && now >= match.round_deadline) {
    match = resolveRound(match.id, match.current_round, now);
  }

  return match;
}

function validateArenaEntry(userId) {
  assertPeeperCanFight(userId);
  assertUserHasCoins(userId);
}

function joinQueue(userId, now = nowTs()) {
  let matchedId = null;
  db.transaction(() => {
    syncExpiredArenaStates(now);
    validateArenaEntry(userId);
    assertUserAvailableForArena(userId);
    db.prepare('INSERT INTO arena_queue (user_id, queued_at) VALUES (?, ?)').run(userId, now);

    const opponent = db.prepare(`
      SELECT q.user_id
      FROM arena_queue q
      WHERE q.user_id != ?
      ORDER BY q.queued_at ASC
      LIMIT 1
    `).get(userId);
    if (!opponent) return;

    validateArenaEntry(opponent.user_id);
    db.prepare('UPDATE users SET coins = coins - ? WHERE id IN (?, ?)').run(
      ARENA_STAKE,
      opponent.user_id,
      userId,
    );
    const info = db.prepare(`
      INSERT INTO arena_matches (status, visibility, player1_id, player2_id, stake, current_round, player1_hp, player2_hp, created_at)
      VALUES ('active', 'open', ?, ?, ?, 1, ?, ?, ?)
    `).run(opponent.user_id, userId, ARENA_STAKE, ARENA_HP, ARENA_HP, now);
    matchedId = info.lastInsertRowid;
    createRound(matchedId, 1, now);
    db.prepare(`
      UPDATE arena_matches
      SET round_deadline = ?
      WHERE id = ?
    `).run(now + ARENA_CHOICE_SECONDS, matchedId);
    db.prepare('DELETE FROM arena_queue WHERE user_id IN (?, ?)').run(opponent.user_id, userId);
  })();

  return matchedId ? { matched: true, matchId: matchedId } : { queued: true };
}

function leaveQueue(userId) {
  db.prepare('DELETE FROM arena_queue WHERE user_id = ?').run(userId);
  return { ok: true };
}

function getQueueStatus(userId, now = nowTs()) {
  syncExpiredArenaStates(now);
  const row = db.prepare('SELECT * FROM arena_queue WHERE user_id = ?').get(userId);
  if (!row) {
    const match = getActiveArenaMatchForUser(userId);
    return match ? { queued: false, matched: true, matchId: match.id } : { queued: false };
  }
  return {
    queued: true,
    queuedAt: row.queued_at,
    elapsedSeconds: Math.max(0, now - row.queued_at),
    remainingSeconds: Math.max(0, ARENA_QUEUE_TIMEOUT_SECONDS - (now - row.queued_at)),
  };
}

function getPublicQueueStatus(now = nowTs()) {
  syncExpiredArenaStates(now);
  const row = db.prepare('SELECT COUNT(*) AS queuedCount FROM arena_queue').get();
  const queuedCount = Math.max(0, Number(row?.queuedCount) || 0);
  return {
    active: queuedCount > 0,
    queuedCount,
  };
}

function getCurrentArenaState(userId, now = nowTs()) {
  syncExpiredArenaStates(now);

  const match = getActiveArenaMatchForUser(userId);
  if (match) {
    return {
      mode: 'match',
      state: serializeMatchState(match.id, userId, now),
    };
  }

  const queue = getQueueStatus(userId, now);
  if (queue.queued) {
    return {
      mode: 'queue',
      queued: true,
      queue,
      stake: ARENA_STAKE,
      choiceSeconds: ARENA_CHOICE_SECONDS,
      countdownSeconds: ARENA_COUNTDOWN_SECONDS,
    };
  }

  return {
    mode: 'idle',
    queued: false,
    state: null,
  };
}

function getArenaWinsRows() {
  return db.prepare(`
    SELECT
      u.id,
      u.telegram_id,
      u.username,
      u.first_name,
      u.photo_url,
      u.supporter_since,
      u.supporter_stars,
      COUNT(m.id) AS wins
    FROM users u
    JOIN arena_matches m ON m.winner_id = u.id
    WHERE m.status = 'finished'
      AND m.winner_id IS NOT NULL
    GROUP BY u.id
    ORDER BY wins DESC, u.id ASC
  `).all();
}

function serializeArenaLeaderboardRow(row, index) {
  return {
    rank: index + 1,
    userId: row.id,
    firstName: row.first_name,
    username: row.username,
    photoUrl: row.photo_url,
    supporter_since: row.supporter_since,
    supporter_stars: row.supporter_stars,
    wins: Math.max(0, Number(row.wins) || 0),
  };
}

function getArenaLeaderboard(userId, limit = 10) {
  const rows = getArenaWinsRows();
  const topRows = rows.slice(0, limit).map(serializeArenaLeaderboardRow);
  const selfIndex = rows.findIndex((row) => Number(row.id) === Number(userId));
  const selfWinRow = selfIndex >= 0 ? rows[selfIndex] : null;
  const user = getUser(userId);
  const self = user ? {
    rank: selfWinRow ? selfIndex + 1 : null,
    userId: user.id,
    firstName: user.first_name,
    username: user.username,
    photoUrl: user.photo_url,
    supporter_since: user.supporter_since,
    supporter_stars: user.supporter_stars,
    wins: selfWinRow ? Math.max(0, Number(selfWinRow.wins) || 0) : 0,
  } : null;

  return {
    leaderboard: topRows,
    self,
  };
}

function createPrivateRoom(userId, now = nowTs()) {
  let matchId = null;
  db.transaction(() => {
    syncExpiredArenaStates(now);
    validateArenaEntry(userId);
    assertUserAvailableForArena(userId);

    let joinCode = createJoinCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const exists = db.prepare('SELECT 1 FROM arena_matches WHERE join_code = ?').get(joinCode);
      if (!exists) break;
      joinCode = createJoinCode();
    }

    const info = db.prepare(`
      INSERT INTO arena_matches (status, visibility, join_code, player1_id, stake, player1_hp, player2_hp, created_at)
      VALUES ('waiting', 'private', ?, ?, ?, ?, ?, ?)
    `).run(joinCode, userId, ARENA_STAKE, ARENA_HP, ARENA_HP, now);
    matchId = info.lastInsertRowid;
  })();
  return { matchId };
}

function startPrivateMatch(matchId, player2Id, now = nowTs()) {
  const match = getMatch(matchId);
  if (!match || match.status !== 'waiting' || match.visibility !== 'private') {
    throw new Error('Arena room is no longer available.');
  }
  if (Number(match.player1_id) === Number(player2Id)) {
    throw new Error('You cannot join your own Arena room.');
  }
  validateArenaEntry(match.player1_id);
  validateArenaEntry(player2Id);
  assertUserAvailableForArena(player2Id);

  db.prepare('UPDATE users SET coins = coins - ? WHERE id IN (?, ?)').run(
    ARENA_STAKE,
    match.player1_id,
    player2Id,
  );
  db.prepare(`
    UPDATE arena_matches
    SET player2_id = ?,
        status = 'countdown',
        countdown_ends_at = ?
    WHERE id = ?
  `).run(player2Id, now + ARENA_COUNTDOWN_SECONDS, match.id);
}

function joinPrivateRoomByCode(userId, code, now = nowTs()) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) throw new Error('Enter the arena code.');

  let matchId = null;
  db.transaction(() => {
    syncExpiredArenaStates(now);
    const match = db.prepare(`
      SELECT *
      FROM arena_matches
      WHERE join_code = ? AND visibility = 'private' AND status = 'waiting'
    `).get(normalized);
    if (!match) throw new Error('Arena room not found or expired.');
    startPrivateMatch(match.id, userId, now);
    matchId = match.id;
  })();
  return { matchId };
}

function submitChoice(userId, matchId, attack, defense, now = nowTs()) {
  const normalizedAttack = normalizeElement(attack);
  const normalizedDefense = normalizeElement(defense);
  if (!normalizedAttack || !normalizedDefense) throw new Error('Choose attack and armor.');

  db.transaction(() => {
    const match = syncMatch(matchId, now);
    if (!match || match.status !== 'active') throw new Error('Arena match is not active.');
    const isP1 = Number(match.player1_id) === Number(userId);
    const isP2 = Number(match.player2_id) === Number(userId);
    if (!isP1 && !isP2) throw new Error('You are not in this Arena match.');

    const round = getCurrentRound(match.id, match.current_round);
    if (!round || round.resolved) throw new Error('This round is already resolved.');

    const attackCol = isP1 ? 'p1_attack' : 'p2_attack';
    const defenseCol = isP1 ? 'p1_defense' : 'p2_defense';
    if (round[attackCol] || round[defenseCol]) throw new Error('Choice already submitted.');

    db.prepare(`
      UPDATE arena_rounds
      SET ${attackCol} = ?,
          ${defenseCol} = ?
      WHERE match_id = ? AND round_number = ?
    `).run(normalizedAttack, normalizedDefense, match.id, match.current_round);

    const updated = getCurrentRound(match.id, match.current_round);
    if (updated.p1_attack && updated.p1_defense && updated.p2_attack && updated.p2_defense) {
      resolveRound(match.id, match.current_round, now);
    }
  })();
  return { matchId };
}

function forfeitMatch(userId, matchId, now = nowTs()) {
  db.transaction(() => {
    const match = syncMatch(matchId, now);
    if (!match || !['waiting', 'countdown', 'active'].includes(match.status)) {
      throw new Error('Arena match is not active.');
    }
    const isP1 = Number(match.player1_id) === Number(userId);
    const isP2 = Number(match.player2_id) === Number(userId);
    if (!isP1 && !isP2) throw new Error('You are not in this Arena match.');
    const winnerId = isP1 ? match.player2_id : match.player1_id;

    if (!winnerId) {
      db.prepare(`
        UPDATE arena_matches
        SET status = 'cancelled',
            result = 'forfeit',
            finished_at = ?
        WHERE id = ?
      `).run(now, match.id);
      return;
    }

    finishMatch(match, 'forfeit', winnerId, now);
  })();
  return { matchId };
}

function getPendingInvite(matchId, inviteeId) {
  return db.prepare(`
    SELECT *
    FROM arena_match_invites
    WHERE match_id = ? AND invitee_id = ? AND status = 'pending'
  `).get(matchId, inviteeId);
}

function getInviteByToken(token) {
  return db.prepare('SELECT * FROM arena_match_invites WHERE token = ?').get(token);
}

function createMatchInvite(inviterId, matchId, targetUserId, now = nowTs()) {
  syncMatch(matchId, now);
  const match = getMatch(matchId);
  if (!match) throw new Error('Arena room not found.');
  if (match.visibility !== 'private' || match.status !== 'waiting') {
    throw new Error('Invites are only available for waiting private Arena rooms.');
  }
  if (Number(match.player1_id) !== Number(inviterId)) {
    throw new Error('Only the room creator can invite players.');
  }
  if (Number(inviterId) === Number(targetUserId)) {
    throw new Error('You cannot invite yourself.');
  }
  const target = getUser(targetUserId);
  if (!target) throw new Error('User not found.');
  if (getActiveArenaMatchForUser(targetUserId) || db.prepare('SELECT 1 FROM arena_queue WHERE user_id = ?').get(targetUserId)) {
    throw new Error(`${target.first_name || 'This player'} is already in Arena.`);
  }

  const existing = getPendingInvite(match.id, targetUserId);
  if (existing) {
    return {
      match,
      target,
      invite: existing,
      created: false,
      message: `Invite already sent to ${target.first_name || 'this player'}.`,
    };
  }

  const token = createArenaInviteToken();
  const info = db.prepare(`
    INSERT INTO arena_match_invites (match_id, inviter_id, invitee_id, token, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(match.id, inviterId, targetUserId, token, now);

  return {
    match,
    target,
    invite: db.prepare('SELECT * FROM arena_match_invites WHERE id = ?').get(info.lastInsertRowid),
    created: true,
    message: `Invite sent to ${target.first_name || 'this player'}.`,
  };
}

function joinMatchByInvite(userId, token, now = nowTs()) {
  const invite = getInviteByToken(token);
  const inviteCheck = validateArenaInviteForUser(invite, userId);
  if (!inviteCheck.ok) throw new Error(inviteCheck.error);

  let matchId = null;
  db.transaction(() => {
    syncExpiredArenaStates(now);
    startPrivateMatch(invite.match_id, userId, now);
    db.prepare(`
      UPDATE arena_match_invites
      SET status = 'accepted',
          used_at = ?
      WHERE id = ?
    `).run(now, invite.id);
    matchId = invite.match_id;
  })();
  return { matchId };
}

function serializeUser(userId) {
  const row = db.prepare(`
    SELECT u.id, u.telegram_id, u.username, u.first_name, u.photo_url,
           u.supporter_since, u.supporter_stars,
           p.slot_head, p.slot_body, p.slot_hands, p.slot_fren, p.slot_face
    FROM users u
    LEFT JOIN peepers p ON p.user_id = u.id
    WHERE u.id = ?
  `).get(userId);
  if (!row) return null;
  return {
    userId: row.id,
    telegramId: row.telegram_id,
    firstName: row.first_name,
    username: row.username,
    photoUrl: row.photo_url,
    supporter_since: row.supporter_since,
    supporter_stars: row.supporter_stars,
    outfit: {
      slot_head: row.slot_head,
      slot_body: row.slot_body,
      slot_hands: row.slot_hands,
      slot_fren: row.slot_fren,
      slot_face: row.slot_face,
    },
  };
}

function serializeRoundPerspective(round, isSelfP1) {
  if (!round) return null;
  const selfPrefix = isSelfP1 ? 'p1' : 'p2';
  const opponentPrefix = isSelfP1 ? 'p2' : 'p1';
  return {
    roundNumber: round.round_number,
    self: {
      attack: round[`${selfPrefix}_attack`],
      defense: round[`${selfPrefix}_defense`],
      damageDealt: round[`${selfPrefix}_damage_dealt`],
      multiplier: round[`${selfPrefix}_multiplier`],
    },
    opponent: {
      attack: round[`${opponentPrefix}_attack`],
      defense: round[`${opponentPrefix}_defense`],
      damageDealt: round[`${opponentPrefix}_damage_dealt`],
      multiplier: round[`${opponentPrefix}_multiplier`],
    },
  };
}

function serializeMatchState(matchId, userId, now = nowTs()) {
  const match = syncMatch(matchId, now);
  if (!match) return null;
  const isP1 = Number(match.player1_id) === Number(userId);
  const isP2 = Number(match.player2_id) === Number(userId);
  if (!isP1 && !isP2) return null;

  const selfBase = serializeUser(userId);
  const opponentId = isP1 ? match.player2_id : match.player1_id;
  const opponentBase = opponentId ? serializeUser(opponentId) : null;
  const currentRound = match.current_round
    ? getCurrentRound(match.id, match.current_round)
    : null;
  const lastRound = db.prepare(`
    SELECT *
    FROM arena_rounds
    WHERE match_id = ? AND resolved = 1
    ORDER BY round_number DESC
    LIMIT 1
  `).get(match.id);

  return {
    match: {
      id: match.id,
      status: match.status,
      visibility: match.visibility,
      joinCode: isP1 ? match.join_code : null,
      currentRound: match.current_round,
      stake: match.stake,
      countdownEndsAt: match.countdown_ends_at,
    },
    constants: {
      stake: ARENA_STAKE,
      maxHp: ARENA_HP,
      choiceSeconds: ARENA_CHOICE_SECONDS,
      countdownSeconds: ARENA_COUNTDOWN_SECONDS,
      elements: ELEMENTS,
      elementEmoji: ELEMENT_EMOJI,
      elementColors: ELEMENT_COLORS,
    },
    players: {
      self: selfBase ? {
        ...selfBase,
        hp: isP1 ? match.player1_hp : match.player2_hp,
        maxHp: ARENA_HP,
      } : null,
      opponent: opponentBase ? {
        ...opponentBase,
        hp: isP1 ? match.player2_hp : match.player1_hp,
        maxHp: ARENA_HP,
      } : null,
    },
    currentRound: currentRound ? {
      roundNumber: currentRound.round_number,
      deadline: match.round_deadline,
      selfSubmitted: Boolean(isP1 ? currentRound.p1_attack : currentRound.p2_attack),
      opponentSubmitted: Boolean(isP1 ? currentRound.p2_attack : currentRound.p1_attack),
    } : null,
    lastRound: lastRound ? serializeRoundPerspective(lastRound, isP1) : null,
    result: match.result,
    winnerId: match.winner_id,
  };
}

module.exports = {
  ARENA_STAKE,
  ARENA_HP,
  ARENA_BASE_DAMAGE,
  ARENA_CHOICE_SECONDS,
  ARENA_COUNTDOWN_SECONDS,
  ARENA_QUEUE_TIMEOUT_SECONDS,
  ARENA_PRIVATE_ROOM_TIMEOUT_SECONDS,
  ELEMENTS,
  ELEMENT_BEATS,
  calcDamageMultiplier,
  calcDamage,
  resolveCombatRound,
  validateArenaInviteForUser,
  assertUserAvailableForArena,
  joinQueue,
  leaveQueue,
  getQueueStatus,
  getPublicQueueStatus,
  getCurrentArenaState,
  getArenaLeaderboard,
  createPrivateRoom,
  joinPrivateRoomByCode,
  createMatchInvite,
  joinMatchByInvite,
  submitChoice,
  forfeitMatch,
  syncMatch,
  serializeMatchState,
};
