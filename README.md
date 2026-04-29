# 🐸 Peeper — Telegram Mini App

> A cozy Tamagotchi-style game with funny drawn frogs, built for Telegram.

---

## Architecture

```
peeper/
├── backend/            # Node.js + Express + SQLite
│   ├── server.js       # Entry point (port 4000)
│   ├── database.js     # SQLite schema setup (better-sqlite3)
│   ├── auth.js         # Telegram initData HMAC validation
│   ├── gameLogic.js    # Stats calculation (hunger/fun/HP drain)
│   ├── items.js        # All items catalog (clothing + gifts)
│   └── routes/
│       ├── auth.js     # POST /api/auth/login
│       ├── game.js     # GET state, POST feed/play/revive/outfit + cleanup
│       ├── shop.js     # GET items, POST buy
│       ├── gifts.js    # GET search, POST send, GET received
│       └── users.js    # GET search, GET profile, GET leaderboards
│
├── frontend/           # React + Vite + @telegram-apps/telegram-ui
│   ├── index.html      # Telegram SDK script tag lives here
│   └── src/
│       ├── main.jsx
│       ├── App.jsx         # Shell, tab nav, theme handler
│       ├── api.js          # All backend calls (with initData auth)
│       ├── itemsData.js    # Frontend copy of items catalog
│       ├── theme.css       # Scandinavian design tokens + components
│       ├── context/
│       │   └── AppContext.jsx  # Global state + actions
│       ├── components/
│       │   ├── PeeperSprite.jsx  # Layered SVG frog character
│       │   ├── StatusBars.jsx    # HP / Hunger / Fun bars
│       │   └── GiftGallery.jsx   # Scattered gift grid (Telegram-style)
│       └── screens/
│           ├── HomeScreen.jsx        # Main game: Peeper + Feed/Play
│           ├── WardrobeScreen.jsx    # Outfit customization
│           ├── ShopScreen.jsx        # Buy clothing items
│           ├── GiftScreen.jsx        # Send gifts to other players
│           ├── LeaderboardScreen.jsx # Longevity + Gifts boards
│           └── ProfileScreen.jsx     # Own profile + search others
│
├── nginx.conf          # Nginx site config snippet
├── ecosystem.config.js # PM2 config
├── deploy.sh           # One-command deploy script
├── docs/               # Planning docs / mockups for upcoming features
└── README.md
```

---

## Game Mechanics

| Mechanic | Value |
|----------|-------|
| Hunger drain (full → 0) | 8 hours |
| Fun drain (full → 0) | 100 minutes |
| Feed availability | When hunger is 70% or below |
| Mini-game availability | When energy is above 0 |
| Energy formula | `floor((100 - fun) / 20)`, max 5 |
| HP drain starts | When hunger = 0 |
| Death from starvation | 36 hours after hunger reaches 0 |
| HP full regen after feeding | 12 hours |

**Death**: HP hits 0 → Peeper dies. Revive is free in prototype.

---

## Current Notes

