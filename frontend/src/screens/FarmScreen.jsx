import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import BottomSheet from '../components/BottomSheet';
import { FARM_RETIREMENT_LOCK_MS, getFarmSlotPostAction } from '../utils/farmSlotInteraction.mjs';

const COIN_SYMBOL = '\u2726';
const FARM_ICON = String.fromCodePoint(0x1F33E);
const FARM_SPRITE_BASE = '/sprites/farm';
const farmSprite = name => `${FARM_SPRITE_BASE}/${name}.png`;
const farmIsoCarrotGrowing = farmSprite('farm_iso_carrot_growing');
const farmIsoCarrotReady = farmSprite('farm_iso_carrot_ready');
const farmIsoChickenIdle = farmSprite('farm_iso_chicken_idle');
const farmIsoChickenReady = farmSprite('farm_iso_chicken_ready');
const farmIsoCowIdle = farmSprite('farm_iso_cow_idle');
const farmIsoCowReady = farmSprite('farm_iso_cow_ready');
const farmIsoPenEmpty = farmSprite('farm_iso_pen_empty');
const farmIsoPigIdle = farmSprite('farm_iso_pig_idle');
const farmIsoPigReady = farmSprite('farm_iso_pig_ready');
const farmIsoPlotEmpty = farmSprite('farm_iso_plot_empty');
const farmIsoPotatoGrowing = farmSprite('farm_iso_potato_growing');
const farmIsoPotatoReady = farmSprite('farm_iso_potato_ready');
const farmIsoSlotEmpty = farmSprite('farm_iso_slot_empty');
const farmIsoSquash = farmSprite('farm_iso_squash');
const farmIsoTomatoGrowing = farmSprite('farm_iso_tomato_growing');
const farmIsoTomatoReady = farmSprite('farm_iso_tomato_ready');

const PRODUCT_ICONS = {
  carrot: '\uD83E\uDD55',
  tomato: '\uD83C\uDF45',
  potato: '\uD83E\uDD54',
  egg: '\uD83E\uDD5A',
  milk: '\uD83E\uDD5B',
  truffle: String.fromCodePoint(0x1F9C6),
  magic_squash: '\uD83C\uDF83',
};

const CROP_ICONS = {
  carrot: '\uD83E\uDD55',
  tomato: '\uD83C\uDF45',
  potato: '\uD83E\uDD54',
};

const ANIMAL_ICONS = {
  chicken: '\uD83D\uDC14',
  cow: '\uD83D\uDC04',
  pig: '\uD83D\uDC16',
};

const ISO_CROP_SPRITES = {
  carrot: { growing: farmIsoCarrotGrowing, ready: farmIsoCarrotReady },
  tomato: { growing: farmIsoTomatoGrowing, ready: farmIsoTomatoReady },
  potato: { growing: farmIsoPotatoGrowing, ready: farmIsoPotatoReady },
};

const ISO_ANIMAL_SPRITES = {
  chicken: { idle: farmIsoChickenIdle, ready: farmIsoChickenReady },
  cow: { idle: farmIsoCowIdle, ready: farmIsoCowReady },
  pig: { idle: farmIsoPigIdle, ready: farmIsoPigReady },
};

function formatTime(seconds = 0) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (total <= 0) return 'Ready';
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.ceil((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function remainingFrom(target, nowSeconds) {
  const ts = Math.floor(Number(target) || 0);
  return ts > 0 ? Math.max(0, ts - nowSeconds) : 0;
}

function useFarmFit(signature) {
  const viewportRef = useRef(null);
  const layoutRef = useRef(null);
  const [fit, setFit] = useState({ scale: 1, height: null, availableHeight: 0, availableWidth: 0 });

  const recompute = useCallback(() => {
    const viewport = viewportRef.current;
    const layout = layoutRef.current;
    if (!viewport || !layout) return;

    const viewportStyle = window.getComputedStyle(viewport);
    const paddingX = (Number.parseFloat(viewportStyle.paddingLeft) || 0) + (Number.parseFloat(viewportStyle.paddingRight) || 0);
    const paddingY = (Number.parseFloat(viewportStyle.paddingTop) || 0) + (Number.parseFloat(viewportStyle.paddingBottom) || 0);
    const availableWidth = Math.max(0, viewport.clientWidth - paddingX);
    const availableHeight = Math.max(0, viewport.clientHeight - paddingY);
    const naturalWidth = layout.offsetWidth || layout.scrollWidth || availableWidth;
    const naturalHeight = layout.offsetHeight || layout.scrollHeight || availableHeight;
    if (!naturalWidth || !naturalHeight) return;

    const nextScale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);
    const scale = Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1;
    const height = Math.ceil(naturalHeight * scale);
    setFit((previous) => {
      const stable =
        Math.abs(previous.scale - scale) < 0.003 &&
        Math.abs((previous.height || 0) - height) <= 1 &&
        Math.abs((previous.availableHeight || 0) - availableHeight) <= 1 &&
        Math.abs((previous.availableWidth || 0) - availableWidth) <= 1;
      return stable ? previous : {
        scale,
        height,
        availableHeight,
        availableWidth,
      };
    });
  }, []);

  useLayoutEffect(() => {
    let frame = window.requestAnimationFrame(recompute);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(recompute);
    }) : null;

    if (observer) {
      if (viewportRef.current) observer.observe(viewportRef.current);
      if (layoutRef.current) observer.observe(layoutRef.current);
    }

    window.addEventListener('resize', recompute);
    window.addEventListener('orientationchange', recompute);
    window.visualViewport?.addEventListener?.('resize', recompute);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', recompute);
      window.removeEventListener('orientationchange', recompute);
      window.visualViewport?.removeEventListener?.('resize', recompute);
    };
  }, [recompute, signature]);

  return { viewportRef, layoutRef, ...fit };
}

