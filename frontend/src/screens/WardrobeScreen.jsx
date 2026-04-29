import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import PeeperSprite from '../components/PeeperSprite';
import CatalogSortToggle from '../components/CatalogSortToggle';
import { assetUrl } from '../utils/assetUrl';
import { CATALOG_SORT_MODES, sortCatalogItems } from '../utils/catalogSort.mjs';
import * as api from '../api';

const SLOTS = ['head', 'body', 'hands', 'fren', 'face'];
const SLOT_LABELS = {
  head: '🎩 Head',
  body: '👕 Body',
  hands: '✋ Hands',
  fren: '🐸 Fren',
  face: '🕶️ Face',
};

function ItemSprite({ itemId, name, size = 56 }) {
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
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.35,
        color: 'var(--text-hint)',
      }}
    >
      {name?.[0] || '?'}
    </div>
  );
}

export default function WardrobeScreen() {
  const { peeper, ownedItems, updateOutfit } = useApp();

  const [slots, setSlots] = useState({
    slot_head: peeper?.slot_head || null,
    slot_body: peeper?.slot_body || null,
    slot_hands: peeper?.slot_hands || null,
    slot_fren: peeper?.slot_fren || null,
    slot_face: peeper?.slot_face || null,
  });
  const [activeSlot, setActiveSlot] = useState('head');
  const [allItems, setAllItems] = useState([]);
  const [sortMode, setSortMode] = useState(CATALOG_SORT_MODES.NEWEST);
  const [saving, setSaving] = useState(false);

  const loadItems = useCallback(async () => {
    try {
      const data = await api.getShopItems();
      setAllItems(data.clothing || []);
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (peeper) {
      setSlots({
        slot_head: peeper.slot_head || null,
        slot_body: peeper.slot_body || null,
        slot_hands: peeper.slot_hands || null,
        slot_fren: peeper.slot_fren || null,
        slot_face: peeper.slot_face || null,
      });
    }
  }, [peeper?.slot_head, peeper?.slot_body, peeper?.slot_hands, peeper?.slot_fren, peeper?.slot_face]);

  const previewPeeper = peeper ? { ...peeper, ...slots } : null;
  const currentSlotKey = `slot_${activeSlot}`;
  const selected = slots[currentSlotKey];

  const slotItems = useMemo(() => sortCatalogItems(
    allItems.filter((item) => item.slot === activeSlot && ownedItems.includes(item.item_id)),
    sortMode,
  ), [activeSlot, allItems, ownedItems, sortMode]);

  function selectItem(itemId) {
    setSlots((prev) => ({ ...prev, [currentSlotKey]: itemId || null }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateOutfit(slots);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '16px 16px 0' }}>
        <div className="page-header" style={{ padding: 0, margin: 0 }}>Wardrobe</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 10px' }}>
        <PeeperSprite peeper={previewPeeper} size={220} showDead={false} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 16px 12px' }}>
        <CatalogSortToggle mode={sortMode} onToggle={setSortMode} />
      </div>

      <div className="inner-tabs" style={{ marginTop: 0 }}>
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

      {selected && (
        <div style={{ padding: '0 16px 8px' }}>
          <button className="btn btn-secondary btn-full" onClick={() => selectItem(null)}>
            Remove from slot
          </button>
        </div>
      )}

      {slotItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 24px', color: 'var(--text-hint)', fontSize: 13 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>Wardrobe</div>
          No owned items for this slot.
          <br />
          <span style={{ fontSize: 12 }}>Buy some in the Shop!</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: '0 16px 12px' }}>
        {slotItems.map((item) => {
          const isSelected = selected === item.item_id;
          return (
            <div
              key={item.item_id}
              className={`item-card${isSelected ? ' selected' : ''}`}
              onClick={() => selectItem(isSelected ? null : item.item_id)}
              style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
            >
              <ItemSprite itemId={item.item_id} name={item.name} size={56} />
              <div className="item-name" style={{ textAlign: 'center' }}>{item.name}</div>
              {isSelected && <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>Equipped</div>}
            </div>
          );
        })}
      </div>

      <div style={{ padding: '0 16px' }}>
        <button className="btn btn-primary btn-full btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Outfit'}
        </button>
      </div>
    </div>
  );
}
