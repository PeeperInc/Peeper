/**
 * FLAPPY FROG
 * Canvas game — dodge pipes, collect sausages for coins.
 * Each sausage = 1 coin. Max 10 coins per session.
 * Collect all 10 sausages to win early.
 *
 * Custom hero sprite:
 *   Upload /sprites/frog_hero.png — recommended 72×72px, character centered.
 *   The actual hitbox is a circle ~40px in diameter (55% of 72px),
 *   centered in the PNG. Keep the important parts within that inner circle.
 */
import React, { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../utils/assetUrl';
import { generateCityWindowLayout } from './flappyScene.mjs';

const MAX_COINS  = 10;
const FROG_SYMBOL = '\u{1F438}';
const SAUSAGE_SYMBOL = '\u{1F32D}';
const SKULL_SYMBOL = '\u{1F480}';
const PARTY_SYMBOL = '\u{1F389}';
const COIN_SYMBOL = '\u2726';
const MULTIPLY_SYMBOL = '\u00D7';
const RIGHT_ARROW_SYMBOL = '\u2192';

export default function FlappyFrog({ onComplete, onClose }) {
  const canvasRef = useRef(null);
  const stateRef  = useRef('start'); // start | playing | dead
  const gameRef   = useRef(null);
  const [phase, setPhase]     = useState('start');  // start | playing | dead
  const [coins, setCoins]     = useState(0);
  const [score, setScore]     = useState(0); // sausages collected

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const H    = canvas.height;

    // ── Constants ───────────────────────────────────────────────────
    const GRAVITY   = 0.22;
    const JUMP      = -6.2;
    const HERO_R    = 36;      // display radius
    const HIT_R     = HERO_R * 0.55; // ~20px hitbox

    // ── Load hero PNG ────────────────────────────────────────────────
    const heroImg = new Image();
    heroImg.src   = assetUrl('/sprites/frog_hero.png');
    let heroLoaded = false;
    heroImg.onload  = () => { heroLoaded = true; };
    heroImg.onerror = () => { heroLoaded = false; };

    // ── State ────────────────────────────────────────────────────────
    let frog, obstacles, sausages, particles, clouds, stars;
    let cityFarBuildings, cityNearBuildings;
    let cityFarWindows, cityNearWindows;
    let cityOffset, frame, gameSpeed;
    let nextObs, nextSausage;
    let collected = 0;
    let skyGradient, groundGlowGradient;

    function ts() { return Math.floor(Date.now() / 1000); }

    // ── Init helpers ─────────────────────────────────────────────────
    function makeStars() {
      stars = [];
      for (let i = 0; i < 70; i++)
        stars.push({ x: Math.random()*W, y: Math.random()*H*0.55,
          r: Math.random()*1.4+0.3, a: Math.random()*0.9+0.1,
          phase: Math.random()*Math.PI*2 });
    }

    function makeClouds() {
      clouds = [];
      for (let i = 0; i < 4; i++)
        clouds.push({ x: Math.random()*W*1.5, y: 30+Math.random()*H*0.3,
          speed: 0.15+Math.random()*0.3, scale: 0.4+Math.random()*0.5,
          a: 0.06+Math.random()*0.14 });
    }

    function genCityLayer(count, minH, maxH, minW, maxW) {
      const out = []; let x = 0;
      while (x < W * 2.5) {
        const w = minW + Math.random()*(maxW-minW);
        const h = minH + Math.random()*(maxH-minH);
        out.push({ x, w, h }); x += w + Math.random()*4;
      }
      return out;
    }

    function reset() {
      frog       = { x: W*0.22, y: H/2, vy: 0 };
      obstacles  = [];
      sausages   = [];
      particles  = [];
      frame      = 0;
      gameSpeed  = 2.08;
      cityOffset = 0;
      nextObs    = 170;
      nextSausage = 90;
      collected  = 0;
      setScore(0); setCoins(0);
    }

    // ── Spawn ─────────────────────────────────────────────────────────
    function spawnObs() {
      const gapH = Math.max(135, 195 - collected * 3);
      const gapY = 70 + Math.random() * (H - gapH - 130);
      obstacles.push({ x: W+10, gapY, gapH, w: 58, passed: false });
    }

    function spawnSausage() {
      const y = 70 + Math.random()*(H-150);
      sausages.push({ x: W+20, y, rot: Math.random()*Math.PI,
        rotSpeed: (Math.random()-0.5)*0.07, done: false });
    }

    function spawnParticles(x, y, color, n=10) {
      for (let i=0; i<n; i++) {
        const a = Math.random()*Math.PI*2, sp = Math.random()*3+1;
        particles.push({ x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp-1.5,
          r: Math.random()*5+2, color, life: 1 });
      }
    }

    // ── Collision ─────────────────────────────────────────────────────
    function circleRect(cx,cy,cr, rx,ry,rw,rh) {
      const nx = Math.max(rx, Math.min(cx, rx+rw));
      const ny = Math.max(ry, Math.min(cy, ry+rh));
      const dx = cx-nx, dy = cy-ny;
      return dx*dx+dy*dy < cr*cr;
    }

    function checkDead() {
      const px=frog.x, py=frog.y;
      if (py - HIT_R < 0 || py + HIT_R > H) return true;
      for (const o of obstacles)
        if (circleRect(px,py,HIT_R, o.x,0,o.w,o.gapY) ||
            circleRect(px,py,HIT_R, o.x, o.gapY+o.gapH, o.w, H-o.gapY-o.gapH))
          return true;
      return false;
    }

    // ── Draw helpers ──────────────────────────────────────────────────
    function drawSky() {
      ctx.fillStyle = skyGradient;
      ctx.fillRect(0,0,W,H);
      // Moon
      ctx.save();
      ctx.shadowColor='rgba(255,240,180,0.5)'; ctx.shadowBlur=24;
      ctx.fillStyle='#fff8d0';
      ctx.beginPath(); ctx.arc(W-55,55,22,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    function drawStarLayer() {
      for (const s of stars) {
        const a = s.a * (0.6 + 0.4*Math.sin(frame*0.02+s.phase));
        ctx.globalAlpha = a;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function drawCityLayer(buildings, windowLayout, offsetX, yBase, color, winColor, alpha) {
      ctx.save(); ctx.globalAlpha = alpha;
      const totalW = buildings.reduce((s,b)=>s+b.w+4,0);
      const off = ((offsetX % totalW)+totalW) % totalW;
      for (let pass=0; pass<3; pass++) {
        let dx = -off + pass*totalW;
        for (let index = 0; index < buildings.length; index += 1) {
          const b = buildings[index];
          const windows = windowLayout[index] || [];
          const bh=b.h, bw=b.w, by=yBase-bh;
          ctx.fillStyle=color; ctx.fillRect(dx,by,bw,bh);
          ctx.fillStyle='rgba(255,255,255,0.06)'; ctx.fillRect(dx,by,bw,3);
          ctx.fillStyle=winColor;
          for (const windowRect of windows) {
            ctx.fillRect(dx + windowRect.x, by + windowRect.y, windowRect.w, windowRect.h);
          }
          dx += bw+4;
        }
      }
      ctx.restore();
    }

    function drawGround() {
      const gy = H-32;
      ctx.fillStyle='#0a0f1a'; ctx.fillRect(0,gy,W,32);
      ctx.fillStyle=groundGlowGradient; ctx.fillRect(0,gy,W,32);
    }

    function drawPipe(o) {
      // Top pipe
      const grad1 = ctx.createLinearGradient(o.x,0,o.x+o.w,0);
      grad1.addColorStop(0,'#2d7a2d'); grad1.addColorStop(0.5,'#4ab84a'); grad1.addColorStop(1,'#1f5a1f');
      ctx.fillStyle=grad1;
      ctx.beginPath(); ctx.roundRect(o.x-2,0,o.w+4,o.gapY,4); ctx.fill();
      // Cap
      ctx.fillStyle='#5dcc5d';
      ctx.beginPath(); ctx.roundRect(o.x-6,o.gapY-18,o.w+12,18,6); ctx.fill();
      // Bottom pipe
      const gy = o.gapY+o.gapH;
      ctx.fillStyle=grad1;
      ctx.beginPath(); ctx.roundRect(o.x-2,gy,o.w+4,H-gy,4); ctx.fill();
      ctx.fillStyle='#5dcc5d';
      ctx.beginPath(); ctx.roundRect(o.x-6,gy,o.w+12,18,6); ctx.fill();
    }

    function drawSausage(s) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      // Glow
      ctx.shadowColor='#ff8c00'; ctx.shadowBlur=12;
      // Body
      ctx.fillStyle='#c94c0a';
      ctx.beginPath(); ctx.ellipse(0,0,18,9,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#e06020';
      ctx.beginPath(); ctx.ellipse(-2,-2,10,4,0,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    function drawFrog(x, y, tilt) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tilt);
      if (heroLoaded) {
        const s = HERO_R*2;
        ctx.drawImage(heroImg, -s/2, -s/2, s, s);
      } else {
        // Fallback drawn frog
        ctx.fillStyle='#6DBF6A';
        ctx.beginPath(); ctx.arc(0,0,HERO_R,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#5BAD58';
        ctx.beginPath(); ctx.arc(-10,-10,10,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(10,-10,10,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#222';
        ctx.beginPath(); ctx.arc(-10,-10,5,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(10,-10,5,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='white';
        ctx.beginPath(); ctx.arc(-8,-12,2,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(12,-12,2,0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }

    function drawParticle(p) {
      ctx.save();
      ctx.globalAlpha=p.life; ctx.fillStyle=p.color;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r*p.life,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    function drawCloud(c) {
      ctx.save(); ctx.globalAlpha=c.a;
      ctx.fillStyle='#aabbdd';
      const x=c.x, y=c.y, s=c.scale;
      ctx.beginPath();
      ctx.arc(x,y,28*s,0,Math.PI*2); ctx.arc(x+22*s,y-5*s,20*s,0,Math.PI*2);
      ctx.arc(x-20*s,y-3*s,18*s,0,Math.PI*2);
      ctx.fill(); ctx.restore();
    }

    // ── HUD ───────────────────────────────────────────────────────────
    function drawHUD() {
      // Coin counter
      ctx.save();
      ctx.font='bold 20px system-ui';
      ctx.fillStyle='rgba(0,0,0,0.4)';
      ctx.fillRect(W/2-55, 10, 110, 32);
      ctx.fillStyle='#ffd700';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(`🌭 ${collected} / ${MAX_COINS} ✦`, W/2, 26);
      ctx.restore();
    }

    // ── Update ────────────────────────────────────────────────────────
    function update() {
      if (stateRef.current !== 'playing') return;
      frame++;
      gameSpeed = Math.min(4.4, 2.08 + collected*0.032);

      // Physics
      frog.vy += GRAVITY;
      frog.y  += frog.vy;

      // Clouds
      for (const c of clouds) {
        c.x -= c.speed;
        if (c.x < -120) { c.x=W+80; c.y=30+Math.random()*H*0.3; }
      }
      cityOffset += gameSpeed;

      // Spawn
      if (--nextObs <= 0) {
        spawnObs();
        nextObs = Math.max(95, 185 - collected*3);
      }
      if (--nextSausage <= 0 && collected < MAX_COINS) {
        spawnSausage();
        nextSausage = Math.max(75, 130 - collected*2);
      }

      // Obstacles
      for (const o of obstacles) {
        o.x -= gameSpeed;
        if (!o.passed && o.x+o.w < frog.x) o.passed = true;
      }
      obstacles = obstacles.filter(o => o.x+o.w > -10);

      // Sausages
      for (const s of sausages) {
        s.x -= gameSpeed*0.88;
        s.rot += s.rotSpeed;
        if (!s.done) {
          const dx=frog.x-s.x, dy=frog.y-s.y;
          if (dx*dx+dy*dy < (HIT_R+22)*(HIT_R+22)) {
            s.done = true;
            collected++;
            setScore(collected);
            setCoins(collected);
            spawnParticles(s.x,s.y,'#ff8c00',14);
            if (collected >= MAX_COINS) {
              // Won! collected all 10
              stateRef.current = 'dead';
              setPhase('won');
              return;
            }
          }
        }
      }
      sausages = sausages.filter(s => s.x > -40 && !s.done);

      // Particles
      for (const p of particles) { p.x+=p.vx; p.y+=p.vy; p.vy+=0.1; p.life-=0.035; }
      particles = particles.filter(p=>p.life>0);

      // Collision
      if (checkDead()) {
        stateRef.current = 'dead';
        spawnParticles(frog.x,frog.y,'#6DBF6A',18);
        spawnParticles(frog.x,frog.y,'#ff6b35',12);
        setPhase('dead');
      }
    }

    // ── Draw ──────────────────────────────────────────────────────────
    function draw() {
      drawSky();
      drawStarLayer();
      drawCityLayer(cityFarBuildings, cityFarWindows, cityOffset*0.25, H-32, '#0e1a30','rgba(255,230,120,0.7)',0.5);
      for (const c of clouds) drawCloud(c);
      drawCityLayer(cityNearBuildings, cityNearWindows, cityOffset*0.6, H-32, '#060d1a','rgba(255,200,80,0.55)',0.82);
      drawGround();
      for (const o of obstacles) drawPipe(o);
      for (const s of sausages)  drawSausage(s);
      for (const p of particles) drawParticle(p);
      const tilt = Math.max(-0.35, Math.min(0.3, frog.vy*0.045));
      if (stateRef.current === 'playing') drawFrog(frog.x, frog.y, tilt);
      else drawFrog(frog.x, frog.y, tilt);
      drawHUD();
    }

    // ── Loop ──────────────────────────────────────────────────────────
    let rafId;
    function loop() {
      update();
      draw();
      rafId = requestAnimationFrame(loop);
    }

    // ── Input ─────────────────────────────────────────────────────────
    function flap() {
      if (stateRef.current === 'playing') {
        frog.vy = JUMP;
        spawnParticles(frog.x-15, frog.y+25, 'rgba(150,220,255,0.7)', 4);
      }
    }

    function resetGame() {
      stateRef.current = 'start';
      reset();
      setPhase('start');
    }
    gameRef.current = { flap, resetGame };

    // ── Boot ──────────────────────────────────────────────────────────
    makeStars();
    makeClouds();
    skyGradient = ctx.createLinearGradient(0,0,0,H);
    skyGradient.addColorStop(0,'#03071e');
    skyGradient.addColorStop(0.4,'#0d1b4e');
    skyGradient.addColorStop(0.75,'#1a2a6e');
    skyGradient.addColorStop(1,'#0a1535');
    groundGlowGradient = ctx.createLinearGradient(0,H-32,0,H);
    groundGlowGradient.addColorStop(0,'rgba(255,120,30,0.15)');
    groundGlowGradient.addColorStop(1,'rgba(0,0,0,0)');
    cityFarBuildings  = genCityLayer(40,120,260,22,55);
    cityNearBuildings = genCityLayer(25,60,140,35,80);
    cityFarWindows = generateCityWindowLayout(cityFarBuildings);
    cityNearWindows = generateCityWindowLayout(cityNearBuildings);
    reset();
    loop();

    return () => { cancelAnimationFrame(rafId); };
  }, []);

  // ── Flap on canvas tap ──────────────────────────────────────────────
  function handleTap(e) {
    e.preventDefault();
    if (phase === 'start') {
      stateRef.current = 'playing';
      setPhase('playing');
      gameRef.current?.flap();
    } else if (phase === 'playing') {
      gameRef.current?.flap();
    }
  }

  function handleResult() {
    const earned = score; // sausages = coins
    onComplete(earned, earned > 0);
  }

  // Responsive canvas size
  const cW = Math.min(window.innerWidth, 420);
  const cH = Math.min(window.innerHeight - 60, 620);

  return (
    <div style={{ position:'fixed', inset:0, zIndex:200, background:'#000',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>

      <canvas ref={canvasRef} width={cW} height={cH}
        style={{ display:'block', borderRadius:12, touchAction:'none' }}
        onMouseDown={handleTap}
        onTouchStart={handleTap}
      />

      {/* Start overlay */}
      {phase === 'start' && (
        <div onClick={handleTap} style={OVERLAY}>
          <div style={{ fontSize:52, marginBottom:4 }}>{FROG_SYMBOL}</div>
          <div style={{ fontSize:36, fontWeight:900, color:'#6DBF6A',
            textShadow:'3px 3px 0 #000', letterSpacing:2, marginBottom:8 }}>
            FLAPPY FROG
          </div>
          <div style={{ color:'#aaffaa', fontSize:14, marginBottom:24 }}>
            Collect sausages for coins {SAUSAGE_SYMBOL}
          </div>
          <div style={{ color:'#fff', fontSize:18, fontWeight:700,
            animation:'blink 1s step-end infinite' }}>
            TAP to start
          </div>
          <div style={{ position:'absolute', bottom:16, color:'#888', fontSize:12 }}>
            PNG hitbox: 72{MULTIPLY_SYMBOL}72px centered
          </div>
          <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
        </div>
      )}

      {/* Dead overlay */}
      {phase === 'dead' && (
        <div style={OVERLAY}>
          <div style={{ fontSize:44, fontWeight:900, color:'#ff2244',
            textShadow:'3px 3px 0 #000', marginBottom:6 }}>{SKULL_SYMBOL} REKT</div>
          <div style={{ color:'#ffd700', fontSize:22, fontWeight:700, marginBottom:4 }}>
            {SAUSAGE_SYMBOL} Sausages: {score}
          </div>
          <div style={{ color:'#aaa', fontSize:14, marginBottom:20 }}>
            Collect to bank {score} {COIN_SYMBOL}, or retry for free!
          </div>
          <button onClick={handleResult} style={BTN_PRIMARY}>Collect & quit (+{score} {COIN_SYMBOL})</button>
          <button onClick={() => gameRef.current?.resetGame()} style={BTN_SEC}>Play again (free)</button>
        </div>
      )}

      {/* Win overlay */}
      {phase === 'won' && (
        <div style={OVERLAY}>
          <div style={{ fontSize:48, marginBottom:6 }}>{PARTY_SYMBOL}</div>
          <div style={{ fontSize:32, fontWeight:900, color:'#ffd700',
            textShadow:'3px 3px 0 #000', marginBottom:8 }}>MAX SCORE!</div>
          <div style={{ color:'#aaffaa', fontSize:18, fontWeight:700, marginBottom:24 }}>
            10 sausages {RIGHT_ARROW_SYMBOL} +10 {COIN_SYMBOL}
          </div>
          <button onClick={handleResult} style={BTN_PRIMARY}>Collect coins! (+10 {COIN_SYMBOL})</button>
          <button onClick={() => gameRef.current?.resetGame()} style={BTN_SEC}>Play again (free)</button>
        </div>
      )}

      {/* Close btn while playing */}
      {phase === 'playing' && (
        <button onClick={onClose}
          style={{ position:'absolute', top:10, right:14, background:'rgba(0,0,0,0.5)',
            border:'none', color:'#aaa', fontSize:22, cursor:'pointer', padding:'4px 10px',
            borderRadius:8, zIndex:10 }}>✕</button>
      )}
    </div>
  );
}

const OVERLAY = {
  position:'absolute', inset:0, display:'flex', flexDirection:'column',
  alignItems:'center', justifyContent:'center', background:'rgba(5,10,30,0.84)',
  borderRadius:12, cursor:'pointer',
};
const BTN_PRIMARY = {
  background:'var(--accent,#6DBF6A)', color:'#fff', border:'none', borderRadius:12,
  padding:'14px 36px', fontSize:17, fontWeight:700, cursor:'pointer', marginBottom:10,
};
const BTN_SEC = {
  background:'rgba(255,255,255,0.1)', color:'#fff', border:'1px solid rgba(255,255,255,0.2)',
  borderRadius:12, padding:'12px 30px', fontSize:15, cursor:'pointer',
};