function FarmButton({ children, variant = 'secondary', disabled = false, onClick, style, className = '' }) {
  return (
    <button
      type="button"
      className={`btn btn-${variant}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: 'var(--farm-button-min-height, 36px)',
        padding: 'var(--farm-button-padding, 8px 10px)',
        borderRadius: 10,
        fontSize: 'var(--farm-button-font-size, 12px)',
        fontWeight: 850,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function MiniChoiceGrid({ children, style }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, ...style }}>
      {children}
    </div>
  );
}

function getIsoSlotSprite(slot) {
  if (!slot?.type) return farmIsoSlotEmpty;
  if (slot.state === 'plot_empty') return farmIsoPlotEmpty;
  if (slot.state === 'pen_empty') return farmIsoPenEmpty;
  if (slot.state === 'crop_growing' || slot.state === 'crop_ready') {
    if (slot.state === 'crop_ready' && slot.cropResultProductId === 'magic_squash') {
      return farmIsoSquash;
    }
    const cropId = slot.crop?.id;
    const sprites = ISO_CROP_SPRITES[cropId];
    return sprites?.[slot.state === 'crop_ready' ? 'ready' : 'growing'] || farmIsoPlotEmpty;
  }
  if (slot.type === 'pen') {
    const animalId = slot.animal?.id;
    const sprites = ISO_ANIMAL_SPRITES[animalId];
    return sprites?.[slot.state === 'animal_ready' ? 'ready' : 'idle'] || farmIsoPenEmpty;
  }
  return farmIsoSlotEmpty;
}

function getIsoMarkerType(slot) {
  if (slot?.state === 'crop_ready' || slot?.state === 'animal_ready') return 'collect';
  if (slot?.state === 'animal_hungry') return 'feed';
  if (slot?.canWater) return 'water';
  return null;
}

function ActionMarkerIcon({ type }) {
  if (type === 'water') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" style={{ width: 34, height: 34, display: 'block' }}>
        <path d="M16 37c3-12 10-19 24-20l3 20c-8 6-18 9-27 0Z" fill="#76b8ff" stroke="#17395f" strokeWidth="4" strokeLinejoin="round" />
        <path d="M39 18c6-7 16-6 18 2 2 7-4 12-11 12" fill="none" stroke="#17395f" strokeWidth="5" strokeLinecap="round" />
        <path d="M12 36 5 33" stroke="#17395f" strokeWidth="5" strokeLinecap="round" />
        <path d="M7 31c2-4 6-7 11-7" fill="none" stroke="#17395f" strokeWidth="4" strokeLinecap="round" />
        <path d="M17 43c-2 5-1 10 3 12 4 1 8-2 9-8" fill="#9bd0ff" stroke="#17395f" strokeWidth="4" strokeLinejoin="round" />
        <path d="M18 23c5 2 14 1 22-2" stroke="#d9f1ff" strokeWidth="4" strokeLinecap="round" opacity=".9" />
      </svg>
    );
  }
  if (type === 'feed') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" style={{ width: 34, height: 34, display: 'block' }}>
        <path d="M20 18c3 4 21 4 24 0l5 33c-4 7-31 7-35 0l6-33Z" fill="#d9aa65" stroke="#53351c" strokeWidth="4" strokeLinejoin="round" />
        <path d="M20 18c3-7 21-7 24 0-3 4-21 4-24 0Z" fill="#f4d48e" stroke="#53351c" strokeWidth="4" strokeLinejoin="round" />
        <path d="M23 32h18M24 41h16" stroke="#8d5e2f" strokeWidth="4" strokeLinecap="round" />
        <circle cx="19" cy="50" r="3" fill="#8d5e2f" />
        <circle cx="31" cy="53" r="3" fill="#8d5e2f" />
        <circle cx="43" cy="49" r="3" fill="#8d5e2f" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" style={{ width: 34, height: 34, display: 'block' }}>
      <path d="M15 25h34l-4 28H19l-4-28Z" fill="#f0b85f" stroke="#4d3219" strokeWidth="4" strokeLinejoin="round" />
      <path d="M23 25c2-10 16-10 18 0" fill="none" stroke="#4d3219" strokeWidth="5" strokeLinecap="round" />
      <path d="M15 31h34" stroke="#8a5728" strokeWidth="4" strokeLinecap="round" />
      <path d="M24 36v11M32 34v15M40 36v11" stroke="#8a5728" strokeWidth="3" strokeLinecap="round" />
      <path d="M21 20c-3-7 2-11 8-8-1 6-3 8-8 8Z" fill="#78bd4b" stroke="#315b25" strokeWidth="3" strokeLinejoin="round" />
      <path d="M43 20c5-7 12-4 11 3-6 2-9 1-11-3Z" fill="#78bd4b" stroke="#315b25" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

function FloatingActionMarker({ type }) {
  if (!type) return null;
  return (
    <div
      className={`farm-iso-marker farm-iso-marker-${type}`}
      aria-hidden="true"
    >
      <ActionMarkerIcon type={type} />
    </div>
  );
}

function getVerticalIsoPlacement(index) {
  const rows = [
    [0],
    [1, 2],
    [3],
    [4, 5],
    [6],
    [7, 8],
  ];
  const row = rows.findIndex((items) => items.includes(index));
  const items = rows[row] || [index];
  const position = Math.max(0, items.indexOf(index));
  const isSingle = items.length === 1;
  return {
    row,
    side: isSingle ? 'center' : position === 0 ? 'left' : 'right',
    left: isSingle ? 50 : position === 0 ? 29 : 71,
    top: 0.5 + row * 15.1,
    zIndex: 10 + row,
  };
}

function getPopoverPlacement(index) {
  const placement = getVerticalIsoPlacement(index);
  if (placement.row >= 4) {
    return { left: '50%', top: '42%', transform: 'translate(-50%, 0)' };
  }
  if (placement.side === 'left') {
    return { left: '48%', top: `${Math.min(74, placement.top + 4)}%`, transform: 'translate(0, 0)' };
  }
  if (placement.side === 'right') {
    return { left: '4%', top: `${Math.min(74, placement.top + 4)}%`, transform: 'translate(0, 0)' };
  }
  return { left: '50%', top: `${Math.min(75, placement.top + 21)}%`, transform: 'translate(-50%, 0)' };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function IsoFarmTile({ slot, index, rebuildMode, selected, retirement, onSelect }) {
  const markerType = getIsoMarkerType(slot);
  const isRebuildTarget = rebuildMode && Boolean(slot?.type);
  const isRetiring = Boolean(retirement);
  const placement = getVerticalIsoPlacement(index);

  return (
    <button
      type="button"
      className={`farm-iso-tile ${selected ? 'farm-iso-tile-selected' : ''} ${isRebuildTarget ? 'farm-iso-tile-rebuild' : ''} ${isRetiring ? 'farm-iso-tile-retiring' : ''}`}
      style={{
        left: `${placement.left}%`,
        top: `${placement.top}%`,
        zIndex: placement.zIndex,
        '--farm-retirement-duration': `${FARM_RETIREMENT_LOCK_MS}ms`,
      }}
      data-farm-slot-index={index}
      disabled={isRetiring}
      onClick={() => {
        if (!isRetiring) onSelect(slot);
      }}
      aria-label={`Farm slot ${index + 1}`}
    >
      <img
        src={getIsoSlotSprite(slot)}
        alt=""
        draggable="false"
        className="farm-iso-tile-img"
      />
      {isRetiring && (
        <img
          src={getIsoSlotSprite(retirement.previousSlot)}
          alt=""
          draggable="false"
          className="farm-iso-retiring-animal"
        />
      )}
      <FloatingActionMarker type={isRebuildTarget || isRetiring ? null : markerType} />
      {isRetiring && <span className="farm-iso-retirement-glow" aria-hidden="true" />}
      {isRebuildTarget && <div className="farm-iso-rebuild-tag">Rebuild</div>}
    </button>
  );
}

function FarmTilePopover({ slot, index, catalog, coins, nowSeconds, busyKey, boardRef, onAction, onClose }) {
  const popoverRef = useRef(null);
  const [safePlacement, setSafePlacement] = useState(null);

  useLayoutEffect(() => {
    const updatePlacement = () => {
      const board = boardRef?.current;
      const popover = popoverRef.current;
      const tile = board?.querySelector(`[data-farm-slot-index="${index}"]`);
      if (!board || !popover || !tile) return;

      const boardRect = board.getBoundingClientRect();
      const tileRect = tile.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const gap = 10;
      const edge = 10;
      const tilePlacement = getVerticalIsoPlacement(index);

      let left;
      if (tilePlacement.side === 'right') {
        left = tileRect.left - boardRect.left - popoverRect.width - gap;
      } else if (tilePlacement.side === 'left') {
        left = tileRect.right - boardRect.left + gap;
      } else {
        left = tileRect.left - boardRect.left + (tileRect.width - popoverRect.width) / 2;
      }

      let top = tileRect.top - boardRect.top + tileRect.height * 0.18;
      if (tilePlacement.row >= 4) {
        top = tileRect.top - boardRect.top - popoverRect.height * 0.35;
      }

      const minLeft = Math.max(edge, -boardRect.left + edge);
      const maxLeft = Math.min(
        boardRect.width - popoverRect.width - edge,
        window.innerWidth - boardRect.left - popoverRect.width - edge,
      );
      const minTop = Math.max(edge, -boardRect.top + edge);
      const maxTop = Math.min(
        boardRect.height - popoverRect.height - edge,
        window.innerHeight - boardRect.top - popoverRect.height - edge,
      );

      setSafePlacement({
        left: clamp(left, minLeft, Math.max(minLeft, maxLeft)),
        top: clamp(top, minTop, Math.max(minTop, maxTop)),
      });
    };

    updatePlacement();
    const frameId = window.requestAnimationFrame(updatePlacement);
    const timeoutId = window.setTimeout(updatePlacement, 80);
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('orientationchange', updatePlacement);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('orientationchange', updatePlacement);
    };
  }, [boardRef, index, slot?.state, slot?.readyAt, slot?.lifeRemainingSeconds]);

  if (!slot) return null;
  return (
    <div
      ref={popoverRef}
      className="farm-tile-popover"
      onClick={(event) => event.stopPropagation()}
      style={{
        ...(safePlacement
          ? { left: safePlacement.left, top: safePlacement.top, transform: 'none' }
          : { ...getPopoverPlacement(index), visibility: 'hidden' }),
        zIndex: 80 + getVerticalIsoPlacement(index).row,
      }}
    >
      <button type="button" className="farm-tile-popover-close" onClick={onClose} aria-label="Close">×</button>
      <FarmSlotSheet
        slot={slot}
        catalog={catalog}
        coins={coins}
        nowSeconds={nowSeconds}
        busyKey={busyKey}
        onAction={onAction}
      />
    </div>
  );
}

function IsoFarmBoard({
  slots,
  rebuildMode,
  selectedSlot,
  catalog,
  coins,
  nowSeconds,
  busyKey,
  onAction,
  onSelectSlot,
  onClosePopover,
  retiringSlots,
}) {
  const boardRef = useRef(null);
  const selectedIndex = selectedSlot?.index ?? null;
  const selectedFreshSlot = selectedSlot
    ? slots.find((slot) => slot.index === selectedSlot.index) || selectedSlot
    : null;
  const selectedBoardIndex = selectedFreshSlot
    ? slots.findIndex((slot) => slot.index === selectedFreshSlot.index)
    : -1;

  return (
    <div className="farm-iso-board-wrap">
      <div className="farm-iso-board" ref={boardRef}>
        {selectedFreshSlot && !rebuildMode && (
          <button
            type="button"
            className="farm-iso-dismiss-layer"
            aria-label="Close farm tile menu"
            onClick={onClosePopover}
          />
        )}
        <div className="farm-iso-board-shadow" />
        {slots.map((slot, index) => (
          <IsoFarmTile
            key={slot.index ?? index}
            slot={slot}
            index={index}
            rebuildMode={rebuildMode}
            selected={!rebuildMode && selectedIndex === slot.index}
            retirement={retiringSlots?.[slot.index]}
            onSelect={onSelectSlot}
          />
        ))}
        {!rebuildMode && selectedFreshSlot && selectedBoardIndex >= 0 && (
          <FarmTilePopover
            slot={selectedFreshSlot}
            index={selectedBoardIndex}
            catalog={catalog}
            coins={coins}
            nowSeconds={nowSeconds}
            busyKey={busyKey}
            boardRef={boardRef}
            onAction={onAction}
            onClose={onClosePopover}
          />
        )}
      </div>
    </div>
  );
}

function FarmSlotSheet({ slot, catalog, coins, nowSeconds, busyKey, onAction }) {
  const busy = busyKey === `slot:${slot?.index}`;
  const crops = catalog?.crops || [];
  const animals = catalog?.animals || [];
  const buildCosts = catalog?.slotBuildCosts || {};
  const crop = slot?.crop || {};
  const animal = slot?.animal || {};
  const product = catalog?.products?.find((item) => item.id === animal.productId);
  const cropResultProduct = slot?.cropResultProduct || catalog?.products?.find((item) => item.id === slot?.cropResultProductId);
  const cropRemaining = remainingFrom(slot?.readyAt, nowSeconds);
  const waterRemaining = remainingFrom(slot?.waterAvailableAt, nowSeconds);
  const produceRemaining = remainingFrom(slot?.readyAt, nowSeconds);
  const lifeRemaining = remainingFrom(slot?.expiresAt, nowSeconds);
  const retiresAfterCollection = lifeRemaining <= 0 && (slot?.state === 'animal_ready' || slot?.state === 'animal_producing');
  const titleStyle = { fontSize: 17, fontWeight: 1000, color: 'var(--text-primary)', letterSpacing: '-0.03em', paddingRight: 24 };
  const textStyle = { fontSize: 11, lineHeight: 1.35, color: 'var(--farm-muted-text)', fontWeight: 760 };
  const sprite = getIsoSlotSprite(slot);

  const Header = ({ title, children }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr)', alignItems: 'center', gap: 7 }}>
      <img src={sprite} alt="" draggable="false" className="farm-iso-popover-sprite" style={{ objectFit: 'contain' }} />
      <div>
        <div style={titleStyle}>{title}</div>
        <div style={textStyle}>{children}</div>
      </div>
    </div>
  );

  if (!slot?.type) {
    return (
      <div style={{ display: 'grid', gap: 9 }}>
        <Header title="Empty slot">Build a crop plot or an animal pen here.</Header>
        <MiniChoiceGrid>
          <FarmButton
            variant="primary"
            disabled={busy || coins < (buildCosts.plot || 0)}
            onClick={() => onAction(() => api.buildFarmSlot(slot.index, 'plot'), `slot:${slot.index}`)}
            style={{ minHeight: 34, fontSize: 10.5 }}
          >
            Build Plot {buildCosts.plot} {COIN_SYMBOL}
          </FarmButton>
          <FarmButton
            variant="primary"
            disabled={busy || coins < (buildCosts.pen || 0)}
            onClick={() => onAction(() => api.buildFarmSlot(slot.index, 'pen'), `slot:${slot.index}`)}
            style={{ minHeight: 34, fontSize: 10.5 }}
          >
            Build Pen {buildCosts.pen} {COIN_SYMBOL}
          </FarmButton>
        </MiniChoiceGrid>
      </div>
    );
  }

  if (slot.state === 'plot_empty') {
    return (
      <div style={{ display: 'grid', gap: 9 }}>
        <Header title="Crop plot">Choose seeds to plant in this plot.</Header>
        <div style={{ display: 'grid', gap: 6 }}>
          {crops.map((nextCrop) => (
            <FarmButton
              key={nextCrop.id}
              variant="primary"
              disabled={busy || coins < nextCrop.seedCost}
              onClick={() => onAction(() => api.plantFarmCrop(slot.index, nextCrop.id), `slot:${slot.index}`)}
              style={{ minHeight: 34, fontSize: 10.5 }}
            >
              {CROP_ICONS[nextCrop.id] || ''} {nextCrop.name} · {nextCrop.seedCost} {COIN_SYMBOL} · {formatTime(nextCrop.growSeconds)}
            </FarmButton>
          ))}
        </div>
      </div>
    );
  }

  if (slot.state === 'crop_growing' || slot.state === 'crop_ready') {
    const ready = cropRemaining <= 0;
    const showWaterAction = !ready && waterRemaining <= cropRemaining;
    return (
      <div style={{ display: 'grid', gap: 9 }}>
        <Header title={ready && cropResultProduct ? cropResultProduct.name : (crop.name || 'Crop')}>
          {ready
            ? `${cropResultProduct?.name || 'Crop'} is ready to harvest.`
            : `Grows in ${formatTime(cropRemaining)}.`}
          {showWaterAction && <><br />Watering cuts remaining grow time by 10%.</>}
        </Header>
        {ready ? (
          <FarmButton
            variant="primary"
            disabled={busy}
            onClick={() => onAction(() => api.harvestFarmSlot(slot.index), `slot:${slot.index}`)}
            style={{ minHeight: 36, fontSize: 11 }}
          >
            Harvest
          </FarmButton>
        ) : showWaterAction ? (
          <FarmButton
            variant={waterRemaining <= 0 ? 'primary' : 'secondary'}
            disabled={busy || waterRemaining > 0}
            onClick={() => onAction(() => api.waterFarmSlot(slot.index), `slot:${slot.index}`)}
            style={{ minHeight: 36, fontSize: 11 }}
          >
            {waterRemaining > 0 ? `Water in ${formatTime(waterRemaining)}` : 'Water · -10% time'}
          </FarmButton>
        ) : null}
      </div>
    );
  }

  if (slot.state === 'pen_empty') {
    return (
      <div style={{ display: 'grid', gap: 9 }}>
        <Header title="Animal pen">Buy an animal. Animals live for 7 days and produce after feeding.</Header>
        <div style={{ display: 'grid', gap: 6 }}>
          {animals.map((nextAnimal) => (
            <FarmButton
              key={nextAnimal.id}
              variant="primary"
              disabled={busy || coins < nextAnimal.buyCost}
              onClick={() => onAction(() => api.buyFarmAnimal(slot.index, nextAnimal.id), `slot:${slot.index}`)}
              style={{ minHeight: 34, fontSize: 10.5 }}
            >
              {ANIMAL_ICONS[nextAnimal.id] || ''} {nextAnimal.name} · {nextAnimal.buyCost} {COIN_SYMBOL}
            </FarmButton>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 9 }}>
      <Header title={animal.name || 'Animal'}>
        {slot.state === 'animal_ready'
          ? `${product?.name || 'Product'} is ready.`
          : slot.state === 'animal_producing'
            ? `Ready in ${formatTime(produceRemaining)}.`
            : 'Hungry. Feed to start production.'}
        <br />{retiresAfterCollection ? 'Retires after collection.' : `Retires in ${formatTime(lifeRemaining)}.`}
      </Header>
      {slot.state === 'animal_ready' ? (
        <FarmButton
          variant="primary"
          disabled={busy}
          onClick={() => onAction(() => api.collectFarmAnimal(slot.index), `slot:${slot.index}`)}
          style={{ minHeight: 36, fontSize: 11 }}
        >
          Collect {product?.name || 'Product'}
        </FarmButton>
      ) : slot.state === 'animal_producing' ? (
        <FarmButton disabled style={{ minHeight: 36, fontSize: 11 }}>
          Ready in {formatTime(produceRemaining)}
        </FarmButton>
      ) : (
        <FarmButton
          variant="primary"
          disabled={busy || coins < animal.feedCost}
          onClick={() => onAction(() => api.feedFarmAnimal(slot.index, 'coins'), `slot:${slot.index}`)}
          style={{ minHeight: 36, fontSize: 11 }}
        >
          Feed {animal.feedCost} {COIN_SYMBOL}
        </FarmButton>
      )}
    </div>
  );
}

function ValueProgress({ recipe, values }) {
  const vegPct = Math.min(1, (values.vegetable || 0) / Math.max(1, recipe.vegetableValue));
  const animalPct = Math.min(1, (values.animal || 0) / Math.max(1, recipe.animalValue));
  return (
    <div style={{
      position: 'relative',
      height: 24,
      borderRadius: 999,
      overflow: 'hidden',
      border: '1px solid var(--farm-fridge-progress-border)',
      background: 'var(--farm-fridge-progress-bg)',
      boxShadow: 'inset 0 1px 3px rgba(27,61,42,0.14)',
    }}>
      <div style={{
        position: 'absolute',
        inset: '0 50% 0 0',
        width: `${vegPct * 50}%`,
        background: 'linear-gradient(90deg,#70bf55,#b4df63)',
      }} />
      <div style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        bottom: 0,
        width: `${animalPct * 50}%`,
        background: 'linear-gradient(90deg,#e0a04c,#c96c3e)',
      }} />
      <div style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        bottom: 0,
        width: 2,
        transform: 'translateX(-1px)',
        background: 'var(--farm-fridge-progress-divider)',
      }} />
      <div style={{
        position: 'relative',
        zIndex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        height: '100%',
        alignItems: 'center',
        color: 'var(--farm-fridge-progress-text)',
        fontSize: 10,
        fontWeight: 950,
        textShadow: 'var(--farm-fridge-progress-shadow)',
      }}>
        <span style={{ textAlign: 'center' }}>Veg {values.vegetable || 0}/{recipe.vegetableValue}</span>
        <span style={{ textAlign: 'center' }}>Animal {values.animal || 0}/{recipe.animalValue}</span>
      </div>
    </div>
  );
}

function InventoryPanel({ mode = 'inventory', state, coins, busyKey, onAction }) {
  const inventory = state?.inventory || [];
  const values = state?.inventoryValues || { vegetable: 0, animal: 0 };
  const recipes = state?.catalog?.fridgeRecipes || [];
  const familyBigFeastRecipe = state?.catalog?.familyBigFeastRecipe || {
    type: 'farm_family_big_feast',
    label: 'Family Big Feast',
    vegetableValue: 750,
    animalValue: 250,
  };
  const fridgeOwned = Boolean(state?.fridge?.owned);
  const fridgeActive = Boolean(state?.fridge?.active);
  const fridgeRemaining = Number(state?.fridge?.remainingSeconds || 0);
  const hasFamily = Boolean(state?.family?.id);

  if (mode === 'fridge') {
    const feastEnough = values.vegetable >= familyBigFeastRecipe.vegetableValue
      && values.animal >= familyBigFeastRecipe.animalValue;

    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{
          borderRadius: 18,
          padding: 14,
          background: 'var(--farm-fridge-panel-bg)',
          border: '1px solid rgba(74,163,255,0.22)',
        }}>
          <div style={{ fontSize: 16, fontWeight: 950, color: 'var(--text-primary)' }}>Fridge Stock</div>
          <div style={{ fontSize: 11, color: 'var(--farm-muted-text)', fontWeight: 750, marginTop: 2 }}>
            Requires both vegetables and animal products. Paid Fridge stock still works in Food.
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {recipes.map((recipe) => {
              const enough = values.vegetable >= recipe.vegetableValue && values.animal >= recipe.animalValue;
              return (
                <FarmButton
                  key={recipe.type}
                  variant={fridgeOwned && !fridgeActive && enough ? 'primary' : 'secondary'}
                  disabled={!fridgeOwned || fridgeActive || !enough || busyKey === `fridge:${recipe.type}`}
                  onClick={() => onAction(() => api.stockFarmFridge(recipe.type), `fridge:${recipe.type}`)}
                  style={{
                    minHeight: 74,
                    alignItems: 'stretch',
                    justifyContent: 'center',
                    padding: 9,
                    opacity: !fridgeOwned || !enough ? 0.92 : 1,
                  }}
                >
                  <div style={{ display: 'grid', gap: 7, width: '100%' }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      alignItems: 'center',
                      fontSize: 13,
                      fontWeight: 950,
                    }}>
                      <span>{recipe.label}</span>
                      <span>{recipe.vegetableValue} veg + {recipe.animalValue} animal</span>
                    </div>
                    <ValueProgress recipe={recipe} values={values} />
                  </div>
                </FarmButton>
              );
            })}
          </div>
          {!fridgeOwned && (
            <div style={{ fontSize: 11, color: 'var(--farm-warning-text)', fontWeight: 800, marginTop: 8 }}>
              Buy Fridge in Food menu first.
            </div>
          )}
          {fridgeOwned && fridgeActive && (
            <div style={{ fontSize: 11, color: 'var(--farm-warning-text)', fontWeight: 800, marginTop: 8 }}>
              Fridge is already stocked for {formatTime(fridgeRemaining)}. Add new Farm stock after it runs out.
            </div>
          )}
        </div>

        <div style={{
          borderRadius: 18,
          padding: 14,
          background: 'var(--farm-fridge-panel-bg)',
          border: '1px solid rgba(213,148,65,0.32)',
        }}>
          <div style={{ fontSize: 16, fontWeight: 950, color: 'var(--text-primary)' }}>Family Big Feast</div>
          <div style={{ fontSize: 11, color: 'var(--farm-muted-text)', fontWeight: 750, marginTop: 2 }}>
            Feed every living family Peeper to 100% hunger. No coins, no cooldown.
          </div>
          <FarmButton
            variant={hasFamily && feastEnough ? 'primary' : 'secondary'}
            disabled={!hasFamily || !feastEnough || busyKey === 'farm-family-feast'}
            onClick={() => onAction(api.triggerFarmFamilyBigFeast, 'farm-family-feast')}
            style={{
              width: '100%',
              minHeight: 78,
              alignItems: 'stretch',
              justifyContent: 'center',
              padding: 9,
              marginTop: 10,
              opacity: !hasFamily || !feastEnough ? 0.92 : 1,
            }}
          >
            <div style={{ display: 'grid', gap: 7, width: '100%' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                alignItems: 'center',
                fontSize: 13,
                fontWeight: 950,
              }}>
                <span>Serve Family Big Feast</span>
                <span>{familyBigFeastRecipe.vegetableValue} veg + {familyBigFeastRecipe.animalValue} animal</span>
              </div>
              <ValueProgress recipe={familyBigFeastRecipe} values={values} />
            </div>
          </FarmButton>
          {!hasFamily && (
            <div style={{ fontSize: 11, color: 'var(--farm-warning-text)', fontWeight: 800, marginTop: 8 }}>
              Join or create a family first.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: 18,
      padding: 14,
      background: 'var(--farm-panel-bg)',
      border: '1px solid var(--farm-panel-border)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 950, color: 'var(--text-primary)' }}>Farm Inventory</div>
          <div style={{ fontSize: 11, color: 'var(--farm-muted-text)', fontWeight: 750 }}>
            Veg {values.vegetable || 0} value · Animal {values.animal || 0} value
          </div>
        </div>
        <div className="coins-badge" style={{ flexShrink: 0 }}>{COIN_SYMBOL} {coins}</div>
      </div>

      {inventory.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--farm-muted-text)', fontWeight: 750 }}>No products yet. Harvest crops or collect from animals.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {inventory.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 8,
                alignItems: 'center',
                padding: 8,
                borderRadius: 12,
                background: 'var(--farm-inventory-row-bg)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--text-primary)' }}>
                  {PRODUCT_ICONS[item.id] || ''} {item.name} x{item.quantity}
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 18,
                  fontSize: 10,
                  color: 'var(--farm-muted-text)',
                  fontWeight: 800,
                  marginTop: 2,
                }}>
                  <span>{item.category === 'vegetable' ? 'Veg value' : 'Animal value'}: {item.value} each</span>
                  <span>Sell: {item.sellPrice} {COIN_SYMBOL} each</span>
                </div>
              </div>
              <FarmButton
                disabled={busyKey === `sell:${item.id}`}
                onClick={() => onAction(() => api.sellFarmInventory(item.id, 1), `sell:${item.id}`)}
              >
                Sell 1
              </FarmButton>
              <FarmButton
                disabled={busyKey === `sell:${item.id}`}
                onClick={() => onAction(() => api.sellFarmInventory(item.id, item.quantity), `sell:${item.id}`)}
              >
                All · {item.totalSellPrice} {COIN_SYMBOL}
              </FarmButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FarmGuidePanel({ catalog }) {
  const crops = catalog?.crops || [];
  const animals = catalog?.animals || [];
  const recipes = catalog?.fridgeRecipes || [];
  const sectionStyle = {
    borderRadius: 16,
    padding: 12,
    background: 'var(--farm-guide-section-bg)',
    border: '1px solid var(--farm-panel-border)',
  };
  const titleStyle = { fontSize: 14, fontWeight: 950, color: 'var(--text-primary)', marginBottom: 6 };
  const textStyle = { fontSize: 12, lineHeight: 1.45, color: 'var(--farm-muted-text)', fontWeight: 760 };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 1000, color: 'var(--text-primary)' }}>Farm Guide</div>
        <div style={textStyle}>Grow products, sell them for coins, turn them into Fridge days, or feed your family.</div>
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>How slots work</div>
        <div style={textStyle}>
          Your Farm has 9 slots. Build a Plot for crops or a Pen for animals. Empty plots can plant seeds. Empty pens can buy animals.
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>Crops and watering</div>
        <div style={textStyle}>
          Crops grow while you are away. Watering is available right after planting, then once every 6 hours. Each watering cuts the remaining grow time by 10%.
        </div>
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {crops.map((crop) => (
            <div key={crop.id} style={textStyle}>
              {(CROP_ICONS[crop.id] || '')} {crop.name}: seeds {crop.seedCost} {COIN_SYMBOL}, grows in {formatTime(crop.growSeconds)}, yields {crop.yieldQuantity}.
            </div>
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>Animals</div>
        <div style={textStyle}>
          Animals live for 7 days. Feed them to start production; if they are not fed, they simply wait and do not die early.
        </div>
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {animals.map((animal) => (
            <div key={animal.id} style={textStyle}>
              {(ANIMAL_ICONS[animal.id] || '')} {animal.name}: buy {animal.buyCost} {COIN_SYMBOL}, feed {animal.feedCost} {COIN_SYMBOL}, ready in {formatTime(animal.intervalSeconds)}.
            </div>
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>Inventory and Food Stock</div>
        <div style={textStyle}>
          Harvested products go to Inventory. You can sell them for coins, use both vegetable value and animal value for Fridge stock, or serve a Family Big Feast.
        </div>
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {recipes.map((recipe) => (
            <div key={recipe.type} style={textStyle}>
              {recipe.label}: {recipe.vegetableValue} veg value + {recipe.animalValue} animal value.
            </div>
          ))}
        </div>
        <div style={{ ...textStyle, marginTop: 8 }}>
          Family Big Feast costs 750 veg value + 250 animal value and feeds living family Peepers without coins or cooldown.
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={titleStyle}>Rebuild safely</div>
        <div style={textStyle}>
          Rebuild mode lets you replace a Plot with a Pen, or a Pen with a Plot. Rebuilding deletes whatever is currently in that slot, so it always asks for confirmation first.
        </div>
      </div>
    </div>
  );
}

function RebuildConfirmPanel({ slot, catalog, coins, busyKey, onCancel, onConfirm }) {
  const costs = catalog?.slotBuildCosts || {};
  const isBusy = busyKey === `slot:${slot?.index}`;
  const slotName = slot?.type === 'plot' ? 'Plot' : slot?.type === 'pen' ? 'Pen' : 'Slot';
  const warning = slot?.state === 'crop_ready'
    ? 'A ready harvest will be lost.'
    : slot?.state === 'crop_growing'
      ? 'The growing crop and its timer will be lost.'
      : slot?.state === 'animal_ready'
        ? 'The ready animal product will be lost.'
        : slot?.state === 'animal_producing'
          ? 'The animal and current production timer will be lost.'
          : slot?.state === 'animal_hungry'
            ? 'The animal will be removed.'
            : 'This slot will be replaced.';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 1000, color: 'var(--text-primary)' }}>Rebuild {slotName}</div>
        <div style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--farm-muted-text)', fontWeight: 760, marginTop: 4 }}>
          {warning} This cannot be undone and there is no refund for seeds, animals, or progress.
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <FarmButton
          variant="primary"
          disabled={isBusy || coins < (costs.plot || 0)}
          onClick={() => onConfirm('plot')}
          style={{ minHeight: 44, fontSize: 13 }}
        >
          Rebuild as Plot {costs.plot} {COIN_SYMBOL}
        </FarmButton>
        <FarmButton
          variant="primary"
          disabled={isBusy || coins < (costs.pen || 0)}
          onClick={() => onConfirm('pen')}
          style={{ minHeight: 44, fontSize: 13 }}
        >
          Rebuild as Pen {costs.pen} {COIN_SYMBOL}
        </FarmButton>
      </div>
      <FarmButton onClick={onCancel} disabled={isBusy} style={{ minHeight: 42 }}>Cancel</FarmButton>
    </div>
  );
}

export default function FarmScreen({ onClose, onStateChange, showToast }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [activeSheet, setActiveSheet] = useState(null);
  const [rebuildMode, setRebuildMode] = useState(false);
  const [rebuildSlot, setRebuildSlot] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [retiringSlots, setRetiringSlots] = useState({});
  const [nowMs, setNowMs] = useState(Date.now());
  const retirementTimersRef = useRef(new Map());

  const nowSeconds = Math.floor(nowMs / 1000);
  const coins = state?.coins ?? 0;
  const farmOwned = Boolean(state?.farmState?.farm?.owned);
  const farm = state?.farmState?.farm;
  const catalog = state?.farmState?.catalog || {};
  const slots = state?.farmState?.slots || [];

  const loadFarm = useCallback(async () => {
    const result = await api.getFarmState();
    setState(result);
    return result;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadFarm()
      .catch((error) => showToast?.(error.message || 'Could not load Farm'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [loadFarm, showToast]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => {
    for (const timer of retirementTimersRef.current.values()) window.clearTimeout(timer);
    retirementTimersRef.current.clear();
  }, []);

  const handleAction = useCallback(async (action, key = 'farm') => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      const result = await action();
      setState(result);
      showToast?.(result.message || 'Farm updated');
      onStateChange?.(result);
      return result;
    } catch (error) {
      const next = error?.data?.farmState ? error.data : null;
      if (next) setState(next);
      showToast?.(error.message || 'Farm action failed');
      return null;
    } finally {
      setBusyKey(null);
    }
  }, [busyKey, onStateChange, showToast]);

  const beginRetirementTransition = useCallback((previousSlot) => {
    const slotIndex = previousSlot.index;
    const existingTimer = retirementTimersRef.current.get(slotIndex);
    if (existingTimer) window.clearTimeout(existingTimer);

    setRetiringSlots((current) => ({
      ...current,
      [slotIndex]: { previousSlot },
    }));

    const timer = window.setTimeout(() => {
      retirementTimersRef.current.delete(slotIndex);
      setRetiringSlots((current) => {
        const next = { ...current };
        delete next[slotIndex];
        return next;
      });
    }, FARM_RETIREMENT_LOCK_MS);
    retirementTimersRef.current.set(slotIndex, timer);
  }, []);

  const handleSlotAction = useCallback(async (action, key = 'farm') => {
    const previousSlot = selectedSlot;
    const result = await handleAction(action, key);
    if (!result || !previousSlot) return result;

    const updatedSlot = result.farmState?.slots?.find((slot) => slot.index === previousSlot.index);
    const postAction = getFarmSlotPostAction(previousSlot, updatedSlot);
    if (postAction.retirementTransition) beginRetirementTransition(previousSlot);
    if (!postAction.keepOpen) {
      setSelectedSlot(null);
      setActiveSheet(null);
    }
    return result;
  }, [beginRetirementTransition, handleAction, selectedSlot]);

  const handleRebuildConfirm = useCallback((type) => {
    if (!rebuildSlot) return;
    const slotIndex = rebuildSlot.index;
    handleAction(
      () => api.buildFarmSlot(slotIndex, type, { rebuild: true }),
      `slot:${slotIndex}`,
    ).then((result) => {
      if (!result) return;
      setRebuildSlot(null);
      setRebuildMode(false);
    });
  }, [handleAction, rebuildSlot]);

  const handleSelectSlot = useCallback((slot) => {
    if (rebuildMode && slot?.type) {
      setSelectedSlot(null);
      setActiveSheet(null);
      setRebuildSlot(slot);
      return;
    }
    setRebuildSlot(null);
    setSelectedSlot(slot);
    setActiveSheet('slot');
  }, [rebuildMode]);

  const slotGrid = useMemo(() => {
    const normalized = [...slots];
    while (normalized.length < 9) {
      normalized.push({ index: normalized.length, type: null, state: 'unbuilt' });
    }
    return normalized;
  }, [slots]);

  const fitSignature = [
    loading,
    farmOwned,
    farm?.builtSlots,
    coins,
    busyKey,
    rebuildMode,
    activeSheet,
    slotGrid.map((slot) => `${slot.type || 'none'}:${slot.state || 'none'}:${slot.readyAt || 0}:${slot.waterAvailableAt || 0}`).join('|'),
  ].join('|');
  const { viewportRef, layoutRef, scale, height: fittedHeight, availableHeight } = useFarmFit(fitSignature);
  const measuredFarmHeight = availableHeight > 0
    ? availableHeight
    : (typeof window === 'undefined' ? 720 : window.innerHeight);
  const compactFarm = measuredFarmHeight < 720;
  const tinyFarm = measuredFarmHeight < 660;
  const microFarm = measuredFarmHeight < 600;
  const layoutGap = microFarm ? 6 : tinyFarm ? 7 : compactFarm ? 9 : 12;

  return (
    <div
      className="farm-screen-shell"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 170,
        paddingTop: 'var(--tg-total-top)',
        boxSizing: 'border-box',
        background: 'var(--farm-screen-bg)',
        backgroundSize: 'auto, auto, cover, auto',
        backgroundPosition: 'center top, center top, center center, center top',
        backgroundRepeat: 'no-repeat',
        color: 'var(--text-primary)',
        overflow: 'hidden',
        animation: 'slide-up 0.22s ease',
      }}
    >
      <div
        ref={viewportRef}
        style={{
          height: '100%',
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '10px 10px calc(var(--tg-safe-bottom) + 10px)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ width: 'min(100%, 620px)', height: fittedHeight || undefined, position: 'relative', flexShrink: 0 }}>
          <div
            ref={layoutRef}
            style={{
              width: '100%',
              transform: `scale(${scale})`,
              transformOrigin: 'top center',
              display: 'grid',
              gap: layoutGap,
              '--farm-button-min-height': microFarm ? '28px' : tinyFarm ? '30px' : compactFarm ? '32px' : '36px',
              '--farm-button-padding': microFarm ? '5px 6px' : tinyFarm ? '6px 7px' : compactFarm ? '7px 8px' : '8px 10px',
              '--farm-button-font-size': microFarm ? '10px' : tinyFarm ? '10.5px' : compactFarm ? '11px' : '12px',
              '--farm-slot-min-height': microFarm ? '112px' : tinyFarm ? '122px' : compactFarm ? '136px' : '156px',
              '--farm-slot-padding': microFarm ? '6px' : tinyFarm ? '7px' : compactFarm ? '8px' : '10px',
              '--farm-slot-gap': microFarm ? '4px' : tinyFarm ? '5px' : compactFarm ? '6px' : '8px',
              '--farm-slot-icon-size': microFarm ? '27px' : tinyFarm ? '31px' : compactFarm ? '36px' : '42px',
            }}
          >
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: microFarm ? 7 : 12 }}>
          <FarmButton onClick={onClose} className="app-back-button">Back</FarmButton>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: microFarm ? 20 : 24, fontWeight: 1000, letterSpacing: '-0.04em' }}>Farm</div>
            <div style={{ fontSize: microFarm ? 10 : 11, color: 'var(--farm-header-subtitle)', fontWeight: 800 }}>
              Grow food, sell products, stock food
            </div>
          </div>
          <div className="coins-badge" style={{ minWidth: 74, justifyContent: 'center' }}>{COIN_SYMBOL} {coins}</div>
        </div>

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', fontWeight: 900 }}>Loading Farm...</div>
        ) : !farmOwned ? (
          <div
            style={{
              borderRadius: 24,
              padding: 20,
              background: 'var(--farm-panel-bg)',
              border: '1px solid var(--farm-panel-border)',
              boxShadow: 'var(--farm-card-shadow)',
            }}
          >
            <div style={{ fontSize: 44, lineHeight: 1, marginBottom: 8 }}>{FARM_ICON}</div>
            <div style={{ fontSize: 22, fontWeight: 1000, marginBottom: 6 }}>Buy Farm</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45, marginBottom: 16 }}>
              A permanent 3x3 farm. Build plots and pens, grow products, then sell them or turn them into Fridge days.
            </div>
            <FarmButton
              variant="primary"
              disabled={busyKey === 'buy' || coins < (farm?.purchaseCost || 1000)}
              onClick={() => handleAction(api.buyFarm, 'buy')}
              style={{ width: '100%', minHeight: 46, fontSize: 15 }}
            >
              Buy Farm · {farm?.purchaseCost || 1000} {COIN_SYMBOL}
            </FarmButton>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: layoutGap }}>
            <div
              style={{
                borderRadius: 18,
                padding: microFarm ? 7 : tinyFarm ? 8 : compactFarm ? 10 : 12,
                background: 'var(--farm-panel-soft-bg)',
                border: '1px solid var(--farm-panel-border)',
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) auto',
                alignItems: 'center',
                gap: microFarm ? 5 : tinyFarm ? 6 : 10,
              }}
            >
              <div>
                <div style={{ fontSize: 15, fontWeight: 950 }}>Farm ready</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Built slots: {farm?.builtSlots || 0}/{farm?.slotCount || 9}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: microFarm ? 4 : tinyFarm ? 4 : 6 }}>
                <FarmButton onClick={() => {
                  setSelectedSlot(null);
                  setActiveSheet('guide');
                }}>Guide</FarmButton>
                <FarmButton
                  variant={rebuildMode ? 'primary' : 'secondary'}
                  onClick={() => {
                    setRebuildMode((value) => !value);
                    setRebuildSlot(null);
                    setSelectedSlot(null);
                    setActiveSheet(null);
                  }}
                >
                  Rebuild
                </FarmButton>
              </div>
            </div>

            <IsoFarmBoard
              slots={slotGrid}
              rebuildMode={rebuildMode}
              selectedSlot={selectedSlot}
              catalog={catalog}
              coins={coins}
              nowSeconds={nowSeconds}
              busyKey={busyKey}
              onAction={handleSlotAction}
              onSelectSlot={handleSelectSlot}
              retiringSlots={retiringSlots}
              onClosePopover={() => {
                setSelectedSlot(null);
                setActiveSheet(null);
              }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: microFarm ? 5 : tinyFarm ? 6 : 8 }}>
              <FarmButton
                variant="primary"
                onClick={() => {
                  setSelectedSlot(null);
                  setActiveSheet('inventory');
                }}
                style={{
                  minHeight: microFarm ? 34 : tinyFarm ? 38 : compactFarm ? 42 : 48,
                  fontSize: microFarm ? 11.5 : tinyFarm ? 12 : compactFarm ? 13 : 14,
                }}
              >
                Inventory
              </FarmButton>
              <FarmButton
                variant="primary"
                onClick={() => {
                  setSelectedSlot(null);
                  setActiveSheet('fridge');
                }}
                style={{
                  minHeight: microFarm ? 34 : tinyFarm ? 38 : compactFarm ? 42 : 48,
                  fontSize: microFarm ? 11.5 : tinyFarm ? 12 : compactFarm ? 13 : 14,
                }}
              >
                Food Stock
              </FarmButton>
            </div>
          </div>
        )}
          </div>
        </div>
      </div>
      {((activeSheet && activeSheet !== 'slot') || rebuildSlot) && (
        <BottomSheet
          onClose={() => {
            setActiveSheet(null);
            setRebuildSlot(null);
            setSelectedSlot(null);
          }}
          zIndex={360}
          bodyStyle={{
            maxHeight: 'calc(100dvh - var(--tg-total-top) - 18px)',
            overflowY: 'auto',
            padding: '18px',
          }}
        >
          {rebuildSlot ? (
            <RebuildConfirmPanel
              slot={rebuildSlot}
              catalog={catalog}
              coins={coins}
              busyKey={busyKey}
              onCancel={() => setRebuildSlot(null)}
              onConfirm={handleRebuildConfirm}
            />
          ) : activeSheet === 'guide' ? (
            <FarmGuidePanel catalog={catalog} />
          ) : (
            <InventoryPanel
              mode={activeSheet === 'fridge' ? 'fridge' : 'inventory'}
              state={state?.farmState ? { ...state.farmState, fridge: state.fridge, family: state.family } : null}
              coins={coins}
              busyKey={busyKey}
              onAction={handleAction}
            />
          )}
        </BottomSheet>
      )}
    </div>
  );
}
