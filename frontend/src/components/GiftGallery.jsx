import React, { useState, useEffect, useMemo, useRef } from 'react';
import { GIFT_ITEMS } from '../itemsData';
import * as api from '../api';
import BottomSheet from './BottomSheet';
import SupporterStar from './SupporterStar';
import { ProfileName } from './ProfileCustomization';
import { GIFT_SORT_MODES, getGiftSortLabel, sortGifts } from '../utils/giftSort.mjs';

const PAGE_SIZE = 20;

function getGiftDisplay(gift) {
  if (gift.gift_image_url) return { type: 'image', src: gift.gift_image_url, name: gift.gift_catalog_name || 'Gift' };
  const legacy = GIFT_ITEMS.find(g => g.id === gift.gift_id);
  if (legacy) return { type: 'emoji', emoji: legacy.emoji, name: legacy.name };
  return { type: 'emoji', emoji: '🎁', name: 'Gift' };
}

function LazyGiftImage({ src, name, size = 48 }) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const [loaded,     setLoaded]     = useState(false);
  const [error,      setError]      = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShouldLoad(true); obs.disconnect(); } },
      { rootMargin: '200px' }
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  if (error) return <span style={{ fontSize: size * 0.6, lineHeight: 1 }}>🎁</span>;

  return (
    <div ref={ref} style={{ width: size, height: size, flexShrink: 0, contain: 'layout paint' }}>
      {shouldLoad ? (
        <img src={src} alt={name} loading="lazy" decoding="async"
          onLoad={() => setLoaded(true)} onError={() => setError(true)}
          style={{
            width: size, height: size, objectFit: 'contain',
            opacity: loaded ? 1 : 0, transition: 'opacity 0.2s',
            contain: 'layout paint',
          }}
        />
      ) : (
        <div style={{ width: size, height: size, background: 'var(--bg-secondary)', borderRadius: 6, opacity: 0.5 }} />
      )}
    </div>
  );
}

// ── Gift detail modal ──────────────────────────────────────────────────────
function GiftModal({ gift, isOwner, onClose, onViewProfile }) {
  const display = getGiftDisplay(gift);
  const hasMsg  = gift.message && (isOwner || !gift.is_private);

  const senderName     = gift.sender_name     || null;
  const senderUsername = gift.sender_username || null;
  const senderId       = gift.sender_id       || null;
  const sender = {
    first_name: senderName,
    username: senderUsername,
    supporter_since: gift.sender_supporter_since,
    supporter_stars: gift.sender_supporter_stars,
    appearance: gift.sender_appearance,
  };

  const canViewSender = senderId && onViewProfile;

  return (
    <BottomSheet
      onClose={onClose}
      zIndex={300}
      bodyStyle={{
        padding: '20px 24px 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
        maxHeight: '90vh',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
      }}
    >
        {/* Gift image */}
        <div style={{
          width: 110, height: 110,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-secondary)', borderRadius: 24,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}>
          {display.type === 'image'
            ? <img src={display.src} alt={display.name} style={{ width: 90, height: 90, objectFit: 'contain' }} />
            : <span style={{ fontSize: 72 }}>{display.emoji}</span>
          }
        </div>

        {/* Gift name */}
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', textAlign: 'center' }}>
          {display.name}
        </div>

        {/* Sender — clickable if we have an id */}
        {senderName && (
          <div
            onClick={canViewSender ? () => { onClose(); onViewProfile(senderId); } : undefined}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              background: canViewSender ? 'var(--accent-light)' : 'var(--bg-secondary)',
              borderRadius: 16,
              padding: '12px 24px', width: '100%',
              cursor: canViewSender ? 'pointer' : 'default',
              border: canViewSender ? '1.5px solid var(--accent)' : '1.5px solid transparent',
              transition: 'opacity 0.15s',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-hint)', marginBottom: 4 }}>From</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 16, fontWeight: 700, color: canViewSender ? 'var(--accent)' : 'var(--text-primary)' }}>
              <ProfileName user={sender} />
              <SupporterStar user={sender} size={13} />
            </div>
            {senderUsername && (
              <div style={{ fontSize: 12, color: 'var(--text-hint)', marginTop: 2 }}>@{senderUsername}</div>
            )}
            {canViewSender && (
              <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, fontWeight: 600 }}>
                View profile →
              </div>
            )}
          </div>
        )}

        {/* Message */}
        {hasMsg && (
          <div style={{
            width: '100%', background: 'var(--accent-light)',
            borderRadius: 16, padding: '14px 18px',
            borderLeft: '3px solid var(--accent)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginBottom: 6 }}>
              {Boolean(gift.is_private) ? '🔒' : '🌍'} Message
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5, fontStyle: 'italic' }}>
              "{gift.message}"
            </div>
          </div>
        )}

        <button onClick={onClose} className="btn btn-primary btn-full" style={{ marginTop: 4 }}>
          Close
        </button>
    </BottomSheet>
  );
}

