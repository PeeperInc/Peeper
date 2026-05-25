/**
 * CATCH GAME — v2
 * 10 toys + 3 bombs fall throughout the full 10 seconds.
 * Catch ≥7 toys without hitting a bomb → Win → +5–10 coins (random).
 *
 * Fixes vs v1:
 * - Smooth falling via requestAnimationFrame on DOM nodes directly (no React
 *   state for position), so re-renders from the timer never cause jank.
 * - Items are spawned on a RAF-driven schedule spread evenly across the full
 *   10 s, so items are always visible and never bunch up at the end.
 * - Bombs are shuffled randomly among toys, not appended last.
 *
 * Custom sprites: /sprites/toy.png  /sprites/bomb_game.png  (any size, 48×48 display)
 */
import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { assetUrl } from '../utils/assetUrl';

const TOTAL_TOYS  = 10;
const TOTAL_BOMBS = 3;
const GAME_SECS   = 10;
const WIN_NEED    = 7;   // need to catch 7 toys
const WIN_COINS   = () => Math.floor(Math.random() * 6) + 5; // 5–10
const ITEM_PX     = 52;

// Each toy can have its own PNG: /sprites/toy_1.png, toy_2.png ... toy_10.png
// Falls back to emoji if PNG not uploaded yet.
const TOYS = [
  { id: 'game_toy_1',  emoji: '🎾' },
  { id: 'game_toy_2',  emoji: '⚽' },
  { id: 'game_toy_3',  emoji: '🏈' },
  { id: 'game_toy_4',  emoji: '🪀' },
  { id: 'game_toy_5',  emoji: '🧸' },
  { id: 'game_toy_6',  emoji: '⭐' },
  { id: 'game_toy_7',  emoji: '🎈' },
  { id: 'game_toy_8',  emoji: '🎀' },
  { id: 'game_toy_9',  emoji: '🏓' },
  { id: 'game_toy_10', emoji: '🪁' },
];

function Sprite({ spriteId, emoji }) {
  const [attempt, setAttempt] = useState(0); // 0=.png, 1=.PNG, 2=emoji
  const exts = ['.png', '.PNG'];
  if (attempt < 2) {
    const src = assetUrl(`/sprites/${spriteId}${exts[attempt]}`);
    return (
      <img src={src} alt=""
        onError={() => setAttempt(a => a + 1)}
        style={{ width: ITEM_PX, height: ITEM_PX, objectFit: 'contain', pointerEvents: 'none' }} />
    );
  }
  return <span style={{ fontSize: ITEM_PX * 0.8, lineHeight: 1, pointerEvents: 'none' }}>{emoji}</span>;
}

/** Build a shuffled spawn schedule so bombs are spread randomly */
function buildSchedule() {
  const types = [
    ...TOYS.map(t => ({ type: 'toy', spriteId: t.id, emoji: t.emoji })),
    ...Array.from({ length: TOTAL_BOMBS }, () => ({ type: 'bomb', spriteId: 'bomb_game', emoji: '💣' })),
  ];
  // Fisher-Yates
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }

  const total     = TOTAL_TOYS + TOTAL_BOMBS;
  const usableW   = window.innerWidth - ITEM_PX - 16;

  return types.map((t, i) => ({
    id:       i,
    type:     t.type,
    emoji:    t.emoji,
    spriteId: t.spriteId,
    // Spread evenly across 0 → (GAME_SECS - 2.5)s with small jitter
    spawnAt:  (i / total) * (GAME_SECS - 2.5) + (Math.random() * 0.5 - 0.25),
    x:        8 + Math.random() * usableW,   // px from left
    fallMs:   2400 + Math.random() * 1200,   // 2.4–3.6 s fall duration
    rotDir:   Math.random() > 0.5 ? 1 : -1,
  }));
}

/**
 * One falling item — position updated via RAF directly on the DOM element.
 * Never re-renders after mount, which is what keeps it jank-free.
 */
