import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useLiveStats } from '../hooks/useLiveStats';
import PeeperSprite from '../components/PeeperSprite';
import PeeperCleaningOverlay from '../components/PeeperCleaningOverlay';
import HomePurchaseSheet from '../components/HomePurchaseSheet';
import HomeScene from '../components/HomeScene';
import BottomSheet from '../components/BottomSheet';
import StatusBars from '../components/StatusBars';
import PersonalHomeScreen from './PersonalHomeScreen';
import FarmScreen from './FarmScreen';
import { HOME_PRICE_COINS } from '../homeConstants';
import { avatarUrl } from '../utils/avatarUrl';
import { shouldPauseHomeRuntime } from '../utils/gameplayRuntime.mjs';
import * as api from '../api';

const EMPTY_HOME_SCENE = { slots: {} };
const UPDATES_CHANNEL_URL = 'https://t.me/peeperupdates';

const FOODS = [
  { type: 'apple', emoji: '🍎', name: 'Apple', cost: 1, restore: 30, color: '#e74c3c' },
  { type: 'chicken', emoji: '🍗', name: 'Tendies', cost: 2, restore: 60, color: '#e67e22' },
  { type: 'pizza', emoji: '🍕', name: 'Pidser', cost: 3, restore: 100, color: '#27ae60' },
  { type: 'energy_drink', emoji: '⚡', name: 'Energy Drink', cost: 10, restoreEnergy: true, color: '#4aa3ff' },
];

const FRIDGE_ICON = String.fromCodePoint(0x1F9CA);
const COIN_SYMBOL = '\u2726';
const MID_DOT = '\u00B7';

function formatFridgeRemaining(seconds = 0) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (total <= 0) return 'Empty';
  const days = Math.floor(total / 86400);
  const hours = Math.ceil((total % 86400) / 3600);
  if (days <= 0) return `${Math.max(1, hours)}h left`;
  if (hours >= 24) return `${days + 1}d left`;
  return hours > 0 ? `${days}d ${hours}h left` : `${days}d left`;
}

const GAMES = [
  { id: 'casino', emoji: '🎰', name: 'caSino', desc: 'Every spin wins 8–15 ✦.', reward: '8–15 ✦', color: '#f1b74d', energy: 1 },
  { id: 'arena', emoji: '⚔️', name: 'Arena', desc: 'PvP elemental battles · 25 ✦ stake.', reward: 'Win 50 ✦', color: '#e05555', energy: 0 },
  { id: 'blackjack', emoji: '🃏', name: 'Blackjack', desc: 'Online tables · 10 ✦ stake.', reward: 'Table Pot', color: '#5fcf97', energy: 0 },
  { id: 'sniper', emoji: '🎯', name: 'Sniper', desc: '3 shots at a moving target.', reward: 'Up to 10 ✦', color: '#8e44ad', energy: 1 },
  { id: 'flappy', emoji: '🐸', name: 'Flappy Frog', desc: 'Dodge pipes, collect sausages!', reward: 'Up to 10 ✦', color: '#27ae60', energy: 1 },
  { id: 'reaction', emoji: '💰', name: 'Quick Grab', desc: 'Tap coins as fast as you can!', reward: 'Up to 10 ✦', color: '#f39c12', energy: 1 },
  { id: 'bubble', emoji: '🔵', name: 'Bubble Pop', desc: 'Pop bubbles to find hidden coins!', reward: 'Up to 10 ✦', color: '#9b59b6', energy: 1 },
  { id: 'dodge', emoji: '🚀', name: 'Dodge!', desc: 'Survive flying platforms 10s.', reward: 'Up to 10 ✦', color: '#e74c3c', energy: 1 },
  { id: 'catch', emoji: '🧸', name: 'Catch Toys', desc: 'Catch falling toys, dodge bombs!', reward: 'Up to 10 ✦', color: '#3498db', energy: 1 },
];

const GAME_LOADERS = {
  catch: () => import('../games/CatchGame'),
  reaction: () => import('../games/ReactionGame'),
  bubble: () => import('../games/BubbleGame'),
  flappy: () => import('../games/FlappyFrog'),
  dodge: () => import('../games/DodgeGame'),
  sniper: () => import('../games/SniperGame'),
  casino: () => import('../games/CasinoGame'),
  arena: () => import('../games/ArenaGame'),
  blackjack: () => import('../games/BlackjackGame'),
};

const GAME_COMPONENTS = {
  catch: lazy(GAME_LOADERS.catch),
  reaction: lazy(GAME_LOADERS.reaction),
  bubble: lazy(GAME_LOADERS.bubble),
  flappy: lazy(GAME_LOADERS.flappy),
  dodge: lazy(GAME_LOADERS.dodge),
  sniper: lazy(GAME_LOADERS.sniper),
  casino: lazy(GAME_LOADERS.casino),
  arena: lazy(GAME_LOADERS.arena),
  blackjack: lazy(GAME_LOADERS.blackjack),
};

const GAME_PRELOADS = new Map();

function gameNeedsEnergy(game) {
  return (game?.energy ?? 1) > 0;
}

function canLaunchGame(game, { isDirty, canPlayBase }) {
  if (isDirty) return false;
  return !gameNeedsEnergy(game) || canPlayBase;
}

function canOpenAnyGameMenu({ isDirty, canPlayBase }) {
  return GAMES.some((game) => canLaunchGame(game, { isDirty, canPlayBase }));
}

const ENERGY_GAMES = GAMES.filter((game) => gameNeedsEnergy(game));
const FREE_GAMES = GAMES.filter((game) => !gameNeedsEnergy(game));

