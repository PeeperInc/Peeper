import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import BottomSheet from '../components/BottomSheet';
import SupporterStar from '../components/SupporterStar';
import { ProfileAvatar, ProfileName } from '../components/ProfileCustomization';
import { useApp } from '../context/AppContext';
import * as api from '../api';
import { assetUrl } from '../utils/assetUrl';

const COIN = '\u2726';
const TABLE_LAYOUT_WIDTH = 430;
const TABLE_LAYOUT_MAX_WIDTH = 860;
const LOBBY_LAYOUT_WIDTH = 418;
const LOBBY_LAYOUT_MAX_WIDTH = 560;
const SEAT_WIDTH = 102;

const SUIT_SYMBOLS = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
};

const STATUS_LABELS = {
  watch: 'Watching',
  bet: 'Bet placed',
  turn: 'Turn',
  stand: 'Stand',
  bust: 'Bust',
  blackjack: 'Blackjack',
  win: 'Winner',
  lose: 'Lost',
  split: 'Split',
  push: 'Push',
  burned: 'Burned',
};

const STATUS_COLORS = {
  watch: '#9ab8a6',
  bet: '#f6cf70',
  turn: '#77f0a5',
  stand: '#aedec2',
  bust: '#ff8e8e',
  blackjack: '#ffd86f',
  win: '#84f0a8',
  lose: '#d5e4dc',
  split: '#8ec9ff',
  push: '#f5d483',
  burned: '#ff9d73',
};

const RESULT_COLORS = {
  win: '#8bf0b2',
  split: '#8ec9ff',
  push: '#f4d27d',
  bust: '#ff8c8c',
  lose: '#d9e5de',
  burned: '#ffb387',
};

const SEAT_POSITIONS = {
  0: { top: 7, left: '50%', transform: 'translate(-50%, 0)' },
  1: { top: 74, right: 18, transform: 'translate(0, 0)' },
  2: { bottom: 48, right: 42, transform: 'translate(0, 0)' },
  3: { bottom: 48, left: 42, transform: 'translate(0, 0)' },
  4: { top: 74, left: 18, transform: 'translate(0, 0)' },
};

const SHOWDOWN_HAND_POSITIONS = {
  0: { top: 70, left: '50%', transform: 'translate(-50%, 0)' },
  1: { top: 122, right: 28, transform: 'translate(0, 0)' },
  2: { bottom: 120, right: 26, transform: 'translate(0, 0)' },
  3: { bottom: 120, left: 26, transform: 'translate(0, 0)' },
  4: { top: 122, left: 28, transform: 'translate(0, 0)' },
};

const SELF_HAND_POSITIONS = {
  0: { top: 81, left: '50%', transform: 'translate(-50%, 0)' },
  1: { top: 134, right: 26, transform: 'translate(0, 0)' },
  2: { bottom: 102, right: 26, transform: 'translate(0, 0)' },
  3: { bottom: 102, left: 26, transform: 'translate(0, 0)' },
  4: { top: 134, left: 26, transform: 'translate(0, 0)' },
};

function formatCoins(value) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(Number(value) || 0)));
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

function copyText(value) {
  const nextValue = String(value || '').trim();
  if (!nextValue) {
    return Promise.resolve(false);
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(nextValue).then(() => true).catch(() => false);
  }

  if (typeof document === 'undefined') {
    return Promise.resolve(false);
  }

  const textarea = document.createElement('textarea');
  textarea.value = nextValue;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  return Promise.resolve(copied);
}

function getStatusLabel(status) {
  return STATUS_LABELS[status] || 'Seat';
}

function getStatusColor(status) {
  return STATUS_COLORS[status] || '#cfe0d6';
}

function getResultColor(result) {
  return RESULT_COLORS[result] || '#dfe8e3';
}

function formatLobbyStatus(lobby) {
  if (!lobby) return 'Waiting';
  if (lobby.status === 'betting') {
    return lobby.countdownRemaining > 0 ? `Betting ${lobby.countdownRemaining}s` : 'Betting';
  }
  if (lobby.status === 'active') return 'Live round';
  if (lobby.status === 'settlement') {
    return lobby.settlementRemaining > 0 ? `Settling ${lobby.settlementRemaining}s` : 'Settlement';
  }
  return 'Waiting';
}

function describeRoundMode(state) {
  if (state?.round?.mode === 'dealer') return 'Dealer';
  if (state?.round?.mode === 'pvp') return 'PvP';
  return state?.lobby?.playersCount > 1 ? 'PvP' : 'Dealer';
}

function useScaledLayout(signature, { baseWidth = TABLE_LAYOUT_WIDTH, maxWidth = baseWidth } = {}) {
  const viewportRef = useRef(null);
  const layoutRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState(null);
  const [layoutWidth, setLayoutWidth] = useState(baseWidth);

  const recompute = useCallback(() => {
    const viewport = viewportRef.current;
    const layout = layoutRef.current;
    if (!viewport || !layout) return;

    const availableWidth = Math.max(0, viewport.clientWidth - 16);
    const availableHeight = Math.max(0, viewport.clientHeight - 20);
    const desiredWidth = availableWidth >= baseWidth
      ? Math.min(maxWidth, availableWidth)
      : baseWidth;

    if (Math.abs((layout.offsetWidth || 0) - desiredWidth) > 1) {
      setLayoutWidth(desiredWidth);
      window.requestAnimationFrame(recompute);
      return;
    }

    const naturalWidth = layout.offsetWidth || desiredWidth || baseWidth;
    const naturalHeight = layout.offsetHeight || 0;
    if (!naturalHeight) return;

    const nextScale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);
    const safeScale = Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1;

    setLayoutWidth(desiredWidth);
    setScale(safeScale);
    setScaledHeight(Math.ceil(naturalHeight * safeScale));
  }, [baseWidth, maxWidth]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(recompute);

    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        window.requestAnimationFrame(recompute);
      });
      if (viewportRef.current) observer.observe(viewportRef.current);
      if (layoutRef.current) observer.observe(layoutRef.current);
    }

    window.addEventListener('resize', recompute);
    window.addEventListener('orientationchange', recompute);

    return () => {
      window.cancelAnimationFrame(frame);
      if (observer) observer.disconnect();
      window.removeEventListener('resize', recompute);
      window.removeEventListener('orientationchange', recompute);
    };
  }, [recompute]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(recompute);
    return () => window.cancelAnimationFrame(frame);
  }, [recompute, signature]);

  useEffect(() => {
    setLayoutWidth(baseWidth);
  }, [baseWidth, maxWidth]);

  return { viewportRef, layoutRef, scale, scaledHeight, layoutWidth };
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

function SeatAvatar({ seat, active = false, highlight = false, flashOn = true, size = 38 }) {
  const highlightBorder = flashOn ? 'rgba(255,214,111,0.98)' : 'rgba(119,240,165,0.96)';
  const highlightGlow = flashOn
    ? '0 0 0 4px rgba(255,214,111,0.22), 0 0 22px rgba(255,214,111,0.36)'
    : '0 0 0 5px rgba(119,240,165,0.2), 0 0 28px rgba(119,240,165,0.34)';

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'visible',
        display: 'grid',
        placeItems: 'center',
        background: highlight
          ? 'linear-gradient(180deg, rgba(119,240,165,0.95) 0%, rgba(33,105,66,0.95) 100%)'
          : 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.08) 100%)',
        border: `2px solid ${active ? 'rgba(135,246,178,0.9)' : highlight ? highlightBorder : 'rgba(255,255,255,0.18)'}`,
        boxShadow: active ? '0 0 0 4px rgba(95,207,151,0.18)' : highlight ? highlightGlow : 'none',
        transform: highlight ? `scale(${flashOn ? 1.08 : 1})` : 'scale(1)',
        transition: 'transform 0.24s ease, box-shadow 0.24s ease, border-color 0.24s ease',
      }}
    >
      <ProfileAvatar user={seat} size={size} />
    </div>
  );
}

