# Peeper Code Review Instructions

## Review language and format

- Write every review comment, summary, title, and suggested change in English.
- Report only concrete, actionable issues introduced or exposed by the pull request.
- Prioritize correctness, security, data integrity, production reliability, compatibility, concurrency, and meaningful performance problems.
- For each finding, identify the affected behavior, explain when it fails and why it matters, and suggest the smallest practical fix.
- Keep comments concise and attach them to the narrowest relevant line range.
- Do not fill reviews with praise, a restatement of the diff, cosmetic preferences, or speculative concerns without a plausible failure mode.
- Do not claim that tests or commands were run unless the available review context proves that they were run.
- For security findings, explain the impact without publishing secrets, credentials, personal data, or unnecessary exploit payloads.

## Understand the change in repository context

- Review the pull request against the surrounding codebase, not only the changed lines.
- Inspect callers, route registration, domain services, database schema, serializers, frontend API methods, and relevant tests before raising a finding.
- Trace behavior end to end when a change crosses the client, HTTP API, WebSocket transport, database, Telegram integration, or deployment configuration.
- Check whether similar features already establish a convention that the new code should preserve.
- Distinguish an intentional project pattern from an accidental inconsistency. Raise a finding only when the difference has a concrete consequence.

## Project architecture

- The frontend is a mobile-first React 18 application built with Vite and embedded as a Telegram Mini App.
- The backend is a Node.js Express application using CommonJS and SQLite through `better-sqlite3`.
- HTTP routes live under `backend/routes/`; reusable state and business rules should remain outside thin route handlers.
- Frontend network access is centralized in `frontend/src/api.js`.
- Persistent multiplayer and economy state is server-authoritative.
- Frontier is a shared-world subsystem with HTTP endpoints, WebSocket transport, feature-specific persistence, and deterministic rules shared through `@peeper/frontier-core`.
- Runtime-served assets and generated data are distinct from source-controlled frontend assets. Changes must preserve that boundary.

## Security and trust boundaries

- Treat all client-provided values as untrusted, including identifiers, prices, quantities, scores, rewards, cooldown timestamps, ownership claims, and multiplayer results.
- Protected backend operations must derive identity from verified Telegram launch data rather than request parameters supplied by the client.
- Never expose bot tokens, environment variables, authentication payloads, database contents, private user data, internal filesystem paths, or administrative details.
- Check authorization separately from authentication, especially for admin operations, family actions, home visits, gifts, chat moderation, multiplayer invitations, and resource ownership.
- Use parameterized SQL. Flag dynamic SQL identifiers or fragments unless they are selected from a strict server-owned allowlist.
- Review uploads and external URLs for path traversal, unsafe file types, excessive size, SSRF, cache poisoning, and unintended public access.
- Review chat, webhook, invitation, game-result, and WebSocket endpoints for replay, spam, flooding, and missing rate or size limits.

## Data integrity and server authority

- Currency, inventory, rewards, purchases, contributions, progression, rankings, cooldowns, and ownership must be calculated and validated on the server.
- Multi-step state changes that must succeed together should use a SQLite transaction.
- Retried requests and reconnects must not duplicate rewards, purchases, actions, or contributions. Prefer explicit idempotency keys or durable uniqueness constraints where applicable.
- Database changes must preserve existing production data and remain compatible with an already populated database.
- Check schema initialization and migrations for safe defaults, ordering, indexes, uniqueness, foreign-key behavior, and compatibility with older rows.
- Time-based behavior must use a consistent server clock and must not rely on a client clock for authoritative decisions.
- Failure paths must not leave partially applied state or return success before persistence is complete.

## API and realtime contracts

- When an endpoint changes, verify the route handler, domain logic, serializer, `frontend/src/api.js`, consuming screens, and tests agree on names, types, nullability, status codes, and error behavior.
- Avoid leaking stack traces or internal error details to clients.
- WebSocket connections must authenticate before receiving private state, validate every message, limit payload size and frequency, and clean up sockets, timers, and presence state on disconnect.
- Realtime broadcasts must contain only the minimum public data required by clients.
- Reconnects and out-of-order messages must not corrupt persistent state or duplicate user-visible actions.

## Frontend and mobile behavior

- Preserve Telegram safe areas, compact viewport support, touch input, mouse-based local development, and both light and dark themes.
- Persistent state shown by the UI must reconcile with server responses; optimistic UI must be reversible after rejection or network failure.
- Check loading, empty, offline, retry, and error states for new asynchronous flows.
- Clean up event listeners, intervals, animation frames, object URLs, WebSocket handlers, and asynchronous effects when components unmount.
- Avoid unnecessary polling or rendering work during full-screen gameplay and animation-heavy scenes.
- Interactive controls must remain usable on small screens and must not depend on hover.
- Flag inaccessible controls when they have no usable label, focus behavior, or keyboard alternative where a keyboard interaction is expected.

## Games, economy, and Frontier

- Never trust a client-submitted game score or completion result without server-side bounds, eligibility checks, replay protection, and reward caps.
- Review economy changes for repeatable profit loops, negative balances, integer or rounding errors, concurrency races, and bypasses through direct API calls.
- Shared deterministic Frontier rules must remain free of browser, renderer, database, wall-clock, and network dependencies.
- Frontier travel, jobs, missions, projects, preparation, and boss actions must enforce world gates and prerequisites on the server, even if the client hides unavailable actions.
- Validate that shared-world contributions and rewards remain idempotent and correct under simultaneous requests from multiple players.

## Tests and validation

- Expect regression tests for meaningful domain-rule fixes, database invariants, authorization checks, idempotency, reward calculations, and realtime transport behavior.
- Prefer tests that exercise observable behavior and failure cases over tests that merely repeat implementation details.
- When dependencies change, verify that the matching lockfile is updated.
- Frontend changes should remain compatible with `npm run build`; backend changes should remain compatible with the declared Node.js version.
- Give extra scrutiny to changes affecting authentication, database migrations, deployment scripts, GitHub workflows, package installation, or files executed in production.

## Deployment awareness

- The production server automatically deploys accepted commits from `main`.
- Treat changes to startup, build output, dependencies, environment handling, migrations, static assets, health checks, and process management as production-impacting.
- Do not recommend committing secrets, databases, generated runtime files, uploaded user content, dependency directories, or machine-specific configuration.
- Call out changes that can leave production partially updated, make rollback unsafe, or require an undocumented manual step.
