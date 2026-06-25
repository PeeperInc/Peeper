/**
 * API client - wraps all backend calls.
 * Automatically injects Telegram initData as auth header.
 */

const BASE = '/api';

function getInitData() {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp?.initData) {
    return window.Telegram.WebApp.initData;
  }

  const params = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  const devUser = params.get('devUser') || '999999';
  const devName = params.get('devName') || 'Dev';
  const devUsername = params.get('devUsername') || `dev${devUser}`;

  return `dev_mode=1&user=${encodeURIComponent(JSON.stringify({
    id: Number(devUser),
    first_name: devName,
    username: devUsername,
  }))}&auth_date=9999999999&hash=devhash`;
}

async function request(method, path, body) {
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Init-Data': getInitData(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw { status: resp.status, message: data.error || 'Unknown error', data };
  }

  return data;
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);

export const login = () => post('/auth/login');

export const getGameState = () => get('/game/state');
export const getCasinoState = () => get('/game/casino/state');
export const spinCasino = () => post('/game/casino/spin', {});
export const getBlackjackLobbies = () => get('/blackjack/lobbies');
export const createBlackjackLobby = (visibility) => post('/blackjack/lobbies', { visibility });
export const joinBlackjackLobby = (lobbyId) => post('/blackjack/lobbies/join', { lobbyId });
export const joinBlackjackLobbyByCode = (payload) => post('/blackjack/lobbies/join-by-code', payload);
export const inviteBlackjackPlayer = (lobbyId, targetUserId) => post(`/blackjack/lobbies/${lobbyId}/invite`, { targetUserId });
export const joinBlackjackInvite = (token) => post('/blackjack/invites/join', { token });
export const leaveBlackjackLobby = (lobbyId) => post(`/blackjack/lobbies/${lobbyId}/leave`, {});
export const getBlackjackLobbyState = (lobbyId) => get(`/blackjack/lobbies/${lobbyId}/state`);
export const placeBlackjackBet = (lobbyId) => post(`/blackjack/lobbies/${lobbyId}/bet`, {});
export const actBlackjack = (lobbyId, action) => post(`/blackjack/lobbies/${lobbyId}/action`, { action });
export const arenaJoinQueue = () => post('/arena/queue', {});
export const arenaLeaveQueue = () => request('DELETE', '/arena/queue');
export const arenaQueueStatus = () => get('/arena/queue/status');
export const arenaPublicQueueStatus = () => get('/arena/queue/public-status');
export const arenaCurrent = () => get('/arena/current');
export const arenaLeaderboard = () => get('/arena/leaderboard');
export const arenaCreateRoom = () => post('/arena/create', {});
export const arenaJoinRoom = (code) => post('/arena/join', { code });
export const arenaJoinInvite = (token) => post('/arena/invites/join', { token });
export const arenaGetState = (matchId) => get(`/arena/state/${matchId}`);
export const arenaChoose = (matchId, attack, defense) => post(`/arena/choose/${matchId}`, { attack, defense });
export const arenaForfeit = (matchId) => post(`/arena/forfeit/${matchId}`, {});
export const arenaInvitePlayer = (matchId, targetUserId) => post(`/arena/matches/${matchId}/invite`, { targetUserId });
export const feedPeeper = (foodType) => post('/game/feed', { foodType });
export const playPeeper = ({ gameId, coinsEarned, gameWon }) => post('/game/play', { gameId, coinsEarned, gameWon });
export const removePeeperPoop = () => post('/game/cleanup/poop', {});
export const completePeeperCleaning = () => post('/game/cleanup/complete', {});
export const revivePeeper = () => post('/game/revive');
export const updateOutfit = (slots) => post('/game/outfit', slots);

export const getFarmState = () => get('/farm/state');
export const buyFarm = () => post('/farm/buy', {});
export const buildFarmSlot = (slotIndex, type, options = {}) => post(`/farm/slots/${slotIndex}/build`, {
  type,
  rebuild: Boolean(options.rebuild),
});
export const plantFarmCrop = (slotIndex, cropType) => post(`/farm/slots/${slotIndex}/plant`, { cropType });
export const waterFarmSlot = (slotIndex) => post(`/farm/slots/${slotIndex}/water`, {});
export const harvestFarmSlot = (slotIndex) => post(`/farm/slots/${slotIndex}/harvest`, {});
export const buyFarmAnimal = (slotIndex, animalType) => post(`/farm/slots/${slotIndex}/buy-animal`, { animalType });
export const feedFarmAnimal = (slotIndex, method = 'coins') => post(`/farm/slots/${slotIndex}/feed-animal`, { method });
export const collectFarmAnimal = (slotIndex) => post(`/farm/slots/${slotIndex}/collect-animal`, {});
export const sellFarmInventory = (productId, quantity = 1) => post('/farm/inventory/sell', { productId, quantity });
export const stockFarmFridge = (recipeType) => post('/farm/inventory/stock-fridge', { recipeType });
export const triggerFarmFamilyBigFeast = () => post('/farm/inventory/family-big-feast', {});

