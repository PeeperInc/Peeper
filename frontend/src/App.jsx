import React, { useEffect, useState, useCallback, useRef } from 'react';
import * as api from './api';
import { AppRoot } from '@telegram-apps/telegram-ui';
import { AppProvider, useApp } from './context/AppContext';
import { shouldPauseAppPolling } from './utils/gameplayRuntime.mjs';
import HomeScreen       from './screens/HomeScreen';
import { isAdmin }      from './adminConfig';
import WardrobeScreen   from './screens/WardrobeScreen';
import ShopScreen       from './screens/ShopScreen';
import GiftScreen       from './screens/GiftScreen';
import LeaderboardScreen from './screens/LeaderboardScreen';
import ProfileScreen    from './screens/ProfileScreen';
import FamilyScreen   from './screens/FamilyScreen';
import OutfitsScreen  from './screens/OutfitsScreen';
import FamilyProfile  from './components/FamilyProfile';
import AdminScreen      from './screens/AdminScreen';
import GlobalChatScreen from './screens/GlobalChatScreen';

// ── Tabs config ─────────────────────────────────────────────────────────────
const BASE_TABS = [
  { id: 'home',        label: 'Home',       icon: '🏠' },
  { id: 'outfits',     label: 'Outfits',    icon: '👗' },
  { id: 'family',      label: 'Family',     icon: '👨‍👩‍👧' },
  { id: 'gift',        label: 'Gift',       icon: '🎁' },
  { id: 'leaderboard', label: 'Ranks',      icon: '🏆' },
  { id: 'chat',        label: 'Chat',       icon: '💬' },
];

// ── Telegram SDK initialization ──────────────────────────────────────────────
function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    document.documentElement.setAttribute('data-platform', 'web');
    return null;
  }

  tg.ready();
  tg.expand(); // Expand to full height

  // Disable closing on vertical swipe (prevents accidental close)
  try { tg.disableVerticalSwipes?.(); } catch {}

  const platform = String(tg.platform || 'web').toLowerCase();
  document.documentElement.setAttribute('data-platform', platform || 'web');

  // Apply safe area CSS variables (works in both normal and fullscreen mode)
  function applySafeArea() {
    const sa  = tg.safeAreaInset        || { top: 0, bottom: 0 };
    const csa = tg.contentSafeAreaInset || { top: 0, bottom: 0 };
    const safeTop = Number(sa.top || 0);
    const contentTop = Number(csa.top || 0);
    const safeBottom = Number(sa.bottom || 0);
    const compactBottom = platform === 'ios' ? Math.max(0, safeBottom - 10) : safeBottom;
    const homeBottom = platform === 'ios' ? Math.max(0, safeBottom - 14) : safeBottom;
    const r = document.documentElement.style;
    r.setProperty('--tg-safe-top', `${safeTop}px`);
    r.setProperty('--tg-content-top', `${contentTop}px`);
    r.setProperty('--tg-safe-bottom', `${safeBottom}px`);
    r.setProperty('--tg-safe-bottom-ui', `${compactBottom}px`);
    r.setProperty('--tg-safe-bottom-home', `${homeBottom}px`);
    r.setProperty('--tg-total-top', `${Math.max(safeTop, contentTop)}px`);
  }
  applySafeArea();
  tg.onEvent?.('safeAreaChanged',        applySafeArea);
  tg.onEvent?.('contentSafeAreaChanged', applySafeArea);

  return tg;
}

// ── Toast ────────────────────────────────────────────────────────────────────
function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return <div className="toast">{toast}</div>;
}

// ── Loading / Error screen ───────────────────────────────────────────────────
function SplashScreen({ error }) {
  return (
    <div style={{
      height: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
      background: 'var(--bg-primary)', padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: 72 }}>🐸</div>
      {error ? (
        <>
          <h2 style={{ color: 'var(--danger)', margin: 0, fontSize: 18 }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>{error}</p>
          <button
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Try Again
          </button>
        </>
      ) : (
        <>
          <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: 22 }}>Peeper</h2>
          <p style={{ color: 'var(--text-hint)', fontSize: 13, margin: 0 }}>Loading your frog…</p>
          <div style={{
            width: 40, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginTop: 8,
          }}>
            <div style={{
              height: '100%', background: 'var(--accent)', borderRadius: 2,
              animation: 'loading-bar 1.2s ease-in-out infinite alternate',
              width: '60%',
            }} />
          </div>
          <style>{`@keyframes loading-bar { from { transform: translateX(-100%) } to { transform: translateX(200%) } }`}</style>
        </>
      )}
    </div>
  );
}

