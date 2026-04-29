import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import PeeperSprite from '../components/PeeperSprite';
import BottomSheet from '../components/BottomSheet';
import CatalogSortToggle from '../components/CatalogSortToggle';
import { assetUrl } from '../utils/assetUrl';
import { CATALOG_SORT_MODES, sortCatalogItems } from '../utils/catalogSort.mjs';
import * as api from '../api';

const SLOT_LABELS = {
  head: '🎩 Head',
  body: '👕 Body',
  hands: '✋ Hands',
  face: '🕶️ Face',
  fren: '🐸 Fren',
};
const SLOTS = ['head', 'body', 'hands', 'fren', 'face'];

function ItemSprite({ itemId, name, size = 60 }) {
  const [err, setErr] = useState(false);
  if (!err) {
    return (
      <img
        src={assetUrl(`/sprites/${itemId}.png`)}
        alt={name}
        onError={() => setErr(true)}
        style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: 'var(--accent-light)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        color: 'var(--accent)',
        fontWeight: 700,
      }}
    >
      {name?.[0] || '?'}
    </div>
  );
}

function TryOnModal({ item, peeper, coins, owned, onBuy, onClose, buying }) {
  const canAfford = item.is_free || coins >= item.price;
  const previewPeeper = {
    ...peeper,
    alive: peeper?.alive ?? true,
    [`slot_${item.slot}`]: item.item_id,
  };

  return (
    <BottomSheet
      onClose={onClose}
      zIndex={200}
      bodyStyle={{
        padding: '20px 24px 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        maxHeight: '75vh',
        minHeight: '75vh',
        overflowY: 'scroll',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{item.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 3, textTransform: 'capitalize' }}>
          {SLOT_LABELS[item.slot]} slot
        </div>
      </div>

      <div
        style={{
          background: 'var(--bg-secondary)',
          borderRadius: 24,
          padding: 12,
          position: 'relative',
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, textAlign: 'center', marginBottom: 8 }}>
          ✨ Try-on Preview
        </div>
        <PeeperSprite peeper={previewPeeper} size={200} showDead={false} />
      </div>

      {!owned && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>Price:</span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: item.is_free ? 'var(--accent)' : canAfford ? 'var(--warning)' : 'var(--danger)',
            }}
          >
            {item.is_free ? 'Free' : `✦ ${item.price}`}
          </span>
          {!item.is_free && !canAfford && (
            <span style={{ fontSize: 12, color: 'var(--danger)' }}>
              (need {item.price - coins} more)
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, width: '100%' }}>
        <button className="btn btn-ghost btn-full" onClick={onClose} style={{ flex: 1 }}>
          Close
        </button>
        {owned ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            ✓ Already owned
          </div>
        ) : (
          <button
            className="btn btn-primary btn-full"
            style={{ flex: 2 }}
            disabled={!canAfford || buying}
            onClick={onBuy}
          >
            {buying ? '...' : item.is_free ? 'Get Free' : `Buy · ✦ ${item.price}`}
          </button>
        )}
      </div>
    </BottomSheet>
  );
}

export default function ShopScreen() {
  const { user, peeper, buyItem } = useApp();
  const [activeSlot, setActiveSlot] = useState('head');
  const [allItems, setAllItems] = useState([]);
  const [ownedIds, setOwnedIds] = useState(new Set());
  const [sortMode, setSortMode] = useState(CATALOG_SORT_MODES.NEWEST);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(null);
  const [tryOnItem, setTryOnItem] = useState(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getShopItems();
      setAllItems(data.clothing || []);
      setOwnedIds(new Set((data.clothing || []).filter((item) => item.owned).map((item) => item.item_id)));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const slotItems = useMemo(
    () => allItems.filter((item) => item.slot === activeSlot),
    [activeSlot, allItems],
  );

  const availableItems = useMemo(
    () => sortCatalogItems(
      slotItems.filter((item) => !ownedIds.has(item.item_id)),
      sortMode,
    ),
    [ownedIds, slotItems, sortMode],
  );

  const allOwnedInSlot = slotItems.length > 0 && availableItems.length === 0;

  const handleBuy = useCallback(async (itemId) => {
    setBuying(itemId);
    try {
      await buyItem(itemId);
      setOwnedIds((prev) => new Set([...prev, itemId]));
      setTryOnItem(null);
    } finally {
      setBuying(null);
    }
  }, [buyItem]);

  return (
    <div style={{ paddingBottom: 16 }}>
      {tryOnItem && (
        <TryOnModal
          item={tryOnItem}
          peeper={peeper}
          coins={user?.coins ?? 0}
          owned={ownedIds.has(tryOnItem.item_id)}
          buying={buying === tryOnItem.item_id}
          onBuy={() => handleBuy(tryOnItem.item_id)}
          onClose={() => setTryOnItem(null)}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '16px 16px 8px' }}>
        <div className="page-header" style={{ padding: 0 }}>Shop</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <CatalogSortToggle mode={sortMode} onToggle={setSortMode} />
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--warning-light)',
              color: 'var(--warning)',
              padding: '4px 10px',
              borderRadius: 99,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            ✦ {user?.coins ?? 0}
          </div>
        </div>
      </div>

      <div className="inner-tabs">
        {SLOTS.map((slot) => (
          <button
            key={slot}
            className={`inner-tab${activeSlot === slot ? ' active' : ''}`}
            onClick={() => setActiveSlot(slot)}
          >
            {SLOT_LABELS[slot]}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-hint)', fontSize: 13 }}>Loading...</div>
      )}

      {!loading && slotItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--text-hint)', fontSize: 14 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🛍️</div>
          No items in this slot yet.<br />
          <span style={{ fontSize: 12 }}>Check back later!</span>
        </div>
      )}

      {!loading && allOwnedInSlot && (
        <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--text-hint)', fontSize: 14 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          You already bought everything in this category.<br />
          <span style={{ fontSize: 12 }}>Try another slot for more items.</span>
        </div>
      )}

      {!loading && availableItems.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, padding: '8px 16px' }}>
          {availableItems.map((item) => {
            const canAfford = item.is_free || (user?.coins ?? 0) >= item.price;

            return (
              <div
                key={item.item_id}
                className="card"
                onClick={() => setTryOnItem(item)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: 12,
                  cursor: 'pointer',
                  border: '1.5px solid var(--border)',
                  transition: 'transform 0.12s, box-shadow 0.12s',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 7,
                    right: 8,
                    fontSize: 10,
                    color: 'var(--text-hint)',
                    opacity: 0.7,
                  }}
                >
                  👁 Try on
                </div>

                <ItemSprite itemId={item.item_id} name={item.name} size={72} />
                <div style={{ fontWeight: 600, fontSize: 13, textAlign: 'center' }}>{item.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-hint)', textTransform: 'capitalize' }}>{item.slot}</div>

                {item.is_free ? (
                  <div style={{ color: 'var(--accent)', fontSize: 12 }}>Free</div>
                ) : (
                  <div style={{ fontSize: 13, fontWeight: 700, color: canAfford ? 'var(--warning)' : 'var(--danger)' }}>
                    ✦ {item.price}
                  </div>
                )}

                {!item.is_free && !canAfford && (
                  <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: -4 }}>Not enough coins</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
