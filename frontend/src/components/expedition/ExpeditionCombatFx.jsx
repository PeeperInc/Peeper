import React, { useEffect, useMemo, useRef, useState } from 'react';
import './ExpeditionCombatFx.css';

const FX_DURATION_MS = Object.freeze({
  dice: 1650,
  shield: 1250,
  heal: 1550,
  recovery: 1650,
});

function eventType(event) {
  return String(event?.type || event?.eventType || event?.event_type || '').toLowerCase();
}

function finiteInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function isMageEvent(event) {
  return eventType(event) === 'mage_advantage'
    && Array.isArray(event?.rolls)
    && event.rolls.length === 2
    && event.rolls.every(roll => finiteInteger(roll) !== null);
}

function fxKind(event) {
  const type = eventType(event);
  if (type === 'cleric_heal') return 'heal';
  if (type === 'cleric_recovery_reduced') return 'recovery';
  if (type === 'shield_blocked') return 'shield';
  if (isMageEvent(event)) return 'dice';
  return null;
}

function ownerName(event) {
  const owner = event?.placedBy || event?.placed_by || {};
  if (typeof owner === 'string') return owner;
  return owner.firstName || owner.first_name || owner.username || 'Cleric';
}

function eventIdentity(source, event, index = 0) {
  return `${source}:${index}:${[
    eventType(event),
    event?.id ?? event?.eventId ?? event?.event_id ?? event?.effectId ?? event?.effect_id ?? '',
    Array.isArray(event?.rolls) ? event.rolls.join(',') : '',
    event?.chosen ?? '',
    event?.createdAt ?? event?.created_at ?? '',
  ].join(':')}`;
}

function D20({ value, chosen = false, dimmed = false, index }) {
  return (
    <div
      className={`expedition-fx-d20${chosen ? ' is-chosen' : ''}${dimmed ? ' is-dimmed' : ''}`}
      style={{ '--die-index': index }}
      aria-label={`D20 result ${value}${chosen ? ', chosen' : ''}`}
    >
      <span>D20</span>
      <strong>{value}</strong>
      {chosen && <small>Chosen</small>}
    </div>
  );
}

