import React from "react";
export default function KitItem({ kind }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      {kind === 0 ? (
        <>
          <path
            d="M15 19L35 12L52 30L31 53L10 36Z"
            fill="#e8ddbe"
            stroke="#536956"
            strokeWidth="3"
          />
          <ellipse
            cx="36"
            cy="24"
            rx="16"
            ry="11"
            transform="rotate(39 36 24)"
            fill="#f7edce"
            stroke="#536956"
            strokeWidth="3"
          />
          <ellipse
            cx="36"
            cy="24"
            rx="7"
            ry="5"
            transform="rotate(39 36 24)"
            fill="#a8b69a"
            stroke="#536956"
            strokeWidth="2"
          />
          <path d="M13 36L28 49M17 31L33 45" stroke="#bdc5a9" strokeWidth="3" />
        </>
      ) : kind === 1 ? (
        <>
          <path
            d="M8 37C6 10 42 5 55 24L56 43C41 56 19 58 8 45Z"
            fill="#d5a15b"
            stroke="#694d35"
            strokeWidth="3"
          />
          <path
            d="M9 36C24 43 44 38 55 28"
            fill="none"
            stroke="#f3d394"
            strokeWidth="5"
          />
          <path
            d="M20 20L26 28M32 16L38 24M43 20L48 27"
            stroke="#87603a"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      ) : kind === 2 ? (
        <>
          <path
            d="M24 10H40V24L49 34V52Q32 61 15 52V34L24 24Z"
            fill="#9bbcb4"
            stroke="#365b56"
            strokeWidth="3"
          />
          <path d="M18 38Q32 32 46 38V50Q32 57 18 50Z" fill="#608fa4" />
          <path
            d="M22 8H42V17H22Z"
            fill="#c3a46d"
            stroke="#635642"
            strokeWidth="3"
          />
          <path d="M29 34V47M23 40H36" stroke="#edf0d0" strokeWidth="4" />
          <path
            d="M21 28L20 33"
            stroke="#e9f3d7"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <path
            d="M9 39L19 17L41 12L55 35L37 55L15 51Z"
            fill="#9daaba"
            stroke="#435566"
            strokeWidth="3"
          />
          <path
            d="M19 17L30 32L41 12M30 32L55 35M30 32L37 55M30 32L9 39"
            fill="none"
            stroke="#64788a"
            strokeWidth="3"
          />
          <path
            d="M45 7L48 16M56 16L49 21M52 29L60 30"
            stroke="#f4d27d"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
