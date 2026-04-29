import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api';
import { avatarUrl } from '../utils/avatarUrl';

function UserAvatar({ telegramId, name, size = 38 }) {
  const [err, setErr] = useState(false);
  const src = avatarUrl(telegramId);
  if (src && !err) return (
    <img src={src} alt={name} onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  );
  return <div className="avatar-circle" style={{ width: size, height: size, fontSize: size * 0.5, flexShrink: 0 }}>🐸</div>;
}

function GiftImage({ gift, size = 64, lazy = false }) {
  const [err,        setErr]       = useState(false);
  const [shouldLoad, setShouldLoad] = useState(!lazy);
  const [loaded,     setLoaded]     = useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!lazy || !ref.current || !gift?.file_path) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) { setShouldLoad(true); obs.disconnect(); }
        else if (shouldLoad) { /* already loaded, keep it */ }
      },
      { rootMargin: '200px' }
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [lazy, gift?.file_path]);

  if (!gift?.file_path || err) {
    return <div ref={ref} style={{ fontSize: size * 0.7, lineHeight: 1 }}>🎁</div>;
  }

  return (
    <div ref={ref} style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {shouldLoad ? (
        <img
          src={gift.file_path}
          alt={gift.name}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setErr(true)}
          style={{
            width: size, height: size, objectFit: 'contain', borderRadius: 8,
            opacity: loaded ? 1 : 0, transition: 'opacity 0.2s',
            animationPlayState: 'var(--animation-play-state, running)',
            willChange: 'opacity',
            contain: 'layout paint',
          }}
        />
      ) : (
        <div style={{ width: size, height: size, background: 'var(--bg-secondary)', borderRadius: 8, opacity: 0.4 }} />
      )}
    </div>
  );
}

