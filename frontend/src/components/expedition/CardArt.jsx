import React, { useId } from 'react';

const PALETTES = {
  knight: ['#d6e1d2', '#76998c', '#293e43', '#e8bf71'],
  scout: ['#e6eee0', '#92b8a5', '#243c38', '#d8b36f'],
  mage: ['#e2d3ff', '#a78ce2', '#342b60', '#8cdae8'],
  cleric: ['#fff0b1', '#e8b966', '#6c482e', '#d9ede1'],
};

// Individually composed emblems, rather than a shared icon assigned to every
// attack. The same engraving is used on a card, its reward and its battle VFX.
const Blade = ({ transform = '', curved = false }) => <g transform={transform}><path d={curved ? 'M48 70Q77 48 65 15L51 33 41 62Z' : 'M45 67 46 29 55 12 64 29 60 67Z'} className="art-metal" /><path d="m52 29 1 33" className="art-highlight" /><path d="m35 65 34 3-2 7-34-3Z" className="art-gold" /><path d="m46 74 11 1-1 19-10-1Z" className="art-grip" /><circle cx="50" cy="94" r="4" className="art-gold" /></g>;
const Dagger = ({transform='', venom=false}) => <g transform={transform} className="scout-dagger">
  <path d="m55 8 12 34-5 22H48l-5-22Z" fill="var(--art-metal)" stroke="#314740" strokeWidth="1.3" />
  <path d="M55 8v56h7l5-22Z" fill="#70958b" stroke="none" />
  <path d="m55 13-8 30 4 15" fill="none" stroke="#fff7d8" strokeWidth="1.7" />
  <path d="M55 22v36" fill="none" stroke="#d7e5d6" strokeWidth=".9" />
  {venom && <><path d="m56 12 9 31-4 18h-5Z" fill="#7fb377" fillOpacity=".8" stroke="none" /><path d="m64 45-3 10" stroke="#c5e69b" fill="none" strokeWidth="1.3" /></>}
  <path d="m38 63 10 3h14l10-3 2 7-12 3H48l-12-3Z" fill="#c7a769" stroke="#4d5440" strokeWidth="1.3" />
  <path d="M50 73h10v21H50Z" fill="#6d5741" stroke="#39493e" strokeWidth="1.3" />
  <path d="m51 76 8 3m-8 2 8 3m-8 2 8 3" stroke="#b19a6b" strokeWidth="1.4" fill="none" />
  <path d="m49 94 6-2 6 2-2 6h-8Z" fill="#d1b272" stroke="#46503f" strokeWidth="1.2" />
