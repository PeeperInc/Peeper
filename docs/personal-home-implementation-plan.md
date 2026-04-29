# Personal Home Update — Full Implementation Plan

Status: implementation in progress  
Last updated: 2026-03-30  
Code status: purchase flow, immersive home screen, decor shop sheet, decorate sheet, manual `back_decor` reorder, and admin home decor CRUD are now implemented

Current MVP note:

- the starter room now uses two uploaded built-in sprites: `basewall` and `basefloor`
- they are rendered as permanent split base layers with file paths `/sprites/basewall.png` and `/sprites/basefloor.png`
- `basewall` sits behind wallpapers, while `basefloor` sits above wallpapers so oversized wall art cannot spill over the room floor
- the data model still keeps `floor_base`, `floor_cover`, `back_decor[]`, and `foreground_item` so future decor work does not require refactoring

Current implementation snapshot:

- `basewall` and `basefloor` are now the built-in room layers and do not appear in the decor shop or admin home-items list
- the main `Home` CTA now uses a compact right-aligned pill in the lower-right utility row above the status bars, so it does not steal width from the Peeper stage and keeps a full touch target
- the Personal Home scene now opens without the old frame and uses an immersive full-screen layout
- the in-room Personal Home Peeper render in the app remains at `255`, while backend chat/canvas renders use a stronger readability boost for Telegram shots and sit slightly lower in the room for a fuller composition
- bottom actions now open `Decor Shop` and `Decorate`
- the `Decor Shop` now uses direct slot tabs only, without an `All` tab, and its top tab row no longer gets overlapped by the card scroller
- decor shop and decorate cards now follow the existing clothing `Shop` / `Wardrobe` footprint more closely, with smaller previews and no technical item IDs under the decor name
- `Decor Shop` and `Decorate` now open as dedicated full-screen subpages inside `Personal Home`, each with its own back button, instead of reusing bottom sheets for the main browsing flow
- home slot tabs now stay on one adaptive row without horizontal scroll or wrapping
- the home scene now pins to the top of the available area, with any free space remaining only below the room and filled by the active theme background
- `back_decor[]` now supports explicit manual reorder through a drag list, persisted on the backend
- all single-select decor slots can now be cleared back to the built-in split base room, including `wall_base` -> `basewall` and `floor_base` -> `basefloor`
- admin now has separate home-decor management endpoints and UI, with PNG validation for exact `600 x 840`
- the Telegram bot now supports `/myhome`, rendering the current Personal Home scene into chat with the same basewall/basefloor and decor stack
- the Telegram bot now also supports `/visit @username`, which renders the same cozy two-Peeper visit scene used by the in-app `Take Photo` action
- public user profiles can now expose a read-only `Visit Home` entry when the target player owns a Personal Home
- the visit scene now renders the owner's room with two Peepers: viewer on the left, owner mirrored on the right
- the visit scene now supports `Take Photo`, which sends the shared home render to the viewer's private bot chat

---

## 1. Goal

Add a new personal-home feature to the game:

- every player can buy a personal house for `1000` coins;
- the house is bought from the main `Home` screen;
- after purchase, the button becomes an entry point into the personal home scene;
- the personal home is a fixed vertical scene with a logical canvas of `600 x 840`;
- decor is applied exactly like layered outfit sprites, but for the room;
- each decor asset is a full-canvas transparent PNG of size `600 x 840`;
- most home slots are single-select;
- one slot (`back_decor`) is multi-select and renders in the order items were enabled by the player.

Main product direction:

- cozy
- friendly
- family-friendly
- simple to understand
- low-friction UI
- scalable for future decor content

---

## 2. Frozen Product Decisions

These decisions are considered approved for implementation unless explicitly changed later.

### 2.1 House purchase

- Feature name in code/docs: `Personal Home`
- Purchase price: `1000` coins
- Purchase type: one-time unlock
- Player buys an empty starter house
- Purchase CTA location: main `Home` screen lower-right utility row above the status bars, right-aligned in the row
- If house is not bought: button shows buy-state
- If house is already bought: button changes into `Home` entry button

### 2.2 Home scene

- Logical home canvas: `600 x 840`
- Vertical scene
- No extra off-canvas space
- All decor PNGs are exactly `600 x 840`
- Player Peeper is rendered inside the scene and intentionally smaller than the original source sprite