function CardFace({ card, hidden = false }) {
  if (hidden || card?.hidden) {
    return (
      <div
        style={{
          width: 42,
          height: 60,
          borderRadius: 12,
          background: 'linear-gradient(180deg, #173a26 0%, #0d2015 100%)',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 8px 18px rgba(0,0,0,0.18)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 8,
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.16)',
            background: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.16) 6px, rgba(255,255,255,0.05) 6px, rgba(255,255,255,0.05) 12px)',
          }}
        />
      </div>
    );
  }

  const suitColor = ['hearts', 'diamonds'].includes(card?.suit) ? '#d85151' : '#233529';
  return (
    <div
      style={{
        width: 42,
        height: 60,
        borderRadius: 12,
        background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(241,246,240,0.98) 100%)',
        border: '1px solid rgba(34,53,41,0.12)',
        boxShadow: '0 8px 18px rgba(0,0,0,0.16)',
        padding: '6px 7px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        color: suitColor,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 900, lineHeight: 1 }}>{card.rank}</div>
      <div style={{ fontSize: 18, lineHeight: 1, alignSelf: 'center' }}>{SUIT_SYMBOLS[card.suit] || '?'}</div>
      <div style={{ fontSize: 11, fontWeight: 800, lineHeight: 1, alignSelf: 'flex-end' }}>{card.rank}</div>
    </div>
  );
}

function ScaledCardFace({ card, hidden = false, scale = 1 }) {
  const width = 42 * scale;
  const height = 60 * scale;

  return (
    <div
      style={{
        width,
        height,
        flex: '0 0 auto',
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }}
    >
      <CardFace card={card} hidden={hidden} />
    </div>
  );
}

function MiniInfoTile({
  label,
  value,
  accent = '#d8efe0',
  action = null,
  accentBackground = 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.06) 100%)',
  borderColor = 'rgba(255,255,255,0.12)',
  prefix = null,
  valueSize = 15,
  valueStyle = null,
  labelStyle = null,
  contentStyle = null,
  tileStyle = null,
}) {
  const Tag = action ? 'button' : 'div';
  return (
    <Tag
      type={action ? 'button' : undefined}
      onClick={action || undefined}
      style={{
        minHeight: 52,
        borderRadius: 6,
        padding: '9px 10px',
        background: accentBackground,
        border: `1px solid ${borderColor}`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 4,
        textAlign: 'center',
        cursor: action ? 'pointer' : 'default',
        boxShadow: 'none',
        overflow: 'hidden',
        ...tileStyle,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          color: 'rgba(226,238,231,0.72)',
          textAlign: 'center',
          width: '100%',
          ...labelStyle,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          width: '100%',
          minWidth: 0,
          ...contentStyle,
        }}
      >
        {prefix}
        <div
          style={{
            fontSize: valueSize,
            fontWeight: 800,
            color: accent,
            lineHeight: 1.1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'center',
            ...valueStyle,
          }}
        >
          {value}
        </div>
      </div>
    </Tag>
  );
}

function CopyIcon({ color = '#dff7ea' }) {
  return (
    <div style={{ position: 'relative', width: 16, height: 16, flex: '0 0 auto' }}>
      <div
        style={{
          position: 'absolute',
          top: 1,
          left: 5,
          width: 9,
          height: 9,
          borderRadius: 3,
          border: `1.5px solid ${color}`,
          opacity: 0.78,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 5,
          left: 1,
          width: 9,
          height: 9,
          borderRadius: 3,
          border: `1.5px solid ${color}`,
        }}
      />
    </div>
  );
}

function ActionButton({ onClick, children, disabled = false, accent = '#77f0a5', style = null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        minHeight: 52,
        borderRadius: 6,
        border: '1px solid rgba(218,255,170,0.18)',
        background: disabled
          ? 'rgba(20,33,28,0.72)'
          : `linear-gradient(180deg, ${accent}28 0%, rgba(8,30,22,0.88) 100%)`,
        color: disabled ? 'rgba(227,238,231,0.5)' : '#f3fff7',
        fontSize: 17,
        fontWeight: 800,
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: 'none',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function useSmoothCountdown({ active, durationSeconds, remainingSeconds, deadlineSeconds, syncKey }) {
  const [deadlineMs, setDeadlineMs] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      setDeadlineMs(null);
      return;
    }

    const nextDeadlineMs = deadlineSeconds
      ? Number(deadlineSeconds) * 1000
      : Date.now() + (Math.max(0, Number(remainingSeconds || 0)) * 1000);

    setDeadlineMs((previous) => {
      if (!previous) return nextDeadlineMs;
      return Math.abs(previous - nextDeadlineMs) > 1200 ? nextDeadlineMs : previous;
    });
    setNowMs(Date.now());
  }, [active, deadlineSeconds, remainingSeconds, syncKey]);

  useEffect(() => {
    if (!active || !deadlineMs) return undefined;

    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 100);

    return () => window.clearInterval(interval);
  }, [active, deadlineMs]);

  const totalMs = Math.max(1000, Number(durationSeconds || 1) * 1000);
  const remainingMs = deadlineMs ? Math.max(0, deadlineMs - nowMs) : 0;
  const displaySeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const progress = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));

  return {
    remainingMs,
    displaySeconds,
    progress,
  };
}

function TurnTimerBar({ remainingMs, displaySeconds, progress }) {
  const safeProgress = Math.max(0, Math.min(100, Number(progress || 0)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(226,238,231,0.84)' }}>
        <span>Your turn</span>
        <span>{Math.max(0, Number(displaySeconds || 0))}s</span>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 3,
          background: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div
          style={{
            width: `${safeProgress}%`,
            height: '100%',
            borderRadius: 3,
            background: safeProgress > 40
              ? 'linear-gradient(90deg, #6af0a6 0%, #93f8c2 100%)'
              : safeProgress > 15
                ? 'linear-gradient(90deg, #f6d36f 0%, #ffd98e 100%)'
                : 'linear-gradient(90deg, #ff8d8d 0%, #ffb0a1 100%)',
            transition: remainingMs > 0 ? 'width 0.1s linear' : 'none',
          }}
        />
      </div>
    </div>
  );
}

function RulesSheet({ onClose }) {
  return (
    <BottomSheet
      onClose={onClose}
      bodyStyle={{
        width: 'min(calc(100% - 18px), 388px)',
        alignSelf: 'center',
        margin: '0 auto 12px',
        borderRadius: 8,
        padding: '20px 18px 24px',
        background: 'linear-gradient(180deg, rgba(11,35,20,0.98) 0%, rgba(7,21,13,0.99) 100%)',
        color: '#eff9f1',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 24px 44px rgba(0,0,0,0.32)',
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 8, color: '#f5fff7' }}>Blackjack Rules</div>
      <div style={{ fontSize: 13, color: 'rgba(229,238,231,0.78)', lineHeight: 1.55, marginBottom: 16 }}>
        Quick version, no casino jargon.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: '#e7f4eb', lineHeight: 1.55 }}>
        <div>Each hand costs <strong>10 {COIN}</strong>.</div>
        <div>If only one player bets, you play against the dealer.</div>
        <div>If two or more players bet, everyone fights for the full pot.</div>
        <div><strong>Hit</strong> takes another card. <strong>Stand</strong> keeps your total.</div>
        <div>Get as close to <strong>21</strong> as possible without going over.</div>
        <div>Ace counts as <strong>1 or 11</strong>. J, Q and K count as <strong>10</strong>.</div>
        <div>A natural blackjack beats a normal 21 that took extra cards.</div>
        <div>If solo mode ends equal, it is a <strong>push</strong> and your bet returns.</div>
        <div>If PvP ends equal, winners <strong>split the pot</strong>.</div>
        <div>If every PvP player busts, the pot <strong>burns</strong>.</div>
      </div>
    </BottomSheet>
  );
}

