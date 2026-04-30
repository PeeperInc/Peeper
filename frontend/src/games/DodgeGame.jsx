/**
 * DODGE GAME — based on magnet_dodge_v3 logic
 * Blocks spawn from all 4 sides, speed ramps up over 10s.
 * Player follows finger/mouse with momentum.
 * Each dodged block = score. Survive 10s = win.
 * Coins = seconds survived (1 per second, max 10).
 */
import React, { useEffect, useRef, useState } from 'react';

const DURATION = 10;
const PR       = 16; // player radius

export default function DodgeGame({ onComplete, onClose }) {
  const canvasRef    = useRef(null);
  const phaseRef     = useRef('start');
  const startGameRef = useRef(null);
  const [phase, setPhase]       = useState('start');
  const [timeLeft, setTimeLeft] = useState(DURATION);
  const [earned, setEarned]     = useState(0);
  const [dodged, setDodged]     = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    let state = 'start';
    let px = W/2, py = H*0.6, tx = W/2, ty = H*0.6;
    let obs = [], elapsed = 0, score = 0, spawnT = 0, lastT = 0;
    let rafId, timerInterval;
    let currentTimeLeft = DURATION;

    // ── Input ──────────────────────────────────────────────────────────
    function ptr(e) {
      const r = canvas.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      tx = (src.clientX - r.left) * (W / r.width);
      ty = (src.clientY - r.top)  * (H / r.height);
    }
    function handlePointerMove(event) {
      ptr(event);
    }
    function handleTouchMove(event) {
      event.preventDefault();
      ptr(event);
    }

    // ── Spawn ──────────────────────────────────────────────────────────
    function spawn() {
      const side = Math.floor(Math.random() * 4);
      const baseSpd = 130 + elapsed * 16;
      const spd = Math.min(baseSpd, 240) + Math.random() * 40;
      let x, y, vx, vy;
      const w = 20 + Math.random() * 28, h = 12 + Math.random() * 12;
      if      (side === 0) { x = Math.random()*(W-w); y = -h;  vx = (Math.random()-.5)*50; vy = spd; }
      else if (side === 1) { x = W;  y = Math.random()*(H-h);  vx = -spd; vy = (Math.random()-.5)*50; }
      else if (side === 2) { x = Math.random()*(W-w); y = H;   vx = (Math.random()-.5)*50; vy = -spd; }
      else                 { x = -w; y = Math.random()*(H-h);  vx = spd;  vy = (Math.random()-.5)*50; }
      obs.push({ x, y, vx, vy, w, h });
    }

    // ── Draw ───────────────────────────────────────────────────────────
    function draw(tl) {
      ctx.fillStyle = '#0d1520'; ctx.fillRect(0, 0, W, H);

      // Timer bar
      ctx.fillStyle = '#1e2d42'; ctx.fillRect(16, 16, W-32, 8);
      const pct = Math.max(0, (tl ?? DURATION) / DURATION);
      ctx.fillStyle = pct > .3 ? '#378add' : '#e24b4a';
      ctx.beginPath(); ctx.roundRect(16, 16, (W-32)*pct, 8, 4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '13px sans-serif';
      ctx.textAlign = 'right'; ctx.fillText(Math.max(0, Math.ceil(tl ?? DURATION)) + 's', W-16, 14);
      ctx.textAlign = 'left';  ctx.fillText(score + ' dodged', 16, 50);

      // Blocks
      ctx.fillStyle = '#e24b4a';
      for (const o of obs) { ctx.beginPath(); ctx.roundRect(o.x, o.y, o.w, o.h, 3); ctx.fill(); }

      // Player
      ctx.fillStyle = '#378add'; ctx.beginPath(); ctx.arc(px, py, PR, 0, Math.PI*2); ctx.fill();

      // Frog face
      ctx.fillStyle = '#6DBF6A'; ctx.beginPath(); ctx.arc(px, py, PR, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(px-6, py-5, 4, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px+6, py-5, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(px-4, py-7, 1.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(px+8, py-7, 1.5, 0, Math.PI*2); ctx.fill();

      // Target dot (where finger is)
      ctx.strokeStyle = 'rgba(55,138,221,.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI*2); ctx.stroke();

      if (state === 'end' && tl > 0) {
        ctx.fillStyle = '#378add'; ctx.textAlign = 'center'; ctx.font = '500 14px sans-serif';
        ctx.fillText('Tap to retry', W/2, H-22);
      }
    }

    // ── Game loop ──────────────────────────────────────────────────────
    function loop(now) {
      if (state !== 'playing') return;
      const dt = Math.min((now - lastT) / 1000, .05); lastT = now; elapsed += dt;
      const tl = DURATION - elapsed;

      // Smooth follow (original magnet logic)
      const dx = tx - px, dy = ty - py, d = Math.sqrt(dx*dx + dy*dy);
      if (d > 1) { const s = Math.min(d*11, 600); px += (dx/d)*s*dt; py += (dy/d)*s*dt; }
      px = Math.max(PR, Math.min(W-PR, px));
      py = Math.max(PR, Math.min(H-PR, py));

      // Spawn
      spawnT -= dt;
      if (spawnT <= 0) {
        const burst = elapsed > 4 ? 2 : 1;
        for (let i = 0; i < burst; i++) spawn();
        spawnT = Math.max(.38, .62 - elapsed * .028);
      }

      // Move + collide
      for (let i = obs.length - 1; i >= 0; i--) {
        const o = obs[i];
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (o.x > W+60 || o.x < -60 || o.y > H+60 || o.y < -60) {
          obs.splice(i, 1); score++; setDodged(score); continue;
        }
        const cx = Math.max(o.x, Math.min(px, o.x+o.w));
        const cy = Math.max(o.y, Math.min(py, o.y+o.h));
        if ((px-cx)**2 + (py-cy)**2 < PR*PR) {
          state = 'end';
          const survived = Math.floor(elapsed);
          clearInterval(timerInterval);
          setEarned(survived);
          setPhase('dead');
          draw(tl);
          return;
        }
      }

      if (tl <= 0) {
        state = 'end';
        clearInterval(timerInterval);
        setEarned(DURATION);
        setPhase('won');
        draw(0);
        return;
      }

      draw(tl);
      rafId = requestAnimationFrame(loop);
    }

    // ── Start ──────────────────────────────────────────────────────────
    function startGame() {
      state = 'playing';
      phaseRef.current = 'playing';
      px = W/2; py = H*0.6; tx = W/2; ty = H*0.6;
      obs = []; elapsed = 0; score = 0; spawnT = 0;
      currentTimeLeft = DURATION;
      lastT = performance.now();
      setPhase('playing'); setDodged(0); setEarned(0); setTimeLeft(DURATION);

      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        currentTimeLeft--;
        setTimeLeft(currentTimeLeft);
        if (currentTimeLeft <= 0) clearInterval(timerInterval);
      }, 1000);

      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    }

    startGameRef.current = startGame;

    function handlePointerDown(event) {
      ptr(event);
      if (state !== 'playing') startGame();
    }
    function handleTouchStart(event) {
      event.preventDefault();
      ptr(event);
      if (state !== 'playing') startGame();
    }

    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });

    // Initial screen
    ctx.fillStyle = '#0d1520'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(13,21,32,.85)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '500 22px sans-serif';
    ctx.fillText('Magnet Dodge', W/2, H/2-36);
    ctx.font = '14px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.65)';
    ctx.fillText('The dot follows your finger.', W/2, H/2+4);
    ctx.fillText('Blocks come from all sides.', W/2, H/2+26);
    ctx.fillText('Survive 10 seconds.', W/2, H/2+48);
    ctx.fillStyle = '#378add'; ctx.font = '500 15px sans-serif';
    ctx.fillText('Tap to start', W/2, H/2+84);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(timerInterval);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('touchstart', handleTouchStart);
    };
  }, []);

  const cW = Math.min(window.innerWidth, 420);
  const cH = Math.min(window.innerHeight - 60, 560);

  return (
    <div style={{ position:'fixed', inset:0, zIndex:200, background:'#0d1520',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>

      <canvas ref={canvasRef} width={cW} height={cH}
        style={{ display:'block', borderRadius:12, touchAction:'none', cursor:'none' }} />

      {phase === 'start' && (
        <div style={OVL}
          onClick={() => startGameRef.current?.()}
          onTouchStart={e => { e.preventDefault(); startGameRef.current?.(); }}>
          <div style={{ fontSize:48, marginBottom:6 }}>🐸</div>
          <div style={{ fontSize:28, fontWeight:900, color:'#378add', marginBottom:8 }}>MAGNET DODGE</div>
          <div style={{ color:'#aaa', fontSize:14, marginBottom:6, textAlign:'center', lineHeight:1.6 }}>
            The dot follows your finger.<br/>Blocks come from all sides.<br/>Survive 10 seconds.
          </div>
          <div style={{ color:'#fff', fontSize:17, fontWeight:700, marginTop:12,
            animation:'blink 1s step-end infinite' }}>TAP to start</div>
          <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
        </div>
      )}

      {phase === 'dead' && (
        <div style={OVL}>
          <div style={{ fontSize:40, fontWeight:900, color:'#e24b4a', marginBottom:6 }}>💥 Hit!</div>
          <div style={{ color:'#aaa', fontSize:16, marginBottom:4 }}>Dodged {dodged} blocks</div>
          <div style={{ color:'#ffd700', fontSize:20, fontWeight:700, marginBottom:24 }}>+{earned} ✦ coins</div>
          <button onClick={() => onComplete(earned, earned > 0)} style={BTN_P}>Collect coins!</button>
        </div>
      )}

      {phase === 'won' && (
        <div style={OVL}>
          <div style={{ fontSize:48, marginBottom:6 }}>🎉</div>
          <div style={{ fontSize:28, fontWeight:900, color:'#ffd700', marginBottom:8 }}>SURVIVED!</div>
          <div style={{ color:'#aaffaa', fontSize:18, fontWeight:700, marginBottom:24 }}>10s → +10 ✦</div>
          <button onClick={() => onComplete(10, true)} style={BTN_P}>Collect coins!</button>
        </div>
      )}

      {phase === 'playing' && (
        <button onClick={onClose} style={{ position:'absolute', top:10, right:14,
          background:'rgba(0,0,0,0.5)', border:'none', color:'#aaa', fontSize:22,
          cursor:'pointer', padding:'4px 10px', borderRadius:8, zIndex:10 }}>✕</button>
      )}
    </div>
  );
}

const OVL  = { position:'absolute', inset:0, display:'flex', flexDirection:'column',
  alignItems:'center', justifyContent:'center', background:'rgba(5,10,25,0.88)', borderRadius:12 };
const BTN_P = { background:'var(--accent,#6DBF6A)', color:'#fff', border:'none',
  borderRadius:12, padding:'13px 32px', fontSize:16, fontWeight:700, cursor:'pointer', marginBottom:10, width:200 };
const BTN_S = { background:'rgba(255,255,255,0.1)', color:'#fff',
  border:'1px solid rgba(255,255,255,0.2)', borderRadius:12, padding:'11px 32px',
  fontSize:15, cursor:'pointer', width:200 };
