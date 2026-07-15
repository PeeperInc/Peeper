import React, { useMemo, useState } from 'react';
import BottomSheet from '../components/BottomSheet';
import CatalogSortToggle from '../components/CatalogSortToggle';
import HomeScene from '../components/HomeScene';
import { CATALOG_SORT_MODES, sortCatalogItems } from '../utils/catalogSort.mjs';

const BACK_LABEL = 'Back';
const COIN_SYMBOL = '✦';
const CHECK_LABEL = '✓';
const MIDDOT = '·';

const HOME_SHOP_TABS = [
  { id: 'wall_base', label: 'Walls' },
  { id: 'floor_base', label: 'Floor' },
  { id: 'floor_cover', label: 'Cover' },
  { id: 'back_decor', label: 'Decor' },
  { id: 'foreground_item', label: 'Front' },
];

function slotLabel(slot) {
  return HOME_SHOP_TABS.find((tab) => tab.id === slot)?.label || slot;
}

function DecorPreview({ filePath, name, size = 72 }) {
  const [failed, setFailed] = useState(false);

  if (!filePath || failed) {
    return (
      <div
        style={{
          width: size * 0.72,
          height: size,
          borderRadius: 10,
          background: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-hint)',
          fontSize: 11,
          textAlign: 'center',
          padding: 8,
        }}
      >
        {name}
      </div>
    );
  }

  return (
    <img
      src={filePath}
      alt=""
      onError={() => setFailed(true)}
      style={{
        width: size * 0.72,
        height: size,
        objectFit: 'contain',
        display: 'block',
        borderRadius: 10,
      }}
    />
  );
}

function homeWithPreviewItem(home, item) {
  const currentSlots = home?.slots || {};
  const slots = { ...currentSlots };
  if (item.slot === 'back_decor') {
    const currentDecor = Array.isArray(currentSlots.back_decor) ? currentSlots.back_decor : [];
    const maxOrder = currentDecor.reduce((highest, decor) => Math.max(highest, Number(decor.sort_order) || 0), 0);
    slots.back_decor = [
      ...currentDecor.filter(decor => decor.item_id !== item.item_id),
      { ...item, sort_order: maxOrder + 1 },
    ];
  } else {
    slots[item.slot] = item;
  }
  return { ...(home || {}), owned: true, slots };
}

function HomeShopPreviewModal({ item, home, coins, buying, onBuy, onClose }) {
  const canAfford = item.is_free || coins >= item.price;
  const owned = item.owned;
  const previewHome = homeWithPreviewItem(home, item);

  return (
    <BottomSheet
      onClose={onClose}
      zIndex={220}
      bodyStyle={{
        padding: '20px 24px 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        maxHeight: '78vh',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{item.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 3 }}>
          {slotLabel(item.slot)}
        </div>
      </div>

      <div style={{ width: 'min(270px, 72vw)', maxWidth: '100%' }}>
        <HomeScene
          home={previewHome}
          showPeeper={false}
          shellStyle={{ width: '100%', maxHeight: 'none' }}
          sceneStyle={{ borderRadius: 5, border: '1px solid var(--border)' }}
        />
      </div>

      {!owned && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 18,
            fontWeight: 800,
            color: item.is_free ? 'var(--accent)' : canAfford ? 'var(--warning)' : 'var(--danger)',
          }}
        >
          {item.is_free ? 'Free' : `${COIN_SYMBOL} ${item.price}`}
        </div>
      )}

      {!owned && !item.is_free && !canAfford && (
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>
          Need {item.price - coins} more {COIN_SYMBOL}
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
            {CHECK_LABEL} Owned
          </div>
        ) : (
          <button
            className="btn btn-primary btn-full"
            style={{ flex: 2 }}
            disabled={(!canAfford && !item.is_free) || buying}
            onClick={onBuy}
          >
            {buying ? 'Buying...' : item.is_free ? 'Get Free' : `Buy ${MIDDOT} ${COIN_SYMBOL} ${item.price}`}
          </button>
        )}
      </div>
    </BottomSheet>
  );
}

export default function HomeShopScreen({
  home,
  items,
  coins,
  buyingItemId,
  onBack,
  onBuy,
}) {
  const [activeTab, setActiveTab] = useState('wall_base');
  const [previewItem, setPreviewItem] = useState(null);
  const [sortMode, setSortMode] = useState(CATALOG_SORT_MODES.NEWEST);

  const visibleShopItems = useMemo(
    () => items.filter((item) => item.is_active),
    [items],
  );

  const filteredItems = useMemo(
    () => visibleShopItems.filter((item) => item.slot === activeTab),
    [activeTab, visibleShopItems],
  );

  const sortedItems = useMemo(
    () => sortCatalogItems(filteredItems.filter((item) => !item.owned), sortMode),
    [filteredItems, sortMode],
  );

  const handleBuyFromPreview = async () => {
    if (!previewItem) return;
    await onBuy(previewItem);
    setPreviewItem(null);
  };

  return (
    <div
      style={{
        height: 'calc(100dvh - var(--tg-total-top))',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
      }}
    >
      {previewItem && (
        <HomeShopPreviewModal
          item={previewItem}
          home={home}
          coins={coins}
          buying={buyingItemId === previewItem.item_id}
          onBuy={handleBuyFromPreview}
          onClose={() => setPreviewItem(null)}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 16px 8px' }}>
        <button className="btn btn-ghost app-back-button" onClick={onBack} style={{ flexShrink: 0 }}>
          {BACK_LABEL}
        </button>
        <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>
            Decor Shop
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <CatalogSortToggle mode={sortMode} onToggle={setSortMode} />
          <div className="coins-badge">{COIN_SYMBOL} {coins}</div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(var(--tg-safe-bottom) + 16px)' }}>
        <div className="inner-tabs" style={{ marginTop: 0 }}>
          {HOME_SHOP_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`inner-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {sortedItems.length === 0 && (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-hint)', margin: '0 16px' }}>
            {filteredItems.length === 0
              ? 'No decor in this slot yet.'
              : 'You already bought everything in this category.'}
          </div>
        )}

        {sortedItems.length > 0 && (
          <div className="home-shop-grid" style={{ padding: '0 16px 12px' }}>
            {sortedItems.map((item) => {
              const canAfford = item.is_free || coins >= item.price;

              return (
                <div
                  key={item.item_id}
                  className="card home-shop-card"
                  onClick={() => setPreviewItem(item)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    padding: 12,
                    cursor: 'pointer',
                    border: '1.5px solid var(--border)',
                  }}
                >
                  <DecorPreview filePath={item.file_path} name={item.name} size={84} />
                  <div className="home-shop-title">{item.name}</div>
                  <div className="home-shop-meta">{slotLabel(item.slot)}</div>
                  {item.is_free ? (
                    <div className="home-shop-state">Free</div>
                  ) : (
                    <div className="home-shop-meta" style={{ color: canAfford ? 'var(--warning)' : 'var(--danger)', fontWeight: 800 }}>
                      {COIN_SYMBOL} {item.price}
                    </div>
                  )}
                  {!item.is_free && !canAfford && (
                    <div className="home-shop-state" style={{ color: 'var(--danger)' }}>Not enough coins</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
