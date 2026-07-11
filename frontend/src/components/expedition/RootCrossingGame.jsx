import React, { useEffect, useMemo, useRef, useState } from 'react';
import './ExpeditionMiniGames.css';

const LANE_COUNT = 6;
const DEFAULT_DURATION_MS = 15000;
const PLAYER_X = 50;

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || 'root-crossing')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
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

function buildLanes(seed) {
  const random = mulberry32(hashSeed(seed));
  return Array.from({ length: LANE_COUNT }, (_, laneIndex) => {
    const direction = laneIndex % 2 === 0 ? 1 : -1;
    const speed = 9.5 + random() * 6.5 + laneIndex * 0.45;
    const hazardCount = laneIndex < 2 ? 2 : 3;
    const hazards = Array.from({ length: hazardCount }, (_, hazardIndex) => ({
      id: `${laneIndex}-${hazardIndex}`,
      offset: (random() * 100 + hazardIndex * (100 / hazardCount)) % 100,
      width: 13 + random() * 6,
      variant: Math.floor(random() * 3),
    }));
    return { direction, speed, hazards };
  });
}

function wrap(value, span) {
  return ((value % span) + span) % span;
}

function hazardX(hazard, lane, elapsedSeconds) {
  const span = 126;
  return wrap(hazard.offset + lane.direction * lane.speed * elapsedSeconds + 13, span) - 13;
}

function laneProgress(row) {
  return Math.round((row / (LANE_COUNT + 1)) * 100);
}

/**
 * Persisted mini-game contract:
 * - seed: public deterministic seed returned by the server.
 * - retryKey: change this to reset the playfield for a Mage retry; do not change attemptToken upstream.
 * - onStart(): awaited before the first UP move. It may return { seed, expiresAt }.
 * - onFinish(result): called once with { success, score, reason, seed, rowsCrossed }.
 */
