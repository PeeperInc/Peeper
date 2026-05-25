import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import BottomSheet from '../components/BottomSheet';
import { useApp } from '../context/AppContext';
import { assetUrl } from '../utils/assetUrl';

const SPIN_COST = 5;
const JACKPOT_CONTRIBUTION = 1;
const SPIN_TOTAL_MS = 3000;
const REEL_STOP_MS = [1000, 2000, 3000];
const REEL_STRIP_LENGTHS = [18, 28, 38];
const REEL_SIZE_CSS = '88px';
const LEVER_PULL_MAX = 182;
const LEVER_TRIGGER_PULL = 148;
const LEVER_LANE_WIDTH = 58;
const CASINO_LAYOUT_WIDTH = 404;

const SYMBOLS = {
  game_toy_1: { fallback: '1', displayName: 'Toy 1' },
  game_toy_2: { fallback: '2', displayName: 'Toy 2' },
  game_toy_3: { fallback: '3', displayName: 'Toy 3' },
  game_toy_4: { fallback: '4', displayName: 'Toy 4' },
  game_toy_6: { fallback: '6', displayName: 'Toy 6' },
  game_toy_7: { fallback: '7', displayName: 'Toy 7' },
  game_toy_8: { fallback: '8', displayName: 'Toy 8' },
  game_toy_9: { fallback: '9', displayName: 'Toy 9' },
  game_toy_10: { fallback: '10', displayName: 'Toy 10' },
  sino: { fallback: 'S', displayName: 'Sino' },
};

const SYMBOL_IDS = Object.keys(SYMBOLS);
const ORDINARY_SYMBOL_IDS = SYMBOL_IDS.filter((symbolId) => symbolId !== 'sino');

const COMBINATIONS = [
  {
    id: 'aab',
    symbols: ['game_toy_1', 'game_toy_1', 'game_toy_3'],
    payout: `8 \u2726`,
    caption: 'Any ordinary pair',
  },
  {
    id: 'sab',
    symbols: ['sino', 'game_toy_4', 'game_toy_7'],
    payout: `10 \u2726`,
    caption: 'One Sino + two different toys',
  },
  {
    id: 'aaa',
    symbols: ['game_toy_6', 'game_toy_6', 'game_toy_6'],
    payout: `12 \u2726`,
    caption: 'Three matching toys',
  },
  {
    id: 'aas',
    symbols: ['game_toy_8', 'game_toy_8', 'sino'],
    payout: `13 \u2726`,
    caption: 'Pair + Sino',
  },
  {
    id: 'ssa',
    symbols: ['sino', 'sino', 'game_toy_10'],
    payout: `15 \u2726 + Free Spin`,
    caption: 'Two Sino + one toy',
  },
  {
    id: 'sss',
    symbols: ['sino', 'sino', 'sino'],
    payout: 'Jackpot',
    caption: 'Three Sino symbols',
    jackpot: true,
  },
];

function formatCoins(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(Number(value) || 0)));
}

function randomSymbolId() {
  return SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)];
}

function shuffle(array) {
  const next = [...array];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function pickDistinctOrdinaryRow() {
  return shuffle(ORDINARY_SYMBOL_IDS).slice(0, 3);
}

function buildVisibleColumns(centerRow) {
  const topRow = pickDistinctOrdinaryRow();
  let bottomRow = pickDistinctOrdinaryRow();

  while (bottomRow.join('|') === topRow.join('|')) {
    bottomRow = pickDistinctOrdinaryRow();
  }

  return centerRow.map((centerSymbol, index) => [topRow[index], centerSymbol, bottomRow[index]]);
}

function buildRandomIdleColumns() {
  return buildVisibleColumns([randomSymbolId(), randomSymbolId(), randomSymbolId()]);
}

function buildAssetCandidates(names) {
  const normalizedNames = Array.isArray(names) ? names.filter(Boolean) : [names].filter(Boolean);
  const extensions = ['.png', '.gif', '.PNG', '.GIF'];
  return normalizedNames.flatMap((name) => extensions.map((ext) => assetUrl(`/sprites/${name}${ext}`)));
}

function useAssetCandidates(names) {
  const cacheKey = Array.isArray(names) ? names.join('|') : names || '';
  return useMemo(() => buildAssetCandidates(names), [cacheKey]);
}

function SpriteAsset({ candidateNames, alt, width, height, style, fallback = null }) {
  const [attempt, setAttempt] = useState(0);
  const candidates = useAssetCandidates(candidateNames);
  const src = candidates[attempt] || null;

  useEffect(() => {
    setAttempt(0);
  }, [candidates]);

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        onError={() => setAttempt((value) => value + 1)}
        style={{
          width,
          height,
          objectFit: 'contain',
          display: 'block',
          pointerEvents: 'none',
          ...style,
        }}
      />
    );
  }

  return fallback;
}

