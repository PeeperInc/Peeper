import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function moveItem(items, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function orderKey(items) {
  return items.map((item) => item.item_id).join('|');
}

export default function BackDecorReorderList({ items, disabled = false, saving = false, onReorder }) {
  const [orderedItems, setOrderedItems] = useState(items);
  const [draggingId, setDraggingId] = useState(null);
  const dragItemIdRef = useRef(null);
  const orderRef = useRef(items);
  const startOrderRef = useRef(orderKey(items));
  const moveHandlerRef = useRef(null);
  const upHandlerRef = useRef(null);
  const cancelHandlerRef = useRef(null);

  const currentOrderKey = useMemo(() => orderKey(items), [items]);

  useEffect(() => {
    setOrderedItems(items);
    orderRef.current = items;
    startOrderRef.current = currentOrderKey;
  }, [currentOrderKey, items]);

  const cleanupDrag = useCallback(() => {
    if (moveHandlerRef.current) window.removeEventListener('pointermove', moveHandlerRef.current);
    if (upHandlerRef.current) window.removeEventListener('pointerup', upHandlerRef.current);
    if (cancelHandlerRef.current) window.removeEventListener('pointercancel', cancelHandlerRef.current);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  const finishDrag = useCallback((commit) => {
    const finalOrder = orderRef.current.map((item) => item.item_id);
    const changed = finalOrder.join('|') !== startOrderRef.current;

    cleanupDrag();
    dragItemIdRef.current = null;
    setDraggingId(null);

    if (!commit) {
      setOrderedItems(items);
      orderRef.current = items;
      return;
    }

    if (changed) {
      Promise.resolve(onReorder(finalOrder)).catch(() => {
        setOrderedItems(items);
        orderRef.current = items;
      });
    }
  }, [cleanupDrag, items, onReorder]);

  const handlePointerMove = useCallback((event) => {
    const draggingItemId = dragItemIdRef.current;
    if (!draggingItemId) return;

    event.preventDefault();

    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-back-decor-row]');
    const targetItemId = target?.getAttribute('data-back-decor-row');
    if (!targetItemId || targetItemId === draggingItemId) return;

    setOrderedItems((current) => {
      const fromIndex = current.findIndex((item) => item.item_id === draggingItemId);
      const toIndex = current.findIndex((item) => item.item_id === targetItemId);
      const next = moveItem(current, fromIndex, toIndex);
      orderRef.current = next;
      return next;
    });
  }, []);

  const handlePointerUp = useCallback(() => {
    finishDrag(true);
  }, [finishDrag]);

  const handlePointerCancel = useCallback(() => {
    finishDrag(false);
  }, [finishDrag]);

  useEffect(() => {
    moveHandlerRef.current = handlePointerMove;
    upHandlerRef.current = handlePointerUp;
    cancelHandlerRef.current = handlePointerCancel;
  }, [handlePointerCancel, handlePointerMove, handlePointerUp]);

  useEffect(() => cleanupDrag, [cleanupDrag]);

  const handlePointerDown = useCallback((itemId, event) => {
    if (disabled || saving) return;
    event.preventDefault();
    dragItemIdRef.current = itemId;
    startOrderRef.current = orderRef.current.map((item) => item.item_id).join('|');
    setDraggingId(itemId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    if (moveHandlerRef.current) window.addEventListener('pointermove', moveHandlerRef.current, { passive: false });
    if (upHandlerRef.current) window.addEventListener('pointerup', upHandlerRef.current);
    if (cancelHandlerRef.current) window.addEventListener('pointercancel', cancelHandlerRef.current);
  }, [disabled, saving]);

  if (!items.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {orderedItems.map((item, index) => {
        const isDragging = draggingId === item.item_id;

        return (
          <div
            key={item.item_id}
            data-back-decor-row={item.item_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 16,
              border: '1px solid var(--border)',
              background: isDragging ? 'var(--accent-light)' : 'var(--bg-card)',
              boxShadow: isDragging ? '0 10px 24px rgba(74,124,89,0.18)' : 'var(--shadow-xs)',
              opacity: saving ? 0.7 : 1,
              transform: isDragging ? 'scale(1.01)' : 'none',
              transition: 'background 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease',
            }}
          >
            <button
              type="button"
              onPointerDown={(event) => handlePointerDown(item.item_id, event)}
              disabled={disabled || saving}
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: isDragging ? 'var(--accent)' : 'var(--bg-secondary)',
                color: isDragging ? '#fff' : 'var(--accent)',
                fontSize: 18,
                fontWeight: 900,
                cursor: disabled || saving ? 'default' : 'grab',
                touchAction: 'none',
                flexShrink: 0,
              }}
              aria-label={`Drag ${item.name}`}
            >
              ≡
            </button>

            <div style={{
              width: 44,
              aspectRatio: '600 / 840',
              borderRadius: 12,
              overflow: 'hidden',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              flexShrink: 0,
            }}>
              <img
                src={item.file_path}
                alt=""
                draggable={false}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>{item.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 2 }}>
                Position {index + 1} · lower rows render above earlier ones
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