function SeatMarker({ seat, isCurrentTurn, isWinner, flashOn = true, onClick }) {
  const position = SEAT_POSITIONS[seat.seatIndex] || SEAT_POSITIONS[0];

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'absolute',
        ...position,
        width: SEAT_WIDTH,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 5,
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
      }}
    >
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        <SeatAvatar seat={seat} active={isCurrentTurn} highlight={isWinner} flashOn={flashOn} size={40} />
        {isWinner ? (
          <div
            style={{
              position: 'absolute',
              top: -8,
              left: '50%',
              transform: `translateX(-50%) scale(${flashOn ? 1.04 : 0.98})`,
              padding: '2px 7px',
              borderRadius: 4,
              background: flashOn
                ? 'linear-gradient(180deg, rgba(255,224,125,0.98) 0%, rgba(255,195,95,0.98) 100%)'
                : 'linear-gradient(180deg, rgba(139,240,178,0.98) 0%, rgba(94,210,140,0.98) 100%)',
              color: '#173423',
              fontSize: 9,
              fontWeight: 900,
              letterSpacing: 0.45,
              whiteSpace: 'nowrap',
              boxShadow: flashOn ? '0 0 18px rgba(255,214,111,0.34)' : '0 0 16px rgba(119,240,165,0.28)',
              transition: 'transform 0.24s ease, box-shadow 0.24s ease, background 0.24s ease',
            }}
          >
            WINNER!
          </div>
        ) : null}
      </div>
      <div
        style={{
          width: '100%',
          fontSize: 12,
          fontWeight: 800,
          color: '#f2fbf5',
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textAlign: 'center',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3, maxWidth: '100%' }}>
          <ProfileName user={seat} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seat.displayName}</ProfileName>
          <SupporterStar user={seat} size={10} />
        </span>
      </div>
    </button>
  );
}

function CompactCardStack({ cards, scale = 0.48, overlap = 13, hidden = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {cards.map((card, index) => (
        <div
          key={`${card.id || index}-${index}`}
          style={{
            marginLeft: index === 0 ? 0 : -overlap,
            zIndex: index + 1,
          }}
        >
          <ScaledCardFace card={card} scale={scale} hidden={hidden} />
        </div>
      ))}
    </div>
  );
}

function SeatHandStrip({
  seatIndex,
  cards,
  total = null,
  result = null,
  isWinner = false,
  flashOn = true,
  hidden = false,
  scale = 0.38,
  overlap = 10,
}) {
  const position = SHOWDOWN_HAND_POSITIONS[seatIndex] || SHOWDOWN_HAND_POSITIONS[0];
  const totalColor = isWinner ? '#96f2bd' : result ? getResultColor(result) : '#f5fff7';

  return (
    <div
      style={{
        position: 'absolute',
        ...position,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        opacity: flashOn || !isWinner ? 1 : 0.72,
        transition: 'opacity 0.24s ease',
        filter: isWinner ? 'drop-shadow(0 0 14px rgba(132,240,168,0.28))' : 'none',
      }}
    >
      <CompactCardStack cards={cards} scale={scale} overlap={overlap} hidden={hidden} />
      {total != null ? (
        <div
          style={{
            padding: '2px 7px',
            borderRadius: 4,
            background: isWinner ? 'rgba(132,240,168,0.14)' : 'rgba(0,0,0,0.24)',
            border: `1px solid ${isWinner ? 'rgba(132,240,168,0.34)' : 'rgba(255,255,255,0.1)'}`,
            color: totalColor,
            fontSize: 10,
            fontWeight: 900,
            lineHeight: 1.1,
          }}
        >
          {total}
        </div>
      ) : null}
    </div>
  );
}

function TableHandZone({
  label,
  cards,
  total = null,
  scale = 0.72,
  highlight = false,
  style = null,
}) {
  if (!cards?.length) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        filter: highlight ? 'drop-shadow(0 0 18px rgba(132,240,168,0.26))' : 'none',
        ...style,
      }}
    >
      {renderCardsRow(cards, null, scale)}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 900,
            color: '#edf8ef',
            textTransform: 'uppercase',
            letterSpacing: 0.7,
          }}
        >
          {label}
        </span>
        {total != null ? (
          <span
            style={{
              padding: '2px 7px',
              borderRadius: 4,
              background: highlight ? 'rgba(132,240,168,0.14)' : 'rgba(0,0,0,0.24)',
              border: `1px solid ${highlight ? 'rgba(132,240,168,0.34)' : 'rgba(255,255,255,0.1)'}`,
              color: highlight ? '#96f2bd' : '#f5fff7',
              fontSize: 10,
              fontWeight: 900,
              lineHeight: 1.1,
            }}
          >
            {total}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function LobbyRow({ lobby, onPress }) {
  const isClosed = lobby.visibility === 'closed';
  const isJoined = Boolean(lobby.userJoined);
  const isInvited = Boolean(lobby.userInvited);

  return (
    <button
      type="button"
      onClick={onPress}
      style={{
        width: '100%',
        minHeight: 62,
        borderRadius: 7,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.06) 100%)',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        cursor: 'pointer',
      }}
    >
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 800,
              color: isClosed ? '#ffd98b' : '#8af0b1',
              background: isClosed ? 'rgba(255,217,139,0.12)' : 'rgba(138,240,177,0.12)',
              border: `1px solid ${isClosed ? 'rgba(255,217,139,0.18)' : 'rgba(138,240,177,0.18)'}`,
            }}
          >
            {isClosed ? 'PRIVATE' : 'OPEN'}
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#edf8f0' }}>Table #{lobby.id}</span>
          {isJoined && (
            <span style={{ fontSize: 10, fontWeight: 800, color: '#8ff4b7' }}>YOU ARE HERE</span>
          )}
          {!isJoined && isInvited && (
            <span style={{ fontSize: 10, fontWeight: 900, color: '#ffd98b' }}>INVITED</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(228,237,231,0.8)' }}>
          {formatLobbyStatus(lobby)} · {lobby.playersCount}/{lobby.maxPlayers} players · Pot {formatCoins(lobby.pot)} {COIN}
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: '8px 10px',
          borderRadius: 5,
          background: 'rgba(8,30,22,0.82)',
          color: '#f4fff7',
          fontSize: 12,
          fontWeight: 800,
        }}
      >
        {isJoined ? 'Resume' : isInvited ? 'Join' : isClosed ? 'Enter code' : 'Join'}
      </div>
    </button>
  );
}

function SeatInfoSheet({ seat, onClose, onViewProfile }) {
  if (!seat) return null;

  return (
    <BottomSheet
      onClose={onClose}
      bodyStyle={{
        width: 'min(calc(100% - 22px), 360px)',
        alignSelf: 'center',
        margin: '0 auto 12px',
        borderRadius: 8,
        padding: '18px 18px 24px',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <SeatAvatar seat={seat} size={46} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 17, fontWeight: 900, color: 'var(--text-primary)' }}>
            <ProfileName user={seat} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seat.displayName}</ProfileName>
            <SupporterStar user={seat} size={14} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {seat.username ? `@${seat.username}` : 'No public username'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <button
          type="button"
          className="btn btn-primary btn-full"
          onClick={() => {
            onClose?.();
            onViewProfile?.(seat.userId);
          }}
          disabled={!onViewProfile}
        >
          View Profile
        </button>
      </div>
    </BottomSheet>
  );
}