export default function RootCrossingGame({
  seed,
  retryKey = 0,
  durationMs = DEFAULT_DURATION_MS,
  disabled = false,
  onStart,
  onFinish,
}) {
  const [effectiveSeed, setEffectiveSeed] = useState(seed || 'root-crossing');
  const [row, setRow] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [starting, setStarting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState('');
  const startEpochRef = useRef(0);
  const endEpochRef = useRef(0);
  const moveLockRef = useRef(false);
  const lastResultRef = useRef(null);
  const finishSentRef = useRef(false);
  const startingRef = useRef(false);
  const rowRef = useRef(0);
  const onFinishRef = useRef(onFinish);
  const lanes = useMemo(() => buildLanes(effectiveSeed), [effectiveSeed]);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    setEffectiveSeed(seed || 'root-crossing');
    setRow(0);
    rowRef.current = 0;
    setPhase('idle');
    setElapsedMs(0);
    setStarting(false);
    setError('');
    startingRef.current = false;
    finishSentRef.current = false;
    startEpochRef.current = 0;
    endEpochRef.current = 0;
    moveLockRef.current = false;
    lastResultRef.current = null;
  }, [seed, retryKey]);

  async function submitResult(result) {
    try {
      await onFinishRef.current?.(result);
    } catch (submitError) {
      finishSentRef.current = false;
      setPhase('submit-error');
      setError(submitError?.message || 'Could not save the result');
    }
  }

  function finish(success, reason, finalRow = rowRef.current) {
    if (finishSentRef.current) return;
    finishSentRef.current = true;
    setPhase(success ? 'success' : 'failed');
    const score = success ? 100 : Math.max(0, laneProgress(finalRow));
    const result = {
      success,
      score,
      reason,
      seed: effectiveSeed,
      rowsCrossed: Math.min(LANE_COUNT, finalRow),
    };
    lastResultRef.current = result;
    void submitResult(result);
  }

  useEffect(() => {
    if (phase !== 'active') return undefined;
    let frameId = 0;

    const tick = () => {
      const elapsed = Math.max(0, Date.now() - startEpochRef.current);
      setElapsedMs(elapsed);

      if (Date.now() >= endEpochRef.current) {
        finish(false, 'timeout');
        return;
      }

      const currentRow = rowRef.current;
      if (currentRow > 0 && currentRow <= LANE_COUNT) {
        const lane = lanes[currentRow - 1];
        const elapsedSeconds = elapsed / 1000;
        const collided = lane.hazards.some(hazard => {
          const x = hazardX(hazard, lane, elapsedSeconds);
          return PLAYER_X + 3.8 >= x && PLAYER_X - 3.8 <= x + hazard.width;
        });
        if (collided) {
          finish(false, 'collision', currentRow);
          return;
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [effectiveSeed, lanes, phase]);

  async function ensureStarted() {
    if (phase === 'active') return true;
    if (phase !== 'idle' || startingRef.current || disabled) return false;
    startingRef.current = true;
    setStarting(true);
    setError('');
    try {
      const response = await onStart?.();
      const serverAttempt = response?.attempt || response;
      const serverSeed = serverAttempt?.seed;
      if (serverSeed) setEffectiveSeed(serverSeed);
      startEpochRef.current = Number(serverAttempt?.startedAt || Math.floor(Date.now() / 1000)) * 1000;
      endEpochRef.current = Number(serverAttempt?.expiresAt || 0) * 1000
        || startEpochRef.current + durationMs;
      setElapsedMs(Math.max(0, Date.now() - startEpochRef.current));
      setPhase('active');
      return true;
    } catch (startError) {
      setError(startError?.message || 'Could not start crossing');
      return false;
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  async function move(direction) {
    if (disabled || finishSentRef.current || startingRef.current || moveLockRef.current) return;
    if (direction === 1 && phase === 'idle') {
      const started = await ensureStarted();
      if (!started) return;
    } else if (phase !== 'active') {
      return;
    }

    const nextRow = Math.max(0, Math.min(LANE_COUNT + 1, rowRef.current + direction));
    moveLockRef.current = true;
    setMoving(true);
    window.setTimeout(() => {
      moveLockRef.current = false;
      setMoving(false);
    }, 260);
    rowRef.current = nextRow;
    setRow(nextRow);
    if (nextRow === LANE_COUNT + 1) finish(true, 'reached_exit', nextRow);
  }

  const elapsedSeconds = elapsedMs / 1000;
  const remaining = endEpochRef.current
    ? Math.max(0, endEpochRef.current - Date.now())
    : durationMs;
  const playerBottom = 4 + (row / (LANE_COUNT + 1)) * 88;

  return (
    <section className={`expedition-minigame root-crossing-game is-${phase}`} aria-label="Root Crossing mini-game">
      <header className="expedition-minigame__header">
        <div>
          <span>ROOT CROSSING</span>
          <strong>Slip between the living roots</strong>
        </div>
        <div className="expedition-minigame__timer" aria-label={`${Math.ceil(remaining / 1000)} seconds left`}>
          <b>{Math.ceil(remaining / 1000)}</b><small>SEC</small>
        </div>
      </header>

      <div className="root-crossing-field">
        <div className="root-crossing-exit"><span>CRYPT GATE</span></div>
        {lanes.map((lane, laneIndex) => (
          <div
            className={`root-crossing-lane lane-${laneIndex % 2 === 0 ? 'right' : 'left'}`}
            key={laneIndex}
            style={{ bottom: `${15 + laneIndex * 12.45}%` }}
          >
            <i className="root-crossing-lane__line" />
            {lane.hazards.map(hazard => (
              <span
                className={`root-crossing-hazard root-crossing-hazard--${hazard.variant}`}
                key={hazard.id}
                style={{
                  left: `${hazardX(hazard, lane, elapsedSeconds)}%`,
                  width: `${hazard.width}%`,
                }}
              >
                <i /><i /><i />
              </span>
            ))}
          </div>
        ))}
        <div className="root-crossing-start"><span>START</span></div>
        <div className="root-crossing-hero" style={{ bottom: `${playerBottom}%` }} aria-label={`Row ${row} of ${LANE_COUNT}`}>
          <i className="root-crossing-hero__aura" />
          <span>H</span>
        </div>
        {phase === 'idle' && <div className="root-crossing-callout">First UP starts the run and spends 1 AP</div>}
        {phase === 'success' && <div className="expedition-minigame__result success"><b>PASSAGE CLEARED</b><span>The roots close behind you.</span></div>}
        {phase === 'failed' && <div className="expedition-minigame__result failed"><b>{elapsedMs >= durationMs ? 'TOO SLOW' : 'ROOT STRIKE'}</b><span>Retry from the entrance.</span></div>}
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

      <div className="root-crossing-controls">
        <button type="button" onClick={() => move(1)} disabled={disabled || starting || moving || !['idle', 'active'].includes(phase)}>
          <span>UP</span><b>{starting ? 'ENTERING...' : 'MOVE'}</b>
        </button>
        <div className="root-crossing-progress" aria-hidden="true"><i style={{ height: `${laneProgress(row)}%` }} /></div>
        <button type="button" onClick={() => move(-1)} disabled={disabled || starting || moving || phase !== 'active' || row === 0}>
          <span>DN</span><b>MOVE</b>
        </button>
      </div>
      {error && <p className="expedition-minigame__error" role="alert">{error}</p>}
    </section>
  );
}