// ── Gift tile ──────────────────────────────────────────────────────────────
function GiftTile({ gift, isOwner, onOpen }) {
  const display = getGiftDisplay(gift);
  const isNew   = isOwner && gift.is_seen === 0;

  return (
    <div
      style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer' }}
      onClick={() => onOpen(gift)}
    >
      {isNew && (
        <div style={{
          position: 'absolute', top: -4, right: -4,
          background: 'var(--accent)', color: '#fff',
          fontSize: 8, fontWeight: 800, padding: '2px 5px',
          borderRadius: 99, zIndex: 2, lineHeight: 1.2,
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        }}>
          NEW
        </div>
      )}
      <div>
        {display.type === 'image'
          ? <LazyGiftImage src={display.src} name={display.name} size={48} />
          : <span style={{ fontSize: 28, lineHeight: 1, display: 'block' }}>{display.emoji || '🎁'}</span>
        }
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────
export default function GiftGallery({ topGifts = [], totalGifts = 0, isOwner = false, onGiftsSeen, onViewProfile }) {
  const [openGift, setOpenGift] = useState(null);
  const [page,     setPage]     = useState(0);
  const [sortMode, setSortMode] = useState(GIFT_SORT_MODES.PRICE);

  const sortedGifts = useMemo(
    () => sortGifts(topGifts, sortMode, { isOwner }),
    [isOwner, sortMode, topGifts]
  );
  const totalPages = Math.max(1, Math.ceil(sortedGifts.length / PAGE_SIZE));
  const pageGifts  = sortedGifts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleOpen = (gift) => setOpenGift(gift);
  const toggleSortMode = () => {
    setSortMode((mode) => (
      mode === GIFT_SORT_MODES.PRICE ? GIFT_SORT_MODES.NEWEST : GIFT_SORT_MODES.PRICE
    ));
    setPage(0);
  };

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [page, totalPages]);

  const handleClose = async () => {
    if (isOwner && openGift && openGift.is_seen === 0) {
      try {
        await api.markGiftSeen(openGift.id);
        onGiftsSeen?.(openGift.id);
      } catch { /* silent */ }
    }
    setOpenGift(null);
  };

  if (topGifts.length === 0) {
    return (
      <div style={{
        padding: '24px 0', textAlign: 'center',
        color: 'var(--text-hint)', fontSize: 13,
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)',
      }}>
        No gifts yet — be the first! 🎁
      </div>
    );
  }

  return (
    <>
      <div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={toggleSortMode}
            style={{
              minHeight: 32,
              padding: '6px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            Sort: {getGiftSortLabel(sortMode)}
          </button>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 6, background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-md)', padding: 10,
        }}>
          {pageGifts.map((gift, i) => (
            <GiftTile key={`${gift.id || gift.gift_id}-${i}`} gift={gift} isOwner={isOwner} onOpen={handleOpen} />
          ))}
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, padding: '0 2px' }}>
          <div style={{ color: 'var(--text-hint)', fontSize: 12 }}>
            {totalGifts} gift{totalGifts !== 1 ? 's' : ''} total
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                className="btn btn-ghost"
                style={{ padding: '3px 10px', fontSize: 13, opacity: page === 0 ? 0.3 : 1 }}
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
              >
                ‹
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-hint)' }}>{page + 1} / {totalPages}</span>
              <button
                className="btn btn-ghost"
                style={{ padding: '3px 10px', fontSize: 13, opacity: page >= totalPages - 1 ? 0.3 : 1 }}
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>

      {openGift && (
        <GiftModal
          gift={openGift}
          isOwner={isOwner}
          onClose={handleClose}
          onViewProfile={onViewProfile}
        />
      )}
    </>
  );
}
