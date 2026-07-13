import React, { useEffect, useRef, useState } from 'react';
import RootCrossingGame from './RootCrossingGame';
import ShadeHuntGame from './ShadeHuntGame';
import './ExpeditionMiniGames.css';

const RUNES = ['rune', 'root', 'moon', 'skull', 'crown', 'fang', 'lantern', 'key', 'eye'];
const PASS_SCORE = 60;
const TIMING_TOLERANCE = 13;
const FOCUS_TOLERANCE = 7;

function precisionScore(value, target, tolerance) {
  const pointsPerUnit = (100 - PASS_SCORE) / tolerance;
  return Math.max(0, Math.round(100 - Math.abs(value - target) * pointsPerUnit));
}

function RuneGlyph({ symbol }) {
  const marks = {
    rune: <><path d="M24 5 11 16l6 7-7 12 14 8 14-8-7-12 6-7Z" /><path d="m17 23 7-8 7 8-7 12Z" /></>,
    root: <><path d="M24 5v19M24 15 13 10M24 18l10-8M24 23 12 16M24 25l-1 17M24 24l12 15" /><circle cx="24" cy="8" r="3" /></>,
    moon: <path d="M32 7c-8 3-12 10-10 18 2 7 8 11 16 10-4 6-12 9-19 5C9 35 6 23 12 14 16 8 24 5 32 7Z" />,
    skull: <><path d="M12 23c0-9 5-15 12-15s12 6 12 15c0 6-3 9-6 11v7H18v-7c-3-2-6-5-6-11Z" /><circle cx="19" cy="23" r="3" /><circle cx="29" cy="23" r="3" /><path d="m24 27-2 5h4ZM20 36v5M24 36v5M28 36v5" /></>,
    crown: <><path d="m8 15 9 8 7-14 7 14 9-8-4 23H12Z" /><path d="M13 33h22" /></>,
    fang: <><path d="M15 7c2 9 4 15 9 20 5-5 7-11 9-20 3 14 0 27-9 35-9-8-12-21-9-35Z" /><path d="M24 27v14" /></>,
    lantern: <><path d="M17 14h14l4 7v17H13V21Z" /><path d="M19 14V9h10v5M17 23h14M20 27c0-4 8-4 8 0v7h-8Z" /></>,
    key: <><circle cx="17" cy="18" r="9" /><path d="m23 24 16 16M31 32l5-5M35 36l5-5" /></>,
    eye: <><path d="M5 24c5-9 11-13 19-13s14 4 19 13c-5 9-11 13-19 13S10 33 5 24Z" /><circle cx="24" cy="24" r="6" /><circle cx="24" cy="24" r="2" /></>,
  };
  return <svg className="expedition-rune-glyph" viewBox="0 0 48 48" aria-hidden="true">{marks[symbol]}</svg>;
}