</g>;
const Shield = ({ transform = '', tower = false }) => <g transform={transform}><path d={tower ? 'M29 19h51l-2 57-24 20-24-20Z' : 'M24 30 54 18l32 12-5 36c-3 16-27 29-27 29S30 82 27 66Z'} className="art-metal" /><path d="m54 24 23 10-4 30c-2 10-13 19-19 23Z" className="art-shadow" /><path d="M54 36v38M40 52h28" className="art-highlight" /><circle cx="54" cy="53" r="7" className="art-gem" /></g>;
const Flame = ({ transform = '' }) => <g transform={transform}><path d="M56 15c-8 22 21 22 20 42 7-5 9-12 7-18 23 33 1 60-28 60-34 0-43-31-25-50 0 16 9 17 9 6 0-15 13-21 17-40Z" className="art-fire" /><path d="M56 48c-3 16 15 17 14 30-1 20-28 21-32 3-3-13 12-19 18-33Z" className="art-gold" /><path d="M54 71c12 12 10 23 0 23s-13-9 0-23Z" className="art-light" /></g>;
const Star = ({ transform = '', points = false }) => <g transform={transform}><path d={points ? 'm55 12 8 28 27 15-27 8-8 31-9-31-28-8 28-15Z' : 'm55 20 10 22 25 4-18 18 4 27-21-13-22 13 5-27-19-18 26-4Z'} className="art-gold" /><circle cx="55" cy="55" r="12" className="art-gem" /><circle cx="52" cy="51" r="4" className="art-light" /></g>;
const Heart = ({ transform = '' }) => <g transform={transform}><path d="M55 88 29 65C-2 32 39 8 55 35c17-27 57-3 27 30Z" className="art-heart" /><path d="M29 43q5-12 15-5" className="art-highlight" /></g>;
const Crystal = ({ transform = '' }) => <g transform={transform}><path d="m54 14 24 24-5 37-19 22-21-22-5-37Z" className="art-gem" /><path d="m54 14-5 30 5 53 19-22 5-37Z" className="art-shadow" /><path d="m29 38 20 6 29-6M49 44l-15 30M54 17l-18 21" className="art-highlight" /></g>;
const Eye = ({ transform = '' }) => <g transform={transform}><path d="M16 55s15-26 39-26 39 26 39 26-15 24-39 24-39-24-39-24Z" className="art-metal" /><ellipse cx="55" cy="54" rx="15" ry="21" className="art-gem" /><path d="m56 37 5 17-6 15-5-15Z" className="art-grip" /><circle cx="48" cy="45" r="4" className="art-light" /></g>;
const Scroll = ({ transform = '' }) => <g transform={transform}><path d="M34 24h42l-6 61H24q-9-16 6-18l5-35q-12 1-8-8Z" className="art-light" /><path d="M35 33h29m-31 11h23M32 55h27M31 66h20M25 68q13 9 0 16M69 26q8-12 16-3l-1 10H73" className="art-engrave" /></g>;
const Feather = ({ transform = '' }) => <g transform={transform}><path d="M31 83C2 56 41 10 83 19c4 40-23 74-52 64Z" className="art-metal" /><path d="m24 96 45-66M35 77l-4-20m14 6-4-24m14 10 14 2M45 65l18 1" className="art-highlight" /></g>;
const Bottle = ({ transform = '' }) => <g transform={transform}><path d="M43 24h24v23c35 25 24 49-12 49S7 72 43 47Z" className="art-metal" /><path d="M30 66q22-13 48 0l-2 15q-24 20-46-1Z" className="art-gem" /><path d="M41 21h28v10H41Z" className="art-gold" /><path d="m34 62-6 12" className="art-highlight" /></g>;
const Bolt = ({ transform = '' }) => <g transform={transform}><path d="m60 11-34 48h24l-6 40 40-58H59Z" className="art-gold" /><path d="M58 28 41 52h17l-4 25" className="art-highlight" /></g>;
const Wind = ({ transform = '' }) => <g transform={transform}><path d="M16 44h54q25-1 17-18-8-12-19-1M22 59h54q24 0 18 18-5 10-16 1M15 74h36q13 1 9 13M25 29h22" className="art-air" /></g>;
const Crown = () => <path d="m28 46-5-25 22 15 11-24 11 24 21-15-5 25Zm0 5h55v9H28Z" className="art-gold" />;
const Rays = ({ transform = '' }) => <g transform={transform} className="art-rays"><path d="M55 8v14m0 66v14M8 55h14m66 0h14M22 22l10 10m46 46 10 10M22 88l10-10m46-46 10-10" /></g>;
const Laurel = () => <g className="art-laurel"><path d="M28 92C9 71 9 47 24 28M82 92c19-21 19-45 4-64" /><path d="m22 82-12-3 6-11 10 3m-8-15-8-7 10-7 7 10m56 30 12-3-6-11-10 3m8-15 8-7-10-7-7 10" /></g>;