// ── No Telegram warning ──────────────────────────────────────────────────────
function NotInTelegram() {
  return (
    <div style={{
      height: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, textAlign: 'center',
    }}>
      <div style={{ fontSize: 64 }}>🐸</div>
      <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>Open in Telegram</h2>
      <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: 14 }}>
        Peeper is a Telegram Mini App.<br />
        Please open it through the Peeper bot in Telegram to play.
      </p>
    </div>
  );
}

// ── Main App content ─────────────────────────────────────────────────────────
function AppContent() {
  const { initialized, loading, error, initialize, user } = useApp();
  const [activeTab,       setActiveTab]       = useState('home');
  const [showProfile,     setShowProfile]     = useState(false);
  const [viewingFamilyId, setViewingFamilyId] = useState(null);
  const [viewingFamilyInviteCode, setViewingFamilyInviteCode] = useState(null);
  const [profileUserId,   setProfileUserId]   = useState(null);  // null = own profile
  const [giftRecipient,   setGiftRecipient]   = useState(null);  // pre-fill gift recipient
  const [familyUnreadCount, setFamilyUnreadCount] = useState(0);
  const [familyAvailableAp, setFamilyAvailableAp] = useState(0);
  const [globalUnreadCount, setGlobalUnreadCount] = useState(0);
  const [blackjackInviteToken, setBlackjackInviteToken] = useState(null);
  const [arenaInviteToken, setArenaInviteToken] = useState(null);
  const [gameplayOpen, setGameplayOpen] = useState(false);
  const tabBarRef = useRef(null);

  const [topGifts,    setTopGifts]    = useState([]);

  // Shared gift-seen handler — called from both HomeScreen and ProfileScreen
  const handleGiftSeen = useCallback((giftId) => {
    setTopGifts(prev => prev.map(g => g.id === giftId ? { ...g, is_seen: 1 } : g));
  }, []);

  // Fetch gifts when user is available, and refresh when profile closes
  const fetchTopGifts = useCallback(() => {
    if (!user?.id) return;
    api.getUserGifts(user.id).then(d => setTopGifts(d.topGifts || [])).catch(() => {});
  }, [user?.id]);

  useEffect(() => { fetchTopGifts(); }, [fetchTopGifts]);

  // Poll for new gifts every 30s so badge appears without page reload
  useEffect(() => {
    if (!user?.id || shouldPauseAppPolling({ gameplayOpen })) return;
    const interval = setInterval(fetchTopGifts, 30000);
    return () => clearInterval(interval);
  }, [user?.id, fetchTopGifts, gameplayOpen]);

  const fetchFamilyUnread = useCallback(async () => {
    if (!user?.id) {
      setFamilyUnreadCount(0);
      setFamilyAvailableAp(0);
      return;
    }
    try {
      const [unreadResult, expeditionResult] = await Promise.all([
        api.getFamilyUnread(),
        api.getExpeditionBadge(),
      ]);
      setFamilyUnreadCount(unreadResult?.unreadCount || 0);
      setFamilyAvailableAp(expeditionResult?.hasAvailableAp ? Number(expeditionResult.availableAp || 0) : 0);
    } catch {
      // ignore
    }
  }, [user?.id]);

  const fetchGlobalUnread = useCallback(async () => {
    if (!user?.id) {
      setGlobalUnreadCount(0);
      return;
    }
    try {
      const result = await api.getGlobalUnread();
      setGlobalUnreadCount(result?.unreadCount || 0);
    } catch {
      // ignore
    }
  }, [user?.id]);

  useEffect(() => {
    fetchGlobalUnread();
  }, [fetchGlobalUnread]);

  useEffect(() => {
    if (!user?.id || activeTab === 'chat' || shouldPauseAppPolling({ gameplayOpen })) return;
    const interval = setInterval(fetchGlobalUnread, 15000);
    return () => clearInterval(interval);
  }, [activeTab, fetchGlobalUnread, gameplayOpen, user?.id]);

  useEffect(() => {
    if (!user?.id || shouldPauseAppPolling({ gameplayOpen })) return;
    fetchFamilyUnread();
    const interval = setInterval(fetchFamilyUnread, 15000);
    return () => clearInterval(interval);
  }, [user?.id, activeTab, fetchFamilyUnread, gameplayOpen]);

  const hasNewGifts = topGifts.some(g => !g.is_seen);

  function openProfile(userId = null) {
    setProfileUserId(userId);
    setShowProfile(true);
  }

  // isAdmin imported from adminConfig.js — single source of truth
  const userIsAdmin = isAdmin(user);
  const TABS = BASE_TABS;

  // Check Telegram environment
  // SDK loads async — wait up to 3s for window.Telegram to appear
  const [tgChecked, setTgChecked] = useState(Boolean(window.Telegram?.WebApp));

  useEffect(() => {
    if (window.Telegram?.WebApp) { setTgChecked(true); return; }
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (window.Telegram?.WebApp) { setTgChecked(true); clearInterval(interval); }
      else if (attempts >= 30) { setTgChecked(true); clearInterval(interval); } // give up after 3s
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const isInTelegram = tgChecked && Boolean(
    window.Telegram?.WebApp?.initData ||
    window.Telegram?.WebApp?.platform ||
    localHosts.has(window.location.hostname)
  );

  useEffect(() => {
    if (!tgChecked) return;
    if (!isInTelegram) return;
    initialize();
  }, [initialize, isInTelegram, tgChecked]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search || '');
    const urlInvite = params.get('bjInvite');
    const urlArenaInvite = params.get('arenaInvite');
    const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param || '';
    const startInvite = String(startParam).startsWith('bjInvite_')
      ? String(startParam).slice('bjInvite_'.length)
      : '';
    const startArenaInvite = String(startParam).startsWith('arenaInvite_')
      ? String(startParam).slice('arenaInvite_'.length)
      : '';
    const token = urlInvite || startInvite;
    if (token) setBlackjackInviteToken(token);
    const arenaToken = urlArenaInvite || startArenaInvite;
    if (arenaToken) setArenaInviteToken(arenaToken);
  }, []);

  useEffect(() => {
    const tabBar = tabBarRef.current;
    if (!tabBar || typeof document === 'undefined') return undefined;

    const applyTabBarHeight = () => {
      const nextHeight = Math.ceil(tabBar.getBoundingClientRect().height || 0);
      document.documentElement.style.setProperty('--app-tab-bar-height', `${nextHeight}px`);
    };

    applyTabBarHeight();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(applyTabBarHeight)
      : null;

    resizeObserver?.observe(tabBar);
    window.addEventListener('resize', applyTabBarHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', applyTabBarHeight);
    };
  }, [activeTab, showProfile, userIsAdmin]);

  if (!tgChecked) return <SplashScreen />; // still waiting for SDK
  if (!isInTelegram) return <NotInTelegram />;
  if (loading || !initialized) return <SplashScreen error={error} />;
  if (error) return <SplashScreen error={error} />;

  return (
    <div className="app-shell">
      <Toast />

      {/* Profile overlay */}
      {showProfile && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'var(--bg-primary)',
          overflowY: 'auto',
          animation: 'slide-up 0.25s ease',
          paddingTop: 'var(--tg-total-top)',
        }}>
          <style>{`@keyframes slide-up { from { transform: translateY(100%) } to { transform: translateY(0) } }`}</style>
          <ProfileScreen
            onClose={() => { setShowProfile(false); setProfileUserId(null); fetchTopGifts(); }}
            initialViewUserId={profileUserId}
            topGifts={topGifts}
            onGiftSeen={handleGiftSeen}
            onSendGiftTo={(recipientUser) => {
              setGiftRecipient(recipientUser);
              setShowProfile(false);
              setProfileUserId(null);
              setActiveTab('gift');
            }}
            onViewFamily={(familyId) => {
              setViewingFamilyId(familyId);
              setViewingFamilyInviteCode(null);
              setShowProfile(false);
            }}
          />
        </div>
      )}

      {/* Screen content — HomeScreen always mounted to preserve state,
           others unmount on tab switch to free memory */}
      <div className="screen-content" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* HomeScreen stays mounted but receives isActive so it can pause animations */}
        <div style={{ display: activeTab === 'home' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <HomeScreen
            onProfileOpen={() => openProfile(null)}
            onViewProfile={(uid) => openProfile(uid)}
            blackjackInviteToken={blackjackInviteToken}
            onBlackjackInviteConsumed={() => setBlackjackInviteToken(null)}
            arenaInviteToken={arenaInviteToken}
            onArenaInviteConsumed={() => setArenaInviteToken(null)}
            onGameplayOpenChange={setGameplayOpen}
            isActive={activeTab === 'home' && !showProfile}
            topGifts={topGifts}
            hasNewGifts={hasNewGifts}
            onGiftSeen={handleGiftSeen}
            onAdminOpen={userIsAdmin ? () => setActiveTab('admin') : null}
          />
        </div>
        {viewingFamilyId && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'var(--bg-primary)',
          overflowY: 'auto',
          animation: 'slide-up 0.25s ease',
          paddingTop: 'var(--tg-total-top)',
        }}>
          <FamilyProfile
            familyId={viewingFamilyId}
            inviteCode={viewingFamilyInviteCode}
            onBack={() => { setViewingFamilyId(null); setViewingFamilyInviteCode(null); }}
            onJoined={() => {
              setViewingFamilyId(null);
              setViewingFamilyInviteCode(null);
              setActiveTab('family');
            }}
            onViewProfile={(uid) => {
              setViewingFamilyId(null);
              setViewingFamilyInviteCode(null);
              setProfileUserId(uid);
              setShowProfile(true);
            }}
          />
        </div>
      )}
      {activeTab === 'outfits'     && <OutfitsScreen />}
        {activeTab === 'family'      && (
          <FamilyScreen
            onViewProfile={(uid) => { setProfileUserId(uid); setShowProfile(true); }}
            onFamilyUnreadChange={setFamilyUnreadCount}
            onGameplayOpenChange={setGameplayOpen}
          />
        )}
        {activeTab === 'gift'        && <GiftScreen initialRecipient={giftRecipient} key={giftRecipient?.id ?? 'no-recipient'} />}
        {activeTab === 'leaderboard' && <LeaderboardScreen onViewProfile={(id) => openProfile(id)} />}
        {activeTab === 'chat'        && (
          <GlobalChatScreen
            onViewProfile={(id) => openProfile(id)}
            onSendGift={(recipient) => {
              setGiftRecipient(recipient);
              setActiveTab('gift');
            }}
            onOpenFamily={({ familyId, inviteCode }) => {
              setViewingFamilyId(familyId);
              setViewingFamilyInviteCode(inviteCode || null);
            }}
            onUnreadChange={setGlobalUnreadCount}
          />
        )}
        {activeTab === 'admin'       && <AdminScreen />}
      </div>

      {/* Bottom Tab Bar */}
      <nav className="tab-bar" ref={tabBarRef}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => { setActiveTab(tab.id); if (tab.id !== 'gift') setGiftRecipient(null); }}
          >
            <span className="tab-icon-wrap">
              <span className="tab-icon">{tab.icon}</span>
              {tab.id === 'family' && familyUnreadCount > 0 && <span className="tab-notification-dot" />}
              {tab.id === 'family' && familyAvailableAp > 0 && (
                <span className="tab-expedition-ap-badge" aria-label={`${familyAvailableAp} expedition AP available`}>AP</span>
              )}
              {tab.id === 'chat' && globalUnreadCount > 0 && (
                <span className="tab-unread-badge" aria-label={`${globalUnreadCount} unread Global Chat messages`}>
                  {globalUnreadCount > 99 ? '99+' : globalUnreadCount}
                </span>
              )}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// ── Global animation pause when app is backgrounded ─────────────────────────
// Pauses ALL CSS animations/transitions when the Telegram mini app is hidden
// This prevents animated WebPs and other animations from draining CPU/GPU
function usePageVisibility() {
  useEffect(() => {
    function onVisibility() {
      document.documentElement.style.setProperty(
        '--animation-play-state',
        document.hidden ? 'paused' : 'running'
      );
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}

// ── Theme handler ────────────────────────────────────────────────────────────
function ThemeWrapper({ children }) {
  const [theme, setTheme] = useState('dark');
  usePageVisibility();

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    function applyTheme() {
      setTheme('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    }

    if (tg) {
      applyTheme();
      tg.onEvent?.('themeChanged', applyTheme);
    } else {
      applyTheme();
    }
  }, []);

  return (
    <AppRoot appearance={theme}>
      {children}
    </AppRoot>
  );
}

// ── Root export ──────────────────────────────────────────────────────────────
export default function App() {
  // Init Telegram SDK as early as possible
  useEffect(() => { initTelegram(); }, []);

  return (
    <ThemeWrapper>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ThemeWrapper>
  );
}
