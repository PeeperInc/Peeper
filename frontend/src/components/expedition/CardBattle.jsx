import React, { useState } from 'react';
import PeeperSprite from '../PeeperSprite';
import './CardBattle.css';

const PATHS = {
  sword: 'M10 38 35 8l5 1 1 5-26 30m-6-9 11 10m-5-2-8 9',
  dagger: 'M13 38 34 12l2 12-16 20m-11-9 15 11m-7-4-7 9',
  shield: 'M24 7 41 13v13c0 11-17 20-17 20S7 37 7 26V13Zm-8 17 6 6 11-13',
  tower: 'M11 44V12h7v7h6v-7h7v7h6v-7h6v32ZM24 44V33h8v11',
  banner: 'M13 46V7m0 3h27l-8 9 8 9H13',
  eye: 'M4 26S12 13 25 13s21 13 21 13-8 13-21 13S4 26 4 26Zm28 0a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  wind: 'M6 18h28c10 0 9-12 2-11M6 26h35c10 0 8 13 1 12M6 34h15c10 0 8 12 2 11',
  bolt: 'm29 5-18 24h13l-4 19 22-29H28Z',
  flame: 'M27 5c3 15 16 17 16 29a17 17 0 0 1-34 0c0-9 8-15 8-15s-1 12 5 11c6-1 5-25 5-25Z',
  sun: 'M25 14a11 11 0 1 1 0 22 11 11 0 0 1 0-22Zm0-11v6m0 32v6M3 25h6m32 0h6M9 9l5 5m22 22 5 5M9 41l5-5m22-22 5-5',
  heart: 'M25 43S5 31 5 18C5 7 20 4 25 15 30 4 45 7 45 18c0 13-20 25-20 25Zm-10-18h7v-7h6v7h7v6h-7v7h-6v-7h-7',
  crystal: 'm25 4 15 15-4 22-11 7-11-7-4-22Zm0 0v44M10 19h30',
};

