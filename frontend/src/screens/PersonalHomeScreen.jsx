import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import HomeScene from '../components/HomeScene';
import HomeShopScreen from './HomeShopScreen';
import HomeDecorScreen from './HomeDecorScreen';

const BACK_LABEL = 'Back';
const COIN_SYMBOL = '\u2726';

export default function PersonalHomeScreen({ onClose }) {
  const {
    user,
    peeper,
    getPersonalHomeState,
    getHomeCatalog,
    buyHomeItem,
    updateHomeLayout,
    toggleBackDecor,
    reorderBackDecor,
  } = useApp();

  const [homeState, setHomeState] = useState(null);
  const [catalogItems, setCatalogItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [decorOpen, setDecorOpen] = useState(false);
  const [buyingItemId, setBuyingItemId] = useState(null);
  const [busySlot, setBusySlot] = useState(null);
  const [reorderBusy, setReorderBusy] = useState(false);

  const applyHomeState = useCallback((result) => {
    setHomeState(result?.home || null);
  }, []);

  const refreshCatalog = useCallback(async () => {
    const result = await getHomeCatalog();
    setCatalogItems(result.items || []);
    return result;
  }, [getHomeCatalog]);

  const loadHome = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [homeResult, catalogResult] = await Promise.all([
        getPersonalHomeState(),
        getHomeCatalog(),
      ]);
      applyHomeState(homeResult);
      setCatalogItems(catalogResult.items || []);
    } catch (err) {
      setError(err.message || 'Failed to load your home');
    } finally {
      setLoading(false);
    }
  }, [applyHomeState, getHomeCatalog, getPersonalHomeState]);

  useEffect(() => {
    loadHome();
  }, [loadHome]);

  const handleBuyItem = useCallback(async (item) => {
    setBuyingItemId(item.item_id);
    try {
      await buyHomeItem(item.item_id);
      await refreshCatalog();
    } finally {
      setBuyingItemId(null);
    }
  }, [buyHomeItem, refreshCatalog]);

  const handleSetSingleSlot = useCallback(async (slot, itemId) => {
    setBusySlot(slot);
    try {
      const result = await updateHomeLayout({ [slot]: itemId });
      applyHomeState(result);
    } finally {
      setBusySlot(null);
    }
  }, [applyHomeState, updateHomeLayout]);

  const handleToggleBackDecor = useCallback(async (itemId, enabled) => {
    setBusySlot('back_decor');
    try {
      const result = await toggleBackDecor(itemId, enabled);
      applyHomeState(result);
    } finally {
      setBusySlot(null);
    }
  }, [applyHomeState, toggleBackDecor]);

  const handleReorderBackDecor = useCallback(async (itemIds) => {
    setReorderBusy(true);
    try {
      const result = await reorderBackDecor(itemIds);
      applyHomeState(result);
    } finally {
      setReorderBusy(false);
    }
  }, [applyHomeState, reorderBackDecor]);

  if (shopOpen) {
    return (
      <HomeShopScreen
        items={catalogItems}
        coins={user?.coins ?? 0}
        buyingItemId={buyingItemId}
        onBack={() => setShopOpen(false)}
        onBuy={handleBuyItem}
      />
    );
  }

  if (decorOpen) {
    return (
      <HomeDecorScreen
        home={homeState}
        items={catalogItems}
        busySlot={busySlot}
        reorderBusy={reorderBusy}
        onBack={() => setDecorOpen(false)}
        onSetSingleSlot={handleSetSingleSlot}
        onToggleBackDecor={handleToggleBackDecor}
        onReorderBackDecor={handleReorderBackDecor}
      />
    );
  }

  return (
    <div className="personal-home-shell personal-home-shell-immersive">
      <div className="personal-home-topbar">
        <button className="btn btn-ghost personal-home-back app-back-button" onClick={onClose}>
          {BACK_LABEL}
        </button>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>My Home</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Personal room
          </div>
        </div>

        <div className="coins-badge personal-home-coins">{COIN_SYMBOL} {user?.coins ?? 0}</div>
      </div>

      <div className="personal-home-stage">
        {loading && (
          <div className="personal-home-overlay-card">
            Loading your home...
          </div>
        )}

        {!loading && error && (
          <div className="personal-home-overlay-card">
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--danger)', marginBottom: 8 }}>Could not load home</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>{error}</div>
            <button className="btn btn-primary" onClick={loadHome}>Try Again</button>
          </div>
        )}

        {!loading && !error && homeState?.owned && (
          <HomeScene home={homeState} peeper={peeper} fullscreen />
        )}
      </div>

      {!loading && !error && homeState?.owned && (
        <div className="personal-home-actions">
          <button
            type="button"
            className="btn btn-secondary personal-home-action-btn"
            onClick={() => {
              setDecorOpen(false);
              setShopOpen(true);
            }}
          >
            Decor Shop
          </button>
          <button
            type="button"
            className="btn btn-primary personal-home-action-btn"
            onClick={() => {
              setShopOpen(false);
              setDecorOpen(true);
            }}
          >
            Decorate
          </button>
        </div>
      )}
    </div>
  );
}
