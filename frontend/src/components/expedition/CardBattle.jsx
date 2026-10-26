import React, { useEffect, useRef, useState } from 'react';
import PeeperSprite from '../PeeperSprite';
import CardArt, { ClassCrest, CombatGlyph } from './CardArt';
import CardBattleEffects, { cardEffectStyle } from './CardBattleEffects';
import { enableMouseDragScroll } from '../../utils/mouseDragScroll.mjs';
import './CardBattle.css';

const RESOURCE_HINTS = {
  knight: 'Block stops hits. Shield attacks turn it into damage.',
  scout: 'Spend combo on instant or poison finishers before ending the turn.',
  mage: 'Heat powers spells. End at 4+ heat: lose 1 HP.',
  cleric: 'Faith: your first light card each turn grants 1 block.',
};
const RESPONSE_LABELS = {block:'Blocked',weakened:'Weakened to 0',dodge:'Dodged',ally_ward:'Ally ward',
  room_shield:'Shared shield',relic:'Relic protection',enemy_defeated:'Enemy defeated'};
const RESOURCE_GLYPHS = {knight:'shield',scout:'combo',mage:'heat',cleric:'light'};

function EnemyHealth({hp, max}) {
  const width = `${Math.max(0, Math.min(100, hp / max * 100))}%`;
  return <div className="card-enemy-health" aria-label={`Enemy HP ${hp} of ${max}`}>
    <span>SHARED HP</span><strong>{hp}<small> / {max}</small></strong>
    <div className="enemy-health-track" role="progressbar" aria-label="Shared enemy health" aria-valuenow={hp} aria-valuemin={0} aria-valuemax={max}>
      <i className="enemy-health-trail" style={{width}} /><b style={{width}} />
    </div>
  </div>;
}

function PreparedAttack({cleared, intent, forecast, damage, detail, label}) {
  if (cleared) return <div className="card-enemy-intent is-victory"><CombatGlyph name="light" /><span>Defeated<small>The path is open</small></span></div>;
  const protectedHit = damage === 0;
  const rawDamage = forecast?.baseDamage ?? intent?.damage ?? 0;
  const mitigation = [forecast?.blocked ? `${forecast.blocked} blocked` : '',forecast?.weakened ? `${forecast.weakened} weakened` : ''].filter(Boolean).join(' · ');
  const reasonGlyph = {weakened:'wind',dodge:'wind',ally_ward:'shield',room_shield:'shield',relic:'light',enemy_defeated:'light'}[forecast?.reason] || 'shield';
  return <div className={`card-enemy-intent${protectedHit ? ' is-protected' : ' is-danger'}`} aria-label={`Incoming damage ${damage} HP on turn end. ${detail}`} title="Enemy response when you end your turn">
    <div className="intent-route">
      <span className="intent-weapon"><CombatGlyph name={intent?.kind === 'drain' ? 'poison' : 'sword'} /><b>{rawDamage}</b></span>
      <svg className="intent-arrow" viewBox="0 0 32 12" aria-hidden="true"><path d="M1 6h28m-6-5 6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      <span className="intent-outcome"><CombatGlyph name={protectedHit ? 'shield' : 'heart'} /><b>{damage}</b><small>TO YOU</small></span>
    </div>
    <span className="intent-reason"><CombatGlyph name={protectedHit ? reasonGlyph : 'sword'} />{protectedHit ? label : intent?.kind === 'drain' ? 'Drains on hit' : mitigation || 'Unblocked'}</span>
  </div>;
}

function unavailableReason(card, {resource, hp, energy, recovering, mutating}) {
  if (mutating) return 'Resolving';
  if (recovering) return 'Recovering';
  if (card.cost > energy) return 'Need energy';
  if (card.effect === 'mend' && hp >= 3 && !card.block) return 'Full health';
  if (card.effect === 'mend' && resource < (card.lightCost ?? 2)) return `Need ${card.lightCost ?? 2} light`;
  if (card.effect === 'holy_fire' && resource < 2) return 'Need 2 light';
  if (card.effect === 'prepare' && resource < 1) return 'Need 1 combo';
  if (card.effect === 'venom_finisher' && resource < card.comboCost) return 'Need 1 combo';
  if (card.effect === 'offering' && hp < 2) return 'Need 2 HP';
  return '';
}

