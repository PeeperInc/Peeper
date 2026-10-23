import React from 'react';
import { createRoot } from 'react-dom/client';
import FamilyExpeditionTab from '../src/screens/FamilyExpeditionTab';
import '../src/theme.css';

document.documentElement.dataset.theme = 'dark';
const heroes = [['999999', 'Knight'], ['999998', 'Scout'], ['999997', 'Mage'], ['999996', 'Cleric']];
createRoot(document.getElementById('root')).render(<main style={{ maxWidth: 760, margin: '0 auto', padding: '8px 8px 24px' }}>
  <style>{'.expedition-game-title { visibility: hidden; }'}</style>
  <select aria-label="Local test hero" value={new URLSearchParams(location.search).get('devUser') || '999999'}
    onChange={event => { window.location.href = `?devUser=${event.target.value}`; }}
    style={{ position: 'fixed', zIndex: 100, top: 'calc(env(safe-area-inset-top, 0px) + 10px)', left: '50%', transform: 'translateX(-50%)', height: 34, color: '#e5dab6', background: '#17261b', border: '1px solid #687b4a', borderRadius: 4, padding: '4px 12px', fontSize: 12 }}>
    {heroes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </select>
  <FamilyExpeditionTab onClose={() => { window.location.href = '/?devUser=999999'; }} />
</main>);
