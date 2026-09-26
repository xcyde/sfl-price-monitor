# SFL Price Monitor — project guide for AI assistants

Read this before touching the code. It is the source of truth for what the project is,
how it is built and which decisions are already made. If you change architecture or
conventions, update this file in the same task.

## What this is

A backend for monitoring in-game market prices of **Sunflower Land** (a browser P2E game).
A cron job pulls prices every 15 minutes, stores them as a time series in PostgreSQL,
and exposes them through a REST API. A Telegram bot is a client of that API.

It is a **resume project**: the goal is to demonstrate Mid-level Node.js/TypeScript
backend skills — external API integration, time-series data, background jobs, REST API,
authentication, containerized deployment. Coherence matters more than feature count:
every component must have a real consumer or an honest, documented reason to exist.

## Status and roadmap

Done:
- Price fetching (cron) + persistence + migrations
- REST API (Fastify) + Swagger
- JWT auth (bot-secret login, access + refresh with rotation and reuse detection)
- Unit tests (native `node:test`)
- Telegram bot as an authenticated API client, running as a separate process
- Deployment artifacts: Dockerfile, docker-compose (`api` + `bot` + `caddy`), Swagger gate
- Deployment hardening: least-privilege env per container, Caddy blocks `/api/auth/login`
  externally, `.env.example` uses a direct (non-pooled) Neon endpoint
- Deployment runbook: `docs/deploy-oracle.md` (Oracle Always Free + Neon + DuckDNS)

Next:
- CI/CD (GitHub Actions: lint, build, test, deploy)
- Resume polish (README, badges)

Later (separate big iteration):
- **Signals engine**: algorithmic buy/sell recommendations based on price dynamics,
  history and game events. Design not started. It is the user-scoped feature that
  fully justifies the auth layer.

## Architecture

```
Telegram ──long-polling── bot (grammy) ──HTTP + JWT──▶ api (Fastify)
                                                        ├─ node-cron: fetch prices every 15 min
                                                        ├─ migrations on boot
                                                        └─ PostgreSQL (Neon)
Browser ──HTTPS──▶ Caddy ──▶ api
```

- Two processes from one repo and one Docker image: `api` (`src/index.ts`) and
  `bot` (`src/bot.ts`), started with different commands.
- The bot has no database access. It logs in via `POST /api/auth/login` with the
  shared bot secret and calls protected API routes with a Bearer token.
- Target hosting: Oracle Cloud Always Free VM (ARM64), docker-compose, Caddy for
  automatic HTTPS, Neon as managed PostgreSQL.
- Root-level deploy artifacts (outside `src/`): `Dockerfile`, `docker-compose.yml`,
  `Caddyfile`, `docs/deploy-oracle.md` (step-by-step deploy + Always-Free-reclaim recovery).

## Repository map

```
src/
  index.ts              api entrypoint: Fastify, JWT, Swagger (gated), routes, cron, migrations
  bot.ts                bot entrypoint: grammy long-polling only, no DB/Fastify imports
  config/env.ts         zod-validated env for api (parseEnv + env)
  config/botEnv.ts      zod-validated env for bot (parseBotEnv)
  db/index.ts           postgres.js client
  db/migrate.ts         runs pending src/db/migrations/*.sql on boot
  db/migrations/        plain SQL migrations, numbered
  api/routes/auth.ts    /api/auth/login, /refresh, /me
  api/routes/prices.ts  /api/prices/latest, /history, /aggregate (all protected)
  api/schemas.ts        zod request/response schemas
  jobs/priceFetcher.ts  cron schedule + runPriceFetch
  modules/prices/       SFL API fetcher, prices repository
  modules/auth/         authService (DI factory), refresh token repositories
  modules/users/        users repository
  modules/bot/          apiClient (HTTP + token cache), handlers, formatPrices, createBot
  types/                Fastify and @fastify/jwt type augmentation
  interfaces/           SFL API response and PriceEntry types
```

## Data model (actual migrations)

- `items(id serial, name unique)` and `price_records(id, item_id → items, price numeric(10,6), fetched_at)`,
  index `(item_id, fetched_at DESC)`
- `users(id serial, telegram_id bigint unique, telegram_username, created_at)`
- `refresh_tokens(id, user_id → users unique, token_hash, expires_at)` — one active session per user
- `used_refresh_tokens(id, user_id, token_hash unique, used_at)` — journal for reuse detection
- `migrations` — applied migration names

Primary keys are `serial` integers, not UUIDs. There is **no** `resources`, `alerts` or
`price_signals` table; migration `002_create_auth_and_alerts.sql` is misnamed and only
creates `users` and `refresh_tokens`. Never edit an applied migration — add a new file.

## API

- `POST /api/auth/login` — header `x-bot-secret`, body `{ telegramId, username }`,
  returns access + refresh tokens. Bot-only (machine-to-machine).