const FallingItem = memo(function FallingItem({ item, gameStartRef, onCatch, onMiss }) {
  const elRef    = useRef(null);
  const doneRef  = useRef(false);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let raf;

    function tick(now) {
      if (doneRef.current) return;

      const gameElapsed = (now - gameStartRef.current) / 1000;
      const itemElapsed = gameElapsed - item.spawnAt;

      if (itemElapsed < 0) {
        // Not yet time to spawn — keep hidden, schedule next frame
        el.style.display = 'none';
        raf = requestAnimationFrame(tick);
        return;
      }

      el.style.display = 'flex';

      const progress = itemElapsed / (item.fallMs / 1000);

      if (progress >= 1) {
        doneRef.current = true;
        onMiss(item.id);
        return;
      }

      const vh   = window.innerHeight + ITEM_PX + 20;
      const y    = -ITEM_PX + progress * vh;
      const rot  = item.rotDir * progress * 300;
      el.style.transform = `translateY(${y}px) rotate(${rot}deg)`;
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // run exactly once

  function handleTap(e) {
    e.stopPropagation();
    if (doneRef.current) return;
    doneRef.current = true;
    onCatch(item.id, item.type);
  }

  return (
    <div
      ref={elRef}
      onPointerDown={handleTap}
      style={{
        position:  'absolute',
        left:      item.x,
        top:       0,
        width:     ITEM_PX,
        height:    ITEM_PX,
        display:   'none',          // shown by RAF once spawnAt is reached
        alignItems: 'center',
        justifyContent: 'center',
        cursor:    'pointer',
        willChange:'transform',
        zIndex:    5,
        transform: `translateY(-${ITEM_PX}px)`,
      }}
    >
      <Sprite
        spriteId={item.spriteId}
        emoji={item.emoji}
      />
    </div>
  );
});

export default function CatchGame({ onComplete, onClose }) {
  const [winCoins, setWinCoins] = useState(0);
  const [phase,      setPhase]      = useState('playing');
  const [timeLeft,   setTimeLeft]   = useState(GAME_SECS);
  const [caughtN,    setCaughtN]    = useState(0);
  const [lostReason, setLostReason] = useState('');
  const [schedule]                  = useState(buildSchedule);
  const [visible,    setVisible]    = useState(schedule); // items still on screen

  const phaseRef     = useRef('playing');
  const caughtRef    = useRef(0);
  const gameStartRef = useRef(performance.now());

  // Countdown timer
  const completedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'playing') return;
    if (timeLeft <= 0) {
      const caught = caughtRef.current;
      const won    = caught >= WIN_NEED;
      phaseRef.current = won ? 'won' : 'lost';
      setPhase(won ? 'won' : 'lost');
      if (!won) setLostReason(`Only ${caught}/${TOTAL_TOYS} toys caught`);
      return;
    }
    const t = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, phase]);

  // Auto dismiss
  useEffect(() => {
    if (phase === 'playing') return;
    if (completedRef.current) return;
    completedRef.current = true;
    const won = phase === 'won';
    const earned = won ? WIN_COINS() : 0;
    const t   = setTimeout(() => onComplete(earned, won), 2200);
    if (won) setWinCoins(earned);
    return () => clearTimeout(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCatch = useCallback((id, type) => {
    if (phaseRef.current !== 'playing') return;
    setVisible(prev => prev.filter(i => i.id !== id));

    if (type === 'bomb') {
      phaseRef.current = 'lost';
      setPhase('lost');
      setLostReason('You hit a bomb! 💥');
      return;
    }
    caughtRef.current++;
    setCaughtN(c => c + 1);
  }, []);

  const handleMiss = useCallback((id) => {
    setVisible(prev => prev.filter(i => i.id !== id));
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'linear-gradient(180deg,#0d1b2a 0%,#1b2838 50%,#162032 100%)',
      overflow: 'hidden', userSelect: 'none', touchAction: 'none',
    }}>
      {/* HUD */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 20px 10px',
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
      }}>
        <div style={{ color: timeLeft <= 3 ? '#ff6b6b' : '#fff', fontSize: 22, fontWeight: 800, minWidth: 50 }}>
          ⏱{timeLeft}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>Catch Toys!</div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>Avoid 💣 bombs</div>
        </div>
        <div style={{ color: '#ffd700', fontSize: 18, fontWeight: 800, minWidth: 50, textAlign: 'right' }}>
          {caughtN}/{TOTAL_TOYS}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ position: 'absolute', top: 60, left: 20, right: 20, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 3, zIndex: 10 }}>
        <div style={{ height: '100%', borderRadius: 3, background: '#ffd700', width: `${(caughtN / TOTAL_TOYS) * 100}%`, transition: 'width 0.2s' }} />
      </div>

      {/* Items — each mounted once, never remounts */}
      {visible.map(item => (
        <FallingItem
          key={item.id}
          item={item}
          gameStartRef={gameStartRef}
          onCatch={handleCatch}
          onMiss={handleMiss}
        />
      ))}

      {/* Result overlay */}
      {phase !== 'playing' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30,
          background: phase === 'won'
            ? 'radial-gradient(circle, rgba(255,215,0,0.25) 0%, rgba(0,0,0,0.75) 100%)'
            : 'radial-gradient(circle, rgba(255,80,80,0.2) 0%, rgba(0,0,0,0.8) 100%)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14,
        }}>
          <div style={{ fontSize: 80 }}>{phase === 'won' ? '🎉' : '💥'}</div>
          <div style={{ color: '#fff', fontSize: 30, fontWeight: 900 }}>
            {phase === 'won' ? 'You Won!' : 'Game Over!'}
          </div>
          {phase === 'won' && (
            <div style={{ background: 'rgba(255,215,0,0.2)', border: '2px solid #ffd700', borderRadius: 6, padding: '8px 24px', color: '#ffd700', fontSize: 20, fontWeight: 800 }}>
              +{winCoins} ✦ coins!
            </div>
          )}
          {phase === 'lost' && lostReason && (
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 15 }}>{lostReason}</div>
          )}
        </div>
      )}

      {phase === 'playing' && (
        <button onClick={onClose} style={{
          position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
          color: 'rgba(255,255,255,0.6)', padding: '8px 28px', borderRadius: 6,
          fontSize: 13, cursor: 'pointer', zIndex: 10,
        }}>Quit</button>
      )}
    </div>
  );
}
