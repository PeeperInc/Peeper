import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PeeperSprite from '../components/PeeperSprite';
import BottomSheet from '../components/BottomSheet';
import SupporterStar from '../components/SupporterStar';
import * as api from '../api';
import { assetUrl } from '../utils/assetUrl';

const ELEMENTS = [
  { id: 'fire', name: 'Fire', emoji: '🔥', color: '#e05555' },
  { id: 'water', name: 'Water', emoji: '💧', color: '#4a9eff' },
  { id: 'earth', name: 'Earth', emoji: '🌍', color: '#7cb342' },
  { id: 'air', name: 'Air', emoji: '💨', color: '#b0bec5' },
];

const ELEMENT_CHAIN = ['fire', 'air', 'earth', 'water'];
const ARENA_QUEUE_SECONDS = 60;
const ATTACK_REVEAL_MS = 2000;

const arenaPanelStyle = {
  background: 'var(--terrarium-panel)',
  color: '#f2ffe8',
  border: '1px solid rgba(183,255,79,0.18)',
  borderRadius: 8,
  boxShadow: 'none',
};

const arenaSubPanelStyle = {
  background: 'rgba(8, 30, 22, 0.82)',
  border: '1px solid rgba(218, 255, 170, 0.14)',
  borderRadius: 6,
};

const ARENA_FIGHTER_SIZE = 156;

function getElement(id) {
  return ELEMENTS.find((element) => element.id === id) || ELEMENTS[0];
}

function useNowMs(intervalMs = 100) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return nowMs;
}

function ArenaStageBackground() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <img
      src={assetUrl('/sprites/arena_stage_bg.png')}
      alt=""
      onError={() => setHidden(true)}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}

function ArenaProjectile({ element, size = 38, spin = null }) {
  const [useFallback, setUseFallback] = useState(false);
  if (!element) return null;

  const spinAnimation = spin === 'clockwise'
    ? 'arena-projectile-spin-cw 0.42s linear infinite'
    : spin === 'counter'
      ? 'arena-projectile-spin-ccw 0.42s linear infinite'
      : undefined;
  const fallbackSize = typeof size === 'number' ? size : 18;

  if (useFallback) {
    return <span style={{ display: 'inline-block', fontSize: fallbackSize * 0.78, animation: spinAnimation }}>{element.emoji}</span>;
  }

  return (
    <img
      src={assetUrl(`/sprites/arena_projectile_${element.id}.png`)}
      alt=""
      onError={() => setUseFallback(true)}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        display: 'block',
        pointerEvents: 'none',
        animation: spinAnimation,
      }}
    />
  );
}

