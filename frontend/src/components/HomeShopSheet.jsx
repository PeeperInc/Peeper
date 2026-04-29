import React, { useMemo, useState } from 'react';
import BottomSheet from './BottomSheet';

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

function HomeShopPreviewModal({ item, coins, buying, onBuy, onClose }) {
  const canAfford = item.is_free || coins >= item.price;
  const owned = item.owned;

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

        <div
          style={{
            width: 'min(240px, 62vw)',
            maxWidth: '100%',
            padding: 12,
            borderRadius: 24,
            background: 'var(--bg-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <DecorPreview filePath={item.file_path} name={item.name} size={240} />
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
            {item.is_free ? 'Free' : `✦ ${item.price}`}
          </div>
        )}

        {!owned && !item.is_free && !canAfford && (
          <div style={{ fontSize: 12, color: 'var(--danger)' }}>
            Need {item.price - coins} more ✦
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
              ✓ Owned
            </div>
          ) : (
            <button
              className="btn btn-primary btn-full"
              style={{ flex: 2 }}
              disabled={(!canAfford && !item.is_free) || buying}
              onClick={onBuy}
            >
              {buying ? 'Buying…' : item.is_free ? 'Get Free' : `Buy · ✦ ${item.price}`}
            </button>
          )}
        </div>
    </BottomSheet>
  );
}

export default function HomeShopSheet({
  items,
  coins,
  buyingItemId,
  onClose,
  onBuy,
}) {
  const [activeTab, setActiveTab] = useState('wall_base');
  const [previewItem, setPreviewItem] = useState(null);

  const filteredItems = useMemo(
    () => items.filter((item) => item.slot === activeTab),
    [activeTab, items]
  );

  const sortedItems = useMemo(() => (
    [...filteredItems].sort((a, b) => {
      const aOwned = Boolean(a.owned);
      const bOwned = Boolean(b.owned);
      if (aOwned !== bOwned) return aOwned ? 1 : -1;
      return a.name.localeCompare(b.name);
    })
  ), [filteredItems]);

  const handleBuyFromPreview = async () => {
    if (!previewItem) return;
    await onBuy(previewItem);
    setPreviewItem(null);
  };

  return (
    <BottomSheet onClose={onClose} bodyClassName="sheet-body home-sheet-body">
        {previewItem && (
          <HomeShopPreviewModal
            item={previewItem}
            coins={coins}
            buying={buyingItemId === previewItem.item_id}
            onBuy={handleBuyFromPreview}
            onClose={() => setPreviewItem(null)}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 21, fontWeight: 900, color: 'var(--text-primary)' }}>Decor Shop</div>
            <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 3 }}>
              Buy full-scene decor layers for your house
            </div>
          </div>
          <div className="coins-badge">✦ {coins}</div>
        </div>

        <div className="inner-tabs home-sheet-tabs home-slot-tabs" style={{ marginBottom: 12 }}>
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

        <div className="home-sheet-scroll">
          {sortedItems.length === 0 && (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text-hint)' }}>
              No decor in this slot yet.
            </div>
          )}

          {sortedItems.length > 0 && (
            <div className="home-shop-grid">
              {sortedItems.map((item) => {
                const owned = Boolean(item.owned);
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
                      opacity: owned ? 0.75 : 1,
                      border: owned ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                      transition: 'transform 0.12s, box-shadow 0.12s',
                      position: 'relative',
                    }}
                  >
                    <DecorPreview filePath={item.file_path} name={item.name} size={84} />
                    <div className="home-shop-title" style={{ textAlign: 'center' }}>{item.name}</div>
                    <div className="home-shop-meta">{slotLabel(item.slot)}</div>

                    {owned ? (
                      <div className="home-shop-state owned">✓ Owned</div>
                    ) : item.is_free ? (
                      <div className="home-shop-state owned">Free</div>
                    ) : (
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: canAfford ? 'var(--warning)' : 'var(--danger)',
                        }}
                      >
                        ✦ {item.price}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </BottomSheet>
  );
}