function SlotSymbol({ symbolId, size = 90 }) {
  const meta = SYMBOLS[symbolId] || { fallback: '?', displayName: symbolId || 'Slot symbol' };
  const fallbackFontSize = typeof size === 'number' ? size * 0.42 : 'clamp(24px, 4.8vw, 34px)';

  return (
    <SpriteAsset
      candidateNames={[symbolId]}
      alt={meta.displayName}
      width={size}
      height={size}
      fallback={(
        <div
          style={{
            width: size,
            height: size,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: fallbackFontSize,
            fontWeight: 900,
            color: '#314126',
            lineHeight: 1,
            pointerEvents: 'none',
          }}
        >
          {meta.fallback}
        </div>
      )}
    />
  );
}

function CasinoLogo() {
  return (
    <SpriteAsset
      candidateNames={['sinofull', 'sino']}
      alt="caSino"
      width="min(54vw, 220px)"
      height="min(20vw, 88px)"
      fallback={(
        <div
          style={{
            minWidth: 110,
            minHeight: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SlotSymbol symbolId="sino" size={82} />
        </div>
      )}
    />
  );
}

function buildReelPlan(finalColumn, reelIndex) {
  const filler = Array.from({ length: REEL_STRIP_LENGTHS[reelIndex] }, () => randomSymbolId());
  return {
    sequence: [...filler, ...finalColumn],
    durationMs: REEL_STOP_MS[reelIndex],
  };
}

function Reel({ column, plan, animate }) {
  const idleSequence = useMemo(() => column, [column]);
  const sequence = plan?.sequence || idleSequence;
  const translate = plan && animate
    ? `calc(var(--casino-reel-size) * -${sequence.length - 3})`
    : '0px';

  return (
    <div
      style={{
        '--casino-reel-size': REEL_SIZE_CSS,
        width: 'var(--casino-reel-size)',
        height: 'calc(var(--casino-reel-size) * 3)',
        minWidth: 0,
        borderRadius: 7,
        overflow: 'hidden',
        position: 'relative',
        background: 'linear-gradient(180deg, rgba(255,248,214,0.98) 0%, rgba(231,246,217,0.98) 52%, rgba(214,236,201,0.98) 100%)',
        border: '2px solid rgba(255,255,255,0.42)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.62), inset 0 -14px 26px rgba(84,120,69,0.12), 0 10px 20px rgba(0,0,0,0.16)',
      }}
    >
      <div
        className="casino-reel-strip"
        style={{
          '--casino-reel-duration': plan ? `${plan.durationMs}ms` : '0ms',
          display: 'flex',
          flexDirection: 'column',
          transform: `translate3d(0, ${translate}, 0)`,
          transition: plan
            ? `transform ${plan.durationMs}ms cubic-bezier(0.1, 0.9, 0.2, 1)`
            : 'none',
          willChange: plan ? 'transform' : 'auto',
          backfaceVisibility: 'hidden',
          contain: 'layout paint style',
        }}
      >
        {sequence.map((symbolId, index) => (
          <div
            key={`${symbolId}-${index}`}
            style={{
              width: 'var(--casino-reel-size)',
              height: 'var(--casino-reel-size)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <SlotSymbol symbolId={symbolId} size="calc(var(--casino-reel-size) * 0.72)" />
          </div>
        ))}
      </div>

      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'linear-gradient(180deg, rgba(14,24,16,0.32) 0%, rgba(14,24,16,0.12) 9%, rgba(255,255,255,0) 18%, rgba(255,255,255,0) 82%, rgba(14,24,16,0.12) 91%, rgba(14,24,16,0.32) 100%)',
        }}
      />
    </div>
  );
}

function CombosSheet({ onClose }) {
  return (
    <BottomSheet
      onClose={onClose}
      bodyStyle={{
        width: 'min(calc(100% - 18px), 392px)',
        maxHeight: 'min(68dvh, 500px)',
        alignSelf: 'center',
        margin: '0 auto 10px',
        borderRadius: 9,
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: 0,
        border: '1px solid var(--border)',
        boxShadow: '0 20px 48px rgba(0,0,0,0.24)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: '0 14px 14px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            paddingBottom: 10,
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4 }}>
              caSino combos
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              Every spin wins. More matches and more Sino symbols mean better payouts.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              borderRadius: 5,
              border: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
              fontSize: 16,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorY: 'contain',
            paddingRight: 2,
            paddingBottom: 'calc(var(--tg-safe-bottom) + 4px)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {COMBINATIONS.map((combo) => (
              <div
                key={combo.id}
                style={{
                  borderRadius: 7,
                  padding: '11px 12px',
                  background: combo.jackpot
                    ? 'linear-gradient(180deg, rgba(255,223,130,0.18) 0%, rgba(255,223,130,0.08) 100%)'
                    : 'var(--bg-card)',
                  border: `1px solid ${combo.jackpot ? 'rgba(255,214,102,0.34)' : 'var(--border)'}`,
                  boxShadow: combo.jackpot ? '0 10px 24px rgba(240,184,76,0.12)' : 'var(--shadow-xs)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      minWidth: 0,
                      padding: '6px 8px',
                      borderRadius: 5,
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {combo.symbols.map((symbolId, index) => (
                      <SlotSymbol key={`${combo.id}-${symbolId}-${index}`} symbolId={symbolId} size={24} />
                    ))}
                  </div>

                  <div
                    style={{
                      flexShrink: 0,
                      borderRadius: 5,
                      padding: '6px 10px',
                      background: combo.jackpot ? 'rgba(240,184,76,0.16)' : 'var(--bg-secondary)',
                      color: combo.jackpot ? '#d79a22' : 'var(--text-primary)',
                      fontSize: 15,
                      fontWeight: 900,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {combo.payout}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 7, lineHeight: 1.4 }}>
                  {combo.caption}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}

export default function CasinoGame({ onClose }) {
  const { casinoJackpot, casinoFreeSpins, spinCasino, getCasinoState } = useApp();
  const [displayedJackpot, setDisplayedJackpot] = useState(casinoJackpot || 0);
  const [reels, setReels] = useState(() => buildRandomIdleColumns());
  const [spinPlan, setSpinPlan] = useState(null);
  const [spinMotion, setSpinMotion] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState(null);
  const [jackpotPulse, setJackpotPulse] = useState(false);
  const [showCombos, setShowCombos] = useState(false);
  const [leverPull, setLeverPull] = useState(0);
  const [leverDragging, setLeverDragging] = useState(false);
  const [leverHintDismissed, setLeverHintDismissed] = useState(false);

  const mountedRef = useRef(true);
  const viewportRef = useRef(null);
  const layoutRef = useRef(null);
  const animationTimeoutRef = useRef(null);
  const rafIdsRef = useRef([]);
  const leverPointerIdRef = useRef(null);
  const leverStartYRef = useRef(0);
  const leverTriggeredRef = useRef(false);
  const [layoutScale, setLayoutScale] = useState(1);
  const [layoutHeight, setLayoutHeight] = useState(null);

  const clearAnimationTimers = useCallback(() => {
    if (animationTimeoutRef.current) {
      clearTimeout(animationTimeoutRef.current);
      animationTimeoutRef.current = null;
    }
    rafIdsRef.current.forEach((id) => cancelAnimationFrame(id));
    rafIdsRef.current = [];
  }, []);

  const syncJackpot = useCallback(async () => {
    try {
      const resultState = await getCasinoState();
      if (mountedRef.current && typeof resultState?.casinoJackpot === 'number') {
        setDisplayedJackpot(resultState.casinoJackpot);
      }
    } catch {
      // ignore background sync failures
    }
  }, [getCasinoState]);

  const recomputeLayoutScale = useCallback(() => {
    const viewport = viewportRef.current;
    const layout = layoutRef.current;
    if (!viewport || !layout) return;

    const availableWidth = Math.max(0, viewport.clientWidth - 12);
    const availableHeight = Math.max(0, viewport.clientHeight - 12);
    const naturalWidth = layout.offsetWidth || CASINO_LAYOUT_WIDTH;
    const naturalHeight = layout.offsetHeight || 0;

    if (!naturalHeight) return;

    const nextScale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);
    const safeScale = Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1;

    setLayoutScale(safeScale);
    setLayoutHeight(Math.ceil(naturalHeight * safeScale));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearAnimationTimers();
    };
  }, [clearAnimationTimers]);

  useLayoutEffect(() => {
    recomputeLayoutScale();

    const viewport = viewportRef.current;
    const layout = layoutRef.current;
    const observers = [];

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        recomputeLayoutScale();
      });
      if (viewport) observer.observe(viewport);
      if (layout) observer.observe(layout);
      observers.push(observer);
    }

    window.addEventListener('resize', recomputeLayoutScale);
    window.addEventListener('orientationchange', recomputeLayoutScale);

    return () => {
      observers.forEach((observer) => observer.disconnect());
      window.removeEventListener('resize', recomputeLayoutScale);
      window.removeEventListener('orientationchange', recomputeLayoutScale);
    };
  }, [recomputeLayoutScale]);

  useEffect(() => {
    if (!spinning) {
      setDisplayedJackpot(casinoJackpot || 0);
    }
  }, [casinoJackpot, spinning]);

  useEffect(() => {
    if (spinning) {
      setLeverPull(LEVER_PULL_MAX * 0.72);
    } else if (!leverDragging) {
      setLeverPull(0);
    }
  }, [leverDragging, spinning]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!spinning) syncJackpot();
    }, 8000);
    return () => window.clearInterval(id);
  }, [spinning, syncJackpot]);

  const beginSpinAnimation = useCallback((finalSymbols, spinResult, optimisticJackpot) => {
    clearAnimationTimers();
    const finalColumns = buildVisibleColumns(finalSymbols);
    const nextPlan = finalColumns.map((column, index) => buildReelPlan(column, index));

    setSpinMotion(false);
    setSpinPlan(nextPlan);

    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => {
        if (!mountedRef.current) return;
        setSpinMotion(true);
      });
      rafIdsRef.current.push(secondFrame);
    });
    rafIdsRef.current.push(firstFrame);

    animationTimeoutRef.current = window.setTimeout(() => {
      if (!mountedRef.current) return;
      setReels(finalColumns);
      setSpinPlan(null);
      setSpinMotion(false);
      setResult(spinResult.spin);
      setDisplayedJackpot(spinResult.casinoJackpot ?? spinResult.spin.poolAfterPayout ?? optimisticJackpot);
      setJackpotPulse(Boolean(spinResult.spin.jackpotWon));
      setSpinning(false);
    }, SPIN_TOTAL_MS + 50);
  }, [clearAnimationTimers]);

  const handleSpin = useCallback(async () => {
    if (spinning) return;

    setSpinning(true);
    setResult(null);
    setJackpotPulse(false);

    const optimisticJackpot = Math.max(
      0,
      Math.floor((displayedJackpot || 0) + (casinoFreeSpins > 0 ? 0 : JACKPOT_CONTRIBUTION)),
    );
    setDisplayedJackpot(optimisticJackpot);

    try {
      const spinResult = await spinCasino();
      if (!mountedRef.current) return;
      beginSpinAnimation(spinResult.spin.symbols, spinResult, optimisticJackpot);
    } catch {
      clearAnimationTimers();
      if (mountedRef.current) {
        setSpinning(false);
        setSpinPlan(null);
        setSpinMotion(false);
        setLeverPull(0);
        syncJackpot();
      }
    }
  }, [beginSpinAnimation, casinoFreeSpins, clearAnimationTimers, displayedJackpot, spinCasino, spinning, syncJackpot]);

  const releaseLever = useCallback(() => {
    leverPointerIdRef.current = null;
    leverTriggeredRef.current = false;
    setLeverDragging(false);
    if (!spinning) {
      setLeverPull(0);
    }
  }, [spinning]);

  const triggerLeverSpin = useCallback(() => {
    if (spinning || leverTriggeredRef.current) return;
    leverTriggeredRef.current = true;
    setLeverHintDismissed(true);
    setLeverPull(LEVER_PULL_MAX);
    handleSpin();
  }, [handleSpin, spinning]);

  const handleLeverPointerDown = useCallback((event) => {
    if (spinning) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    leverPointerIdRef.current = event.pointerId;
    leverStartYRef.current = event.clientY;
    leverTriggeredRef.current = false;
    setLeverDragging(true);
    setLeverHintDismissed(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, [spinning]);

  const handleLeverPointerMove = useCallback((event) => {
    if (leverPointerIdRef.current !== event.pointerId || spinning) return;
    const nextPull = Math.max(0, Math.min(LEVER_PULL_MAX, event.clientY - leverStartYRef.current));
    setLeverPull(nextPull);
    if (nextPull >= LEVER_TRIGGER_PULL && !leverTriggeredRef.current) {
      triggerLeverSpin();
    }
  }, [spinning, triggerLeverSpin]);

  const handleLeverPointerUp = useCallback((event) => {
    if (leverPointerIdRef.current !== event.pointerId) return;
    if (!leverTriggeredRef.current && leverPull >= LEVER_TRIGGER_PULL) {
      triggerLeverSpin();
    }
    releaseLever();
  }, [leverPull, releaseLever, triggerLeverSpin]);

  const handleLeverPointerCancel = useCallback((event) => {
    if (leverPointerIdRef.current !== event.pointerId) return;
    releaseLever();
  }, [releaseLever]);

  const resultTone = result?.jackpotWon ? '#ffe082' : '#dff1b0';
  const resultCopy = result?.jackpotWon
    ? `JACKPOT! +${formatCoins(result.payout)} \u2726`
    : result
      ? `${result.patternLabel} \u2022 +${formatCoins(result.payout)} \u2726${result.freeSpinAwarded ? ' + Free Spin' : ''}`
      : `Every spin wins from 8 to 15 \u2726`;
  return (
    <div
      ref={viewportRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        background: 'radial-gradient(circle at 18% 0%, rgba(183,255,79,0.18) 0%, rgba(183,255,79,0.06) 22%, transparent 42%), radial-gradient(circle at 84% 10%, rgba(255,209,94,0.12) 0%, transparent 18%), linear-gradient(180deg, #061f19 0%, #05130f 62%, #030807 100%)',
        color: '#fff',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes casino-jackpot-pulse {
          0% { transform: scale(1); box-shadow: 0 0 0 rgba(255,218,117,0); }
          40% { transform: scale(1.03); box-shadow: 0 0 24px rgba(255,218,117,0.42); }
          100% { transform: scale(1); box-shadow: 0 0 0 rgba(255,218,117,0); }
        }
        @keyframes casino-cabinet-glow {
          0%, 100% { opacity: 0.16; transform: scale(0.985); }
          50% { opacity: 0.38; transform: scale(1); }
        }
      `}</style>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: 6,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '100%',
            height: layoutHeight || 'auto',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
          }}
        >
          <div
            ref={layoutRef}
            style={{
              width: CASINO_LAYOUT_WIDTH,
              transform: `scale(${layoutScale})`,
              transformOrigin: 'top center',
              willChange: 'transform',
            }}
          >
            <div
              style={{
                padding: 'calc(var(--tg-total-top) + 4px) 10px 6px',
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <button
                type="button"
                className="app-back-button"
                onClick={onClose}
                style={{
                  justifySelf: 'start',
                }}
              >
                Back
              </button>

              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 1 }}>
                  <CasinoLogo />
                </div>
                <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.05em', marginTop: -2 }}>
                  caSino
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)', marginTop: 1 }}>
                  Friendly toy slots - every spin wins
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCombos(true)}
                style={{
                  minHeight: 36,
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '0 10px',
                  cursor: 'pointer',
                  justifySelf: 'end',
                }}
              >
                Combos
              </button>
            </div>

            <div style={{ padding: '0 10px' }}>
              <div
                style={{
                  borderRadius: 8,
                  padding: '10px 12px',
                  background: 'var(--terrarium-panel)',
                  border: '1px solid rgba(255,209,94,0.28)',
                  textAlign: 'center',
                  animation: jackpotPulse ? 'casino-jackpot-pulse 1s ease' : 'none',
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(255,244,214,0.85)', textTransform: 'uppercase' }}>
                  Jackpot
                </div>
                <div style={{ fontSize: 30, fontWeight: 900, color: '#fff4c3', marginTop: 4 }}>
                  {'\u2726'} {formatCoins(displayedJackpot)}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)', marginTop: 2 }}>
                  The pool grows by +{JACKPOT_CONTRIBUTION} {'\u2726'} on paid spins
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                padding: '8px 10px 10px',
                gap: 10,
              }}
            >
              <div
                style={{
                  minHeight: 42,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    minHeight: 44,
                    width: 282,
                    borderRadius: 7,
                    border: '1px solid rgba(183,255,79,0.16)',
                    background: 'rgba(6, 21, 16, 0.82)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    padding: '0 14px',
                    boxShadow: '0 12px 22px rgba(0,0,0,0.2)',
                  }}
                >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: '#fff3c4' }}>
                      {spinning ? 'Spinning...' : `Pull the lever \u2022 ${casinoFreeSpins > 0 ? 'Free Spin' : `${SPIN_COST} \u2726`}`}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 1 }}>
                      {casinoFreeSpins > 0 ? 'Ready to use right now' : 'Energy cost: 1'}
                    </div>
                  </div>
                </div>
              </div>

              <div
                style={{
                  position: 'relative',
                  borderRadius: 10,
                  padding: '12px 10px 12px',
                  background: 'linear-gradient(180deg, rgba(13, 42, 29, 0.96) 0%, rgba(5, 17, 14, 0.98) 100%)',
                  border: '1px solid rgba(183,255,79,0.18)',
                  boxShadow: 'none',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: -8,
                    borderRadius: 12,
                    background: 'radial-gradient(circle at 50% 18%, rgba(255,214,102,0.22) 0%, rgba(255,214,102,0.1) 22%, rgba(255,214,102,0) 58%)',
                    opacity: 0,
                    transform: 'scale(0.985)',
                    transformOrigin: 'center top',
                    animation: spinning ? 'casino-cabinet-glow 1.15s ease-in-out infinite' : 'none',
                    willChange: 'opacity, transform',
                    pointerEvents: 'none',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'radial-gradient(circle at 50% -10%, rgba(255,223,130,0.24) 0%, transparent 44%), repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 6px, rgba(255,255,255,0) 6px, rgba(255,255,255,0) 18px)',
                    pointerEvents: 'none',
                  }}
                />

                <div
                  style={{
                    position: 'relative',
                    display: 'grid',
                    gridTemplateColumns: `auto ${LEVER_LANE_WIDTH}px`,
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      position: 'relative',
                      borderRadius: 8,
                      padding: '9px 7px',
                      background: 'linear-gradient(180deg, rgba(255,241,209,0.08) 0%, rgba(255,241,209,0.02) 100%)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 7 }}>
                      {reels.map((column, index) => (
                        <Reel
                          key={`reel-${index}`}
                          column={column}
                          plan={spinPlan ? spinPlan[index] : null}
                          animate={spinMotion}
                        />
                      ))}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignSelf: 'stretch',
                      pointerEvents: spinning ? 'none' : 'auto',
                      position: 'relative',
                    }}
                  >
                    {casinoFreeSpins > 0 ? (
                      <div
                        style={{
                          position: 'absolute',
                          top: -10,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          padding: '2px 8px',
                          borderRadius: 5,
                          background: 'linear-gradient(180deg, rgba(255,224,125,0.98) 0%, rgba(255,195,95,0.98) 100%)',
                          color: '#173423',
                          fontSize: 9,
                          fontWeight: 900,
                          letterSpacing: 0.45,
                          whiteSpace: 'nowrap',
                          boxShadow: '0 0 18px rgba(255,214,111,0.34)',
                          textTransform: 'uppercase',
                          zIndex: 3,
                        }}
                      >
                        Free Spin
                      </div>
                    ) : null}
                    <div
                      onPointerDown={handleLeverPointerDown}
                      onPointerMove={handleLeverPointerMove}
                      onPointerUp={handleLeverPointerUp}
                      onPointerCancel={handleLeverPointerCancel}
                      style={{
                        position: 'relative',
                        width: 50,
                        height: 236,
                        cursor: spinning ? 'default' : 'grab',
                        touchAction: 'none',
                        userSelect: 'none',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: 5,
                          bottom: 16,
                          width: 28,
                          transform: 'translateX(-50%)',
                          borderRadius: 20,
                          background: 'linear-gradient(180deg, rgba(20,34,23,0.78) 0%, rgba(10,17,12,0.92) 100%)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 18px rgba(0,0,0,0.22)',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: 14,
                          bottom: 26,
                          width: 7,
                          transform: 'translateX(-50%)',
                          borderRadius: 999,
                          background: 'linear-gradient(180deg, #f8de8b 0%, #e0b452 48%, #bc7d22 100%)',
                          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.62), 0 8px 14px rgba(0,0,0,0.18)',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: 9,
                          width: 16,
                          height: 7,
                          transform: 'translateX(-50%)',
                          borderRadius: 999,
                          background: 'rgba(255,244,210,0.45)',
                          boxShadow: '0 0 10px rgba(255,220,138,0.25)',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: 5,
                          width: 40,
                          height: 40,
                          transform: `translate(-50%, ${leverPull}px)`,
                          transition: leverDragging ? 'none' : 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
                          borderRadius: '50%',
                          background: spinning
                            ? 'radial-gradient(circle at 32% 28%, #fff2be 0%, #f0c45d 40%, #d68c2c 72%, #9f5f15 100%)'
                            : 'radial-gradient(circle at 32% 28%, #fff8d2 0%, #f6cf69 42%, #e29e39 72%, #b66c1d 100%)',
                          boxShadow: '0 14px 20px rgba(0,0,0,0.24), inset 0 2px 0 rgba(255,255,255,0.72), inset 0 -3px 10px rgba(116,65,14,0.26)',
                          border: '2px solid rgba(118,74,18,0.24)',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          bottom: 0,
                          width: 50,
                          height: 20,
                          transform: 'translateX(-50%)',
                          borderRadius: 12,
                          background: 'linear-gradient(180deg, rgba(34,52,32,0.96) 0%, rgba(13,21,15,0.98) 100%)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          boxShadow: '0 10px 16px rgba(0,0,0,0.3)',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          bottom: 7,
                          width: 24,
                          height: 4,
                          transform: 'translateX(-50%)',
                          borderRadius: 999,
                          background: 'rgba(255,255,255,0.12)',
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 7,
                    textAlign: 'center',
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.7)',
                  }}
                >
                  Pull down the lever for {casinoFreeSpins > 0 ? 'a free spin' : `${SPIN_COST} \u2726`}
                </div>
              </div>

              <div
                style={{
                  minHeight: 62,
                  borderRadius: 8,
                  padding: '10px 12px',
                  background: result?.jackpotWon
                    ? 'linear-gradient(180deg, rgba(255,215,96,0.2) 0%, rgba(255,215,96,0.08) 100%)'
                    : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${result?.jackpotWon ? 'rgba(255,215,96,0.34)' : 'rgba(255,255,255,0.08)'}`,
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: 3,
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 900, color: resultTone }}>
                  {resultCopy}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.72)' }}>
                  {spinning
                    ? 'The reels are rolling...'
                    : result?.jackpotWon
                      ? 'Three Sino symbols cracked the full pool.'
                      : result?.freeSpinAwarded
                        ? 'Double Sino paid coins and loaded one more free spin.'
                        : result?.freeSpinUsed
                          ? 'A free spin was used for this pull.'
                      : 'Pair toys, stack Sino, and chase the jackpot.'}
                </div>
              </div>
            </div>

            <div style={{ height: 'calc(var(--tg-safe-bottom) + 8px)' }} />
          </div>
        </div>
      </div>

      {showCombos ? <CombosSheet onClose={() => setShowCombos(false)} /> : null}
    </div>
  );
}