function CardRow({children, className, scrollRef, ...props}) {
  const localRef = useRef(null);
  const ref = scrollRef || localRef;
  useEffect(() => enableMouseDragScroll(ref.current), [ref]);
  return <div ref={ref} className={className} {...props}>{children}</div>;
}

function PlayingCard({card, role, disabledReason, onPlay, reward = false, finisherBonus}) {
  const bonus = card.damage > 0 && finisherBonus
    ? [finisherBonus.heal ? `+${finisherBonus.heal} HP` : '', finisherBonus.damage ? `+${finisherBonus.damage} damage` : ''].filter(Boolean).join(' · ') : '';
  return <button type="button" className={`dungeon-playing-card kind-${card.kind}`} disabled={Boolean(disabledReason)} onClick={onPlay}
    aria-label={`${card.name}, ${card.cost} energy. ${card.text}${disabledReason ? ` ${disabledReason}.` : ''}`}>
    <span className="dungeon-card-cost">{card.cost}<CombatGlyph name="energy" /></span>
    <span className="dungeon-card-kind">{card.kind}</span>
    <span className="dungeon-card-picture"><CardArt id={card.id} role={card.role || role} /></span>
    <strong>{card.name}</strong><span className="dungeon-card-copy">{card.text}</span>
    <span className={`dungeon-card-foot${bonus ? ' has-relic-bonus' : ''}`}>{disabledReason || bonus || (reward ? 'Add to deck' : 'Tap to play')}</span>
  </button>;
}

