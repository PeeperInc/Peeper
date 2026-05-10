import React, { useState, useEffect } from 'react';
import FamilyProfile from '../components/FamilyProfile';
import SupporterStar from '../components/SupporterStar';
import * as api from '../api';
import { avatarUrl } from '../utils/avatarUrl';

function formatAge(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

function RankBadge({ rank }) {
  if (rank === 1) return <span className="lb-rank gold">🥇</span>;
  if (rank === 2) return <span className="lb-rank silver">🥈</span>;
  if (rank === 3) return <span className="lb-rank bronze">🥉</span>;
  return <span className="lb-rank">#{rank}</span>;
}

function UserAvatar({ telegramId, name }) {
  const [err, setErr] = useState(false);
  const src = avatarUrl(telegramId);
  if (src && !err) {
    return (
      <img src={src} alt={name} onError={() => setErr(true)}
        style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
    );
  }
  return (
    <div className="avatar-circle" style={{ width: 38, height: 38, fontSize: 20, flexShrink: 0 }}>🐸</div>
  );
}

function formatGiftCount(count) {
  const value = Number(count || 0);
  return `${value} gift${value === 1 ? '' : 's'}`;
}

function FamilyLeaderboardTab({ onViewProfile, onSelectFamily }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getFamilyLeaderboard(50)
      .then(r => setRows(r.leaderboard || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-hint)', fontSize: 13 }}>Loading…</div>
  );
  if (rows.length === 0) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-hint)' }}>No families yet!</div>
  );

  return (
    <div>
      {rows.map((f, i) => (
        <div key={f.id} onClick={() => onSelectFamily && onSelectFamily(f.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
          <div style={{ fontSize: 20, width: 30, textAlign: 'center', flexShrink: 0, fontWeight: 700,
            color: 'var(--text-hint)' }}>
            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i+1)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 2 }}>
              {f.member_count} member{f.member_count !== 1 ? 's' : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)' }}>✦ {f.total_coins_spent}</div>
            <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>🎁 {f.total_gifts_sent} gifts</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LeaderboardList({ rows, type, onViewProfile }) {
  if (!rows.length) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-hint)' }}>
        No entries yet — be the first!
      </div>
    );
  }
  return (
    <div>
      {rows.map((row, i) => (
        <div
          key={row.id}
          className="lb-row"
          style={{ cursor: 'pointer' }}
          onClick={() => onViewProfile(row.id)}
        >
          <RankBadge rank={i + 1} />
          <UserAvatar telegramId={row.telegram_id} name={row.first_name} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, fontWeight: 600, fontSize: 14 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.first_name}
              </span>
              <SupporterStar user={row} size={12} />
            </div>
            {row.username && (
              <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>@{row.username}</div>
            )}
          </div>
          {type === 'longevity' ? (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{formatAge(row.age_seconds)}</div>
              <div style={{ fontSize: 11, color: row.alive ? 'var(--accent)' : 'var(--danger)' }}>
                {row.alive ? '💚 alive' : '💀 passed'}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)' }}>
                ✦ {row.gift_value || 0}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>
                {formatGiftCount(row.gift_count)}
              </div>
            </div>
          )}
          <span style={{ fontSize: 12, color: 'var(--text-hint)', marginLeft: 4 }}>→</span>
        </div>
      ))}
    </div>
  );
}

export default function LeaderboardScreen({ onViewProfile }) {
  const [activeTab,       setActiveTab]     = useState('longevity');
  const [longevityData,   setLongevityData] = useState([]);
  const [giftsData,       setGiftsData]     = useState([]);
  const [loading,         setLoading]       = useState(false);
  const [viewingFamilyId, setViewingFamilyId] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getLongevityBoard(), api.getGiftsBoard()])
      .then(([lon, gif]) => {
        setLongevityData(lon.leaderboard || []);
        setGiftsData(gif.leaderboard || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (viewingFamilyId) return (
    <FamilyProfile
      familyId={viewingFamilyId}
      onBack={() => setViewingFamilyId(null)}
      onViewProfile={onViewProfile}
    />
  );

  return (
    <div style={{ paddingBottom: 16 }}>
      <div className="page-header">Leaderboard 🏆</div>
      <div className="inner-tabs">
        <button className={`inner-tab${activeTab === 'longevity' ? ' active' : ''}`} onClick={() => setActiveTab('longevity')}>
          ⏳ Longest Alive
        </button>
        <button className={`inner-tab${activeTab === 'gifts' ? ' active' : ''}`} onClick={() => setActiveTab('gifts')}>
          🎁 Top Giftees
        </button>
        <button className={`inner-tab${activeTab === 'families' ? ' active' : ''}`} onClick={() => setActiveTab('families')}>
          👨‍👩‍👧 Families
        </button>
      </div>
      {loading && activeTab !== 'families' ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-hint)', fontSize: 13 }}>Loading…</div>
      ) : activeTab === 'longevity' ? (
        <LeaderboardList rows={longevityData} type="longevity" onViewProfile={onViewProfile} />
      ) : activeTab === 'gifts' ? (
        <LeaderboardList rows={giftsData} type="gifts" onViewProfile={onViewProfile} />
      ) : (
        <FamilyLeaderboardTab onViewProfile={onViewProfile} onSelectFamily={setViewingFamilyId} />
      )}
    </div>
  );
}