function CardIcon({ name = 'sword', className = '' }) {
  return <svg className={className} viewBox="0 0 50 54" aria-hidden="true"><path d={PATHS[name] || PATHS.sword} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

export default function CardBattle({ room, combat, member, mutating, onCommand, roomArt, enemyArt, onNext }) {
  const [showDeck, setShowDeck] = useState(false);
  const turn = combat.turn;
  const inThisRoom = turn?.roomKey === room.key;
  const intent = inThisRoom ? turn.intent : combat.intents?.[room.key];
  const responseDamage = inThisRoom && turn?.dodge ? 0 : Math.max(0, (intent?.damage || 0) - (inThisRoom ? turn?.weaken || 0 : 0));
  const hp = Math.max(0, room.progressTarget - room.progress);
  const cleared = room.state === 'cleared';
  const recovering = Number(member.heroRecoverAt || 0) > Date.now() / 1000 || member.heroHp <= 0;
  const canRetarget = turn?.targetCleared && !cleared;
  const event = combat.lastEvent;
  const support = combat.supports?.[room.key] || {};
  const call = (operation, payload = {}) => onCommand(operation, { roomKey: room.key, revision: combat.revision, ...payload });
  const resource = member.role === 'knight' ? (turn?.block || 0) : combat.resource;
  const eventText = event?.type === 'card_play' ? (event.damage ? `${event.name} · −${event.damage} HP` : `${event.name}${event.healed ? ' · +1 HP' : ''}`)
    : event?.type === 'card_end' ? `${event.damage ? `Enemy dealt ${event.damage} damage` : 'Enemy attack blocked'}${event.overheated ? ' · Overheated: −1 HP' : ''}`
      : event?.type === 'card_draw' ? 'Your move. Play cards, then end your turn.' : '';

  return (
    <section className={`card-battle class-${member.role}`} aria-label="Card battle">
      <div className="card-battle-heading">
        <div><small>{combat.class.name.toUpperCase()} · {room.type === 'boss' ? `BOSS PHASE ${room.phase || 1}/3` : 'FAMILY ENCOUNTER'}</small><h3>{room.name}</h3></div>
        <button type="button" className="card-deck-toggle" onClick={() => setShowDeck(value => !value)} aria-expanded={showDeck}>Deck <b>{combat.deckSize}</b></button>
      </div>
      <div className={`card-arena${cleared ? ' is-cleared' : ''}${event?.type === 'card_play' ? ' has-strike' : ''}`}>
        {roomArt && <img className="card-arena-bg" src={roomArt} alt="" />}
        <div className="card-enemy-health"><span>Shared enemy HP</span><strong>{hp} <small>/ {room.progressTarget}</small></strong><i><b style={{ width: `${hp / room.progressTarget * 100}%` }} /></i></div>
        {enemyArt ? <img key={`${room.key}-${event?.revision || 0}`} className={`card-arena-enemy${event?.damage ? ' taking-hit' : ''}`} src={enemyArt} alt={room.name} /> : <CardIcon className="card-enemy-placeholder" name="crystal" />}
        <div key={`hero-${event?.revision || 0}`} className={`card-arena-hero${event?.type === 'card_play' ? ' attacking' : ''}${event?.type === 'card_end' && event.damage ? ' hurt' : ''}`}><PeeperSprite peeper={combat.hero || { alive: true }} size={160} /></div>
        {event?.type === 'card_play' && event.damage > 0 && <div key={event.revision} className="card-hit-number">−{event.damage}</div>}
        {cleared ? <div className="card-enemy-intent is-safe">Enemy defeated · the family moves forward</div>
          : <div className={`card-enemy-intent${responseDamage > 1 ? ' is-danger' : ''}`}><CardIcon name={intent?.kind === 'drain' ? 'heart' : 'sword'} /><span>{intent?.label || 'Enemy waiting'}<small>{intent ? `${responseDamage} damage on end${intent.kind === 'drain' ? ' · heals if unblocked' : ''}` : 'Finish your saved turn first'}</small></span></div>}
      </div>
      {(support.expose > 0 || support.ward?.charges > 0) && <div className="card-family-support">{support.expose > 0 && <span>Exposed · next {support.expose} hits +2</span>}{support.ward?.charges > 0 && <span>Ally ward ready</span>}</div>}
      <div className="card-turn-status">
        <span><b>{turn?.energy || 0}</b> / {combat.energyPerTurn} energy</span>
        <span className={member.role === 'mage' && resource >= 4 ? 'is-danger' : ''}>{combat.class.resource} <b>{resource}</b>{member.role === 'mage' && resource >= 4 ? ' · −1 HP on end' : ''}</span>
        {turn?.dodge && <span>Dodge ready</span>}
        {turn && <span className="card-saved-tag">{turn.hand.length} cards · saved</span>}
      </div>
      <p className="card-battle-feedback" role="status" aria-live="polite">{eventText || combat.class.description}</p>

      {turn && inThisRoom && !cleared && (
        <div className="card-hand" aria-label="Your hand">
          {turn.hand.map(card => {
            const unavailable = mutating || card.cost > turn.energy || recovering || (card.effect === 'mend' && (resource < 2 || member.heroHp >= 3));
            return <button type="button" key={card.instanceId} className={`dungeon-playing-card kind-${card.kind}`} disabled={unavailable}
              onClick={() => call('play', { instanceId: card.instanceId })} aria-label={`${card.name}, ${card.cost} energy. ${card.text}`}>
              <span className="dungeon-card-cost">{card.cost}</span><span className="dungeon-card-kind">{card.kind}</span>
              <CardIcon name={card.icon} className="dungeon-card-art" /><strong>{card.name}</strong><span className="dungeon-card-copy">{card.text}</span>
            </button>;
          })}
          {!turn.hand.length && <p className="card-hand-empty">Hand played. End your turn to resolve the enemy response.</p>}
        </div>
      )}

      {combat.reward && <div className="card-reward-choice"><small>ROOM CLEARED · CHOOSE A CARD FOR THIS EXPEDITION</small><div>
        {combat.reward.cards.map(card => <button type="button" key={card.id} disabled={mutating} onClick={() => onCommand('reward', { revision: combat.revision, roomKey: combat.reward.roomKey, cardId: card.id })}><CardIcon name={card.icon} /><strong>{card.name}</strong><span>{card.cost} energy · {card.text}</span></button>)}
      </div><button type="button" className="card-reward-skip" disabled={mutating} onClick={() => onCommand('reward', { revision: combat.revision, roomKey: combat.reward.roomKey, cardId: 'skip' })}>Skip · keep my deck small</button></div>}

      <div className="card-turn-controls">
        {turn ? <>
          {canRetarget && <button type="button" className="card-primary" disabled={mutating || recovering} onClick={() => call('retarget')}>Continue this hand here · free</button>}
          {(inThisRoom || turn.targetCleared) && <button type="button" className="card-end-turn" disabled={mutating} onClick={() => onCommand('end', { revision: combat.revision, roomKey: turn.roomKey })}>{mutating ? 'Resolving…' : cleared || turn.targetCleared ? 'Finish saved hand' : 'End turn'}<small>{cleared || turn.targetCleared ? 'No enemy response from a defeated foe' : `Enemy response: ${responseDamage} damage · block ${turn.block}`}</small></button>}
          {!inThisRoom && !turn.targetCleared && <p>Finish your saved hand in the previous room.</p>}
        </> : !cleared ? <button type="button" className="card-primary" disabled={mutating || recovering || member.ap < 1} onClick={() => call('draw')}>{recovering ? 'Hero recovering' : member.ap < 1 ? 'Waiting for AP' : 'Draw 4 cards · 1 AP'}<small>3 energy · your enemy only acts when you end the turn</small></button> : <button type="button" className="card-primary" onClick={onNext}>Choose the next room →</button>}
      </div>
      {showDeck && <div className="card-deck-list"><p>{combat.class.description}</p>{combat.deck.map(card => <div key={card.id}><CardIcon name={card.icon} /><strong>{card.name} <small>×{card.copies}</small></strong><span>{card.cost} energy · {card.text}</span></div>)}<button type="button" onClick={() => setShowDeck(false)}>Close deck</button></div>}
    </section>
  );
}