function preloadGame(gameId) {
  const loader = GAME_LOADERS[gameId];
  if (!loader) return Promise.resolve();
  if (!GAME_PRELOADS.has(gameId)) {
    const promise = loader().catch((error) => {
      GAME_PRELOADS.delete(gameId);
      throw error;
    });
    GAME_PRELOADS.set(gameId, promise);
  }
  return GAME_PRELOADS.get(gameId);
}

function FridgeConfirmContent({ cost, coins, loading, onClose, onConfirm }) {
  const canAfford = coins >= cost;
  const fridgeInfoLines = [
    <>3 days stock costs 150 {COIN_SYMBOL}</>,
    <>7 days stock costs 500 {COIN_SYMBOL}</>,
    <>While stocked, Peeper stays full and cannot die from hunger</>,
    <>When stock ends, hunger starts draining from that moment</>,
  ];

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 34 }}>{FRIDGE_ICON}</span>
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>Buy Fridge?</div>
          <div style={{ fontSize: 13, color: '#4aa3ff', fontWeight: 800 }}>{cost} {COIN_SYMBOL}</div>
        </div>
      </div>

      <div style={{
        padding: '13px 14px',
        borderRadius: 15,
        background: 'rgba(74,163,255,0.1)',
        border: '1px solid rgba(74,163,255,0.24)',
        color: 'var(--text-secondary)',
        fontSize: 13,
        lineHeight: 1.55,
        marginBottom: 14,
      }}>
        Fridge is permanent, but it does not feed Peeper by itself. After buying it, you can stock food for <strong>3 days</strong> or <strong>7 days</strong>.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {fridgeInfoLines.map((line, index) => (
          <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-secondary)' }}>
            <span style={{ color: '#4aa3ff', fontWeight: 900 }}>{MID_DOT}</span>
            <span>{line}</span>
          </div>
        ))}
      </div>

      {!canAfford && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 12,
          background: 'var(--danger-light)',
          color: 'var(--danger)',
          fontSize: 12,
          fontWeight: 800,
        }}>
          Not enough coins. You have {coins} {COIN_SYMBOL}.
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="btn btn-secondary btn-full" onClick={onClose} disabled={loading}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary btn-full" onClick={onConfirm} disabled={!canAfford || loading}>
          {loading ? 'Buying...' : <>Buy Fridge {MID_DOT} {cost} {COIN_SYMBOL}</>}
        </button>
      </div>
    </>
  );
}