- The mini-game picker now scrolls correctly on small iOS / Android screens and respects Telegram safe areas.
- The bottom tab bar is hidden while full-screen game overlays and action sheets are open, so it no longer covers gameplay on iOS.
- Bubble Pop now counts quick taps normally, but rejects drag/swipe gestures across the grid, so players still cannot sweep multiple bubbles with one finger movement.
- `/api/game/play` now applies a per-game reward cap on the server, and Bubble Pop still cannot award more than 10 coins total.
- The frontend no longer decides Peeper death on its own. Backend responses now include server-aligned live state, while the UI only renders a smooth preview between syncs.
- Reaching `0%` hunger now starts a server-backed dirty cycle once per starvation window: the Home screen shows `poop` + `dirt`, mini-games are blocked until the player taps the poop away and finishes a full sponge scrub, and `/api/game/play` enforces that lock on the backend too.
- The cleanup UX is now more explicit and more phone-safe: the poop spins away when tapped, and the hint plus `Sponge` control now live in a dedicated cleanup dock between the top glass stack and the bottom actions, so they no longer collide with foreground house decor or sit on top of `Feed / Play` on small screens. The sponge cursor still follows the pointer across the whole screen while scrubbing.
- Mini-games now load lazily, and heavy games such as Sniper are pre-warmed before play without force-loading the whole game set at once, which reduces first-open jank on slower phones.
- Added a new server-authoritative mini-game, `caSino`: every spin costs `5 ✦` and `1` energy, always pays out through approved symbol patterns, contributes `1 ✦` into a shared jackpot pool that can be cracked with `Sino-Sino-Sino`, now uses a fuller logo sprite fallback chain (`sinofull` → `sino`), vertically scrolling `3x3` reels with staggered 1s / 2s / 3s stops, a built-in combinations sheet, stable non-winning top/bottom rows around the real center-line combo, a draggable pull-down lever instead of a plain spin button, and a global Telegram broadcast whenever someone hits the jackpot.
- The main Home screen now reuses the Personal Home room as a decorative background layer: the gift columns are gone, the Peeper sits lower so they feel grounded on the floor, and the profile/stats/actions now live in blurred glass-style panels with an even shorter profile pill and a tighter top row laid out as `Home / Age / Guide`, with the owned Home CTA shrinking to its real content width and the age pill now reading `Age: ...` while still collapsing to days only after 10 days.
- That Home background is now shown only after the player actually buys a Personal Home; players without a house keep the redesigned glass UI, but no built-in room is rendered behind them yet.
- The Home layout was also tightened and rebalanced for Telegram iOS: top safe-area padding now uses the real usable inset instead of double-counting, the profile/stats panels are slightly shorter, and bottom UI spacing is reduced so the tab bar plus `Feed / Play` sit lower instead of floating too high.
- Family care actions now send Telegram DMs too: regular family feeding sends the target a simple Tendies notification, while `Big Feast` sends every other fed family member a larger celebratory message with a deep link back into the Mini App.
- Family members now have a shared `Big Feast` utility: each player can trigger it once every 7 days for `100 ✦`, it feeds every living family member to `100%` hunger, and the Family screen shows a confirmation sheet plus a live cooldown timer before purchase.
- The dirty-cleanup overlay on that Home screen now keeps its interactive hit-area alive inside the room scene too, so tapping the poop works again instead of being swallowed by the decorative wrapper, and the fallback dirt mask now tracks only the visible grime blobs instead of the whole square canvas.
- The transparent Home UI spacer no longer intercepts pointer events, so cleanup taps pass through the middle of the screen to the Peeper scene instead of being blocked by an invisible overlay layer.
- The Personal Home scene is now immersive and frame-free, with `/sprites/basewall.png` and `/sprites/basefloor.png` rendered as split built-in room layers, so wallpapers can safely use the full canvas while the base floor still masks the bottom area.
- Inside the house there are now two bottom actions: `Decor Shop` for buying room items and `Decorate` for applying them.
- `Decor Shop` now uses direct slot tabs only, without an `All` section, and the top slot buttons stay visible instead of being overlapped by the item grid.
- `back_decor[]` is now truly multi-select and supports manual drag reorder, with the final layer order persisted on the backend through `/api/home/back-decor/reorder`.
- The built-in `basewall` / `basefloor` layers are not exposed as purchasable decor items, and both `Decor Shop` and `Decorate` now follow the existing clothing `Shop` / `Wardrobe` patterns more closely.
- `Decor Shop` and `Decorate` inside Personal Home now open as full-screen subpages with their own `Back` buttons instead of bottom sheets, while item purchase previews still use a compact sheet.
- The home scene now starts from the top of the screen, with any leftover free space staying below the room and using the active theme background instead of a fixed beige fill.
- Home shop items now open a larger preview sheet before purchase, show only `✦` pricing in the grid, and keep the slot tabs on one adaptive row without scroll.
- All single-select home slots can now be cleared again, with `Walls` falling back to `basewall` and `Floor` falling back to `basefloor`.
- Public player profiles can now show a `Visit Home` card, which opens a read-only visit scene with your Peeper on the left and the home owner's mirrored Peeper on the right inside that player's room.
- The visit screen now includes `Take Photo`, which sends the shared home render to your private chat with the bot.
- Personal Home bot renders now stay aligned with the in-app room proportions, so `/myhome`, `/visit @username`, and `Take Photo` match the main app view more closely.
- The admin panel now has separate home-decor management with slot-aware CRUD and exact `600x840` PNG/GIF validation for uploaded room layers.
- The Telegram bot now supports `/myhome` and `/visit @username`, so players can render their own home or a cozy visit scene with another player's home directly into chat.
- The Telegram bot family portrait from `/myfamily` now uses a cleaner composition, with the founder highlighted above the group, balanced rows for the rest of the family, and cleaner labels without floor shadows.
- `/myfamily` bot captions now use safe Unicode output, so Telegram no longer shows garbled characters in the family photo message.
- The fallback `/myfamily` bot message for players without a family now also uses safe Unicode output, so the "join a family" prompt no longer shows garbled emoji.
- Slide-up bottom sheets and overlay drawers now support swipe-down dismissal from the top handle, so large overlays can be closed without trying to tap the background behind them.
- Sprite and home-layer URLs now use a shared runtime cache-busting helper plus a server-side `asset_version` setting, and the admin panel can bump that version with a `Reset Cache` button to force immutable PNG assets to redownload.
- Avatar URLs now also include the shared runtime cache version plus a daily cache seed, while the backend refreshes Telegram profile photos after 24 hours and the admin `Reset Cache` button now invalidates stale avatar refresh timestamps too. That means both daily refreshes and manual cache resets can force avatar updates instead of leaving old profile photos stuck.
- The full implementation blueprint and follow-up phases remain documented in [docs/personal-home-implementation-plan.md](/Users/Vivor/Desktop/peeper_v40/docs/personal-home-implementation-plan.md).
- The new dirt/cleanup mechanic is documented separately in [docs/dirty-peeper-cleanup-plan.md](/Users/Vivor/Desktop/peeper_v40/docs/dirty-peeper-cleanup-plan.md), including DB fields, state flow, API, and UI behavior.
- The new `caSino` mini-game is documented in [docs/casino-slot-implementation-plan.md](/Users/Vivor/Desktop/peeper_v40/docs/casino-slot-implementation-plan.md), including symbol set, jackpot rules, weighted outcomes, API, and UI flow.

