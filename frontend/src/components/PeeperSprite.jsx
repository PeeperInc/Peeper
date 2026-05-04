import React, { useEffect, useState } from 'react';
import { assetUrl } from '../utils/assetUrl';

/**
 * PeeperSprite — layered frog character renderer.
 *
 * ═══════════════════════════════════════════════════════════════════
 * SPRITE SYSTEM — 300×300 canvas convention
 * ═══════════════════════════════════════════════════════════════════
 *
 * ALL sprites (base frog + every accessory) are 300×300 pixels.
 * The frog character itself occupies roughly the center ~150×150 area
 * of that canvas. The remaining space is intentional padding used by
 * accessories to position themselves in the right spot without any
 * extra offset math — just stack layers at position: absolute, inset 0.
 *
 * Zone map (pixel coords within 300×300):
 *   HEAD zone  — items drawn above frog:  x: 75-225, y: 10-95
 *   FACE zone  — at eye level:            x: 90-210, y: 105-155
 *   BODY zone  — torso area:              x: 85-215, y: 170-245
 *   HANDS zone — sides of body:
 *                  left hand:  x: 15-90,  y: 175-235
 *                  right hand: x: 210-285,y: 175-235
 *
 * ── Production: replace BaseFrog + SlotOverlay with <img> tags ────
 *
 *   // Base frog:
 *   <img src="/sprites/base_happy.png" style={LAYER_STYLE} />
 *
 *   // Accessory (e.g. crown):
 *   <img src="/sprites/head_crown.png" style={LAYER_STYLE} />
 *
 *   Each PNG is 300×300 with transparency.
 *   The item is drawn wherever it should appear within that canvas.
 *   No extra positioning needed — just stacking.
 *
 * ── Development: SVG frog + emoji placeholders (below) ────────────
 */

// CANVAS_SIZE is the logical pixel size of every sprite sheet
const CANVAS_SIZE = 500;

// Reusable style for every absolutely-stacked layer
const LAYER_STYLE = {
  position: 'absolute',
  top: 0, left: 0,
  width: '100%', height: '100%',
  pointerEvents: 'none',
};

// ── Emoji placeholder overlays ──────────────────────────────────────────────
// Positions are in px relative to the 500×500 canvas.
// Character occupies roughly x:125-375, y:130-450 within that canvas.
//
// To switch to real PNGs: delete this map, uncomment the <img> line in SlotLayer.
//
const EMOJI_OVERLAYS = {
  // HEAD (above head, y: ~80-140)
  head_beanie:      { emoji: '🧢',  cx: 250, cy: 112, size: 90 },
  head_crown:       { emoji: '👑',  cx: 250, cy:  96, size: 94 },
  head_witch:       { emoji: '🎩',  cx: 250, cy:  88, size: 100 },
  head_bow:         { emoji: '🎀',  cx: 320, cy: 136, size: 66 },
  head_chef:        { emoji: '👨‍🍳', cx: 250, cy:  90, size: 96 },

  // FACE (eye/nose level, y: ~200-240)
  face_glasses:     { emoji: '👓',  cx: 250, cy: 214, size: 84 },
  face_sunglasses:  { emoji: '🕶️', cx: 250, cy: 214, size: 84 },
  face_mask:        { emoji: '😷',  cx: 250, cy: 234, size: 76 },
  face_monocle:     { emoji: '🧐',  cx: 280, cy: 206, size: 66 },

  // BODY (torso, y: ~340-390)
  body_jacket:      { emoji: '🧥',  cx: 250, cy: 360, size: 110 },
  body_tuxedo:      { emoji: '🤵',  cx: 250, cy: 360, size: 114 },
  body_raincoat:    { emoji: '🌧️', cx: 250, cy: 360, size: 106 },
  body_sweater:     { emoji: '🧶',  cx: 250, cy: 360, size: 106 },

  // HANDS (sides, y: ~330-360)
  hands_umbrella:   { emoji: '☂️', cx: 414, cy: 334, size: 76 },
  hands_book:       { emoji: '📚',  cx: 414, cy: 350, size: 70 },
  hands_flowers:    { emoji: '💐',  cx:  86, cy: 334, size: 76 },
  hands_coffee:     { emoji: '☕',  cx:  86, cy: 350, size: 66 },
};

