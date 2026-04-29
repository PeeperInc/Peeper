import React, { useMemo, useState } from 'react';
import BackDecorReorderList from '../components/BackDecorReorderList';
import CatalogSortToggle from '../components/CatalogSortToggle';
import { CATALOG_SORT_MODES, sortCatalogItems } from '../utils/catalogSort.mjs';

const BACK_LABEL = '← Back';
const CLEAR_LABEL = '✕ Clear slot';
const CHECK_LABEL = '✓';

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

export default function HomeDecorScreen({
  home,
  items,
  busySlot,
  reorderBusy,
  onBack,
  onSetSingleSlot,
  onToggleBackDecor,
  onReorderBackDecor,
}) {
  const [activeTab, setActiveTab] = useState('wall_base');
  const [sortMode, setSortMode] = useState(CATALOG_SORT_MODES.NEWEST);
  const activeSlots = home?.slots || {};
  const activeBackDecor = Array.isArray(activeSlots.back_decor) ? activeSlots.back_decor : [];
  const activeBackDecorSet = useMemo(
    () => new Set(activeBackDecor.map((item) => item.item_id)),
    [activeBackDecor],
  );

  const ownedItems = useMemo(
    () => items.filter((item) => item.owned),
    [items],
  );

  const tabItems = useMemo(
    () => sortCatalogItems(
      ownedItems.filter((item) => item.slot === activeTab),
      sortMode,
    ),
    [activeTab, ownedItems, sortMode],
  );

  const activeSingleItemId = activeTab === 'back_decor'
    ? null
    : activeSlots?.[activeTab]?.item_id ?? null;

  const canClearCurrentSlot = ['wall_base', 'floor_base', 'floor_cover', 'foreground_item'].includes(activeTab);

  return (
    <div
      style={{
        height: 'calc(100dvh - var(--tg-total-top))',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 16px 8px' }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ padding: '8px 12px', flexShrink: 0 }}>
          {BACK_LABEL}
        </button>
        <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>
            Decorate
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <CatalogSortToggle mode={sortMode} onToggle={setSortMode} />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(var(--tg-safe-bottom) + 16px)' }}>
        <div className="inner-tabs" style={{ marginTop: 0 }}>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px' }}>
          {activeTab !== 'back_decor' && (
            <>
              {canClearCurrentSlot && activeSingleItemId && (
                <div style={{ paddingBottom: 4 }}>
                  <button
                    className="btn btn-secondary btn-full"
                    onClick={() => onSetSingleSlot(activeTab, null)}
                    disabled={busySlot === activeTab}
                  >
                    {CLEAR_LABEL}
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
                        label={selected ? `${CHECK_LABEL} Equipped` : ''}
                        onClick={() => onSetSingleSlot(activeTab, selected ? null : item.item_id)}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeTab === 'back_decor' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {tabItems.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', color: 'var(--text-hint)' }}>
                  You do not own back decor yet. Buy some in the shop first.
                </div>
              ) : (
                <div className="home-decor-grid">
                  {tabItems.map((item) => {
                    const enabled = activeBackDecorSet.has(item.item_id);
                    return (
                      <DecorGridCard
                        key={item.item_id}
                        item={item}
                        selected={enabled}
                        disabled={busySlot === 'back_decor'}
                        label={enabled ? `${CHECK_LABEL} Placed` : ''}
                        onClick={() => onToggleBackDecor(item.item_id, !enabled)}
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

                {activeBackDecor.length > 1 ? (
                  <BackDecorReorderList
                    items={activeBackDecor}
                    disabled={busySlot === 'back_decor'}
                    saving={reorderBusy}
                    onReorder={onReorderBackDecor}
                  />
                ) : (
                  <div style={{ color: 'var(--text-hint)', fontSize: 13 }}>
                    Enable at least two decor items to reorder them.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
