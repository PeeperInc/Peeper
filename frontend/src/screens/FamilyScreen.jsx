import React, { useState, useEffect, useRef, useCallback } from 'react';
import FamilyProfile from '../components/FamilyProfile';
import BottomSheet from '../components/BottomSheet';
import SupporterStar from '../components/SupporterStar';
import { useApp } from '../context/AppContext';
import * as api from '../api';
import { avatarUrl } from '../utils/avatarUrl';

function formatBigFeastCooldown(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  if (safeSeconds <= 0) return 'Ready now';

  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function Avatar({ telegramId, name, size = 36 }) {
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
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.3s' }} />
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
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-hint)', width: 32, textAlign: 'right' }}>
        {alive ? `${Math.round(pct)}%` : '💀'}
      </span>
    </div>
  );
}


function FamilyLeaderboard({ limit = 10, onSelect }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getFamilyLeaderboard(limit)
      .then(r => setRows(r.leaderboard || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [limit]);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-hint)', fontSize: 13 }}>Loading families…</div>
  );
  if (rows.length === 0) return (
    <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-hint)', fontSize: 13 }}>No families yet — be the first!</div>
  );

  return (
    <div>
      {rows.map((f, i) => (
        <div key={f.id} onClick={() => onSelect && onSelect(f.id)}
          style={{ display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', borderBottom: '1px solid var(--border)',
          cursor: onSelect ? 'pointer' : 'default' }}>
          <div style={{ fontSize: 18, width: 28, textAlign: 'center', flexShrink: 0, color: 'var(--text-hint)', fontWeight: 700 }}>
            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>
              {f.member_count} members
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent)' }}>✦ {f.total_coins_spent}</div>
            <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>🎁 {f.total_gifts_sent} gifts</div>
          </div>
        </div>
      ))}
    </div>
  );
}


function HowItWorksSheet({ onClose }) {
  return (
    <BottomSheet
      onClose={onClose}
      bodyStyle={{
        padding: '20px 20px 36px',
      }}
    >
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 18 }}>
          💡 How Family Stats Work
        </div>
        {[
          { icon: '✦',  title: 'Coins Spent on Gifts', body: 'The main ranking criterion. Total coins spent by all family members on gifts sent to other players. The more you gift — the higher your family ranks!' },
          { icon: '🎁', title: 'Gifts Sent',            body: 'Number of gifts sent by family members to other players — not received. Shown as extra info.' },
          { icon: '🍗', title: 'Family Feeding',        body: 'Once per day you can feed one family member for free (Tendies = +60% hunger). Costs no coins!' },
        ].map(({ icon, title, body }) => (
          <div key={title} style={{
            display: 'flex', gap: 14, alignItems: 'flex-start',
            padding: '12px 0', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 3 }}>{title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{body}</div>
            </div>
          </div>
        ))}
        <button onClick={onClose} style={{
          marginTop: 20, width: '100%', padding: '13px 0',
          background: 'var(--bg-secondary)', border: 'none',
          borderRadius: 14, fontSize: 15, fontWeight: 600,
          color: 'var(--text-secondary)', cursor: 'pointer',
        }}>Got it</button>
    </BottomSheet>
  );
}

// ── No Family screen ──────────────────────────────────────────────────────────
function BigFeastSheet({ bigFeast, userCoins, loading, onClose, onConfirm }) {
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const cost = bigFeast?.cost ?? 100;
  const availableAt = bigFeast?.available_at || nowTs;
  const cooldownSeconds = Math.max(0, availableAt - nowTs);
  const available = cooldownSeconds <= 0;
  const canAfford = (userCoins ?? 0) >= cost;

  useEffect(() => {
    if (available) return undefined;
    const id = window.setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [available]);

  return (
    <BottomSheet
      onClose={loading ? undefined : onClose}
      bodyStyle={{
        padding: '20px 20px 32px',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
        Big Feast
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
        Feed every living family member to <strong>100%</strong> hunger at once.
      </div>

      <div style={{
        padding: '14px 16px',
        borderRadius: 16,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginBottom: 6 }}>
          <span style={{ color: 'var(--text-hint)' }}>Cost</span>
          <strong style={{ color: 'var(--warning)' }}>✦ {cost}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
          <span style={{ color: 'var(--text-hint)' }}>Cooldown</span>
          <strong style={{ color: available ? 'var(--accent)' : 'var(--text-primary)' }}>
            {available ? 'Ready now' : formatBigFeastCooldown(cooldownSeconds)}
          </strong>
        </div>
      </div>

      {!canAfford && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 12,
          background: 'var(--danger-light)',
          color: 'var(--danger)',
          fontSize: 12,
          fontWeight: 700,
        }}>
          Not enough coins. You need {cost} ✦.
        </div>
      )}

      {!available && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 12,
          background: 'var(--bg-secondary)',
          color: 'var(--text-secondary)',
          fontSize: 12,
          fontWeight: 700,
        }}>
          Your next Big Feast will be ready in {formatBigFeastCooldown(cooldownSeconds)}.
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          className="btn btn-secondary btn-full"
          onClick={onClose}
          disabled={loading}
        >
          Close
        </button>
        <button
          type="button"
          className="btn btn-primary btn-full"
          onClick={onConfirm}
          disabled={loading || !available || !canAfford}
        >
          {loading ? 'Serving…' : `Buy · ${cost} ✦`}
        </button>
      </div>
    </BottomSheet>
  );
}