### 2.3 Slot model

User-configurable slots:

1. `wall_base`
2. `floor_base`
3. `floor_cover`
4. `back_decor[]` (multi-select)
5. `foreground_item`

Fixed render layer:

6. `peeper`

Interpretation:

- There are `4` single-select decor slots
- There is `1` multi-select decor slot
- Peeper is not a decor slot; it is a fixed render layer

### 2.4 back_decor behavior

- `back_decor[]` may contain multiple enabled items
- items in `back_decor[]` render in the order the player enabled them
- later enabled item renders above earlier enabled item
- overlapping is allowed by design
- if the player creates visual clutter, this is acceptable

---

## 3. Final Render Stack

Approved render order for the home scene:

1. built-in `basewall`
2. `wall_base`
3. built-in `basefloor`
4. `floor_base`
5. `floor_cover`
6. `back_decor[]` sorted by user activation order
7. `peeper`
8. `foreground_item`

Why this order:

- built-in `basewall` is the permanent wall silhouette at the very back
- `wall_base` sits above it and can safely use full-canvas wallpaper art
- built-in `basefloor` sits above the wallpaper layer and masks the lower part of oversized wall art
- `floor_base` sits above the built-in floor and defines the active room floor
- `floor_cover` sits above the base floor and can be a rug/grass/snow/tatami/etc.
- `back_decor[]` contains all items that should appear behind the Peeper
- `peeper` stands on top of all back layers
- `foreground_item` is the only layer intentionally drawn in front of the Peeper

Examples by slot:

### `wall_base`

- wallpaper
- brick wall
- pastel wall
- forest wall
- night room wall

### `floor_base`

- wooden floor
- stone floor
- tile floor
- dirt floor

### `floor_cover`

- rug
- tatami
- grass patch
- snow patch
- puddle
- decorative floor overlay

### `back_decor[]`

- bed
- sofa
- shelf
- poster
- painting
- clock
- window
- curtain
- plant behind Peeper
- wardrobe
- fairy lights

### `foreground_item`

- small table
- fence
- crate
- front plant
- curtain edge
- toy chest in front

---

## 4. Canvas and Art Contract

### 4.1 Fixed home canvas

All home items must follow this exact art contract:

- dimensions: `600 x 840`
- file type: `PNG`
- transparent background allowed and expected
- the asset is already pre-positioned inside the file
- no runtime x/y transforms per item in MVP
- no per-slot anchor system in MVP

This means:

- every decor item is a full-scene overlay
- applying decor is just layering PNG files in the correct order

### 4.2 Peeper render inside the home

Source Peeper sprite can remain whatever it already is, but in the home scene:

- render target should be smaller than current main-screen size
- recommended visible width: around `280-320 px`
- recommended center X: `300`
- recommended base visual Y: around `565-620` depending on actual pose

Current implementation constants:

```js
const HOME_CANVAS_WIDTH = 600;
const HOME_CANVAS_HEIGHT = 840;
const HOME_PEEPER_RENDER_WIDTH = 255;
const HOME_PEEPER_CENTER_X = 300;
const HOME_PEEPER_CENTER_Y = 575;
```

Important:

- home decor PNGs should be authored with the assumption that the Peeper stands in the center-lower region of the room
- art production should treat the Peeper position as stable

### 4.3 File naming convention

Recommended decor item id pattern:

```txt
home_<slot>_<slug>
```

Examples:

- `home_wall_base_pastel_soft`
- `home_floor_base_wood_oak`
- `home_floor_cover_rug_heart`
- `home_back_decor_bed_cloud`
- `home_back_decor_window_round_day`
- `home_foreground_item_table_tea`

Corresponding file names:

```txt
home_wall_base_pastel_soft.png
home_back_decor_bed_cloud.png
```

### 4.4 Asset storage path

Do not mix home decor files with clothing sprites if avoidable.

Recommended new storage paths:

- dev: `frontend/public/home/`
- prod: `/var/www/peeper.frenzyradio.online/html/home/`

Recommended public URL format:

```txt
/home/<itemId>.png
```

---

## 5. UX / Player Flow

## 5.1 Main Home screen button

Placement requirement from product:

