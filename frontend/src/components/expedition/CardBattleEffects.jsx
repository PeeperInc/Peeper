import React from 'react';
import CardArt from './CardArt';

export function cardEffectStyle(event, role) {
  if (!event) return '';
  if (event.type === 'card_end') return event.poisonDamage ? 'venom' : event.counterDamage ? 'counter' : event.damage ? 'enemy' : 'protect';
  const id = event.cardId;
  if (['poisoned_blade','ambush'].includes(id)) return 'venom';
  if (['mark','death_mark'].includes(id)) return 'expose';
  if (['shield_bash','shield_crash','shield_throw'].includes(id)) return 'shield';
  if (['sidestep','vanish'].includes(id)) return 'evade';
  if (['mend','mercy','beacon','prayer','sanctuary'].includes(id)) return 'blessing';
  if (id === 'offering') return 'sacrifice';
  if (['ice_bolt','frost_armor','deep_breath','vent'].includes(id)) return 'frost';
  if (['echo','overchannel'].includes(id)) return 'arcane';
  if (role === 'mage' && event.damage) return ['fireball','inferno'].includes(id) ? 'flame' : 'lightning';
  if (role === 'cleric' && event.damage) return 'radiant';
  if (role === 'scout' && event.damage) return 'daggers';
  return event.damage ? 'slash' : 'protect';
}

export default function CardBattleEffects({ event, role }) {
  if (!event) return null;
  const style = cardEffectStyle(event, role);
  const attack = Boolean(event.damage && event.type === 'card_play' || event.poisonDamage || event.counterDamage || style === 'expose');
  return <div key={event.revision} className={`battle-vfx vfx-${style} ${attack ? 'vfx-attack' : 'vfx-self'}`} aria-hidden="true" data-effect={style}>
    <svg className="vfx-drawing" viewBox="0 0 500 250" preserveAspectRatio="none">
      <defs><radialGradient id="battle-impact-glow"><stop stopColor="currentColor" stopOpacity=".7" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></radialGradient></defs>
      <ellipse className="vfx-impact" cx={attack ? 345 : 120} cy="135" rx="100" ry="95" fill="url(#battle-impact-glow)" />
      {['slash','daggers','counter','enemy'].includes(style) && <g className="vfx-cuts" fill="none" stroke="currentColor" strokeLinecap="round"><path d="M280 186Q365 125 398 65" strokeWidth="6" /><path d="M288 193Q364 141 408 84" strokeWidth="2" />{style === 'daggers' && ['finisher','flurry'].includes(event.cardId) && <><path d="M272 92q79 10 134 81" strokeWidth="5" /><path d="M297 66q-4 65 93 132" strokeWidth="3" /></>}</g>}
      {['lightning','arcane'].includes(style) && <g className="vfx-lightning" fill="none" stroke="currentColor"><path d="m113 153 74-40-7 40 73-51-8 43 103-32" strokeWidth="9" opacity=".35" /><path d="m113 153 74-40-7 40 73-51-8 43 103-32" strokeWidth="3" /><path d="m252 109 12-28 25 4m-44 59 17 22 43-6" strokeWidth="2" /></g>}
      {['blessing','protect','arcane','sacrifice','evade','frost'].includes(style) && <g className="vfx-runes" fill="none" stroke="currentColor"><ellipse cx="121" cy="206" rx="77" ry="22" strokeWidth="2" /><ellipse cx="121" cy="206" rx="63" ry="15" strokeDasharray="9 5" strokeWidth="3" /><path d="M68 188v-62m106 62v-62M92 191V90m56 101V90" strokeWidth="2" opacity=".7" /></g>}
      {style === 'radiant' && <g className="vfx-sunbeam" fill="currentColor"><path d="m304 0 12 165 69 0L399 0Z" opacity=".35" /><path d="m333 0 5 168h22l6-168Z" opacity=".8" /><ellipse cx="348" cy="174" rx="60" ry="15" /></g>}
      {style === 'venom' && <g className="vfx-venom" fill="none" stroke="currentColor"><path d="M287 199q99-10 57-69t38-79" strokeWidth="5" /><path d="M314 213q76-15 62-60t-40-69" strokeWidth="3" /><circle cx="316" cy="109" r="6" /><circle cx="389" cy="134" r="9" /><circle cx="342" cy="60" r="4" /></g>}
      {event.cardId === 'ambush' && <g className="vfx-cuts" fill="none" stroke="currentColor" strokeLinecap="round"><path d="M282 186 405 76M287 74l115 116" strokeWidth="5" /><path d="m283 192 129-109m-132-2 114 116" strokeWidth="1.5" /></g>}
      {style === 'expose' && <g className="vfx-runes" fill="none" stroke="currentColor"><circle cx="345" cy="135" r="52" strokeWidth="2" strokeDasharray="12 6" /><path d="M284 135h22m78 0h22M345 74v22m0 78v22" strokeWidth="3" /></g>}
    </svg>
    {['flame','shield','frost'].includes(style) && <div className="vfx-projectile"><CardArt id={event.cardId || 'shield_bash'} role={role} /></div>}
    {style === 'expose' && <div className="vfx-target-mark"><CardArt id={event.cardId} role={role} /></div>}
    {Array.from({length: 8}, (_, i) => <i key={i} className="vfx-spark" style={{'--spark-x':`${Math.cos(i * Math.PI / 4) * (36 + i * 4)}px`,'--spark-y':`${Math.sin(i * Math.PI / 4) * (36 + i * 4)}px`,'--spark-delay':`${i * 22}ms`, left:attack ? '69%' : '24%'}} />)}
  </div>;
}
