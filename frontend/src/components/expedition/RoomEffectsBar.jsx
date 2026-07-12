import React from 'react';
import './ExpeditionCombatFx.css';

function readField(value, ...keys) {
  for (const key of keys) {
    if (value?.[key] !== undefined && value?.[key] !== null) return value[key];
  }
  return undefined;
}

function isActiveEffect(effect) {
  const consumedAt = readField(effect, 'consumedAt', 'consumed_at');
  const remainingUses = Number(readField(effect, 'remainingUses', 'remaining_uses') ?? 1);
  return Boolean(effect)
    && consumedAt === undefined
    && readField(effect, 'active', 'isActive', 'is_active') !== false
    && remainingUses > 0;
}

function effectIdentity(effect) {
  return String(readField(effect, 'effectType', 'effect_type', 'type') || '').toLowerCase();
}

function effectOwner(effect) {
  const owner = readField(effect, 'placedBy', 'placed_by', 'owner') || {};
  if (typeof owner === 'string') return owner;
  return readField(owner, 'firstName', 'first_name', 'username', 'name')
    || readField(effect, 'placedByName', 'placed_by_name')
    || 'family member';
}

const EFFECT_COPY = Object.freeze({
  knight_shield: { icon: '🛡️', label: 'Knight shield ready', tone: 'shield' },
  bend_fate: { icon: '🎲', label: 'Bend Fate ready', tone: 'fate' },
});

export default function RoomEffectsBar({ effects = [], className = '' }) {
  const visibleEffects = (Array.isArray(effects) ? effects : [])
    .filter(isActiveEffect)
    .map(effect => ({ effect, copy: EFFECT_COPY[effectIdentity(effect)] }))
    .filter(entry => entry.copy);

  if (visibleEffects.length === 0) return null;

  return (
    <aside
      className={`expedition-room-effects-bar ${className}`.trim()}
      aria-label="Active room effects"
    >
      {visibleEffects.map(({ effect, copy }, index) => {
        const id = readField(effect, 'id', 'effectId', 'effect_id')
          || `${effectIdentity(effect)}-${index}`;
        return (
          <div className={`expedition-room-effect is-${copy.tone}`} key={id}>
            <span className="expedition-room-effect-icon" aria-hidden="true">{copy.icon}</span>
            <span className="expedition-room-effect-copy">
              <strong>{copy.label}</strong>
              <small>Placed by {effectOwner(effect)}</small>
            </span>
            <i aria-hidden="true" />
          </div>
        );
      })}
    </aside>
  );
}
