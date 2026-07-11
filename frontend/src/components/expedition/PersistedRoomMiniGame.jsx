import React, { useEffect, useRef, useState } from 'react';
import RootCrossingGame from './RootCrossingGame';
import ShadeHuntGame from './ShadeHuntGame';
import './ExpeditionMiniGames.css';

const RUNES = ['rune', 'root', 'moon', 'skull', 'crown', 'fang', 'lantern', 'key', 'eye'];
const RUNE_LABELS = { rune: 'R', root: 'RT', moon: 'M', skull: 'SK', crown: 'CR', fang: 'F', lantern: 'L', key: 'K', eye: 'E' };

async function runeSequence(seed) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`runes:${seed}`),
  ));
  const pool = [...RUNES];
  return [0, 1, 2].map(index => pool.splice(digest[index] % pool.length, 1)[0]);
}

function gameType(room) {
  const kind = room?.miniGame?.kind || 'timing_window';
  if (kind === 'path_pick') return 'root_crossing';
  if (kind === 'shadow_match') return 'shade_hunt';
  return kind;
}

export default function PersistedRoomMiniGame({ room, initialAttempt, mutating, disabled, onStart, onFinish }) {
  const kind = gameType(room);
  const [attempt, setAttempt] = useState(initialAttempt || null);
  const [retryKey, setRetryKey] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [marker, setMarker] = useState(8);
  const [direction, setDirection] = useState(1);
  const [charge, setCharge] = useState(0);
  const [focusTarget, setFocusTarget] = useState(50);
  const [sequence, setSequence] = useState([]);
  const [previewIndex, setPreviewIndex] = useState(-1);
  const [input, setInput] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [pendingResult, setPendingResult] = useState(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);
  const previewTimersRef = useRef([]);
  const terminalResetTimerRef = useRef(null);

  useEffect(() => {
    previewTimersRef.current.forEach(window.clearTimeout);
    previewTimersRef.current = [];
    if (terminalResetTimerRef.current) {
      window.clearTimeout(terminalResetTimerRef.current);
      terminalResetTimerRef.current = null;
    }
    setAttempt(initialAttempt || null);
    setRetryKey(0);
    setPhase('idle');
    setMarker(8);
    setDirection(1);
    setCharge(0);
    setSequence([]);
    setInput([]);
    setFeedback('');
    setPendingResult(null);
    setRemainingMs(initialAttempt?.expiresAt
      ? Math.max(0, Number(initialAttempt.expiresAt) * 1000 - Date.now())
      : 0);
    startingRef.current = false;
    finishingRef.current = false;
  }, [room?.key, kind]);

  useEffect(() => {
    if (initialAttempt?.attemptToken && attempt?.attemptToken !== initialAttempt.attemptToken) {
      setAttempt(initialAttempt);
    }
  }, [attempt?.attemptToken, initialAttempt]);

  useEffect(() => {
    if (!attempt?.expiresAt || ['done', 'submit-error'].includes(phase)) return undefined;
    const update = () => {
      const next = Math.max(0, Number(attempt.expiresAt) * 1000 - Date.now());
      setRemainingMs(next);
      if (next <= 0 && !finishingRef.current) {
        resolve({ success: false, score: 0, reason: 'timeout' }).catch(() => {});
      }
    };
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [attempt?.attemptToken, attempt?.expiresAt, phase]);

  useEffect(() => () => {
    previewTimersRef.current.forEach(window.clearTimeout);
    if (terminalResetTimerRef.current) window.clearTimeout(terminalResetTimerRef.current);
  }, []);

  useEffect(() => {
    if (!['timing', 'focus'].includes(phase)) return undefined;
    const timer = window.setInterval(() => {
      if (phase === 'timing') {
        setMarker(value => {
          const next = value + direction * 5;
          if (next >= 96) { setDirection(-1); return 96; }
          if (next <= 4) { setDirection(1); return 4; }
          return next;
        });
      } else {
        setCharge(value => Math.min(100, value + 3));
      }
    }, 45);
    return () => window.clearInterval(timer);
  }, [direction, phase]);

  async function begin() {
    if (attempt) return attempt;
    if (startingRef.current || disabled || mutating) return null;
    startingRef.current = true;
    setFeedback('');
    try {
      const response = await onStart(room.key);
      const nextAttempt = response?.attempt || null;
      if (!nextAttempt) throw new Error('The dungeon did not open the challenge');
      setAttempt(nextAttempt);
      setRemainingMs(Math.max(0, Number(nextAttempt.expiresAt) * 1000 - Date.now()));
      return nextAttempt;
    } finally {
      startingRef.current = false;
    }
  }

  async function resolve(result, sourceAttempt = attempt) {
    if (!sourceAttempt || finishingRef.current) return null;
    finishingRef.current = true;
    previewTimersRef.current.forEach(window.clearTimeout);
    previewTimersRef.current = [];
    setPreviewIndex(-1);
    setPendingResult(result);
    setFeedback('Resolving...');
    try {
      const response = await onFinish(room.key, sourceAttempt, { ...result, seed: sourceAttempt.seed });
      if (!response) {
        throw new Error('Connection lost. Retry the result.');
      }
      if (response?.attempt?.retry) {
        setAttempt(response.attempt);
        setRemainingMs(Math.max(0, Number(response.attempt.expiresAt) * 1000 - Date.now()));
        setRetryKey(value => value + 1);
        setPhase('idle');
        setInput([]);
        setFeedback('Bend Fate grants another chance.');
      } else {
        setAttempt(null);
        setPhase('done');
        setFeedback(response?.success ? 'Room cleared.' : 'Attempt spent. The room remains.');
        if (!response?.success) {
          terminalResetTimerRef.current = window.setTimeout(() => {
            terminalResetTimerRef.current = null;
            setRetryKey(value => value + 1);
          }, 700);
        }
      }
      setPendingResult(null);
      return response;
    } catch (finishError) {
      setPhase('submit-error');
      setFeedback(finishError?.message || 'Could not save the result.');
      throw finishError;
    } finally {
      finishingRef.current = false;
    }
  }

  async function startTiming() {
    const nextAttempt = await begin();
    if (!nextAttempt) return;
    setMarker(8);
    setDirection(1);
    setPhase('timing');
  }

  async function stopTiming() {
    if (phase !== 'timing') return;
    setPhase('resolving');
    const score = Math.max(0, Math.round(100 - Math.abs(marker - 50) * 2));
    try {
      await resolve({ success: score >= 60, score, reason: 'timing_stop' });
    } catch {}
  }

  async function startFocus() {
    const nextAttempt = await begin();
    if (!nextAttempt) return;
    const seedTotal = [...String(nextAttempt.seed)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    setFocusTarget(34 + (seedTotal % 49));
    setCharge(0);
    setPhase('focus');
  }

  async function releaseFocus() {
    if (phase !== 'focus') return;
    setPhase('resolving');
    const score = charge >= 99 ? 0 : Math.max(0, Math.round(100 - Math.abs(charge - focusTarget) * 2.25));
    try {
      await resolve({ success: score >= 60, score, reason: 'focus_release' });
    } catch {}
  }

  async function startRunes() {
    const nextAttempt = await begin();
    if (!nextAttempt) return;
    previewTimersRef.current.forEach(window.clearTimeout);
    previewTimersRef.current = [];
    const nextSequence = await runeSequence(nextAttempt.seed);
    setSequence(nextSequence);
    setInput([]);
    setPhase('preview');
    nextSequence.forEach((_, index) => {
      previewTimersRef.current.push(window.setTimeout(() => setPreviewIndex(index), index * 620));
    });
    previewTimersRef.current.push(window.setTimeout(() => {
      setPreviewIndex(-1);
      setPhase('runes');
    }, nextSequence.length * 620));
  }

  async function chooseRune(symbol) {
    if (phase !== 'runes' || finishingRef.current) return;
    const nextInput = [...input, symbol];
    setInput(nextInput);
    if (nextInput.length === 3) {
      setPhase('resolving');
      const success = nextInput.every((value, index) => value === sequence[index]);
      try {
        await resolve({ success, input: nextInput, reason: success ? 'sequence_matched' : 'wrong_sequence' });
      } catch {}
    }
  }

  const sharedProps = {
    retryKey,
    disabled: (disabled && !attempt) || mutating,
    onStart: async () => {
      const resumed = Boolean(attempt?.attemptToken);
      return { attempt: await begin(), resumed };
    },
    onFinish: result => resolve(result),
  };

  if (kind === 'root_crossing') return <RootCrossingGame {...sharedProps} />;
  if (kind === 'shade_hunt') return <ShadeHuntGame {...sharedProps} />;

  return (
    <section className={`expedition-minigame persisted-room-minigame is-${kind}`}>
      <header className="expedition-minigame__header">
        <div>
          <span>ROOM MINI-GAME</span>
          <strong>{room?.miniGame?.label || 'Dungeon challenge'}</strong>
        </div>
        <div className="expedition-minigame__timer">
          <b>{attempt ? Math.ceil(remainingMs / 1000) : 1}</b>
          <small>{attempt ? 'SEC' : 'AP'}</small>
        </div>
      </header>

      {kind === 'rune_sequence' ? (
        <>
          <div className="expedition-memory-cue">
            <span>{phase === 'preview' ? 'Memorize the three flashes' : phase === 'runes' ? 'Repeat the sequence' : 'The seal changes every attempt'}</span>
            <strong>{phase === 'runes' ? `${input.length}/3 entered` : '9 runes'}</strong>
          </div>
          <div className="expedition-rune-sequence">
            {RUNES.map(symbol => (
              <i key={symbol} className={phase === 'preview' && sequence[previewIndex] === symbol ? 'preview' : 'hidden'}>
                {RUNE_LABELS[symbol]}
              </i>
            ))}
          </div>
          <button type="button" className="btn btn-secondary expedition-minigame-start" onClick={startRunes} disabled={disabled || mutating || !['idle', 'done'].includes(phase)}>Start Runes</button>
          <div className="expedition-event-choice-grid">
            {RUNES.map(symbol => (
              <button type="button" key={symbol} onClick={() => chooseRune(symbol)} disabled={phase !== 'runes' || mutating}>
                <strong>{RUNE_LABELS[symbol]}</strong><span>{symbol}</span>
              </button>
            ))}
          </div>
        </>
      ) : kind === 'focus_hold' ? (
        <>
          <div className="expedition-focus-challenge" style={{ '--focus-charge': `${charge}%`, '--focus-target': `${focusTarget}%` }}>
            <div className="expedition-focus-target"><span>Target</span><strong>{focusTarget}</strong></div>
            <div className="expedition-focus-orb"><b /><span>{Math.round(charge)}</span></div>
            <div className="expedition-focus-meter"><i className="expedition-focus-sweet" /><b style={{ width: `${charge}%` }} /></div>
          </div>
          <div className="expedition-event-actions">
            <button type="button" className="btn btn-secondary" onClick={startFocus} disabled={disabled || mutating || !['idle', 'done'].includes(phase)}>Start Focus</button>
            <button type="button" className="btn btn-primary" onClick={releaseFocus} disabled={phase !== 'focus' || mutating}>Release</button>
          </div>
        </>
      ) : (
        <>
          <div className={`expedition-trap-challenge${phase === 'timing' ? ' active' : ''}`}>
            <div className="expedition-trap-lane"><span className="expedition-trap-safe-zone" /><span className="expedition-trap-runner" /><span className="expedition-trap-blade" style={{ left: `${marker}%` }}><i /><b /></span></div>
            <div className="expedition-trap-labels"><span>danger</span><strong>safe window</strong><span>danger</span></div>
          </div>
          <div className="expedition-event-actions">
            <button type="button" className="btn btn-secondary" onClick={startTiming} disabled={disabled || mutating || !['idle', 'done'].includes(phase)}>Start Trap</button>
            <button type="button" className="btn btn-primary" onClick={stopTiming} disabled={phase !== 'timing' || mutating}>Stop</button>
          </div>
        </>
      )}
      {feedback && <p className="expedition-minigame__feedback" aria-live="polite">{feedback}</p>}
      {phase === 'submit-error' && pendingResult && (
        <button
          type="button"
          className="btn btn-primary expedition-minigame-start"
          onClick={() => resolve(pendingResult).catch(() => {})}
          disabled={mutating}
        >
          Retry result
        </button>
      )}
    </section>
  );
}