function NoFamily({ onCreated, onJoined, userCoins = 0, onSelectFamily, onShowHowItWorks }) {
  const [tab, setTab]     = useState('join'); // 'join' | 'create'
  const [name, setName]   = useState('');
  const [code, setCode]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    if (!name.trim()) return setError('Enter a family name');
    setLoading(true); setError('');
    try { const r = await api.createFamily(name.trim()); onCreated(r.family); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function handleJoin() {
    if (!code.trim()) return setError('Enter an invite code');
    setLoading(true); setError('');
    try { const r = await api.joinFamily(code.trim()); onJoined(r.family); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ padding: '0 16px', paddingBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="page-header" style={{ padding: 0 }}>Family 👨‍👩‍👧</div>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px' }}
          onClick={onShowHowItWorks}>❓ How it works</button>
      </div>
      <div style={{ textAlign: 'center', padding: '24px 0 20px' }}>
        <div style={{ fontSize: 56, marginBottom: 8 }}>🐸</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>You're not in a family yet</div>
        <div style={{ fontSize: 13, color: 'var(--text-hint)' }}>Create one or join with an invite code</div>
      </div>

      <div className="inner-tabs" style={{ margin: '0 0 16px' }}>
        {['join','create'].map(t => (
          <button key={t} className={`inner-tab${tab === t ? ' active' : ''}`}
            onClick={() => { setTab(t); setError(''); }}>
            {t === 'join' ? '🔗 Join' : '✨ Create'}
          </button>
        ))}
      </div>

      {tab === 'join' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="search-input" placeholder="Enter invite code (e.g. ABC12345)"
            value={code} onChange={e => setCode(e.target.value.toUpperCase())}
            style={{ textTransform: 'uppercase', letterSpacing: 2 }} />
          <button className="btn btn-primary btn-full" onClick={handleJoin} disabled={loading}>
            {loading ? 'Joining…' : 'Join Family'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="search-input" placeholder="Family name (2–24 chars)"
            value={name} onChange={e => setName(e.target.value)} maxLength={24} />
          <div style={{ fontSize: 12, color: userCoins >= 500 ? 'var(--text-hint)' : 'var(--danger)',
            textAlign: 'center' }}>
            Creating a family costs <strong>500 ✦</strong> · You have {userCoins} ✦
          </div>
          <button className="btn btn-primary btn-full" onClick={handleCreate}
            disabled={loading || userCoins < 500}>
            {loading ? 'Creating…' : userCoins >= 500 ? 'Create Family · 500 ✦' : 'Not enough coins'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 10, color: 'var(--danger)', fontSize: 13, textAlign: 'center' }}>{error}</div>
      )}

      <div className="section-label" style={{ marginTop: 20 }}>Top Families</div>
      <FamilyLeaderboard limit={10} onSelect={onSelectFamily} />
    </div>
  );
}


// ── Invite Sheet ──────────────────────────────────────────────────────────────
function InviteSheet({ family, memberCount, onClose, onInvited }) {
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [confirm, setConfirm]     = useState(null);
  const [sending, setSending]     = useState(false);
  const [toast, setToast]         = useState('');

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2500); }

  useEffect(() => {
    if (query.trim().length < 3) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.searchUsers(query.trim());
        setResults(r.users || []);
      } catch {} finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  async function handleInvite() {
    if (!confirm || sending) return;
    setSending(true);
    try {
      const r = await api.inviteFamilyMember(confirm.id);
      showToast(r.message);
      setConfirm(null);
      setQuery('');
      setResults([]);
      onInvited?.();
    } catch (e) { showToast(e.message); }
    finally { setSending(false); }
  }

  return (
    <BottomSheet
      onClose={onClose}
      zIndex={200}
      bodyStyle={{
        padding: '20px 20px 40px',
        maxHeight: '80vh',
        overflowY: 'auto',
      }}
    >
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>✉️ Invite to {family.name}</div>
        <div style={{ fontSize: 13, color: 'var(--text-hint)', marginBottom: 16 }}>
          {memberCount}/10 members · {10 - memberCount} slot{10 - memberCount !== 1 ? 's' : ''} available
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input className="search-input" style={{ flex: 1 }}
            placeholder="Search by @username or name…"
            value={query} onChange={e => setQuery(e.target.value)} autoFocus />
          {searching && <span style={{ alignSelf: 'center', color: 'var(--text-hint)' }}>…</span>}
        </div>

        {query.trim().length > 0 && query.trim().length < 3 && (
          <div style={{ color: 'var(--text-hint)', fontSize: 13, padding: '4px 0' }}>Type at least 3 characters…</div>
        )}

        {results.map(u => (
          <div key={u.id} onClick={() => setConfirm(u)}
            style={{ display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
              background: confirm?.id === u.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
              marginBottom: 8, border: confirm?.id === u.id ? '1.5px solid var(--accent)' : '1.5px solid transparent' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-card)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🐸</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, fontSize: 14 }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.first_name}</span>
                <SupporterStar user={u} size={12} />
              </div>
              {u.username && <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>@{u.username}</div>}
            </div>
            {confirm?.id === u.id && <span style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 700 }}>Selected ✓</span>}
          </div>
        ))}

        {results.length === 0 && !searching && query.trim().length >= 3 && (
          <div style={{ color: 'var(--text-hint)', fontSize: 13, padding: '8px 0' }}>No users found</div>
        )}

        {confirm && (
          <div style={{ marginTop: 12, padding: 14, background: 'var(--accent-light)',
            borderRadius: 14, border: '1.5px solid var(--accent)' }}>
            <div style={{ fontSize: 14, marginBottom: 12, lineHeight: 1.4 }}>
              Invite <strong>{confirm.first_name}</strong> to <strong>{family.name}</strong>?
              They'll get a Telegram notification with Accept/Decline buttons.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-full" onClick={() => setConfirm(null)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn btn-primary btn-full" onClick={handleInvite}
                disabled={sending} style={{ flex: 2 }}>
                {sending ? 'Sending…' : '✉️ Send Invite'}
              </button>
            </div>
          </div>
        )}

        {toast && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10,
            background: 'var(--bg-secondary)', textAlign: 'center', fontSize: 13 }}>{toast}</div>
        )}
    </BottomSheet>
  );
}

