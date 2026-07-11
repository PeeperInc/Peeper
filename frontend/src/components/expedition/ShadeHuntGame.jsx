import React, { useEffect, useMemo, useRef, useState } from 'react';
import './ExpeditionMiniGames.css';

const TARGET_COUNT = 6;
const DEFAULT_DURATION_MS = 8000;
const FLASH_MS = 300;
const TARGET_RADIUS = 6.4;

function hashSeed(value) {
  let hash = 5381;
  for (const char of String(value || 'shade-hunt')) hash = Math.imul(hash, 33) ^ char.charCodeAt(0);
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTargets(seed) {
  const random = mulberry32(hashSeed(seed));
  const cells = [
    [16, 22], [50, 18], [82, 24],
    [19, 70], [50, 77], [81, 68],
  ];
  return cells.map(([x, y], index) => {
    const angle = random() * Math.PI * 2;
    const speed = 7 + random() * 4;
    return {
      id: index,
      x: x + (random() - 0.5) * 5,
      y: y + (random() - 0.5) * 5,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      shape: index % 3,
    };
  });
}

async function expectedTarget(seed) {
  const bytes = new TextEncoder().encode(`shade:${seed}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest)[0] % TARGET_COUNT;
}

function resolveMovement(source, deltaSeconds) {
  const next = source.map(target => ({
    ...target,
    x: target.x + target.vx * deltaSeconds,
    y: target.y + target.vy * deltaSeconds,
  }));

  for (const target of next) {
    if (target.x < TARGET_RADIUS) {
      target.x = TARGET_RADIUS;
      target.vx = Math.abs(target.vx);
    } else if (target.x > 100 - TARGET_RADIUS) {
      target.x = 100 - TARGET_RADIUS;
      target.vx = -Math.abs(target.vx);
    }
    if (target.y < TARGET_RADIUS) {
      target.y = TARGET_RADIUS;
      target.vy = Math.abs(target.vy);
    } else if (target.y > 100 - TARGET_RADIUS) {
      target.y = 100 - TARGET_RADIUS;
      target.vy = -Math.abs(target.vy);
    }
  }

  for (let first = 0; first < next.length; first += 1) {
    for (let second = first + 1; second < next.length; second += 1) {
      const a = next[first];
      const b = next[second];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 0.01;
      const minimum = TARGET_RADIUS * 2.12;
      if (distance >= minimum) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = (minimum - distance) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
      const aNormal = a.vx * nx + a.vy * ny;
      const bNormal = b.vx * nx + b.vy * ny;
      a.vx += (bNormal - aNormal) * nx;
      a.vy += (bNormal - aNormal) * ny;
      b.vx += (aNormal - bNormal) * nx;
      b.vy += (aNormal - bNormal) * ny;
    }
  }

  for (const target of next) {
    target.x = Math.max(TARGET_RADIUS, Math.min(100 - TARGET_RADIUS, target.x));
    target.y = Math.max(TARGET_RADIUS, Math.min(100 - TARGET_RADIUS, target.y));
  }

  return next;
}

/**
 * Persisted mini-game contract:
 * - seed: public deterministic seed returned by the server.
 * - retryKey: change to reset targets for a Mage retry while parent keeps the same attemptToken.
 * - onStart(): awaited before the 300ms target flash. It may return { seed } or { attempt: { seed } }.
 * - onFinish(result): called once with { success, score, reason, seed, targetIndex, selectedIndex }.
 */
export default function ShadeHuntGame({
  seed,
  retryKey = 0,
  durationMs = DEFAULT_DURATION_MS,
  disabled = false,
  onStart,
  onFinish,
}) {
  const [effectiveSeed, setEffectiveSeed] = useState(seed || 'shade-hunt');
  const initialTargets = useMemo(() => makeTargets(effectiveSeed), [effectiveSeed]);
  const [targets, setTargets] = useState(initialTargets);
  const [phase, setPhase] = useState('idle');
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const targetsRef = useRef(initialTargets);
  const lastFrameRef = useRef(0);
  const huntStartedRef = useRef(0);
  const huntDeadlineRef = useRef(0);
  const targetIndexRef = useRef(hashSeed(effectiveSeed) % TARGET_COUNT);
  const finishSentRef = useRef(false);
  const startingRef = useRef(false);
  const phaseRef = useRef('idle');
  const onFinishRef = useRef(onFinish);
  const lastResultRef = useRef(null);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    const nextSeed = seed || 'shade-hunt';
    const nextTargets = makeTargets(nextSeed);
    setEffectiveSeed(nextSeed);
    setTargets(nextTargets);
    targetsRef.current = nextTargets;
    targetIndexRef.current = hashSeed(nextSeed) % TARGET_COUNT;
    setPhase('idle');
    phaseRef.current = 'idle';
    setRemainingMs(durationMs);
    setStarting(false);
    setError('');
    startingRef.current = false;
    finishSentRef.current = false;
    huntStartedRef.current = 0;
    huntDeadlineRef.current = 0;
    lastResultRef.current = null;
    lastFrameRef.current = 0;
  }, [durationMs, retryKey, seed]);

  async function submitResult(result) {
    try {
      await onFinishRef.current?.(result);
    } catch (submitError) {
      finishSentRef.current = false;
      phaseRef.current = 'submit-error';
      setPhase('submit-error');
      setError(submitError?.message || 'Could not save the result');
    }
  }

  function finish(success, reason, selectedIndex = null) {
    if (finishSentRef.current) return;
    finishSentRef.current = true;
    const nextPhase = success ? 'success' : 'failed';
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
    const result = {
      success,
      score: success ? 100 : 0,
      reason,
      seed: effectiveSeed,
      targetIndex: targetIndexRef.current,
      selectedIndex,
    };
    lastResultRef.current = result;
    void submitResult(result);
  }

  useEffect(() => {
    let frameId = 0;
    const tick = now => {
      if (!lastFrameRef.current) lastFrameRef.current = now;
      const deltaSeconds = Math.min(0.035, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;
      const moved = resolveMovement(targetsRef.current, deltaSeconds);
      targetsRef.current = moved;
      setTargets(moved);

      if (phaseRef.current === 'hunting') {
        const remaining = Math.max(0, huntDeadlineRef.current - Date.now());
        setRemainingMs(remaining);
        if (remaining <= 0) finish(false, 'timeout');
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [durationMs, effectiveSeed]);

  async function start() {
    if (disabled || phaseRef.current !== 'idle' || startingRef.current || finishSentRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError('');
    try {
      const response = await onStart?.();
      const serverSeed = response?.attempt?.seed || response?.seed || effectiveSeed;
      if (serverSeed && serverSeed !== effectiveSeed) setEffectiveSeed(serverSeed);
      targetIndexRef.current = await expectedTarget(serverSeed);
      huntStartedRef.current = Number(response?.attempt?.startedAt || Math.floor(Date.now() / 1000)) * 1000;
      huntDeadlineRef.current = Number(response?.attempt?.expiresAt || 0) * 1000
        || huntStartedRef.current + durationMs;
      setRemainingMs(Math.max(0, huntDeadlineRef.current - Date.now()));
      const nextPhase = response?.resumed ? 'hunting' : 'flash';
      phaseRef.current = nextPhase;
      setPhase(nextPhase);
      if (response?.resumed) return;
      window.setTimeout(() => {
        if (finishSentRef.current || phaseRef.current !== 'flash') return;
        phaseRef.current = 'hunting';
        setPhase('hunting');
      }, FLASH_MS);
    } catch (startError) {
      setError(startError?.message || 'Could not begin the hunt');
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  function selectTarget(index) {
    if (phaseRef.current !== 'hunting' || finishSentRef.current) return;
    finish(index === targetIndexRef.current, index === targetIndexRef.current ? 'target_found' : 'wrong_target', index);
  }

  return (
    <section className={`expedition-minigame shade-hunt-game is-${phase}`} aria-label="Shade Hunt mini-game">
      <header className="expedition-minigame__header">
        <div>
          <span>SHADE HUNT</span>
          <strong>Track the marked eyes</strong>
        </div>
        <div className="expedition-minigame__timer" aria-label={`${Math.ceil(remainingMs / 1000)} seconds left`}>
          <b>{Math.ceil(remainingMs / 1000)}</b><small>SEC</small>
        </div>
      </header>

      <div className="shade-hunt-field">
        <div className="shade-hunt-mist" aria-hidden="true" />
        {targets.map(target => (
          <button
            type="button"
            className={`shade-hunt-target shade-shape-${target.shape}`}
            key={target.id}
            data-marked={phase === 'flash' && target.id === targetIndexRef.current ? 'true' : undefined}
            style={{ left: `${target.x}%`, top: `${target.y}%` }}
            onPointerDown={event => {
              event.preventDefault();
              selectTarget(target.id);
            }}
            disabled={phase !== 'hunting'}
            aria-label={`Moving shade ${target.id + 1}`}
          >
            <i className="shade-hunt-body" />
            <span className="shade-hunt-eyes"><i /><i /></span>
          </button>
        ))}

        {phase === 'idle' && (
          <div className="shade-hunt-start-panel">
            <span>Six shades. One marked gaze.</span>
            <button type="button" onClick={start} disabled={disabled || starting}>
              {starting ? 'OPENING SIGHT...' : 'START HUNT'}
            </button>
          </div>
        )}
        {phase === 'flash' && <div className="shade-hunt-flash-copy">REMEMBER THE EYES</div>}
        {phase === 'hunting' && <div className="shade-hunt-hunt-copy">TAP THE MARKED SHADE</div>}
        {phase === 'success' && <div className="expedition-minigame__result success"><b>SHADE EXPOSED</b><span>Your mark was true.</span></div>}
        {phase === 'failed' && <div className="expedition-minigame__result failed"><b>{remainingMs <= 0 ? 'THE TRAIL FADED' : 'FALSE SHADOW'}</b><span>The shades scatter into the crypt.</span></div>}
        {phase === 'submit-error' && (
          <div className="expedition-minigame__result failed">
            <b>SYNC INTERRUPTED</b>
            <button type="button" onClick={() => {
              if (!lastResultRef.current || finishSentRef.current) return;
              finishSentRef.current = true;
              setError('');
              void submitResult(lastResultRef.current);
            }}>Retry result</button>
          </div>
        )}
      </div>
      {error && <p className="expedition-minigame__error" role="alert">{error}</p>}
    </section>
  );
}