// ── Step indicators ─────────────────────────────────────────────────────────
function Steps({ current }) {
  const steps = ['Gift', 'Recipient', 'Message'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 4px', gap: 0 }}>
      {steps.map((label, i) => {
        const idx   = i + 1;
        const done  = current > idx;
        const active = current === idx;
        return (
          <React.Fragment key={label}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: done || active
                  ? 'linear-gradient(160deg, var(--accent) 0%, var(--accent-hover) 100%)'
                  : 'var(--bg-secondary)',
                border: done || active ? 'none' : '1.5px solid var(--border)',
                color: done || active ? '#fff' : 'var(--text-hint)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, transition: 'all 0.25s',
                boxShadow: done || active ? '0 2px 8px rgba(74,124,89,0.25)' : 'none',
              }}>
                {done ? '✓' : idx}
              </div>
              <div style={{ fontSize: 10, color: active ? 'var(--accent)' : 'var(--text-hint)', fontWeight: active ? 700 : 500 }}>
                {label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? 'var(--accent)' : 'var(--border)', margin: '0 6px 16px', borderRadius: 99, transition: 'background 0.3s' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function GiftScreen({ initialRecipient = null }) {
  const { user, sendGift } = useApp();

  const [step,          setStep]          = useState(1);
  const [giftCatalog,   setGiftCatalog]   = useState([]);
  const [catalogLoading,setCatalogLoading]= useState(true);
  const [selectedGift,  setSelectedGift]  = useState(null);
  const [query,         setQuery]         = useState('');
  const [searchResults, setResults]       = useState([]);
  const [searching,     setSearching]     = useState(false);
  const [recipient,     setRecipient]     = useState(initialRecipient);
  const [message,       setMessage]       = useState('');
  const [isPrivate,     setIsPrivate]     = useState(false);
  const [sending,       setSending]       = useState(false);
  const [sent,          setSent]          = useState(false);

  // Load gift catalog from API — abort on unmount
  useEffect(() => {
    let cancelled = false;
    api.getGiftCatalog()
      .then(d => { if (!cancelled) setGiftCatalog(d.gifts || []); })
      .catch(() => { if (!cancelled) setGiftCatalog([]); })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const giftObj = giftCatalog.find(g => g.item_id === selectedGift);

  // ── Step 1 handlers ───────────────────────────────────────────────────────
  function selectGift(giftId) {
    setSelectedGift(giftId);
    // If recipient is already pre-filled (came from profile), skip to message step
    if (recipient) {
      setStep(3);
    } else {
      setStep(2);
    }
  }

  // ── Step 2 handlers ───────────────────────────────────────────────────────
  const doSearch = useCallback(async (q) => {
    const trimmed = q.trim();
    if (trimmed.length < 3) return;
    setSearching(true);
    setResults([]);
    try {
      const data = await api.searchUsersForGift(trimmed);
      setResults(data.users || []);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, []);

  // Auto-search after 3 characters
  useEffect(() => {
    if (query.trim().length >= 3) {
      const t = setTimeout(() => doSearch(query), 350);
      return () => clearTimeout(t);
    } else {
      setResults([]);
    }
  }, [query, doSearch]);

  function selectRecipient(u) {
    setRecipient(u);
    setStep(3);
  }

  // ── Step 3: send ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!recipient || !selectedGift) return;
    setSending(true);
    try {
      await sendGift(recipient.id, selectedGift, message.trim() || null, isPrivate);
      setSent(true);
    } finally { setSending(false); }
  }, [recipient, selectedGift, message, isPrivate, sendGift]);

  // ── Success screen ────────────────────────────────────────────────────────
  if (sent) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh', gap: 16 }}>
        <GiftImage gift={giftObj} size={100} />
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>Gift Sent!</div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center' }}>
          {giftObj?.name} is flying to {recipient?.first_name} 🐸
        </div>
        <button className="btn btn-primary" onClick={() => {
          setSent(false); setStep(1); setSelectedGift(null);
          setRecipient(null); setMessage(''); setQuery(''); setResults([]);
        }}>
          Send Another Gift
        </button>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 0' }}>
        <div className="page-header" style={{ padding: 0 }}>Send Gift 🎁</div>
        <div className="coins-badge">✦ {user?.coins ?? 0}</div>
      </div>

      {/* Step indicators */}
      <Steps current={step} />

      {/* ── STEP 1: Choose gift ───────────────────────────────────────── */}
      {step === 1 && (
        <>
          <div className="section-label">Choose a Gift</div>
          {catalogLoading && (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-hint)', fontSize: 13 }}>
              Loading gifts…
            </div>
          )}
          {!catalogLoading && giftCatalog.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-hint)', fontSize: 13 }}>
              No gifts available yet 🎁
            </div>
          )}
          <div className="item-grid">
            {giftCatalog.map(gift => {
              const canAfford = (user?.coins ?? 0) >= gift.price;
              return (
                <div
                  key={gift.item_id}
                  className={`item-card ${selectedGift === gift.item_id ? 'selected' : ''}`}
                  onClick={() => canAfford && selectGift(gift.item_id)}
                  style={{ cursor: canAfford ? 'pointer' : 'not-allowed', opacity: canAfford ? 1 : 0.4 }}
                >
                  <div className="item-emoji" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <GiftImage gift={gift} size={56} lazy={true} />
                  </div>
                  <div className="item-name">{gift.name}</div>
                  <div className="item-price">✦ {gift.price}</div>
                  {!canAfford && (
                    <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 2 }}>Not enough coins</div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── STEP 2: Find recipient ────────────────────────────────────── */}
      {step === 2 && (
        <>
          {/* Selected gift recap */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--accent-light)', margin: '8px 16px', borderRadius: 'var(--radius-md)' }}>
            <GiftImage gift={giftObj} size={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{giftObj?.name}</div>
              <div style={{ fontSize: 12, color: 'var(--accent)' }}>✦ {giftObj?.price}</div>
            </div>
            <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 13 }} onClick={() => { setStep(1); setSelectedGift(null); }}>
              Change
            </button>
          </div>

          <div className="section-label">Who gets it?</div>
          <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8 }}>
            <input
              className="search-input"
              style={{ flex: 1 }}
              placeholder="@username or name…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doSearch(query)}
              autoFocus
            />
            <button className="btn btn-primary" onClick={() => doSearch(query)} disabled={searching || query.trim().length < 3}>
              {searching ? '…' : '🔍'}
            </button>
          </div>

          {query.trim().length > 0 && query.trim().length < 3 && (
            <div style={{ padding: '0 16px', color: 'var(--text-hint)', fontSize: 13 }}>
              Type at least 3 characters…
            </div>
          )}

          {searchResults.map(u => (
            <div key={u.id} className="lb-row" style={{ cursor: 'pointer' }} onClick={() => selectRecipient(u)}>
              <UserAvatar telegramId={u.telegram_id} name={u.first_name} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{u.first_name}</div>
                {u.username && <div style={{ fontSize: 12, color: 'var(--text-hint)' }}>@{u.username}</div>}
              </div>
              <span style={{ color: 'var(--accent)', fontSize: 13 }}>Select →</span>
            </div>
          ))}

          {searchResults.length === 0 && !searching && query.trim().length >= 3 && (
            <div style={{ padding: '0 16px', color: 'var(--text-hint)', fontSize: 13 }}>No users found</div>
          )}

          {searchResults.length === 0 && !query && (
            <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--text-hint)', fontSize: 13 }}>
              Search for a friend to send the gift 🐸
            </div>
          )}
        </>
      )}

      {/* ── STEP 3: Message + send ────────────────────────────────────── */}
      {step === 3 && (
        <>
          {/* Recap */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 0' }}>
            <GiftImage gift={giftObj} size={36} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>→</span>
            <UserAvatar telegramId={recipient?.telegram_id} name={recipient?.first_name} size={32} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{recipient?.first_name}</div>
              {recipient?.username && <div style={{ fontSize: 11, color: 'var(--text-hint)' }}>@{recipient.username}</div>}
            </div>
            {!initialRecipient && (
              <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 13 }} onClick={() => { setStep(2); setRecipient(null); }}>
                Change
              </button>
            )}
          </div>

          {/* Message */}
          <div className="section-label">Add a Message (optional)</div>
          <div style={{ padding: '0 16px 8px' }}>
            <textarea
              style={{
                width: '100%', minHeight: 90, padding: '10px 12px',
                border: '1.5px solid var(--border)', borderRadius: 'var(--radius-md)',
                background: 'var(--bg-card)', color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)', fontSize: 14,
                resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              }}
              placeholder="Write something nice… (max 120 characters)"
              maxLength={120}
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>{message.length}/120</span>
            </div>
          </div>

          {/* Visibility toggle */}
          <div style={{ padding: '0 16px 16px' }}>
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {isPrivate ? '🔒 Private message' : '🌍 Public message'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {isPrivate
                    ? 'Only the recipient can see your message'
                    : 'Everyone visiting their profile can see it'}
                </div>
              </div>
              <button
                onClick={() => setIsPrivate(p => !p)}
                style={{
                  width: 44, height: 26, borderRadius: 13, border: 'none',
                  background: isPrivate ? 'var(--accent)' : 'var(--border)',
                  cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 3,
                  left: isPrivate ? 21 : 3, transition: 'left 0.2s',
                }} />
              </button>
            </div>
          </div>

          {/* Send button */}
          <div style={{ padding: '0 16px' }}>
            <button
              className="btn btn-primary btn-full btn-lg"
              onClick={handleSend}
              disabled={sending}
            >
              {sending
                ? 'Sending…'
                : `Send ${giftObj?.name} · ✦ ${giftObj?.price}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
