import React from 'react';
import { HOME_PRICE_COINS } from '../homeConstants';
import BottomSheet from './BottomSheet';

export default function HomePurchaseSheet({ coins, loading, onClose, onConfirm }) {
  const canAfford = coins >= HOME_PRICE_COINS;

  return (
    <BottomSheet onClose={onClose} bodyStyle={{ paddingBottom: 'calc(var(--tg-safe-bottom) + 28px)' }}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🏠</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
          Buy Personal Home
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Buy an empty Personal Home for {HOME_PRICE_COINS} ✦?
        </div>
      </div>

      <div
        className="card"
        style={{
          marginBottom: 16,
          background: 'var(--bg-card)',
          padding: '14px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Your coins</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: canAfford ? 'var(--warning)' : 'var(--danger)' }}>
          ✦ {coins}
        </span>
      </div>

      {!canAfford && (
        <div style={{ fontSize: 13, color: 'var(--danger)', textAlign: 'center', marginBottom: 14 }}>
          You need {HOME_PRICE_COINS - coins} more ✦ to buy your home.
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-secondary btn-full" onClick={onClose} disabled={loading}>
          Cancel
        </button>
        <button className="btn btn-primary btn-full" onClick={onConfirm} disabled={!canAfford || loading}>
          {loading ? 'Buying…' : `Buy for ${HOME_PRICE_COINS} ✦`}
        </button>
      </div>
    </BottomSheet>
  );
}
