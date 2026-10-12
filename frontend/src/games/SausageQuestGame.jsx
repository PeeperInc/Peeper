import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import * as api from '../api';
import './SausageQuestGame.css';

const CHANNEL = 'peeper-sausage-quest';

export default function SausageQuestGame({ onClose }) {
  const { sausageQuest, applySausageQuestResult, completeSausageQuestLevel,
    pendingSausageQuestRewards: pendingCount, lastSausageQuestReward, refreshGameState } = useApp();
  const frameRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const send = useCallback((data) => {
    frameRef.current?.contentWindow?.postMessage({ channel: CHANNEL, ...data }, location.origin);
  }, []);

  useEffect(() => {
    if (lastSausageQuestReward) send({ type: 'reward', ...lastSausageQuestReward });
  }, [lastSausageQuestReward, send]);

  useEffect(() => {
    if (!sausageQuest?.resetsAt) return undefined;
    const delay = Math.max(1000, sausageQuest.resetsAt * 1000 - Date.now() + 500);
    const timer = setTimeout(refreshGameState, delay);
    return () => clearTimeout(timer);
  }, [refreshGameState, sausageQuest?.resetsAt]);

  useEffect(() => {
    let mounted = true;
    const handleMessage = async event => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== location.origin
        || event.data?.channel !== CHANNEL) return;
      const { type, id, payload } = event.data;
      if (type === 'ready') { setLoaded(true); return; }
      if (type === 'load-error') { setLoadError(true); return; }
      if (typeof id !== 'string' || id.length > 80) return;
      if (type === 'start') {
        try {
          const result = await api.startSausageQuestLevel(payload);
          applySausageQuestResult(result);
          if (mounted) send({ id, result });
        } catch (error) {
          if (mounted) send({ id, error: error.message || 'Connection interrupted' });
        }
      } else if (type === 'finish' && typeof payload?.token === 'string') {
        try {
          const result = await completeSausageQuestLevel(payload);
          if (mounted) send({ id, result });
        } catch (error) {
          if (mounted) send({ id, error: error.message || 'Connection interrupted', retryable: ![400, 404, 409, 410].includes(error.status) });
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => { mounted = false; window.removeEventListener('message', handleMessage); };
  }, [applySausageQuestResult, completeSausageQuestLevel, send]);

  useEffect(() => {
    const back = window.Telegram?.WebApp?.BackButton;
    back?.show();
    back?.onClick(onClose);
    return () => { back?.offClick(onClose); back?.hide(); };
  }, [onClose]);

  useEffect(() => {
    if (loaded) frameRef.current?.contentWindow?.focus();
  }, [loaded]);

  const complete = sausageQuest?.remainingToday === 0;
  return (
    <div className="sausage-quest-shell" role="dialog" aria-label="Sausage Quest" aria-modal="true">
      <header className="sausage-quest-header">
        <button className="sausage-quest-back" onClick={onClose} aria-label="Back to Peeper">←</button>
        <div className="sausage-quest-heading"><strong>🌭 Sausage Quest</strong><small>No energy needed</small></div>
        <div className="sausage-quest-progress" aria-live="polite">
          <strong>{sausageQuest?.completedToday ?? 0}/5 · {sausageQuest?.earnedToday ?? 0} ✦</strong>
          <small>{pendingCount ? 'Saving reward…' : complete ? 'Daily rewards complete' : '5 ✦ / level · all sausages = 10 ✦'}</small>
        </div>
      </header>
      <div className="sausage-quest-stage">
        <iframe ref={frameRef} src="/src/sausage-quest/index.html" title="Sausage Quest game"
          sandbox="allow-scripts allow-same-origin" allow="autoplay" />
        {!loaded && (
          <div className="sausage-quest-loading">
            <span>🌭</span><strong>{loadError ? 'Could not load the game' : 'Heating up the BBQ…'}</strong>
            <p>{loadError ? 'Close and reopen Sausage Quest to try again.' : 'Loading Sausage Quest'}</p>
            <button onClick={onClose}>Back to Peeper</button>
          </div>
        )}
      </div>
    </div>
  );
}
