const db = require('./database');
const { compareDealerHands, comparePvpHands } = require('./blackjackHandUtils');
const {
  createBlackjackInviteToken,
  validateBlackjackInviteForUser,
} = require('./blackjackInviteUtils');

const BLACKJACK_STAKE = 10;
const BLACKJACK_MAX_PLAYERS = 5;
const BLACKJACK_BETTING_SECONDS = 10;
const BLACKJACK_SETTLEMENT_SECONDS = 7;
const BLACKJACK_TURN_SECONDS = 15;
const BLACKJACK_INACTIVE_KICK_SECONDS = 180;
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function shuffle(array) {
  const next = [...array];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function buildDeck() {
  return shuffle(
    SUITS.flatMap((suit) => RANKS.map((rank) => ({
      id: `${rank}_${suit}`,
      rank,
      suit,
    }))),
  );
}

function getCardBaseValue(rank) {
  if (rank === 'A') return 1;
  if (['K', 'Q', 'J'].includes(rank)) return 10;
  return Number(rank);
}

function evaluateHand(cards) {
  const safeCards = Array.isArray(cards) ? cards : [];
  let total = 0;
  let aces = 0;

  safeCards.forEach((card) => {
    total += getCardBaseValue(card.rank);
    if (card.rank === 'A') aces += 1;
  });

  let bestTotal = total;
  let soft = false;
  for (let upgradedAces = 1; upgradedAces <= aces; upgradedAces += 1) {
    const candidate = total + (upgradedAces * 10);
    if (candidate <= 21 && candidate > bestTotal) {
      bestTotal = candidate;
      soft = true;
    }
  }

  if (bestTotal > 21) {
    bestTotal = total;
    soft = false;
  }

  return {
    total: bestTotal,
    bust: bestTotal > 21,
    blackjack: safeCards.length === 2 && bestTotal === 21,
    soft,
  };
}

function nextSeatIndex(takenSeats) {
  for (let index = 0; index < BLACKJACK_MAX_PLAYERS; index += 1) {
    if (!takenSeats.includes(index)) return index;
  }
  return null;
}

function getLobbyById(lobbyId) {
  return db.prepare('SELECT * FROM blackjack_lobbies WHERE id = ?').get(lobbyId);
}

function getPendingInvite(lobbyId, userId) {
  return db.prepare(`
    SELECT *
    FROM blackjack_lobby_invites
    WHERE lobby_id = ?
      AND invitee_id = ?
      AND status = 'pending'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(lobbyId, userId);
}

function getInviteByToken(token) {
  return db.prepare(`
    SELECT *
    FROM blackjack_lobby_invites
    WHERE token = ?
    LIMIT 1
  `).get(String(token || '').trim());
}

function getLobbyMembers(lobbyId) {
  return db.prepare(`
    SELECT m.*, u.username, u.first_name, u.photo_url
    FROM blackjack_lobby_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.lobby_id = ?
    ORDER BY m.seat_index ASC, m.joined_at ASC
  `).all(lobbyId);
}

function getLobbyBets(lobbyId) {
  return db.prepare(`
    SELECT b.*, m.seat_index
    FROM blackjack_lobby_bets b
    JOIN blackjack_lobby_members m
      ON m.lobby_id = b.lobby_id
     AND m.user_id = b.user_id
    WHERE b.lobby_id = ?
    ORDER BY m.seat_index ASC, b.placed_at ASC
  `).all(lobbyId);
}

function getRoundById(roundId) {
  if (!roundId) return null;
  return db.prepare('SELECT * FROM blackjack_rounds WHERE id = ?').get(roundId);
}

function getRoundPlayers(roundId) {
  return db.prepare(`
    SELECT rp.*, u.username, u.first_name, u.photo_url
    FROM blackjack_round_players rp
    JOIN users u ON u.id = rp.user_id
    WHERE rp.round_id = ?
    ORDER BY rp.seat_index ASC
  `).all(roundId);
}

function getUserActiveLobby(userId) {
  return db.prepare(`
    SELECT l.*
    FROM blackjack_lobby_members m
    JOIN blackjack_lobbies l ON l.id = m.lobby_id
    WHERE m.user_id = ?
  `).get(userId);
}

function generateJoinCode() {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function createUniqueJoinCode() {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = generateJoinCode();
    const exists = db.prepare('SELECT 1 FROM blackjack_lobbies WHERE join_code = ?').get(code);
    if (!exists) return code;
  }
  throw new Error('Could not generate a unique table code.');
}

function drawCard(deck, position) {
  if (position >= deck.length) {
    throw new Error('Blackjack deck exhausted.');
  }
  return { card: deck[position], nextPosition: position + 1 };
}

function getEligibleTurnPlayers(roundPlayers) {
  return roundPlayers.filter((player) => !player.stood && !player.bust && !player.blackjack);
}

function formatUserLabel(member) {
  return member.username ? `@${member.username}` : member.first_name || 'Player';
}

function serializeCards(cards, hidden) {
  if (hidden) {
    return cards.map(() => ({ hidden: true }));
  }
  return cards;
}

function serializeDealerCards(cards, revealAll) {
  if (revealAll) {
    return cards;
  }

  return cards.map((card, index) => (index === 0 ? card : { hidden: true }));
}

function formatCoins(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(Number(value) || 0)));
}

function updateRoundPlayerState(roundId, userId, patch) {
  const current = db.prepare(`
    SELECT * FROM blackjack_round_players
    WHERE round_id = ? AND user_id = ?
  `).get(roundId, userId);
  if (!current) return;

  const cards = patch.cards || parseJson(current.cards_json, []);
  const evaluation = evaluateHand(cards);
  const stood = patch.stood != null ? patch.stood : current.stood;
  const bust = patch.bust != null ? patch.bust : evaluation.bust ? 1 : current.bust;
  const blackjack = patch.blackjack != null ? patch.blackjack : evaluation.blackjack ? 1 : current.blackjack;
  const finalTotal = patch.final_total != null ? patch.final_total : evaluation.total;

  db.prepare(`
    UPDATE blackjack_round_players
    SET cards_json = ?,
        stood = ?,
        bust = ?,
        blackjack = ?,
        final_total = ?,
        result = COALESCE(?, result)
    WHERE round_id = ? AND user_id = ?
  `).run(
    JSON.stringify(cards),
    stood,
    bust,
    blackjack,
    finalTotal,
    patch.result ?? null,
    roundId,
    userId,
  );
}

function reseatLobbyMembers(lobbyId) {
  const members = db.prepare(`
    SELECT user_id
    FROM blackjack_lobby_members
    WHERE lobby_id = ?
    ORDER BY seat_index ASC, joined_at ASC
  `).all(lobbyId);

  members.forEach((member, index) => {
    db.prepare(`
      UPDATE blackjack_lobby_members
      SET seat_index = ?
      WHERE lobby_id = ? AND user_id = ?
    `).run(index, lobbyId, member.user_id);
  });
}

function deleteLobbyIfEmpty(lobbyId) {
  const countRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM blackjack_lobby_members
    WHERE lobby_id = ?
  `).get(lobbyId);

  if ((countRow?.count || 0) === 0) {
    db.prepare('DELETE FROM blackjack_lobbies WHERE id = ?').run(lobbyId);
  }
}

function touchLobbyMember(lobbyId, userId, now = nowTs()) {
  db.prepare(`
    UPDATE blackjack_lobby_members
    SET last_seen_at = ?
    WHERE lobby_id = ? AND user_id = ?
  `).run(now, lobbyId, userId);
}

function reconcileLobbyAfterDeparture(lobbyId, now = nowTs()) {
  const freshLobby = getLobbyById(lobbyId);
  if (!freshLobby) return;

  if (freshLobby.status !== 'active') {
    reseatLobbyMembers(lobbyId);
  }

  const remainingMembersCount = getLobbyMembers(lobbyId).length;
  const remainingBets = db.prepare(`
    SELECT COUNT(*) AS count
    FROM blackjack_lobby_bets
    WHERE lobby_id = ?
  `).get(lobbyId);

  if ((remainingBets?.count || 0) === 0 && freshLobby.status === 'betting') {
    db.prepare(`
      UPDATE blackjack_lobbies
      SET countdown_started_at = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(now, lobbyId);
  } else if (
    freshLobby.status === 'betting'
    && remainingMembersCount > 0
    && (remainingBets?.count || 0) === remainingMembersCount
  ) {
    startRound(lobbyId, now);
  }

  deleteLobbyIfEmpty(lobbyId);
}

function cleanupStaleMembers(lobbyId, now = nowTs()) {
  const lobby = getLobbyById(lobbyId);
  if (!lobby) return;

  const cutoff = now - BLACKJACK_INACTIVE_KICK_SECONDS;
  const staleMembers = db.prepare(`
    SELECT *
    FROM blackjack_lobby_members
    WHERE lobby_id = ?
      AND COALESCE(NULLIF(last_seen_at, 0), joined_at) <= ?
    ORDER BY seat_index ASC, joined_at ASC
  `).all(lobbyId, cutoff);

  if (!staleMembers.length) return;

  let removedAny = false;

  db.transaction(() => {
    staleMembers.forEach((member) => {
      if (lobby.status === 'active' && lobby.current_round_id) {
        const activeParticipant = db.prepare(`
          SELECT 1
          FROM blackjack_round_players
          WHERE round_id = ? AND user_id = ?
        `).get(lobby.current_round_id, member.user_id);
        if (activeParticipant) return;
      }

      const pendingBet = db.prepare(`
        SELECT *
        FROM blackjack_lobby_bets
        WHERE lobby_id = ? AND user_id = ?
      `).get(lobbyId, member.user_id);

      if (pendingBet) {
        db.prepare('DELETE FROM blackjack_lobby_bets WHERE lobby_id = ? AND user_id = ?').run(lobbyId, member.user_id);
        db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(pendingBet.bet_amount, member.user_id);
      }

      db.prepare('DELETE FROM blackjack_lobby_members WHERE lobby_id = ? AND user_id = ?').run(lobbyId, member.user_id);
      removedAny = true;
    });
  })();

  if (removedAny) {
    reconcileLobbyAfterDeparture(lobbyId, now);
  }
}

function openBettingPhase(lobbyId, now) {
  db.prepare(`
    UPDATE blackjack_lobbies
    SET status = 'betting',
        current_round_id = NULL,
        settlement_ends_at = NULL,
        countdown_started_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(now, lobbyId);
}

function playDealerToCompletion(round) {
  const deck = parseJson(round.deck_json, []);
  let deckPosition = Number(round.deck_position || 0);
  const dealerCards = parseJson(round.dealer_cards_json, []);
  let evaluation = evaluateHand(dealerCards);

  while (!evaluation.bust && evaluation.total < 17) {
    const drawn = drawCard(deck, deckPosition);
    dealerCards.push(drawn.card);
    deckPosition = drawn.nextPosition;
    evaluation = evaluateHand(dealerCards);
  }

  db.prepare(`
    UPDATE blackjack_rounds
    SET dealer_cards_json = ?,
        deck_position = ?
    WHERE id = ?
  `).run(JSON.stringify(dealerCards), deckPosition, round.id);

  return { dealerCards, evaluation };
}

function resolveRound(lobbyId, roundId, now = nowTs()) {
  const round = getRoundById(roundId);
  if (!round || round.status === 'settlement') return;

  const roundPlayers = getRoundPlayers(roundId).map((player) => {
    const cards = parseJson(player.cards_json, []);
    return {
      ...player,
      cards,
      evaluation: evaluateHand(cards),
    };
  });

  let carryOut = 0;

  if (round.mode === 'dealer') {
    const player = roundPlayers[0];
    let dealerEval = evaluateHand(parseJson(round.dealer_cards_json, []));

    if (!player.evaluation.bust && !player.evaluation.blackjack && !dealerEval.blackjack) {
      dealerEval = playDealerToCompletion(round).evaluation;
    }

    let playerResult = 'lose';
    if (player.evaluation.bust) {
      playerResult = 'lose';
    } else if (dealerEval.bust) {
      playerResult = 'win';
    } else {
      const comparison = compareDealerHands(player.evaluation, dealerEval);
      if (comparison > 0) playerResult = 'win';
      else if (comparison === 0) playerResult = 'push';
    }

    if (playerResult === 'win') {
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(round.pot_total, player.user_id);
    } else if (playerResult === 'push') {
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(player.bet_amount, player.user_id);
      carryOut = Number(round.carry_in || 0);
    }

    roundPlayers.forEach((candidate) => {
      db.prepare(`
        UPDATE blackjack_round_players
        SET stood = 1,
            bust = ?,
            blackjack = ?,
            final_total = ?,
            result = ?
        WHERE round_id = ? AND user_id = ?
      `).run(
        candidate.evaluation.bust ? 1 : 0,
        candidate.evaluation.blackjack ? 1 : 0,
        candidate.evaluation.total,
        candidate.user_id === player.user_id ? playerResult : 'watch',
        roundId,
        candidate.user_id,
      );
    });
  } else {
    const eligible = roundPlayers.filter((player) => !player.evaluation.bust);
    if (!eligible.length) {
      roundPlayers.forEach((player) => {
        db.prepare(`
          UPDATE blackjack_round_players
          SET stood = 1,
              bust = ?,
              blackjack = ?,
              final_total = ?,
              result = 'burned'
          WHERE round_id = ? AND user_id = ?
        `).run(
          player.evaluation.bust ? 1 : 0,
          player.evaluation.blackjack ? 1 : 0,
          player.evaluation.total,
          roundId,
          player.user_id,
        );
      });
    } else {
      let winners = [eligible[0]];
      for (let index = 1; index < eligible.length; index += 1) {
        const comparison = comparePvpHands(eligible[index].evaluation, winners[0].evaluation);
        if (comparison > 0) winners = [eligible[index]];
        else if (comparison === 0) winners.push(eligible[index]);
      }

      if (winners.length === 1) {
        db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(round.pot_total, winners[0].user_id);
      } else {
        const share = Math.floor(round.pot_total / winners.length);
        carryOut = round.pot_total - (share * winners.length);
        winners.forEach((winner) => {
          db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(share, winner.user_id);
        });
      }

      roundPlayers.forEach((player) => {
        const isWinner = winners.some((winner) => winner.user_id === player.user_id);
        const result = player.evaluation.bust
          ? 'bust'
          : winners.length > 1 && isWinner
            ? 'split'
            : isWinner
              ? 'win'
              : 'lose';

        db.prepare(`
          UPDATE blackjack_round_players
          SET stood = 1,
              bust = ?,
              blackjack = ?,
              final_total = ?,
              result = ?
          WHERE round_id = ? AND user_id = ?
        `).run(
          player.evaluation.bust ? 1 : 0,
          player.evaluation.blackjack ? 1 : 0,
          player.evaluation.total,
          result,
          roundId,
          player.user_id,
        );
      });
    }
  }

  db.prepare(`
    UPDATE blackjack_rounds
    SET status = 'settlement',
        current_turn_seat = NULL,
        turn_deadline_at = NULL,
        finished_at = ?
    WHERE id = ?
  `).run(now, roundId);

  db.prepare(`
    UPDATE blackjack_lobbies
    SET status = 'settlement',
        carry_pot = ?,
        settlement_ends_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(carryOut, now + BLACKJACK_SETTLEMENT_SECONDS, now, lobbyId);
}

function advanceTurnOrResolve(lobbyId, roundId, now) {
  const roundPlayers = getRoundPlayers(roundId).map((player) => ({
    ...player,
    cards: parseJson(player.cards_json, []),
  }));
  const eligible = getEligibleTurnPlayers(roundPlayers);

  if (!eligible.length) {
    resolveRound(lobbyId, roundId, now);
    return;
  }

  db.prepare(`
    UPDATE blackjack_rounds
    SET current_turn_seat = ?,
        turn_deadline_at = ?
    WHERE id = ?
  `).run(eligible[0].seat_index, now + BLACKJACK_TURN_SECONDS, roundId);
}

function startRound(lobbyId, now = nowTs()) {
  const lobby = getLobbyById(lobbyId);
  if (!lobby) return;

  const bets = db.prepare(`
    SELECT b.*, m.seat_index
    FROM blackjack_lobby_bets b
    JOIN blackjack_lobby_members m
      ON m.lobby_id = b.lobby_id
     AND m.user_id = b.user_id
    WHERE b.lobby_id = ?
    ORDER BY m.seat_index ASC, b.placed_at ASC
  `).all(lobbyId);

  if (!bets.length) {
    db.prepare(`
      UPDATE blackjack_lobbies
      SET countdown_started_at = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(now, lobbyId);
    return;
  }

  const deck = buildDeck();
  let deckPosition = 0;
  const participants = bets.map((bet) => ({ ...bet, cards: [] }));
  const mode = participants.length === 1 ? 'dealer' : 'pvp';
  const dealerCards = [];

  for (let pass = 0; pass < 2; pass += 1) {
    participants.forEach((participant) => {
      const drawn = drawCard(deck, deckPosition);
      participant.cards.push(drawn.card);
      deckPosition = drawn.nextPosition;
    });
    if (mode === 'dealer') {
      const drawn = drawCard(deck, deckPosition);
      dealerCards.push(drawn.card);
      deckPosition = drawn.nextPosition;
    }
  }

  const carryIn = Number(lobby.carry_pot || 0);
  const potTotal = (mode === 'dealer'
    ? BLACKJACK_STAKE * 2
    : participants.reduce((sum, participant) => sum + Number(participant.bet_amount || 0), 0)) + carryIn;

  const roundInsert = db.prepare(`
    INSERT INTO blackjack_rounds (
      lobby_id,
      mode,
      status,
      pot_total,
      carry_in,
      deck_json,
      deck_position,
      dealer_cards_json,
      started_at
    ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)
  `).run(
    lobbyId,
    mode,
    potTotal,
    carryIn,
    JSON.stringify(deck),
    deckPosition,
    mode === 'dealer' ? JSON.stringify(dealerCards) : null,
    now,
  );
  const roundId = Number(roundInsert.lastInsertRowid);

  const insertPlayer = db.prepare(`
    INSERT INTO blackjack_round_players (
      round_id,
      user_id,
      seat_index,
      bet_amount,
      cards_json,
      stood,
      bust,
      blackjack,
      final_total,
      result
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);

  participants.forEach((participant) => {
    const evaluation = evaluateHand(participant.cards);
    insertPlayer.run(
      roundId,
      participant.user_id,
      participant.seat_index,
      participant.bet_amount,
      JSON.stringify(participant.cards),
      evaluation.blackjack ? 1 : 0,
      evaluation.bust ? 1 : 0,
      evaluation.blackjack ? 1 : 0,
      evaluation.total,
    );
  });

  db.prepare(`
    UPDATE blackjack_lobbies
    SET status = 'active',
        current_round_id = ?,
        carry_pot = 0,
        countdown_started_at = NULL,
        settlement_ends_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(roundId, now, lobbyId);

  db.prepare('DELETE FROM blackjack_lobby_bets WHERE lobby_id = ?').run(lobbyId);
  advanceTurnOrResolve(lobbyId, roundId, now);
}

function processActiveLobby(lobby, now) {
  const round = getRoundById(lobby.current_round_id);
  if (!round) {
    openBettingPhase(lobby.id, now);
    return;
  }

  let freshRound = round;
  let guard = 0;
  while (freshRound.current_turn_seat != null && freshRound.turn_deadline_at && freshRound.turn_deadline_at <= now && guard < 12) {
    const timedOutPlayer = db.prepare(`
      SELECT *
      FROM blackjack_round_players
      WHERE round_id = ? AND seat_index = ?
    `).get(freshRound.id, freshRound.current_turn_seat);

    if (!timedOutPlayer) break;

    updateRoundPlayerState(freshRound.id, timedOutPlayer.user_id, { stood: 1 });
    advanceTurnOrResolve(lobby.id, freshRound.id, now);
    freshRound = getRoundById(lobby.current_round_id);
    if (!freshRound || freshRound.status === 'settlement') break;
    guard += 1;
  }
}

function syncLobby(lobbyId) {
  let lobby = getLobbyById(lobbyId);
  if (!lobby) return null;

  const now = nowTs();
  cleanupStaleMembers(lobbyId, now);
  lobby = getLobbyById(lobbyId);
  if (!lobby) return null;

  if (lobby.status === 'active') {
    processActiveLobby(lobby, now);
  }

  lobby = getLobbyById(lobbyId);
  if (!lobby) return null;

  if (lobby.status === 'settlement' && lobby.settlement_ends_at && lobby.settlement_ends_at <= now) {
    openBettingPhase(lobbyId, now);
  }

  lobby = getLobbyById(lobbyId);
  if (!lobby) return null;

  if (lobby.status === 'betting' && lobby.countdown_started_at && lobby.countdown_started_at + BLACKJACK_BETTING_SECONDS <= now) {
    startRound(lobbyId, now);
  }

  cleanupStaleMembers(lobbyId, now);
  return getLobbyById(lobbyId);
}

function syncAllLobbies() {
  db.prepare('SELECT id FROM blackjack_lobbies').all().forEach((lobby) => {
    syncLobby(lobby.id);
  });
}

function ensureJoinable(userId, lobbyId) {
  const existingLobby = getUserActiveLobby(userId);
  if (existingLobby && Number(existingLobby.id) !== Number(lobbyId)) {
    throw new Error('Leave your current table first.');
  }
}

function createLobby(userId, visibility) {
  syncAllLobbies();
  const activeLobby = getUserActiveLobby(userId);
  if (activeLobby) {
    return { lobbyId: activeLobby.id };
  }

  const now = nowTs();
  const joinCode = visibility === 'closed' ? createUniqueJoinCode() : null;
  const created = db.prepare(`
    INSERT INTO blackjack_lobbies (
      visibility,
      join_code,
      status,
      created_by,
      created_at,
      updated_at
    ) VALUES (?, ?, 'betting', ?, ?, ?)
  `).run(visibility, joinCode, userId, now, now);
  const lobbyId = Number(created.lastInsertRowid);

  db.prepare(`
    INSERT INTO blackjack_lobby_members (lobby_id, user_id, seat_index, joined_at, last_seen_at)
    VALUES (?, ?, 0, ?, ?)
  `).run(lobbyId, userId, now, now);

  return { lobbyId };
}

function joinLobby(userId, { lobbyId, code = null, invited = false }) {
  syncAllLobbies();
  const lobby = lobbyId
    ? getLobbyById(lobbyId)
    : db.prepare('SELECT * FROM blackjack_lobbies WHERE join_code = ?').get(String(code || '').trim().toUpperCase());

  if (!lobby) throw new Error('Table not found.');
  ensureJoinable(userId, lobby.id);

  let pendingInvite = null;
  if (lobby.visibility === 'closed') {
    const normalizedCode = String(code || '').trim().toUpperCase();
    pendingInvite = getPendingInvite(lobby.id, userId);
    if (!invited && !pendingInvite && (!normalizedCode || normalizedCode !== String(lobby.join_code || '').toUpperCase())) {
      throw new Error('Wrong table code.');
    }
  }

  const existingMember = db.prepare(`
    SELECT 1
    FROM blackjack_lobby_members
    WHERE lobby_id = ? AND user_id = ?
  `).get(lobby.id, userId);
  if (existingMember) return { lobbyId: lobby.id };

  const members = getLobbyMembers(lobby.id);
  if (members.length >= BLACKJACK_MAX_PLAYERS) {
    throw new Error('This table is full.');
  }

  const seatIndex = nextSeatIndex(members.map((member) => member.seat_index));
  if (seatIndex == null) {
    throw new Error('No free seats available.');
  }

  db.prepare(`
    INSERT INTO blackjack_lobby_members (lobby_id, user_id, seat_index, joined_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(lobby.id, userId, seatIndex, nowTs(), nowTs());

  if (pendingInvite) {
    db.prepare(`
      UPDATE blackjack_lobby_invites
      SET status = 'used',
          used_at = ?
      WHERE id = ?
    `).run(nowTs(), pendingInvite.id);
  }

  return { lobbyId: lobby.id };
}

function createLobbyInvite(inviterUserId, lobbyId, targetUserId) {
  syncAllLobbies();
  const lobby = getLobbyById(lobbyId);
  if (!lobby) throw new Error('Table not found.');
  if (lobby.visibility !== 'closed') throw new Error('Invites are only available for private tables.');

  const inviterMember = db.prepare(`
    SELECT 1
    FROM blackjack_lobby_members
    WHERE lobby_id = ? AND user_id = ?
  `).get(lobby.id, inviterUserId);
  if (!inviterMember) throw new Error('You must be sitting at this table to invite players.');

  if (Number(inviterUserId) === Number(targetUserId)) {
    throw new Error('Cannot invite yourself.');
  }

  const target = db.prepare('SELECT id, telegram_id, username, first_name FROM users WHERE id = ?').get(targetUserId);
  if (!target) throw new Error('User not found.');

  const targetMember = db.prepare(`
    SELECT 1
    FROM blackjack_lobby_members
    WHERE lobby_id = ? AND user_id = ?
  `).get(lobby.id, targetUserId);
  if (targetMember) {
    return {
      lobby,
      target,
      alreadySeated: true,
      message: `${target.first_name || 'This player'} is already at this table.`,
    };
  }

  const existing = getPendingInvite(lobby.id, targetUserId);
  if (existing) {
    return {
      lobby,
      target,
      invite: existing,
      created: false,
      message: `Invite already sent to ${target.first_name || 'this player'}.`,
    };
  }

  const now = nowTs();
  const token = createBlackjackInviteToken();
  const created = db.prepare(`
    INSERT INTO blackjack_lobby_invites (lobby_id, inviter_id, invitee_id, token, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(lobby.id, inviterUserId, targetUserId, token, now);

  return {
    lobby,
    target,
    invite: {
      id: Number(created.lastInsertRowid),
      lobby_id: lobby.id,
      inviter_id: inviterUserId,
      invitee_id: targetUserId,
      token,
      status: 'pending',
      created_at: now,
    },
    created: true,
    message: `Invite sent to ${target.first_name || 'player'}.`,
  };
}

function joinLobbyByInvite(userId, token) {
  const invite = getInviteByToken(token);
  const inviteCheck = validateBlackjackInviteForUser(invite, userId);
  if (!inviteCheck.ok) throw new Error(inviteCheck.error);

  const result = joinLobby(userId, { lobbyId: invite.lobby_id, invited: true });
  db.prepare(`
    UPDATE blackjack_lobby_invites
    SET status = 'used',
        used_at = ?
    WHERE id = ?
  `).run(nowTs(), invite.id);
  return result;
}

function leaveLobby(userId, lobbyId) {
  const lobby = syncLobby(lobbyId);
  if (!lobby) throw new Error('Table not found.');

  const member = db.prepare(`
    SELECT *
    FROM blackjack_lobby_members
    WHERE lobby_id = ? AND user_id = ?
  `).get(lobbyId, userId);
  if (!member) throw new Error('You are not sitting at this table.');

  if (lobby.status === 'active' && lobby.current_round_id) {
    const activeParticipant = db.prepare(`
      SELECT 1
      FROM blackjack_round_players
      WHERE round_id = ? AND user_id = ?
    `).get(lobby.current_round_id, userId);
    if (activeParticipant) {
      throw new Error('You can leave after the current round ends.');
    }
  }

  const pendingBet = db.prepare(`
    SELECT *
    FROM blackjack_lobby_bets
    WHERE lobby_id = ? AND user_id = ?
  `).get(lobbyId, userId);

  db.transaction(() => {
    if (pendingBet) {
      db.prepare('DELETE FROM blackjack_lobby_bets WHERE lobby_id = ? AND user_id = ?').run(lobbyId, userId);
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(pendingBet.bet_amount, userId);
    }

    db.prepare('DELETE FROM blackjack_lobby_members WHERE lobby_id = ? AND user_id = ?').run(lobbyId, userId);
  })();
  reconcileLobbyAfterDeparture(lobbyId, nowTs());
}

function placeBet(userId, lobbyId) {
  const lobby = syncLobby(lobbyId);
  if (!lobby) throw new Error('Table not found.');
  if (lobby.status !== 'betting') {
    throw new Error('Betting is closed right now.');
  }

  const member = db.prepare(`
    SELECT *
    FROM blackjack_lobby_members
    WHERE lobby_id = ? AND user_id = ?
  `).get(lobbyId, userId);
  if (!member) throw new Error('Join the table first.');
  touchLobbyMember(lobbyId, userId);

  const existingBet = db.prepare(`
    SELECT 1
    FROM blackjack_lobby_bets
    WHERE lobby_id = ? AND user_id = ?
  `).get(lobbyId, userId);
  if (existingBet) {
    throw new Error('You already placed your bet for this round.');
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || user.coins < BLACKJACK_STAKE) {
    throw new Error(`Not enough coins. Need ${BLACKJACK_STAKE} \u2726.`);
  }

  const now = nowTs();
  db.transaction(() => {
    db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').run(BLACKJACK_STAKE, userId);
    db.prepare(`
      INSERT INTO blackjack_lobby_bets (lobby_id, user_id, bet_amount, placed_at)
      VALUES (?, ?, ?, ?)
    `).run(lobbyId, userId, BLACKJACK_STAKE, now);

    if (!lobby.countdown_started_at) {
      db.prepare(`
        UPDATE blackjack_lobbies
        SET countdown_started_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(now, now, lobbyId);
    } else {
      db.prepare('UPDATE blackjack_lobbies SET updated_at = ? WHERE id = ?').run(now, lobbyId);
    }
  })();

  const seatedPlayers = getLobbyMembers(lobbyId).length;
  const betsPlaced = getLobbyBets(lobbyId).length;
  if (seatedPlayers > 0 && betsPlaced === seatedPlayers) {
    startRound(lobbyId, nowTs());
  }
}

function applyPlayerAction(userId, lobbyId, action) {
  const lobby = syncLobby(lobbyId);
  if (!lobby || lobby.status !== 'active' || !lobby.current_round_id) {
    throw new Error('No active round at this table.');
  }

  const round = getRoundById(lobby.current_round_id);
  const player = db.prepare(`
    SELECT *
    FROM blackjack_round_players
    WHERE round_id = ? AND user_id = ?
  `).get(round.id, userId);
  if (!player) throw new Error('You are spectating this round.');
  touchLobbyMember(lobbyId, userId);
  if (Number(round.current_turn_seat) !== Number(player.seat_index)) {
    throw new Error('It is not your turn.');
  }

  const cards = parseJson(player.cards_json, []);
  if (action === 'stand') {
    updateRoundPlayerState(round.id, userId, { cards, stood: 1 });
    advanceTurnOrResolve(lobbyId, round.id, nowTs());
    return;
  }

  if (action !== 'hit') {
    throw new Error('Unknown action.');
  }

  const deck = parseJson(round.deck_json, []);
  const drawn = drawCard(deck, Number(round.deck_position || 0));
  const nextCards = [...cards, drawn.card];
  const evaluation = evaluateHand(nextCards);

  db.prepare('UPDATE blackjack_rounds SET deck_position = ? WHERE id = ?').run(drawn.nextPosition, round.id);
  updateRoundPlayerState(round.id, userId, {
    cards: nextCards,
    stood: evaluation.bust || evaluation.total >= 21 ? 1 : 0,
    bust: evaluation.bust ? 1 : 0,
    blackjack: evaluation.blackjack ? 1 : 0,
    final_total: evaluation.total,
  });

  if (evaluation.bust || evaluation.total >= 21) {
    advanceTurnOrResolve(lobbyId, round.id, nowTs());
    return;
  }

  db.prepare('UPDATE blackjack_rounds SET turn_deadline_at = ? WHERE id = ?').run(nowTs() + BLACKJACK_TURN_SECONDS, round.id);
}

function buildSeatStatus({ lobby, roundPlayer, pendingBet, isCurrentTurn }) {
  if (roundPlayer) {
    if (lobby.status === 'settlement' && roundPlayer.result) return roundPlayer.result;
    if (roundPlayer.blackjack) return 'blackjack';
    if (roundPlayer.bust) return 'bust';
    if (isCurrentTurn) return 'turn';
    if (roundPlayer.stood) return 'stand';
    return 'bet';
  }
  if (pendingBet) return 'bet';
  return 'watch';
}

function buildResultSummary({ lobby, round, roundPlayers, dealerCards }) {
  if (!round || lobby.status !== 'settlement') return null;

  if (round.mode === 'dealer') {
    const player = roundPlayers[0];
    if (!player) return null;

    if (player.result === 'win') {
      return {
        title: `${formatUserLabel(player)} wins ${formatCoins(round.pot_total)} \u2726`,
        subtitle: 'Beat the dealer and cleared the table.',
      };
    }

    if (player.result === 'push') {
      return {
        title: 'Push',
        subtitle: `${formatUserLabel(player)} gets ${formatCoins(player.bet_amount)} \u2726 back.`,
      };
    }

    const dealerTotal = evaluateHand(dealerCards || []).total;
    return {
      title: `Dealer wins${dealerTotal ? ` with ${dealerTotal}` : ''}`,
      subtitle: `${formatUserLabel(player)} loses the round.`,
    };
  }

  const winners = roundPlayers.filter((player) => ['win', 'split'].includes(player.result));
  if (!winners.length) {
    return {
      title: 'Everyone busted',
      subtitle: 'The pot burned and disappears from the table.',
    };
  }

  if (winners.length === 1) {
    return {
      title: `${formatUserLabel(winners[0])} wins ${formatCoins(round.pot_total)} \u2726`,
      subtitle: 'Best live hand takes the whole table.',
    };
  }

  const carryOut = Number(lobby.carry_pot || 0);
  const paidOut = round.pot_total - carryOut;
  return {
    title: `Split Pot \u00b7 ${winners.length} winners`,
    subtitle: carryOut > 0
      ? `${formatCoins(paidOut)} \u2726 paid out, ${formatCoins(carryOut)} \u2726 carries into the next round.`
      : `${formatCoins(round.pot_total)} \u2726 split between the winners.`,
  };
}

function buildShowdownCards({ lobby, round, roundPlayers, dealerCards }) {
  if (!round || lobby.status !== 'settlement') return null;

  return {
    mode: round.mode,
    dealer: round.mode === 'dealer'
      ? {
        cards: dealerCards || [],
        total: evaluateHand(dealerCards || []).total,
      }
      : null,
    players: roundPlayers.map((player) => ({
      userId: player.user_id,
      displayName: formatUserLabel(player),
      cards: player.cards,
      total: player.evaluation.total,
      result: player.result,
      blackjack: player.evaluation.blackjack,
      bust: player.evaluation.bust,
      betAmount: player.bet_amount,
    })),
  };
}

function serializeLobbyState(lobbyId, userId) {
  const lobby = syncLobby(lobbyId);
  if (!lobby) return null;

  const member = db.prepare(`
    SELECT *
    FROM blackjack_lobby_members
    WHERE lobby_id = ? AND user_id = ?
  `).get(lobbyId, userId);
  if (!member) return null;
  touchLobbyMember(lobbyId, userId);

  const members = getLobbyMembers(lobbyId);
  const bets = getLobbyBets(lobbyId);
  const pendingBetByUserId = new Map(bets.map((bet) => [Number(bet.user_id), bet]));
  const round = getRoundById(lobby.current_round_id);
  const roundPlayers = round ? getRoundPlayers(round.id) : [];
  const roundPlayerByUserId = new Map(
    roundPlayers.map((player) => {
      const cards = parseJson(player.cards_json, []);
      return [Number(player.user_id), { ...player, cards, evaluation: evaluateHand(cards) }];
    }),
  );
  const selfRoundPlayer = roundPlayerByUserId.get(Number(userId)) || null;
  const currentPot = round
    ? Number(round.pot_total || 0)
    : bets.reduce((sum, bet) => sum + Number(bet.bet_amount || 0), 0) + Number(lobby.carry_pot || 0);
  const now = nowTs();
  const bettingRemaining = lobby.status === 'betting' && lobby.countdown_started_at
    ? Math.max(0, BLACKJACK_BETTING_SECONDS - (now - Number(lobby.countdown_started_at)))
    : 0;
  const settlementRemaining = lobby.status === 'settlement' && lobby.settlement_ends_at
    ? Math.max(0, Number(lobby.settlement_ends_at) - now)
    : 0;
  const turnRemaining = round?.turn_deadline_at
    ? Math.max(0, Number(round.turn_deadline_at) - now)
    : 0;
  const allSeatedPlayersBet = members.length > 0 && bets.length === members.length;

  const seats = members.map((tableMember) => {
    const roundPlayer = roundPlayerByUserId.get(Number(tableMember.user_id)) || null;
    const pendingBet = pendingBetByUserId.get(Number(tableMember.user_id)) || null;
    const isSelf = Number(tableMember.user_id) === Number(userId);
    const revealCards = Boolean(roundPlayer) && (lobby.status === 'settlement' || isSelf);

    return {
      userId: tableMember.user_id,
      seatIndex: tableMember.seat_index,
      firstName: tableMember.first_name,
      username: tableMember.username,
      photoUrl: tableMember.photo_url || null,
      displayName: formatUserLabel(tableMember),
      isSelf,
      status: buildSeatStatus({
        lobby,
        roundPlayer,
        pendingBet,
        isCurrentTurn: Boolean(round && round.current_turn_seat != null && Number(round.current_turn_seat) === Number(tableMember.seat_index)),
      }),
      hasBet: Boolean(roundPlayer || pendingBet),
      cards: roundPlayer ? serializeCards(roundPlayer.cards, !revealCards) : [],
      cardCount: roundPlayer ? roundPlayer.cards.length : 0,
      total: revealCards ? roundPlayer.evaluation.total : null,
      fullTotal: roundPlayer?.evaluation.total ?? null,
      result: roundPlayer?.result || null,
      betAmount: roundPlayer?.bet_amount ?? pendingBet?.bet_amount ?? null,
      isSpectator: !roundPlayer && !pendingBet,
    };
  });

  let dealer = null;
  let dealerCards = null;
  if (round?.mode === 'dealer') {
    dealerCards = parseJson(round.dealer_cards_json, []);
    const revealDealer = lobby.status === 'settlement';
    dealer = {
      cards: serializeDealerCards(dealerCards, revealDealer),
      cardCount: dealerCards.length,
      total: revealDealer ? evaluateHand(dealerCards).total : null,
    };
  }

  const userRow = db.prepare('SELECT coins FROM users WHERE id = ?').get(userId);
  const resultSummary = buildResultSummary({ lobby, round, roundPlayers: Array.from(roundPlayerByUserId.values()), dealerCards });
  const showdownCards = buildShowdownCards({ lobby, round, roundPlayers: Array.from(roundPlayerByUserId.values()), dealerCards });
  const winnerUserIds = round
    ? Array.from(roundPlayerByUserId.values())
      .filter((player) => ['win', 'split'].includes(player.result))
      .map((player) => player.user_id)
    : [];

  return {
    lobby: {
      id: lobby.id,
      visibility: lobby.visibility,
      status: lobby.status,
      joinCode: lobby.visibility === 'closed' ? lobby.join_code : null,
      carryPot: Number(lobby.carry_pot || 0),
      countdownRemaining: bettingRemaining,
      bettingRemaining,
      settlementRemaining,
      playersCount: members.length,
      maxPlayers: BLACKJACK_MAX_PLAYERS,
      allSeatedPlayersBet,
    },
    round: round ? {
      id: round.id,
      mode: round.mode,
      currentTurnSeat: round.current_turn_seat,
      turnDeadlineAt: round.turn_deadline_at,
      turnRemaining,
      potTotal: Number(round.pot_total || 0),
      resultSummary,
      winnerUserIds,
      showdownCards,
    } : null,
    seats,
    dealer,
    resultSummary,
    winnerUserIds,
    showdownCards,
    self: {
      userId,
      seatIndex: member.seat_index,
      hasPendingBet: Boolean(pendingBetByUserId.get(Number(userId))),
      isPlayerThisRound: Boolean(selfRoundPlayer),
      isCurrentTurn: Boolean(round && selfRoundPlayer && Number(round.current_turn_seat) === Number(selfRoundPlayer.seat_index)),
      coins: Number(userRow?.coins || 0),
      canBet: lobby.status === 'betting' && !pendingBetByUserId.get(Number(userId)),
      canHit: Boolean(round && selfRoundPlayer && Number(round.current_turn_seat) === Number(selfRoundPlayer.seat_index) && lobby.status === 'active'),
      canStand: Boolean(round && selfRoundPlayer && Number(round.current_turn_seat) === Number(selfRoundPlayer.seat_index) && lobby.status === 'active'),
      canLeave: !(lobby.status === 'active' && selfRoundPlayer),
    },
    info: {
      stake: BLACKJACK_STAKE,
      maxPlayers: BLACKJACK_MAX_PLAYERS,
      potPreview: currentPot,
      countdownSeconds: BLACKJACK_BETTING_SECONDS,
      turnSeconds: BLACKJACK_TURN_SECONDS,
    },
  };
}

function serializeLobbySummary(lobby, userId) {
  const members = getLobbyMembers(lobby.id);
  const bets = getLobbyBets(lobby.id);
  const round = getRoundById(lobby.current_round_id);
  const now = nowTs();
  const userInvited = lobby.visibility === 'closed' && Boolean(getPendingInvite(lobby.id, userId));

  return {
    id: lobby.id,
    visibility: lobby.visibility,
    status: lobby.status,
    playersCount: members.length,
    maxPlayers: BLACKJACK_MAX_PLAYERS,
    bettorsCount: bets.length,
    pot: round
      ? Number(round.pot_total || 0)
      : bets.reduce((sum, bet) => sum + Number(bet.bet_amount || 0), 0) + Number(lobby.carry_pot || 0),
    carryPot: Number(lobby.carry_pot || 0),
    countdownRemaining: lobby.status === 'betting' && lobby.countdown_started_at
      ? Math.max(0, BLACKJACK_BETTING_SECONDS - (now - Number(lobby.countdown_started_at)))
      : 0,
    settlementRemaining: lobby.status === 'settlement' && lobby.settlement_ends_at
      ? Math.max(0, Number(lobby.settlement_ends_at) - now)
      : 0,
    userJoined: members.some((member) => Number(member.user_id) === Number(userId)),
    userInvited,
  };
}

function listLobbies(userId) {
  syncAllLobbies();
  const lobbies = db.prepare(`
    SELECT *
    FROM blackjack_lobbies
    ORDER BY visibility = 'closed' ASC, updated_at DESC, id DESC
  `).all();
  const summaries = lobbies.map((lobby) => serializeLobbySummary(lobby, userId));
  const activeLobby = getUserActiveLobby(userId);

  return {
    stake: BLACKJACK_STAKE,
    maxPlayers: BLACKJACK_MAX_PLAYERS,
    currentLobbyId: activeLobby?.id || null,
    openLobbies: summaries.filter((lobby) => lobby.visibility === 'open'),
    closedLobbies: summaries.filter((lobby) => lobby.visibility === 'closed'),
  };
}

module.exports = {
  BLACKJACK_STAKE,
  BLACKJACK_MAX_PLAYERS,
  BLACKJACK_BETTING_SECONDS,
  BLACKJACK_TURN_SECONDS,
  listLobbies,
  createLobby,
  joinLobby,
  createLobbyInvite,
  joinLobbyByInvite,
  leaveLobby,
  placeBet,
  applyPlayerAction,
  serializeLobbyState,
  syncLobby,
  syncAllLobbies,
};