async function runeChallenge(seed) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`runes:${seed}`),
  ));
  const pool = [...RUNES];
  const sequence = [0, 1, 2].map(index => pool.splice(digest[index] % pool.length, 1)[0]);
  const choices = [...RUNES];
  for (let index = choices.length - 1; index > 0; index -= 1) {
    const swapIndex = digest[3 + (RUNES.length - 1 - index)] % (index + 1);
    [choices[index], choices[swapIndex]] = [choices[swapIndex], choices[index]];
  }
  return { sequence, choices };
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
  const [choiceRunes, setChoiceRunes] = useState(RUNES);
  const [previewIndex, setPreviewIndex] = useState(-1);
  const [input, setInput] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [pendingResult, setPendingResult] = useState(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const startingRef = useRef(false);
  const finishingRef = useRef(false);
  const phaseRef = useRef('idle');
  const chargeRef = useRef(0);
  const focusTargetRef = useRef(50);
  const focusHeldRef = useRef(false);
  const focusAttemptRef = useRef(null);
  const previewTimersRef = useRef([]);
  const terminalResetTimerRef = useRef(null);
  const timingStartedAtRef = useRef(0);

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
    setChoiceRunes(RUNES);
    setInput([]);
    setFeedback('');
    setPendingResult(null);
    setRemainingMs(initialAttempt?.expiresAt
      ? Math.max(0, Number(initialAttempt.expiresAt) * 1000 - Date.now())
      : 0);
    startingRef.current = false;
    finishingRef.current = false;
    phaseRef.current = 'idle';
    chargeRef.current = 0;
    focusTargetRef.current = 50;
    focusHeldRef.current = false;
    focusAttemptRef.current = null;
    timingStartedAtRef.current = 0;
  }, [room?.key, kind]);

  useEffect(() => {
    const source = `${room?.key || 'focus'}:${retryKey}`;
    const hash = [...source].reduce((total, char) => ((total * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
    const nextTarget = 34 + (hash % 49);
    setFocusTarget(nextTarget);
    focusTargetRef.current = nextTarget;
  }, [retryKey, room?.key]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    chargeRef.current = charge;
  }, [charge]);

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
          const elapsed = Math.max(0, Date.now() - timingStartedAtRef.current);
          const wave = (Math.sin(elapsed / 430) + 1) / 2;
          const speed = 1.8 + (wave * wave * 5.2);
          const next = value + direction * speed;
          if (next >= 96) { setDirection(-1); return 96; }
          if (next <= 4) { setDirection(1); return 4; }
          return next;
        });
      } else {
        setCharge(value => {
          const next = Math.min(100, value + 3);
          chargeRef.current = next;
          return next;
        });
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
        phaseRef.current = 'idle';
        setInput([]);
        setFeedback('Bend Fate grants another chance.');
      } else {
        setAttempt(null);
        setPhase('done');
        phaseRef.current = 'done';
        setFeedback(response?.success ? 'Room cleared.' : 'Attempt spent. The room remains.');
        terminalResetTimerRef.current = window.setTimeout(() => {
          terminalResetTimerRef.current = null;
          setRetryKey(value => value + 1);
          setPhase('idle');
          phaseRef.current = 'idle';
          setFeedback('');
        }, response?.success ? 900 : 700);
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
    timingStartedAtRef.current = Date.now();
    setPhase('timing');
  }

  async function stopTiming() {
    if (phase !== 'timing') return;
    setPhase('resolving');
    const score = precisionScore(marker, 50, TIMING_TOLERANCE);
    try {
      await resolve({ success: true, score, reason: 'timing_stop' });
    } catch {}
  }

  async function startFocus(event) {
    event?.preventDefault?.();
    if (!['idle', 'done'].includes(phaseRef.current) || focusHeldRef.current) return;
    focusHeldRef.current = true;
    if (event?.pointerId !== undefined) event.currentTarget?.setPointerCapture?.(event.pointerId);
    const nextAttempt = await begin();
    if (!nextAttempt) {
      focusHeldRef.current = false;
      return;
    }
    focusAttemptRef.current = nextAttempt;
    setCharge(0);
    chargeRef.current = 0;
    setPhase('focus');
    phaseRef.current = 'focus';
    if (!focusHeldRef.current) {
      setPhase('resolving');
      phaseRef.current = 'resolving';
      try {
        await resolve({ success: false, score: 0, reason: 'focus_released_early' }, nextAttempt);
      } catch {}
    }
  }

  async function releaseFocus(event) {
    event?.preventDefault?.();
    focusHeldRef.current = false;
    if (phaseRef.current !== 'focus') return;
    setPhase('resolving');
    phaseRef.current = 'resolving';
    const currentCharge = chargeRef.current;
    const score = currentCharge >= 99
      ? 0
      : precisionScore(currentCharge, focusTargetRef.current, FOCUS_TOLERANCE);
    try {
      await resolve(
        { success: true, score, reason: 'focus_release' },
        focusAttemptRef.current || attempt,
      );
    } catch {}
  }

  async function startRunes() {
    const nextAttempt = await begin();
    if (!nextAttempt) return;
    previewTimersRef.current.forEach(window.clearTimeout);
    previewTimersRef.current = [];
    const { sequence: nextSequence, choices } = await runeChallenge(nextAttempt.seed);
    setSequence(nextSequence);
    setChoiceRunes(choices);
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
    seed: room?.key || 'root-crossing',
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
                <RuneGlyph symbol={symbol} />
              </i>
            ))}
          </div>
          <button type="button" className="btn btn-secondary expedition-minigame-start" onClick={startRunes} disabled={disabled || mutating || !['idle', 'done'].includes(phase)}>Start Runes</button>
          <div className="expedition-event-choice-grid expedition-rune-choice-grid">
            {choiceRunes.map(symbol => (
              <button type="button" key={symbol} onClick={() => chooseRune(symbol)} disabled={phase !== 'runes' || mutating}>
                <strong><RuneGlyph symbol={symbol} /></strong><span>{symbol}</span>
              </button>
            ))}
          </div>
        </>
      ) : kind === 'focus_hold' ? (
        <>
          <div className="expedition-focus-challenge" style={{ '--focus-charge': `${charge}%`, '--focus-target': `${focusTarget}%` }}>
            <div className="expedition-focus-target"><span>Target</span><strong>{focusTarget}</strong></div>
            <div className="expedition-focus-orb"><b /><span>{Math.round(charge)}</span></div>
            <div className="expedition-focus-meter"><b style={{ width: `${charge}%` }} /></div>
          </div>
          <button
            type="button"
            className={`btn btn-primary expedition-focus-hold${phase === 'focus' ? ' is-holding' : ''}`}
            onPointerDown={startFocus}
            onPointerUp={releaseFocus}
            onPointerCancel={releaseFocus}
            onKeyDown={(event) => {
              if (!event.repeat && ['Enter', ' '].includes(event.key)) void startFocus(event);
            }}
            onKeyUp={(event) => {
              if (['Enter', ' '].includes(event.key)) void releaseFocus(event);
            }}
            disabled={disabled || (mutating && phase !== 'focus') || !['idle', 'done', 'focus'].includes(phase)}
          >
            <strong>{phase === 'focus' ? 'KEEP HOLDING' : 'HOLD TO FOCUS'}</strong>
            <span>{phase === 'focus' ? 'Release when the charge reaches the target' : 'Press and hold · costs 1 AP'}</span>
          </button>
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
