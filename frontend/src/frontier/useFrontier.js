import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";
export function useFrontier() {
  const [state, setState] = useState(null),
    [error, setError] = useState(null),
    [connected, setConnected] = useState(false),
    [players, setPlayers] = useState([]);
  const active = useRef(true),
    playable = useRef(true),
    loading = useRef(null),
    socket = useRef(null),
    location = useRef("village");
  const refresh = useCallback(() => {
    if (loading.current) return loading.current;
    loading.current = api
      .frontierState()
      .then((data) => {
        if (active.current) {
          playable.current =
            data.event?.active !== false && data.event?.phase !== "results";
          if (!playable.current) socket.current?.close();
          setState(data);
          setError(null);
        }
        return data;
      })
      .catch((e) => {
        if (active.current) setError(e.message || "Connection lost. Retrying…");
        return null;
      })
      .finally(() => {
        loading.current = null;
      });
    return loading.current;
  }, []);
  useEffect(() => {
    active.current = true;
    let closed = false,
      connecting = false,
      retry,
      delay = 1000,
      lastRefresh = 0;
    refresh();
    async function connect() {
      if (
        closed ||
        !playable.current ||
        document.hidden ||
        connecting ||
        socket.current?.readyState < 2
      )
        return;
      clearTimeout(retry);
      connecting = true;
      try {
        const { ticket } = await api.frontierTicket();
        if (closed || document.hidden) return;
        const ws = new WebSocket(
          `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/frontier/live`,
        );
        socket.current = ws;
        ws.onopen = () => ws.send(JSON.stringify({ type: "auth", ticket }));
        ws.onmessage = (event) => {
          if (closed || socket.current !== ws) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "ready" || msg.type === "changed") {
              delay = 1000;
              setConnected(true);
              setPlayers(msg.players || []);
              if (msg.type === "ready")
                ws.send(
                  JSON.stringify({
                    type: "presence",
                    location: location.current,
                  }),
                );
              if (Date.now() - lastRefresh > 1500) {
                lastRefresh = Date.now();
                refresh();
              }
            }
          } catch {}
        };
        ws.onclose = () => {
          if (closed || socket.current !== ws) return;
          setConnected(false);
          if (!document.hidden && playable.current)
            retry = setTimeout(connect, delay);
          delay = Math.min(15000, delay * 2);
        };
        ws.onerror = () => ws.close();
      } catch {
        if (!closed && playable.current) {
          setConnected(false);
          retry = setTimeout(connect, delay);
          delay = Math.min(15000, delay * 2);
        }
      } finally {
        connecting = false;
      }
    }
    function visibility() {
      clearTimeout(retry);
      if (document.hidden) {
        socket.current?.close();
      } else {
        refresh();
        if (!socket.current || socket.current.readyState >= 2) connect();
      }
    }
    document.addEventListener("visibilitychange", visibility);
    connect();
    const fallback = setInterval(() => {
      if (!document.hidden) refresh();
    }, 7000);
    return () => {
      closed = true;
      active.current = false;
      clearTimeout(retry);
      clearInterval(fallback);
      document.removeEventListener("visibilitychange", visibility);
      socket.current?.close();
      socket.current = null;
    };
  }, [refresh]);
  const visit = useCallback((id) => {
    location.current = id;
    if (socket.current?.readyState === 1)
      socket.current.send(JSON.stringify({ type: "presence", location: id }));
  }, []);
  return { state, error, connected, players, refresh, visit };
}