- button is on the main `Home` screen
- visually placed in the lower-right utility area above the status bars
- rendered as an overlay so it does not reduce the main sprite stage height

Implementation recommendation:

- place the house CTA in the right side of the utility area above the status bars
- keep `How it works` on the left in normal flow
- keep the home CTA compact and absolutely positioned over the empty right-side space

Recommended placement logic:

```js
display: 'flex';
alignItems: 'center';
justifyContent: 'flex-start';
padding: '0 16px 6px';
position: 'relative';
```

Behavior states:

### Locked, enough coins

- icon: `🏠`
- title: `Buy House`
- subtitle: `1000 ✦`
- button enabled

### Locked, not enough coins

- icon: `🏠`
- title: `Buy House`
- subtitle: `Need 1000 ✦`
- button disabled or opens info toast

### Owned

- icon: `🏠`
- title: `Home`
- no price
- tap opens personal home scene

### Loading

- short spinner or `...`

## 5.2 Buy flow

Recommended buy flow:

1. Player taps `Buy House`
2. Confirmation bottom sheet opens
3. Text: `Buy an empty Personal Home for 1000 ✦?`
4. Buttons:
   - `Buy`
   - `Cancel`
5. On success:
   - coins decrease
   - `homeSummary.owned = true`
   - CTA changes into `Home`
   - optional: auto-open the home once after first purchase

Recommended first-purchase UX:

- after successful purchase, auto-open the home scene
- this creates a stronger reward moment

## 5.3 Personal Home screen flow

Open from main `Home` screen as a full-screen overlay or dedicated screen overlay, not as a bottom tab.

Recommended structure:

- top bar with back button
- title `My Home`
- optional coin badge
- centered house scene
- future edit/shop buttons can sit below the scene

MVP view-only controls:

- `Back`
- `Shop` (optional if decor shop is in v1)
- `Decorate` (optional if editor is in v1)

## 5.4 Empty starter house state

Initial purchased house should feel intentionally empty, not broken.

That means starter house still needs default base layers:

- built-in `basewall`
- built-in `basefloor`
- `wall_base = null`
- `floor_base = null`
- `floor_cover = null`
- `back_decor[] = []`
- `foreground_item = null`

Starter house should visually read as:

- simple room
- empty
- ready to decorate

---

## 6. Data Model

The cleanest approach is to keep home data separate from clothing data.

Reason:

- clothing tables currently assume `head/body/hands/face`
- home slots are structurally different
- `back_decor[]` is multi-select
- art pipeline is different
- admin upload path is different

Recommended new tables:

## 6.1 `personal_homes`

One row per player who bought a home.

```sql
CREATE TABLE IF NOT EXISTS personal_homes (
  user_id                INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  purchased_at           INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  wall_base_item_id      TEXT DEFAULT NULL,
  floor_base_item_id     TEXT DEFAULT NULL,
  floor_cover_item_id    TEXT DEFAULT NULL,
  foreground_item_id     TEXT DEFAULT NULL,
  updated_at             INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
```

Purpose:

- stores whether player owns a house
- stores single-select slot choices

## 6.2 `home_shop_items`

Catalog for home decor items.

```sql
CREATE TABLE IF NOT EXISTS home_shop_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  slot       TEXT NOT NULL CHECK(slot IN (
    'wall_base',
    'floor_base',
    'floor_cover',
    'back_decor',
    'foreground_item'
  )),
  price      INTEGER NOT NULL DEFAULT 100,
  is_free    INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
```

Purpose:

- admin-managed home item catalog
- separate from clothing catalog

## 6.3 `owned_home_items`

User inventory for home decor.

```sql
CREATE TABLE IF NOT EXISTS owned_home_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  purchased_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE(user_id, item_id)
);
```

Purpose:

- tracks which decor items the player owns

## 6.4 `home_back_decor_enabled`

Stores active back-decor selection and render order.

```sql
CREATE TABLE IF NOT EXISTS home_back_decor_enabled (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  sort_order   INTEGER NOT NULL,
  enabled_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (user_id, item_id)
);
```

Recommended index:

```sql
CREATE INDEX IF NOT EXISTS idx_home_back_decor_order
ON home_back_decor_enabled(user_id, sort_order);
```

