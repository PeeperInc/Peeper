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
  knight_shield: { label: 'Knight shield ready', tone: 'shield' },
  bend_fate: { label: 'Bend Fate ready', tone: 'fate' },
  team_knight: { label: 'Thorn Guard waiting', tone: 'shield' },
  team_mage: { label: 'Arcane Link waiting', tone: 'fate' },
});

export default function RoomEffectsBar({ effects = [], sharedBuffs = {}, className = '' }) {
  const queuedEffects = Object.entries(sharedBuffs?.teamAbilities || {}).flatMap(([role, queue]) => (
    Array.isArray(queue) ? queue.map((entry, index) => ({
      id: `team-${role}-${entry.createdAt || index}-${index}`,
      effectType: `team_${role}`,
      placedBy: entry.placedBy,
    })) : []
  ));
  const visibleEffects = [...(Array.isArray(effects) ? effects : []), ...queuedEffects]
    .filter(isActiveEffect)
    .map(effect => ({ effect, copy: EFFECT_COPY[effectIdentity(effect)] }))
    .filter(entry => entry.copy);

  if (visibleEffects.length === 0) return null;

  return (
    <aside className={`expedition-room-effects-bar ${className}`.trim()} aria-label="Active team abilities">
      {visibleEffects.map(({ effect, copy }, index) => {
        const id = readField(effect, 'id', 'effectId', 'effect_id') || `${effectIdentity(effect)}-${index}`;
        const knight = ['knight_shield', 'team_knight'].includes(effectIdentity(effect));
        return (
          <div className={`expedition-room-effect is-${copy.tone}`} key={id}>
            <span className="expedition-room-effect-icon" aria-hidden="true">{knight ? '\uD83D\uDEE1\uFE0F' : '\u2726'}</span>
            <span className="expedition-room-effect-copy">
              <strong>{copy.label}</strong>
              <small>Placed by {effectOwner(effect)} · next ally</small>
            </span>
            <i aria-hidden="true" />
          </div>
        );
      })}
    </aside>
  );
}
