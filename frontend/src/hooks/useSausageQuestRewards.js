import { useCallback, useEffect, useRef, useState } from 'react';
import { finishSausageQuestLevel } from '../api';

// The host owns this outbox, so a reward still retries after leaving the
// iframe, reloading Peeper, or restoring connectivity. Tickets pay once.
export function useSausageQuestRewards(userId, applyResult) {
  const key = userId ? `peeper.sausage-quest.pending.${userId}` : null;
  const queueRef = useRef([]);
  const inFlightRef = useRef(new Map());
  const activeKeyRef = useRef(key);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastReward, setLastReward] = useState(null);

  const persist = useCallback(() => {
    if (!key || activeKeyRef.current !== key) return;
    setPendingCount(queueRef.current.length);
    try { localStorage.setItem(key, JSON.stringify(queueRef.current)); } catch { /* Retry from memory if storage is unavailable. */ }
  }, [key]);

  const submit = useCallback((payload) => {
    const existing = inFlightRef.current.get(payload.token);
    if (existing) return existing;
    const promise = finishSausageQuestLevel(payload).then(result => {
      if (activeKeyRef.current === key) {
        queueRef.current = queueRef.current.filter(item => item.token !== payload.token);
        persist();
        applyResult(result);
        setLastReward({ token: payload.token, result });
      }
      return result;
    }).catch(error => {
      if (activeKeyRef.current === key && [400, 404, 409, 410].includes(error.status)) {
        queueRef.current = queueRef.current.filter(item => item.token !== payload.token);
        persist();
      }
      throw error;
    }).finally(() => inFlightRef.current.delete(payload.token));
    inFlightRef.current.set(payload.token, promise);
    return promise;
  }, [applyResult, key, persist]);

  const complete = useCallback((payload) => {
    if (!queueRef.current.some(item => item.token === payload.token)) {
      queueRef.current.push(payload);
      persist();
    }
    return submit(payload);
  }, [persist, submit]);

  useEffect(() => {
    activeKeyRef.current = key;
    if (!key) { queueRef.current = []; setPendingCount(0); return undefined; }
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      queueRef.current = Array.isArray(saved) ? saved.filter(item => typeof item?.token === 'string').slice(-20) : [];
    } catch { queueRef.current = []; }
    persist();
    let retrying = false;
    let cancelled = false;
    const retry = async () => {
      if (retrying) return;
      retrying = true;
      try {
        for (const payload of [...queueRef.current]) {
          if (cancelled) break;
          try { await submit(payload); }
          catch (error) {
            if (![400, 404, 409, 410].includes(error.status)) break;
          }
        }
      } finally { retrying = false; }
    };
    retry();
    const interval = setInterval(retry, 5000);
    window.addEventListener('online', retry);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('online', retry);
    };
  }, [key, persist, submit]);

  return { complete, pendingCount, lastReward };
}