Purpose:

- active enabled back decor only
- order is persistent
- order reflects enable sequence

## 6.5 `home_custom_sprites`

Stores uploaded PNG path for home decor items.

```sql
CREATE TABLE IF NOT EXISTS home_custom_sprites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     TEXT UNIQUE NOT NULL,
  file_path   TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
```

Purpose:

- separate sprite mapping for home items

---

## 7. Built-In Base Room Strategy

The starter room now relies on permanent built-in sprites, not purchasable room items.

Built-in room assets:

- `/sprites/basewall.png`
- `/sprites/basefloor.png`

Rules:

- these two assets are always present in the scene
- they do not appear in `home_shop_items`
- they do not appear in the decor shop
- they do not appear in the admin home-items list
- a newly purchased house can safely start with all single-select slots set to `NULL`

Practical result:

- clearing `wall_base` falls back to `basewall`
- clearing `floor_base` falls back to `basefloor`
- oversized wallpaper art is masked by the built-in floor layer without any extra item logic

On purchase:

1. create `personal_homes` row
2. grant any globally free decor items from `home_shop_items`
3. leave room slots empty so the built-in split base room shows through

---

## 8. API Design

Recommended new route file:

```txt
backend/routes/home.js
```

Register in:

```txt
backend/server.js
```

## 8.1 `POST /api/home/buy`

Purpose:

- buy personal home for `1000` coins

Validation:

- user exists
- player does not already own a home
- user has at least `1000` coins

Transaction:

1. deduct `1000` coins
2. insert `personal_homes`
3. grant any free decor items from `home_shop_items`
4. leave `wall_base` / `floor_base` empty so the built-in room renders by default

Recommended response:

```json
{
  "message": "🏠 Your Personal Home is ready!",
  "coins": 320,
  "homeSummary": {
    "owned": true,
    "purchased_at": 1760000000
  }
}
```

## 8.2 `GET /api/home/state`

Purpose:

- fetch full current home scene and active layout

Recommended response:

```json
{
  "home": {
    "owned": true,
    "canvas": { "width": 600, "height": 840 },
    "purchased_at": 1760000000,
    "slots": {
      "wall_base": null,
      "floor_base": null,
      "floor_cover": null,
      "back_decor": [],
      "foreground_item": null
    }
  }
}
```

## 8.3 `GET /api/home/catalog`

Purpose:

- get all active home shop items and ownership info

Recommended response:

```json
{
  "items": [
    {
      "item_id": "home_back_decor_bed_cloud",
      "name": "Cloud Bed",
      "slot": "back_decor",
      "price": 250,
      "is_free": 0,
      "owned": false,
      "file_path": "/home/home_back_decor_bed_cloud.png"
    }
  ],
  "coins": 320
}
```

## 8.4 `POST /api/home/buy-item`

Body:

```json
{ "itemId": "home_back_decor_bed_cloud" }
```

Validation:

- item exists
- item is active
- slot is valid
- user owns house
- user does not already own item
- enough coins

Transaction:

- deduct coins
- insert into `owned_home_items`

## 8.5 `POST /api/home/layout`

Unified endpoint for setting single-select home slots.

Body:

```json
{
  "wall_base": "home_wall_base_pastel",
  "floor_base": "home_floor_base_wood_oak",
  "floor_cover": null,
  "foreground_item": "home_foreground_item_table_tea"
}
```

Validation:

- user owns house
- every provided item belongs to the correct slot
- user owns each provided item

Result:

- update `personal_homes`

## 8.6 `POST /api/home/back-decor/toggle`

Purpose:

- enable or disable a `back_decor` item

Body:

```json
{
  "itemId": "home_back_decor_bed_cloud",
  "enabled": true
}
```

Rules:

- enabling appends item to end of current `sort_order`
- disabling removes row from `home_back_decor_enabled`
- re-enabling later puts item at the end again

Enable SQL idea:

```sql
INSERT INTO home_back_decor_enabled (user_id, item_id, sort_order, enabled_at)
VALUES (
  ?,
  ?,
  COALESCE((SELECT MAX(sort_order) + 1 FROM home_back_decor_enabled WHERE user_id = ?), 1),
  strftime('%s','now')
)
ON CONFLICT(user_id, item_id) DO NOTHING;
```