function MageDiceFx({ event }) {
  const rolls = event.rolls.map(finiteInteger);
  const chosen = finiteInteger(event.chosen);
  const chosenIndex = rolls.findIndex(roll => roll === chosen);
  return (
    <div className="expedition-combat-fx-scene expedition-combat-fx-dice" role="status">
      <div className="expedition-fx-dice-label">Bend Fate</div>
      <div className="expedition-fx-dice-pair">
        {rolls.map((roll, index) => (
          <D20
            key={`${roll}-${index}`}
            value={roll}
            chosen={index === chosenIndex}
            dimmed={chosenIndex >= 0 && index !== chosenIndex}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}

function ShieldFx({ event }) {
  const prevented = finiteInteger(event?.preventedDamage);
  return (
    <div className="expedition-combat-fx-scene expedition-combat-fx-shield" role="status">
      <div className="expedition-fx-shield-aura" aria-hidden="true" />
      <div className="expedition-fx-shield-mark" aria-hidden="true">
        <i /><i /><i />
      </div>
      <div className="expedition-fx-impact-ring" aria-hidden="true" />
      <strong>Blocked</strong>
      {prevented !== null && <small>{prevented} damage prevented</small>}
    </div>
  );
}

function HealParticles() {
  return (
    <div className="expedition-fx-heal-particles" aria-hidden="true">
      {Array.from({ length: 10 }, (_, index) => <i key={index} style={{ '--particle': index }} />)}
    </div>
  );
}

function PersonalEventFx({ event, memberHp }) {
  const type = eventType(event);
  const isRecovery = type === 'cleric_recovery_reduced';
  const amount = finiteInteger(event?.amount);
  const displayedHp = finiteInteger(event?.heroHp) ?? finiteInteger(memberHp);
  const reducedSeconds = finiteInteger(event?.amountSeconds ?? event?.amount_seconds);
  const reducedHours = reducedSeconds === null ? null : Math.max(1, Math.round(reducedSeconds / 3600));

  return (
    <div
      className={`expedition-combat-fx-scene expedition-combat-fx-heal${isRecovery ? ' is-recovery' : ''}`}
      role="status"
    >
      <HealParticles />
      <div className="expedition-fx-heal-sigil" aria-hidden="true"><i /><i /></div>
      {!isRecovery && displayedHp !== null && (
        <div className="expedition-fx-heal-meter" aria-label={`${displayedHp} of 3 health`}>
          <i style={{ '--heal-fill': `${Math.max(0, Math.min(3, displayedHp)) / 3 * 100}%` }} />
        </div>
      )}
      <span>{isRecovery ? 'Recovery hastened' : 'Cleric prayer'}</span>
      <strong>
        {isRecovery ? `-${reducedHours ?? 2}h recovery` : `+${amount ?? 1} HP`}
      </strong>
      <small>
        {isRecovery
          ? (event?.revived ? 'Back on your feet' : `Blessed by ${ownerName(event)}`)
          : `${displayedHp !== null ? `${displayedHp}/3 HP` : 'Wounds restored'} / ${ownerName(event)}`}
      </small>
    </div>
  );
}

/**
 * Visualizes server-authored expedition outcomes. onComplete receives
 * { source, event, eventId, memberHp } after the current FX finishes.
 */
export default function ExpeditionCombatFx({
  visualEvents = [],
  personalEvent = null,
  memberHp = null,
  onComplete,
  onSequenceComplete,
  className = '',
}) {
  const items = useMemo(() => {
    const personalKind = fxKind(personalEvent);
    if (['heal', 'recovery'].includes(personalKind)) {
      return [{ source: 'personal', event: personalEvent, kind: personalKind }];
    }
    return (Array.isArray(visualEvents) ? visualEvents : [])
      .map(event => ({ source: 'visual', event, kind: fxKind(event) }))
      .filter(item => ['dice', 'shield'].includes(item.kind));
  }, [personalEvent, visualEvents]);
  const sequenceId = items
    .map((item, index) => eventIdentity(item.source, item.event, index))
    .join('|');
  const [playback, setPlayback] = useState({ sequenceId: '', index: 0 });
  const activeIndex = playback.sequenceId === sequenceId ? playback.index : 0;
  const activeItem = items[activeIndex] || null;
  const onCompleteRef = useRef(onComplete);
  const onSequenceCompleteRef = useRef(onSequenceComplete);
  const activeItemRef = useRef(activeItem);
  const memberHpRef = useRef(memberHp);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    onSequenceCompleteRef.current = onSequenceComplete;
  }, [onSequenceComplete]);

  useEffect(() => {
    activeItemRef.current = activeItem;
  }, [activeItem]);

  useEffect(() => {
    memberHpRef.current = memberHp;
  }, [memberHp]);

  useEffect(() => {
    setPlayback(current => (
      current.sequenceId === sequenceId ? current : { sequenceId, index: 0 }
    ));
  }, [sequenceId]);

  useEffect(() => {
    if (!activeItem?.kind || !sequenceId) return undefined;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => {
      const finishedItem = activeItemRef.current;
      onCompleteRef.current?.({
        source: finishedItem.source,
        event: finishedItem.event,
        eventId: finishedItem.event?.id
          ?? finishedItem.event?.eventId
          ?? finishedItem.event?.event_id
          ?? null,
        memberHp: finiteInteger(memberHpRef.current),
      });
      if (activeIndex >= items.length - 1) onSequenceCompleteRef.current?.();
      setPlayback(current => (
        current.sequenceId === sequenceId
          ? { ...current, index: current.index + 1 }
          : current
      ));
    }, reducedMotion ? 420 : FX_DURATION_MS[activeItem.kind]);
    return () => window.clearTimeout(timer);
  }, [activeIndex, activeItem?.kind, items.length, sequenceId]);

  if (!activeItem) return null;

  return (
    <div
      className={`expedition-combat-fx ${className}`.trim()}
      data-fx-key={`${sequenceId}:${activeIndex}`}
      aria-live="polite"
    >
      {['heal', 'recovery'].includes(activeItem.kind) && (
        <PersonalEventFx event={activeItem.event} memberHp={memberHp} />
      )}
      {activeItem.kind === 'shield' && <ShieldFx event={activeItem.event} />}
      {activeItem.kind === 'dice' && <MageDiceFx event={activeItem.event} />}
    </div>
  );
}
