import React from 'react';

function Bar({ label, icon, value, colorClass }) {
  const pct      = Math.min(100, Math.max(0, value));
  const isDanger = pct < 20;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 14, lineHeight: 1, width: 20, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 32, flexShrink: 0, fontWeight: 500 }}>{label}</span>
      <div style={{ flex: 1, height: 7, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
        <div
          className={`stat-bar-fill ${isDanger ? 'danger' : colorClass}`}
          style={{ width: `${pct}%`, height: '100%', borderRadius: 99, transition: 'width 0.4s ease' }}
        />
      </div>
      <span style={{
        fontSize: 11, width: 34, textAlign: 'right', flexShrink: 0,
        color: isDanger ? 'var(--danger)' : 'var(--text-hint)',
        fontWeight: isDanger ? 700 : 500,
        fontFamily: 'var(--font-mono)',
      }}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

export default function StatusBars({ peeper, energy }) {
  if (!peeper) return null;
  const showEnergy = typeof energy === 'number';
  return (
    <div style={{ padding: '4px 0' }}>
      <Bar label="HP"   icon="❤️" value={peeper.hp}     colorClass="hp"     />
      <Bar label="Food" icon="🍃" value={peeper.hunger} colorClass="hunger" />
      <Bar label="Fun"  icon="🎈" value={peeper.fun}    colorClass="fun"    />
      {showEnergy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 14, lineHeight: 1, width: 20, textAlign: 'center', flexShrink: 0 }}>⚡</span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 32, flexShrink: 0, fontWeight: 500 }}>Energy</span>
          <div style={{ flex: 1, display: 'flex', gap: 4 }}>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} style={{
                flex: 1, height: 7, borderRadius: 99,
                background: i < energy ? '#7B9EC8' : 'var(--border)',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>
          <span style={{ fontSize: 11, width: 34, textAlign: 'right', flexShrink: 0, color: energy > 0 ? '#7B9EC8' : 'var(--text-hint)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
            {energy}/5
          </span>
        </div>
      )}
    </div>
  );
}
