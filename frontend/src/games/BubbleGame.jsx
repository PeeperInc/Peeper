/**
 * BUBBLE POP GAME
 * 30 bubbles in a 5×6 grid. 5–10 randomly contain coins (hidden).
 * Tap to pop. 8s timer.
 * Pop ≥1 coin bubble → win, earn coins found.
 * Pop 0 coin bubbles → no energy spent.
 *
 * Sprite sizes:
 *   bubble.png / coin_bubble.png — recommended 80×80px (or 64×64 works too).
 *   The grid cells are ~(screenWidth-28)/5 px wide; sprites render at 80% of that.
 *   On a 390px screen: cell ≈ 72px → sprite renders at ~58px.
 *   64×64 uploads will look fine. 80×80 is sharper.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { assetUrl } from '../utils/assetUrl';

const COLS      = 5;
const ROWS      = 6;
const TOTAL     = COLS * ROWS; // 30
const GAME_SECS = 8;
const POP_ANIMATION_MS = 350;
const TAP_MOVE_TOLERANCE = 16;

// Random coin count each game: 5–10
function randomCoinCount() {
  return 5 + Math.floor(Math.random() * 6); // 5,6,7,8,9,10
}

function makeBubbles() {
  const coinCount = randomCoinCount();
  const indices   = Array.from({ length: TOTAL }, (_, i) => i);
  // Fisher-Yates shuffle
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const coinSet = new Set(indices.slice(0, coinCount));
  return {
    bubbles: Array.from({ length: TOTAL }, (_, i) => ({
      id: i, hasCoin: coinSet.has(i), state: 'intact',
    })),
    coinCount,
  };
}

function Sprite({ png, emoji, size }) {
  const [err, setErr] = useState(false);
  if (!err) return (
    <img src={assetUrl(png)} alt="" onError={() => setErr(true)}
      style={{ width: size, height: size, objectFit: 'contain', pointerEvents: 'none' }} />
  );
  return <span style={{ fontSize: typeof size === 'string' ? '1.8em' : size * 0.85, lineHeight: 1, pointerEvents: 'none' }}>{emoji}</span>;
}

export default function BubbleGame({ onComplete, onClose }) {
  const [{ bubbles, coinCount }] = useState(makeBubbles);
  const [bubblesState, setBubblesState] = useState(() => bubbles);
  const [timeLeft,   setTimeLeft]   = useState(GAME_SECS);
  const [phase,      setPhase]      = useState('playing');
  const [coinsFound, setCoinsFound] = useState(0);
  const [earnedCoins, setEarnedCoins] = useState(0);

  const phaseRef  = useRef('playing');
  const coinsRef  = useRef(0);
  const gesturesRef = useRef(new Map());

  // Timer
  useEffect(() => {
    if (phase !== 'playing') return;
    if (timeLeft <= 0) {
      phaseRef.current = 'ended';
      setPhase('ended');
      return;
    }
    const t = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, phase]);

  useEffect(() => {
    phaseRef.current = phase;
    if (phase !== 'playing') {
      gesturesRef.current.clear();
    }
  }, [phase]);

  // Auto-dismiss end screen
  const completedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'ended') return;
    if (completedRef.current) return;
    completedRef.current = true;
    const found = Math.min(coinsRef.current, coinCount, 10);
    const won   = found > 0;
    const earned = found;
    if (won) setEarnedCoins(earned);
    const t = setTimeout(() => onComplete(earned, won), 2400);
    return () => clearTimeout(t);
  }, [coinCount, onComplete, phase]);

  const popBubble = useCallback((id) => {
    if (phaseRef.current !== 'playing') return;
    setBubblesState(prev => {
      const b = prev[id];
      if (!b || b.state !== 'intact') return prev;
      if (b.hasCoin) {
        coinsRef.current = Math.min(coinsRef.current + 1, coinCount, 10);
        setCoinsFound(c => Math.min(c + 1, coinCount, 10));
      }
      return prev.map(b => b.id === id ? { ...b, state: 'popping' } : b);
    });
    setTimeout(() => {
      setBubblesState(prev => prev.map(b => b.id === id && b.state === 'popping' ? { ...b, state: 'popped' } : b));
    }, POP_ANIMATION_MS);
  }, [coinCount]);

  const handleBubblePointerDown = useCallback((e, bubble) => {
    if (phaseRef.current !== 'playing' || bubble.state !== 'intact') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    gesturesRef.current.set(bubble.id, {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      cancelled: false,
    });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const handleBubblePointerMove = useCallback((e, bubbleId) => {
    const gesture = gesturesRef.current.get(bubbleId);
    if (!gesture || gesture.pointerId !== e.pointerId || gesture.cancelled) return;
    const moved = Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY);
    if (moved > TAP_MOVE_TOLERANCE) {
      gesture.cancelled = true;
    }
  }, []);

  const clearBubbleGesture = useCallback((bubbleId, pointerId) => {
    const gesture = gesturesRef.current.get(bubbleId);
    if (!gesture) return null;
    if (pointerId != null && gesture.pointerId !== pointerId) return null;
    const wasCancelled = gesture.cancelled;
    gesturesRef.current.delete(bubbleId);
    return wasCancelled;
  }, []);

  const handleBubblePointerUp = useCallback((e, bubbleId) => {
    const wasCancelled = clearBubbleGesture(bubbleId, e.pointerId);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (wasCancelled === false) {
      popBubble(bubbleId);
    }
  }, [clearBubbleGesture, popBubble]);

  const handleBubblePointerCancel = useCallback((e, bubbleId) => {
    clearBubbleGesture(bubbleId, e.pointerId);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, [clearBubbleGesture]);

  const timerPct = (timeLeft / GAME_SECS) * 100;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'linear-gradient(180deg,#0a1628 0%,#0e2244 50%,#071020 100%)',
      overflow: 'hidden', userSelect: 'none', touchAction: 'manipulation',
      display: 'flex', flexDirection: 'column',
    }}>
      <style>{`
        @keyframes bg-pop {
          0%   { transform: scale(1);    opacity: 1; }
          40%  { transform: scale(1.35); opacity: 0.7; }
          100% { transform: scale(0.1);  opacity: 0; }
        }
        @keyframes coin-reveal {
          0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
          60%  { transform: scale(1.4) rotate(5deg);  opacity: 1; }
          100% { transform: scale(1)   rotate(0deg);  opacity: 1; }
        }
        @keyframes bg-bubble-float {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-6px); }
        }
      `}</style>

      {/* HUD */}
      <div style={{
        padding: '14px 20px 8px',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ color: timeLeft <= 3 ? '#ff6b6b' : '#fff', fontSize: 22, fontWeight: 800 }}>
            ⏱{timeLeft}s
          </div>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>Bubble Pop!</div>
          <div style={{ color: '#ffd700', fontSize: 18, fontWeight: 800 }}>
            ✦ {coinsFound}
          </div>
        </div>
        <div style={{ height: 5, background: 'rgba(255,255,255,0.15)', borderRadius: 3 }}>
          <div style={{
            height: '100%', borderRadius: 3,
            background: timeLeft <= 3 ? '#ff6b6b' : '#4fc3f7',
            width: `${timerPct}%`, transition: 'width 1s linear',
          }} />
        </div>
      </div>

      {/* Grid */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gap: 8,
        padding: '16px 14px',
        alignContent: 'center',
      }}>
        {bubblesState.map(b => (
          <button
            key={b.id}
            type="button"
            onPointerDown={(e) => handleBubblePointerDown(e, b)}
            onPointerMove={(e) => handleBubblePointerMove(e, b.id)}
            onPointerUp={(e) => handleBubblePointerUp(e, b.id)}
            onPointerCancel={(e) => handleBubblePointerCancel(e, b.id)}
            onLostPointerCapture={(e) => handleBubblePointerCancel(e, b.id)}
            disabled={phase !== 'playing' || b.state !== 'intact'}
            style={{
              aspectRatio: '1',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: b.state === 'intact' ? 'pointer' : 'default',
              position: 'relative',
              border: 'none',
              background: 'transparent',
              padding: 0,
              appearance: 'none',
              WebkitAppearance: 'none',
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'none',
            }}
          >
            {b.state === 'intact' && (
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: `bg-bubble-float ${2 + (b.id % 3) * 0.4}s ease-in-out infinite`,
              }}>
                <Sprite png="/sprites/bubble.png" emoji="🫧" size="80%" />
              </div>
            )}
            {b.state === 'popping' && (
              <div style={{ animation: 'bg-pop 0.35s ease-out forwards', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {b.hasCoin
                  ? <Sprite png="/sprites/coin_bubble.png" emoji="✦" size="80%" />
                  : <Sprite png="/sprites/bubble.png" emoji="💨" size="80%" />
                }
              </div>
            )}
            {b.state === 'popped' && b.hasCoin && (
              <div style={{ animation: 'coin-reveal 0.3s ease-out forwards', width: '80%', height: '80%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sprite png="/sprites/coin_bubble.png" emoji="✦" size="100%" />
              </div>
            )}
          </button>
        ))}
      </div>

      {/* End overlay */}
      {phase === 'ended' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30,
          background: coinsFound > 0
            ? 'radial-gradient(circle, rgba(255,215,0,0.2) 0%, rgba(0,0,0,0.85) 100%)'
            : 'rgba(0,0,0,0.85)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14,
        }}>
          <div style={{ fontSize: 72 }}>{coinsFound > 0 ? '💰' : '😶'}</div>
          <div style={{ color: '#fff', fontSize: 26, fontWeight: 900 }}>
            {coinsFound > 0 ? `Found ${coinsFound} coins!` : 'No coins found!'}
          </div>
          {coinsFound > 0 && (
            <div style={{ background: 'rgba(255,215,0,0.15)', border: '2px solid #ffd700', borderRadius: 6, padding: '8px 24px', color: '#ffd700', fontSize: 20, fontWeight: 800 }}>
              +{earnedCoins} ✦ earned!
            </div>
          )}
          {coinsFound === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>No energy spent — try again!</div>
          )}
        </div>
      )}

      {phase === 'playing' && (
        <button onClick={onClose} style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
          color: 'rgba(255,255,255,0.5)', padding: '7px 24px', borderRadius: 6,
          fontSize: 12, cursor: 'pointer', zIndex: 10,
        }}>Quit</button>
      )}
    </div>
  );
}
