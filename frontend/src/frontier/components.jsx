import React, { useEffect, useRef } from "react";
import WorldIcon from "./WorldIcon";
export const resourceNames = {
  wood: "Timber",
  ore: "Iron ore",
  planks: "Planks",
  supplies: "Expedition kits",
  weapons: "Weapons",
};
export const resourceIcons = {
  wood: "▰",
  ore: "◆",
  planks: "▤",
  supplies: "✚",
};
export const duration = (seconds) => {
  const n = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
export function Meter({ value, max, label }) {
  return (
    <div
      className="frontier-meter"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <span
        style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }}
      />
    </div>
  );
}
export function Resources({ stock, compact = false }) {
  return (
    <div className={`frontier-resources ${compact ? "compact" : ""}`}>
      {Object.entries(stock).map(([k, v]) => (
        <span key={k} title={resourceNames[k]}>
          <i className={`resource-${k}`}>
            <WorldIcon name={k} size={26} />
          </i>
          <b>{v.toLocaleString()}</b>
          {!compact && <small>{resourceNames[k]}</small>}
        </span>
      ))}
    </div>
  );
}
export function Dialog({ title, onClose, children, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const old = document.activeElement;
    ref.current?.focus();
    function keys(e) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const els = [
          ...ref.current.querySelectorAll(
            'button:not(:disabled),input:not(:disabled),select,textarea,[tabindex="0"]',
          ),
        ];
        const first = els[0],
          last = els.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    const el = ref.current;
    el.addEventListener("keydown", keys);
    return () => {
      el.removeEventListener("keydown", keys);
      old?.focus?.();
    };
  }, []);
  return (
    <div className="frontier-shade">
      <section
        className={`frontier-dialog ${className}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close panel">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
