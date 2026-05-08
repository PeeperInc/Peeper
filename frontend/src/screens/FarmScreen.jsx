import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import BottomSheet from '../components/BottomSheet';

const COIN_SYMBOL = '\u2726';
const FARM_ICON = String.fromCodePoint(0x1F33E);

const PRODUCT_ICONS = {
  carrot: '\uD83E\uDD55',
  tomato: '\uD83C\uDF45',
  potato: '\uD83E\uDD54',
  egg: '\uD83E\uDD5A',
  milk: '\uD83E\uDD5B',
  truffle: String.fromCodePoint(0x1F9C6),
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

function FarmButton({ children, variant = 'secondary', disabled = false, onClick, style }) {
  return (
    <button
      type="button"
      className={`btn btn-${variant}`}
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

function MiniChoiceGrid({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
      {children}
    </div>
  );
}

function FarmSlot({ slot, catalog, coins, nowSeconds, busyKey, rebuildMode = false, onAction, onRebuildRequest }) {
  const busy = busyKey === `slot:${slot.index}`;
  const crops = catalog?.crops || [];
  const animals = catalog?.animals || [];
  const buildCosts = catalog?.slotBuildCosts || {};
  const isRebuildTarget = rebuildMode && Boolean(slot.type);
  const titleStyle = { fontSize: 13, fontWeight: 950, color: 'var(--text-primary)', textAlign: 'center' };
  const metaStyle = { fontSize: 11, color: 'var(--farm-muted-text)', lineHeight: 1.25, fontWeight: 650, textAlign: 'center' };
  const iconStyle = { fontSize: 'var(--farm-slot-icon-size, 42px)', lineHeight: 1, textAlign: 'center', marginBottom: 4 };

  const shellStyle = {
    minHeight: 'var(--farm-slot-min-height, 156px)',
    borderRadius: 16,
    padding: 'var(--farm-slot-padding, 10px)',
    border: isRebuildTarget ? '2px solid rgba(205, 86, 50, 0.74)' : '1px solid rgba(74, 123, 71, 0.24)',
    background: isRebuildTarget
      ? 'var(--farm-slot-rebuild-bg)'
      : 'var(--farm-slot-bg)',
    boxShadow: isRebuildTarget ? '0 12px 28px rgba(159,70,37,0.22)' : 'var(--farm-slot-shadow)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    gap: 'var(--farm-slot-gap, 8px)',
    minWidth: 0,
    textAlign: 'center',
    cursor: isRebuildTarget ? 'pointer' : 'default',
  };
  const rebuildClickProps = isRebuildTarget ? {
    role: 'button',
    tabIndex: 0,
    onClick: () => onRebuildRequest?.(slot),
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onRebuildRequest?.(slot);
      }
    },
  } : {};
  const rebuildHint = (
    <div style={{
      minHeight: 36,
      borderRadius: 10,
      display: 'grid',
      placeItems: 'center',
      padding: '8px 10px',
      background: 'var(--farm-rebuild-hint-bg)',
      color: 'var(--farm-rebuild-hint-text)',
      fontSize: 12,
      fontWeight: 950,
      border: '1px solid rgba(140,54,29,0.22)',
    }}>
      Tap to rebuild
    </div>
  );

  if (!slot.type) {
    return (
      <div style={shellStyle}>
        <div>
          <div style={titleStyle}>Empty slot</div>
          <div style={metaStyle}>Build a plot or an animal pen.</div>
        </div>
        <MiniChoiceGrid>
          <FarmButton
            disabled={busy || coins < (buildCosts.plot || 0)}
            onClick={() => onAction(() => api.buildFarmSlot(slot.index, 'plot'), `slot:${slot.index}`)}
          >
            Plot {buildCosts.plot} {COIN_SYMBOL}
          </FarmButton>
          <FarmButton
            disabled={busy || coins < (buildCosts.pen || 0)}
            onClick={() => onAction(() => api.buildFarmSlot(slot.index, 'pen'), `slot:${slot.index}`)}
          >
            Pen {buildCosts.pen} {COIN_SYMBOL}
          </FarmButton>
        </MiniChoiceGrid>
      </div>
    );
  }

  if (slot.state === 'plot_empty') {
    return (
      <div style={shellStyle} {...rebuildClickProps}>
        <div>
          <div style={titleStyle}>Crop plot</div>
          <div style={metaStyle}>Choose seeds to plant.</div>
        </div>
        {isRebuildTarget ? rebuildHint : (
        <div style={{ display: 'grid', gap: 6 }}>
          {crops.map((crop) => (
            <FarmButton
              key={crop.id}
              disabled={busy || coins < crop.seedCost}
              onClick={() => onAction(() => api.plantFarmCrop(slot.index, crop.id), `slot:${slot.index}`)}
            >
              {CROP_ICONS[crop.id] || ''} {crop.name} {crop.seedCost} {COIN_SYMBOL}
            </FarmButton>
          ))}
        </div>
        )}
      </div>
    );
  }

  if (slot.state === 'crop_growing' || slot.state === 'crop_ready') {
    const crop = slot.crop || {};
    const remaining = remainingFrom(slot.readyAt, nowSeconds);
    const waterRemaining = remainingFrom(slot.waterAvailableAt, nowSeconds);
    return (
      <div
        style={{ ...shellStyle, background: isRebuildTarget ? shellStyle.background : (remaining <= 0 ? 'var(--farm-slot-ready-bg)' : shellStyle.background) }}
        {...rebuildClickProps}
      >
        <div>
          <div style={iconStyle}>{CROP_ICONS[crop.id] || '\uD83C\uDF31'}</div>
          <div style={titleStyle}>{crop.name || 'Crop'}</div>
          <div style={metaStyle}>{remaining <= 0 ? 'Ready to harvest' : `Grows in ${formatTime(remaining)}`}</div>
        </div>
        {isRebuildTarget ? rebuildHint : remaining <= 0 ? (
          <FarmButton
            variant="primary"
            disabled={busy}
            onClick={() => onAction(() => api.harvestFarmSlot(slot.index), `slot:${slot.index}`)}
          >
            Harvest
          </FarmButton>
        ) : (
          <FarmButton
            disabled={busy || waterRemaining > 0}
            onClick={() => onAction(() => api.waterFarmSlot(slot.index), `slot:${slot.index}`)}
          >
            {waterRemaining > 0 ? `Water in ${formatTime(waterRemaining)}` : 'Water -10%'}
          </FarmButton>
        )}
      </div>
    );
  }

  if (slot.state === 'pen_empty') {
    return (
      <div style={shellStyle} {...rebuildClickProps}>
        <div>
          <div style={titleStyle}>Animal pen</div>
          <div style={metaStyle}>Buy an animal. It lives 7 days.</div>
        </div>
        {isRebuildTarget ? rebuildHint : (
        <div style={{ display: 'grid', gap: 6 }}>
          {animals.map((animal) => (
            <FarmButton
              key={animal.id}
              disabled={busy || coins < animal.buyCost}
              onClick={() => onAction(() => api.buyFarmAnimal(slot.index, animal.id), `slot:${slot.index}`)}
            >
              {ANIMAL_ICONS[animal.id] || ''} {animal.name} {animal.buyCost} {COIN_SYMBOL}
            </FarmButton>
          ))}
        </div>
        )}
      </div>
    );
  }

  const animal = slot.animal || {};
  const product = catalog?.products?.find((item) => item.id === animal.productId);
  const produceRemaining = remainingFrom(slot.readyAt, nowSeconds);
  const lifeRemaining = remainingFrom(slot.expiresAt, nowSeconds);

  return (
    <div style={shellStyle} {...rebuildClickProps}>
      <div>
        <div style={iconStyle}>{ANIMAL_ICONS[animal.id] || '\uD83D\uDC3E'}</div>
        <div style={titleStyle}>{animal.name || 'Animal'}</div>
        <div style={metaStyle}>
          {slot.state === 'animal_ready'
            ? `${product?.name || 'Product'} ready`
            : slot.state === 'animal_producing'
              ? `Ready in ${formatTime(produceRemaining)}`
              : 'Hungry'}
        </div>
        <div style={{ ...metaStyle, marginTop: 2 }}>Retires in {formatTime(lifeRemaining)}</div>
      </div>
      {isRebuildTarget ? rebuildHint : slot.state === 'animal_ready' ? (
        <FarmButton
          variant="primary"
          disabled={busy}
          onClick={() => onAction(() => api.collectFarmAnimal(slot.index), `slot:${slot.index}`)}
        >
          Collect
        </FarmButton>
      ) : slot.state === 'animal_producing' ? (
        <FarmButton disabled>{formatTime(produceRemaining)}</FarmButton>
      ) : (
        <FarmButton
          disabled={busy || coins < animal.feedCost}
          onClick={() => onAction(() => api.feedFarmAnimal(slot.index, 'coins'), `slot:${slot.index}`)}
        >
          Feed {animal.feedCost} {COIN_SYMBOL}
        </FarmButton>
      )}
    </div>
  );
}

function InventoryPanel({ mode = 'inventory', state, coins, busyKey, onAction }) {
  const inventory = state?.inventory || [];
  const values = state?.inventoryValues || { vegetable: 0, animal: 0 };
  const recipes = state?.catalog?.fridgeRecipes || [];
  const fridgeOwned = Boolean(state?.fridge?.owned);
  const fridgeActive = Boolean(state?.fridge?.active);
  const fridgeRemaining = Number(state?.fridge?.remainingSeconds || 0);

  if (mode === 'fridge') {
    const ValueProgress = ({ recipe }) => {
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
    };

    return (
      <div style={{
        borderRadius: 18,
        padding: 14,
        background: 'var(--farm-fridge-panel-bg)',
        border: '1px solid rgba(74,163,255,0.22)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 950, color: 'var(--text-primary)' }}>Free Fridge Stock</div>
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
                  <ValueProgress recipe={recipe} />
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
        <div style={textStyle}>Grow products, sell them for coins, or turn them into free Fridge days.</div>
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
        <div style={titleStyle}>Inventory and Fridge Stock</div>
        <div style={textStyle}>
          Harvested products go to Inventory. You can sell them for coins, or use both vegetable value and animal value to make free Fridge stock.
        </div>
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {recipes.map((recipe) => (
            <div key={recipe.type} style={textStyle}>
              {recipe.label}: {recipe.vegetableValue} veg value + {recipe.animalValue} animal value.
            </div>
          ))}
        </div>
        <div style={{ ...textStyle, marginTop: 8 }}>
          Paid Fridge food in the Food menu still works separately. Farm stock is a free alternative if you have enough products.
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
  const [nowMs, setNowMs] = useState(Date.now());

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
          <FarmButton onClick={onClose}>Back</FarmButton>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: microFarm ? 20 : 24, fontWeight: 1000, letterSpacing: '-0.04em' }}>Farm</div>
            <div style={{ fontSize: microFarm ? 10 : 11, color: 'var(--farm-header-subtitle)', fontWeight: 800 }}>
              Grow food, sell products, stock Fridge
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
              A permanent 3x3 farm. Build plots and pens, grow products, then sell them or turn them into free Fridge days.
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
                <FarmButton onClick={() => setActiveSheet('guide')}>Guide</FarmButton>
                <FarmButton
                  variant={rebuildMode ? 'primary' : 'secondary'}
                  onClick={() => {
                    setRebuildMode((value) => !value);
                    setRebuildSlot(null);
                  }}
                >
                  Rebuild
                </FarmButton>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: microFarm ? 4 : tinyFarm ? 5 : compactFarm ? 6 : 8,
              }}
            >
              {slotGrid.map((slot) => (
                <FarmSlot
                  key={slot.index}
                  slot={slot}
                  catalog={catalog}
                  coins={coins}
                  nowSeconds={nowSeconds}
                  busyKey={busyKey}
                  rebuildMode={rebuildMode}
                  onAction={handleAction}
                  onRebuildRequest={setRebuildSlot}
                />
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: microFarm ? 5 : tinyFarm ? 6 : 8 }}>
              <FarmButton
                variant="primary"
                onClick={() => setActiveSheet('inventory')}
                style={{
                  minHeight: microFarm ? 34 : tinyFarm ? 38 : compactFarm ? 42 : 48,
                  fontSize: microFarm ? 11.5 : tinyFarm ? 12 : compactFarm ? 13 : 14,
                }}
              >
                Inventory
              </FarmButton>
              <FarmButton
                variant="primary"
                onClick={() => setActiveSheet('fridge')}
                style={{
                  minHeight: microFarm ? 34 : tinyFarm ? 38 : compactFarm ? 42 : 48,
                  fontSize: microFarm ? 11.5 : tinyFarm ? 12 : compactFarm ? 13 : 14,
                }}
              >
                Fridge Stock
              </FarmButton>
            </div>
          </div>
        )}
          </div>
        </div>
      </div>
      {(activeSheet || rebuildSlot) && (
        <BottomSheet
          onClose={() => {
            setActiveSheet(null);
            setRebuildSlot(null);
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
              state={state?.farmState ? { ...state.farmState, fridge: state.fridge } : null}
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