function ElementCycleHint() {
  const cycle = [...ELEMENT_CHAIN, ELEMENT_CHAIN[0]].map(getElement);

  return (
    <div
      style={{
        ...arenaSubPanelStyle,
        padding: '7px 8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'nowrap',
        gap: 'clamp(2px, 1vw, 5px)',
        color: '#fff6e6',
        overflow: 'hidden',
      }}
    >
      {cycle.map((element, index) => (
        <React.Fragment key={`${element.id}-${index}`}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'clamp(2px, 0.8vw, 4px)',
              minWidth: 0,
              padding: 'clamp(3px, 0.9vw, 4px) clamp(4px, 1.3vw, 6px)',
              borderRadius: 4,
              background: 'rgba(0,0,0,0.18)',
              border: `1px solid ${element.color}66`,
              fontSize: 'clamp(8px, 2.45vw, 11px)',
              fontWeight: 900,
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ width: 'clamp(12px, 3.8vw, 18px)', height: 'clamp(12px, 3.8vw, 18px)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <ArenaProjectile element={element} size="100%" />
            </span>
            {element.name}
          </span>
          {index < cycle.length - 1 && (
            <span style={{ color: 'rgba(255,214,107,0.9)', fontWeight: 1000, fontSize: 'clamp(8px, 2.5vw, 13px)', flexShrink: 0 }}>
              -&gt;
            </span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function ArenaGuideSheet({ onClose }) {
  const chain = ELEMENT_CHAIN.map(getElement);
  const armorRows = chain.map((armor, index) => ({
    armor,
    blocked: chain[(index + 1) % chain.length],
  }));
  const examples = [
    { label: 'Fire Strike vs Air Armor', value: 'x2', tone: '#ffcf6b', note: 'Fire beats Air' },
    { label: 'Fire Strike vs Water Armor', value: 'x0', tone: '#80c7ff', note: 'Water armor blocks Fire' },
    { label: 'Fire Strike vs Fire Armor', value: 'x1', tone: '#d7e0eb', note: 'Same element is neutral' },
  ];
  const guideBlockStyle = {
    padding: 8,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg-card)',
  };
  const guideTitleStyle = {
    fontWeight: 1000,
    fontSize: 14,
    marginBottom: 6,
  };

  return (
    <BottomSheet
      onClose={onClose}
      bodyStyle={{ maxHeight: 'calc(100dvh - var(--tg-total-top) - 12px)', overflowY: 'auto' }}
    >
      <div style={{ padding: '6px 8px 10px', color: 'var(--text-primary)' }}>
        <div style={{ fontSize: 18, fontWeight: 1000, marginBottom: 3 }}>Arena Guide</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
          Read the chain from left to right. The winning element points to the losing one.
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={guideBlockStyle}>
            <div style={guideTitleStyle}>1. Element chain</div>
            <ElementCycleHint />
          </div>

          <div style={{ ...guideBlockStyle, display: 'grid', gap: 4 }}>
            <div style={guideTitleStyle}>2. Damage rules</div>
            {[
              ['x2', 'Strike beats enemy armor', 'Follow the chain forward.'],
              ['x0', 'Enemy armor beats your strike', 'Your attack is fully blocked.'],
              ['x1', 'No counter relationship', 'Same element is also neutral.'],
            ].map(([value, title, note]) => (
              <div key={value} style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: 6, alignItems: 'center', padding: '5px 6px', borderRadius: 3, background: 'rgba(0,0,0,0.04)' }}>
                <div style={{ fontWeight: 1000, fontSize: 14, color: value === 'x2' ? '#d88600' : value === 'x0' ? '#2186d9' : 'var(--text-primary)' }}>{value}</div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 12 }}>{title}</div>
                  <div style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: 11 }}>{note}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={guideBlockStyle}>
            <div style={guideTitleStyle}>3. Armor blocks</div>
            <div style={{ display: 'grid', gap: 4 }}>
              {armorRows.map(({ armor, blocked }) => (
                <div key={armor.id} style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto 1fr', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800 }}>
                  <span style={{ width: 20, height: 20, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <ArenaProjectile element={armor} size={20} />
                  </span>
                  <span>{armor.name} Armor</span>
                  <span style={{ color: 'var(--text-secondary)' }}>blocks</span>
                  <span>{blocked.name} Strike</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...guideBlockStyle, display: 'grid', gap: 5 }}>
            <div style={guideTitleStyle}>4. Quick example</div>
            {examples.map((example) => (
              <div key={example.label} style={{ display: 'grid', gridTemplateColumns: '1fr 34px', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 800 }}>
                <div>
                  <div>{example.label}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700 }}>{example.note}</div>
                </div>
                <div style={{ justifySelf: 'end', borderRadius: 3, padding: '3px 6px', background: example.tone, color: '#171717', fontWeight: 1000 }}>
                  {example.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}

function copyText(value) {
  const nextValue = String(value || '').trim();
  if (!nextValue) return Promise.resolve(false);

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(nextValue).then(() => true).catch(() => false);
  }

  if (typeof document === 'undefined') return Promise.resolve(false);

  const textarea = document.createElement('textarea');
  textarea.value = nextValue;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  return Promise.resolve(copied);
}

function isArenaOccupancyError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('already in an arena fight') || message.includes('already searching');
}

function formatSeconds(value) {
  return `${Math.max(0, Math.ceil(Number(value) || 0))}s`;
}

function buildPeeper(player) {
  return {
    alive: true,
    ...(player?.outfit || {}),
  };
}

const OUTLINE_SHADOW = '0 1px 0 #050505, 1px 0 0 #050505, -1px 0 0 #050505, 0 -1px 0 #050505, 0 2px 7px rgba(0,0,0,0.9)';

function getArenaStateSignature(next) {
  if (!next?.match?.id) return '';
  return JSON.stringify({
    match: next.match,
    selfHp: next.players?.self?.hp,
    opponentHp: next.players?.opponent?.hp,
    opponentId: next.players?.opponent?.id,
    currentRound: next.currentRound,
    lastRound: next.lastRound,
    result: next.result,
    winnerId: next.winnerId,
  });
}

function HpBar({ player, align = 'left' }) {
  const pct = Math.max(0, Math.min(100, Math.round((Number(player?.hp || 0) / Number(player?.maxHp || 100)) * 100)));
  return (
    <div style={{ flex: 1, textAlign: align }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: align === 'right' ? 'flex-end' : 'flex-start', gap: 4, fontWeight: 900, fontSize: 12, color: '#fff6e6', textShadow: OUTLINE_SHADOW }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player?.firstName || 'Waiting...'}</span>
        <SupporterStar user={player} size={11} />
      </div>
      <div style={{ marginTop: 4, height: 10, borderRadius: 3, background: 'rgba(0,0,0,0.58)', border: '1px solid rgba(0,0,0,0.9)', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.55)' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            marginLeft: align === 'right' ? 'auto' : 0,
            background: pct <= 30 ? '#e05555' : 'linear-gradient(90deg, #6fd88a, #d8f06a)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div style={{ marginTop: 2, fontSize: 10, color: 'rgba(255,255,255,0.88)', fontWeight: 800, textShadow: OUTLINE_SHADOW }}>
        {Math.max(0, Math.floor(Number(player?.hp || 0)))} HP
      </div>
    </div>
  );
}

const ArenaStage = React.memo(function ArenaStage({ state, isRevealing = false, previewArmor = null }) {
  const self = state?.players?.self;
  const opponent = state?.players?.opponent;
  const lastRound = state?.lastRound;
  const showResolvedArmor = isRevealing || state?.match?.status === 'finished';
  const selfAttack = getElement(lastRound?.self?.attack);
  const opponentAttack = getElement(lastRound?.opponent?.attack);
  const selfBlocked = Number(lastRound?.opponent?.damageDealt || 0) <= 0;
  const opponentBlocked = Number(lastRound?.self?.damageDealt || 0) <= 0;

  return (
    <div
      style={{
        position: 'relative',
        height: 'clamp(288px, 42dvh, 320px)',
        borderRadius: 10,
        overflow: 'hidden',
        border: '1.5px solid rgba(255,255,255,0.22)',
        background: 'linear-gradient(180deg, #1b2544 0%, #2e375d 48%, #563331 49%, #2a1f27 100%)',
        boxShadow: '0 22px 50px rgba(0,0,0,0.26)',
      }}
      >
      <style>{`
        @keyframes arena-lunge-left {
          0%, 100% { transform: translateX(0) scale(1); }
          24% { transform: translateX(18px) scale(1.05, 0.92) rotate(3deg); }
          48% { transform: translateX(-6px) scale(0.96, 1.05) rotate(-2deg); }
        }
        @keyframes arena-lunge-right {
          0%, 100% { transform: scaleX(-1) translateX(0) scale(1); }
          24% { transform: scaleX(-1) translateX(18px) scale(1.05, 0.92) rotate(3deg); }
          48% { transform: scaleX(-1) translateX(-6px) scale(0.96, 1.05) rotate(-2deg); }
        }
        @keyframes arena-projectile-self {
          0% { left: 24%; opacity: 0; transform: translate(-50%, -50%) scale(0.65) rotate(-8deg); }
          16% { opacity: 1; }
          72% { left: 76%; opacity: 1; transform: translate(-50%, -50%) scale(1.15) rotate(10deg); }
          100% { left: 80%; opacity: 0; transform: translate(-50%, -50%) scale(0.3) rotate(18deg); }
        }
        @keyframes arena-projectile-opponent {
          0% { right: 24%; opacity: 0; transform: translate(50%, -50%) scale(0.65) rotate(8deg); }
          16% { opacity: 1; }
          72% { right: 76%; opacity: 1; transform: translate(50%, -50%) scale(1.15) rotate(-10deg); }
          100% { right: 80%; opacity: 0; transform: translate(50%, -50%) scale(0.3) rotate(-18deg); }
        }
        @keyframes arena-impact {
          0%, 48% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
          58% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.9); }
        }
        @keyframes arena-particle {
          0%, 54% { opacity: 0; transform: translate(0, 0) scale(0.4); }
          70% { opacity: 1; }
          100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1); }
        }
        @keyframes arena-projectile-spin-cw {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes arena-projectile-spin-ccw {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        .arena-fighter-left.is-revealing { animation: arena-lunge-left 0.72s ease-in-out both; }
        .arena-fighter-right.is-revealing { animation: arena-lunge-right 0.72s ease-in-out both; }
        .arena-projectile-self { animation: arena-projectile-self 1.35s 0.42s cubic-bezier(.18,.78,.24,1) both; }
        .arena-projectile-opponent { animation: arena-projectile-opponent 1.35s 0.42s cubic-bezier(.18,.78,.24,1) both; }
        .arena-impact { animation: arena-impact 1.25s 0.58s ease-out both; }
        .arena-particle { animation: arena-particle 1.25s 0.58s ease-out both; }
      `}</style>
      <ArenaStageBackground />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 50% 18%, rgba(255,216,138,0.2), transparent 28%), radial-gradient(circle at 50% 100%, rgba(255,92,92,0.16), transparent 42%)',
        }}
      />
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', gap: 14, padding: '10px 14px 0' }}>
        <HpBar player={self} />
        <HpBar player={opponent} align="right" />
      </div>

      <div
        className={`arena-fighter-left${isRevealing ? ' is-revealing' : ''}`}
        style={{ position: 'absolute', left: -10, bottom: 2, zIndex: 3 }}
      >
        <PeeperSprite peeper={buildPeeper(self)} size={ARENA_FIGHTER_SIZE} armorElement={showResolvedArmor ? lastRound?.self?.defense : previewArmor} />
      </div>
      <div
        className={`arena-fighter-right${isRevealing ? ' is-revealing' : ''}`}
        style={{ position: 'absolute', right: -10, bottom: 2, zIndex: 3, transform: 'scaleX(-1)' }}
      >
        {opponent ? (
          <PeeperSprite peeper={buildPeeper(opponent)} size={ARENA_FIGHTER_SIZE} armorElement={showResolvedArmor ? lastRound?.opponent?.defense : null} />
        ) : (
          <div style={{ width: ARENA_FIGHTER_SIZE, height: ARENA_FIGHTER_SIZE, display: 'grid', placeItems: 'center', fontSize: 46 }}>?</div>
        )}
      </div>

      {isRevealing && lastRound && (
        <>
          <div
            className="arena-projectile-self"
            style={{
              position: 'absolute',
              top: '67%',
              zIndex: 4,
              fontSize: 32,
              filter: `drop-shadow(0 0 16px ${selfAttack.color})`,
            }}
          >
            <ArenaProjectile element={selfAttack} spin="clockwise" />
          </div>
          <div
            className="arena-projectile-opponent"
            style={{
              position: 'absolute',
              top: '60%',
              zIndex: 4,
              fontSize: 32,
              filter: `drop-shadow(0 0 16px ${opponentAttack.color})`,
            }}
          >
            <ArenaProjectile element={opponentAttack} spin="counter" />
          </div>
          {[
            { side: 'left', color: opponentAttack.color, blocked: selfBlocked },
            { side: 'right', color: selfAttack.color, blocked: opponentBlocked },
          ].map((impact) => (
            <div
              key={impact.side}
              className="arena-impact"
              style={{
                position: 'absolute',
                left: impact.side === 'left' ? '20%' : '80%',
                top: impact.side === 'left' ? '65%' : '71%',
                width: impact.blocked ? 88 : 66,
                height: impact.blocked ? 88 : 66,
                borderRadius: '50%',
                border: `3px solid ${impact.blocked ? '#fff6b0' : impact.color}`,
                background: impact.blocked ? 'rgba(255,246,176,0.22)' : `${impact.color}33`,
                boxShadow: `0 0 28px ${impact.blocked ? '#fff6b0' : impact.color}`,
                zIndex: 5,
              }}
            />
          ))}
          {Array.from({ length: 12 }).map((_, index) => {
            const rightSide = index % 2 === 0;
            return (
              <span
                key={index}
                className="arena-particle"
                style={{
                  position: 'absolute',
                  left: rightSide ? '80%' : '20%',
                  top: rightSide ? '71%' : '65%',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: rightSide ? selfAttack.color : opponentAttack.color,
                  zIndex: 6,
                  '--dx': `${(rightSide ? 1 : -1) * (18 + (index % 4) * 9)}px`,
                  '--dy': `${-28 + (index % 6) * 11}px`,
                }}
              />
            );
          })}
        </>
      )}

      {isRevealing && lastRound && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 12,
            transform: 'translateX(-50%)',
            zIndex: 7,
            padding: '7px 12px',
            borderRadius: 4,
            background: 'rgba(0,0,0,0.34)',
            color: 'white',
            fontSize: 12,
            fontWeight: 900,
            backdropFilter: 'blur(8px)',
          }}
        >
          You dealt {lastRound.self.damageDealt} · took {lastRound.opponent.damageDealt}
        </div>
      )}
    </div>
  );
});

function ElementGrid({ label, value, onChange, mode = 'attack' }) {
  return (
    <div style={{ ...arenaSubPanelStyle, padding: 6, minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 1000, color: 'rgba(255,246,230,0.72)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4 }}>
        {ELEMENTS.map((element) => {
          const selected = value === element.id;
          const actionLabel = mode === 'defense' ? 'Armor' : 'Strike';
          return (
            <button
              key={element.id}
              onClick={() => onChange(element.id)}
              style={{
                border: `1px solid ${selected ? element.color : 'rgba(255,255,255,0.14)'}`,
                background: selected ? `${element.color}30` : 'rgba(255,255,255,0.06)',
                color: selected ? '#fff' : '#fff6e6',
                borderRadius: 3,
                padding: '5px 3px',
                fontWeight: 900,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                minWidth: 0,
                minHeight: 42,
                fontSize: 10,
                lineHeight: 1.08,
                letterSpacing: '-0.02em',
              }}
            >
              <span style={{ flexShrink: 0, width: 18, height: 18, display: 'grid', placeItems: 'center' }}>
                <ArenaProjectile element={element} size={18} />
              </span>
              <span style={{ minWidth: 0, whiteSpace: 'normal', textAlign: 'center' }}>{actionLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RoundTimerBar({ roundNumber, deadline, choiceSeconds }) {
  const nowMs = useNowMs(120);
  const deadlineMs = Number(deadline || 0) * 1000;
  const remainingMs = Math.max(0, deadlineMs - nowMs);
  const remaining = remainingMs / 1000;
  const progressPct = Math.max(0, Math.min(100, (remaining / Number(choiceSeconds || 15)) * 100));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <div style={{ fontWeight: 900, color: '#fff6e6', textShadow: OUTLINE_SHADOW }}>Round {roundNumber || 1}</div>
        <div style={{ fontWeight: 900, color: remaining <= 3 ? '#ff7b72' : '#ffd66b', textShadow: OUTLINE_SHADOW }}>
          {formatSeconds(remaining)}
        </div>
      </div>
      <div style={{ height: 5, borderRadius: 2, background: 'rgba(255,255,255,0.16)', overflow: 'hidden', marginBottom: 6 }}>
        <div
          style={{
            height: '100%',
            width: `${progressPct}%`,
            background: remaining <= 3 ? '#ff7b72' : 'linear-gradient(90deg, #ff6a4a, #ffd66b)',
            transition: 'width 120ms linear',
          }}
        />
      </div>
    </>
  );
}

function ChoicePanel({ state, onSubmit, loading, onArmorPreviewChange }) {
  const [attack, setAttack] = useState(null);
  const [defense, setDefense] = useState(null);

  useEffect(() => {
    setAttack(null);
    setDefense(null);
    onArmorPreviewChange?.(null);
  }, [onArmorPreviewChange, state?.currentRound?.roundNumber]);

  const chooseDefense = useCallback((nextDefense) => {
    setDefense(nextDefense);
    onArmorPreviewChange?.(nextDefense);
  }, [onArmorPreviewChange]);

  const submitted = Boolean(state?.currentRound?.selfSubmitted);
  const ready = attack && defense && !submitted && !loading;

  return (
    <div style={{ ...arenaPanelStyle, padding: 6 }}>
      <RoundTimerBar
        roundNumber={state?.currentRound?.roundNumber}
        deadline={state?.currentRound?.deadline}
        choiceSeconds={state?.rules?.choiceSeconds}
      />
      {submitted ? (
        <div style={{ textAlign: 'center', padding: 8, fontWeight: 900, color: 'rgba(255,246,230,0.72)' }}>
          Waiting for opponent...
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 5 }}>
            <ElementGrid label="Choose Armor" value={defense} onChange={chooseDefense} mode="defense" />
            <ElementGrid label="Choose Attack" value={attack} onChange={setAttack} mode="attack" />
          </div>
          <button
            className="btn btn-primary"
            disabled={!ready}
            onClick={() => onSubmit(attack, defense)}
            style={{ width: '100%', marginTop: 6, borderRadius: 4, minHeight: 38 }}
          >
            {loading ? 'Submitting...' : 'Ready'}
          </button>
        </>
      )}
    </div>
  );
}

function InviteSheet({ matchId, onClose, onToast }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState(null);

  const search = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setLoading(true);
    try {
      const data = await api.searchUsers(q);
      setResults(data.users || []);
    } catch (error) {
      onToast?.(error.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [onToast, query]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const id = setTimeout(search, 350);
    return () => clearTimeout(id);
  }, [query, search]);

  const sendInvite = async (userId) => {
    setSendingId(userId);
    try {
      const result = await api.arenaInvitePlayer(matchId, userId);
      onToast?.(result.message || 'Invite sent');
      onClose();
    } catch (error) {
      onToast?.(error.message || 'Invite failed');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ padding: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Invite Player</div>
        <input
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="@username or name..."
          style={{ width: '100%', marginBottom: 12 }}
        />
        {loading && <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Searching...</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((user) => (
            <button
              key={user.id}
              onClick={() => sendInvite(user.id)}
              disabled={Boolean(sendingId)}
              style={{
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                borderRadius: 14,
                padding: '10px 12px',
                textAlign: 'left',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%' }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.first_name}</span>
                  <SupporterStar user={user} size={12} />
                </strong>
                {user.username && <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>@{user.username}</span>}
              </span>
              <span style={{ color: 'var(--accent)', fontWeight: 900 }}>{sendingId === user.id ? '...' : 'Invite'}</span>
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}

function ArenaLeaderboard({ data }) {
  const rows = data?.leaderboard || [];
  const self = data?.self || null;
  const showSelfRow = self && (!self.rank || self.rank > rows.length);

  return (
    <div style={{ ...arenaSubPanelStyle, padding: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 1000, letterSpacing: '0.08em', color: 'rgba(255,246,230,0.72)', textTransform: 'uppercase', marginBottom: 6 }}>
        Top Fighters
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {rows.length === 0 && (
          <div style={{ color: 'rgba(255,246,230,0.66)', fontSize: 12, fontWeight: 800 }}>
            No wins yet. First fighter gets the board.
          </div>
        )}
        {rows.map((row) => (
          <div
            key={row.userId}
            style={{
              display: 'grid',
              gridTemplateColumns: '42px minmax(0, 1fr) 58px',
              alignItems: 'center',
              gap: 6,
              padding: '5px 6px',
              background: 'rgba(0,0,0,0.18)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 3,
              fontSize: 12,
              fontWeight: 900,
            }}
          >
            <span style={{ color: '#ffd66b' }}>#{row.rank}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.firstName || row.username || 'Fighter'}</span>
              <SupporterStar user={row} size={11} />
            </span>
            <span style={{ textAlign: 'right', color: 'rgba(255,246,230,0.82)' }}>{row.wins}W</span>
          </div>
        ))}
        {showSelfRow && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '42px minmax(0, 1fr) 58px',
              alignItems: 'center',
              gap: 6,
              padding: '5px 6px',
              background: 'rgba(255,214,107,0.14)',
              border: '1px solid rgba(255,214,107,0.3)',
              borderRadius: 3,
              fontSize: 12,
              fontWeight: 1000,
            }}
          >
            <span style={{ color: '#ffd66b' }}>{self.rank ? `#${self.rank}` : '#—'}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>You</span>
              <SupporterStar user={self} size={11} />
            </span>
            <span style={{ textAlign: 'right', color: 'rgba(255,246,230,0.9)' }}>{self.wins}W</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultPanel({ state, onClose }) {
  const selfId = state?.players?.self?.userId;
  const result = state?.result;
  const winnerId = state?.winnerId;
  const isDraw = result === 'draw';
  const won = winnerId && Number(winnerId) === Number(selfId);
  const title = isDraw ? 'Draw!' : won ? 'Victory!' : 'Defeat';
  const caption = isDraw
    ? 'Both fighters fell. Stakes returned.'
    : won
      ? '+50 ✦ prize'
      : 'Your stake was lost.';

  return (
    <div style={{ ...arenaPanelStyle, padding: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 1000, color: won ? '#ffd66b' : isDraw ? '#ffcf6b' : '#ff7b72' }}>
        {title}
      </div>
      <div style={{ marginTop: 4, color: 'rgba(255,246,230,0.72)', fontWeight: 700 }}>{caption}</div>
      <button className="btn btn-primary" onClick={onClose} style={{ width: '100%', marginTop: 10, borderRadius: 4 }}>
        Back Home
      </button>
    </div>
  );
}

function QueuePanel({ expiresAtMs, busy, onCancel }) {
  const nowMs = useNowMs(250);
  const queueRemaining = expiresAtMs
    ? Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000))
    : ARENA_QUEUE_SECONDS;
  const queueProgressPct = Math.max(0, Math.min(100, (queueRemaining / ARENA_QUEUE_SECONDS) * 100));

  return (
    <div style={{ ...arenaPanelStyle, padding: 12, textAlign: 'center' }}>
      <div
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          minWidth: 58,
          height: 30,
          marginBottom: 8,
          border: '1px solid rgba(255,214,107,0.5)',
          background: 'rgba(255,214,107,0.12)',
          color: '#ffd66b',
          fontSize: 14,
          fontWeight: 1000,
          letterSpacing: '0.12em',
          borderRadius: 4,
        }}
      >
        DUEL
      </div>
      <div style={{ fontWeight: 1000, fontSize: 20 }}>Searching for opponent...</div>
      <div style={{ color: 'rgba(255,246,230,0.72)', marginTop: 4, fontWeight: 700 }}>
        Queue expires in {formatSeconds(queueRemaining)}
      </div>
      <div style={{ height: 6, borderRadius: 2, background: 'rgba(255,255,255,0.14)', overflow: 'hidden', marginTop: 10 }}>
        <div
          style={{
            height: '100%',
            width: `${queueProgressPct}%`,
            background: 'linear-gradient(90deg, #ff6a4a, #ffd66b)',
            transition: 'width 250ms linear',
          }}
        />
      </div>
      <button className="btn btn-secondary" onClick={onCancel} disabled={busy} style={{ marginTop: 10, width: '100%', borderRadius: 4 }}>
        Cancel
      </button>
    </div>
  );
}

function CountdownPanel({ endsAt }) {
  const nowMs = useNowMs(250);
  const countdownRemaining = Math.max(0, Number(endsAt || 0) - Math.floor(nowMs / 1000));

  return (
    <div style={{ ...arenaPanelStyle, padding: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 44, fontWeight: 1000, color: '#ffd66b' }}>{formatSeconds(countdownRemaining)}</div>
      <div style={{ fontWeight: 900 }}>Fight starts now</div>
    </div>
  );
}

export default function ArenaGame({ onClose, inviteToken = null, onInviteTokenConsumed = null }) {
  const [state, setState] = useState(null);
  const [queued, setQueued] = useState(false);
  const [queueExpiresAtMs, setQueueExpiresAtMs] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [revealingRoundNumber, setRevealingRoundNumber] = useState(null);
  const [publicQueueActive, setPublicQueueActive] = useState(false);
  const [previewArmor, setPreviewArmor] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const lastRevealRef = useRef(null);
  const stateSignatureRef = useRef('');
  const isRevealing = Boolean(revealingRoundNumber);

  const showToast = useCallback((message) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const commitArenaState = useCallback((next) => {
    const signature = getArenaStateSignature(next);
    if (signature && signature === stateSignatureRef.current) return false;
    stateSignatureRef.current = signature;
    setState(next);
    return true;
  }, []);

  const loadState = useCallback(async (matchId) => {
    const next = await api.arenaGetState(matchId);
    commitArenaState(next);
    return next;
  }, [commitArenaState]);

  const applyCurrentArena = useCallback((result) => {
    if (result?.mode === 'match' && result.state?.match?.id) {
      setQueued(false);
      setQueueExpiresAtMs(null);
      commitArenaState(result.state);
      return true;
    }

    if (result?.mode === 'queue' || result?.queued) {
      const remainingSeconds = Number(result?.queue?.remainingSeconds ?? result?.remainingSeconds ?? ARENA_QUEUE_SECONDS);
      commitArenaState(null);
      setQueued(true);
      setQueueExpiresAtMs(Date.now() + Math.max(0, remainingSeconds) * 1000);
      return true;
    }

    setQueued(false);
    setQueueExpiresAtMs(null);
    commitArenaState(null);
    return false;
  }, [commitArenaState]);

  const refreshCurrentArena = useCallback(async () => {
    const result = await api.arenaCurrent();
    return applyCurrentArena(result);
  }, [applyCurrentArena]);

  const handleArenaActionError = useCallback(async (error, fallbackMessage) => {
    if (isArenaOccupancyError(error)) {
      try {
        const recovered = await refreshCurrentArena();
        if (recovered) {
          showToast('Reconnected to your Arena fight');
          return;
        }
      } catch {
        // Fall through to the original error below.
      }
    }

    showToast(error.message || fallbackMessage);
  }, [refreshCurrentArena, showToast]);

  useEffect(() => {
    if (inviteToken) {
      setInitializing(false);
      return undefined;
    }

    let cancelled = false;
    setInitializing(true);
    api.arenaCurrent()
      .then((result) => {
        if (!cancelled) applyCurrentArena(result);
      })
      .catch(() => {
        if (!cancelled) {
          setQueued(false);
          setQueueExpiresAtMs(null);
          commitArenaState(null);
        }
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => { cancelled = true; };
  }, [applyCurrentArena, inviteToken]);

  useEffect(() => {
    const roundNumber = state?.lastRound?.roundNumber;
    if (!roundNumber || lastRevealRef.current === roundNumber) return undefined;
    if (!['active', 'finished'].includes(state?.match?.status)) return undefined;

    lastRevealRef.current = roundNumber;
    setRevealingRoundNumber(roundNumber);
    const id = setTimeout(() => {
      setRevealingRoundNumber((current) => (current === roundNumber ? null : current));
      setPreviewArmor(null);
    }, ATTACK_REVEAL_MS);
    return () => clearTimeout(id);
  }, [state?.lastRound?.roundNumber, state?.match?.status]);

  const handleArmorPreviewChange = useCallback((nextArmor) => {
    setPreviewArmor(nextArmor);
  }, []);

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    setBusy(true);
    api.arenaJoinInvite(inviteToken)
      .then((next) => {
        if (!cancelled) {
          commitArenaState(next);
          onInviteTokenConsumed?.();
        }
      })
      .catch((error) => handleArenaActionError(error, 'Could not join Arena invite'))
      .finally(() => !cancelled && setBusy(false));
    return () => { cancelled = true; };
  }, [commitArenaState, handleArenaActionError, inviteToken, onInviteTokenConsumed]);

  useEffect(() => {
    if (state || queued) {
      setPublicQueueActive(false);
      return undefined;
    }
    let cancelled = false;
    const refreshPublicQueue = async () => {
      try {
        const result = await api.arenaPublicQueueStatus();
        if (!cancelled) setPublicQueueActive(Boolean(result?.active));
      } catch {
        if (!cancelled) setPublicQueueActive(false);
      }
    };
    refreshPublicQueue();
    const id = setInterval(refreshPublicQueue, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [queued, state]);

  useEffect(() => {
    if (state || queued) return undefined;
    let cancelled = false;
    api.arenaLeaderboard()
      .then((result) => {
        if (!cancelled) setLeaderboard(result);
      })
      .catch(() => {
        if (!cancelled) setLeaderboard({ leaderboard: [], self: null });
      });
    return () => { cancelled = true; };
  }, [queued, state]);

  useEffect(() => {
    if (!queued) return undefined;
    const id = setInterval(async () => {
      try {
        const status = await api.arenaQueueStatus();
        if (status.matched && status.matchId) {
          setQueued(false);
          setQueueExpiresAtMs(null);
          await loadState(status.matchId);
        } else if (!status.queued) {
          setQueued(false);
          setQueueExpiresAtMs(null);
        } else if (Number.isFinite(Number(status.remainingSeconds))) {
          setQueueExpiresAtMs(Date.now() + Number(status.remainingSeconds) * 1000);
        }
      } catch (error) {
        showToast(error.message || 'Queue status failed');
      }
    }, 2000);
    return () => clearInterval(id);
  }, [loadState, queued, showToast]);

  useEffect(() => {
    const matchId = state?.match?.id;
    const status = state?.match?.status;
    if (!matchId || !['waiting', 'countdown', 'active'].includes(status)) return undefined;
    const id = setInterval(() => {
      loadState(matchId).catch((error) => showToast(error.message || 'Arena sync failed'));
    }, 1500);
    return () => clearInterval(id);
  }, [loadState, showToast, state?.match?.id, state?.match?.status]);

  const joinQueue = async () => {
    setBusy(true);
    try {
      const result = await api.arenaJoinQueue();
      if (result.queued) {
        setQueued(true);
        setQueueExpiresAtMs(Date.now() + ARENA_QUEUE_SECONDS * 1000);
      } else {
        commitArenaState(result);
      }
    } catch (error) {
      await handleArenaActionError(error, 'Could not find fight');
    } finally {
      setBusy(false);
    }
  };

  const cancelQueue = async () => {
    setBusy(true);
    try {
      await api.arenaLeaveQueue();
      setQueued(false);
      setQueueExpiresAtMs(null);
    } catch (error) {
      showToast(error.message || 'Could not leave queue');
    } finally {
      setBusy(false);
    }
  };

  const createRoom = async () => {
    setBusy(true);
    try {
      commitArenaState(await api.arenaCreateRoom());
    } catch (error) {
      await handleArenaActionError(error, 'Could not create room');
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async () => {
    if (!joinCode.trim()) return;
    setBusy(true);
    try {
      commitArenaState(await api.arenaJoinRoom(joinCode));
    } catch (error) {
      await handleArenaActionError(error, 'Could not join room');
    } finally {
      setBusy(false);
    }
  };

  const copyRoomCode = async () => {
    const copied = await copyText(state?.match?.joinCode);
    showToast(copied ? 'Code copied' : 'Could not copy the code');
  };

  const submitChoice = async (attack, defense) => {
    setBusy(true);
    try {
      commitArenaState(await api.arenaChoose(state.match.id, attack, defense));
    } catch (error) {
      showToast(error.message || 'Could not submit choice');
    } finally {
      setBusy(false);
    }
  };

  const surrender = async () => {
    setBusy(true);
    try {
      commitArenaState(await api.arenaForfeit(state.match.id));
    } catch (error) {
      showToast(error.message || 'Could not surrender');
    } finally {
      setBusy(false);
    }
  };

  const canSurrender = state && ['countdown', 'active'].includes(state.match.status);
  const isLobby = !initializing && !state && !queued;
  const handleTopAction = () => {
    if (canSurrender) {
      surrender();
      return;
    }
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 180,
        background: 'radial-gradient(circle at 50% 0%, rgba(183,255,79,0.18), transparent 34%), radial-gradient(circle at 12% 42%, rgba(255,209,94,0.08), transparent 28%), linear-gradient(180deg, #061f19 0%, #05130f 62%, #030807 100%)',
        padding: 'calc(var(--tg-total-top) + 10px) 14px calc(var(--tg-safe-bottom) + 14px)',
        color: 'white',
        overflowY: 'auto',
      }}
    >
      <style>{`
        @keyframes arena-menu-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 2px 10px rgba(224,85,85,0.16); }
          50% { transform: scale(1.018); box-shadow: 0 8px 24px rgba(224,85,85,0.32); }
        }
      `}</style>
      <div style={{ maxWidth: 620, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {isLobby ? (
          <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr 88px', alignItems: 'center', gap: 8 }}>
            <button className="app-back-button" onClick={onClose}>
              Back
            </button>
            <div style={{ textAlign: 'center', fontSize: 24, fontWeight: 1000, textShadow: OUTLINE_SHADOW }}>Arena</div>
            <button className="btn btn-secondary" onClick={() => setShowGuide(true)} style={{ borderRadius: 4 }}>
              Guide
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 1000, textShadow: OUTLINE_SHADOW }}>Arena</div>
              <div style={{ fontSize: 12, color: 'rgba(255,226,178,0.9)', fontWeight: 700, textShadow: OUTLINE_SHADOW }}>25 ✦ stake · winner takes 50 ✦ · no energy</div>
            </div>
            <button className="btn btn-secondary" onClick={handleTopAction} disabled={busy}>
              {canSurrender ? 'Surrender' : 'Close'}
            </button>
          </div>
        )}

        {state && <ElementCycleHint />}

        {toast && (
          <div style={{ borderRadius: 4, padding: '8px 10px', background: 'rgba(255,214,107,0.14)', border: '1px solid rgba(255,214,107,0.24)', fontWeight: 800 }}>
            {toast}
          </div>
        )}

        {initializing && !state && !queued && (
          <div style={{ ...arenaPanelStyle, padding: 12, textAlign: 'center', fontWeight: 900 }}>
            Reconnecting to Arena...
          </div>
        )}

        {!initializing && !state && !queued && (
          <div style={{ ...arenaPanelStyle, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ ...arenaSubPanelStyle, padding: 10 }}>
              <div style={{ fontWeight: 1000, fontSize: 20 }}>Element Duel</div>
              <div style={{ fontSize: 12, color: 'rgba(255,226,178,0.9)', marginTop: 3, fontWeight: 800 }}>
                25 ✦ stake · winner takes 50 ✦ · no energy
              </div>
              <div style={{ color: 'rgba(255,246,230,0.72)', marginTop: 4, fontWeight: 700, fontSize: 13 }}>
                Pick armor and attack. Correct armor blocks all damage.
              </div>
            </div>
            <ElementCycleHint />
            <button
              className="btn btn-primary"
              onClick={joinQueue}
              disabled={busy}
              style={{
                borderRadius: 4,
                animation: publicQueueActive ? 'arena-menu-pulse 1.15s ease-in-out infinite' : undefined,
              }}
            >
              {busy ? 'Searching...' : 'Find Fight'}
            </button>
            <button className="btn btn-secondary" onClick={createRoom} disabled={busy} style={{ borderRadius: 4 }}>
              Create Private Room
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="search-input"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Room code"
                maxLength={6}
                style={{ flex: 1, borderRadius: 4 }}
              />
              <button className="btn btn-primary" onClick={joinRoom} disabled={busy || !joinCode.trim()} style={{ borderRadius: 4 }}>
                Join
              </button>
            </div>
            <ArenaLeaderboard data={leaderboard} />
          </div>
        )}

        {queued && (
          <QueuePanel
            expiresAtMs={queueExpiresAtMs}
            busy={busy}
            onCancel={cancelQueue}
          />
        )}

        {state && (
          <>
            <ArenaStage state={state} isRevealing={isRevealing} previewArmor={previewArmor} />

            {state.match.status === 'waiting' && (
              <div style={{ ...arenaPanelStyle, padding: 10 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,246,230,0.72)', fontWeight: 800 }}>PRIVATE ROOM CODE</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 34, fontWeight: 1000, letterSpacing: '0.08em' }}>{state.match.joinCode}</div>
                  <button className="btn btn-secondary" onClick={copyRoomCode} style={{ borderRadius: 4, padding: '8px 10px' }}>
                    Copy
                  </button>
                </div>
                <div style={{ color: 'rgba(255,246,230,0.72)', fontWeight: 700, marginTop: 4 }}>Waiting for opponent...</div>
                <button className="btn btn-primary" onClick={() => setShowInvite(true)} style={{ width: '100%', marginTop: 10, borderRadius: 4 }}>
                  Invite Player
                </button>
              </div>
            )}

            {state.match.status === 'countdown' && (
              <CountdownPanel endsAt={state.match.countdownEndsAt} />
            )}

            {state.match.status === 'active' && !isRevealing && (
              <ChoicePanel
                state={state}
                onSubmit={submitChoice}
                loading={busy}
                onArmorPreviewChange={handleArmorPreviewChange}
              />
            )}

            {isRevealing && (
              <div style={{ ...arenaPanelStyle, padding: 10, textAlign: 'center', fontWeight: 900 }}>
                Attacking...
              </div>
            )}

            {state.match.status === 'finished' && !isRevealing && (
              <ResultPanel state={state} onClose={onClose} />
            )}

          </>
        )}
      </div>

      {showInvite && state?.match?.id && (
        <InviteSheet
          matchId={state.match.id}
          onClose={() => setShowInvite(false)}
          onToast={showToast}
        />
      )}
      {showGuide && <ArenaGuideSheet onClose={() => setShowGuide(false)} />}
    </div>
  );
}
