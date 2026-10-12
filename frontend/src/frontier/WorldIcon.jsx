import React from "react";

export default function WorldIcon({ name, size = 32, className = "" }) {
  const common = {
    stroke: "#344333",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  let art;
  if (name === "wood")
    art = (
      <>
        <path fill="#9c7348" d="m8 17 25-9 8 21-25 11Z" />
        <ellipse
          cx="14"
          cy="29"
          rx="9"
          ry="12"
          fill="#d3ad72"
          transform="rotate(-20 14 29)"
        />
        <ellipse
          cx="14"
          cy="29"
          rx="4"
          ry="7"
          fill="none"
          transform="rotate(-20 14 29)"
        />
        <path d="m21 17 14-4m-12 11 14-5m-10 12 12-5" />
      </>
    );
  else if (name === "ore")
    art = (
      <>
        <path fill="#8e9d97" d="m5 31 7-19 14-7 14 11 4 19-17 8Z" />
        <path fill="#bbc6b0" d="m12 12 14-7 2 17-15 7Z" />
        <path fill="#677f78" d="m28 22 12-6 4 19-17 8Z" />
        <path d="m13 29 14 14m-1-38 2 17" />
        <path stroke="#d9b56b" strokeWidth="4" d="m13 18 6 4m10 9 6-4" />
      </>
    );
  else if (name === "planks")
    art = (
      <>
        <path fill="#b68b51" d="m5 16 30-8 8 10-31 9Zm0 12 31-8 7 10-31 9Z" />
        <path fill="#e2bc7f" d="m5 16 31-8 5 5-31 9Z" />
        <path d="m16 17 17-4m-16 20 16-5" />
      </>
    );
  else if (name === "supplies")
    art = (
      <>
        <path fill="#a5b17a" d="M12 12h24l6 24-7 7H12l-6-8Z" />
        <path fill="#d9c591" d="M9 11h29v11l-13 5-17-5Z" />
        <path fill="#647d55" d="M19 8h10v28H19Z" />
        <path stroke="#e8dba4" strokeWidth="3" d="M21 30h7m-4-4v9" />
      </>
    );
  else if (name === "weapons")
    art = (
      <>
        <path fill="#b9c6ba" d="M34 4l9 1-1 9-20 20-8-8Z" />
        <path stroke="#edf1cc" d="m22 22 14-13" />
        <path stroke="#a17843" strokeWidth="7" d="m8 40 10-10" />
        <path stroke="#d6b66e" strokeWidth="6" d="m10 23 15 15" />
      </>
    );
  else if (name === "cart")
    art = (
      <>
        <path fill="#b28851" d="m5 13 31-3 5 21-31 3Z" />
        <path d="m13 17 2 12m9-13 2 13m10-4 7-6" />
        <circle fill="#606f4b" cx="13" cy="37" r="7" />
        <circle fill="#606f4b" cx="34" cy="35" r="7" />
        <path stroke="#c9b483" d="m9 37 8 0m-4-4v8m17-6h8m-4-4v8" />
      </>
    );
  else if (name === "shield")
    art = (
      <>
        <path fill="#647fa9" d="m8 9 15-5 17 6-2 21-14 13L10 31Z" />
        <path fill="#d2b87b" d="m15 13 9-3 10 4-2 14-8 9-8-9Z" />
        <path d="m24 14 0 17m-6-9h12" />
      </>
    );
  else if (name === "tools")
    art = (
      <>
        <path stroke="#b58c55" strokeWidth="8" d="m11 39 22-29" />
        <path fill="#9cae9e" d="m19 9 12-5 12 10-7 8-10-9-5 5Z" />
        <path stroke="#798b76" strokeWidth="6" d="m10 9 28 29" />
        <path fill="#b1baa3" d="m7 5 8 3 2 9-7 1-6-7Z" />
      </>
    );
  else if (name === "boss")
    art = (
      <>
        <path fill="#689544" d="M7 19Q8 7 20 12Q34 5 41 19l-2 20-30 2Z" />
        <path fill="#cfad62" d="m11 15-3-11 11 7 7-9 6 9 9-5-3 13Z" />
        <ellipse fill="#f2e7c7" cx="17" cy="24" rx="7" ry="5" />
        <ellipse fill="#f2e7c7" cx="31" cy="23" rx="7" ry="5" />
        <path d="m18 22 0 3m13-4v3m-18 9 21-1" />
      </>
    );
  else if (name === "chat")
    art = (
      <>
        <path fill="#e5cd96" d="M5 9q18-8 37 0v25l-15 1-12 9 1-9-11-3Z" />
        <path d="M13 16h20M13 23h16" />
        <circle cx="35" cy="35" r="8" fill="#80a966" />
        <path stroke="#e9e3b6" d="m32 35 2 2 4-5" />
      </>
    );
  else if (name === "orders")
    art = (
      <>
        <path fill="#987b4d" d="m9 5 30 1 2 38H7Z" />
        <path fill="#e6d6a4" d="m12 10 24 1 1 28H11Z" />
        <path fill="#7e9e6b" d="M17 4h13v8H17Z" />
        <path d="m16 20 3 2 4-5m3 4h6m-16 9 3 2 4-5m3 4h6" />
      </>
    );
  else if (name === "camp" || name === "party")
    art = (
      <>
        <path fill="#859767" d="m4 39 18-31 4-1 18 32Z" />
        <path fill="#c1b076" d="m22 8 4-1 18 32H28Z" />
        <path fill="#3b5542" d="m14 39 9-20 6 20Z" />
        <path d="M23 4v9m-18 28-2 3m41-3 2 3" />
      </>
    );
  else if (name === "sun")
    art = (
      <>
        <circle fill="#e3be70" cx="24" cy="24" r="11" />
        <path
          stroke="#e3be70"
          strokeWidth="3"
          d="M24 3v5m0 32v5M3 24h5m32 0h5M9 9l4 4m22 22 4 4M9 39l4-4m22-22 4-4"
        />
      </>
    );
  else if (name === "rain")
    art = (
      <>
        <path fill="#adc1ad" d="M10 27q-9-14 5-14 8-17 19-3 15 0 9 17Z" />
        <path
          stroke="#91b6ca"
          strokeWidth="3"
          d="m13 33-3 8m14-8-3 8m14-8-3 8"
        />
      </>
    );
  else if (name === "wind")
    art = (
      <path
        stroke="#d3d8ba"
        strokeWidth="3"
        fill="none"
        d="M4 15h29q10 0 8-7-4-6-9-1M4 24h21q11 0 8 8M6 34h10"
      />
    );
  else if (name === "leaf")
    art = (
      <>
        <path fill="#99b976" d="M8 36Q6 6 39 6q2 31-28 32Z" />
        <path d="m7 43 25-29M14 33l1-14m6 5 11 0" />
      </>
    );
  else
    art = (
      <>
        <path fill="#d7bd82" d="m7 11 15-6 19 7-3 29-15-5-17 6Z" />
        <path d="m22 5 1 31m-10-12 5-5 9 6 6-8" />
      </>
    );
  return (
    <svg
      className={`world-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <g {...common}>{art}</g>
    </svg>
  );
}