const PICTURES = {
  strike: <><Blade transform="rotate(30 55 55)" /><path d="m23 22 9 9M18 37l10 1M38 15v11" className="art-rays" /></>,
  guard: <><Laurel /><Shield /></>,
  shield_bash: <><path d="m82 27 13-9-4 17 12 9-18 5" className="art-gold" /><Shield transform="translate(-7 1) rotate(-16 55 55)" /></>,
  bulwark: <><path d="M16 89V40h15v49m48 0V40h15v49M17 41V27h6v7h8v-7" className="art-shadow" /><Shield tower /></>,
  riposte: <><Shield transform="translate(-13 10) scale(.76)" /><Blade transform="translate(28 -2) rotate(25 55 55) scale(.8)" /><path d="M20 21q55-13 67 35" className="art-air" /></>,
  rally: <><path d="M29 98V17m2 3h53L71 39l13 17H31" className="art-banner" /><Star transform="translate(26 7) scale(.52)" /></>,
  fortress: <><path d="M20 91V29h16v9h10V22h18v16h10v-9h16v62ZM46 91V70q10-15 20 0v21" className="art-metal" /><path d="M20 57h70M36 39v18m36 0v34" className="art-engrave" /></>,
  shield_crash: <><path d="m15 90 19-17m45 2 17 14M11 57l20 2m63-7-17 5" className="art-rays" /><Shield transform="rotate(16 55 55)" /><Bolt transform="translate(36 22) scale(.5)" /></>,
  vanguard: <><Laurel /><Blade transform="translate(4 -3)" /><Shield transform="translate(20 35) scale(.67)" /></>,
  standfast: <><path d="m14 91 19-16 20 8 19-6 25 14Z" className="art-shadow" /><Shield transform="translate(11 7) scale(.8)" /><path d="M20 61h19M11 49h28m-15-12h18" className="art-air" /></>,
  challenge: <><Shield transform="translate(15 27) scale(.7)" /><Crown /><path d="m20 25-6-8m77 8 6-8" className="art-rays" /></>,
  shield_throw: <><path d="M24 82C-10 36 54-3 92 34M20 73q24 30 61 5" className="art-air" /><Shield transform="translate(24 10) rotate(28 55 55) scale(.68)" /></>,
  quick_cut: <><path d="M19 64q10-30 42-39M24 81q11-30 48-42" fill="none" stroke="#8baa83" strokeWidth="2" opacity=".7" /><Dagger transform="rotate(32 55 55)" /></>,
  mark: <><Rays /><Eye /></>,
  finisher: <><path d="M28 91q27 10 55-3" className="art-rays" /><Dagger transform="translate(55 54) rotate(-29) scale(.87) translate(-55 -55)" /><Dagger transform="translate(55 54) rotate(29) scale(.87) translate(-55 -55)" /></>,
  sidestep: <><path d="M40 23h23l-2 38 21 12 6 17H35l-7-12 9-22Z" fill="#827459" /><path d="M38 29h22m-22 8h21m-21 8h20M34 83h49m-34-22 12 11" fill="none" stroke="#d2bb81" strokeWidth="2" /><Wind transform="translate(-4 27) scale(.62)" /></>,
  ambush: <><circle cx="55" cy="53" r="35" fill="#78995b" opacity=".16" /><path d="M22 72q32 28 66-4" fill="none" stroke="#819c59" strokeWidth="2" /><Dagger venom transform="translate(55 52) rotate(-31) scale(.85) translate(-55 -55)" /><Dagger venom transform="translate(55 52) rotate(31) scale(.85) translate(-55 -55)" /><path d="M55 79q-9 13-1 17 10-3 1-17Z" fill="#9fc56d" stroke="#486044" strokeWidth="1.5" /><circle cx="25" cy="34" r="3" fill="#94b96b" /><circle cx="84" cy="42" r="2" fill="#94b96b" /></>,
  death_mark: <><circle cx="55" cy="55" r="35" fill="none" stroke="#b3895b" strokeWidth="1.5" strokeDasharray="14 7" /><Eye transform="translate(8 8) scale(.85)" /><path d="M55 10v17m0 56v17M10 55h17m56 0h17" stroke="#c6aa70" strokeWidth="2.4" fill="none" /><path d="m55 40 4 14-4 15-4-15Z" fill="#d7ba7a" stroke="#4a5e4a" /></>,
  vanish: <><path d="M24 93Q12 44 55 14q41 29 31 79L55 79Z" fill="#456d5b" /><path d="M31 79q-2-37 24-54 23 20 24 54L55 65Z" fill="#183b31" /><path d="m39 50 9 3m14 0 8-3" stroke="#dac98c" strokeWidth="2.5" fill="none" /><path d="M24 91q13-16 23-11m15 0q12-4 23 11" fill="none" stroke="#789775" strokeWidth="1.5" /><Wind transform="translate(8 55) scale(.5)" /></>,
  preparation: <><path d="M24 22h48l10 66H17Z" fill="#8b7755" /><path d="M25 28h42l9 52H23Z" fill="#b4a079" /><path d="M25 56h49v11H24Z" fill="#625c43" /><path d="M35 58h13v9H35Z" fill="none" stroke="#d2b575" strokeWidth="2" /><Dagger transform="translate(27 5) rotate(13 42 55) scale(.77)" /></>,
  poisoned_blade: <><Bottle transform="translate(-1 40) scale(.54)" /><Dagger venom transform="translate(13 -1) rotate(25 55 55) scale(.9)" /><path d="M82 73q-7 10-1 13 8-2 1-13Z" fill="#9bc178" stroke="#536d4c" /></>,
  flurry: <><path d="M17 57q38-41 78 0" fill="none" stroke="#b3bf91" strokeWidth="1.7" strokeDasharray="11 5" /><Dagger transform="translate(53 61) rotate(-36) scale(.72) translate(-55 -55)" /><Dagger transform="translate(57 61) rotate(36) scale(.72) translate(-55 -55)" /><Dagger transform="translate(55 55) scale(.83) translate(-55 -55)" /></>,
  spark: <><Bolt /><circle cx="30" cy="26" r="3" className="art-gem" /><path d="m79 76 8 8m-2-17 12 2M20 50l-9-3" className="art-rays" /></>,
  fireball: <><path d="M75 23 22 65m66-24L41 88" className="art-air" /><Flame transform="translate(14 0) rotate(25 55 55) scale(.8)" /></>,
  vent: <><Crystal transform="translate(2 45) scale(.62)" /><Wind transform="translate(15 0) scale(.8)" /></>,
  discharge: <><Crystal transform="translate(20 20) scale(.63)" /><Bolt transform="translate(-5 -5) scale(.8)" /><path d="m82 25-7 13m17 15-13 2m2 25-10-10" className="art-rays" /></>,
  inferno: <><Flame /><Flame transform="translate(-14 30) scale(.65)" /><Flame transform="translate(51 31) scale(.55)" /></>,
  ice_bolt: <><path d="M19 87 84 21m-61 49 48-2-3-46M38 41l16 9M53 83l-2-22" className="art-air" /><Crystal transform="translate(43 -2) rotate(35 55 55) scale(.55)" /></>,
  deep_breath: <><Feather transform="rotate(-25 55 55)" /><Wind transform="translate(36 46) scale(.52)" /></>,
  frost_armor: <><Shield /><Crystal transform="translate(32 28) scale(.43)" /><path d="m22 18-7-9m76 9 7-9M14 64H4m92 0h10" className="art-rays" /></>,
  overchannel: <><Rays /><Crystal transform="translate(15 15) scale(.72)" /><Bolt transform="translate(41 30) scale(.5)" /></>,
  echo: <><Crystal transform="translate(-2 15) scale(.65)" /><Crystal transform="translate(47 2) scale(.58)" /><path d="M24 23q55-26 70 24M87 87q-56 22-72-24" className="art-air" /></>,
  smite: <><Rays /><Blade transform="rotate(15 55 55)" /><Star transform="translate(32 36) scale(.43)" /></>,
  mend: <><Heart /><path d="M54 40v33M38 56h33" className="art-air" /></>,
  judgement: <><path d="M55 18v76M22 41h66M30 41 17 70h26Zm49 0L66 70h26Z" className="art-metal" /><Star transform="translate(31 -2) scale(.45)" /><path d="M38 94h35" className="art-air" /></>,
  sanctuary: <><path d="M18 89 25 43l30-25 30 25 7 46ZM43 89V64q12-17 24 0v25" className="art-metal" /><Star transform="translate(33 24) scale(.4)" /><Laurel /></>,
  radiance: <><Rays /><Star points /><path d="M23 91 37 77m42-1 13 15" className="art-air" /></>,
  mercy: <><Feather transform="translate(-9 5) rotate(-22 55 55)" /><Heart transform="translate(52 45) scale(.48)" /></>,
  holy_fire: <><Rays /><Flame transform="translate(11 2) scale(.8)" /><Blade transform="translate(28 39) scale(.49)" /></>,
  prayer: <><path d="M22 80 37 48l12 3 6 19 6-19 12-3 15 32-25 15H47Z" className="art-metal" /><Star transform="translate(34 -1) scale(.4)" /><path d="M55 72v20" className="art-engrave" /></>,
  offering: <><Heart transform="translate(15 -8) scale(.75)" /><path d="m19 83 20-18 16 8 17-8 20 18-38 15Z" className="art-metal" /><path d="M55 49v10m-16-6-6 10m38-10 6 10" className="art-rays" /></>,
  beacon: <><Rays /><path d="m31 99 9-53h30l10 53ZM36 46V29h38v17Z" className="art-metal" /><Star transform="translate(34 2) scale(.4)" /><path d="M45 59h19v19H45Z" className="art-gem" /></>,
};