- `POST /api/auth/refresh` — rotates the refresh token.
- `GET /api/auth/me` — protected.
- `GET /api/prices/latest?item=`, `/history?item=&from=&to=&limit=`,
  `/aggregate?item=&period=1h|24h|7d` — protected by one `onRequest` hook on the plugin.
- `GET /health` — liveness, hidden from Swagger.
- Swagger UI at `/docs` when `ENABLE_SWAGGER=true`.

## Auth model

- Access token: stateless JWT via `@fastify/jwt`, TTL `JWT_ACCESS_TTL` (15m).
- Refresh token: opaque random 32 bytes, stored as SHA-256 hash, TTL 30 days,
  rotated on every refresh. Reusing a rotated token revokes the user's session.
- The bot holds the master secret, so it re-logs in when the access token expires and
  does not use refresh. Refresh rotation is designed for a future untrusted client
  (web/mobile) and is covered by unit tests.

## Conventions

- Node 24, ESM (`"type": "module"`), `NodeNext`. Relative imports use the `.ts`
  extension; `tsc` rewrites them to `.js` in `dist/`.
- TypeScript runs natively on Node 24 (`node src/index.ts`). Do not add `tsx`.
- Raw SQL through `postgres.js` tagged templates. No ORM, no query builder.
  `postgres.js` parses `sslmode` from `DATABASE_URL` itself — do not add manual SSL option handling.
- zod for env and request/response schemas (`fastify-type-provider-zod`).
- Business logic in DI factories (`createAuthService`, `createApiClient`) so it is
  testable without a database or network.
- Tests: only `node:test` + `node:assert/strict`, no third-party test libraries.
  Mock with `t.mock.method()` (auto-restored), fakes via DI. No real DB in unit tests.
- Code identifiers in English, self-documenting code, comments only for non-obvious logic.

## Commands

```bash
npm run build                 # tsc → dist/
npm test                      # node --test over src/**/*.test.ts
node src/index.ts             # api (needs DATABASE_URL etc. in .env)
node src/bot.ts               # bot (needs a running api)
docker compose config         # validate compose file
docker compose up --build     # api + bot + caddy
```

## Environment

api (`src/config/env.ts`): `DATABASE_URL`, `PRICES_API_URL`, `PORT` (3000), `JWT_SECRET` (≥32),
`JWT_ACCESS_TTL` (15m), `REFRESH_TOKEN_TTL_DAYS` (30), `BOT_INTERNAL_SECRET` (≥16), `ENABLE_SWAGGER` (false).

bot (`src/config/botEnv.ts`): `TELEGRAM_BOT_TOKEN`, `BOT_INTERNAL_SECRET`, `API_BASE_URL`
(`http://127.0.0.1:3000` locally, `http://api:<PORT>` in compose).

Caddy: `DOMAIN` (required — compose fails fast via `${DOMAIN:?...}` if unset), `PORT`.
See `.env.example`.

## Decisions already made — do not relitigate

- **No threshold alerts** (`above`/`below` + threshold). The product vision is an
  algorithmic signals engine; threshold alerts would be throwaway schema.
- **Bot is a separate process/container and an API client**, not an in-process module
  with DB access. Otherwise auth, REST and Swagger would have no consumer.
- **Future push notifications go through an outbox table** (api writes, bot sends),
  because the bot is a separate process.
- **One VM, two containers.** Not a single process, not two servers.
- **Oracle Always Free VM + long-polling.** Serverless was rejected: it kills both the
  long-polling bot and node-cron.
- **Neon for PostgreSQL**, not a Postgres container on the VM (survives VM reclaim).
- **Swagger is public.** The only leak (the `x-bot-secret` header field in the login
  schema) has been removed.
- **`/api/auth/login` is blocked at Caddy for external traffic** (`respond ... 404` in
  `Caddyfile`), on top of the bot-secret check in the route itself. Only the `bot`
  container reaches it, over the internal compose network (`http://api:<PORT>`).
- **Native Node 24 TypeScript**, no `tsx`, no ORM, no third-party test libraries.

## Known debt and gotchas

- `tsc` does not copy `.sql` files: the Dockerfile copies `src/db/migrations` into `dist/db/`.
- `used_refresh_tokens` grows forever — needs a cleanup job.
- The codebase still contains Russian comments — to be cleaned up (no-comments rule).
- `bot.start()` promise is not handled: an invalid token causes an unhandled rejection.

## Working rules for AI assistants

- Work in stages. Before each stage (and each file or group of related edits) briefly
  explain what and why, then wait for approval. Report after each stage and wait again.
- Do not run git commands that change state (add, commit, push, etc.). The user commits.
- The user verifies manually: give exact commands to run instead of claiming results.
- Do not trust the original idealized schema from early notes; trust the migrations.
- Update this file when architecture, conventions or decisions change.