## 8.7 Implemented endpoint: `POST /api/home/back-decor/reorder`

This endpoint is now part of the live implementation.

Purpose:

- persist manual `back_decor[]` order chosen in the drag UI
- keep backend render order authoritative
- avoid forcing the player to disable/re-enable items just to restack layers

---

## 9. Login and Game State Integration

The Home button on the main screen needs to know only one thing immediately:

- does the player own a home?

Recommended minimal state object:

```json
{
  "homeSummary": {
    "owned": true,
    "purchased_at": 1760000000
  }
}
```

This should be included in:

- `POST /api/auth/login`
- `GET /api/game/state`
- responses that change coins + home ownership, such as `POST /api/home/buy`

Reason:

- HomeScreen already refreshes with `login` and `game/state`
- this lets the main home CTA update immediately
- full home layout should still be fetched only when opening the actual house scene

Recommended backend helper:

```txt
backend/homeState.js
```

Suggested helper functions:

- `getHomeSummary(userId)`
- `getFullHomeState(userId)`
- `assertHomeOwned(userId)`
- `serializeHomeItem(item)`
- `serializeSingleSlot(itemId)`
- `serializeBackDecor(userId)`

---

## 10. Frontend Architecture

## 10.1 New frontend state

Add to `AppContext` state:

```js
homeSummary: {
  owned: false,
  purchased_at: null
},
ownedHomeItems: []
```

Recommended reducer actions:

- `SET_HOME_SUMMARY`
- `UPDATE_HOME_SUMMARY`
- `SET_OWNED_HOME_ITEMS`
- `ADD_OWNED_HOME_ITEM`

Recommended new actions in `AppContext`:

- `buyPersonalHome()`
- `refreshHomeSummary()`
- `getPersonalHomeState()`
- `getHomeCatalog()`
- `buyHomeItem(itemId)`
- `updateHomeLayout(payload)`
- `toggleBackDecor(itemId, enabled)`

## 10.2 New API methods in `frontend/src/api.js`

Add:

```js
export const buyPersonalHome = () => post('/home/buy');
export const getPersonalHomeState = () => get('/home/state');
export const getHomeCatalog = () => get('/home/catalog');
export const buyHomeItem = (itemId) => post('/home/buy-item', { itemId });
export const updateHomeLayout = (payload) => post('/home/layout', payload);
export const toggleBackDecor = (itemId, enabled) => post('/home/back-decor/toggle', { itemId, enabled });
```

## 10.3 New screen/components

Recommended new files:

```txt
frontend/src/screens/PersonalHomeScreen.jsx
frontend/src/components/HomeScene.jsx
frontend/src/components/HomePurchaseSheet.jsx
frontend/src/components/HomeLayerImage.jsx
```

Optional later:

```txt
frontend/src/screens/HomeDecorShopScreen.jsx
frontend/src/components/BackDecorPicker.jsx
```

## 10.4 HomeScreen integration

Main screen work:

- add house CTA near the Peeper area
- CTA state depends on `homeSummary.owned`
- if not owned: open purchase sheet
- if owned: open `PersonalHomeScreen`

Recommended local state in `HomeScreen.jsx`:

```js
const [showHomePurchase, setShowHomePurchase] = useState(false);
const [showPersonalHome, setShowPersonalHome] = useState(false);
const [buyingHome, setBuyingHome] = useState(false);
```

Recommended open behavior:

- `showPersonalHome` is a full-screen overlay
- same style as profile overlay and game overlay patterns already used in app

## 10.5 PersonalHomeScreen responsibilities

Responsibilities:

- fetch home state on open
- render layered scene
- show back button
- later expose decorate/shop buttons

Recommended local state:

```js
const [homeState, setHomeState] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);
```

## 10.6 HomeScene responsibilities

The scene component should:

- accept already prepared active slot data
- render base layers in approved order
- render `back_decor[]` sorted by `sort_order`
- render Peeper centered
- render foreground item if selected

Recommended props:

```js
{
  wallBase,
  floorBase,
  floorCover,
  backDecor,
  foregroundItem,
  peeper
}
```

---

## 11. Scene Rendering Rules

## 11.1 Scaling on different devices

The logical art canvas stays `600x840`.

