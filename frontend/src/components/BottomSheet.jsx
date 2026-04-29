import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const DEFAULT_CLOSE_THRESHOLD = 72;
const DEFAULT_CLOSE_DELAY = 170;
const DEFAULT_BACKDROP_OPACITY = 0.55;
const DEFAULT_SHEET_Z_INDEX = 320;

export default function BottomSheet({
  onClose,
  children,
  zIndex = DEFAULT_SHEET_Z_INDEX,
  backdropClassName = 'sheet-backdrop',
  bodyClassName = 'sheet-body',
  backdropStyle,
  bodyStyle,
  closeOnBackdrop = true,
  closeThreshold = DEFAULT_CLOSE_THRESHOLD,
  closeDelay = DEFAULT_CLOSE_DELAY,
}) {
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const pointerIdRef = useRef(null);
  const closeTimerRef = useRef(null);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const finishClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setDragging(false);
    setDragOffset(typeof window !== 'undefined' ? window.innerHeight || 420 : 420);
    closeTimerRef.current = setTimeout(() => {
      onClose?.();
    }, closeDelay);
  }, [closeDelay, onClose]);

  const resetDrag = useCallback(() => {
    pointerIdRef.current = null;
    setDragging(false);
    setDragOffset(0);
  }, []);

  const handlePointerDown = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerIdRef.current = event.pointerId;
    startYRef.current = event.clientY;
    setDragging(true);
    setDragOffset(0);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, []);

  const handlePointerMove = useCallback((event) => {
    if (pointerIdRef.current !== event.pointerId) return;
    const nextOffset = Math.max(0, event.clientY - startYRef.current);
    setDragOffset(nextOffset);
  }, []);

  const handlePointerEnd = useCallback((event) => {
    if (pointerIdRef.current !== event.pointerId) return;
    const nextOffset = Math.max(0, event.clientY - startYRef.current);
    pointerIdRef.current = null;
    if (nextOffset >= closeThreshold) {
      finishClose();
      return;
    }
    setDragging(false);
    setDragOffset(0);
  }, [closeThreshold, finishClose]);

  const handlePointerCancel = useCallback((event) => {
    if (pointerIdRef.current !== event.pointerId) return;
    resetDrag();
  }, [resetDrag]);

  const backdropOpacity = useMemo(() => {
    const loss = Math.min(dragOffset / 260, 0.42);
    return Math.max(0.08, DEFAULT_BACKDROP_OPACITY - loss);
  }, [dragOffset]);

  const sheet = (
    <div
      className={backdropClassName}
      style={{ zIndex, background: `rgba(0,0,0,${backdropOpacity})`, ...backdropStyle }}
      onClick={(event) => {
        if (!closeOnBackdrop) return;
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className={`${bodyClassName}${dragging ? ' sheet-body-dragging' : ''}`}
        style={{
          transform: `translateY(${dragOffset}px)`,
          transition: dragging ? 'none' : 'transform 0.18s var(--ease-smooth)',
          ...bodyStyle,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="sheet-drag-zone"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerCancel}
        >
          <div className="sheet-handle" />
        </div>
        {children}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return sheet;
  return createPortal(sheet, document.body);
}
