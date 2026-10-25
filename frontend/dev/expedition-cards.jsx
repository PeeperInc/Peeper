import React from 'react';
import { createRoot } from 'react-dom/client';
import FamilyExpeditionTab from '../src/screens/FamilyExpeditionTab';
import '../src/theme.css';
import '../src/browserInteractions';

document.documentElement.dataset.theme = 'dark';
const heroes = [['999999', 'Knight'], ['999998', 'Scout'], ['999997', 'Mage'], ['999996', 'Cleric']];
createRoot(document.getElementById('root')).render(<main style={{ maxWidth: 760, margin: '0 auto', padding: '8px 8px 24px' }}>
  <style>{'.expedition-game-title { visibility: hidden; } .expedition-game-topbar > .expedition-nav-button { visibility: hidden; flex: 0 0 48px; width: 48px; }'}</style>
  <select aria-label="Local test hero" value={new URLSearchParams(location.search).get('devUser') || '999999'}
    onChange={event => { window.location.href = `?devUser=${event.target.value}`; }}
    style={{ position: 'fixed', zIndex: 100, top: 'calc(env(safe-area-inset-top, 0px) + 10px)', left: 'max(16px, calc((100vw - 760px) / 2 + 16px))', width: 48, height: 44, color: '#e5dab6', background: '#17261b', border: '1px solid #687b4a', borderRadius: 7, padding: '4px 2px', fontSize: 11 }}>
    {heroes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </select>
  <FamilyExpeditionTab onClose={() => { window.location.href = '/?devUser=999999'; }} />
</main>);