Actual screen display uses CSS scale via responsive width.

Recommended scene wrapper CSS:

```css
width: min(92vw, 430px);
aspect-ratio: 600 / 840;
max-height: 68svh;
```

If a stricter size guard is needed:

```css
width: min(92vw, calc((100svh - 160px) * 600 / 840), 430px);
```

Result:

- same logical art on all devices
- no special item positioning logic per device
- scene simply scales down

## 11.2 Layer rendering

Each home decor layer is a full-scene image:

```jsx
<img src={layer.file_path} alt="" />
```

Recommended image style:

```css
position: absolute;
inset: 0;
width: 100%;
height: 100%;
object-fit: contain;
pointer-events: none;
user-select: none;
```

## 11.3 Peeper layer

Peeper should not be rendered as a 600x840 full-canvas image in MVP.

Recommended render:

- absolute positioned in center-lower region
- uses existing `PeeperSprite`
- fixed home-scene size around `255` in-app
- fixed visit-scene size around `160` in-app
- backend chat/canvas renders use a larger readable framing: about `337` for `/myhome` and about `212` for visit shots
- backend chat/canvas renders are also nudged about `15px` lower than before

Recommended wrapper:

```jsx
<div style={{
  position: 'absolute',
  left: '50%',
  top: '68%',
  transform: 'translate(-50%, -50%)',
  width: 255,
  height: 255,
}}>
  <PeeperSprite ... />
</div>
```

---

## 12. Buy / Equip / Enable Logic

## 12.1 House purchase rules

- player can buy only once
- house cannot be sold
- no refund in MVP
- no upgrade levels in MVP

## 12.2 Decor purchase rules

- player must own house before buying home decor
- each decor item can be owned once
- price is paid in coins
- free decor items are granted automatically

## 12.3 Single-slot equip rules

For:

- `wall_base`
- `floor_base`
- `floor_cover`
- `foreground_item`

Rules:

- exactly zero or one active item for that slot
- setting a new item replaces previous item
- setting `null` clears slot if allowed

## 12.4 Multi-slot enable rules

For:

- `back_decor[]`

Rules:

- any owned `back_decor` item may be enabled
- enabled item is appended to end of render stack
- disabling removes it from active stack
- re-enabling later appends again to top of current stack

---

## 13. Admin System Plan

The current admin system already manages:

- shop items
- clothing PNG uploads
- gift catalog
- gift uploads

Recommended expansion:

- add a separate `Home Items` admin section
- do not mix with clothing items

New admin endpoints:

- `GET /api/admin/home-items`
- `POST /api/admin/home-items`
- `PATCH /api/admin/home-items/:itemId`
- `DELETE /api/admin/home-items/:itemId`
- `POST /api/admin/home-items/upload`
- `GET /api/admin/home-sprites`
- `DELETE /api/admin/home-sprites/:itemId`

Validation:

- slot must be one of home slot types
- only PNG allowed
- file must be exactly `600x840` for MVP, or at least validated and rejected if not matching

Important recommendation:

Validate dimensions on upload.

Expected dimensions:

```txt
600 x 840
```

If file is not this size:

- reject upload
- show explicit error

This protects scene consistency.

---

## 14. Recommended Constants

These constants should be centralized.

Backend:

```js
const HOME_PRICE_COINS = 1000;
const HOME_CANVAS_WIDTH = 600;
const HOME_CANVAS_HEIGHT = 840;
const HOME_SINGLE_SLOTS = ['wall_base', 'floor_base', 'floor_cover', 'foreground_item'];
const HOME_MULTI_SLOT = 'back_decor';
```

Frontend:

```js
const HOME_PRICE_COINS = 1000;
const HOME_CANVAS_WIDTH = 600;
const HOME_CANVAS_HEIGHT = 840;
const HOME_SCENE_ASPECT = HOME_CANVAS_WIDTH / HOME_CANVAS_HEIGHT;
const HOME_PEEPER_SIZE = 255;
```

If needed later:

```js
const HOME_BACK_DECOR_SOFT_WARNING = 12;
```

Note:

Product currently says player can enable as many `back_decor` items as they want.

Engineering note:

- do not enforce a cap now unless needed
- but track performance if too many 600x840 PNGs get layered