// ── Members tab ───────────────────────────────────────────────────────────────
function MembersTab({
  family,
  members,
  fedTodayUserId,
  currentUserId,
  isFounder,
  userCoins,
  bigFeast,
  onOpenBigFeast,
  onFed,
  onKick,
  onLeave,
  onViewProfile,
}) {
  const [feeding, setFeeding]   = useState(null);
  const [leaving, setLeaving]   = useState(false);
  const [toast, setToast]       = useState('');
  const [copied, setCopied]     = useState(false);
  const [nowTs, setNowTs]       = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2500); }

  async function handleFeed(memberId) {
    setFeeding(memberId);
    try {
      const r = await api.feedFamilyMember(memberId);
      showToast(r.message);
      // Backend gives +60% hunger — optimistically update bar
      const member = members.find(m => m.id === memberId);
      const newHunger = member ? Math.min(100, (member.liveHunger || 0) + 60) : 60;
      onFed(memberId, newHunger);
    } catch (e) { showToast(e.message); }
    finally { setFeeding(null); }
  }

  async function handleKick(memberId) {
    if (!window.confirm('Remove this member from the family?')) return;
    try { await api.kickMember(memberId); onKick(memberId); }
    catch (e) { showToast(e.message); }
  }

  async function handleLeave() {
    if (!window.confirm('Leave this family?')) return;
    setLeaving(true);
    try { await api.leaveFamily(); onLeave(); }
    catch (e) { showToast(e.message); setLeaving(false); }
  }

  function copyCode() {
    navigator.clipboard?.writeText(family.invite_code).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  const feastCost = bigFeast?.cost ?? 100;
  const feastAvailableAt = bigFeast?.available_at || nowTs;
  const feastCooldownSeconds = Math.max(0, feastAvailableAt - nowTs);
  const feastAvailable = feastCooldownSeconds <= 0;
  const canAffordFeast = (userCoins ?? 0) >= feastCost;

  return (
    <div style={{ paddingBottom: 24 }}>
      {toast && (
        <div style={{ position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '8px 20px', borderRadius: 20,
          fontSize: 13, zIndex: 300, whiteSpace: 'nowrap' }}>{toast}</div>
      )}

      <div style={{ fontSize: 12, color: 'var(--text-hint)', padding: '4px 16px 0' }}>
        {members.length}/10 members
      </div>


      <div style={{ fontSize: 12, color: 'var(--text-hint)', padding: '0 16px 8px' }}>
        {fedTodayUserId
          ? '✅ You fed a family member today'
          : '🍗 You can feed one member today (free Tendies!)'}
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <button
          type="button"
          className={`btn btn-full ${feastAvailable && canAffordFeast ? 'btn-primary' : 'btn-secondary'}`}
          onClick={onOpenBigFeast}
          disabled={!feastAvailable || !canAffordFeast}
          style={{
            minHeight: 48,
            borderRadius: 16,
            fontSize: 14,
            fontWeight: 800,
          }}
        >
          Big Feast · {feastCost} ✦
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 6, textAlign: 'center' }}>
          {feastAvailable
            ? 'Feeds every living family member to 100% hunger'
            : `Ready again in ${formatBigFeastCooldown(feastCooldownSeconds)}`}
        </div>
      </div>

      {/* Members list */}
      {members.map(m => {
        const isMe = m.id === currentUserId;
        const canFeed = !fedTodayUserId && !isMe && m.liveAlive && m.liveHunger <= 70;
        return (
          <div key={m.id}
            onClick={() => !isMe && onViewProfile && onViewProfile(m.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', borderBottom: '1px solid var(--border)',
            background: family.founder_id === m.id ? 'rgba(255,215,0,0.06)' : 'transparent',
            cursor: !isMe && onViewProfile ? 'pointer' : 'default' }}>
            <Avatar telegramId={m.telegram_id} name={m.first_name} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.first_name}</span>
                <SupporterStar user={m} size={12} />
                {family.founder_id === m.id && (
                  <span style={{ fontSize: 10, fontWeight: 800, color: '#b8860b',
                    background: 'rgba(255,215,0,0.2)', border: '1px solid rgba(255,215,0,0.5)',
                    borderRadius: 6, padding: '1px 6px' }}>👑 Founder</span>
                )}
                {isMe && <span style={{ fontSize: 10, color: 'var(--text-hint)' }}>(you)</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--danger)', width: 24 }}>HP</span>
                <LifeBar hp={m.liveHp} alive={m.liveAlive} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', width: 24 }}>Food</span>
                <HungerBar hunger={m.liveHunger} alive={m.liveAlive} />
              </div>
              {m.coins_spent > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 2 }}>
                  ✦ {m.coins_spent} spent · 🎁 {m.gifts_sent}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {canFeed && (
                <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={e => { e.stopPropagation(); handleFeed(m.id); }} disabled={feeding === m.id}>
                  {feeding === m.id ? '…' : '🍗'}
                </button>
              )}
              {fedTodayUserId === m.id && !isMe && (
                <span style={{ fontSize: 18 }}>✅</span>
              )}
              {isFounder && !isMe && (
                <button className="btn btn-ghost" style={{ padding: '6px 8px', fontSize: 12, color: 'var(--danger)' }}
                  onClick={e => { e.stopPropagation(); handleKick(m.id); }}>✕</button>
              )}
            </div>
          </div>
        );
      })}

      {/* Leave button at bottom */}
      <div style={{ padding: '16px 16px 8px', borderTop: '1px solid var(--border)', marginTop: 8 }}>
        <button
          className="btn btn-ghost btn-full"
          style={{ color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 12, padding: '10px 0', fontSize: 14 }}
          onClick={handleLeave}
          disabled={leaving}
        >
          {leaving ? 'Leaving…' : '🚪 Leave Family'}
        </button>
      </div>
    </div>
  );
}

