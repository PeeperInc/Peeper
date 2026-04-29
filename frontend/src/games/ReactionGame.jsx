/**
 * REACTION GAME
 * 10 coins appear one by one at random positions, each for 1.5s.
 * Tap within: ≤0.5s = 1pt, ≤1.0s = 0.5pt, ≤1.5s = 0.3pt, miss = 0pt.
 * 0 hits → lose (no energy). ≥1 hit → win, earn ceil(totalScore) coins (max 10).
 *
 * Custom sprite: /sprites/coin_game.png
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { assetUrl } from '../utils/assetUrl';

const TOTAL_COINS    = 10;
const COIN_SHOW_MS   = 1500;
const PAUSE_BETWEEN  = 300; // ms gap between coins

function randomPos() {
  return {
    x: 12 + Math.random() * 70,  // % from left
    y: 18 + Math.random() * 55,  // % from top
  };
}

function Sprite({ png, emoji, size }) {
  const [err, setErr] = useState(false);
  if (!err) return (
    <img src={assetUrl(png)} alt="" onError={() => setErr(true)}
      style={{ width: size, height: size, objectFit: 'contain', pointerEvents: 'none' }} />
  );
  return <span style={{ fontSize: size * 0.85, lineHeight: 1, pointerEvents: 'none' }}>{emoji}</span>;
}

export default function ReactionGame({ onComplete, onClose }) {
  const [coinIdx,    setCoinIdx]    = useState(0);
  const [coinPos,    setCoinPos]    = useState(randomPos);
  const [visible,    setVisible]    = useState(false);
  const [tapped,     setTapped]     = useState(false);
  const [score,      setScore]      = useState(0);
  const [hits,       setHits]       = useState(0);
  const [phase,      setPhase]      = useState('starting'); // starting | playing | result
  const [lastPoints, setLastPoints] = useState(null);
  const [results,    setResults]    = useState([]); // per-coin results

  const shownAtRef = useRef(0);
  const timerRef   = useRef(null);
  const phaseRef   = useRef('starting');

  const advance = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
    setTapped(false);
    setLastPoints(null);

    setTimeout(() => {
      const next = coinIdx + 1;
      if (next >= TOTAL_COINS) {
        phaseRef.current = 'result';
        setPhase('result');
        return;
      }
      setCoinIdx(next);
      setCoinPos(randomPos());
    }, PAUSE_BETWEEN);
  }, [coinIdx]);

  // Show coin after a brief pause
  useEffect(() => {
    if (phase !== 'playing') return;
    const t = setTimeout(() => {
      shownAtRef.current = Date.now();
      setVisible(true);
    }, 100);
    return () => clearTimeout(t);
  }, [coinIdx, phase]);

  // Auto-advance when coin times out
  useEffect(() => {
    if (!visible || tapped) return;
    timerRef.current = setTimeout(() => {
      setResults(r => [...r, 'miss']);
      advance();
    }, COIN_SHOW_MS);
    return () => clearTimeout(timerRef.current);
  }, [visible, tapped, advance]);

  // Trigger game start
  useEffect(() => {
    if (phase !== 'starting') return;
    const t = setTimeout(() => {
      phaseRef.current = 'playing';
      setPhase('playing');
    }, 600);
    return () => clearTimeout(t);
  }, [phase]);

  // Result handling
  useEffect(() => {
    if (phase !== 'result') return;
    const totalHits = results.filter(r => r !== 'miss').length;
    const totalScore = results.reduce((acc, r) => {
      if (r === 'fast') return acc + 1;
      if (r === 'ok')   return acc + 0.5;
      if (r === 'slow') return acc + 0.3;
      return acc;
    }, 0);
    // Round up only if fraction >= 0.6 (e.g. 8.5 → 8, 8.6 → 9)
    const floored = Math.floor(totalScore);
    const fraction = totalScore - floored;
    const coins = fraction >= 0.6 ? floored + 1 : floored;
    const won   = totalHits > 0;
    const t = setTimeout(() => onComplete(Math.min(10, coins), won), 2800);
    return () => clearTimeout(t);
  }, [phase, results]); // eslint-disable-line react-hooks/exhaustive-deps

  const tapCoin = useCallback(() => {
    if (!visible || tapped || phaseRef.current !== 'playing') return;
    clearTimeout(timerRef.current);

    const elapsed = (Date.now() - shownAtRef.current) / 1000;
    let pts, label, resultType;
    if (elapsed <= 0.4)      { pts = 1;   label = '1.0 ✦';  resultType = 'fast'; }
    else if (elapsed <= 0.8) { pts = 0.5; label = '0.5 ✦';  resultType = 'ok';   }
    else                     { pts = 0.3; label = '0.3 ✦';  resultType = 'slow'; }

    setScore(s => s + pts);
    setHits(h => h + 1);
    setTapped(true);
    setLastPoints(label);
    setResults(r => [...r, resultType]);

    setTimeout(advance, 350);
  }, [visible, tapped, advance]);

  const totalHits = results.filter(r => r !== 'miss').length;
  const _floored = Math.floor(score);
  const finalCoins = Math.min(10, (score - _floored >= 0.6) ? _floored + 1 : _floored);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'linear-gradient(135deg,#1a0533 0%,#2d1b4e 50%,#1a0533 100%)',
      overflow: 'hidden', userSelect: 'none', touchAction: 'none',
    }}>
      <style>{`
        @keyframes rg-pop-in {
          0%   { transform: translate(-50%,-50%) scale(0.4); opacity: 0; }
          60%  { transform: translate(-50%,-50%) scale(1.15); opacity: 1; }
          100% { transform: translate(-50%,-50%) scale(1); opacity: 1; }
        }
        @keyframes rg-tapped {
          0%   { transform: translate(-50%,-50%) scale(1); opacity: 1; }
          100% { transform: translate(-50%,-50%) scale(2.2); opacity: 0; }
        }
        @keyframes rg-float-pts {
          0%   { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-40px); }
        }
        @keyframes rg-timer-shrink {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>

      {/* HUD */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '14px 20px 10px',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ color: '#fff', fontSize: 13, opacity: 0.7 }}>
          {phase === 'playing' ? `Coin ${coinIdx + 1} / ${TOTAL_COINS}` : 'Quick Grab'}
        </div>
        <div style={{ color: '#ffd700', fontSize: 18, fontWeight: 800 }}>
          Score: {score.toFixed(1)}
        </div>
      </div>

      {/* Coin timer bar */}
      {visible && !tapped && (
        <div style={{
          position: 'absolute', top: 58, left: 0, right: 0, height: 3,
          background: 'rgba(255,255,255,0.15)', zIndex: 10,
        }}>
          <div style={{
            height: '100%', background: '#ffd700', transformOrigin: 'left',
            animation: `rg-timer-shrink ${COIN_SHOW_MS}ms linear forwards`,
          }} />
        </div>
      )}

      {/* Coin */}
      {visible && phase === 'playing' && (
        <div
          onPointerDown={tapCoin}
          style={{
            position: 'absolute',
            left: `${coinPos.x}%`,
            top:  `${coinPos.y}%`,
            width: 72, height: 72,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: tapped
              ? 'rg-tapped 0.3s ease-out forwards'
              : 'rg-pop-in 0.2s ease-out forwards',
            zIndex: 20,
          }}
        >
          <Sprite png="/sprites/coin_game.png" emoji="🪙" size={64} />
        </div>
      )}

      {/* Floating score */}
      {lastPoints && (
        <div key={coinIdx} style={{
          position: 'absolute',
          left: `${coinPos.x}%`,
          top:  `${coinPos.y - 8}%`,
          transform: 'translateX(-50%)',
          color: '#ffd700', fontSize: 22, fontWeight: 900,
          animation: 'rg-float-pts 0.8s ease-out forwards',
          zIndex: 25, pointerEvents: 'none',
        }}>
          +{lastPoints}
        </div>
      )}

      {/* Starting screen */}
      {phase === 'starting' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
          padding: '0 32px',
        }}>
          <div style={{
            fontSize: 52, fontWeight: 900, color: '#ffd700',
            textAlign: 'center', letterSpacing: -1,
            textShadow: '0 0 30px rgba(255,215,0,0.5)',
          }}>
            QUICK<br/>GRAB!
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.85)', fontSize: 16, textAlign: 'center',
            lineHeight: 1.6, fontWeight: 600,
          }}>
            Coins appear one by one.<br/>Tap them as fast as possible!
          </div>
          <div style={{
            background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.3)',
            borderRadius: 14, padding: '12px 20px', textAlign: 'center',
          }}>
            <div style={{ color: '#ffd700', fontSize: 13, fontWeight: 700 }}>⚡ Under 0.5s = 1 coin</div>
            <div style={{ color: 'rgba(255,215,0,0.7)', fontSize: 12, marginTop: 3 }}>0.5–1s = 0.5 · 1–1.5s = 0.3</div>
          </div>
        </div>
      )}

      {/* Result overlay */}
      {phase === 'result' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 30,
          background: totalHits > 0
            ? 'radial-gradient(circle, rgba(255,215,0,0.2) 0%, rgba(0,0,0,0.85) 100%)'
            : 'radial-gradient(circle, rgba(100,0,0,0.2) 0%, rgba(0,0,0,0.85) 100%)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <div style={{ fontSize: 72 }}>{totalHits > 0 ? '💰' : '😅'}</div>
          <div style={{ color: '#fff', fontSize: 28, fontWeight: 900 }}>
            {totalHits > 0 ? `${totalHits}/${TOTAL_COINS} caught!` : 'No hits!'}
          </div>
          {totalHits > 0 && (
            <div style={{ background: 'rgba(255,215,0,0.15)', border: '2px solid #ffd700', borderRadius: 99, padding: '8px 24px', color: '#ffd700', fontSize: 20, fontWeight: 800 }}>
              +{finalCoins} ✦ coins!
            </div>
          )}
          {totalHits === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>No energy spent — try again!</div>
          )}
        </div>
      )}

      {phase === 'playing' && (
        <button onClick={onClose} style={{
          position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
          color: 'rgba(255,255,255,0.5)', padding: '8px 28px', borderRadius: 99,
          fontSize: 13, cursor: 'pointer', zIndex: 10,
        }}>Quit</button>
      )}
    </div>
  );
}