---

## 15. Recommended JSON Shapes

## 15.1 `homeSummary`

```json
{
  "owned": true,
  "purchased_at": 1760000000
}
```

## 15.2 Single slot item

```json
{
  "item_id": "home_floor_base_wood_oak",
  "name": "Oak Floor",
  "slot": "floor_base",
  "file_path": "/home/home_floor_base_wood_oak.png"
}
```

## 15.3 Back decor item

```json
{
  "item_id": "home_back_decor_bed_cloud",
  "name": "Cloud Bed",
  "slot": "back_decor",
  "file_path": "/home/home_back_decor_bed_cloud.png",
  "sort_order": 3,
  "enabled_at": 1760000100
}
```

## 15.4 Full home state

```json
{
  "home": {
    "owned": true,
    "canvas": {
      "width": 600,
      "height": 840
    },
    "purchased_at": 1760000000,
    "slots": {
      "wall_base": null,
      "floor_base": null,
      "floor_cover": null,
      "back_decor": [
        {
          "item_id": "home_back_decor_bed_cloud",
          "file_path": "/home/home_back_decor_bed_cloud.png",
          "sort_order": 1
        },
        {
          "item_id": "home_back_decor_poster_star",
          "file_path": "/home/home_back_decor_poster_star.png",
          "sort_order": 2
        }
      ],
      "foreground_item": null
    }
  }
}
```

---

## 16. File-by-File Change Plan

## 16.1 Backend

### `backend/database.js`

Add:

- `personal_homes`
- `home_shop_items`
- `owned_home_items`
- `home_back_decor_enabled`
- `home_custom_sprites`
- indexes for user/sort order lookups

### `backend/routes/home.js`

Create new route file with:

- `POST /buy`
- `GET /state`
- `GET /catalog`
- `POST /buy-item`
- `POST /layout`
- `POST /back-decor/toggle`

### `backend/routes/auth.js`

Extend login response:

- include `homeSummary`

### `backend/routes/game.js`

Extend `/state` response:

- include `homeSummary`

### `backend/routes/admin.js`

Add home item CRUD + PNG upload

### `backend/server.js`

Register new home routes:

```js
app.use('/api/home', require('./routes/home'));
```

### Optional helper files

Recommended:

```txt
backend/homeState.js
backend/homeConstants.js
```

## 16.2 Frontend

### `frontend/src/api.js`

Add home endpoints

### `frontend/src/context/AppContext.jsx`

Add:

- `homeSummary`
- home actions
- home reducer cases

### `frontend/src/screens/HomeScreen.jsx`

Add:

- house CTA as a floating overlay in the utility row above the status bars
- purchase sheet state
- personal home overlay open state

### `frontend/src/screens/PersonalHomeScreen.jsx`

New screen for home scene

### `frontend/src/components/HomeScene.jsx`

Layered scene renderer

### `frontend/src/theme.css`

Add styles for:

- home CTA
- scene frame
- overlay
- purchase sheet visuals

### `frontend/public/home/`

Add starter house PNGs

---

## 17. Implementation Phases

## Phase 0 — Preparation

- freeze slot names
- freeze canvas size `600x840`
- freeze purchase price `1000`
- prepare built-in `basewall` + `basefloor` assets

Deliverable:

- all names/constants agreed

## Phase 1 — Backend foundation

- create DB tables
- create helper functions
- create `/api/home/buy`
- create `homeSummary`
- expose `homeSummary` in login and game state

Deliverable:

- player can buy home at API level

## Phase 2 — Main Home screen CTA

- add buy/home button to `HomeScreen`
- add confirmation sheet
- add success state
- update coins and `homeSummary` after purchase

Deliverable:

- player can buy house from main screen

## Phase 3 — Personal Home scene MVP

- create `PersonalHomeScreen`
- create `HomeScene`
- render built-in `basewall` + `basefloor` + Peeper
- open scene from house button

Deliverable:

- player can enter their house

## Phase 4 — Home decor catalog and inventory

- add `home_shop_items`
- add `owned_home_items`
- add `GET /api/home/catalog`
- add `POST /api/home/buy-item`

Deliverable:

- player can own decor items

## Phase 5 — Layout system

- add single-slot layout updates
- add `back_decor` toggle
- persist render order