// ── Chat tab ──────────────────────────────────────────────────────────────────
function ChatTab({ family, currentUserId, onMessagesRead }) {
  const [messages, setMessages]   = useState([]);
  const [input, setInput]         = useState('');
  const [sending, setSending]     = useState(false);
  const bottomRef = useRef(null);
  const intervalRef = useRef(null);
  const onMessagesReadRef = useRef(onMessagesRead);

  useEffect(() => {
    onMessagesReadRef.current = onMessagesRead;
  }, [onMessagesRead]);

  const loadMessages = useCallback(async () => {
    try {
      const r = await api.getFamilyMessages();
      setMessages(r.messages || []);
      await api.markFamilyMessagesRead();
      onMessagesReadRef.current?.();
      return r.messages || [];
    } catch {}
  }, []);

  useEffect(() => {
    loadMessages();
    intervalRef.current = setInterval(loadMessages, 5000);
    return () => clearInterval(intervalRef.current);
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    const msg = input.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await api.sendFamilyMessage(msg);
      setInput('');
      await loadMessages();
    } catch (e) {
      // ignore
    } finally { setSending(false); }
  }

  function formatTime(ts) {
    const d = new Date(ts * 1000);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${day}.${month} ${time}`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)' }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-hint)', fontSize: 13 }}>
            No messages yet.<br/>Say hi to your family! 👋
          </div>
        )}
        {messages.map(m => {
          const isMe = m.user_id === currentUserId;
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row',
              gap: 8, marginBottom: 10, alignItems: 'flex-end' }}>
              {!isMe && <Avatar telegramId={m.telegram_id} name={m.first_name} size={28} />}
              <div style={{ maxWidth: '72%' }}>
                {!isMe && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-hint)', marginBottom: 2, paddingLeft: 4 }}>
                    <span>{m.first_name}</span>
                    <SupporterStar user={m} size={10} />
                  </div>
                )}
                <div style={{
                  background: isMe ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: isMe ? '#142214' : 'var(--text-primary)',
                  padding: '8px 12px', borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  fontSize: 14, lineHeight: 1.4, wordBreak: 'break-word',
                  fontWeight: isMe ? 850 : 700,
                }}>
                  {m.message}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-hint)', marginTop: 2,
                  textAlign: isMe ? 'right' : 'left', paddingLeft: isMe ? 0 : 4 }}>
                  {formatTime(m.sent_at)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '8px 16px 12px', display: 'flex', gap: 8,
        borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
        <input
          className="search-input" style={{ flex: 1 }}
          placeholder="Message your family…"
          value={input} onChange={e => setInput(e.target.value)}
          maxLength={200}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        />
        <button className="btn btn-primary" style={{ padding: '8px 16px', flexShrink: 0 }}
          onClick={handleSend} disabled={sending || !input.trim()}>
          {sending ? '…' : '➤'}
        </button>
      </div>
    </div>
  );
}

// ── Main FamilyScreen ─────────────────────────────────────────────────────────
export default function FamilyScreen({ onViewProfile, onFamilyUnreadChange }) {
  const { user, refreshGameState, showToast } = useApp();
  const [family, setFamily]           = useState(null);
  const [members, setMembers]         = useState([]);
  const [fedToday, setFedToday]       = useState(null);
  const [bigFeast, setBigFeast]       = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]         = useState('members');
  const [viewingFamilyId, setViewingFamilyId] = useState(null);
  const [showHowItWorks, setShowHowItWorks]   = useState(false);
  const [copied, setCopied]                   = useState(false);
  const [showInvite, setShowInvite]           = useState(false);
  const [showBigFeast, setShowBigFeast]       = useState(false);
  const [bigFeastLoading, setBigFeastLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.getMyFamily();
      setFamily(r.family);
      setMembers(r.members || []);
      setFedToday(r.fedTodayUserId || null);
      setBigFeast(r.bigFeast || null);
      setUnreadCount(r.unreadCount || 0);
      onFamilyUnreadChange?.(r.unreadCount || 0);
    } catch {}
    finally { setLoading(false); }
  }, [onFamilyUnreadChange]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!family || activeTab === 'chat') return undefined;

    let cancelled = false;
    async function refreshUnread() {
      try {
        const result = await api.getFamilyUnread();
        if (cancelled) return;
        const nextUnread = result?.unreadCount || 0;
        setUnreadCount(nextUnread);
        onFamilyUnreadChange?.(nextUnread);
      } catch {}
    }

    refreshUnread();
    const id = window.setInterval(refreshUnread, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [family, activeTab, onFamilyUnreadChange]);

  useEffect(() => {
    if (!family) {
      setUnreadCount(0);
      onFamilyUnreadChange?.(0);
    }
  }, [family, onFamilyUnreadChange]);

  const handleBigFeast = useCallback(async () => {
    if (bigFeastLoading) return;
    setBigFeastLoading(true);
    try {
      const result = await api.triggerFamilyBigFeast();
      showToast?.(result.message || 'Big Feast served!');
      setShowBigFeast(false);
      await Promise.all([load(), refreshGameState()]);
    } catch (error) {
      showToast?.(error.message || 'Could not serve Big Feast');
      if (error?.data?.bigFeast) {
        setBigFeast(error.data.bigFeast);
      }
    } finally {
      setBigFeastLoading(false);
    }
  }, [bigFeastLoading, load, refreshGameState, showToast]);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-hint)' }}>Loading…</div>
  );

  if (viewingFamilyId) return (
    <FamilyProfile
      familyId={viewingFamilyId}
      onBack={() => setViewingFamilyId(null)}
      onViewProfile={onViewProfile}
    />
  );

  if (!family) return (
    <>
      {showHowItWorks && <HowItWorksSheet onClose={() => setShowHowItWorks(false)} />}
      <NoFamily
        onCreated={() => load()}
        onJoined={() => load()}
        userCoins={user?.coins ?? 0}
        onSelectFamily={id => setViewingFamilyId(id)}
        onShowHowItWorks={() => setShowHowItWorks(true)}
      />
    </>
  );

  const isFounder = family.founder_id === user?.id;

  return (
    <div style={{ paddingBottom: 0 }}>
      {showHowItWorks && <HowItWorksSheet onClose={() => setShowHowItWorks(false)} />}

      {/* Header: name + how it works */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 6px' }}>
        <div className="page-header" style={{ padding: 0 }}>{family.name} 👨‍👩‍👧</div>
        <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 8px' }}
          onClick={() => setShowHowItWorks(true)}>❓ How it works</button>
      </div>

      {/* Code + invite row */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 10px', alignItems: 'center' }}>
        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }}
          onClick={() => { navigator.clipboard?.writeText(family.invite_code).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? '✓ Copied!' : `🔗 ${family.invite_code}`}
        </button>
        {isFounder && members.length < 10 && (
          <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => setShowInvite(true)}>
            ✉️ Invite
          </button>
        )}
      </div>

      {showInvite && (
        <InviteSheet
          family={family}
          memberCount={members.length}
          onClose={() => setShowInvite(false)}
          onInvited={() => setShowInvite(false)}
        />
      )}

      {showBigFeast && (
        <BigFeastSheet
          bigFeast={bigFeast}
          userCoins={user?.coins ?? 0}
          loading={bigFeastLoading}
          onClose={() => !bigFeastLoading && setShowBigFeast(false)}
          onConfirm={handleBigFeast}
        />
      )}

      {/* Tab switcher */}
      <div className="inner-tabs" style={{ marginTop: 4 }}>
        {[['members','👥 Members'],['chat','💬 Chat']].map(([id, label]) => (
          <button key={id} className={`inner-tab${activeTab === id ? ' active' : ''}`}
            onClick={() => setActiveTab(id)}>
            <span className="family-tab-label">{label}</span>
            {id === 'chat' && unreadCount > 0 && (
              <span className="badge family-chat-unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'members' && (
        <MembersTab
          family={family} members={members}
          fedTodayUserId={fedToday}
          currentUserId={user?.id}
          isFounder={isFounder}
          userCoins={user?.coins ?? 0}
          bigFeast={bigFeast}
          onOpenBigFeast={() => setShowBigFeast(true)}
          onViewProfile={onViewProfile}
          onFed={(memberId, newHunger) => {
            setFedToday(memberId);
            setMembers(prev => prev.map(m =>
              m.id === memberId ? { ...m, liveHunger: Math.min(100, (m.liveHunger || 0) + 60) } : m
            ));
          }}
          onKick={memberId => setMembers(prev => prev.filter(m => m.id !== memberId))}
          onLeave={() => {
            setFamily(null);
            setMembers([]);
            setBigFeast(null);
            setUnreadCount(0);
            onFamilyUnreadChange?.(0);
          }}
        />
      )}

      {activeTab === 'chat' && (
        <ChatTab
          family={family}
          currentUserId={user?.id}
          onMessagesRead={() => {
            setUnreadCount(0);
            onFamilyUnreadChange?.(0);
          }}
        />
      )}
    </div>
  );
}