export const getSupportStarsOptions = () => get('/support/stars/options');
export const createSupportStarsInvoice = (amount) => post('/support/stars/invoice', { amount });

export const buyPersonalHome = () => post('/home/buy');
export const getPersonalHomeState = () => get('/home/state');
export const getHomeCatalog = () => get('/home/catalog');
export const buyHomeItem = (itemId) => post('/home/buy-item', { itemId });
export const updateHomeLayout = (payload) => post('/home/layout', payload);
export const toggleBackDecor = (itemId, enabled) => post('/home/back-decor/toggle', { itemId, enabled });
export const reorderBackDecor = (itemIds) => post('/home/back-decor/reorder', { itemIds });
export const getVisitHome = (userId) => get(`/home/visit/${userId}`);
export const sendVisitHomePhoto = (userId) => post(`/home/visit/${userId}/photo`, {});

export const getShopItems = () => get('/shop/items');
export const buyItem = (itemId) => post('/shop/buy', { itemId });

export const getGiftCatalog = () => get('/gifts/catalog');
export const searchUsersForGift = (q) => get(`/gifts/search?q=${encodeURIComponent(q)}`);
export const sendGift = (recipientId, giftId, message = null, isPrivate = false) =>
  post('/gifts/send', { recipientId, giftId, message, isPrivate });
export const getUserGifts = (userId) => get(`/gifts/received/${userId}`);
export const markGiftSeen = (giftId) => post(`/gifts/seen/${giftId}`, {});

export const searchUsers = (q) => get(`/users/search?q=${encodeURIComponent(q)}`);
export const getUserProfile = (userId) => get(`/users/${userId}/profile`);
export const getLongevityBoard = () => get('/users/leaderboard/longevity');
export const getGiftsBoard = () => get('/users/leaderboard/gifts');

export const getItems = () => get('/items');

export const getMyFamily = () => get('/family/me');
export const createFamily = (name) => post('/family/create', { name });
export const joinFamily = (inviteCode) => post('/family/join', { inviteCode });
export const leaveFamily = () => post('/family/leave');
export const kickMember = (userId) => post('/family/kick', { userId });
export const feedFamilyMember = (targetUserId) => post('/family/feed', { targetUserId });
export const triggerFamilyBigFeast = () => post('/family/big-feast', {});
export const getFamilyMessages = () => get('/family/messages');
export const markFamilyMessagesRead = () => post('/family/messages/read', {});
export const sendFamilyMessage = (message) => post('/family/message', { message });
export const getFamilyUnread = () => get('/family/unread');
export const getFamilyLeaderboard = (limit = 10) => get(`/family/leaderboard?limit=${limit}`);
export const getFamilyProfile = (familyId) => get(`/family/${familyId}/profile`);
export const inviteFamilyMember = (targetUserId) => post('/family/invite', { targetUserId });
export const getPendingInvites = () => get('/family/invites/pending');

export const getExpeditionCurrent = () => get('/expeditions/current');
export const startExpedition = (idempotencyKey) => post('/expeditions/start', { idempotencyKey });
export const prepareExpedition = (expeditionId, { role, provisionId = null, artifactIds = [], idempotencyKey }) =>
  post(`/expeditions/${expeditionId}/prepare`, { role, provisionId, artifactIds, idempotencyKey });
export const attemptExpeditionRoom = (
  expeditionId,
  roomKey,
  { actionId, selectedSupport = 0, useRoleAbility = false, useSharedBuff = false, idempotencyKey } = {},
) => post(`/expeditions/${expeditionId}/rooms/${encodeURIComponent(roomKey)}/attempt`, {
  actionId,
  selectedSupport,
  useRoleAbility,
  useSharedBuff,
  idempotencyKey,
});
export const assistExpeditionRoom = (expeditionId, roomKey, idempotencyKey) =>
  post(`/expeditions/${expeditionId}/rooms/${encodeURIComponent(roomKey)}/assist`, { idempotencyKey });
export const revealExpeditionRoom = (expeditionId, roomKey, { fromRoomKey, idempotencyKey } = {}) =>
  post(`/expeditions/${expeditionId}/rooms/${encodeURIComponent(roomKey)}/reveal`, { fromRoomKey, idempotencyKey });
export const equipFoundExpeditionArtifact = (expeditionId, { artifactId, slotIndex, idempotencyKey } = {}) =>
  post(`/expeditions/${expeditionId}/equip-found-artifact`, { artifactId, slotIndex, idempotencyKey });
export const claimExpeditionBossReward = (expeditionId, idempotencyKey) =>
  post(`/expeditions/${expeditionId}/claim-boss-reward`, { idempotencyKey });
export const finishExpedition = (expeditionId, idempotencyKey) =>
  post(`/expeditions/${expeditionId}/finish`, { idempotencyKey });
export const expeditionLog = (expeditionId) => get(`/expeditions/${expeditionId}/log`);
export const expeditionHistory = () => get('/expeditions/history');
export const expeditionArtifacts = () => get('/expeditions/artifacts');
