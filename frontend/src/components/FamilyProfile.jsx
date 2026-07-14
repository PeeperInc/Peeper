import React, { useState, useEffect } from 'react';
import * as api from '../api';
import { avatarUrl } from '../utils/avatarUrl';
import SupporterStar from './SupporterStar';

function Avatar({ telegramId, name, size = 42 }) {
  const [err, setErr] = useState(false);
  const src = avatarUrl(telegramId);
  if (src && !err) return (
    <img src={src} alt={name} onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  );
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--accent-light)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.45, flexShrink: 0 }}>
      🐸
    </div>
  );
}

function LifeBar({ hp, alive }) {
  const pct = Math.max(0, Math.min(100, hp || 0));
  const color = !alive ? '#888' : pct > 50 ? '#ef4444' : pct > 20 ? '#f97316' : 'var(--danger)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-hint)', width: 32, textAlign: 'right' }}>
        {alive ? `${Math.round(pct)}%` : '0%'}
      </span>
    </div>
  );
}

function HungerBar({ hunger, alive }) {
  const pct = Math.max(0, Math.min(100, hunger || 0));
  const color = !alive ? '#888' : pct > 50 ? 'var(--accent)' : pct > 20 ? '#ffd700' : 'var(--danger)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-hint)', width: 32, textAlign: 'right' }}>
        {alive ? `${Math.round(pct)}%` : '💀'}
      </span>
    </div>
  );
}

export default function FamilyProfile({ familyId, inviteCode = null, onBack, onViewProfile, onJoined }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [viewerFamily, setViewerFamily] = useState(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getFamilyProfile(familyId),
      inviteCode ? api.getMyFamily().catch(() => ({ family: null })) : Promise.resolve({ family: null }),
    ])
      .then(([profile, mine]) => {
        setData(profile);
        setViewerFamily(mine?.family || null);
      })
      .catch(e => setError(e.message || 'Failed to load family'))
      .finally(() => setLoading(false));
  }, [familyId, inviteCode]);

  async function handleJoin() {
    if (!inviteCode || joining) return;
    if (!window.confirm(`Join ${data?.family?.name || 'this family'}?`)) return;
    setJoining(true);
    setJoinError('');
    try {
      const result = await api.joinFamily(inviteCode);
      setViewerFamily(result.family);
      onJoined?.(result.family);
    } catch (joinFailure) {
      setJoinError(joinFailure.message || 'Could not join this family');
    } finally {
      setJoining(false);
    }
  }

  if (loading) return (
    <div style={{ padding: 16 }}>
      <button className="btn btn-ghost app-back-button" onClick={onBack}>Back</button>
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-hint)' }}>Loading…</div>
    </div>
  );

  if (error || !data) return (
    <div style={{ padding: 16 }}>
      <button className="btn btn-ghost app-back-button" onClick={onBack}>Back</button>
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--danger)' }}>{error || 'Not found'}</div>
    </div>
  );

  const { family, members, stats } = data;

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* Back */}
      <div style={{ padding: '12px 16px 0' }}>
        <button className="btn btn-ghost app-back-button" onClick={onBack}>Back</button>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px 10px' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>{family.name} 👨‍👩‍👧</div>
          <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 2 }}>
            {stats.member_count}/10 members
          </div>
        </div>
        {inviteCode && !viewerFamily && stats.member_count < 10 && (
          <button type="button" className="btn btn-primary" onClick={handleJoin} disabled={joining}>
            {joining ? 'Joining...' : 'Join Family'}
          </button>
        )}
      </div>

      {inviteCode && viewerFamily && Number(viewerFamily.id) !== Number(family.id) && (
        <div style={{ margin: '0 16px 12px', padding: 9, border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: 11 }}>
          Leave your current family before joining another one.
        </div>
      )}
      {joinError && <div style={{ margin: '0 16px 12px', color: 'var(--danger)', fontSize: 11 }}>{joinError}</div>}

      {/* Stats */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 14px' }}>
        <div className="card" style={{ flex: 2, textAlign: 'center', padding: '12px 8px' }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--accent)' }}>✦ {stats.total_coins_spent}</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>Coins spent on gifts</div>
        </div>
        <div className="card" style={{ flex: 1, textAlign: 'center', padding: '12px 8px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>{stats.total_gifts_sent}</div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>🎁 Gifts sent</div>
        </div>
      </div>

      {/* Members list — same style as MembersTab */}
      <div className="section-label">Members</div>
      {members.map((m, idx) => (
        <div key={m.id}
          onClick={() => onViewProfile && onViewProfile(m.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', borderBottom: '1px solid var(--border)',
            cursor: onViewProfile ? 'pointer' : 'default',
            background: family.founder_id === m.id ? 'rgba(255,215,0,0.06)' : 'transparent',
          }}>
          {/* Rank */}
          <div style={{ width: 22, textAlign: 'center', fontSize: 12,
            color: idx === 0 ? '#ffd700' : 'var(--text-hint)', fontWeight: 700, flexShrink: 0 }}>
            {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}`}
          </div>

          <Avatar telegramId={m.telegram_id} name={m.first_name} size={42} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.first_name}</span>
              <SupporterStar user={m} size={12} />
              {family.founder_id === m.id && (
                <span style={{ fontSize: 10, fontWeight: 800, color: '#b8860b',
                  background: 'rgba(255,215,0,0.2)', border: '1px solid rgba(255,215,0,0.5)',
                  borderRadius: 6, padding: '1px 6px' }}>👑 Founder</span>
              )}
            </div>
            {m.username && (
              <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>@{m.username}</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--danger)', width: 24 }}>HP</span>
              <LifeBar hp={m.liveHp} alive={m.liveAlive} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', width: 24 }}>Food</span>
              <HungerBar hunger={m.liveHunger} alive={m.liveAlive} />
            </div>
            {(m.coins_spent > 0 || m.gifts_sent > 0) && (
              <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>
                ✦ {m.coins_spent} spent · 🎁 {m.gifts_sent} gifts
              </div>
            )}
          </div>

          {onViewProfile && (
            <span style={{ color: 'var(--text-hint)', fontSize: 13, flexShrink: 0 }}>→</span>
          )}
        </div>
      ))}
    </div>
  );
}