// ── Base frog SVG ───────────────────────────────────────────────────────────
// Drawn within a 300×300 viewBox.
// The frog character occupies roughly x:75-225, y:80-270 (~150×190px)
// leaving room above for HEAD accessories and on sides for HANDS.
// ── Base frog ───────────────────────────────────────────────────────────────
// Tries to load /sprites/base.png
// Falls back to the built-in SVG if the PNG doesn't exist yet.
function BaseFrog() {
  const [useFallback, setUseFallback] = useState(false);

  if (!useFallback) {
    return (
      <img
        src={assetUrl('/sprites/base.png')}
        alt="Peeper"
        onError={() => setUseFallback(true)}
        style={{ ...LAYER_STYLE, objectFit: 'contain' }}
      />
    );
  }

  return <BaseFrogSVG />;
}

function BaseFrogSVG() {
  const mouthPath = 'M 220 278 Q 250 304 280 278';

  function Eyes() {
    return (
      <>
        <circle cx={213} cy={230} r="20" fill="#2C2C2C"/>
        <circle cx={219} cy={224} r="7"  fill="white"/>
        <circle cx={287} cy={230} r="20" fill="#2C2C2C"/>
        <circle cx={293} cy={224} r="7"  fill="white"/>
      </>
    );
  }

  return (
    <svg
      width="100%" height="100%"
      viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={LAYER_STYLE}
    >
      {/* Shadow */}
      <ellipse cx="250" cy="454" rx="96" ry="16" fill="rgba(0,0,0,0.07)"/>

      {/* Back feet */}
      <ellipse cx="166" cy="420" rx="46" ry="34" fill="#5BAD58" transform="rotate(-15 166 420)"/>
      <ellipse cx="334" cy="420" rx="46" ry="34" fill="#5BAD58" transform="rotate(15 334 420)"/>

      {/* Toe dots — left foot */}
      <circle cx="126" cy="432" r="8" fill="#4E9E4E"/>
      <circle cx="146" cy="444" r="8" fill="#4E9E4E"/>
      <circle cx="168" cy="446" r="8" fill="#4E9E4E"/>
      <circle cx="188" cy="438" r="8" fill="#4E9E4E"/>
      {/* Toe dots — right foot */}
      <circle cx="312" cy="438" r="8" fill="#4E9E4E"/>
      <circle cx="332" cy="446" r="8" fill="#4E9E4E"/>
      <circle cx="354" cy="444" r="8" fill="#4E9E4E"/>
      <circle cx="374" cy="432" r="8" fill="#4E9E4E"/>

      {/* Body */}
      <ellipse cx="250" cy="370" rx="104" ry="86" fill="#6DBF6A"/>
      {/* Belly */}
      <ellipse cx="250" cy="382" rx="66" ry="56" fill="#C5E8C0"/>

      {/* Front arms */}
      <ellipse cx="148" cy="362" rx="34" ry="20" fill="#6DBF6A" transform="rotate(-25 148 362)"/>
      <ellipse cx="352" cy="362" rx="34" ry="20" fill="#6DBF6A" transform="rotate(25 352 362)"/>
      {/* Fingers left */}
      <circle cx="112" cy="368" r="10" fill="#5BAD58"/>
      <circle cx="100" cy="352" r="9"  fill="#5BAD58"/>
      <circle cx="106" cy="382" r="9"  fill="#5BAD58"/>
      {/* Fingers right */}
      <circle cx="388" cy="368" r="10" fill="#5BAD58"/>
      <circle cx="400" cy="352" r="9"  fill="#5BAD58"/>
      <circle cx="394" cy="382" r="9"  fill="#5BAD58"/>

      {/* Head */}
      <circle cx="250" cy="246" r="104" fill="#6DBF6A"/>
      {/* Head highlight */}
      <ellipse cx="224" cy="198" rx="36" ry="24" fill="#7DD17A" opacity="0.45"/>

      {/* Eye bumps */}
      <circle cx="213" cy="222" r="28" fill="#5BAD58"/>
      <circle cx="287" cy="222" r="28" fill="#5BAD58"/>

      {/* Eyes */}
      <Eyes />

      {/* Nostrils */}
      <circle cx="240" cy="262" r="5" fill="#5BAD58"/>
      <circle cx="260" cy="262" r="5" fill="#5BAD58"/>

      {/* Mouth */}
      <path d={mouthPath} stroke="#2C2C2C" strokeWidth="5" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

// ── Slot layer ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════
// HOW TO ADD REAL PNG SPRITES (500×500)
// ═══════════════════════════════════════════════════════════════════
// 1. Create a 500×500 PNG with transparent background
// 2. Draw the item in the position it should appear on the frog
//    (use the zone map in the comments at the top of this file)
// 3. Name the file exactly as the item ID: e.g. head_crown.png
// 4. Upload via Admin panel → /sprites/head_crown.png
// 5. Uncomment the <img> line below and comment out the emoji block
//
// The PNG will be stacked as an absolutely-positioned layer over the
// frog SVG — no additional CSS positioning needed.
// ═══════════════════════════════════════════════════════════════════
function SlotLayer({ itemId }) {
  if (!itemId || itemId === 'none') return null;

  // ── PRODUCTION: PNG sprite (500×500, transparent background) ────────
  // File must exist at /sprites/${itemId}.png on the server.
  // Draw the item at the correct position within the 500×500 canvas —
  // no extra CSS positioning needed, layers just stack on top of each other.
  return <img src={assetUrl(`/sprites/${itemId}.png`)} style={LAYER_STYLE} alt="" />;

  // ── DEV emoji placeholder (keep for reference, not used) ─────────────
  // const cfg = EMOJI_OVERLAYS[itemId];
  // if (!cfg) return null;
  // const leftPct = (cfg.cx / CANVAS_SIZE * 100).toFixed(2);
  // const topPct  = (cfg.cy / CANVAS_SIZE * 100).toFixed(2);
  // const sizePct = (cfg.size / CANVAS_SIZE * 100).toFixed(2);
  // return (
  //   <div style={LAYER_STYLE}>
  //     <span style={{ position: 'absolute', left: `${leftPct}%`, top: `${topPct}%`,
  //       fontSize: `${sizePct}cqw`, transform: 'translate(-50%, -50%)',
  //       lineHeight: 1, display: 'block', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.18))' }}>
  //       {cfg.emoji}
  //     </span>
  //   </div>
  // );
}

function ArenaArmorLayer({ armorElement }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
  }, [armorElement]);

  if (!armorElement || hidden) return null;

  return (
    <img
      src={assetUrl(`/sprites/arena_armor_${armorElement}.png`)}
      style={LAYER_STYLE}
      alt=""
      onError={() => setHidden(true)}
    />
  );
}