---

## Local Development

### Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env: set BOT_TOKEN=dev (for local dev, skips Telegram validation)
npm run dev          # runs on http://localhost:4000
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # runs on http://127.0.0.1:5173
                     # API calls proxied to :4000 via vite.config.js
```

Local browser dev also works on `localhost`, `127.0.0.1`, and `::1`.
If a shared top-level `html/` folder exists, Vite serves `/sprites/*`,
`/gifts/*`, and `/home/*` from it in dev mode, matching the production asset
layout.
The built-in dev account `telegram_id = 999999` is treated as an admin only in
local development, so you can open the admin panel without changing production
admin IDs.
Admin requests in local browser dev now use the same mock Telegram initData as
the main app client, so item and sprite uploads work outside Telegram too.

### Encoding Standard

- The repo now includes a root `.editorconfig` that enforces `utf-8` and `lf`.
- For UI text, prefer plain ASCII plus Unicode escapes for symbols like back arrows, coins, and check marks instead of pasting raw glyphs directly into JSX.
- If a symbol is reused, define it once as a constant, for example `const COIN_SYMBOL = '\\u2726';`.

---

## Production Deploy (VDS)

### Prerequisites

1. Node.js 18+ installed on VDS
2. PM2 installed globally: `npm install -g pm2`
3. Nginx installed and running
4. SSL cert for `peeper.frenzyradio.online` (Let's Encrypt)
5. Your Telegram Bot Token from [@BotFather](https://t.me/BotFather)

### Steps

```bash
# 1. Clone / upload project to VDS
# 2. From project root:
bash deploy.sh

# 3. Set your real BOT_TOKEN:
sudo nano /var/www/peeper.frenzyradio.online/backend/.env
# Add: BOT_TOKEN=123456789:AAAA...

# 4. Restart backend:
pm2 restart peeper-backend

# 5. Enable nginx site:
sudo ln -s /etc/nginx/sites-available/peeper.frenzyradio.online \
           /etc/nginx/sites-enabled/
sudo nginx -t && sudo nginx -s reload

# 6. SSL (if not yet done):
sudo certbot --nginx -d peeper.frenzyradio.online
```

For source uploads, do not copy local `node_modules` from Windows to the Linux
server. Upload only source files, then run `npm install` on the server. Also do
not overwrite the live `html/` runtime asset folders such as `sprites/`,
`gifts/`, `home/`, or `avatars/`; the deploy script now preserves them.
If nginx is already down or its PID file is stale, the deploy script now falls
back to starting/restarting nginx instead of failing on `nginx -s reload`.

### Register the Mini App with BotFather

```
/newapp
→ Choose your bot
→ App name: Peeper
→ App URL: https://peeper.frenzyradio.online
```

---

## Telegram SDK Key Points

- **`window.Telegram.WebApp`** — the global SDK object, loaded via `<script src="https://telegram.org/js/telegram-web-app.js">` in `index.html`
- **`tg.initData`** — raw string sent with every request as `X-Telegram-Init-Data` header
- **Auth validation** — backend verifies HMAC-SHA256 of initData using `BOT_TOKEN` to ensure requests are genuine
- **`tg.colorScheme`** — `'light'` or `'dark'`, used for theme switching
- **`tg.expand()`** — expands the Mini App to full screen height
- **Users are auto-authenticated** — no login flow needed; identity comes from Telegram

---

## Adding Real Sprites

The current Peeper is an SVG illustration with emoji overlays. To add real PNG sprites:

1. Create PNGs for each accessory (e.g. `head_crown.png`) at 180×180px with transparency
2. Upload to `frontend/public/sprites/`
3. In `PeeperSprite.jsx`, replace the `SlotOverlay` emoji span with:
   ```jsx
   <img src={`/sprites/${itemId}.png`} style={{ position: 'absolute', inset: 0, width: '100%' }} />
   ```

---

## Roadmap (Post-Prototype)

- [ ] Real Peeper PNG sprite sheets (artist needed!)
- [ ] Push notifications via Telegram Bot API when Peeper needs attention
- [ ] Peeper naming on creation
- [ ] More mini-games / rotating events
- [ ] TON Payments for premium items
- [ ] Friends list / following system
- [ ] Seasonal/limited items
- [ ] Peeper evolution based on care quality