export default function CardBattle({ room, combat, member, mutating, onCommand, roomArt, enemyArt, onNext }) {
  const [showDeck, setShowDeck] = useState(false);
  const [library, setLibrary] = useState(false);
  const [showMechanic, setShowMechanic] = useState(false);
  const [effect, setEffect] = useState(null);
  const seenRevision = useRef(combat.lastEvent?.revision);
  const handRef = useRef(null);
  const turn = combat.turn;
  const inThisRoom = turn?.roomKey === room.key;
  const forecast = inThisRoom ? turn.response : null;
  const intent = forecast ? forecast.intent : inThisRoom ? turn.intent : combat.intents?.[room.key];
  const fallbackIncoming = inThisRoom && turn?.dodge ? 0 : Math.max(0, (intent?.damage || 0) - (inThisRoom ? turn?.weaken || 0 : 0));
  const hp = Math.max(0, room.progressTarget - room.progress);
  const cleared = room.state === 'cleared';
  const recovering = Number(member.heroRecoverAt || 0) > Date.now() / 1000 || member.heroHp <= 0;
  const canRetarget = turn?.targetCleared && !cleared;
  const event = combat.lastEvent;
  const support = combat.supports?.[room.key] || {};
  const poisonPower = support.poisonPower?.[member.userId] || 2;
  const call = (operation, payload = {}) => onCommand(operation, { roomKey: room.key, revision: combat.revision, ...payload });
  const resource = member.role === 'knight' ? (turn?.block || 0) : combat.resource;
  const allyWard = support.ward?.charges > 0 && support.ward.owner !== member.userId;
  const poisonKill = support.poison?.[member.userId] > 0 && hp <= poisonPower;
  const damageToHero = forecast?.damage ?? (allyWard || poisonKill ? 0 : Math.max(0, fallbackIncoming - (inThisRoom ? turn.block : 0)));
  const responseDamage = forecast ? forecast.damage : fallbackIncoming;
  const responseLabel = RESPONSE_LABELS[forecast?.reason] || 'Hit blocked';
  const responseDetail = forecast ? responseDamage === 0 ? responseLabel
    : `${forecast.baseDamage} attack${forecast.weakened ? ` − ${forecast.weakened} weaken` : ''}${forecast.blocked ? ` − ${forecast.blocked} block` : ''}`
    : intent?.kind === 'drain' ? 'On turn end · heals if it hits' : 'On your turn end';
  const effectStyle = cardEffectStyle(effect, member.role);
  const eventText = event?.type === 'card_play' ? `${event.name}${event.damage ? ` · ${event.damage} damage` : ''}${event.poisonTurns ? ` · poison ${event.poisonPower} × ${event.poisonTurns}` : ''}${event.healed ? ` · +${event.healed} HP` : ''}${event.selfDamage ? ` · −${event.selfDamage} HP` : ''}${event.faithTriggered ? ' · Faith +1 block' : ''}${event.drawn ? ` · draw ${event.drawn}` : ''}`
    : event?.type === 'card_end' ? `${event.damage ? `−${event.damage} HP` : RESPONSE_LABELS[event.responseReason] || 'Attack blocked'}${event.overheated ? ' · overheat −1 HP' : ''}${event.poisonDamage ? ` · venom ${event.poisonDamage}` : ''}${event.counterDamage ? ` · counter ${event.counterDamage}` : ''}`
      : event?.type === 'card_supply' ? event.detail || 'Supply used.' : turn ? 'Your move. Tap a card to play.' : 'Draw a hand to start your turn.';

  useEffect(() => {
    if (!event || seenRevision.current === event.revision) return;
    seenRevision.current = event.revision;
    if (!['card_play','card_end'].includes(event.type)) { setEffect(null); return; }
    setEffect(event);
    const timer = setTimeout(() => setEffect(null), 1150);
    return () => clearTimeout(timer);
  }, [event?.revision]);
  useEffect(() => { if (handRef.current) handRef.current.scrollLeft = 0; }, [turn?.number, room.key]);
  useEffect(() => {
    if (!showDeck && !showMechanic) return;
    const close = e => { if (e.key === 'Escape') { setShowDeck(false); setShowMechanic(false); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [showDeck, showMechanic]);

  return <section className={`card-battle class-${member.role}`} aria-label="Card battle">
    <div className="card-battle-heading">
      <div className="card-enemy-name"><small>{room.type === 'boss' ? `BOSS · PHASE ${room.phase || 1}/3` : 'FAMILY ENCOUNTER'}</small><h3>{room.name}</h3></div>
      <EnemyHealth hp={hp} max={room.progressTarget} />
    </div>
    <div className={`card-arena${cleared ? ' is-cleared' : ''}${effect ? ` casting-${effectStyle}` : ''}`}>
      {roomArt && <img className="card-arena-bg" src={roomArt} alt="" />}
      {enemyArt ? <img key={`enemy-${effect?.revision || 0}`} className={`card-arena-enemy${effect && (effect.type === 'card_play' && effect.damage || effect.poisonDamage || effect.counterDamage) ? ' taking-hit' : ''}`} src={enemyArt} alt={room.name} /> : <CombatGlyph className="card-enemy-placeholder" name="poison" />}
      <div key={`hero-${effect?.revision || 0}`} className={`card-arena-hero${effect?.type === 'card_play' ? effect.damage ? ' attacking' : ' casting' : ''}${effect?.type === 'card_end' && (effect.damage || effect.overheated) ? ' hurt' : ''}`}><PeeperSprite peeper={combat.hero || { alive: true }} size={160} /></div>
      <PreparedAttack cleared={cleared} intent={intent} forecast={forecast} damage={responseDamage} detail={responseDetail} label={responseLabel} />
      <div className="card-arena-conditions">
        {support.expose > 0 && <span><CombatGlyph name="sword" />+2 × {support.expose}</span>}
        {support.ward?.charges > 0 && <span><CombatGlyph name="shield" />Ally ward</span>}
        {support.beacon > 0 && <span><CombatGlyph name="heart" />Heal × {support.beacon}</span>}
        {support.poison?.[member.userId] > 0 && <span aria-label={`Poison: ${poisonPower} damage on your next ${support.poison[member.userId]} turn ends`}><CombatGlyph name="poison" />{poisonPower} × {support.poison[member.userId]}</span>}
      </div>
      {combat.bonuses?.[room.key]?.length > 0 && <details className="card-supply-bonuses"><summary>Supplies · {combat.bonuses[room.key].length}</summary><ul>{combat.bonuses[room.key].map((bonus,index)=><li key={`${index}-${bonus}`}>{bonus}</li>)}</ul></details>}
      <CardBattleEffects event={effect} role={member.role} />
      {effect && Boolean(effect.type === 'card_play' && effect.damage > 0 || effect.poisonDamage || effect.counterDamage) && <div key={`hit-${effect.revision}`} className="card-hit-number">−{effect.type === 'card_play' ? effect.damage : (effect.poisonDamage || 0) + (effect.counterDamage || 0)}</div>}
      {effect && Boolean(effect.type === 'card_end' && (effect.damage || effect.overheated) || effect.selfDamage) && <div key={`hurt-${effect.revision}`} className="card-hit-number is-hurt">−{effect.type === 'card_end' ? effect.damage + (effect.overheated ? 1 : 0) : effect.selfDamage}</div>}
      {effect?.healed > 0 && <div key={`heal-${effect.revision}`} className="card-hit-number is-heal">+{effect.healed}</div>}
    </div>
    <div className="card-hand-caption"><span>{turn ? `YOUR HAND · ${turn.hand.length}` : 'YOUR NEXT MOVE'}</span><div className="card-hand-tools"><span>{turn ? 'Swipe →' : '4 cards · 3 energy'}</span><button type="button" className="card-deck-toggle" onClick={() => setShowDeck(true)}><CombatGlyph name="draw" /><span>Deck <b>{combat.deckSize}</b></span></button></div></div>
    {turn && inThisRoom && !cleared ? <CardRow className="card-hand" scrollRef={handRef} aria-label="Your hand">
      {turn.hand.map(card => <PlayingCard key={card.instanceId} card={card} role={member.role} finisherBonus={turn.finisherBonus}
        disabledReason={unavailableReason(card, {resource, hp:member.heroHp, energy:turn.energy, recovering, mutating})}
        onPlay={() => call('play', {instanceId:card.instanceId})} />)}
      {!turn.hand.length && <div className="card-hand-empty"><ClassCrest role={member.role} /><strong>Hand played</strong><span>End your turn to resolve the response.</span></div>}
    </CardRow> : <div className="card-hand card-hand-rest"><div className="card-cardbacks" aria-hidden="true">{[0,1,2].map(i => <div key={i} style={{'--back-index':i}}><ClassCrest role={member.role} /></div>)}</div><div><strong>{cleared ? 'A path forward' : canRetarget ? 'Keep your hand' : 'Ready your cards'}</strong><p>{cleared ? 'Choose your reward, then move on.' : canRetarget ? 'Your remaining cards carry over for free.' : 'One AP. Four cards. Make them count.'}</p></div></div>}
    <div className={`card-hero-console${member.role === 'mage' && resource >= 4 ? ' is-overheated' : ''}`} aria-label="Hero status">
      <div className="hero-vitals"><small>HEALTH</small><div className="hero-hearts" aria-label={`${member.heroHp} of 3 HP`}>{[0,1,2].map(i => <CombatGlyph key={i} name="heart" className={member.heroHp > i ? 'is-filled' : ''} />)}</div><span>{recovering ? 'Recovering' : turn?.dodge ? 'Dodge ready' : member.role !== 'knight' && turn?.block ? `${turn.block} block` : turn?.faithReady ? 'Faith ready' : '\u00a0'}</span></div>
      <button type="button" className="hero-class-mechanic" onClick={() => setShowMechanic(value => !value)} aria-expanded={showMechanic} aria-label={`${combat.class.resource} ${resource}. About ${combat.class.name}`}><ClassCrest role={member.role} /><span className="class-resource-value">{resource}</span><strong className="class-resource-name">{combat.class.resource}</strong><span className="class-resource-role">{combat.class.name}<CombatGlyph name="info" /></span></button>
      <div className="hero-energy"><small>ENERGY</small><div className="energy-crystal"><CombatGlyph name="energy" /><b aria-label={`${turn?.energy || 0} energy`}>{turn?.energy || 0}</b></div><span>{turn?.echo ? 'Echo ×2 ready' : turn?.counter ? `Counter ${turn.counter}` : `${member.ap} AP left`}</span></div>
      {showMechanic && <div className="card-mechanic-note" role="dialog" aria-label={`${combat.class.name} mechanic`}><CombatGlyph name={RESOURCE_GLYPHS[member.role]} /><div><strong>{combat.class.resource}</strong><p>{RESOURCE_HINTS[member.role]}</p>{member.role === 'mage' && <small>Heat cools by 1 at turn end.</small>}{member.role === 'scout' && <small>Combo resets with your next hand.</small>}{member.role === 'cleric' && <small>Light carries over to your next hand.</small>}</div><button type="button" onClick={() => setShowMechanic(false)} aria-label="Close class help">×</button></div>}
    </div>
    <p className="card-battle-feedback" role="status" aria-live="polite">{eventText}</p>
    <div className="card-turn-controls">
      {turn ? <>
        {canRetarget && <button type="button" className="card-primary" disabled={mutating || recovering} onClick={() => call('retarget')}>Continue this hand · free</button>}
        {(inThisRoom || turn.targetCleared) && <button type="button" className="card-end-turn" disabled={mutating} onClick={() => onCommand('end', { revision: combat.revision, roomKey: turn.roomKey })}><span>{mutating ? 'Resolving…' : cleared || turn.targetCleared ? 'Finish hand' : 'End turn'}</span><small>{cleared || turn.targetCleared ? 'Enemy defeated' : <><CombatGlyph name="heart" />{damageToHero ? `−${damageToHero} HP` : responseLabel}{member.role === 'mage' && resource >= 4 ? ' · heat −1 HP' : ''}</>}</small><b aria-hidden="true">→</b></button>}
        {!inThisRoom && !turn.targetCleared && <p>Finish your saved hand in the previous room.</p>}
      </> : !cleared ? <button type="button" className="card-primary" disabled={mutating || recovering || member.ap < 1} onClick={() => call('draw')}><span>{recovering ? 'Hero recovering' : member.ap < 1 ? 'Waiting for AP' : 'Draw a hand'}</span><small>4 cards <i>·</i> 1 AP</small><b aria-hidden="true">→</b></button> : <button type="button" className="card-primary" onClick={onNext}>Next room <b>→</b></button>}
    </div>
    {combat.reward && <div className="card-reward-choice"><small>ROOM CLEARED · ADD A CARD OR SKIP</small><CardRow>{combat.reward.cards.map(card => <PlayingCard key={card.id} card={card} role={member.role} reward disabledReason={mutating ? 'Resolving' : ''} onPlay={() => onCommand('reward', {revision:combat.revision, roomKey:combat.reward.roomKey, cardId:card.id})} />)}</CardRow><button type="button" className="card-reward-skip" disabled={mutating} onClick={() => onCommand('reward', {revision:combat.revision, roomKey:combat.reward.roomKey, cardId:'skip'})}>Skip · keep my deck small</button></div>}
    {showDeck && <div className="card-deck-list" role="dialog" aria-modal="true" aria-label="Your cards"><div className="card-library-header"><ClassCrest role={member.role} /><div><small>{combat.class.name.toUpperCase()}</small><h3>{library ? 'Class collection' : 'Your deck'}</h3></div><button type="button" onClick={() => setShowDeck(false)} aria-label="Close deck">×</button></div><div className="card-library-tabs"><button type="button" aria-pressed={!library} onClick={() => setLibrary(false)}>Deck · {combat.deckSize}</button><button type="button" aria-pressed={library} onClick={() => setLibrary(true)}>Class cards · 10</button></div><p>{RESOURCE_HINTS[member.role]}</p><div className="card-library-grid">{(library ? combat.classCards || [] : combat.deck).map(card => <div className="card-library-entry" key={card.id}><CardArt id={card.id} role={member.role} /><div><strong>{card.name}{card.copies > 1 ? ` ×${card.copies}` : ''}</strong><small>{card.cost} energy · {card.kind}</small><p>{card.text}</p></div></div>)}</div></div>}
  </section>;
}
