import React, { useMemo, useState } from 'react';
import BackDecorReorderList from './BackDecorReorderList';
import BottomSheet from './BottomSheet';

const HOME_DECOR_TABS = [
  { id: 'wall_base', label: 'Walls' },
  { id: 'floor_base', label: 'Floor' },
  { id: 'floor_cover', label: 'Cover' },
  { id: 'back_decor', label: 'Decor' },
  { id: 'foreground_item', label: 'Front' },
];

function DecorPreview({ filePath, name, size = 56 }) {
  const [failed, setFailed] = useState(false);

  if (!filePath || failed) {
    return (
      <div
        style={{
          width: size * 0.72,
          height: size,
          borderRadius: 8,
          background: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-hint)',
          fontSize: 10,
          textAlign: 'center',
          padding: 6,
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
        borderRadius: 8,
      }}
    />
  );
}

function DecorGridCard({ item, selected, onClick, disabled, label }) {
  return (
    <div
      className={`item-card${selected ? ' selected' : ''}`}
      onClick={() => !disabled && onClick()}
      style={{
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        opacity: disabled ? 0.65 : 1,
      }}
    >
      <DecorPreview filePath={item.file_path} name={item.name} size={58} />
      <div className="item-name" style={{ textAlign: 'center' }}>{item.name}</div>
      {label ? <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>{label}</div> : null}
    </div>
  );
}

export default function HomeDecorSheet({
  home,
  items,
  busySlot,
  reorderBusy,
  onClose,
  onSetSingleSlot,
  onToggleBackDecor,
  onReorderBackDecor,
  onToggleForegroundItem,
  onReorderForegroundItems,
}) {
  const [activeTab, setActiveTab] = useState('wall_base');
  const activeSlots = home?.slots || {};
  const activeBackDecor = Array.isArray(activeSlots.back_decor) ? activeSlots.back_decor : [];
  const activeBackDecorSet = useMemo(
    () => new Set(activeBackDecor.map((item) => item.item_id)),
    [activeBackDecor]
  );
  const activeForegroundSource = activeSlots.foreground_items ?? activeSlots.foreground_item;
  const activeForegroundItems = Array.isArray(activeForegroundSource)
    ? activeForegroundSource
    : (activeForegroundSource ? [activeForegroundSource] : []);
  const activeForegroundSet = useMemo(
    () => new Set(activeForegroundItems.map((item) => item.item_id)),
    [activeForegroundItems]
  );
  const isMultiSlot = activeTab === 'back_decor' || activeTab === 'foreground_item';
  const activeMultiItems = activeTab === 'foreground_item' ? activeForegroundItems : activeBackDecor;
  const activeMultiSet = activeTab === 'foreground_item' ? activeForegroundSet : activeBackDecorSet;
  const toggleMultiItem = activeTab === 'foreground_item' ? onToggleForegroundItem : onToggleBackDecor;
  const reorderMultiItems = activeTab === 'foreground_item' ? onReorderForegroundItems : onReorderBackDecor;
  const multiLabel = activeTab === 'foreground_item' ? 'front items' : 'decor items';

  const ownedItems = useMemo(
    () => items.filter((item) => item.owned),
    [items]
  );

  const tabItems = useMemo(
    () => ownedItems.filter((item) => item.slot === activeTab),
    [activeTab, ownedItems]
  );

  const activeSingleItemId = isMultiSlot
    ? null
    : activeSlots?.[activeTab]?.item_id ?? null;

  const canClearCurrentSlot = ['wall_base', 'floor_base', 'floor_cover'].includes(activeTab);

  return (
    <BottomSheet onClose={onClose} bodyClassName="sheet-body home-sheet-body">
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 21, fontWeight: 900, color: 'var(--text-primary)' }}>Decorate</div>
          <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 4 }}>
            Choose room layers and control the order of back and front decor.
          </div>
        </div>

        <div className="inner-tabs home-sheet-tabs home-slot-tabs" style={{ marginBottom: 12 }}>
          {HOME_DECOR_TABS.map((tab) => (
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
          {!isMultiSlot && (
            <>
              {canClearCurrentSlot && activeSingleItemId && (
                <div style={{ paddingBottom: 4 }}>
                  <button
                    className="btn btn-secondary btn-full"
                    onClick={() => onSetSingleSlot(activeTab, null)}
                    disabled={busySlot === activeTab}
                  >
                    ✕ Clear slot
                  </button>
                </div>
              )}

              {tabItems.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', color: 'var(--text-hint)' }}>
                  You do not own decor for this slot yet. Buy some in the shop first.
                </div>
              ) : (
                <div className="home-decor-grid">
                  {tabItems.map((item) => {
                    const selected = activeSingleItemId === item.item_id;
                    return (
                      <DecorGridCard
                        key={item.item_id}
                        item={item}
                        selected={selected}
                        disabled={busySlot === activeTab}
                        label={selected ? '✓ Equipped' : ''}
                        onClick={() => onSetSingleSlot(activeTab, selected ? null : item.item_id)}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}

          {isMultiSlot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {tabItems.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', color: 'var(--text-hint)' }}>
                  You do not own {multiLabel} yet. Buy some in the shop first.
                </div>
              ) : (
                <div className="home-decor-grid">
                  {tabItems.map((item) => {
                    const enabled = activeMultiSet.has(item.item_id);
                    return (
                      <DecorGridCard
                        key={item.item_id}
                        item={item}
                        selected={enabled}
                        disabled={busySlot === activeTab}
                        label={enabled ? '✓ Placed' : ''}
                        onClick={() => toggleMultiItem(item.item_id, !enabled)}
                      />
                    );
                  })}
                </div>
              )}

              <div className="card" style={{ padding: '14px 16px' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
                  Layer Order
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 12, lineHeight: 1.5 }}>
                  Drag enabled decor rows. Lower rows render above earlier ones.
                </div>

                {activeMultiItems.length > 1 ? (
                  <BackDecorReorderList
                    items={activeMultiItems}
                    disabled={busySlot === activeTab}
                    saving={reorderBusy}
                    onReorder={reorderMultiItems}
                  />
                ) : (
                  <div style={{ color: 'var(--text-hint)', fontSize: 13 }}>
                    Enable at least two {multiLabel} to reorder them.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
    </BottomSheet>
  );
}
