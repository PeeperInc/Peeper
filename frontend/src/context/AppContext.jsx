import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import * as api from '../api';
import { FALLBACK_ASSET_VERSION, setAssetVersion } from '../utils/assetUrl';

const AppContext = createContext(null);

const EMPTY_HOME_SUMMARY = {
  owned: false,
  purchased_at: null,
};

const EMPTY_FARM_SUMMARY = {
  owned: false,
  purchasedAt: null,
  purchaseCost: 1000,
  builtSlots: 0,
  slotCount: 9,
  hasAction: false,
  actionCount: 0,
};

const INITIAL = {
  initialized: false,
  loading: true,
  error: null,
  user: null,
  peeper: null,
  cooldowns: { feed: 0, play: 0, action: 0 },
  ownedItems: [],
  ownedHomeItems: [],
  homeSummary: EMPTY_HOME_SUMMARY,
  farmSummary: EMPTY_FARM_SUMMARY,
  assetVersion: FALLBACK_ASSET_VERSION,
  casinoJackpot: 0,
  casinoFreeSpins: 0,
  energyDrink: null,
  fridge: null,
  toast: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    case 'SET_TOAST':
      return { ...state, toast: action.payload };
    case 'INIT_SUCCESS':
      return {
        ...state,
        initialized: true,
        loading: false,
        user: action.payload.user,
        peeper: action.payload.peeper,
        ownedItems: action.payload.ownedItems || [],
        ownedHomeItems: action.payload.ownedHomeItems || [],
        homeSummary: action.payload.homeSummary || EMPTY_HOME_SUMMARY,
        farmSummary: action.payload.farmSummary || EMPTY_FARM_SUMMARY,
        assetVersion: action.payload.assetVersion || state.assetVersion,
        casinoJackpot: action.payload.casinoJackpot ?? state.casinoJackpot,
        casinoFreeSpins: action.payload.casinoFreeSpins ?? state.casinoFreeSpins,
        energyDrink: action.payload.energyDrink ?? state.energyDrink,
        fridge: action.payload.fridge ?? state.fridge,
        cooldowns: { feed: 0, play: 0, action: 0 },
      };
    case 'UPDATE_GAME':
      return {
        ...state,
        user: state.user
          ? {
              ...state.user,
              coins: action.payload.coins ?? state.user.coins,
              supporter: action.payload.supporter ?? state.user.supporter,
            }
          : state.user,
        peeper: action.payload.peeper ?? state.peeper,
        cooldowns: action.payload.cooldowns ?? state.cooldowns,
        homeSummary: action.payload.homeSummary ?? state.homeSummary,
        farmSummary: action.payload.farmSummary ?? state.farmSummary,
        assetVersion: action.payload.assetVersion || state.assetVersion,
        casinoJackpot: action.payload.casinoJackpot ?? state.casinoJackpot,
        casinoFreeSpins: action.payload.casinoFreeSpins ?? state.casinoFreeSpins,
        energyDrink: action.payload.energyDrink ?? state.energyDrink,
        fridge: action.payload.fridge ?? state.fridge,
      };
    case 'ADD_OWNED_ITEM':
      return {
        ...state,
        ownedItems: state.ownedItems.includes(action.payload)
          ? state.ownedItems
          : [...state.ownedItems, action.payload],
      };
    case 'ADD_OWNED_HOME_ITEM':
      return {
        ...state,
        ownedHomeItems: state.ownedHomeItems.includes(action.payload)
          ? state.ownedHomeItems
          : [...state.ownedHomeItems, action.payload],
      };
    case 'SET_OWNED_HOME_ITEMS':
      return { ...state, ownedHomeItems: action.payload || [] };
    case 'UPDATE_HOME_SUMMARY':
      return { ...state, homeSummary: action.payload || EMPTY_HOME_SUMMARY };
    case 'SET_ASSET_VERSION':
      return { ...state, assetVersion: action.payload || state.assetVersion };
    case 'SET_CASINO_JACKPOT':
      return { ...state, casinoJackpot: action.payload ?? state.casinoJackpot };
    case 'UPDATE_COINS':
      return state.user
        ? { ...state, user: { ...state.user, coins: action.payload } }
        : state;
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  useEffect(() => {
    setAssetVersion(state.assetVersion);
  }, [state.assetVersion]);

  const showToast = useCallback((msg, duration = 2500) => {
    dispatch({ type: 'SET_TOAST', payload: msg });
    setTimeout(() => dispatch({ type: 'SET_TOAST', payload: null }), duration);
  }, []);

  const initialize = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await api.login();
      dispatch({ type: 'INIT_SUCCESS', payload: result });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to connect' });
    }
  }, []);

  const refreshGameState = useCallback(async () => {
    try {
      const result = await api.getGameState();
      dispatch({
        type: 'UPDATE_GAME',
        payload: {
          coins: result.coins,
          supporter: result.supporter,
          peeper: result.peeper,
          cooldowns: result.cooldowns,
          homeSummary: result.homeSummary,
          farmSummary: result.farmSummary,
          assetVersion: result.assetVersion,
          casinoJackpot: result.casinoJackpot,
          casinoFreeSpins: result.casinoFreeSpins,
          energyDrink: result.energyDrink,
          fridge: result.fridge,
        },
      });
      return result;
    } catch (err) {
      console.error('Failed to refresh game state:', err);
      return null;
    }
  }, []);

  const refreshHomeSummary = useCallback(async () => {
    const result = await refreshGameState();
    return result?.homeSummary || EMPTY_HOME_SUMMARY;
  }, [refreshGameState]);

  const applyAssetVersion = useCallback((nextVersion) => {
    dispatch({ type: 'SET_ASSET_VERSION', payload: nextVersion });
  }, []);

  const applyCasinoJackpot = useCallback((nextJackpot) => {
    dispatch({ type: 'SET_CASINO_JACKPOT', payload: nextJackpot });
  }, []);

  const feedPeeper = useCallback(async (foodType) => {
    try {
      const result = await api.feedPeeper(foodType);
      dispatch({
        type: 'UPDATE_GAME',
        payload: {
          coins: result.coins,
          peeper: result.peeper,
          cooldowns: result.cooldowns,
          homeSummary: result.homeSummary,
          assetVersion: result.assetVersion,
          casinoJackpot: result.casinoJackpot,
          casinoFreeSpins: result.casinoFreeSpins,
          energyDrink: result.energyDrink,
          fridge: result.fridge,
        },
      });
      return result;
    } catch (err) {
      showToast(err.message || 'Cannot feed right now');
      throw err;
    }
  }, [showToast]);

  const playPeeper = useCallback(async ({ gameId, coinsEarned, gameWon }) => {
    try {
      const result = await api.playPeeper({ gameId, coinsEarned, gameWon });
      dispatch({
        type: 'UPDATE_GAME',
        payload: {
          coins: result.coins,
          peeper: result.peeper,
          cooldowns: result.cooldowns,
          homeSummary: result.homeSummary,
          assetVersion: result.assetVersion,
          energyDrink: result.energyDrink,
          fridge: result.fridge,
        },
      });
      return result;
    } catch (err) {
      if (err.data?.peeper) {
        dispatch({
          type: 'UPDATE_GAME',
          payload: {
            peeper: err.data.peeper,
            coins: err.data.coins,
            cooldowns: err.data.cooldowns,
            homeSummary: err.data.homeSummary,
            assetVersion: err.data.assetVersion,
            casinoJackpot: err.data.casinoJackpot,
            casinoFreeSpins: err.data.casinoFreeSpins,
            energyDrink: err.data.energyDrink,
            fridge: err.data.fridge,
          },
        });
      }
      showToast(err.message || 'Cannot register game result');
      throw err;
    }
  }, [showToast]);

  const getCasinoState = useCallback(async () => {
    const result = await api.getCasinoState();
    dispatch({
      type: 'UPDATE_GAME',
      payload: {
        casinoJackpot: result?.casinoJackpot,
        casinoFreeSpins: result?.casinoFreeSpins,
      },
    });
    return result;
  }, []);

  const spinCasino = useCallback(async () => {
    try {
      const result = await api.spinCasino();
      dispatch({
        type: 'UPDATE_GAME',
        payload: {
          coins: result.coins,
          peeper: result.peeper,
          cooldowns: result.cooldowns,
          homeSummary: result.homeSummary,
          assetVersion: result.assetVersion,
          casinoJackpot: result.casinoJackpot,
          casinoFreeSpins: result.casinoFreeSpins,
          energyDrink: result.energyDrink,
          fridge: result.fridge,
        },
      });
      return result;
    } catch (err) {
      if (err.data?.peeper || err.data?.coins != null || typeof err.data?.casinoJackpot === 'number') {
        dispatch({
          type: 'UPDATE_GAME',
          payload: {
            peeper: err.data.peeper,
            coins: err.data.coins,
            cooldowns: err.data.cooldowns,
            homeSummary: err.data.homeSummary,
            assetVersion: err.data.assetVersion,
            casinoJackpot: err.data.casinoJackpot,
            casinoFreeSpins: err.data.casinoFreeSpins,
            energyDrink: err.data.energyDrink,
            fridge: err.data.fridge,
          },
        });
      }
      showToast(err.message || 'caSino spin failed');
      throw err;
    }
  }, [showToast]);

  const removePeeperPoop = useCallback(async () => {
    try {
      const result = await api.removePeeperPoop();
      dispatch({
        type: 'UPDATE_GAME',
        payload: {
          peeper: result.peeper,
          coins: result.coins,
          cooldowns: result.cooldowns,
          homeSummary: result.homeSummary,
          assetVersion: result.assetVersion,
          casinoJackpot: result.casinoJackpot,
          energyDrink: result.energyDrink,
          fridge: result.fridge,
        },
      });
      return result;
    } catch (err) {
      if (err.data?.peeper) {
        dispatch({
          type: 'UPDATE_GAME',
          payload: {
            peeper: err.data.peeper,
            coins: err.data.coins,
            cooldowns: err.data.cooldowns,
            homeSummary: err.data.homeSummary,
            assetVersion: err.data.assetVersion,
            casinoJackpot: err.data.casinoJackpot,
            energyDrink: err.data.energyDrink,
            fridge: err.data.fridge,
          },
        });
      }
      showToast(err.message || 'Could not remove the poop');
      throw err;
    }
  }, [showToast]);

  const completePeeperCleaning = useCallback(async () => {
    try {
      const result = await api.completePeeperCleaning();
      dispatch({
        type: 'UPDATE_GAME',
        payload: {
          peeper: result.peeper,
          coins: result.coins,
          cooldowns: result.cooldowns,
          homeSummary: result.homeSummary,
          assetVersion: result.assetVersion,
          casinoJackpot: result.casinoJackpot,
          energyDrink: result.energyDrink,
          fridge: result.fridge,
        },
      });
      return result;
    } catch (err) {
      if (err.data?.peeper) {
        dispatch({
          type: 'UPDATE_GAME',
          payload: {
            peeper: err.data.peeper,
            coins: err.data.coins,
            cooldowns: err.data.cooldowns,
            homeSummary: err.data.homeSummary,
            assetVersion: err.data.assetVersion,
            casinoJackpot: err.data.casinoJackpot,
            energyDrink: err.data.energyDrink,
            fridge: err.data.fridge,
          },
        });
      }
      showToast(err.message || 'Could not finish cleaning');
      throw err;
    }
  }, [showToast]);

  const revivePeeper = useCallback(async () => {
    try {
      const result = await api.revivePeeper();
      dispatch({
        type: 'UPDATE_GAME',
        payload: {
          peeper: result.peeper,
          coins: result.coins,
          cooldowns: result.cooldowns,
          homeSummary: result.homeSummary,
          assetVersion: result.assetVersion,
          casinoJackpot: result.casinoJackpot,
          energyDrink: result.energyDrink,
          fridge: result.fridge,
        },
      });
      showToast(result.message);
      return result;
    } catch (err) {
      if (err.data?.peeper) {
        dispatch({
          type: 'UPDATE_GAME',
          payload: {
            peeper: err.data.peeper,
            coins: err.data.coins,
            cooldowns: err.data.cooldowns,
            homeSummary: err.data.homeSummary,
            assetVersion: err.data.assetVersion,
            casinoJackpot: err.data.casinoJackpot,
            energyDrink: err.data.energyDrink,
            fridge: err.data.fridge,
          },
        });
      }
      showToast(err.message || 'Cannot revive');
      throw err;
    }
  }, [showToast]);

  const updateOutfit = useCallback(async (slots) => {
    try {
      const result = await api.updateOutfit(slots);
      dispatch({ type: 'UPDATE_GAME', payload: { peeper: result.peeper } });
      showToast('Outfit saved!');
      return result;
    } catch (err) {
      showToast(err.message || 'Failed to update outfit');
      throw err;
    }
  }, [showToast]);

  const buyItem = useCallback(async (itemId) => {
    try {
      const result = await api.buyItem(itemId);
      dispatch({ type: 'UPDATE_COINS', payload: result.coins });
      dispatch({ type: 'ADD_OWNED_ITEM', payload: itemId });
      showToast(result.message);
      return result;
    } catch (err) {
      showToast(err.message || 'Purchase failed');
      throw err;
    }
  }, [showToast]);

  const buyPersonalHome = useCallback(async () => {
    try {
      const result = await api.buyPersonalHome();
      dispatch({ type: 'UPDATE_COINS', payload: result.coins });
      dispatch({ type: 'UPDATE_HOME_SUMMARY', payload: result.homeSummary });
      if (result.assetVersion) {
        dispatch({ type: 'SET_ASSET_VERSION', payload: result.assetVersion });
      }
      if (result.ownedHomeItems) {
        dispatch({ type: 'SET_OWNED_HOME_ITEMS', payload: result.ownedHomeItems });
      }
      showToast(result.message);
      return result;
    } catch (err) {
      showToast(err.message || 'Could not buy home');
      throw err;
    }
  }, [showToast]);

  const getPersonalHomeState = useCallback(async () => {
    const result = await api.getPersonalHomeState();
    if (result?.assetVersion) {
      dispatch({ type: 'SET_ASSET_VERSION', payload: result.assetVersion });
    }
    return result;
  }, []);

  const getHomeCatalog = useCallback(async () => {
    const result = await api.getHomeCatalog();
    if (result?.assetVersion) {
      dispatch({ type: 'SET_ASSET_VERSION', payload: result.assetVersion });
    }
    return result;
  }, []);

  const buyHomeItem = useCallback(async (itemId) => {
    try {
      const result = await api.buyHomeItem(itemId);
      dispatch({ type: 'UPDATE_COINS', payload: result.coins });
      dispatch({ type: 'ADD_OWNED_HOME_ITEM', payload: itemId });
      if (result.assetVersion) {
        dispatch({ type: 'SET_ASSET_VERSION', payload: result.assetVersion });
      }
      if (result.ownedHomeItems) {
        dispatch({ type: 'SET_OWNED_HOME_ITEMS', payload: result.ownedHomeItems });
      }
      showToast(result.message);
      return result;
    } catch (err) {
      showToast(err.message || 'Decor purchase failed');
      throw err;
    }
  }, [showToast]);

  const updateHomeLayout = useCallback(async (payload) => {
    try {
      const result = await api.updateHomeLayout(payload);
      if (result.assetVersion) {
        dispatch({ type: 'SET_ASSET_VERSION', payload: result.assetVersion });
      }
      showToast(result.message || 'Home updated!');
      return result;
    } catch (err) {
      showToast(err.message || 'Could not update home');
      throw err;
    }
  }, [showToast]);

  const toggleBackDecor = useCallback(async (itemId, enabled) => {
    try {
      const result = await api.toggleBackDecor(itemId, enabled);
      if (result.assetVersion) {
        dispatch({ type: 'SET_ASSET_VERSION', payload: result.assetVersion });
      }
      showToast(result.message || 'Home updated!');
      return result;
    } catch (err) {
      showToast(err.message || 'Could not update decor');
      throw err;
    }
  }, [showToast]);

  const reorderBackDecor = useCallback(async (itemIds) => {
    try {
      const result = await api.reorderBackDecor(itemIds);
      if (result.assetVersion) {
        dispatch({ type: 'SET_ASSET_VERSION', payload: result.assetVersion });
      }
      showToast(result.message || 'Decor order updated!');
      return result;
    } catch (err) {
      showToast(err.message || 'Could not reorder decor');
      throw err;
    }
  }, [showToast]);

  const toggleForegroundItem = useCallback(async (itemId, enabled) => {
    try {
      const result = await api.toggleForegroundItem(itemId, enabled);
      if (result.assetVersion) {
        dispatch({ type: 'SET_ASSET_VERSION', payload: result.assetVersion });
      }
      showToast(result.message || 'Home updated!');
      return result;
    } catch (err) {
      showToast(err.message || 'Could not update foreground decor');
      throw err;
    }
  }, [showToast]);

  const reorderForegroundItems = useCallback(async (itemIds) => {
    try {
      const result = await api.reorderForegroundItems(itemIds);
      if (result.assetVersion) {
        dispatch({ type: 'SET_ASSET_VERSION', payload: result.assetVersion });
      }
      showToast(result.message || 'Foreground order updated!');
      return result;
    } catch (err) {
      showToast(err.message || 'Could not reorder foreground decor');
      throw err;
    }
  }, [showToast]);

  const sendGift = useCallback(async (recipientId, giftId, message, isPrivate) => {
    try {
      const result = await api.sendGift(recipientId, giftId, message, isPrivate);
      dispatch({ type: 'UPDATE_COINS', payload: result.coins });
      showToast(result.message);
      return result;
    } catch (err) {
      showToast(err.message || 'Failed to send gift');
      throw err;
    }
  }, [showToast]);

  return (
    <AppContext.Provider value={{
      ...state,
      showToast,
      initialize,
      refreshGameState,
      refreshHomeSummary,
      applyAssetVersion,
      applyCasinoJackpot,
      feedPeeper,
      playPeeper,
      getCasinoState,
      spinCasino,
      removePeeperPoop,
      completePeeperCleaning,
      revivePeeper,
      updateOutfit,
      buyItem,
      buyPersonalHome,
      getPersonalHomeState,
      getHomeCatalog,
      buyHomeItem,
      updateHomeLayout,
      toggleBackDecor,
      reorderBackDecor,
      toggleForegroundItem,
      reorderForegroundItems,
      sendGift,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
