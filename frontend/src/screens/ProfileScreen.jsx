import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import PeeperSprite from '../components/PeeperSprite';
import GiftGallery from '../components/GiftGallery';
import SupporterStar from '../components/SupporterStar';
import ProfileStudio, { ProfileAvatar, ProfileHero, ProfileName } from '../components/ProfileCustomization';
import VisitHomeScreen from './VisitHomeScreen';
import * as api from '../api';

const profileSmallTextStyle = {
  color: 'var(--text-secondary)',
  fontWeight: 600,
};

const profileLabelTextStyle = {
  color: 'var(--text-secondary)',
  fontWeight: 700,
  letterSpacing: '0.01em',
};

function formatRank(rank) {
  return rank ? `#${rank}` : '—';
}

function ProfileRanks({ ranks }) {
  if (!ranks) return null;

  const rankColumnStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  };

  return (
    <div style={{ padding: '0 16px 12px' }}>
      <div
        className="card"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          padding: '12px 14px',
          textAlign: 'center',
        }}
      >
        <div style={rankColumnStyle}>
          <div style={{ ...profileLabelTextStyle, fontSize: 11 }}>Longest Alive</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--accent)', marginTop: 2 }}>
            {formatRank(ranks.longevityRank)}
          </div>
        </div>
        <div style={rankColumnStyle}>
          <div style={{ ...profileLabelTextStyle, fontSize: 11 }}>Top Giftees</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--accent)', marginTop: 2 }}>
            {formatRank(ranks.giftRank)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Other user's profile ───────────────────────────────────────────────────
function UserProfile({ userId, onBack, isSelf, selfUserId, onSendGift, onViewProfile, onViewFamily, onVisitHome }) {
  const [profile, setProfile] = useState(null);
  const [gifts,   setGifts]   = useState({ topGifts: [], totalCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError(null);
      try {
        const [prof, giftData] = await Promise.all([
          api.getUserProfile(userId),
          api.getUserGifts(userId),
        ]);
        if (!cancelled) {
          setProfile(prof);
          setGifts({ topGifts: giftData.topGifts || [], totalCount: giftData.totalCount || 0 });
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // When user sees a new gift — mark it locally so badge disappears instantly
  const handleGiftSeen = useCallback((giftId) => {
    setGifts(prev => ({
      ...prev,
      topGifts: prev.topGifts.map(g => g.id === giftId ? { ...g, is_seen: 1 } : g),
    }));
  }, []);

  return (
    <div style={{ minHeight: '100%', paddingBottom: 24 }}>
      <div style={{ padding: '12px 16px 0' }}>
        <button className="btn btn-ghost app-back-button" onClick={onBack}>
          Back
        </button>
      </div>

      {loading && <div style={{ ...profileSmallTextStyle, textAlign: 'center', padding: 60 }}>Loading profile…</div>}
      {error   && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--danger)' }}>{error}</p>
          <button className="btn btn-secondary app-back-button" onClick={onBack}>Back</button>
        </div>
      )}

      {!loading && !error && profile && (
        <>
          <div style={{ padding: '12px 16px' }}>
            <ProfileHero
              user={profile.user}
              appearance={profile.user.appearance}
              action={!isSelf && onSendGift ? (
                <button className="btn btn-primary" onClick={() => onSendGift(profile.user)}>🎁 Gift</button>
              ) : null}
            />
          </div>

          {profile.peeper && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 16px' }}>
              <PeeperSprite peeper={profile.peeper} size={200} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, padding: '0 16px 16px' }}>
            <div className="card" style={{ flex: 1, textAlign: 'center', padding: '14px 12px' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.02em' }}>{profile.ageDays}d</div>
              <div style={{ ...profileLabelTextStyle, fontSize: 11, marginTop: 4 }}>Peeper Age</div>
            </div>
            <div className="card" style={{ flex: 1, textAlign: 'center', padding: '14px 12px' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)', letterSpacing: '-0.02em' }}>{profile.totalGifts}</div>
              <div style={{ ...profileLabelTextStyle, fontSize: 11, marginTop: 4 }}>Gifts</div>
            </div>
            <div className="card" style={{ flex: 1, textAlign: 'center', padding: '14px 12px' }}>
              <div style={{ fontSize: 20 }}>{profile.peeper?.alive ? '💚' : '💀'}</div>
              <div style={{ ...profileLabelTextStyle, fontSize: 11, marginTop: 4 }}>{profile.peeper?.alive ? 'Alive' : 'Passed'}</div>
            </div>
          </div>

          <ProfileRanks ranks={profile.ranks} />

          {profile.family && (
            <div style={{ padding: '0 16px 12px' }}>
              <div className="card" onClick={() => onViewFamily && onViewFamily(profile.family.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10,
                  cursor: onViewFamily ? 'pointer' : 'default' }}>
                <span style={{ fontSize: 22 }}>👨‍👩‍👧</span>
                <div style={{ flex: 1 }}>
                  <div style={{ ...profileLabelTextStyle, fontSize: 11 }}>Family</div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{profile.family.name}</div>
                </div>
                {onViewFamily && <span style={{ color: 'var(--text-secondary)' }}>→</span>}
              </div>
            </div>
          )}

          {!isSelf && profile.homeSummary?.owned && (
            <div style={{ padding: '0 16px 12px' }}>
              <div
                className="card"
                onClick={() => onVisitHome && onVisitHome(profile.user.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: onVisitHome ? 'pointer' : 'default',
                }}
              >
                <span style={{ fontSize: 22 }}>🏠</span>
                <div style={{ flex: 1 }}>
                  <div style={{ ...profileLabelTextStyle, fontSize: 11 }}>Home</div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Visit Home</div>
                </div>
                {onVisitHome && <span style={{ color: 'var(--text-secondary)' }}>→</span>}
              </div>
            </div>
          )}

          <div className="section-label" style={profileLabelTextStyle}>Gift Gallery</div>
          <div style={{ padding: '0 16px' }}>
            <GiftGallery
              topGifts={gifts.topGifts}
              totalGifts={gifts.totalCount}
              isOwner={selfUserId === userId}
              onGiftsSeen={handleGiftSeen}
              onViewProfile={onViewProfile}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Own profile ────────────────────────────────────────────────────────────
/**
 * initialViewUserId — if set, start directly on that user's profile.
 * onClose          — closes the whole profile overlay (back to previous tab).
 */
export default function ProfileScreen({ onClose, initialViewUserId = null, topGifts: externalTopGifts, onGiftSeen: onExternalGiftSeen, onSendGiftTo, onViewFamily }) {
  const { user, peeper } = useApp();
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching,     setSearching]     = useState(false);
  const [viewingUserId, setViewingUserId] = useState(initialViewUserId);
  const [viewingHomeUserId, setViewingHomeUserId] = useState(null);
  const [myGiftsLocal,  setMyGiftsLocal]  = useState({ topGifts: [], totalCount: 0 });
  const [myProfile,     setMyProfile]     = useState(null);
  const [giftsLoading,  setGiftsLoading]  = useState(true);
  const [studioOpen,    setStudioOpen]    = useState(false);

  // Use external topGifts from App if provided (shared state), otherwise use local
  const myGifts = externalTopGifts
    ? { topGifts: externalTopGifts, totalCount: externalTopGifts.length }
    : myGiftsLocal;

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setGiftsLoading(true);
    Promise.all([
      api.getUserGifts(user.id),
      api.getUserProfile(user.id),
    ])
      .then(([giftData, profileData]) => {
        if (!cancelled) {
          setMyGiftsLocal({ topGifts: giftData.topGifts || [], totalCount: giftData.totalCount || 0 });
          setMyProfile(profileData);
        }
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setGiftsLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  const handleSearch = useCallback(async (q) => {
    const trimmed = (q || searchQuery).trim();
    if (trimmed.length < 3) return;
    setSearching(true); setSearchResults([]);
    try {
      const data = await api.searchUsers(trimmed);
      setSearchResults(data.users || []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, [searchQuery]);

  useEffect(() => {
    if (searchQuery.trim().length >= 3) {
      const t = setTimeout(() => handleSearch(searchQuery), 350);
      return () => clearTimeout(t);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  // Update my gift badge — update both local state and shared App state
  const handleMyGiftSeen = useCallback((giftId) => {
    setMyGiftsLocal(prev => ({
      ...prev,
      topGifts: prev.topGifts.map(g => g.id === giftId ? { ...g, is_seen: 1 } : g),
    }));
    onExternalGiftSeen?.(giftId); // propagate up to App → HomeScreen badge
  }, [onExternalGiftSeen]);

  // ── Viewing another user ─────────────────────────────────────────────────
  if (viewingHomeUserId !== null) {
    return (
      <VisitHomeScreen
        userId={viewingHomeUserId}
        onBack={() => setViewingHomeUserId(null)}
      />
    );
  }

  if (viewingUserId !== null) {
    const isOpenedFromOutside = initialViewUserId !== null && viewingUserId === initialViewUserId;
    return (
      <div style={{ height: '100%', overflowY: 'auto' }}>
        <UserProfile
          userId={viewingUserId}
          selfUserId={user?.id}
          isSelf={user?.id === viewingUserId}
          onSendGift={onSendGiftTo}
          onViewProfile={(uid) => setViewingUserId(uid)}
          onViewFamily={onViewFamily}
          onVisitHome={(uid) => setViewingHomeUserId(uid)}
          onBack={() => {
            if (isOpenedFromOutside) {
              // Came from leaderboard / gift screen — close whole overlay
              onClose?.();
            } else {
              // Navigated from search inside own profile — go back to own profile
              setViewingUserId(null);
            }
          }}
        />
      </div>
    );
  }

  if (studioOpen) {
    const studioUser = {
      ...user,
      supporter: user?.supporter || myProfile?.user?.supporter,
      appearance: myProfile?.user?.appearance || user?.appearance,
    };
    return (
      <ProfileStudio
        user={studioUser}
        initialAppearance={studioUser.appearance}
        onBack={() => setStudioOpen(false)}
        onAppearanceChange={(appearance) => {
          setMyProfile(current => current ? {
            ...current,
            user: { ...current.user, appearance },
          } : current);
        }}
      />
    );
  }

  // ── Own profile ──────────────────────────────────────────────────────────
  return (
    <div style={{ paddingBottom: 16 }}>
      <div className="profile-screen-header">
        <div className="page-header" style={{ padding: 0 }}>Profile 🐸</div>
        <div className="profile-screen-header-actions">
          <button className="btn btn-secondary profile-studio-launch" onClick={() => setStudioOpen(true)} aria-label="Open Profile Studio">
            Studio
          </button>
          {onClose && <button className="btn btn-ghost profile-screen-close" onClick={onClose} aria-label="Close profile">✕</button>}
        </div>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <ProfileHero
          user={{ ...user, supporter: user?.supporter || myProfile?.user?.supporter }}
          appearance={myProfile?.user?.appearance || user?.appearance}
          action={<div className="coins-badge">✦ {user?.coins ?? 0}</div>}
        />
      </div>

      {peeper && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 12 }}>
          <PeeperSprite peeper={peeper} size={180} />
        </div>
      )}

      <ProfileRanks ranks={myProfile?.ranks} />

      <div className="section-label" style={profileLabelTextStyle}>My Gift Gallery</div>
      <div style={{ padding: '0 16px 16px' }}>
        {giftsLoading
          ? <div style={{ ...profileSmallTextStyle, fontSize: 13, padding: '12px 0' }}>Loading gifts…</div>
          : <GiftGallery
              topGifts={myGifts.topGifts}
              totalGifts={myGifts.totalCount}
              isOwner={true}
              onGiftsSeen={handleMyGiftSeen}
              onViewProfile={(uid) => setViewingUserId(uid)}
          />
        }
      </div>

      <div className="section-label" style={profileLabelTextStyle}>Find Another Peeper</div>
      <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8 }}>
        <input className="search-input" style={{ flex: 1 }} placeholder="@username or name…"
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()} />
        <button className="btn btn-primary" onClick={handleSearch}
          disabled={searching || searchQuery.trim().length < 3}>
          {searching ? '…' : '🔍'}
        </button>
      </div>

      {searchResults.map(u => (
        <div key={u.id} className="lb-row" style={{ cursor: 'pointer' }} onClick={() => setViewingUserId(u.id)}>
          <ProfileAvatar user={u} appearance={u.appearance} size={40} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, fontSize: 14 }}>
              <ProfileName user={u} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />
              <SupporterStar user={u} size={12} />
            </div>
            {u.username && <div style={{ ...profileSmallTextStyle, fontSize: 12 }}>@{u.username}</div>}
          </div>
          <span style={{ color: 'var(--accent)', fontSize: 13 }}>View →</span>
        </div>
      ))}

      {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
        <div style={{ ...profileSmallTextStyle, padding: '0 16px', fontSize: 13 }}>Type at least 3 characters…</div>
      )}
      {searchResults.length === 0 && !searching && searchQuery.trim().length >= 3 && (
        <div style={{ ...profileSmallTextStyle, padding: '0 16px', fontSize: 13 }}>No users found for "{searchQuery.trim()}"</div>
      )}
    </div>
  );
}