function FoodMenu({ hunger, energy, coins, energyDrink, fridge, onSelect, onClose, loading }) {
  const [showFridgeConfirm, setShowFridgeConfirm] = useState(false);
  const fridgeOwned = Boolean(fridge?.owned);
  const fridgeActive = Boolean(fridge?.active);
  const fridgeRemaining = formatFridgeRemaining(fridge?.remainingSeconds);
  const fridgePlans = Array.isArray(fridge?.plans) ? fridge.plans : [];
  const fridgePurchaseCost = fridge?.purchaseCost ?? 500;
  const canBuyFridge = coins >= fridgePurchaseCost && !loading;
  const renderFridgeBlock = () => (
    !fridgeOwned ? (
      <button
        onClick={() => !loading && setShowFridgeConfirm(true)}
        disabled={loading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 16px',
          borderRadius: 16,
          background: canBuyFridge ? 'linear-gradient(135deg, rgba(122,198,255,0.16), rgba(255,255,255,0.08))' : 'var(--bg-secondary)',
          border: `2px solid ${canBuyFridge ? 'rgba(122,198,255,0.34)' : 'var(--border)'}`,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
          transition: 'all 0.15s',
        }}
      >
        <span style={{ fontSize: 36 }}>{FRIDGE_ICON}</span>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>Fridge</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            Unlock food stock for 3 or 7 days
          </div>
        </div>
        <div style={{ background: 'rgba(122,198,255,0.16)', color: '#4aa3ff', padding: '6px 12px', borderRadius: 10, fontWeight: 800, fontSize: 15 }}>
          {fridgePurchaseCost} {COIN_SYMBOL}
        </div>
      </button>
    ) : (
      <div
        style={{
          padding: 14,
          borderRadius: 16,
          background: fridgeActive ? 'linear-gradient(135deg, rgba(122,198,255,0.16), rgba(39,174,96,0.1))' : 'var(--bg-card)',
          border: `2px solid ${fridgeActive ? 'rgba(122,198,255,0.34)' : 'var(--border)'}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: fridgeActive ? 0 : 10 }}>
          <span style={{ fontSize: 30 }}>{FRIDGE_ICON}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 15 }}>Fridge</div>
            <div style={{ fontSize: 12, color: fridgeActive ? '#4aa3ff' : 'var(--text-secondary)', marginTop: 2 }}>
              {fridgeActive ? `Stocked for ${fridgeRemaining}` : 'Empty'}
            </div>
          </div>
        </div>
        {!fridgeActive && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {fridgePlans.map((plan) => {
              const canBuyPlan = coins >= plan.cost && !loading;
              return (
                <button
                  key={plan.type}
                  type="button"
                  onClick={() => canBuyPlan && onSelect(plan.type)}
                  disabled={!canBuyPlan}
                  style={{
                    minHeight: 42,
                    borderRadius: 13,
                    border: '1px solid rgba(74,163,255,0.28)',
                    background: canBuyPlan ? 'rgba(74,163,255,0.12)' : 'var(--bg-secondary)',
                    color: canBuyPlan ? '#4aa3ff' : 'var(--text-hint)',
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: canBuyPlan ? 'pointer' : 'not-allowed',
                    opacity: canBuyPlan ? 1 : 0.55,
                  }}
                >
                  {plan.days} days {MID_DOT} {plan.cost} {COIN_SYMBOL}
                </button>
              );
            })}
          </div>
        )}
      </div>
    )
  );

  return (
    <BottomSheet
      onClose={onClose}
      bodyStyle={{
        padding: '20px 20px 32px',
      }}
    >
      {showFridgeConfirm ? (
        <FridgeConfirmContent
          cost={fridgePurchaseCost}
          coins={coins}
          loading={loading}
          onClose={() => !loading && setShowFridgeConfirm(false)}
          onConfirm={() => onSelect('fridge_buy')}
        />
      ) : (
        <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>Feed your Peeper 🍽</div>
        <div style={{ background: 'var(--warning-light)', color: 'var(--warning)', padding: '3px 10px', borderRadius: 99, fontSize: 13, fontWeight: 700 }}>
          ✦ {coins}
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 16 }}>
        Hunger: {Math.round(hunger)}% — choose your meal
      </div>

      {fridgeActive && (
        <div style={{ fontSize: 12, color: '#4aa3ff', fontWeight: 700, marginTop: -10, marginBottom: 14 }}>
          {`Fridge keeps Peeper full ${MID_DOT} ${fridgeRemaining}`}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {FOODS.map((food) => {
          const isEnergyDrink = food.type === 'energy_drink';
          const canAfford = coins >= food.cost;
          const canUseFood = isEnergyDrink ? Boolean(energyDrink?.available) : hunger <= 70;
          const disabled = !canAfford || !canUseFood || loading;
          const willFill = isEnergyDrink ? null : Math.min(100, hunger + food.restore);
          const energyDrinkCopy = !energyDrink
            ? 'Restore to full energy'
            : energyDrink.remainingToday <= 0
              ? 'Daily limit reached'
              : energy > (energyDrink.energyThreshold ?? 1)
                ? `Only available at 0-1 energy · now ${energy}`
                : `Restore to full energy · ${energyDrink.remainingToday} left today`;
          return (
            <button
              key={food.type}
              onClick={() => !disabled && onSelect(food.type)}
              disabled={disabled}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 16px',
                borderRadius: 16,
                background: !disabled ? 'var(--bg-card)' : 'var(--bg-secondary)',
                border: `2px solid ${!disabled ? `${food.color}40` : 'var(--border)'}`,
                cursor: !disabled ? 'pointer' : 'not-allowed',
                opacity: !disabled ? 1 : 0.6,
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 36 }}>{food.emoji}</span>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{food.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {isEnergyDrink ? energyDrinkCopy : `+${food.restore}% hunger → ${Math.round(willFill)}%`}
                </div>
                {!isEnergyDrink && (
                  <div style={{ height: 3, background: 'var(--border)', borderRadius: 99, marginTop: 6 }}>
                    <div style={{ height: '100%', borderRadius: 99, background: food.color, width: `${willFill}%`, transition: 'width 0.3s' }} />
                  </div>
                )}
              </div>
              <div style={{ background: `${food.color}22`, color: food.color, padding: '6px 12px', borderRadius: 10, fontWeight: 800, fontSize: 15 }}>
                {food.cost} ✦
              </div>
            </button>
          );
        })}
        {renderFridgeBlock()}
      </div>
        </>
      )}
    </BottomSheet>
  );
}

function HintSheet({ onClose }) {
  const handleUpdatesPress = () => {
    try {
      if (window.Telegram?.WebApp?.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink(UPDATES_CHANNEL_URL);
        return;
      }
    } catch (error) {
      // fall back below
    }

    if (typeof window !== 'undefined') {
      window.open(UPDATES_CHANNEL_URL, '_blank', 'noopener,noreferrer');
    }
  };
  return (
    <BottomSheet
      onClose={onClose}
      bodyStyle={{
        padding: '20px 20px 36px',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 18 }}>
        💡 How it works
      </div>

      {[
        { icon: '🍎', title: 'Feeding', body: 'Feed when hunger is 70% or lower. Hunger fully drains in 8h.' },
        { icon: '⚡', title: 'Energy', body: 'Fun drains over time. Every 20% missing fun = 1 energy token.' },
        { icon: '🎮', title: 'Mini-games', body: 'Spend energy to play games, earn coins and restore fun.' },
        { icon: '❤️', title: 'Health', body: 'Only hunger damages HP. At 0% hunger, HP drains over 36h.' },
        { icon: '💀', title: 'Death', body: 'HP hits 0 and your Peeper dies. Revive to start fresh.' },
      ].map(({ icon, title, body }) => (
        <div
          key={title}
          style={{
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
            padding: '12px 0',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 3 }}>{title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{body}</div>
          </div>
        </div>
      ))}

      <button
        onClick={handleUpdatesPress}
        style={{
          marginTop: 18,
          width: '100%',
          padding: '13px 0',
          background: 'var(--glass-surface-soft)',
          border: '1px solid var(--glass-border-strong)',
          borderRadius: 14,
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--text-primary)',
          cursor: 'pointer',
        }}
      >
        📢 Game Updates Channel
      </button>

      <button
        onClick={onClose}
        style={{
          marginTop: 20,
          width: '100%',
          padding: '13px 0',
          background: 'var(--bg-secondary)',
          border: 'none',
          borderRadius: 14,
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          cursor: 'pointer',
        }}
      >
        Got it
      </button>
    </BottomSheet>
  );
}

function GameMenu({ energy, canPlayBase, isDirty, blockedReason, onSelect, onClose, casinoJackpot = 0, arenaQueueActive = false }) {
  const showBlockedBanner = isDirty;
  const [activeTab, setActiveTab] = useState(energy > 0 ? 'energy' : 'free');
  const visibleGames = activeTab === 'energy' ? ENERGY_GAMES : FREE_GAMES;

  useEffect(() => {
    if (energy === 0 && activeTab === 'energy') {
      setActiveTab('free');
    }
  }, [activeTab, energy]);

  return (
    <BottomSheet
      onClose={onClose}
      bodyStyle={{
        padding: '20px 20px 16px',
        maxHeight: 'calc(100dvh - var(--tg-total-top) - 12px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>Mini-Games ⚡</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index} style={{ fontSize: 16, opacity: index < energy ? 1 : 0.2 }}>⚡</span>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 16 }}>
        {energy} energ{energy === 1 ? 'y' : 'ies'} available — most games cost 1 ⚡
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        {[
          { id: 'energy', label: `Energy (${energy})` },
          { id: 'free', label: 'Free' },
        ].map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                background: selected ? 'var(--accent-light)' : 'var(--bg-card)',
                color: selected ? 'var(--accent)' : 'var(--text-secondary)',
                borderRadius: 14,
                padding: '9px 10px',
                fontWeight: 900,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {showBlockedBanner && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 12,
          background: 'var(--bg-secondary)',
          color: 'var(--text-secondary)',
          fontSize: 12,
          fontWeight: 700,
        }}>
          {blockedReason}
        </div>
      )}

      <style>{`
        @keyframes arena-menu-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 2px 12px rgba(224,85,85,0.14), 0 1px 3px rgba(0,0,0,0.05); }
          50% { transform: scale(1.012); box-shadow: 0 8px 26px rgba(224,85,85,0.28), 0 1px 3px rgba(0,0,0,0.08); }
        }
        @keyframes home-arena-sword-badge {
          0%, 100% { transform: scale(1) rotate(-8deg); }
          50% { transform: scale(1.2) rotate(8deg); }
        }
      `}</style>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
          paddingBottom: 'calc(var(--tg-safe-bottom) + 12px)',
          paddingRight: 2,
        }}
      >
        {visibleGames.map((game) => {
          const playable = canLaunchGame(game, { isDirty, canPlayBase });
          const arenaHot = arenaQueueActive && game.id === 'arena';
          return (
          <button
            key={game.id}
            onClick={() => playable && onSelect(game.id)}
            disabled={!playable}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 16px',
              borderRadius: 18,
              background: 'var(--bg-card)',
              border: `1.5px solid ${game.color}30`,
              cursor: playable ? 'pointer' : 'not-allowed',
              textAlign: 'left',
              boxShadow: `0 2px 12px ${game.color}12, 0 1px 3px rgba(0,0,0,0.05)`,
              transition: 'transform 0.12s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.15s',
              WebkitTapHighlightColor: 'transparent',
              opacity: playable ? 1 : 0.58,
              animation: arenaHot ? 'arena-menu-pulse 1.15s ease-in-out infinite' : undefined,
            }}
          >
            <div
              style={{
                position: 'relative',
                width: 52,
                height: 52,
                borderRadius: 14,
                flexShrink: 0,
                background: `linear-gradient(135deg, ${game.color}22, ${game.color}10)`,
                border: `1.5px solid ${game.color}25`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 28,
              }}
            >
              {game.emoji}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{game.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{game.desc}</div>
              {game.id === 'casino' && (
                <div style={{ fontSize: 11, color: game.color, marginTop: 4, fontWeight: 800 }}>
                  Jackpot: ✦ {new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(Number(casinoJackpot) || 0)))}
                </div>
              )}
            </div>
            <div
              style={{
                background: `linear-gradient(135deg, ${game.color}20, ${game.color}12)`,
                color: game.color,
                padding: '5px 10px',
                borderRadius: 10,
                fontWeight: 800,
                fontSize: 11,
                whiteSpace: 'nowrap',
                border: `1px solid ${game.color}25`,
              }}
            >
              {game.id === 'casino' ? `${game.reward} + JP` : game.reward}
            </div>
          </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}

function GameLoadingOverlay({ gameId }) {
  const game = GAMES.find((item) => item.id === gameId);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'linear-gradient(180deg,#08111f 0%,#10213d 55%,#071020 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 'min(320px, 100%)',
          background: 'rgba(4, 10, 22, 0.72)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 22,
          padding: '28px 24px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ fontSize: 52, marginBottom: 12 }}>{game?.emoji || '🎮'}</div>
        <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', marginBottom: 8 }}>
          {game?.name || 'Loading game'}
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.72)', marginBottom: 18 }}>
          Warming up the game for a smoother start...
        </div>
        <div style={{ height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 999, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: '100%',
              background: `linear-gradient(90deg, ${game?.color || '#7B9EC8'}, rgba(255,255,255,0.88), ${game?.color || '#7B9EC8'})`,
              backgroundSize: '200% 100%',
              animation: 'game-loader 1.15s linear infinite',
            }}
          />
        </div>
      </div>
      <style>{`
        @keyframes game-loader {
          from { background-position: 200% 0; }
          to { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

function UserAvatar({ telegramId, name }) {
  const [err, setErr] = useState(false);
  const src = avatarUrl(telegramId);

  if (src && !err) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setErr(true)}
        style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }

  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: 'var(--accent-light)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
        flexShrink: 0,
      }}
    >
      🐸
    </div>
  );
}

