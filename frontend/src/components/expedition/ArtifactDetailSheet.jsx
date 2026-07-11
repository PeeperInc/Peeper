import React from 'react';
import BottomSheet from '../BottomSheet';
import './ExpeditionSheets.css';

const MODE_COPY = {
  take: {
    eyebrow: 'Expedition loadout',
    title: 'Take artifact',
    confirm: 'Take artifact',
  },
  use: {
    eyebrow: 'Active artifact',
    title: 'Use artifact',
    confirm: 'Use artifact',
  },
  inspect: {
    eyebrow: 'Relic archive',
    title: 'Artifact details',
    confirm: 'Close',
  },
};

const USE_TYPE_COPY = {
  active: 'Active',
  expedition_passive: 'Expedition passive',
};

function formatEffectValue(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value == null) return 'None';
  return String(value).replaceAll('_', ' ');
}

function EffectProtocol({ effect }) {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return null;
  const entries = Object.entries(effect);
  if (!entries.length) return null;

  return (
    <dl className="expedition-sheet-protocol" aria-label="Exact artifact effect data">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key.replaceAll('_', ' ')}</dt>
          <dd>{formatEffectValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ArtifactDetailSheet({
  artifact,
  mode,
  disabledReason,
  onConfirm,
  onClose,
}) {
  if (!artifact) return null;

  const copy = MODE_COPY[mode] || MODE_COPY.inspect;
  const isInspect = mode === 'inspect';
  const useType = artifact.useType || artifact.use_type || 'active';
  const rarity = String(artifact.rarity || 'common').toLowerCase();
  const quantity = Math.max(0, Number(artifact.quantity ?? artifact.ownedQuantity ?? 0));
  const image = artifact.image || artifact.imageUrl || artifact.image_url || artifact.icon;
  const effectText = artifact.displayEffect || artifact.display_effect
    || (typeof artifact.effect === 'string' ? artifact.effect : 'Effect data unavailable.');
  const consumption = useType === 'active'
    ? 'Consumed immediately when used.'
    : 'Equipped for the expedition and consumed when it ends.';

  const handlePrimary = () => {
    if (isInspect) {
      onClose?.();
      return;
    }
    onConfirm?.(artifact);
  };

  return (
    <BottomSheet
      onClose={onClose}
      bodyClassName="sheet-body expedition-sheet-body"
      backdropClassName="sheet-backdrop expedition-sheet-backdrop"
    >
      <section className={`expedition-artifact-sheet rarity-${rarity}`}>
        <header className="expedition-sheet-header">
          <div>
            <span className="expedition-sheet-eyebrow">{copy.eyebrow}</span>
            <h2>{copy.title}</h2>
          </div>
          <button className="expedition-sheet-close" type="button" onClick={onClose} aria-label="Close">
            X
          </button>
        </header>

        <div className="expedition-artifact-hero">
          <div className="expedition-artifact-image" aria-hidden="true">
            {image ? <img src={image} alt="" /> : <span>R</span>}
          </div>
          <div className="expedition-artifact-identity">
            <div className="expedition-artifact-meta">
              <span className={`expedition-rarity-chip rarity-${rarity}`}>{rarity}</span>
              <span className="expedition-type-chip">{USE_TYPE_COPY[useType] || useType.replaceAll('_', ' ')}</span>
            </div>
            <h3>{artifact.name || artifact.id || 'Unknown artifact'}</h3>
            <p className="expedition-artifact-effect">{effectText}</p>
          </div>
        </div>

        <div className="expedition-artifact-facts">
          <div>
            <span>Consumption</span>
            <strong>{consumption}</strong>
          </div>
          <div>
            <span>Owned</span>
            <strong>{quantity}</strong>
          </div>
        </div>

        <EffectProtocol effect={artifact.effect} />

        {disabledReason ? (
          <p className="expedition-sheet-disabled" role="status">{disabledReason}</p>
        ) : null}

        <div className="expedition-sheet-actions">
          {!isInspect ? (
            <button className="expedition-sheet-secondary" type="button" onClick={onClose}>
              Cancel
            </button>
          ) : null}
          <button
            className="expedition-sheet-primary"
            type="button"
            disabled={!isInspect && Boolean(disabledReason)}
            onClick={handlePrimary}
          >
            {copy.confirm}
          </button>
        </div>
      </section>
    </BottomSheet>
  );
}