// ── Dead overlay ────────────────────────────────────────────────────────────
function DeadOverlay() {
  const [useFallback, setUseFallback] = useState(false);
  if (!useFallback) {
    return (
      <img
        src={assetUrl('/sprites/dead.png')}
        alt="Dead"
        onError={() => setUseFallback(true)}
        style={{ ...LAYER_STYLE, objectFit: 'contain' }}
      />
    );
  }
  // Fallback if dead.png not uploaded yet
  return (
    <div style={{
      ...LAYER_STYLE,
      background: 'rgba(0,0,0,0.38)', borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{ fontSize: '22%' }}>💀</span>
    </div>
  );
}

// ── Exported component ──────────────────────────────────────────────────────
/**
 * @param {object}  peeper    - peeper DB row with slot_* and stat fields
 * @param {number}  size      - rendered CSS size in px (default 300)
 * @param {boolean} showDead  - overlay skull when HP=0
 * @param {string}  armorElement - optional Arena armor overlay
 */
export default function PeeperSprite({ peeper, size = 300, showDead = true, armorElement = null }) {
  if (!peeper) return null;

  const { slot_head, slot_body, slot_hands, slot_fren, slot_face, alive } = peeper;

  return (
    <div
      className="peeper-stage"
      style={{
        width:              size,
        height:             size,
        position:          'relative',
        userSelect:        'none',
        // Enable container queries so cqw font-size works for emoji scaling
        containerType:     'size',
      }}
    >
      {/* When alive — show base frog + clothing */}
      {alive !== false ? (
        <>
          <BaseFrog />
          <SlotLayer itemId={slot_body}  />
          <SlotLayer itemId={slot_face}  />
          <SlotLayer itemId={slot_head}  />
          <ArenaArmorLayer armorElement={armorElement} />
          <SlotLayer itemId={slot_hands} />
          <SlotLayer itemId={slot_fren}  />
        </>
      ) : showDead ? (
        /* When dead — only dead.png, nothing else */
        <DeadOverlay />
      ) : (
        /* showDead=false (try-on preview) — show base frog normally */
        <>
          <BaseFrog />
          <SlotLayer itemId={slot_body}  />
          <SlotLayer itemId={slot_face}  />
          <SlotLayer itemId={slot_head}  />
          <ArenaArmorLayer armorElement={armorElement} />
          <SlotLayer itemId={slot_hands} />
          <SlotLayer itemId={slot_fren}  />
        </>
      )}
    </div>
  );
}