export default function HomeScreen({
  onProfileOpen,
  onViewProfile,
  blackjackInviteToken = null,
  onBlackjackInviteConsumed = null,
  arenaInviteToken = null,
  onArenaInviteConsumed = null,
  onGameplayOpenChange = null,
  isActive = true,
  topGifts = [],
  hasNewGifts = false,
}) {
  const {
    user,
    peeper,
    casinoJackpot,
    energyDrink,
    fridge,
    homeSummary,
    farmSummary,
    feedPeeper,
    playPeeper,
    removePeeperPoop,
    completePeeperCleaning,
    revivePeeper,
    refreshGameState,
    buyPersonalHome,
    getPersonalHomeState,
    showToast,
  } = useApp();

  const [showFoodMenu, setShowFoodMenu] = useState(false);
  const [showGameMenu, setShowGameMenu] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showHomePurchase, setShowHomePurchase] = useState(false);
  const [showPersonalHome, setShowPersonalHome] = useState(false);
  const [showFarm, setShowFarm] = useState(false);
  const [homeBackdrop, setHomeBackdrop] = useState(null);
  const [activeGame, setActiveGame] = useState(null);
  const [loadingGame, setLoadingGame] = useState(null);
  const [buyingHome, setBuyingHome] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [spongeMode, setSpongeMode] = useState(false);
  const [playUnlocking, setPlayUnlocking] = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState(0);
  const [cleanupDockBounds, setCleanupDockBounds] = useState({ top: 120, bottom: 140 });
  const [arenaQueueActive, setArenaQueueActive] = useState(false);
  const lastServerSyncRef = useRef(0);
  const lastDirtyStateRef = useRef(peeper?.dirty_state || 'clean');
  const contentRef = useRef(null);
  const topStackRef = useRef(null);
  const bottomStackRef = useRef(null);

  const gameplayOpen = Boolean(activeGame || loadingGame || showFarm);
  const overlayOpen = Boolean(
    gameplayOpen ||
    showFoodMenu ||
    showGameMenu ||
    showHint ||
    showHomePurchase ||
    showPersonalHome ||
    showFarm
  );

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('overlay-ui-open', overlayOpen);
    return () => root.classList.remove('overlay-ui-open');
  }, [overlayOpen]);

  const handleFoodSelect = useCallback(async (foodType) => {
    setFeedLoading(true);
    setShowFoodMenu(false);
    try {
      const result = await feedPeeper(foodType);
      const food = FOODS.find((item) => item.type === foodType);
      showToast?.(result.message || `${food?.emoji} Yum!`);
    } catch (error) {
      showToast?.(error.message || 'Cannot feed right now');
    } finally {
      setFeedLoading(false);
    }
  }, [feedPeeper, showToast]);

  const handleGameComplete = useCallback(async (coinsEarned, gameWon) => {
    const currentGame = activeGame;
    setActiveGame(null);
    try {
      if (!gameWon) {
        showToast?.(coinsEarned > 0 ? `+${coinsEarned} ✦ earned!` : 'Better luck next time!');
        return;
      }
      const result = await playPeeper({ gameId: currentGame, coinsEarned, gameWon: true });
      showToast?.(result.message || `+${coinsEarned} ✦ earned!`);
    } catch (error) {
      showToast?.(error.message || 'Error saving game result');
    } finally {
      refreshGameState();
    }
  }, [activeGame, playPeeper, refreshGameState, showToast]);

  const handleGameQuit = useCallback(() => {
    setActiveGame(null);
    refreshGameState();
  }, [refreshGameState]);

  const handleHomePress = useCallback(() => {
    if (homeSummary?.owned) {
      setShowPersonalHome(true);
      return;
    }

    if ((user?.coins ?? 0) < HOME_PRICE_COINS) {
      showToast?.(`Need ${HOME_PRICE_COINS} ✦ to buy your Personal Home`);
      return;
    }

    setShowHomePurchase(true);
  }, [homeSummary?.owned, showToast, user?.coins]);

  const handleFarmPress = useCallback(() => {
    setShowFarm(true);
  }, []);



  const refreshHomeBackdrop = useCallback(async () => {
    if (!homeSummary?.owned) {
      setHomeBackdrop(null);
      return null;
    }

    try {
      const result = await getPersonalHomeState();
      setHomeBackdrop(result?.home || EMPTY_HOME_SCENE);
      return result;
    } catch (error) {
      return null;
    }
  }, [getPersonalHomeState, homeSummary?.owned]);

  const handleHomeBuy = useCallback(async () => {
    setBuyingHome(true);
    try {
      await buyPersonalHome();
      const homeResult = await getPersonalHomeState().catch(() => null);
      if (homeResult?.home) {
        setHomeBackdrop(homeResult.home);
      }
      setShowHomePurchase(false);
      setShowPersonalHome(true);
    } catch (error) {
      // toast handled in context
    } finally {
      setBuyingHome(false);
    }
  }, [buyPersonalHome, getPersonalHomeState]);

  const liveStatsPaused = shouldPauseHomeRuntime({ isActive, gameplayOpen });
  const live = useLiveStats(peeper, { isActive, gameplayOpen });
  const awaitingServerState = live.needsServerSync && peeper?.alive !== false;
  const dirtyState = peeper?.dirty_state || 'clean';
  const isDirty = dirtyState !== 'clean';
  const nextDirtyAt = Math.floor(Number(peeper?.next_dirty_at) || 0);
  const localDirtySyncNeeded = peeper?.alive !== false
    && dirtyState === 'clean'
    && nextDirtyAt > 0
    && Math.floor(Date.now() / 1000) >= nextDirtyAt;

  const handlePoopCleanup = useCallback(async () => {
    if (cleanupBusy || dirtyState !== 'poop') return;
    setCleanupBusy(true);
    try {
      const result = await removePeeperPoop();
      showToast?.(result.message || 'Poop removed!');
    } catch (error) {
      // toast handled in context
    } finally {
      setCleanupBusy(false);
    }
  }, [cleanupBusy, dirtyState, removePeeperPoop, showToast]);

  const handleCleaningComplete = useCallback(async () => {
    if (cleanupBusy || dirtyState !== 'scrubbing') return;
    setCleanupBusy(true);
    try {
      const result = await completePeeperCleaning();
      setSpongeMode(false);
      showToast?.(result.message || 'All clean!');
      return result;
    } catch (error) {
      throw error;
    } finally {
      setCleanupBusy(false);
    }
  }, [cleanupBusy, completePeeperCleaning, dirtyState, showToast]);

  useEffect(() => {
    if (!isActive || gameplayOpen) return undefined;
    const preloadSniper = () => {
      preloadGame('sniper').catch(() => null);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(preloadSniper, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(idleId);
    }
    const timeoutId = window.setTimeout(preloadSniper, 900);
    return () => window.clearTimeout(timeoutId);
  }, [gameplayOpen, isActive]);

  useEffect(() => {
    onGameplayOpenChange?.(gameplayOpen);
    return () => {
      onGameplayOpenChange?.(false);
    };
  }, [gameplayOpen, onGameplayOpenChange]);

  useEffect(() => {
    if (!isActive || gameplayOpen) return;
    refreshGameState();
  }, [gameplayOpen, isActive, refreshGameState]);

  useEffect(() => {
    if (!isActive || gameplayOpen) return undefined;
    const id = setInterval(() => {
      refreshGameState();
    }, 30000);
    return () => clearInterval(id);
  }, [gameplayOpen, isActive, refreshGameState]);

  useEffect(() => {
    if (!isActive || gameplayOpen) return undefined;
    let cancelled = false;
    const refreshArenaQueue = async () => {
      try {
        const result = await api.arenaPublicQueueStatus();
        if (!cancelled) setArenaQueueActive(Boolean(result?.active));
      } catch {
        if (!cancelled) setArenaQueueActive(false);
      }
    };
    refreshArenaQueue();
    const id = setInterval(refreshArenaQueue, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [gameplayOpen, isActive]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isActive && !gameplayOpen) {
        refreshGameState();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [gameplayOpen, isActive, refreshGameState]);

  useEffect(() => {
    if (!isActive || gameplayOpen || !awaitingServerState) return;
    const now = Date.now();
    if (now - lastServerSyncRef.current < 5000) return;
    lastServerSyncRef.current = now;
    refreshGameState();
  }, [awaitingServerState, gameplayOpen, isActive, refreshGameState]);

  useEffect(() => {
    if (!isActive || gameplayOpen || !localDirtySyncNeeded) return;
    const now = Date.now();
    if (now - lastServerSyncRef.current < 5000) return;
    lastServerSyncRef.current = now;
    refreshGameState();
  }, [gameplayOpen, isActive, localDirtySyncNeeded, refreshGameState]);

  useEffect(() => {
    const previousDirtyState = lastDirtyStateRef.current;
    let unlockTimerId = null;

    if (dirtyState !== 'scrubbing') {
      setSpongeMode(false);
    }

    if (previousDirtyState !== dirtyState && previousDirtyState !== 'clean' && dirtyState === 'clean') {
      setPlayUnlocking(true);
      unlockTimerId = window.setTimeout(() => {
        setPlayUnlocking(false);
      }, 700);
    } else if (dirtyState !== 'clean') {
      setPlayUnlocking(false);
    }

    lastDirtyStateRef.current = dirtyState;

    return () => {
      if (unlockTimerId) {
        window.clearTimeout(unlockTimerId);
      }
    };
  }, [dirtyState]);

  useLayoutEffect(() => {
    if (liveStatsPaused) return undefined;
    const content = contentRef.current;
    const top = topStackRef.current;
    const bottom = bottomStackRef.current;
    if (!content || !top || !bottom) return undefined;

    const measure = () => {
      const contentRect = content.getBoundingClientRect();
      const topRect = top.getBoundingClientRect();
      const bottomRect = bottom.getBoundingClientRect();
      setCleanupDockBounds({
        top: Math.max(0, topRect.bottom - contentRect.top + 8),
        bottom: Math.max(0, contentRect.bottom - bottomRect.top + 10),
      });
    };

    measure();

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(measure)
      : null;
    resizeObserver?.observe(content);
    resizeObserver?.observe(top);
    resizeObserver?.observe(bottom);
    window.addEventListener('resize', measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [dirtyState, hasNewGifts, homeSummary?.owned, liveStatsPaused, peeper?.alive]);

  useEffect(() => {
    if (!homeSummary?.owned) {
      setHomeBackdrop(null);
      return;
    }
    refreshHomeBackdrop();
  }, [homeSummary?.owned, refreshHomeBackdrop]);

  if (!peeper) return null;

  const isAlive = live.alive;
  const hunger = live.hunger;
  const fun = live.fun;
  const energy = live.energy;
  const fridgeCaption = fridge?.active ? `Fridge: ${formatFridgeRemaining(fridge.remainingSeconds)}` : null;
  const canFeed = hunger <= 70 && !awaitingServerState;
  const canPlayBase = energy > 0 && !awaitingServerState;
  const canPlay = canPlayBase && !isDirty;
  const canOpenGames = canOpenAnyGameMenu({ isDirty, canPlayBase });
  const gameBlockedReason = isDirty
    ? 'Peeper is dirty - clean first'
    : canPlayBase
      ? ''
      : 'No energy right now. Use food menu items to recover energy.';
  const handleGameSelect = useCallback(async (gameId) => {
    const gameMeta = GAMES.find((item) => item.id === gameId);
    const needsEnergy = gameNeedsEnergy(gameMeta);
    if (isDirty || (needsEnergy && !canPlayBase)) {
      showToast?.(gameBlockedReason || 'Cannot play right now');
      return;
    }

    setShowGameMenu(false);
    setLoadingGame(gameId);
    try {
      await preloadGame(gameId);
      setActiveGame(gameId);
    } catch (error) {
      showToast?.(error.message || 'Could not load game right now');
    } finally {
      setLoadingGame((current) => (current === gameId ? null : current));
    }
  }, [canPlayBase, gameBlockedReason, isDirty, showToast]);

  useEffect(() => {
    if (!blackjackInviteToken || activeGame === 'blackjack' || loadingGame === 'blackjack') return;
    handleGameSelect('blackjack');
  }, [activeGame, blackjackInviteToken, handleGameSelect, loadingGame]);

  useEffect(() => {
    if (!arenaInviteToken || activeGame === 'arena' || loadingGame === 'arena') return;
    handleGameSelect('arena');
  }, [activeGame, arenaInviteToken, handleGameSelect, loadingGame]);
  const ageSeconds = Math.floor(Date.now() / 1000) - peeper.born_at;
  const ageDays = Math.floor(ageSeconds / 86400);
  const ageHours = Math.floor((ageSeconds % 86400) / 3600);
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 390;
  const homeStagePeeperSize = Math.min(300, Math.max(248, viewportWidth - 92));
  const livePeeper = { ...peeper, hunger, fun, hp: live.hp, alive: live.alive };
  const hasHome = Boolean(homeSummary?.owned);
  const hasFarm = Boolean(farmSummary?.owned);
  const ageLabel = ageDays >= 10 ? `Age: ${ageDays}d` : `Age: ${ageDays}d ${ageHours}h`;
  const homeScene = homeBackdrop || EMPTY_HOME_SCENE;
  const ActiveGameComponent = activeGame ? GAME_COMPONENTS[activeGame] : null;
  const homePeeperContent = (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <PeeperSprite peeper={livePeeper} size={homeStagePeeperSize} />
      {isAlive && (
        <PeeperCleaningOverlay
          size={homeStagePeeperSize}
          dirtyState={dirtyState}
          spongeActive={spongeMode}
          disabled={cleanupBusy || awaitingServerState}
          onPoopTap={handlePoopCleanup}
          onComplete={handleCleaningComplete}
          onToggleSponge={() => setSpongeMode((current) => !current)}
          onProgressChange={setCleanupProgress}
        />
      )}
    </div>
  );
  const showCleanupDock = isAlive && isDirty && !gameplayOpen;
  const cleanupDockText = dirtyState === 'poop'
    ? 'Tap poop to clean'
    : spongeMode
      ? `Wash your Peeper - ${Math.max(0, Math.round(cleanupProgress * 100))}%`
      : 'Press Sponge and scrub';
  void topGifts;

  return (
    <div className="home-screen-shell">
      {!gameplayOpen && (
        <>
          <div className="home-screen-background">
            <div className="home-screen-background-glow" />
            {hasHome ? (
              <div className="home-screen-house-stage">
                <HomeScene
                  home={homeScene}
                  peeper={livePeeper}
                  peeperSize={homeStagePeeperSize}
                  shellClassName="home-screen-house-canvas"
                  sceneClassName="home-screen-house-scene"
                  peeperContent={homePeeperContent}
                />
              </div>
            ) : (
              <div className="home-screen-peeper-stage">
                <div
                  className="home-screen-peeper-only"
                  style={{
                    width: homeStagePeeperSize,
                    height: homeStagePeeperSize,
                  }}
                >
                  {homePeeperContent}
                </div>
              </div>
            )}
            <div className="home-screen-background-vignette" />
          </div>
          <div className="home-screen-content" ref={contentRef}>
            <div className="home-screen-top-stack" ref={topStackRef}>
              <div className="home-screen-top-row">
                <button className="home-screen-profile-card" onClick={onProfileOpen}>
                  <UserAvatar telegramId={user?.telegram_id} name={user?.first_name} />
                  <div className="home-screen-profile-copy">
                    <div className="home-screen-profile-name">{user?.first_name || 'Peeper Owner'}</div>
                    <div className="home-screen-profile-subtitle">
                      {user?.username ? `@${user.username}` : 'Open profile'}
                    </div>
                    {hasNewGifts && <div className="home-screen-gifts-badge">New gifts</div>}
                  </div>
                </button>

                <div className="home-screen-top-controls">
                  <div className="home-screen-age-pill">🌱 {ageLabel}</div>
                  <button
                    type="button"
                    className="home-screen-meta-btn"
                    onClick={() => setShowHint(true)}
                  >
                    💡 Tip
                  </button>
                  <div className="coins-badge home-screen-coins-pill">✦ {user?.coins ?? 0}</div>
                </div>
              </div>

              <div className="home-screen-status-card">
                {awaitingServerState && (
                  <div className="home-screen-inline-notice warning">
                    Syncing with server...
                  </div>
                )}

                {!isAlive && (
                  <div className="home-screen-inline-notice danger">
                    Your Peeper has passed away 😢
                  </div>
                )}

                {isAlive
                  ? <StatusBars peeper={livePeeper} energy={energy} />
                  : <div className="home-screen-empty-stats">All stats depleted</div>
                }
              </div>
            </div>

            <div className="home-screen-spacer" />

            <div className="home-screen-bottom-stack" ref={bottomStackRef}>
              {isAlive ? (
                <div className="home-screen-actions-panel">
                  <div className="home-screen-actions-grid">
                    <div className="home-screen-action-card">
                      <button
                        className={`btn btn-full home-screen-action-btn ${hasHome ? 'home-screen-action-home ready' : 'home-screen-action-muted'}`}
                        onClick={handleHomePress}
                        disabled={buyingHome}
                      >
                        {buyingHome ? '…' : hasHome ? '🏠 Home' : `🏠 Home · ${HOME_PRICE_COINS} ${COIN_SYMBOL}`}
                      </button>
                    </div>

                    <div className="home-screen-action-card home-screen-farm-card">
                      <button
                        className={`btn btn-full home-screen-action-btn ${hasFarm ? 'home-screen-action-farm ready' : 'home-screen-action-muted'}`}
                        onClick={handleFarmPress}
                      >
                        {hasFarm ? '🌾 Farm' : `🌾 Farm · ${farmSummary?.purchaseCost || 1000} ${COIN_SYMBOL}`}
                      </button>
                      {farmSummary?.hasAction && (
                        <span className="home-screen-farm-badge">
                          {farmSummary.actionCount || '!'}
                        </span>
                      )}
                    </div>

                    <div className="home-screen-action-card">
                      <button
                        className={`btn btn-full home-screen-action-btn ${canFeed ? 'home-screen-action-feed ready' : 'home-screen-action-muted'}`}
                        onClick={() => !feedLoading && setShowFoodMenu(true)}
                        disabled={feedLoading}
                      >
                        {feedLoading ? '…' : '🍎 Feed'}
                      </button>
                      <div className={`home-screen-action-caption ${canFeed ? 'positive' : ''}`}>
                        {fridgeCaption || (canFeed ? `Hungry! (${Math.round(hunger)}%)` : `Full (${Math.round(hunger)}%)`)}
                      </div>
                    </div>

                    <div
                      className={`home-screen-action-card play-lock-shell${isDirty ? ' locked' : ''}${playUnlocking ? ' unlocking' : ''}`}
                      style={{ position: 'relative', overflow: 'visible' }}
                    >
                      <button
                        className={`btn btn-full home-screen-action-btn ${canOpenGames ? 'home-screen-action-play ready' : 'home-screen-action-muted'}${isDirty ? ' home-screen-play-disabled' : ''}`}
                        onClick={() => {
                          setShowGameMenu(true);
                        }}
                      >
                        🎮 Play
                      </button>
                      {arenaQueueActive && (
                        <span
                          style={{
                            position: 'absolute',
                            right: 12,
                            top: -10,
                            zIndex: 4,
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            background: '#ffcf6b',
                            border: '2px solid white',
                            fontSize: 15,
                            boxShadow: '0 8px 20px rgba(224,85,85,0.34)',
                            animation: 'home-arena-sword-badge 0.9s ease-in-out infinite',
                            pointerEvents: 'none',
                          }}
                        >
                          ⚔️
                        </span>
                      )}
                      <div className={`home-screen-action-caption ${canOpenGames && !isDirty ? 'energy' : ''}${isDirty ? ' danger' : ''}`}>
                        {isDirty
                          ? 'Peeper is dirty - clean first'
                          : canPlay
                          ? `${'⚡'.repeat(energy)} ${energy} energ${energy === 1 ? 'y' : 'ies'}`
                          : 'No energy • Free games available'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="home-screen-actions-panel home-screen-actions-panel-single">
                  <button className="btn btn-primary btn-full btn-lg" onClick={revivePeeper}>🌱 Revive Peeper</button>
                  <p className="home-screen-revive-copy">
                    Start fresh — take better care this time!
                  </p>
                </div>
              )}
            </div>

            {showCleanupDock && (
              <div
                className="home-screen-cleanup-dock"
                style={{
                  top: `${cleanupDockBounds.top}px`,
                  bottom: `${cleanupDockBounds.bottom}px`,
                }}
              >
                <div className="home-screen-cleanup-stack">
                  <div className={`home-screen-cleanup-pill${spongeMode ? ' active' : ''}`}>
                    {cleanupDockText}
                  </div>
                  {dirtyState === 'scrubbing' && !spongeMode && (
                    <button
                      type="button"
                      className="home-screen-cleanup-btn"
                      onClick={() => !cleanupBusy && setSpongeMode(true)}
                      disabled={cleanupBusy || awaitingServerState}
                    >
                      <span style={{ fontSize: 16, lineHeight: 1 }}>{String.fromCodePoint(0x1F9FD)}</span>
                      <span>Sponge</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {showFoodMenu && (
        <FoodMenu
          hunger={hunger}
          energy={energy}
          coins={user?.coins ?? 0}
          energyDrink={energyDrink}
          fridge={fridge}
          onSelect={handleFoodSelect}
          onClose={() => setShowFoodMenu(false)}
          loading={feedLoading}
        />
      )}
      {showHomePurchase && (
        <HomePurchaseSheet
          coins={user?.coins ?? 0}
          loading={buyingHome}
          onClose={() => !buyingHome && setShowHomePurchase(false)}
          onConfirm={handleHomeBuy}
        />
      )}
        {showGameMenu && (
          <GameMenu
            energy={energy}
            canPlayBase={canPlayBase}
            isDirty={isDirty}
            blockedReason={gameBlockedReason}
            casinoJackpot={casinoJackpot}
            arenaQueueActive={arenaQueueActive}
            onSelect={handleGameSelect}
            onClose={() => setShowGameMenu(false)}
          />
        )}
      {showHint && <HintSheet onClose={() => setShowHint(false)} />}
      {loadingGame && <GameLoadingOverlay gameId={loadingGame} />}
      {ActiveGameComponent && (
        <Suspense fallback={<GameLoadingOverlay gameId={activeGame} />}>
          <ActiveGameComponent
            onComplete={handleGameComplete}
            onClose={handleGameQuit}
            onViewProfile={onViewProfile}
            inviteToken={activeGame === 'blackjack' ? blackjackInviteToken : activeGame === 'arena' ? arenaInviteToken : null}
            onInviteTokenConsumed={activeGame === 'blackjack' ? onBlackjackInviteConsumed : activeGame === 'arena' ? onArenaInviteConsumed : null}
          />
        </Suspense>
      )}
      {showFarm && (
        <FarmScreen
          onClose={() => {
            setShowFarm(false);
            refreshGameState();
          }}
          onStateChange={() => refreshGameState()}
          showToast={showToast}
        />
      )}
      {showPersonalHome && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 160,
            background: 'var(--bg-primary)',
            overflow: 'hidden',
            animation: 'slide-up 0.25s ease',
            paddingTop: 'var(--tg-total-top)',
          }}
        >
          <PersonalHomeScreen
            onClose={() => {
              setShowPersonalHome(false);
              refreshHomeBackdrop().catch(() => null);
            }}
          />
        </div>
      )}
    </div>
  );
}