Deliverable:

- player can decorate the house

## Phase 6 — Admin tools

- add admin CRUD for home items
- add PNG upload with size validation
- expose file paths

Deliverable:

- content pipeline is usable without code edits

## Phase 7 — Polish

- toasts
- empty states
- loading placeholders
- small-screen QA
- performance QA

Deliverable:

- production-ready MVP

---

## 18. Risks and Mitigations

## Risk 1 — Too many active back_decor PNG layers

Problem:

- `600x840` PNGs can be relatively heavy on low-end phones
- multiple active layers can increase memory and compositing cost

Mitigation:

- ship MVP first
- monitor performance
- if needed later, add soft or hard active-layer cap
- optimize PNGs aggressively

## Risk 2 — Wrong-sized uploaded assets

Problem:

- scene breaks visually if assets are not `600x840`

Mitigation:

- validate dimensions on upload
- reject incorrect files

## Risk 3 — Item overlap chaos in back_decor

Problem:

- players can create messy compositions

Mitigation:

- acceptable by product design
- later add alternate reorder controls such as move-up / move-down buttons in addition to drag

## Risk 4 — Breaking existing shop/clothing logic

Problem:

- trying to force home decor into current clothing tables would increase complexity

Mitigation:

- keep home tables separate

## Risk 5 — Home button crowding main screen

Problem:

- CTA may visually fight with gifts/status/actions

Mitigation:

- keep the CTA in the utility row so it stays readable on compact screens
- test on small iPhone and compact Android

---

## 19. Testing Checklist

## Purchase

- user with `< 1000` coins cannot buy
- user with `>= 1000` coins can buy
- coins deduct exactly once
- second purchase attempt is blocked
- `homeSummary` flips to owned immediately

## Scene open

- house button changes from buy-state to open-state
- house scene opens on small screens
- house scene scales correctly
- Peeper is centered and visibly smaller

## Decor ownership

- cannot buy same decor twice
- cannot equip decor without owning it
- cannot equip wrong slot item into single slot

## back_decor

- enabling one item makes it visible
- enabling multiple items preserves order
- disabling removes item
- re-enabling appends to top

## Persistence

- relogin preserves house ownership
- relogin preserves active layout
- `/game/state` preserves `homeSummary`

## Admin

- invalid PNG dimensions are rejected
- valid `600x840` PNG uploads work
- deleted item is removed from catalog

---

## 20. Recommended MVP Cutline

If we need a smaller first release, the absolute MVP should be:

- buy personal home for `1000`
- built-in `basewall` + `basefloor`
- open home scene from main screen
- Peeper inside scene
- no decor shop yet

Then second drop:

- home decor catalog
- buy items
- single-slot selection
- `back_decor[]`

This reduces initial risk while keeping the product direction intact.

---

## 21. Final Recommendation

Recommended implementation shape:

- keep home decor system separate from clothing
- use exact `600x840` PNG overlays
- store single slots on `personal_homes`
- store multi-select active stack in `home_back_decor_enabled`
- use `homeSummary` in login/game state for fast main-screen updates
- open the full house scene only on demand
- build the system as a clean vertical overlay from `HomeScreen`

This gives:

- simple mental model
- simple asset pipeline
- low-risk rendering logic
- easy expansion path for future decor content

---

## 22. Future Expansion Hooks

These are explicitly out of scope for current implementation, but the plan should not block them:

- richer reorder affordances for `back_decor[]` such as drag handles inside the main scene
- house decor shop screen with categories
- themed home sets
- seasonal decor
- richer visit-home social actions beyond the current read-only visit + photo flow
- personal home leaderboard or showcase
- animated decor
- sound/music themes

---

## 23. One-Screen Summary

What we are building:

- one-time purchasable personal home
- price `1000` coins
- opened from main `Home` screen
- scene canvas `600x840`
- 4 single-select decor slots
- 1 multi-select decor layer behind Peeper
- Peeper in fixed center-lower layer
- 1 foreground slot in front of Peeper
- full-canvas transparent PNG pipeline for all decor
- main `Home` screen may reuse the same room scene as a background layer, while keeping gameplay UI above it and anchoring the live Peeper visually to the room floor

This is the currently approved blueprint.
