import { useEffect, useRef, useState } from "react";
import combat from "@peeper/frontier-combat";

export default function useBossBattle(load, hit) {
  const [data, setData] = useState(null),
    [frame, setFrame] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(null),
    [impact, setImpact] = useState(null);
  const active = useRef(true),
    predicted = useRef(null),
    server = useRef(null),
    queue = useRef([]),
    sending = useRef(false),
    revision = useRef(0),
    paused = useRef(false),
    clock = useRef({ server: Date.now() / 1000, local: performance.now() }),
    seenHurt = useRef(0),
    seenEvade = useRef(0);
  const visual = useRef({
    swingAt: -10000,
    swingKind: "strike",
    rollAt: -10000,
    rollDirection: 1,
    hurtAt: -10000,
  });
  const now = () =>
    clock.current.server + (performance.now() - clock.current.local) / 1000;
  function say(text, tone = "good", duration = 900) {
    if (active.current)
      setNotice({ text, tone, until: performance.now() + duration });
  }
  function show() {
    if (!predicted.current || !server.current) return;
    const t = now(),
      f = predicted.current,
      b = server.current.boss;
    combat.advance(f, b, t);
    if (f.last_hurt > seenHurt.current) {
      seenHurt.current = f.last_hurt;
      visual.current.hurtAt = performance.now();
      say("Hit · stunned for 10 seconds", "bad");
    }
    if (f.last_evade > seenEvade.current) {
      seenEvade.current = f.last_evade;
      if (f.counter_until < t) say("Dodged", "good", 500);
    }
    if (active.current)
      setFrame({ fighter: { ...f }, attack: combat.attack(f, b, t), time: t });
  }
  function accept(value, rtt = 0) {
    if (!active.current) return;
    if (value.fighter.combatVersion !== combat.VERSION) {
      setError("Battle update needs a reload. Reopen the game.");
      setData(value);
      return false;
    }
    clock.current = {
      server: value.serverTime + Math.min(rtt / 2000, 0.18),
      local: performance.now(),
    };
    server.current = value;
    predicted.current = { ...value.fighter };
    for (const item of queue.current) {
      const t = Math.max(predicted.current.input_at, item.options.at);
      combat.advance(predicted.current, value.boss, t);
      combat.input(
        predicted.current,
        value.boss,
        item.kind,
        t,
        item.options.direction,
      );
    }
    setData(value);
    show();
    return true;
  }
  async function drain() {
    if (sending.current || paused.current) return;
    sending.current = true;
    while (active.current && queue.current.length) {
      const item = queue.current[0],
        start = performance.now();
      try {
        const value = await hit(item.kind, item.key, item.options);
        queue.current.shift();
        if (!active.current) break;
        accept(value, performance.now() - start);
        setError("");
        if (value.damage && !value.duplicate) {
          setImpact({
            amount: value.damage,
            at: performance.now(),
            counter: value.counter,
            finisher: value.finisher,
          });
        }
        if (value.perfect && !value.duplicate)
          say("Perfect dodge · TAP TO COUNTER", "perfect", 1200);
      } catch (e) {
        if (!active.current) break;
        if (e.status >= 400 && e.status < 500) {
          queue.current.shift();
          try {
            accept(await load());
          } catch {}
          if (e.status !== 429) say(e.message, "bad", 1600);
        } else {
          paused.current = true;
          setError("Connection lost · retry to sync");
          break;
        }
      }
    }
    sending.current = false;
  }
  function act(kind, direction) {
    if (
      !predicted.current ||
      !server.current ||
      paused.current ||
      queue.current.length >= 4
    )
      return;
    const t = now(),
      f = predicted.current,
      b = server.current.boss;
    combat.advance(f, b, t);
    const result = combat.input(f, b, kind, t, direction);
    if (result.error) return;
    if (kind === "dodge") {
      if (result.moved) {
        visual.current.rollAt = performance.now();
        visual.current.rollDirection = direction === "left" ? -1 : 1;
      }
      if (result.perfect)
        say("Perfect dodge · TAP TO COUNTER", "perfect", 1200);
    } else {
      visual.current.swingAt = performance.now();
      visual.current.swingKind = result.counter
        ? "counter"
        : result.finisher
          ? "finisher"
          : "strike";
      if (result.counter) say("Counterstrike!", "good", 500);
      else if (result.finisher) say("Combo finish!", "good", 500);
    }
    queue.current.push({
      kind,
      key: crypto.randomUUID(),
      options: { direction, at: t },
    });
    revision.current++;
    show();
    drain();
  }
  useEffect(() => {
    active.current = true;
    let reading = false;
    async function poll() {
      if (reading || sending.current || queue.current.length || document.hidden)
        return;
      reading = true;
      const epoch = revision.current,
        start = performance.now();
      try {
        const value = await load();
        if (active.current && epoch === revision.current) {
          if (accept(value, performance.now() - start)) {
            paused.current = false;
            setError("");
          }
        }
      } catch (e) {
        if (active.current) setError(e.message);
      } finally {
        reading = false;
      }
    }
    poll();
    const poller = setInterval(poll, 500),
      ticker = setInterval(() => {
        if (!document.hidden) show();
      }, 40);
    return () => {
      active.current = false;
      clearInterval(poller);
      clearInterval(ticker);
    };
  }, [load, hit]);
  function retry() {
    paused.current = false;
    setError("");
    drain();
  }
  return {
    data,
    frame,
    error,
    notice: notice && notice.until > performance.now() ? notice : null,
    impact,
    visual,
    act,
    retry,
  };
}
