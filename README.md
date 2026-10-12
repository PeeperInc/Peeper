# Peeper

Peeper is a Telegram Mini App built around a persistent virtual character and shared social activities. The application combines character care, customization, social features, lightweight games, cooperative expeditions, and a shared world experience in one mobile-first interface.

## Technology

| Layer | Technology |
| --- | --- |
| Client | React 18, Vite, Telegram UI, PixiJS, Three.js |
| Server | Node.js 18+, Express |
| Data | SQLite through `better-sqlite3` |
| Realtime | WebSocket (`ws`) |
| Telegram integration | Telegram Mini App launch data and Bot API |

## Architecture

```text
Telegram Mini App / local browser
              |
              v
      React application
   screens, games, shared UI
              |
        HTTP API + WebSocket
              |
              v
       Express application
 authentication, routes, domain services
              |
        +-----+------------------+
        |                        |
        v                        v
 SQLite database         Telegram services
 persistent state        bot and notifications
```

The frontend is a single-page React application. `App.jsx` owns the main navigation and loads larger experiences on demand. Shared client state and API access are kept separate from screens, while individual games and complex features live in their own modules.

The backend exposes JSON endpoints grouped by domain. Route handlers validate requests and delegate state changes to domain modules. SQLite stores player, character, inventory, social, activity, and world state. Database initialization and compatible schema updates are handled by `backend/database.js` and feature-specific schema modules.

Telegram launch data is verified by the backend before protected actions are processed. The client sends the launch payload with API requests and uses the Telegram environment for viewport and theme integration.

Frontier is a separate shared-world subsystem inside the same application. It has server-authoritative rules, its own persistence schema, HTTP endpoints, and a WebSocket channel for live presence and world updates. Pure deterministic rules are shared between the backend and frontend through `@peeper/frontier-core`.

## Repository Layout

```text
peeper/
├── backend/
│   ├── server.js              # Express entry point and route registration
│   ├── database.js            # SQLite initialization and migrations
│   ├── auth.js                # Request authentication middleware
│   ├── routes/                # Domain-oriented HTTP endpoints
│   ├── expeditions/           # Cooperative expedition domain
│   ├── frontier/              # Shared world engine, API, realtime, and tests
│   │   └── core/              # Rules shared with the frontend
│   └── *.js                   # Domain services and supporting modules
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Application shell and navigation
│   │   ├── api.js             # Backend client
│   │   ├── context/           # Shared React state
│   │   ├── screens/           # Product screens and feature entry points
│   │   ├── components/        # Reusable UI and scene components
│   │   ├── games/             # Standalone game experiences
│   │   ├── frontier/          # Shared world client and rendering
│   │   ├── hooks/             # Reusable client hooks
│   │   ├── utils/             # Client utilities
│   │   └── assets/            # Bundled visual assets
│   └── vite.config.js         # Development server and build configuration
├── html/                      # Runtime-served static assets
├── docs/                      # Feature design and engineering documents
├── ops/                       # Operational support files
└── scripts/                   # Maintenance utilities
```

## Backend Domains

The HTTP API is organized around independent product areas:

- authentication and player state;
- character care, inventory, shop, gifts, and customization;
- profiles, rankings, homes, and farms;
- families, family chat, and cooperative expeditions;
- global chat and social interactions;
- multiplayer activities;
- Frontier world state and realtime events;
- administrative content management.

Most persistent mutations are performed on the server. This keeps balances, rewards, ownership, and multiplayer state consistent across clients.

## Frontend Structure

The client separates application concerns into:

- `screens/` for top-level product views;
- `components/` for reusable interface and scene elements;
- `games/` for isolated interactive experiences;
- `context/` for session and application state;
- `api.js` for all HTTP communication;
- `frontier/` for the shared-world renderer, controls, HUD, and live connection.

Vite proxies `/api` requests to the local backend during development. The same proxy supports WebSocket upgrades used by realtime features.

## Local Development

Requirements:

- Node.js 18 or newer;
- npm.

Install and start the backend:

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

In a second terminal, install and start the frontend:

```bash
cd frontend
npm install
npm run dev
```

The frontend is available at `http://127.0.0.1:5173` and proxies API requests to `http://localhost:4000` by default.

To use a different local API address, set `PEEPER_API_TARGET` before starting Vite.

## Configuration

Backend configuration is read from `backend/.env`:

| Variable | Purpose |
| --- | --- |
| `BOT_TOKEN` | Telegram bot credential used by server-side integrations |
| `PORT` | Backend HTTP port |
| `NODE_ENV` | Runtime environment |
| `PEEPER_DB_PATH` | Optional path to the SQLite database |

Create local configuration from `backend/.env.example`. Environment files and database files are excluded from version control. Do not commit credentials or production data.

## Useful Commands

From `backend/`:

```bash
npm run dev      # start with automatic reload
npm start        # start normally
```

From `frontend/`:

```bash
npm run dev      # start the Vite development server
npm run build    # create a production frontend bundle
npm run preview  # preview the generated bundle locally
```

## Development Guidelines

- Keep authentication and persistent state changes on the server.
- Add HTTP endpoints to the matching module under `backend/routes/`.
- Keep reusable business rules outside route handlers.
- Route frontend network access through `frontend/src/api.js`.
- Keep large screens and interactive experiences isolated in their feature modules.
- Store secrets in environment variables and generated runtime data outside Git.