function CreateTableSheet({ busy, onClose, onCreate }) {
  return (
    <BottomSheet
      onClose={onClose}
      bodyStyle={{
        width: 'min(calc(100% - 22px), 360px)',
        alignSelf: 'center',
        margin: '0 auto 12px',
        borderRadius: 8,
        padding: '18px 18px 22px',
        background: 'linear-gradient(180deg, rgba(11,35,20,0.98) 0%, rgba(7,21,13,0.99) 100%)',
        color: '#eef9f2',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 24px 44px rgba(0,0,0,0.32)',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6, color: '#f6fff8' }}>Create Table</div>
      <div style={{ fontSize: 13, color: 'rgba(229,238,231,0.76)', lineHeight: 1.5, marginBottom: 16 }}>
        Open tables are visible to everyone. Private tables require a code to join.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ActionButton onClick={() => onCreate('open')} disabled={busy} accent="#7cf0aa">
          Open Table
        </ActionButton>
        <ActionButton onClick={() => onCreate('closed')} disabled={busy} accent="#ffd78b">
          Private Table
        </ActionButton>
      </div>
    </BottomSheet>
  );
}

function JoinCodeSheet({ busy, presetLobbyId, onClose, onSubmit }) {
  const [code, setCode] = useState('');

  useEffect(() => {
    setCode('');
  }, [presetLobbyId]);

  return (
    <BottomSheet
      onClose={onClose}
      bodyStyle={{
        width: 'min(calc(100% - 22px), 360px)',
        alignSelf: 'center',
        margin: '0 auto 12px',
        borderRadius: 8,
        padding: '18px 18px 22px',
        background: 'linear-gradient(180deg, rgba(11,35,20,0.98) 0%, rgba(7,21,13,0.99) 100%)',
        color: '#eef9f2',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 24px 44px rgba(0,0,0,0.32)',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6, color: '#f6fff8' }}>Join Private Table</div>
      <div style={{ fontSize: 13, color: 'rgba(229,238,231,0.76)', lineHeight: 1.5, marginBottom: 16 }}>
        Enter the 6-character private code to sit at the table.
      </div>

      <input
        autoFocus
        value={code}
        onChange={(event) => setCode(String(event.target.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
        placeholder="ABC123"
        style={{
          width: '100%',
          minHeight: 50,
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.14)',
          background: 'rgba(255,255,255,0.08)',
          padding: '0 14px',
          fontSize: 18,
          fontWeight: 900,
          color: '#f3fff7',
          textTransform: 'uppercase',
          letterSpacing: 2,
          marginBottom: 14,
          boxSizing: 'border-box',
        }}
      />

      <ActionButton
        onClick={() => onSubmit({ code, lobbyId: presetLobbyId || null })}
        disabled={busy || code.length < 4}
        accent="#8fcbff"
      >
        Join by Code
      </ActionButton>
    </BottomSheet>
  );
}

function SearchAvatar({ user, size = 36 }) {
  return <ProfileAvatar user={user} size={size} />;
}

function InvitePlayerSheet({ busy, onClose, onInvite }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await api.searchUsers(trimmed);
        setResults(response.users || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 320);

    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <BottomSheet
      onClose={onClose}
      bodyStyle={{
        width: 'min(calc(100% - 22px), 380px)',
        alignSelf: 'center',
        margin: '0 auto 12px',
        borderRadius: 8,
        padding: '18px 18px 24px',
        background: 'linear-gradient(180deg, #173923 0%, #0d2517 100%)',
        color: '#f3fff6',
        maxHeight: '82vh',
        overflowY: 'auto',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>Invite Player</div>
      <div style={{ fontSize: 12, color: 'rgba(235,246,239,0.68)', marginBottom: 14 }}>
        Send a private Blackjack invite without sharing the room code.
      </div>

      <input
        className="search-input"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(null);
        }}
        placeholder="@username or name..."
        autoFocus
        style={{
          width: '100%',
          boxSizing: 'border-box',
          marginBottom: 12,
          background: 'rgba(255,255,255,0.08)',
          borderColor: 'rgba(255,255,255,0.12)',
          color: '#f3fff6',
        }}
      />

      {query.trim().length > 0 && query.trim().length < 2 && (
        <div style={{ fontSize: 12, color: 'rgba(235,246,239,0.62)', padding: '2px 0 8px' }}>
          Type at least 2 characters...
        </div>
      )}

      {searching && (
        <div style={{ fontSize: 12, color: 'rgba(235,246,239,0.62)', padding: '4px 0 10px' }}>
          Searching...
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map((player) => {
          const active = selected?.id === player.id;
          return (
            <button
              key={player.id}
              type="button"
              onClick={() => setSelected(player)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                borderRadius: 6,
                padding: '10px 12px',
                border: active ? '1px solid rgba(255,216,139,0.6)' : '1px solid rgba(255,255,255,0.1)',
                background: active ? 'rgba(255,216,139,0.16)' : 'rgba(255,255,255,0.06)',
                color: '#f3fff6',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <SearchAvatar user={player} size={40} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 800 }}>
                  <ProfileName user={player} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.first_name || 'Peeper'}</ProfileName>
                  <SupporterStar user={player} size={12} />
                </span>
                {player.username && (
                  <span style={{ display: 'block', fontSize: 12, color: 'rgba(235,246,239,0.62)' }}>@{player.username}</span>
                )}
              </span>
              {active && <span style={{ fontSize: 12, fontWeight: 900, color: '#ffd88b' }}>Selected</span>}
            </button>
          );
        })}
      </div>

      {results.length === 0 && !searching && query.trim().length >= 2 && (
        <div style={{ fontSize: 12, color: 'rgba(235,246,239,0.62)', padding: '8px 0' }}>No users found</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="button" className="btn btn-ghost btn-full" onClick={onClose} style={{ flex: 1 }}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-full"
          disabled={!selected || busy}
          onClick={() => selected && onInvite(selected)}
          style={{ flex: 1.4 }}
        >
          {busy ? 'Sending...' : 'Send Invite'}
        </button>
      </div>
    </BottomSheet>
  );
}

function BlackjackMascot({ framed = true, width = 'min(44vw, 148px)', height = 'min(22vw, 84px)', fontSize = 24 }) {
  return (
    <SpriteAsset
      candidateNames={['blackpotjack']}
      alt="Blackjack"
      width={width}
      height={height}
      fallback={(
        <div
          style={{
            width,
            height,
            borderRadius: framed ? 18 : 0,
            display: 'grid',
            placeItems: 'center',
            background: framed ? 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.06) 100%)' : 'transparent',
            border: framed ? '1px solid rgba(255,255,255,0.12)' : 'none',
            color: '#f4fff7',
            fontSize,
            fontWeight: 900,
          }}
        >
          BJ
        </div>
      )}
    />
  );
}

function buildCenterMessage(state) {
  if (!state) return '';
  const currentTurnSeat = state.round?.currentTurnSeat;
  const currentTurnPlayer = state.seats?.find((seat) => Number(seat.seatIndex) === Number(currentTurnSeat));

  if (state.lobby.status === 'betting') {
    if (state.self.hasPendingBet) return 'Bet locked in. Waiting for the round to begin.';
    return `Place your ${state.info.stake} ${COIN} bet to join the next hand.`;
  }

  if (state.lobby.status === 'settlement') {
    return state.lobby.settlementRemaining > 0
      ? `Round settles in ${state.lobby.settlementRemaining}s`
      : 'Round settled.';
  }

  if (state.self.isCurrentTurn) {
    return 'Choose Hit or Stand before the timer runs out.';
  }

  if (state.round?.mode === 'dealer' && state.self.isPlayerThisRound && !currentTurnPlayer) {
    return 'Dealer is drawing.';
  }

  if (currentTurnPlayer) {
    return `Waiting for ${currentTurnPlayer.displayName}`;
  }

  return state.self.isPlayerThisRound ? 'Round in progress.' : 'Watching this round.';
}

function renderCardsRow(cards, hiddenStrategy = null, scale = 1) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
      {cards.map((card, index) => (
        <ScaledCardFace
          key={`${card.id || 'hidden'}-${index}`}
          card={card}
          hidden={typeof hiddenStrategy === 'function' ? hiddenStrategy(card, index) : Boolean(hiddenStrategy)}
          scale={scale}
        />
      ))}
    </div>
  );
}

function LobbyBrowserView({
  loading,
  busy,
  directory,
  onBack,
  onCreatePress,
  onJoinByCodePress,
  onOpenLobby,
}) {
  const layoutKey = `${directory.openLobbies.length}|${directory.closedLobbies.length}|${loading}|${busy}`;
  const { viewportRef, layoutRef, scale, scaledHeight, layoutWidth } = useScaledLayout(layoutKey, {
    baseWidth: LOBBY_LAYOUT_WIDTH,
    maxWidth: LOBBY_LAYOUT_MAX_WIDTH,
  });

  return (
    <div
      style={{
        height: '100%',
        background: 'radial-gradient(circle at 50% 0%, rgba(183,255,79,0.18), transparent 34%), linear-gradient(180deg, #061f19 0%, #05130f 62%, #030807 100%)',
        color: '#eefaf1',
        overflow: 'hidden',
      }}
    >
      <div ref={viewportRef} style={{ height: '100%', padding: '8px 10px', overflow: 'hidden' }}>
        <div
          style={{
            height: scaledHeight ? `${scaledHeight}px` : '100%',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
          }}
        >
          <div
            ref={layoutRef}
            style={{
              width: layoutWidth,
              transform: `scale(${scale})`,
              transformOrigin: 'top center',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 72px', alignItems: 'center' }}>
              <button
                type="button"
                className="app-back-button"
                onClick={onBack}
                style={{
                  justifySelf: 'start',
                }}
              >
                Back
              </button>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.05 }}>Blackjack</div>
                <div style={{ fontSize: 12, color: 'rgba(229,238,232,0.72)' }}>Online tables for up to 5 players</div>
              </div>
              <div />
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                padding: '8px 0 10px',
              }}
            >
              <BlackjackMascot />
              <div style={{ fontSize: 12, color: 'rgba(231,240,234,0.82)' }}>
                Fixed stake: {directory.stake || 10} {COIN} · Best live hand wins the table
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <ActionButton onClick={onCreatePress} disabled={busy || loading} accent="#7cf0aa">
                Create Table
              </ActionButton>
              <ActionButton onClick={onJoinByCodePress} disabled={busy || loading} accent="#8ec9ff">
                Join by Code
              </ActionButton>
            </div>

            {loading ? (
              <div
                style={{
                  borderRadius: 8,
                  padding: '18px 16px',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  textAlign: 'center',
                  color: 'rgba(233,240,235,0.8)',
                }}
              >
                Loading tables...
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: '12px',
                    borderRadius: 8,
                    background: 'var(--terrarium-panel)',
                    border: '1px solid rgba(183,255,79,0.16)',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.7, color: '#86f0b1', textTransform: 'uppercase' }}>
                    Open Tables
                  </div>
                  {directory.openLobbies.length ? (
                    directory.openLobbies.map((lobby) => (
                      <LobbyRow key={`open-${lobby.id}`} lobby={lobby} onPress={() => onOpenLobby(lobby)} />
                    ))
                  ) : (
                    <div style={{ fontSize: 12, color: 'rgba(229,238,232,0.7)', padding: '8px 2px 2px' }}>
                      No open tables right now.
                    </div>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: '12px',
                    borderRadius: 8,
                    background: 'var(--terrarium-panel)',
                    border: '1px solid rgba(183,255,79,0.16)',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.7, color: '#ffd98c', textTransform: 'uppercase' }}>
                    Private Tables
                  </div>
                  {directory.closedLobbies.length ? (
                    directory.closedLobbies.map((lobby) => (
                      <LobbyRow key={`closed-${lobby.id}`} lobby={lobby} onPress={() => onOpenLobby(lobby)} />
                    ))
                  ) : (
                    <div style={{ fontSize: 12, color: 'rgba(229,238,232,0.7)', padding: '8px 2px 2px' }}>
                      No private tables open.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TableView({
  state,
  busy,
  onLeave,
  onBet,
  onAction,
  onCopyCode,
  onInvitePress,
  onOpenRules,
  onSeatPress,
}) {
  const summaryKey = [
    state?.lobby?.status,
    state?.lobby?.playersCount,
    state?.lobby?.bettingRemaining,
    state?.lobby?.settlementRemaining,
    state?.round?.id,
    state?.round?.turnRemaining,
    state?.round?.potTotal,
    state?.resultSummary?.title,
  ].join('|');
  const { viewportRef, layoutRef, scale, scaledHeight, layoutWidth } = useScaledLayout(summaryKey, {
    baseWidth: TABLE_LAYOUT_WIDTH,
    maxWidth: TABLE_LAYOUT_MAX_WIDTH,
  });

  const seats = state?.seats || [];
  const selfSeat = seats.find((seat) => seat.isSelf) || null;
  const currentTurnSeat = state?.round?.currentTurnSeat;
  const currentTurnPlayer = seats.find((seat) => Number(seat.seatIndex) === Number(currentTurnSeat)) || null;
  const currentPot = state?.round?.potTotal ?? state?.info?.potPreview ?? 0;
  const winnerIds = new Set((state?.winnerUserIds || []).map((value) => Number(value)));
  const centerMessage = buildCenterMessage(state);
  const showdown = state?.showdownCards;
  const isSettlement = state?.lobby?.status === 'settlement';
  const showdownPlayers = showdown?.players || [];
  const showdownByUserId = new Map(showdownPlayers.map((player) => [Number(player.userId), player]));
  const selfShowdown = showdownByUserId.get(Number(state.self.userId)) || null;
  const selfIsWinner = winnerIds.has(Number(state.self.userId));
  const showBettingTimer = state.lobby.status === 'betting' && state.lobby.bettingRemaining > 0;
  const showSettlementTimer = isSettlement && state.lobby.settlementRemaining > 0;
  const isCompactPhone = layoutWidth < 520;
  const isTinyPhone = layoutWidth < 460;
  const isWideLayout = layoutWidth >= 560;
  const tableHeight = layoutWidth >= 760 ? 474 : layoutWidth >= 640 ? 432 : layoutWidth >= 560 ? 388 : layoutWidth >= 480 ? 350 : 324;
  const heroRailWidth = isWideLayout ? 112 : isTinyPhone ? 82 : 92;
  const privateRailWidth = state.lobby.visibility === 'closed'
    ? (isWideLayout ? 184 : isTinyPhone ? 142 : 158)
    : heroRailWidth;
  const heroCenterWidth = layoutWidth >= 760 ? 196 : isWideLayout ? 172 : isTinyPhone ? 126 : 140;
  const selfDisplayCards = isSettlement && selfShowdown ? selfShowdown.cards : (selfSeat?.cards || []);
  const selfDisplayTotal = isSettlement && selfShowdown ? selfShowdown.total : selfSeat?.total;
  const activeSeatHands = seats.filter((seat) => !seat.isSelf && seat.cardCount > 0).length;
  const compactSeatScale = activeSeatHands >= 4 ? (isTinyPhone ? 0.31 : 0.35) : activeSeatHands >= 3 ? (isTinyPhone ? 0.35 : 0.38) : (isCompactPhone ? 0.4 : 0.43);
  const compactSeatOverlap = activeSeatHands >= 4 ? 9 : 10;
  const selfHandScale = state.round?.mode === 'dealer'
    ? (layoutWidth >= 760 ? 0.88 : isWideLayout ? 0.8 : isTinyPhone ? 0.58 : 0.68)
    : activeSeatHands >= 4
      ? (isWideLayout ? 0.62 : isTinyPhone ? 0.46 : 0.52)
      : activeSeatHands >= 3
        ? (isWideLayout ? 0.66 : isTinyPhone ? 0.5 : 0.56)
        : (isWideLayout ? 0.74 : isTinyPhone ? 0.58 : 0.64);
  const selfSeatIndex = Number.isFinite(Number(selfSeat?.seatIndex)) ? Number(selfSeat?.seatIndex) : 0;
  const selfHandPosition = SELF_HAND_POSITIONS[selfSeatIndex] || SELF_HAND_POSITIONS[0];
  const anchoredSelfHandScale = selfSeatIndex === 0
    ? selfHandScale
    : Math.min(selfHandScale, isWideLayout ? 0.56 : isTinyPhone ? 0.42 : 0.48);
  const dealerHandScale = layoutWidth >= 760 ? 0.84 : isWideLayout ? 0.76 : isTinyPhone ? 0.54 : 0.64;
  const dealerWon = Boolean(isSettlement && state.round?.mode === 'dealer' && selfShowdown?.result === 'lose');
  const [winnerFlashOn, setWinnerFlashOn] = useState(true);

  const turnTimer = useSmoothCountdown({
    active: Boolean(state.self.isCurrentTurn && state.lobby.status === 'active'),
    durationSeconds: state.info.turnSeconds,
    remainingSeconds: state.round?.turnRemaining || 0,
    deadlineSeconds: state.round?.turnDeadlineAt || null,
    syncKey: `${state.round?.id || 0}:${state.round?.currentTurnSeat || -1}:${state.lobby.status}`,
  });

  const bettingTimer = useSmoothCountdown({
    active: showBettingTimer,
    durationSeconds: state.info.countdownSeconds,
    remainingSeconds: state.lobby.bettingRemaining || 0,
    deadlineSeconds: null,
    syncKey: `${state.lobby.id}:${state.lobby.status}:${state.lobby.bettingRemaining}`,
  });

  const settlementTimer = useSmoothCountdown({
    active: showSettlementTimer,
    durationSeconds: 7,
    remainingSeconds: state.lobby.settlementRemaining || 0,
    deadlineSeconds: null,
    syncKey: `${state.round?.id || 0}:${state.lobby.settlementRemaining}`,
  });

  useEffect(() => {
    if (!isSettlement || winnerIds.size === 0) {
      setWinnerFlashOn(true);
      return undefined;
    }

    const interval = window.setInterval(() => {
      setWinnerFlashOn((value) => !value);
    }, 650);

    return () => window.clearInterval(interval);
  }, [isSettlement, winnerIds.size]);

  const visibleSeatHands = seats
    .filter((seat) => !seat.isSelf && seat.cardCount > 0)
    .map((seat) => {
      const showdownPlayer = showdownByUserId.get(Number(seat.userId)) || null;
      const result = showdownPlayer?.result || seat.result || null;
      const isWinner = winnerIds.has(Number(seat.userId));
      return {
        seat,
        cards: isSettlement ? (showdownPlayer?.cards || seat.cards) : seat.cards,
        total: isSettlement ? (showdownPlayer?.total ?? seat.fullTotal ?? null) : null,
        result,
        isWinner,
        hidden: !isSettlement,
      };
    });
  const shouldShowCenterMessage = !selfDisplayCards.length
    && visibleSeatHands.length === 0
    && !(state.round?.mode === 'dealer' && state.dealer?.cardCount > 0);

  return (
    <div
      style={{
        height: '100%',
        background: 'radial-gradient(circle at 50% 0%, rgba(183,255,79,0.18), transparent 34%), linear-gradient(180deg, #061f19 0%, #05130f 62%, #030807 100%)',
        color: '#eefaf1',
        overflow: 'hidden',
      }}
    >
      <div ref={viewportRef} style={{ height: '100%', padding: '6px 10px', overflow: 'hidden' }}>
        <div
          style={{
            height: scaledHeight ? `${scaledHeight}px` : '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
          }}
        >
          <div
            ref={layoutRef}
            style={{
              width: layoutWidth,
              maxWidth: '100%',
              transform: `scale(${scale})`,
              transformOrigin: 'top center',
              display: 'flex',
              flexDirection: 'column',
              gap: isCompactPhone ? 6 : 8,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 72px', alignItems: 'center', gap: 8 }}>
              <div />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.05 }}>Blackjack</div>
                <div style={{ fontSize: 11, color: 'rgba(227,238,231,0.72)' }}>
                  {state.lobby.visibility === 'closed' ? 'Private' : 'Open'} Table #{state.lobby.id}
                </div>
              </div>
              <button
                type="button"
                onClick={onLeave}
                disabled={!state.self.canLeave || busy}
                style={{
                  minHeight: 40,
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: !state.self.canLeave || busy ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.08)',
                  color: !state.self.canLeave || busy ? 'rgba(244,255,247,0.44)' : '#f4fff7',
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: !state.self.canLeave || busy ? 'not-allowed' : 'pointer',
                }}
              >
                Leave
              </button>
            </div>

            <div
              style={{
                position: 'relative',
                minHeight: isWideLayout ? 64 : isCompactPhone ? 50 : 56,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: `0 ${Math.max(heroRailWidth, privateRailWidth) + 8}px`,
              }}
            >
              <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: heroRailWidth }}>
                <MiniInfoTile
                  label="Rules"
                  value="Guide"
                  accent="#f7e18c"
                  action={onOpenRules}
                  accentBackground="linear-gradient(180deg, rgba(255,216,139,0.2) 0%, rgba(255,216,139,0.1) 100%)"
                  borderColor="rgba(255,216,139,0.28)"
                  valueSize={15}
                  tileStyle={{ minHeight: isCompactPhone ? 40 : 44, padding: isCompactPhone ? '6px 8px' : '7px 8px' }}
                />
              </div>

              <div
                style={{
                  width: heroCenterWidth,
                  minHeight: isWideLayout ? 52 : isCompactPhone ? 40 : 45,
                  display: 'grid',
                  placeItems: 'center',
                  padding: 0,
                }}
              >
                <BlackjackMascot
                  framed={false}
                  width={isWideLayout ? 104 : isCompactPhone ? 82 : 90}
                  height={isWideLayout ? 52 : isCompactPhone ? 40 : 45}
                  fontSize={isWideLayout ? 22 : isCompactPhone ? 18 : 20}
                />
              </div>

              {state.lobby.visibility === 'closed' ? (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: privateRailWidth,
                    display: 'grid',
                    gridTemplateColumns: '1fr 0.82fr',
                    gap: isTinyPhone ? 5 : 6,
                  }}
                >
                  <MiniInfoTile
                    label="Code"
                    value={state.lobby.joinCode}
                    accent="#9fd2ff"
                    action={onCopyCode}
                    accentBackground="linear-gradient(180deg, rgba(142,201,255,0.18) 0%, rgba(142,201,255,0.08) 100%)"
                      borderColor="rgba(142,201,255,0.28)"
                      prefix={<CopyIcon color="#9fd2ff" />}
                      valueSize={isWideLayout ? 13 : 12}
                      tileStyle={{ minHeight: isCompactPhone ? 40 : 44, padding: isCompactPhone ? '6px 6px' : '7px 6px' }}
                      contentStyle={{ gap: 3 }}
                      valueStyle={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      letterSpacing: 0.15,
                    }}
                  />
                  <MiniInfoTile
                    label="Invite"
                    value="Send"
                    accent="#ffd98b"
                    action={onInvitePress}
                    accentBackground="linear-gradient(180deg, rgba(255,217,139,0.2) 0%, rgba(255,217,139,0.08) 100%)"
                    borderColor="rgba(255,217,139,0.32)"
                    valueSize={isWideLayout ? 12 : 11}
                    tileStyle={{ minHeight: isCompactPhone ? 40 : 44, padding: isCompactPhone ? '6px 5px' : '7px 6px' }}
                    contentStyle={{ gap: 3 }}
                  />
                </div>
              ) : null}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: isCompactPhone ? 7 : 10 }}>
              <MiniInfoTile label="Players" value={`${state.lobby.playersCount}/${state.lobby.maxPlayers}`} accent="#dff7e8" tileStyle={{ minHeight: isCompactPhone ? 42 : 48, padding: isCompactPhone ? '7px 8px' : undefined }} />
              <MiniInfoTile label="Pot" value={`${formatCoins(currentPot)} ${COIN}`} accent="#f7e58a" tileStyle={{ minHeight: isCompactPhone ? 42 : 48, padding: isCompactPhone ? '7px 8px' : undefined }} />
              <MiniInfoTile label="Coins" value={`${formatCoins(state.self.coins)} ${COIN}`} accent="#8ec9ff" tileStyle={{ minHeight: isCompactPhone ? 42 : 48, padding: isCompactPhone ? '7px 8px' : undefined }} />
            </div>

            <div style={{ minHeight: isCompactPhone ? 28 : 36, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              {showBettingTimer ? (
                <div
                  style={{
                    borderRadius: 5,
                    padding: isCompactPhone ? '5px 11px' : '7px 14px',
                    fontSize: isCompactPhone ? 11 : 13,
                    fontWeight: 900,
                    color: '#f5fffa',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    opacity: 1,
                    transition: 'opacity 0.18s ease',
                  }}
                >
                  Betting closes in {bettingTimer.displaySeconds}s
                </div>
              ) : showSettlementTimer ? (
                <div
                  style={{
                    borderRadius: 5,
                    padding: isCompactPhone ? '5px 11px' : '7px 14px',
                    fontSize: isCompactPhone ? 11 : 13,
                    fontWeight: 900,
                    color: '#f5fffa',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    opacity: 1,
                    transition: 'opacity 0.18s ease',
                  }}
                >
                  Next betting window in {settlementTimer.displaySeconds}s
                </div>
              ) : (
                <div style={{ opacity: 0, pointerEvents: 'none' }}>
                  <div
                    style={{
                      borderRadius: 5,
                      padding: isCompactPhone ? '5px 11px' : '7px 14px',
                      fontSize: isCompactPhone ? 11 : 13,
                      fontWeight: 900,
                    }}
                  >
                    Timer placeholder
                  </div>
                </div>
              )}
            </div>

            <div
              style={{
                position: 'relative',
                height: tableHeight,
                borderRadius: 12,
                background: 'radial-gradient(circle at 50% 38%, rgba(47,123,70,0.96) 0%, rgba(22,72,39,0.98) 54%, rgba(12,30,18,0.99) 100%)',
                border: '1px solid rgba(218,255,170,0.18)',
                boxShadow: 'none',
                overflow: 'hidden',
              }}
            >
              {seats.map((seat) => (
                <SeatMarker
                  key={seat.userId}
                  seat={seat}
                  isCurrentTurn={Boolean(currentTurnPlayer && Number(currentTurnPlayer.userId) === Number(seat.userId))}
                  isWinner={winnerIds.has(Number(seat.userId))}
                  flashOn={winnerFlashOn}
                  onClick={() => onSeatPress(seat)}
                />
              ))}

              {visibleSeatHands.map(({ seat, cards, total, result, isWinner, hidden }) => (
                <SeatHandStrip
                  key={`strip-${seat.userId}`}
                  seatIndex={seat.seatIndex}
                  cards={cards}
                  total={total}
                  result={result}
                  isWinner={isWinner}
                  flashOn={winnerFlashOn}
                  hidden={hidden}
                  scale={hidden ? Math.max(0.32, compactSeatScale - 0.02) : compactSeatScale}
                  overlap={compactSeatOverlap}
                />
              ))}

              {state.round?.mode === 'dealer' && state.dealer?.cardCount > 0 ? (
                <TableHandZone
                  label="Dealer"
                  cards={state.dealer.cards}
                  total={state.dealer.total}
                  scale={dealerHandScale}
                    highlight={dealerWon && winnerFlashOn}
                    style={{
                      position: 'absolute',
                      top: layoutWidth >= 760 ? 198 : isWideLayout ? 176 : isTinyPhone ? 136 : 150,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      zIndex: 2,
                  }}
                />
              ) : null}

              {selfDisplayCards.length ? (
                <TableHandZone
                  label="Your Hand"
                  cards={selfDisplayCards}
                  total={selfDisplayTotal}
                  scale={anchoredSelfHandScale}
                  highlight={selfIsWinner && winnerFlashOn}
                  style={{
                    position: 'absolute',
                    ...selfHandPosition,
                    zIndex: 2,
                  }}
                />
              ) : null}

              {shouldShowCenterMessage ? (
                <div
                  style={{
                    position: 'absolute',
                    inset: isCompactPhone ? '92px 38px 70px' : '104px 54px 84px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      maxWidth: 260,
                      fontSize: 14,
                      fontWeight: 700,
                      color: 'rgba(244,255,248,0.9)',
                      lineHeight: 1.4,
                    }}
                  >
                    {centerMessage}
                  </div>
                </div>
              ) : null}
            </div>

            <div
              style={{
                borderRadius: 8,
                padding: isCompactPhone ? '8px 9px 10px' : '12px 13px 14px',
                background: 'var(--terrarium-panel)',
                border: '1px solid rgba(218,255,170,0.18)',
                display: 'flex',
                flexDirection: 'column',
                gap: isCompactPhone ? 6 : 8,
              }}
            >
              {state.lobby.status === 'betting' ? (
                state.self.canBet ? (
                  <ActionButton
                    onClick={onBet}
                    disabled={busy}
                    accent="#7cf0aa"
                    style={{ minHeight: isCompactPhone ? 44 : 50, fontSize: isCompactPhone ? 14 : 17 }}
                  >
                    Place Bet · {state.info.stake} {COIN}
                  </ActionButton>
                ) : (
                  <div
                    style={{
                      minHeight: isCompactPhone ? 42 : 48,
                      borderRadius: 6,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: '#f1fff6',
                      fontSize: isCompactPhone ? 13 : 16,
                      fontWeight: 800,
                      padding: '0 10px',
                      textAlign: 'center',
                    }}
                  >
                    {state.self.hasPendingBet ? 'Bet placed' : 'Watching this round'}
                  </div>
                )
              ) : null}

              {state.self.isCurrentTurn ? (
                <>
                  <TurnTimerBar
                    remainingMs={turnTimer.remainingMs}
                    displaySeconds={turnTimer.displaySeconds}
                    progress={turnTimer.progress}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isCompactPhone ? 8 : 10 }}>
                    <ActionButton
                      onClick={() => onAction('hit')}
                      disabled={busy}
                      accent="#8ec9ff"
                      style={{ minHeight: isCompactPhone ? 44 : 50, fontSize: isCompactPhone ? 14 : 17, flex: 'unset', width: '100%' }}
                    >
                      Hit
                    </ActionButton>
                    <ActionButton
                      onClick={() => onAction('stand')}
                      disabled={busy}
                      accent="#ffd98b"
                      style={{ minHeight: isCompactPhone ? 44 : 50, fontSize: isCompactPhone ? 14 : 17, flex: 'unset', width: '100%' }}
                    >
                      Stand
                    </ActionButton>
                  </div>
                </>
              ) : null}

              {!state.self.isCurrentTurn && state.lobby.status === 'active' ? (
                <div
                  style={{
                    minHeight: isCompactPhone ? 40 : 46,
                    borderRadius: 6,
                    display: 'grid',
                    placeItems: 'center',
                    padding: '0 12px',
                    textAlign: 'center',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(234,241,236,0.84)',
                    fontSize: isCompactPhone ? 11 : 13,
                    fontWeight: 700,
                  }}
                >
                  {centerMessage}
                </div>
              ) : isSettlement ? (
                <div style={{ minHeight: isCompactPhone ? 40 : 46 }} />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BlackjackGame({
  onClose,
  onViewProfile = null,
  inviteToken = null,
  onInviteTokenConsumed = null,
}) {
  const { showToast, refreshGameState, user } = useApp();
  const [directory, setDirectory] = useState({
    stake: 10,
    maxPlayers: 5,
    currentLobbyId: null,
    openLobbies: [],
    closedLobbies: [],
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [currentLobbyId, setCurrentLobbyId] = useState(null);
  const [tableState, setTableState] = useState(null);
  const [autoResumeEnabled, setAutoResumeEnabled] = useState(true);
  const [showCreateSheet, setShowCreateSheet] = useState(false);
  const [showJoinSheet, setShowJoinSheet] = useState(false);
  const [showInviteSheet, setShowInviteSheet] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [joinLobbyPreset, setJoinLobbyPreset] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const consumedInviteRef = useRef(null);

  const syncCoinsIfNeeded = useCallback((nextState) => {
    if (!nextState?.self || !user) return;
    if (Number(nextState.self.coins) !== Number(user.coins)) {
      refreshGameState();
    }
  }, [refreshGameState, user]);

  const applyTableState = useCallback((nextState) => {
    if (!nextState) return null;
    setCurrentLobbyId(nextState.lobby.id);
    setTableState(nextState);
    syncCoinsIfNeeded(nextState);
    return nextState;
  }, [syncCoinsIfNeeded]);

  const loadLobbies = useCallback(async ({ allowResume = false, silent = false } = {}) => {
    try {
      const nextDirectory = await api.getBlackjackLobbies();
      setDirectory(nextDirectory);

      if (allowResume && autoResumeEnabled && nextDirectory.currentLobbyId && !currentLobbyId) {
        setCurrentLobbyId(nextDirectory.currentLobbyId);
      }

      return nextDirectory;
    } catch (error) {
      if (!silent) {
        showToast(error.message || 'Could not load blackjack tables.');
      }
      return null;
    }
  }, [autoResumeEnabled, currentLobbyId, showToast]);

  const loadTableState = useCallback(async (lobbyId, { silent = false } = {}) => {
    if (!lobbyId) return null;

    try {
      const nextState = await api.getBlackjackLobbyState(lobbyId);
      return applyTableState(nextState);
    } catch (error) {
      if (error?.status === 404) {
        setCurrentLobbyId(null);
        setTableState(null);
        setSelectedSeat(null);
        await loadLobbies({ allowResume: false, silent: true });
        return null;
      }

      if (!silent) {
        showToast(error.message || 'Could not load the table.');
      }
      return null;
    }
  }, [applyTableState, loadLobbies, showToast]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      await loadLobbies({ allowResume: true, silent: false });
      if (mounted) setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [loadLobbies]);

  useEffect(() => {
    if (!currentLobbyId) return undefined;

    const intervalMs = tableState?.lobby?.status === 'active' ? 1000 : 2000;
    const interval = window.setInterval(() => {
      loadTableState(currentLobbyId, { silent: true });
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [currentLobbyId, loadTableState, tableState?.lobby?.status]);

  useEffect(() => {
    if (currentLobbyId) return undefined;

    const interval = window.setInterval(() => {
      loadLobbies({ allowResume: autoResumeEnabled, silent: true });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [autoResumeEnabled, currentLobbyId, loadLobbies]);

  useEffect(() => {
    if (!currentLobbyId || tableState?.lobby?.id === currentLobbyId) return;
    loadTableState(currentLobbyId, { silent: false });
  }, [currentLobbyId, loadTableState, tableState?.lobby?.id]);

  const mutate = useCallback(async (runner) => {
    if (busy) return null;
    setBusy(true);
    try {
      return await runner();
    } finally {
      setBusy(false);
    }
  }, [busy]);

  useEffect(() => {
    if (!inviteToken || consumedInviteRef.current === inviteToken) return;
    consumedInviteRef.current = inviteToken;

    mutate(async () => {
      try {
        const nextState = await api.joinBlackjackInvite(inviteToken);
        setShowCreateSheet(false);
        setShowJoinSheet(false);
        setShowInviteSheet(false);
        setJoinLobbyPreset(null);
        setSelectedSeat(null);
        setAutoResumeEnabled(true);
        applyTableState(nextState);
        await loadLobbies({ allowResume: false, silent: true });
      } catch (error) {
        showToast(error.message || 'Could not join the invited table.');
      } finally {
        onInviteTokenConsumed?.();
      }
    });
  }, [applyTableState, inviteToken, loadLobbies, mutate, onInviteTokenConsumed, showToast]);

  const handleCreate = useCallback((visibility) => {
    mutate(async () => {
      const nextState = await api.createBlackjackLobby(visibility);
      setShowCreateSheet(false);
      setShowJoinSheet(false);
      setJoinLobbyPreset(null);
      setAutoResumeEnabled(true);
      applyTableState(nextState);
      await loadLobbies({ allowResume: false, silent: true });
    });
  }, [applyTableState, loadLobbies, mutate]);

  const openExistingTable = useCallback((lobbyId) => {
    if (!lobbyId) return;
    setAutoResumeEnabled(true);
    setCurrentLobbyId(lobbyId);
    setTableState(null);
    loadTableState(lobbyId, { silent: false });
  }, [loadTableState]);

  const handleLobbyPress = useCallback((lobby) => {
    if (!lobby) return;
    if (lobby.userJoined) {
      openExistingTable(lobby.id);
      return;
    }

    if (lobby.userInvited) {
      mutate(async () => {
        const nextState = await api.joinBlackjackLobby(lobby.id);
        setAutoResumeEnabled(true);
        applyTableState(nextState);
        await loadLobbies({ allowResume: false, silent: true });
      });
      return;
    }

    if (lobby.visibility === 'closed') {
      setJoinLobbyPreset(lobby.id);
      setShowJoinSheet(true);
      return;
    }

    mutate(async () => {
      const nextState = await api.joinBlackjackLobby(lobby.id);
      setAutoResumeEnabled(true);
      applyTableState(nextState);
      await loadLobbies({ allowResume: false, silent: true });
    });
  }, [applyTableState, loadLobbies, mutate, openExistingTable]);

  const handleJoinByCode = useCallback(({ code, lobbyId }) => {
    mutate(async () => {
      const nextState = await api.joinBlackjackLobbyByCode({ code, lobbyId });
      setShowJoinSheet(false);
      setJoinLobbyPreset(null);
      setAutoResumeEnabled(true);
      applyTableState(nextState);
      await loadLobbies({ allowResume: false, silent: true });
    });
  }, [applyTableState, loadLobbies, mutate]);

  const handleLeave = useCallback(() => {
    if (!tableState?.lobby?.id || !tableState.self.canLeave) return;

    mutate(async () => {
      await api.leaveBlackjackLobby(tableState.lobby.id);
      setCurrentLobbyId(null);
      setTableState(null);
      setSelectedSeat(null);
      setAutoResumeEnabled(false);
      await loadLobbies({ allowResume: false, silent: true });
    });
  }, [loadLobbies, mutate, tableState]);

  const handleBet = useCallback(() => {
    if (!tableState?.lobby?.id) return;

    mutate(async () => {
      const nextState = await api.placeBlackjackBet(tableState.lobby.id);
      applyTableState(nextState);
    });
  }, [applyTableState, mutate, tableState?.lobby?.id]);

  const handleAction = useCallback((action) => {
    if (!tableState?.lobby?.id) return;

    mutate(async () => {
      const nextState = await api.actBlackjack(tableState.lobby.id, action);
      applyTableState(nextState);
    });
  }, [applyTableState, mutate, tableState?.lobby?.id]);

  const handleCopyCode = useCallback(async () => {
    if (!tableState?.lobby?.joinCode) return;
    const copied = await copyText(tableState.lobby.joinCode);
    showToast(copied ? 'Code copied' : 'Could not copy the code');
  }, [showToast, tableState?.lobby?.joinCode]);

  const handleInvitePlayer = useCallback((player) => {
    if (!tableState?.lobby?.id || !player?.id) return;

    mutate(async () => {
      try {
        const result = await api.inviteBlackjackPlayer(tableState.lobby.id, player.id);
        showToast(result.message || 'Invite sent');
        setShowInviteSheet(false);
      } catch (error) {
        showToast(error.message || 'Could not send invite.');
      }
    });
  }, [mutate, showToast, tableState?.lobby?.id]);

  return (
    <>
      {currentLobbyId && tableState ? (
        <TableView
          state={tableState}
          busy={busy}
          onLeave={handleLeave}
          onBet={handleBet}
          onAction={handleAction}
          onCopyCode={handleCopyCode}
          onInvitePress={() => setShowInviteSheet(true)}
          onOpenRules={() => setShowRules(true)}
          onSeatPress={setSelectedSeat}
        />
      ) : (
        <LobbyBrowserView
          loading={loading}
          busy={busy}
          directory={directory}
          onBack={onClose}
          onCreatePress={() => setShowCreateSheet(true)}
          onJoinByCodePress={() => {
            setJoinLobbyPreset(null);
            setShowJoinSheet(true);
          }}
          onOpenLobby={handleLobbyPress}
        />
      )}

      {showCreateSheet && (
        <CreateTableSheet
          busy={busy}
          onClose={() => setShowCreateSheet(false)}
          onCreate={handleCreate}
        />
      )}

      {showJoinSheet && (
        <JoinCodeSheet
          busy={busy}
          presetLobbyId={joinLobbyPreset}
          onClose={() => {
            setShowJoinSheet(false);
            setJoinLobbyPreset(null);
          }}
          onSubmit={handleJoinByCode}
        />
      )}

      {showInviteSheet && tableState?.lobby?.visibility === 'closed' && (
        <InvitePlayerSheet
          busy={busy}
          onClose={() => setShowInviteSheet(false)}
          onInvite={handleInvitePlayer}
        />
      )}

      {showRules && (
        <RulesSheet onClose={() => setShowRules(false)} />
      )}

      {selectedSeat && (
        <SeatInfoSheet
          seat={selectedSeat}
          onClose={() => setSelectedSeat(null)}
          onViewProfile={onViewProfile}
        />
      )}
    </>
  );
}