export function CombatGlyph({ name, ...props }) {
  const paths = {
    heart: 'M12 21 3.6 13C-3 6 6-1 12 6 18-1 27 6 20.4 13Z',
    energy: 'm14 1-10 13h7l-1 9L21 9h-8Z',
    shield: 'M12 2 22 6l-2 10-8 7-8-7L2 6Zm0 5v10M7 12h10',
    combo: 'm2 17 14-14 5 1 1 5L8 23m-4-9 6 6M3 9l4-4m11 14 4-4',
    heat: 'M13 1C5 9 20 9 15 15c-5 3-5-5-5-5C-3 21 14 29 21 19 28 10 14 8 13 1Z',
    light: 'm12 1 3 7 8 4-8 3-3 8-3-8-8-3 8-4ZM12 7v10M7 12h10',
    sword: 'm5 19 1-6L18 1l4 1 1 4-12 12-6 1m-3-7 10 10m-5-5-5 5',
    poison: 'M9 1h6v6l5 7c9 15-25 15-16 0l5-7Zm-1 15h8',
    draw: 'M2 6h14v17H2Zm6-5h14v17h-3',
    wind: 'M2 8h13q7 0 5-5-3-3-5 0M2 13h16q7 0 4 6-3 3-5 0M3 18h7',
    info: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 8v7m0-11v1',
  };
  return <svg viewBox="0 0 24 26" aria-hidden="true" {...props}><path d={paths[name] || paths.shield} fill={['heart', 'energy', 'heat', 'light'].includes(name) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

export function ClassCrest({ role, className = '' }) {
  return <span className={`class-crest ${className}`} aria-hidden="true"><svg viewBox="0 0 110 110"><path d="m55 3 17 10 21 4 4 21 10 17-10 17-4 21-21 4-17 10-17-10-21-4-4-21L3 55l10-17 4-21 21-4Z" fill="currentColor" opacity=".24" /><circle cx="55" cy="55" r="43" fill="#142727" stroke="currentColor" strokeWidth="2" /><circle cx="55" cy="55" r="35" fill="none" stroke="currentColor" opacity=".35" strokeDasharray="2 5" /></svg><CombatGlyph name={{knight:'shield',scout:'combo',mage:'heat',cleric:'light'}[role]} /></span>;
}

export default function CardArt({ id, role, className = '' }) {
  const uid = useId().replace(/:/g, '');
  const colors = PALETTES[role] || PALETTES.knight;
  return <svg className={`card-illustration ${className}`} viewBox="0 0 110 110" aria-hidden="true" data-card-art={id}
    style={{'--art-metal':`url(#${uid}metal)`,'--art-gold':colors[3],'--art-gem':colors[1],'--art-dark':colors[2]}}>
    <defs><linearGradient id={`${uid}metal`} x2=".8" y2="1"><stop stopColor={colors[0]} /><stop offset=".5" stopColor={colors[1]} /><stop offset="1" stopColor={colors[2]} /></linearGradient><radialGradient id={`${uid}halo`}><stop stopColor={colors[1]} stopOpacity=".35" /><stop offset="1" stopColor={colors[1]} stopOpacity="0" /></radialGradient></defs>
    <circle cx="55" cy="56" r="54" fill={`url(#${uid}halo)`} /><circle cx="55" cy="56" r="44" fill="none" stroke={colors[3]} strokeOpacity=".2" strokeWidth=".7" />
    <g stroke={colors[2]} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">{PICTURES[id] || <Star />}</g>
    <g fill={colors[3]}><path d="m15 19 2-4 2 4-2 4Zm77 68 2-4 2 4-2 4Z" /><circle cx="87" cy="15" r="1.5" /><circle cx="16" cy="91" r="1" /></g>
  </svg>;
}
