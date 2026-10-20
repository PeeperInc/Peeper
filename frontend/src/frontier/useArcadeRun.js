import { useEffect, useRef, useState } from "react";
import core from "@peeper/frontier-core";
import { acceptArcadeInput } from "./arcadeInput.mjs";
export default function useArcadeRun(
  { challenge, disabled, onComplete },
  auto = false,
) {
  const run = useRef(null),
    send = useRef(onComplete),
    blocked = useRef(disabled);
  send.current = onComplete;
  blocked.current = disabled;
  const [view, setView] = useState(() => core.create(challenge)),
    [started, setStarted] = useState(auto),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let frame,
      pending,
      gone = false,
      last = 0;
    const r = {
      s: core.create(challenge),
      events: [],
      start: auto ? performance.now() : Infinity,
      sent: false,
    };
    run.current = r;
    setView({ ...r.s });
    setStarted(auto);
    setFailed(false);
    function tick(now) {
      if (gone) return;
      core.advance(r.s, Math.max(0, now - r.start));
      if (now - last > 40 || r.s.done) {
        setView({ ...r.s });
        last = now;
      }
      if (r.s.done && !r.sent) {
        r.sent = true;
        if (!r.events.length) r.events.push([Math.round(r.s.t), 7, 0, 0]);
        pending = setTimeout(
          async () => {
            try {
              if (!(await send.current({ events: r.events })) && !gone)
                setFailed(true);
            } catch {
              if (!gone) setFailed(true);
            }
          },
          Math.max(550, 2300 - (now - r.start)) +
            (r.s.matchAnimation?.frames.reduce((n, f) => n + f.ms, 0) || 0),
        );
      }
      if (!r.s.done && Number.isFinite(r.start))
        frame = requestAnimationFrame(tick);
    }
    r.wake = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    r.wake();
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      clearTimeout(pending);
    };
  }, [challenge.nonce, retry]);
  function action(type, x = 0, y = 0) {
    const r = run.current;
    if (
      !r ||
      r.sent ||
      r.s.done ||
      blocked.current ||
      performance.now() < r.start
    )
      return;
    const e = [
      Math.min(
        challenge.arcade.duration,
        Math.max(Math.ceil(r.s.t), Math.round(performance.now() - r.start)),
      ),
      type,
      x,
      y,
    ];
    if (!acceptArcadeInput(r.events, e, challenge.arcade.duration)) return;
    r.events.push(e);
    core.act(r.s, e);
    setView({ ...r.s });
  }
  function start() {
    if (!run.current) return;
    run.current.start = performance.now();
    run.current.wake();
    setStarted(true);
  }
  return {
    view,
    run,
    action,
    start,
    started,
    failed,
    retry: () => setRetry((v) => v + 1),
    locked: disabled || view.done || !started,
    grade: core.grade(view),
  };
}
